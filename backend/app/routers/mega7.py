import asyncio
import gzip
import json
import math
import re
import time
import urllib.request
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import pandas as pd
import yfinance as yf
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter(prefix="/api/mega7", tags=["mega7"])

_CACHE_DIR = Path(__file__).resolve().parents[2] / ".cache" / "mega7"
_CACHE_VERSION = 3
_cache: dict[str, tuple[float, Any]] = {}
_SEC_HEADERS = {
    "User-Agent": "tarco/1.0 mega7-financials contact@example.com",
    "Accept-Encoding": "gzip, deflate",
}

_MEGA7 = {
    "AAPL": "Apple",
    "MSFT": "Microsoft",
    "NVDA": "NVIDIA",
    "AMZN": "Amazon",
    "GOOGL": "Alphabet",
    "META": "Meta",
    "TSLA": "Tesla",
}
_CIKS = {
    "AAPL": "0000320193",
    "MSFT": "0000789019",
    "NVDA": "0001045810",
    "AMZN": "0001018724",
    "GOOGL": "0001652044",
    "META": "0001326801",
    "TSLA": "0001318605",
}
_QUARTER_FRAME = re.compile(r"^CY\d{4}Q[1-4]$")
_INSTANT_QUARTER_FRAME = re.compile(r"^CY\d{4}Q[1-4]I$")


class Mega7SymbolOut(BaseModel):
    symbol: str
    name: str


class Mega7PePoint(BaseModel):
    date: date
    close: float
    pe: float | None
    ttm_eps: float | None
    eps_report_date: date | None
    roe: float | None = None
    ttm_net_income: float | None = None
    equity: float | None = None
    equity_report_date: date | None = None


class Mega7PeOut(BaseModel):
    source: str
    source_url: str
    fetched_at: float
    cache_status: str
    symbol: str
    name: str
    years: int
    items: list[Mega7PePoint]
    symbols: list[Mega7SymbolOut]


@dataclass(frozen=True)
class _PriceRow:
    date: date
    close: float


@dataclass(frozen=True)
class _EpsRow:
    date: date
    eps: float


@dataclass(frozen=True)
class _FinancialRow:
    date: date
    net_income: float | None
    equity: float | None


def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _to_date(value: Any) -> date:
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is not None:
        timestamp = timestamp.tz_convert(None)
    return timestamp.date()


def _month_end(value: Any) -> date:
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is not None:
        timestamp = timestamp.tz_convert(None)
    return (timestamp + pd.offsets.MonthEnd(0)).date()


def _cache_path(symbol: str, years: int) -> Path:
    return _CACHE_DIR / f"pe_{symbol}_{years}y.json"


def _read_disk_cache(symbol: str, years: int) -> tuple[float, list[Mega7PePoint]] | None:
    path = _cache_path(symbol, years)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if payload.get("version") != _CACHE_VERSION:
            return None
        fetched_at = float(payload["fetched_at"])
        points = [Mega7PePoint.model_validate(item) for item in payload["items"]]
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None
    return fetched_at, points


def _write_disk_cache(symbol: str, years: int, fetched_at: float, points: list[Mega7PePoint]) -> None:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": _CACHE_VERSION,
        "fetched_at": fetched_at,
        "symbol": symbol,
        "years": years,
        "items": [point.model_dump(mode="json") for point in points],
    }
    _cache_path(symbol, years).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _statement_row(frame: pd.DataFrame, names: list[str]) -> pd.Series | None:
    for name in names:
        if name in frame.index:
            return frame.loc[name]
    return None


def _load_sec_companyfacts(symbol: str) -> dict[str, Any]:
    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{_CIKS[symbol]}.json"
    request = urllib.request.Request(url, headers=_SEC_HEADERS)
    with urllib.request.urlopen(request, timeout=20) as response:
        body = response.read()
        if response.headers.get("Content-Encoding") == "gzip":
            body = gzip.decompress(body)
        return json.loads(body.decode("utf-8"))


def _usd_facts(companyfacts: dict[str, Any], tags: list[str]) -> list[dict[str, Any]]:
    us_gaap = companyfacts.get("facts", {}).get("us-gaap", {})
    for tag in tags:
        facts = us_gaap.get(tag, {}).get("units", {}).get("USD")
        if facts:
            return facts
    return []


def _dedupe_facts_by_date(
    facts: list[dict[str, Any]],
    frame_pattern: re.Pattern[str],
) -> dict[date, float]:
    values: dict[date, tuple[str, float]] = {}
    for item in facts:
        if item.get("form") not in {"10-Q", "10-K"}:
            continue
        frame = item.get("frame")
        if not isinstance(frame, str) or not frame_pattern.match(frame):
            continue
        value = _finite(item.get("val"))
        if value is None:
            continue
        item_date = _to_date(item.get("end"))
        filed = str(item.get("filed") or "")
        existing = values.get(item_date)
        if existing is None or filed >= existing[0]:
            values[item_date] = (filed, value)
    return {item_date: value for item_date, (_, value) in values.items()}


def _load_financial_rows(symbol: str) -> list[_FinancialRow]:
    companyfacts = _load_sec_companyfacts(symbol)
    net_income_by_date = _dedupe_facts_by_date(
        _usd_facts(
            companyfacts,
            [
                "NetIncomeLoss",
                "ProfitLoss",
                "NetIncomeLossAvailableToCommonStockholdersBasic",
            ],
        ),
        _QUARTER_FRAME,
    )
    equity_by_date = _dedupe_facts_by_date(
        _usd_facts(
            companyfacts,
            [
                "StockholdersEquity",
                "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
                "CommonStocksIncludingAdditionalPaidInCapital",
            ],
        ),
        _INSTANT_QUARTER_FRAME,
    )

    dates = sorted(set(net_income_by_date).union(equity_by_date))
    return [
        _FinancialRow(
            date=item_date,
            net_income=net_income_by_date.get(item_date),
            equity=equity_by_date.get(item_date),
        )
        for item_date in dates
    ]


def _load_symbol_data(symbol: str, years: int) -> list[Mega7PePoint]:
    ticker = yf.Ticker(symbol)
    history = ticker.history(period=f"{years}y", interval="1mo", auto_adjust=False)
    earnings = ticker.get_earnings_dates(limit=max(years * 4 + 12, 60))
    financial_rows = _load_financial_rows(symbol)

    if history.empty:
        raise ValueError(f"No price history for {symbol}")
    if earnings is None or earnings.empty or "Reported EPS" not in earnings.columns:
        raise ValueError(f"No EPS history for {symbol}")

    price_rows: list[_PriceRow] = []
    for index, row in history.iterrows():
        close = _finite(row.get("Close"))
        if close is None or close <= 0:
            continue
        price_rows.append(_PriceRow(date=_month_end(index), close=close))

    eps_rows: list[_EpsRow] = []
    cleaned = earnings.dropna(subset=["Reported EPS"]).sort_index()
    cleaned = cleaned[~cleaned.index.duplicated(keep="last")]
    for index, row in cleaned.iterrows():
        eps = _finite(row.get("Reported EPS"))
        if eps is None:
            continue
        eps_rows.append(_EpsRow(date=_to_date(index), eps=eps))

    if not price_rows or len(eps_rows) < 4:
        raise ValueError(f"Insufficient PE data for {symbol}")

    points: list[Mega7PePoint] = []
    eps_cursor = 0
    financial_cursor = 0
    known_eps: list[_EpsRow] = []
    known_financials: list[_FinancialRow] = []
    for price in price_rows:
        while eps_cursor < len(eps_rows) and eps_rows[eps_cursor].date <= price.date:
            known_eps.append(eps_rows[eps_cursor])
            eps_cursor += 1
        while financial_cursor < len(financial_rows) and financial_rows[financial_cursor].date <= price.date:
            known_financials.append(financial_rows[financial_cursor])
            financial_cursor += 1

        ttm_eps: float | None = None
        pe: float | None = None
        report_date: date | None = None
        if len(known_eps) >= 4:
            recent_eps = known_eps[-4:]
            ttm_eps = sum(row.eps for row in recent_eps)
            report_date = recent_eps[-1].date
            if ttm_eps > 0:
                pe = price.close / ttm_eps

        roe: float | None = None
        ttm_net_income: float | None = None
        equity: float | None = None
        equity_report_date: date | None = None
        income_rows = [row for row in known_financials if row.net_income is not None]
        equity_rows = [row for row in known_financials if row.equity is not None and row.equity > 0]
        if len(income_rows) >= 4 and len(equity_rows) >= 2:
            recent_income = income_rows[-4:]
            ttm_net_income = sum(row.net_income or 0 for row in recent_income)
            equity = equity_rows[-1].equity
            beginning_equity = equity_rows[-min(5, len(equity_rows))].equity
            equity_report_date = equity_rows[-1].date
            if equity and beginning_equity and equity > 0 and beginning_equity > 0:
                average_equity = (equity + beginning_equity) / 2
                roe = ttm_net_income / average_equity * 100

        points.append(
            Mega7PePoint(
                date=price.date,
                close=round(price.close, 2),
                pe=round(pe, 2) if pe is not None else None,
                ttm_eps=round(ttm_eps, 3) if ttm_eps is not None else None,
                eps_report_date=report_date,
                roe=round(roe, 2) if roe is not None else None,
                ttm_net_income=round(ttm_net_income / 1_000_000_000, 3)
                if ttm_net_income is not None
                else None,
                equity=round(equity / 1_000_000_000, 3) if equity is not None else None,
                equity_report_date=equity_report_date,
            )
        )

    return points


@router.get("/pe", response_model=Mega7PeOut)
async def get_mega7_pe(
    symbol: str = Query("AAPL"),
    years: int = Query(10, ge=1, le=15),
    refresh: bool = Query(False),
) -> Mega7PeOut:
    normalized = symbol.upper()
    if normalized not in _MEGA7:
        raise HTTPException(status_code=400, detail="Unsupported Mega 7 symbol")

    cache_key = f"pe:{normalized}:{years}"
    now = time.time()
    cache_status = "fresh"
    cached = None if refresh else _cache.get(cache_key)
    if cached:
        points = cached[1]
        fetched_at = cached[0]
        cache_status = "memory"
    else:
        disk_cached = None if refresh else _read_disk_cache(normalized, years)
        if disk_cached:
            fetched_at, points = disk_cached
            _cache[cache_key] = (fetched_at, points)
            cache_status = "disk"
        else:
            try:
                points = await asyncio.to_thread(_load_symbol_data, normalized, years)
            except Exception as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc
            fetched_at = now
            _cache[cache_key] = (fetched_at, points)
            await asyncio.to_thread(_write_disk_cache, normalized, years, fetched_at, points)

    return Mega7PeOut(
        source="Yahoo Finance via yfinance",
        source_url=f"https://finance.yahoo.com/quote/{normalized}",
        fetched_at=fetched_at,
        cache_status=cache_status,
        symbol=normalized,
        name=_MEGA7[normalized],
        years=years,
        items=points,
        symbols=[
            Mega7SymbolOut(symbol=ticker, name=name)
            for ticker, name in _MEGA7.items()
        ],
    )
