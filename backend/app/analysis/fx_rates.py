from __future__ import annotations

import asyncio
import json
from io import BytesIO
from datetime import date, timedelta
from decimal import Decimal
from urllib.parse import quote
from zipfile import ZipFile
from xml.etree import ElementTree as ET

import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import TaxFxRate

_PAIR_BY_CURRENCY = {
    "USD": "USD/CNY",
    "HKD": "HKD/CNY",
}


def _chunks(start: date, end: date, days: int = 30) -> list[tuple[date, date]]:
    chunks = []
    cursor = start
    while cursor <= end:
        chunk_end = min(cursor + timedelta(days=days - 1), end)
        chunks.append((cursor, chunk_end))
        cursor = chunk_end + timedelta(days=1)
    return chunks


async def fetch_and_store_fx_rates(
    db: AsyncSession,
    start_date: date,
    end_date: date,
    currencies: list[str] | None = None,
) -> dict:
    selected = [item.upper() for item in (currencies or ["USD", "HKD"])]
    unsupported = [item for item in selected if item not in _PAIR_BY_CURRENCY]
    if unsupported:
        raise ValueError(f"Unsupported FX currencies: {', '.join(unsupported)}")

    inserted = 0
    by_currency: dict[str, int] = {}
    async with httpx.AsyncClient(timeout=30, headers=_headers()) as client:
        try:
            for currency in selected:
                pair = _PAIR_BY_CURRENCY[currency]
                count = 0
                for chunk_start, chunk_end in _chunks(start_date, end_date):
                    payload = await _fetch_pair(client, pair, chunk_start, chunk_end)
                    for row in payload.get("records") or []:
                        rate_date = date.fromisoformat(str(row["date"]))
                        values = row.get("values") or []
                        if not values:
                            continue
                        await _upsert_rate(db, rate_date, currency, Decimal(str(values[0])), "chinamoney")
                        inserted += 1
                        count += 1
                by_currency[currency] = count
            source = "China Foreign Exchange Trade System / ChinaMoney"
            source_url = get_settings().TAX_FX_SOURCE_URL
        except httpx.HTTPError:
            safe_rows = await _fetch_safe_history(client, start_date, end_date, selected)
            for rate_date, currency, cny_rate in safe_rows:
                await _upsert_rate(db, rate_date, currency, cny_rate, "safe_history")
                inserted += 1
                by_currency[currency] = by_currency.get(currency, 0) + 1
            source = "State Administration of Foreign Exchange historical midpoint xlsx"
            source_url = get_settings().TAX_FX_SAFE_HISTORY_URL
    await db.commit()
    return {
        "imported": inserted,
        "currencies": selected,
        "by_currency": by_currency,
        "source": source,
        "source_url": source_url,
    }


async def _upsert_rate(
    db: AsyncSession,
    rate_date: date,
    currency: str,
    cny_rate: Decimal,
    source: str,
) -> None:
    stmt = pg_insert(TaxFxRate).values(
        rate_date=rate_date,
        currency=currency,
        cny_rate=cny_rate,
        source=source,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["rate_date", "currency"],
        set_={"cny_rate": stmt.excluded.cny_rate, "source": stmt.excluded.source},
    )
    await db.execute(stmt)


async def _fetch_pair(client: httpx.AsyncClient, pair: str, start_date: date, end_date: date) -> dict:
    query = (
        f"startDate={quote(start_date.isoformat())}"
        f"&endDate={quote(end_date.isoformat())}"
        f"&currency={pair}"
        "&pageNum=1&pageSize=100"
    )
    url = f"{get_settings().TAX_FX_SOURCE_URL}?{query}"
    try:
        response = await client.get(url)
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code != 403:
            raise
        payload = await _fetch_pair_with_curl(url)
    rep_code = str((payload.get("head") or {}).get("rep_code") or "")
    if rep_code and rep_code != "200":
        message = (payload.get("head") or {}).get("rep_message") or f"ChinaMoney rep_code={rep_code}"
        raise ValueError(str(message))
    return payload


async def _fetch_pair_with_curl(url: str) -> dict:
    proc = await asyncio.create_subprocess_exec(
        "curl",
        "-fsS",
        url,
        "-H",
        "Referer: https://www.chinamoney.com.cn/chinese/bkccpr/",
        "-H",
        "X-Requested-With: XMLHttpRequest",
        "-H",
        "Accept: application/json, text/plain, */*",
        "-m",
        "30",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise httpx.HTTPError(stderr.decode("utf-8", errors="replace") or f"curl exited {proc.returncode}")
    return json.loads(stdout.decode("utf-8"))


def _headers() -> dict[str, str]:
    return {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Host": "www.chinamoney.com.cn",
        "Origin": "https://www.chinamoney.com.cn",
        "Referer": "https://www.chinamoney.com.cn/chinese/bkccpr/",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0 (tarco tax fx collector)",
    }


async def _fetch_safe_history(
    client: httpx.AsyncClient,
    start_date: date,
    end_date: date,
    currencies: list[str],
) -> list[tuple[date, str, Decimal]]:
    url = get_settings().TAX_FX_SAFE_HISTORY_URL
    try:
        response = await client.get(url)
        response.raise_for_status()
        content = response.content
    except httpx.HTTPError:
        content = await _fetch_bytes_with_curl(url)
    return _parse_safe_xlsx(content, start_date, end_date, currencies)


async def _fetch_bytes_with_curl(url: str) -> bytes:
    proc = await asyncio.create_subprocess_exec(
        "curl",
        "-fsSL",
        url,
        "-H",
        "User-Agent: Mozilla/5.0",
        "-m",
        "60",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise httpx.HTTPError(stderr.decode("utf-8", errors="replace") or f"curl exited {proc.returncode}")
    return stdout


def _parse_safe_xlsx(
    content: bytes,
    start_date: date,
    end_date: date,
    currencies: list[str],
) -> list[tuple[date, str, Decimal]]:
    ns = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    out: list[tuple[date, str, Decimal]] = []
    with ZipFile(BytesIO(content)) as zf:
        shared = _shared_strings(zf, ns)
        sheet_name = next(name for name in zf.namelist() if name.startswith("xl/worksheets/sheet") and name.endswith(".xml"))
        root = ET.fromstring(zf.read(sheet_name))
        rows = root.findall(".//a:row", ns)
        if not rows:
            return out
        header = [_cell_value(cell, shared, ns) for cell in rows[0].findall("a:c", ns)]
        index_by_currency = _safe_header_index(header)
        for row in rows[1:]:
            values = [_cell_value(cell, shared, ns) for cell in row.findall("a:c", ns)]
            if not values or not values[0]:
                continue
            try:
                rate_date = date.fromisoformat(values[0])
            except ValueError:
                continue
            if rate_date < start_date or rate_date > end_date:
                continue
            for currency in currencies:
                idx = index_by_currency.get(currency)
                if idx is None or idx >= len(values) or not values[idx]:
                    continue
                out.append((rate_date, currency, Decimal(values[idx]) / Decimal("100")))
    return out


def _shared_strings(zf: ZipFile, ns: dict[str, str]) -> list[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    return ["".join(t.text or "" for t in si.findall(".//a:t", ns)) for si in root.findall("a:si", ns)]


def _cell_value(cell: ET.Element, shared: list[str], ns: dict[str, str]) -> str:
    value = cell.find("a:v", ns)
    if value is None or value.text is None:
        return ""
    raw = value.text
    if cell.attrib.get("t") == "s":
        return shared[int(raw)]
    return raw


def _safe_header_index(header: list[str]) -> dict[str, int]:
    out = {}
    if "美元" in header:
        out["USD"] = header.index("美元")
    if "港元" in header:
        out["HKD"] = header.index("港元")
    return out
