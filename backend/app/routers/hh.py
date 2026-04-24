import logging
import time
import xml.etree.ElementTree as ET
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/hh", tags=["hh"])

_CIK = "0001759760"
_CIK_INT = "1759760"
_SUBMISSIONS_URL = f"https://data.sec.gov/submissions/CIK{_CIK}.json"
_ARCHIVE_BASE = f"https://www.sec.gov/Archives/edgar/data/{_CIK_INT}"
_CACHE_TTL = 3600
_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_SEC_HEADERS = {
    "User-Agent": "tarco/1.0 holdings-watch contact@example.com",
    "Accept-Encoding": "gzip, deflate",
}

_ISSUER_TICKERS = {
    "ALIBABA GROUP HLDG LTD": "BABA",
    "ALPHABET INC": "GOOG",
    "APPLE INC": "AAPL",
    "ASML HOLDING N V": "ASML",
    "BERKSHIRE HATHAWAY INC DEL": "BRK.B",
    "CREDO TECHNOLOGY GROUP HOLDI": "CRDO",
    "COREWEAVE INC": "CRWV",
    "DISNEY WALT CO": "DIS",
    "MICROSOFT CORP": "MSFT",
    "NVIDIA CORPORATION": "NVDA",
    "OCCIDENTAL PETE CORP": "OXY",
    "PDD HOLDINGS INC": "PDD",
    "TAIWAN SEMICONDUCTOR MFG LTD": "TSM",
    "TEMPUS AI INC": "TEM",
}


class HhHoldingOut(BaseModel):
    rank: int
    ticker: str
    company_name: str
    price: float | None = None
    price_label: str
    market_value: float | None = None
    market_value_label: str
    weight: float | None = None
    shares: float | None = None
    shares_change: float | None = None
    share_change_pct: float | None = None
    activity: str


class HhChangeOut(BaseModel):
    date: str
    fund: str
    ticker: str
    direction: str
    market_value: float | None = None
    market_value_label: str
    percent_of_position: float | None = None
    percent_of_etf: float | None = None
    current_combined_weight: float | None = None


class HhChangesSummaryOut(BaseModel):
    source: str
    source_url: str
    fetched_at: float
    latest_date: str | None
    total_buy_value: float
    total_sell_value: float
    net_value: float
    buy_count: int
    sell_count: int
    items: list[HhChangeOut]


class HhHoldingsSummaryOut(BaseModel):
    source: str
    source_url: str
    fetched_at: float
    total_market_value: float
    top_10_weight: float
    holdings_count: int
    items: list[HhHoldingOut]


class HhOverviewOut(BaseModel):
    manager: str
    vehicle: str
    source: str
    fetched_at: float
    report_date: str
    previous_report_date: str | None
    filing_date: str
    holdings: HhHoldingsSummaryOut
    trades: HhChangesSummaryOut


class _Filing(BaseModel):
    accession: str
    report_date: str
    filing_date: str
    form: str


class _SecHolding(BaseModel):
    issuer: str
    cusip: str
    ticker: str
    value: float
    shares: float


def _fmt_money(value: float | None) -> str:
    if value is None:
        return "-"
    abs_value = abs(value)
    sign = "-" if value < 0 else ""
    if abs_value >= 1_000_000_000:
        return f"{sign}${abs_value / 1_000_000_000:.2f}B"
    if abs_value >= 1_000_000:
        return f"{sign}${abs_value / 1_000_000:.1f}M"
    if abs_value >= 1_000:
        return f"{sign}${abs_value / 1_000:.1f}K"
    return f"{sign}${abs_value:.0f}"


async def _get_json(url: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20, headers=_SEC_HEADERS) as client:
        response = await client.get(url)
    response.raise_for_status()
    return response.json()


async def _get_text(url: str) -> str:
    async with httpx.AsyncClient(timeout=20, headers=_SEC_HEADERS) as client:
        response = await client.get(url)
    response.raise_for_status()
    return response.text


def _recent_13f_filings(submissions: dict[str, Any]) -> list[_Filing]:
    recent = submissions["filings"]["recent"]
    filings: list[_Filing] = []
    seen_reports: set[str] = set()
    for accession, report_date, filing_date, form in zip(
        recent["accessionNumber"],
        recent["reportDate"],
        recent["filingDate"],
        recent["form"],
        strict=False,
    ):
        if form not in {"13F-HR", "13F-HR/A"} or report_date in seen_reports:
            continue
        seen_reports.add(report_date)
        filings.append(
            _Filing(
                accession=accession,
                report_date=report_date,
                filing_date=filing_date,
                form=form,
            )
        )
        if len(filings) >= 2:
            break
    return filings


def _text(node: ET.Element, name: str) -> str:
    found = node.find(f".//{{*}}{name}")
    return found.text.strip() if found is not None and found.text else ""


def _parse_float(value: str) -> float:
    try:
        return float(value.replace(",", ""))
    except ValueError:
        return 0.0


def _ticker_for_issuer(issuer: str) -> str:
    normalized = " ".join(issuer.upper().split())
    return _ISSUER_TICKERS.get(normalized, normalized[:10])


async def _fetch_infotable(filing: _Filing) -> list[_SecHolding]:
    accession_path = filing.accession.replace("-", "")
    url = f"{_ARCHIVE_BASE}/{accession_path}/infotable.xml"
    xml = await _get_text(url)
    root = ET.fromstring(xml)
    holdings: list[_SecHolding] = []
    for info in root.findall(".//{*}infoTable"):
        issuer = _text(info, "nameOfIssuer")
        cusip = _text(info, "cusip")
        value = _parse_float(_text(info, "value"))
        shares = _parse_float(_text(info, "sshPrnamt"))
        holdings.append(
            _SecHolding(
                issuer=issuer,
                cusip=cusip,
                ticker=_ticker_for_issuer(issuer),
                value=value,
                shares=shares,
            )
        )
    return holdings


async def _load_overview_data() -> dict[str, Any]:
    now = time.time()
    cached = _cache.get("overview")
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]

    submissions = await _get_json(_SUBMISSIONS_URL)
    filings = _recent_13f_filings(submissions)
    if len(filings) < 2:
        raise ValueError("Not enough H&H 13F filings found")

    latest, previous = filings[0], filings[1]
    latest_holdings = await _fetch_infotable(latest)
    previous_holdings = await _fetch_infotable(previous)
    data = {
        "latest": latest,
        "previous": previous,
        "latest_holdings": latest_holdings,
        "previous_holdings": previous_holdings,
        "fetched_at": now,
    }
    _cache["overview"] = (now, data)
    return data


def _build_overview(data: dict[str, Any], holdings_limit: int, changes_limit: int) -> HhOverviewOut:
    latest: _Filing = data["latest"]
    previous: _Filing = data["previous"]
    latest_holdings: list[_SecHolding] = data["latest_holdings"]
    previous_holdings: list[_SecHolding] = data["previous_holdings"]
    fetched_at: float = data["fetched_at"]

    prev_by_cusip = {holding.cusip: holding for holding in previous_holdings}
    latest_by_cusip = {holding.cusip: holding for holding in latest_holdings}
    total_value = sum(holding.value for holding in latest_holdings)

    ranked = sorted(latest_holdings, key=lambda item: item.value, reverse=True)
    holdings: list[HhHoldingOut] = []
    changes: list[HhChangeOut] = []

    for rank, holding in enumerate(ranked, start=1):
        previous_holding = prev_by_cusip.get(holding.cusip)
        shares_change = (
            holding.shares - previous_holding.shares if previous_holding else holding.shares
        )
        share_change_pct = (
            shares_change / previous_holding.shares * 100
            if previous_holding and previous_holding.shares
            else 100.0
        )
        if not previous_holding:
            activity = "NEW"
        elif shares_change > 0:
            activity = "ADD"
        elif shares_change < 0:
            activity = "REDUCE"
        else:
            activity = "NO_CHANGE"
        weight = holding.value / total_value * 100 if total_value else 0
        value_change = holding.value - (previous_holding.value if previous_holding else 0)

        holdings.append(
            HhHoldingOut(
                rank=rank,
                ticker=holding.ticker,
                company_name=holding.issuer,
                price=None,
                price_label="-",
                market_value=holding.value,
                market_value_label=_fmt_money(holding.value),
                weight=weight,
                shares=holding.shares,
                shares_change=shares_change,
                share_change_pct=share_change_pct,
                activity=activity,
            )
        )

        if activity != "NO_CHANGE":
            changes.append(
                HhChangeOut(
                    date=latest.report_date,
                    fund="13F",
                    ticker=holding.ticker,
                    direction=activity,
                    market_value=abs(value_change),
                    market_value_label=_fmt_money(abs(value_change)),
                    percent_of_position=share_change_pct,
                    percent_of_etf=weight,
                    current_combined_weight=weight,
                )
            )

    for previous_holding in previous_holdings:
        if previous_holding.cusip in latest_by_cusip:
            continue
        changes.append(
            HhChangeOut(
                date=latest.report_date,
                fund="13F",
                ticker=previous_holding.ticker,
                direction="SOLD",
                market_value=previous_holding.value,
                market_value_label=_fmt_money(previous_holding.value),
                percent_of_position=-100.0,
                percent_of_etf=0.0,
                current_combined_weight=0.0,
            )
        )

    changes.sort(key=lambda item: item.market_value or 0, reverse=True)
    items = changes[:changes_limit]
    add_value = sum(
        item.market_value or 0
        for item in items
        if item.direction in {"NEW", "ADD"}
    )
    reduce_value = sum(
        item.market_value or 0
        for item in items
        if item.direction in {"REDUCE", "SOLD"}
    )
    source_url = f"{_ARCHIVE_BASE}/{latest.accession.replace('-', '')}/"

    return HhOverviewOut(
        manager="Duan Yongping",
        vehicle="H&H International Investment 13F",
        source="SEC EDGAR",
        fetched_at=fetched_at,
        report_date=latest.report_date,
        previous_report_date=previous.report_date,
        filing_date=latest.filing_date,
        holdings=HhHoldingsSummaryOut(
            source="SEC EDGAR",
            source_url=source_url,
            fetched_at=fetched_at,
            total_market_value=total_value,
            top_10_weight=sum(item.weight or 0 for item in holdings[:10]),
            holdings_count=len(holdings),
            items=holdings[:holdings_limit],
        ),
        trades=HhChangesSummaryOut(
            source="SEC EDGAR 13F",
            source_url=source_url,
            fetched_at=fetched_at,
            latest_date=latest.report_date,
            total_buy_value=add_value,
            total_sell_value=reduce_value,
            net_value=add_value - reduce_value,
            buy_count=sum(1 for item in items if item.direction in {"NEW", "ADD"}),
            sell_count=sum(1 for item in items if item.direction in {"REDUCE", "SOLD"}),
            items=items,
        ),
    )


@router.get("/overview", response_model=HhOverviewOut)
async def get_hh_overview(
    holdings_limit: int = Query(100, ge=1, le=200),
    changes_limit: int = Query(100, ge=1, le=200),
) -> HhOverviewOut:
    try:
        data = await _load_overview_data()
    except (httpx.HTTPError, ET.ParseError, ValueError) as exc:
        logger.exception("Failed to fetch H&H 13F overview")
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return _build_overview(data, holdings_limit, changes_limit)
