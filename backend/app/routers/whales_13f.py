import logging
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)

duquesne_router = APIRouter(prefix="/api/duquesne", tags=["duquesne"])
ackman_router = APIRouter(prefix="/api/ackman", tags=["ackman"])
situational_router = APIRouter(prefix="/api/situational", tags=["situational"])

_CACHE_TTL = 3600
_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_SEC_HEADERS = {
    "User-Agent": "tarco/1.0 holdings-watch contact@example.com",
    "Accept-Encoding": "gzip, deflate",
}
_CUSIP_TICKERS = {
    "02079K107": "GOOG",
    "02079K305": "GOOGL",
    "007903107": "AMD",
    "023135106": "AMZN",
    "037833100": "AAPL",
    "038169207": "APLD",
    "05614L209": "BW",
    "09173B107": "BITF",
    "093712107": "BE",
    "11271J107": "BN",
    "11135F101": "AVGO",
    "169656105": "CMG",
    "18452B209": "CLSK",
    "19247G107": "COHR",
    "21873S108": "CRWV",
    "21874A106": "CORZ",
    "219350105": "GLW",
    "22266T109": "CPNG",
    "43300A203": "HLT",
    "433921103": "HIVE",
    "44267D107": "HHH",
    "456788108": "INFY",
    "457669307": "INSM",
    "458140100": "INTC",
    "46137V357": "RSP",
    "464286400": "EWZ",
    "595112103": "MU",
    "632307104": "NTRA",
    "67066G104": "NVDA",
    "68389X105": "ORCL",
    "73933G202": "PSIX",
    "74347M108": "PUMP",
    "76131D103": "QSR",
    "767292105": "RIOT",
    "778920306": "SAIH",
    "78464A763": "RSP",
    "80004C200": "SNDK",
    "81141R100": "SE",
    "81369Y605": "XLF",
    "83418M103": "SEI",
    "35834F104": "TE",
    "874039100": "TSM",
    "881624209": "TEVA",
    "92189F676": "SMH",
    "90353T100": "UBER",
    "92840M102": "VST",
    "980745103": "WWD",
    "G11448100": "BTDR",
    "G2788T103": "CPNG",
    "G96115103": "WYFI",
    "N07059210": "ASML",
    "Q4982L109": "IREN",
}


@dataclass(frozen=True)
class _ManagerSpec:
    slug: str
    manager: str
    vehicle: str
    cik: str
    cik_int: str
    value_multiplier: float = 1000.0

    @property
    def submissions_url(self) -> str:
        return f"https://data.sec.gov/submissions/CIK{self.cik}.json"

    @property
    def archive_base(self) -> str:
        return f"https://www.sec.gov/Archives/edgar/data/{self.cik_int}"


_DUQUESNE = _ManagerSpec(
    slug="duquesne",
    manager="Stanley Druckenmiller",
    vehicle="Duquesne Family Office 13F Equity Portfolio",
    cik="0001536411",
    cik_int="1536411",
)
_ACKMAN = _ManagerSpec(
    slug="ackman",
    manager="Bill Ackman",
    vehicle="Pershing Square Capital Management 13F Equity Portfolio",
    cik="0001336528",
    cik_int="1336528",
    value_multiplier=1.0,
)
_SITUATIONAL = _ManagerSpec(
    slug="situational",
    manager="Leopold Aschenbrenner",
    vehicle="Situational Awareness LP 13F Equity Portfolio",
    cik="0002045724",
    cik_int="2045724",
    value_multiplier=1.0,
)


class HoldingOut(BaseModel):
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


class ChangeOut(BaseModel):
    date: str
    fund: str
    ticker: str
    company_name: str | None = None
    direction: str
    market_value: float | None = None
    market_value_label: str
    percent_of_position: float | None = None
    percent_of_etf: float | None = None
    current_combined_weight: float | None = None


class ChangesSummaryOut(BaseModel):
    source: str
    source_url: str
    fetched_at: float
    latest_date: str | None
    total_buy_value: float
    total_sell_value: float
    net_value: float
    buy_count: int
    sell_count: int
    items: list[ChangeOut]


class HoldingsSummaryOut(BaseModel):
    source: str
    source_url: str
    fetched_at: float
    total_market_value: float
    top_10_weight: float
    holdings_count: int
    items: list[HoldingOut]


class OverviewOut(BaseModel):
    manager: str
    vehicle: str
    source: str
    fetched_at: float
    report_date: str
    previous_report_date: str | None
    filing_date: str
    holdings: HoldingsSummaryOut
    trades: ChangesSummaryOut


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
    put_call: str | None = None


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
    filings_by_report: dict[str, _Filing] = {}
    for accession, report_date, filing_date, form in zip(
        recent["accessionNumber"],
        recent["reportDate"],
        recent["filingDate"],
        recent["form"],
        strict=False,
    ):
        if form not in {"13F-HR", "13F-HR/A"} or report_date in filings_by_report:
            continue
        filings_by_report[report_date] = _Filing(
            accession=accession,
            report_date=report_date,
            filing_date=filing_date,
            form=form,
        )
    return sorted(filings_by_report.values(), key=lambda filing: filing.report_date, reverse=True)[:2]


def _text(node: ET.Element, name: str) -> str:
    found = node.find(f".//{{*}}{name}")
    return found.text.strip() if found is not None and found.text else ""


def _parse_float(value: str) -> float:
    try:
        return float(value.replace(",", ""))
    except ValueError:
        return 0.0


def _ticker_for_holding(cusip: str, issuer: str) -> str:
    if cusip in _CUSIP_TICKERS:
        return _CUSIP_TICKERS[cusip]
    return " ".join(issuer.upper().split())[:10]


def _display_ticker(ticker: str, put_call: str | None) -> str:
    return f"{ticker} {put_call.upper()}" if put_call else ticker


def _display_issuer(issuer: str, put_call: str | None) -> str:
    return f"{issuer} {put_call.upper()}" if put_call else issuer


async def _infotable_url(spec: _ManagerSpec, filing: _Filing) -> str:
    accession_path = filing.accession.replace("-", "")
    base_url = f"{spec.archive_base}/{accession_path}"
    try:
        index = await _get_json(f"{base_url}/index.json")
    except httpx.HTTPError:
        return f"{base_url}/infotable.xml"

    items = index.get("directory", {}).get("item", [])
    xml_items = [
        item
        for item in items
        if str(item.get("name", "")).lower().endswith(".xml")
        and str(item.get("name", "")).lower() != "primary_doc.xml"
    ]
    if not xml_items:
        return f"{base_url}/infotable.xml"

    def size(item: dict[str, Any]) -> int:
        try:
            return int(item.get("size") or 0)
        except (TypeError, ValueError):
            return 0

    largest_xml = max(xml_items, key=size)
    return f"{base_url}/{largest_xml['name']}"


async def _fetch_infotable(spec: _ManagerSpec, filing: _Filing) -> list[_SecHolding]:
    xml = await _get_text(await _infotable_url(spec, filing))
    root = ET.fromstring(xml)
    grouped: dict[tuple[str, str | None], _SecHolding] = {}

    for info in root.findall(".//{*}infoTable"):
        issuer = _text(info, "nameOfIssuer")
        cusip = _text(info, "cusip").upper()
        put_call = _text(info, "putCall") or None
        value = _parse_float(_text(info, "value")) * spec.value_multiplier
        shares = _parse_float(_text(info, "sshPrnamt"))
        key = (cusip, put_call)
        existing = grouped.get(key)
        if existing:
            existing.value += value
            existing.shares += shares
            continue
        grouped[key] = _SecHolding(
            issuer=issuer,
            cusip=cusip,
            ticker=_ticker_for_holding(cusip, issuer),
            value=value,
            shares=shares,
            put_call=put_call,
        )

    return list(grouped.values())


async def _load_overview_data(spec: _ManagerSpec) -> dict[str, Any]:
    now = time.time()
    cached = _cache.get(spec.slug)
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]

    submissions = await _get_json(spec.submissions_url)
    filings = _recent_13f_filings(submissions)
    if len(filings) < 2:
        raise ValueError(f"Not enough {spec.manager} 13F filings found")

    latest, previous = filings[0], filings[1]
    latest_holdings = await _fetch_infotable(spec, latest)
    previous_holdings = await _fetch_infotable(spec, previous)
    data = {
        "latest": latest,
        "previous": previous,
        "latest_holdings": latest_holdings,
        "previous_holdings": previous_holdings,
        "fetched_at": now,
    }
    _cache[spec.slug] = (now, data)
    return data


def _build_overview(
    spec: _ManagerSpec,
    data: dict[str, Any],
    holdings_limit: int,
    changes_limit: int,
) -> OverviewOut:
    latest: _Filing = data["latest"]
    previous: _Filing = data["previous"]
    latest_holdings: list[_SecHolding] = data["latest_holdings"]
    previous_holdings: list[_SecHolding] = data["previous_holdings"]
    fetched_at: float = data["fetched_at"]

    def holding_key(holding: _SecHolding) -> tuple[str, str | None]:
        return (holding.cusip, holding.put_call)

    prev_by_key = {holding_key(holding): holding for holding in previous_holdings}
    latest_by_key = {holding_key(holding): holding for holding in latest_holdings}
    total_value = sum(holding.value for holding in latest_holdings)
    ranked = sorted(latest_holdings, key=lambda item: item.value, reverse=True)
    holdings: list[HoldingOut] = []
    changes: list[ChangeOut] = []

    for rank, holding in enumerate(ranked, start=1):
        previous_holding = prev_by_key.get(holding_key(holding))
        shares_change = holding.shares - previous_holding.shares if previous_holding else holding.shares
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
            HoldingOut(
                rank=rank,
                ticker=_display_ticker(holding.ticker, holding.put_call),
                company_name=_display_issuer(holding.issuer, holding.put_call),
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
                ChangeOut(
                    date=latest.report_date,
                    fund="13F",
                    ticker=_display_ticker(holding.ticker, holding.put_call),
                    company_name=_display_issuer(holding.issuer, holding.put_call),
                    direction=activity,
                    market_value=abs(value_change),
                    market_value_label=_fmt_money(abs(value_change)),
                    percent_of_position=share_change_pct,
                    percent_of_etf=weight,
                    current_combined_weight=weight,
                )
            )

    for previous_holding in previous_holdings:
        if holding_key(previous_holding) in latest_by_key:
            continue
        changes.append(
            ChangeOut(
                date=latest.report_date,
                fund="13F",
                ticker=_display_ticker(previous_holding.ticker, previous_holding.put_call),
                company_name=_display_issuer(previous_holding.issuer, previous_holding.put_call),
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
    add_value = sum(item.market_value or 0 for item in items if item.direction in {"NEW", "ADD"})
    reduce_value = sum(
        item.market_value or 0
        for item in items
        if item.direction in {"REDUCE", "SOLD"}
    )
    source_url = f"{spec.archive_base}/{latest.accession.replace('-', '')}/"

    return OverviewOut(
        manager=spec.manager,
        vehicle=spec.vehicle,
        source="SEC EDGAR",
        fetched_at=fetched_at,
        report_date=latest.report_date,
        previous_report_date=previous.report_date,
        filing_date=latest.filing_date,
        holdings=HoldingsSummaryOut(
            source="SEC EDGAR",
            source_url=source_url,
            fetched_at=fetched_at,
            total_market_value=total_value,
            top_10_weight=sum(item.weight or 0 for item in holdings[:10]),
            holdings_count=len(holdings),
            items=holdings[:holdings_limit],
        ),
        trades=ChangesSummaryOut(
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


async def _get_overview(
    spec: _ManagerSpec,
    holdings_limit: int,
    changes_limit: int,
) -> OverviewOut:
    try:
        data = await _load_overview_data(spec)
    except (httpx.HTTPError, ET.ParseError, ValueError) as exc:
        logger.exception("Failed to fetch %s 13F overview", spec.manager)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return _build_overview(spec, data, holdings_limit, changes_limit)


@duquesne_router.get("/overview", response_model=OverviewOut)
async def get_duquesne_overview(
    holdings_limit: int = Query(100, ge=1, le=200),
    changes_limit: int = Query(100, ge=1, le=200),
) -> OverviewOut:
    return await _get_overview(_DUQUESNE, holdings_limit, changes_limit)


@ackman_router.get("/overview", response_model=OverviewOut)
async def get_ackman_overview(
    holdings_limit: int = Query(100, ge=1, le=200),
    changes_limit: int = Query(100, ge=1, le=200),
) -> OverviewOut:
    return await _get_overview(_ACKMAN, holdings_limit, changes_limit)


@situational_router.get("/overview", response_model=OverviewOut)
async def get_situational_overview(
    holdings_limit: int = Query(100, ge=1, le=200),
    changes_limit: int = Query(100, ge=1, le=200),
) -> OverviewOut:
    return await _get_overview(_SITUATIONAL, holdings_limit, changes_limit)
