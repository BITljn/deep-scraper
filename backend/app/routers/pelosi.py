import logging
import re
import time
from datetime import datetime
from html.parser import HTMLParser
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pelosi", tags=["pelosi"])

_PORTFOLIO_URL = "https://pelositracker.app/portfolios/nancy-pelosi"
_CACHE_TTL = 900
_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_MONTHS = {
    "Jan": 1,
    "Feb": 2,
    "Mar": 3,
    "Apr": 4,
    "May": 5,
    "Jun": 6,
    "Jul": 7,
    "Aug": 8,
    "Sep": 9,
    "Oct": 10,
    "Nov": 11,
    "Dec": 12,
}
_COMPANY_NAMES = {
    "AAPL": "Apple",
    "AMZN": "Amazon",
    "AVGO": "Broadcom",
    "CRWD": "CrowdStrike",
    "GOOGL": "Alphabet",
    "IBTA.L": "iShares Treasury Bond ETF",
    "MSFT": "Microsoft",
    "NVDA": "NVIDIA",
    "PANW": "Palo Alto Networks",
    "TEM": "Tempus AI",
    "TSLA": "Tesla",
    "VST": "Vistra",
}


class PelosiHoldingOut(BaseModel):
    rank: int
    ticker: str
    company_name: str
    price: float | None = None
    price_label: str
    market_value: float | None = None
    market_value_label: str
    weight: float | None = None


class PelosiTradeOut(BaseModel):
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


class PelosiTradesSummaryOut(BaseModel):
    source: str
    source_url: str
    fetched_at: float
    latest_date: str | None
    total_buy_value: float
    total_sell_value: float
    net_value: float
    buy_count: int
    sell_count: int
    items: list[PelosiTradeOut]


class PelosiHoldingsSummaryOut(BaseModel):
    source: str
    source_url: str
    fetched_at: float
    total_market_value: float
    top_10_weight: float
    holdings_count: int
    items: list[PelosiHoldingOut]


class PelosiOverviewOut(BaseModel):
    manager: str
    vehicle: str
    source: str
    fetched_at: float
    report_date: str | None = None
    filing_date: str | None = None
    holdings: PelosiHoldingsSummaryOut
    trades: PelosiTradesSummaryOut


class _TextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        text = " ".join(data.split())
        if text:
            self.parts.append(text)

    def text(self) -> str:
        return " ".join(self.parts)


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


def _parse_money(label: str) -> float | None:
    match = re.search(r"\$([\d,.]+)\s*([KMB]?)", label, re.I)
    if not match:
        return None
    multiplier = {"": 1.0, "K": 1_000.0, "M": 1_000_000.0, "B": 1_000_000_000.0}
    return float(match.group(1).replace(",", "")) * multiplier[match.group(2).upper()]


def _parse_page_date(label: str) -> str:
    month, day, year = re.match(r"([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})", label).groups()
    return datetime(int(year), _MONTHS[month], int(day)).date().isoformat()


def _company_name(ticker: str) -> str:
    return _COMPANY_NAMES.get(ticker.upper(), ticker)


async def _get_url(url: str) -> str:
    async with httpx.AsyncClient(
        timeout=20,
        follow_redirects=True,
        headers={"User-Agent": "tarco/1.0 holdings-watch contact@example.com"},
    ) as client:
        response = await client.get(url)
    response.raise_for_status()
    return response.text


def _page_text(html: str) -> str:
    parser = _TextParser()
    parser.feed(html)
    return parser.text()


def _parse_total_invested(text: str) -> float:
    match = re.search(r"Total Invested\s+\$[\d,.]+\s*[KMB]?", text, re.I)
    if not match:
        raise ValueError("No Pelosi total invested value parsed")
    value = _parse_money(match.group(0))
    if value is None:
        raise ValueError("Invalid Pelosi total invested value")
    return value


def _parse_updated_label(text: str) -> str | None:
    match = re.search(r"Updated\s+([^#]+?)\s+(?:Add to Watch List|Portfolio Performance)", text)
    return match.group(1).strip() if match else None


def _parse_holdings(text: str, total_invested: float) -> list[PelosiHoldingOut]:
    match = re.search(r"Ticker\s+Last Price\s+Weight(.+?)Holdings Distribution", text, re.S)
    if not match:
        raise ValueError("No Pelosi holdings section parsed")

    holdings: list[PelosiHoldingOut] = []
    for rank, item in enumerate(
        re.finditer(
            r"\b([A-Z][A-Z0-9.]{0,8}(?:\.L)?)\s*\$([\d,.]+)\s+([\d.]+)%",
            match.group(1),
        ),
        start=1,
    ):
        ticker = item.group(1)
        price_label = f"${item.group(2)}"
        weight = float(item.group(3))
        market_value = total_invested * weight / 100
        holdings.append(
            PelosiHoldingOut(
                rank=rank,
                ticker=ticker,
                company_name=_company_name(ticker),
                price=_parse_money(price_label),
                price_label=price_label,
                market_value=market_value,
                market_value_label=_fmt_money(market_value),
                weight=weight,
            )
        )

    if not holdings:
        raise ValueError("No Pelosi holdings parsed")
    return holdings


def _parse_trades(
    text: str,
    total_invested: float,
    holding_by_ticker: dict[str, PelosiHoldingOut],
) -> list[PelosiTradeOut]:
    match = re.search(r"Allocation History(.+?)Follow Nancy Pelosi", text, re.S)
    if not match:
        return []

    history = match.group(1)
    date_pattern = r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}"
    date_matches = list(re.finditer(date_pattern, history))
    trades: list[PelosiTradeOut] = []
    trade_pattern = re.compile(
        r"\b([A-Z][A-Z0-9.]{0,8}(?:\.L)?)\s+(BUY|SELL)\s+"
        r"([\d.]+)%\s+([\d.]+)%\s*\(([+-][\d.]+)%\)\s+\$([\d,.]+)",
        re.I,
    )

    for index, date_match in enumerate(date_matches):
        section_start = date_match.end()
        section_end = date_matches[index + 1].start() if index + 1 < len(date_matches) else len(history)
        date_label = date_match.group(0)
        iso_date = _parse_page_date(date_label)
        for item in trade_pattern.finditer(history[section_start:section_end]):
            ticker = item.group(1).upper()
            direction = item.group(2).upper()
            previous_weight = float(item.group(3))
            next_weight = float(item.group(4))
            delta_weight = float(item.group(5))
            market_value = abs(total_invested * delta_weight / 100)
            holding = holding_by_ticker.get(ticker)
            trades.append(
                PelosiTradeOut(
                    date=iso_date,
                    fund="Tracker",
                    ticker=ticker,
                    company_name=holding.company_name if holding else _company_name(ticker),
                    direction=direction,
                    market_value=market_value,
                    market_value_label=_fmt_money(market_value),
                    percent_of_position=delta_weight,
                    percent_of_etf=next_weight,
                    current_combined_weight=holding.weight if holding else next_weight,
                )
            )
            if previous_weight == next_weight:
                trades[-1].market_value = 0
                trades[-1].market_value_label = _fmt_money(0)

    return trades


async def _load_overview_data() -> dict[str, Any]:
    now = time.time()
    cached = _cache.get("overview")
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]

    text = _page_text(await _get_url(_PORTFOLIO_URL))
    total_invested = _parse_total_invested(text)
    holdings = _parse_holdings(text, total_invested)
    holding_by_ticker = {holding.ticker.upper(): holding for holding in holdings}
    trades = _parse_trades(text, total_invested, holding_by_ticker)
    data = {
        "fetched_at": now,
        "updated_label": _parse_updated_label(text),
        "total_invested": total_invested,
        "holdings": holdings,
        "trades": trades,
    }
    _cache["overview"] = (now, data)
    return data


def _build_overview(data: dict[str, Any], holdings_limit: int, changes_limit: int) -> PelosiOverviewOut:
    fetched_at: float = data["fetched_at"]
    holdings: list[PelosiHoldingOut] = data["holdings"]
    trades: list[PelosiTradeOut] = data["trades"]
    trade_items = trades[:changes_limit]
    total_buy = sum(item.market_value or 0 for item in trade_items if item.direction == "BUY")
    total_sell = sum(item.market_value or 0 for item in trade_items if item.direction == "SELL")

    return PelosiOverviewOut(
        manager="Paul Pelosi",
        vehicle="Nancy Pelosi disclosed portfolio tracker",
        source="Pelosi Tracker",
        fetched_at=fetched_at,
        report_date=data["updated_label"],
        filing_date=data["updated_label"],
        holdings=PelosiHoldingsSummaryOut(
            source="Pelosi Tracker",
            source_url=_PORTFOLIO_URL,
            fetched_at=fetched_at,
            total_market_value=data["total_invested"],
            top_10_weight=sum(item.weight or 0 for item in holdings[:10]),
            holdings_count=len(holdings),
            items=holdings[:holdings_limit],
        ),
        trades=PelosiTradesSummaryOut(
            source="Pelosi Tracker allocation history",
            source_url=_PORTFOLIO_URL,
            fetched_at=fetched_at,
            latest_date=trade_items[0].date if trade_items else None,
            total_buy_value=total_buy,
            total_sell_value=total_sell,
            net_value=total_buy - total_sell,
            buy_count=sum(1 for item in trade_items if item.direction == "BUY"),
            sell_count=sum(1 for item in trade_items if item.direction == "SELL"),
            items=trade_items,
        ),
    )


@router.get("/overview", response_model=PelosiOverviewOut)
async def get_pelosi_overview(
    holdings_limit: int = Query(100, ge=1, le=200),
    changes_limit: int = Query(100, ge=1, le=200),
) -> PelosiOverviewOut:
    try:
        data = await _load_overview_data()
    except (httpx.HTTPError, ValueError, AttributeError) as exc:
        logger.exception("Failed to fetch Pelosi portfolio overview")
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return _build_overview(data, holdings_limit, changes_limit)
