import logging
import time
from html.parser import HTMLParser
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ark", tags=["ark"])

_CATHIES_ARK_TRADES_URL = "https://cathiesark.com/ark-funds-combined/trades"
_CATHIES_ARK_HOLDINGS_URL = "https://cathiesark.com/ark-funds-combined/complete-holdings"
_CACHE_TTL = 900
_cache: dict[str, tuple[float, dict[str, Any]]] = {}


class ArkHoldingOut(BaseModel):
    rank: int
    ticker: str
    company_name: str
    price: float | None = None
    price_label: str
    market_value: float | None = None
    market_value_label: str
    weight: float | None = None


class ArkTradeOut(BaseModel):
    date: str
    fund: str
    ticker: str
    direction: str
    market_value: float | None = None
    market_value_label: str
    percent_of_position: float | None = None
    percent_of_etf: float | None = None
    current_combined_weight: float | None = None


class ArkTradesSummaryOut(BaseModel):
    source: str
    source_url: str
    fetched_at: float
    latest_date: str | None
    total_buy_value: float
    total_sell_value: float
    net_value: float
    buy_count: int
    sell_count: int
    items: list[ArkTradeOut]


class ArkHoldingsSummaryOut(BaseModel):
    source: str
    source_url: str
    fetched_at: float
    total_market_value: float
    top_10_weight: float
    holdings_count: int
    items: list[ArkHoldingOut]


class ArkOverviewOut(BaseModel):
    manager: str
    vehicle: str
    source: str
    fetched_at: float
    holdings: ArkHoldingsSummaryOut
    trades: ArkTradesSummaryOut


class _TableParser(HTMLParser):
    def __init__(self, header: list[str]) -> None:
        super().__init__()
        self.header = header
        self.in_table = False
        self.in_row = False
        self.in_cell = False
        self.seen_header = False
        self.current_cell: list[str] = []
        self.current_row: list[str] = []
        self.rows: list[list[str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "table" and not self.seen_header:
            self.in_table = True
        if not self.in_table:
            return
        if tag == "tr":
            self.in_row = True
            self.current_row = []
        if tag in {"td", "th"} and self.in_row:
            self.in_cell = True
            self.current_cell = []

    def handle_endtag(self, tag: str) -> None:
        if not self.in_table:
            return
        if tag in {"td", "th"} and self.in_cell:
            text = " ".join("".join(self.current_cell).split())
            self.current_row.append(text)
            self.in_cell = False
            self.current_cell = []
        if tag == "tr" and self.in_row:
            if self.current_row == self.header:
                self.seen_header = True
            elif self.seen_header and len(self.current_row) >= len(self.header):
                self.rows.append(self.current_row[: len(self.header)])
            self.in_row = False
            self.current_row = []
        if tag == "table":
            self.in_table = False

    def handle_data(self, data: str) -> None:
        if self.in_cell:
            self.current_cell.append(data)


def _parse_money(label: str) -> float | None:
    raw = label.strip().replace("$", "").replace(",", "")
    if not raw:
        return None
    multiplier = 1.0
    suffix = raw[-1].upper()
    if suffix == "K":
        multiplier = 1_000.0
        raw = raw[:-1]
    elif suffix == "M":
        multiplier = 1_000_000.0
        raw = raw[:-1]
    elif suffix == "B":
        multiplier = 1_000_000_000.0
        raw = raw[:-1]
    try:
        return float(raw) * multiplier
    except ValueError:
        return None


def _parse_percent(label: str) -> float | None:
    raw = label.strip().replace("%", "")
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _parse_rank(label: str) -> int:
    try:
        return int(label)
    except ValueError:
        return 0


def _holding_from_row(row: list[str]) -> ArkHoldingOut:
    rank, ticker, company, price, market_value, weight = row
    return ArkHoldingOut(
        rank=_parse_rank(rank),
        ticker=ticker,
        company_name=company,
        price=_parse_money(price),
        price_label=price,
        market_value=_parse_money(market_value),
        market_value_label=market_value,
        weight=_parse_percent(weight),
    )


def _trade_from_row(
    row: list[str],
    holding_by_ticker: dict[str, ArkHoldingOut] | None = None,
) -> ArkTradeOut:
    date, fund, ticker, direction, market_value, position, etf = row
    holding = holding_by_ticker.get(ticker.upper()) if holding_by_ticker else None
    return ArkTradeOut(
        date=date,
        fund=fund,
        ticker=ticker,
        direction=direction,
        market_value=_parse_money(market_value),
        market_value_label=market_value,
        percent_of_position=_parse_percent(position),
        percent_of_etf=_parse_percent(etf),
        current_combined_weight=holding.weight if holding else None,
    )


async def _get_url(url: str) -> str:
    async with httpx.AsyncClient(
        timeout=20,
        follow_redirects=True,
        headers={"User-Agent": "tarco/1.0 (+https://cathiesark.com)"},
    ) as client:
        response = await client.get(url)
    response.raise_for_status()
    return response.text


async def _fetch_holdings() -> list[ArkHoldingOut]:
    parser = _TableParser(["#", "Ticker", "Company", "Price", "Market Value", "Weight"])
    parser.feed(await _get_url(_CATHIES_ARK_HOLDINGS_URL))
    holdings = [_holding_from_row(row) for row in parser.rows]
    if not holdings:
        raise ValueError("No ARK holdings parsed from Cathie's Ark page")
    return holdings


async def _fetch_trades(
    holding_by_ticker: dict[str, ArkHoldingOut] | None = None,
) -> list[ArkTradeOut]:
    parser = _TableParser(
        ["Date", "Fund", "Ticker", "Direction", "Market Value", "% of Position", "% of ETF"]
    )
    parser.feed(await _get_url(_CATHIES_ARK_TRADES_URL))
    trades = [_trade_from_row(row, holding_by_ticker) for row in parser.rows]
    if not trades:
        raise ValueError("No ARK trades parsed from Cathie's Ark page")
    return trades


async def _get_cached_holdings() -> tuple[list[ArkHoldingOut], float]:
    cache_key = "holdings"
    now = time.time()
    cached = _cache.get(cache_key)
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]["holdings"], cached[1]["fetched_at"]

    holdings = await _fetch_holdings()
    _cache[cache_key] = (now, {"holdings": holdings, "fetched_at": now})
    return holdings, now


async def _get_cached_trades(
    holding_by_ticker: dict[str, ArkHoldingOut] | None = None,
) -> tuple[list[ArkTradeOut], float]:
    cache_key = "trades"
    now = time.time()
    cached = _cache.get(cache_key)
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]["trades"], cached[1]["fetched_at"]

    trades = await _fetch_trades(holding_by_ticker)
    _cache[cache_key] = (now, {"trades": trades, "fetched_at": now})
    return trades, now


def _summarize_holdings(
    holdings: list[ArkHoldingOut],
    fetched_at: float,
    limit: int,
) -> ArkHoldingsSummaryOut:
    return ArkHoldingsSummaryOut(
        source="Cathie's Ark",
        source_url=_CATHIES_ARK_HOLDINGS_URL,
        fetched_at=fetched_at,
        total_market_value=sum(holding.market_value or 0 for holding in holdings),
        top_10_weight=sum(holding.weight or 0 for holding in holdings[:10]),
        holdings_count=len(holdings),
        items=holdings[:limit],
    )


def _summarize_trades(
    trades: list[ArkTradeOut],
    fetched_at: float,
    limit: int,
    ticker: str | None = None,
) -> ArkTradesSummaryOut:
    filtered = trades
    if ticker:
        ticker_upper = ticker.upper()
        filtered = [trade for trade in trades if trade.ticker.upper() == ticker_upper]

    items = filtered[:limit]
    total_buy = sum(
        trade.market_value or 0
        for trade in items
        if trade.direction.lower().startswith("buy")
    )
    total_sell = sum(
        trade.market_value or 0
        for trade in items
        if trade.direction.lower().startswith("sell")
    )

    return ArkTradesSummaryOut(
        source="Cathie's Ark",
        source_url=_CATHIES_ARK_TRADES_URL,
        fetched_at=fetched_at,
        latest_date=items[0].date if items else None,
        total_buy_value=total_buy,
        total_sell_value=total_sell,
        net_value=total_buy - total_sell,
        buy_count=sum(1 for trade in items if trade.direction.lower().startswith("buy")),
        sell_count=sum(
            1 for trade in items if trade.direction.lower().startswith("sell")
        ),
        items=items,
    )


@router.get("/trades", response_model=ArkTradesSummaryOut)
async def list_ark_trades(
    ticker: str | None = Query(None, description="Optional ticker filter, e.g. TSLA"),
    limit: int = Query(40, ge=1, le=200),
) -> ArkTradesSummaryOut:
    try:
        holdings, _ = await _get_cached_holdings()
        holding_by_ticker = {holding.ticker.upper(): holding for holding in holdings}
        trades, fetched_at = await _get_cached_trades(holding_by_ticker)
    except (httpx.HTTPError, ValueError) as exc:
        logger.exception("Failed to fetch ARK trades")
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return _summarize_trades(trades, fetched_at, limit, ticker)


@router.get("/holdings", response_model=ArkHoldingsSummaryOut)
async def list_ark_holdings(
    limit: int = Query(100, ge=1, le=200),
) -> ArkHoldingsSummaryOut:
    try:
        holdings, fetched_at = await _get_cached_holdings()
    except (httpx.HTTPError, ValueError) as exc:
        logger.exception("Failed to fetch ARK holdings")
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return _summarize_holdings(holdings, fetched_at, limit)


@router.get("/overview", response_model=ArkOverviewOut)
async def get_ark_overview(
    holdings_limit: int = Query(100, ge=1, le=200),
    trades_limit: int = Query(80, ge=1, le=200),
) -> ArkOverviewOut:
    try:
        holdings, holdings_fetched_at = await _get_cached_holdings()
        holding_by_ticker = {holding.ticker.upper(): holding for holding in holdings}
        trades, trades_fetched_at = await _get_cached_trades(holding_by_ticker)
    except (httpx.HTTPError, ValueError) as exc:
        logger.exception("Failed to fetch ARK overview")
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return ArkOverviewOut(
        manager="Cathie Wood",
        vehicle="ARK ETFs Combined",
        source="Cathie's Ark",
        fetched_at=max(holdings_fetched_at, trades_fetched_at),
        holdings=_summarize_holdings(holdings, holdings_fetched_at, holdings_limit),
        trades=_summarize_trades(trades, trades_fetched_at, trades_limit),
    )
