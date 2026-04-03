import logging
import time
from typing import Any

import yfinance as yf
from fastapi import APIRouter, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/fundamentals", tags=["fundamentals"])

_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_TTL = 300  # 5 minutes


def _yf_ticker(symbol: str) -> str:
    """Convert 'TSLA.US' → 'TSLA' for yfinance."""
    return symbol.split(".")[0]


def _fetch_fundamentals(symbol: str) -> dict[str, Any]:
    now = time.time()
    if symbol in _cache:
        ts, data = _cache[symbol]
        if now - ts < _CACHE_TTL:
            return data

    ticker = yf.Ticker(_yf_ticker(symbol))
    info = ticker.info or {}

    data = {
        "symbol": symbol,
        "market_cap": info.get("marketCap"),
        "pe_ratio": info.get("trailingPE"),
        "forward_pe": info.get("forwardPE"),
        "eps": info.get("trailingEps"),
        "roe": info.get("returnOnEquity"),
        "revenue": info.get("totalRevenue"),
        "profit_margin": info.get("profitMargins"),
        "fifty_two_week_high": info.get("fiftyTwoWeekHigh"),
        "fifty_two_week_low": info.get("fiftyTwoWeekLow"),
        "beta": info.get("beta"),
        "dividend_yield": info.get("dividendYield"),
    }

    _cache[symbol] = (now, data)
    logger.info("Fetched fundamentals for %s", symbol)
    return data


class FundamentalsOut(BaseModel):
    symbol: str
    market_cap: float | None = None
    pe_ratio: float | None = None
    forward_pe: float | None = None
    eps: float | None = None
    roe: float | None = None
    revenue: float | None = None
    profit_margin: float | None = None
    fifty_two_week_high: float | None = None
    fifty_two_week_low: float | None = None
    beta: float | None = None
    dividend_yield: float | None = None


@router.get("/", response_model=FundamentalsOut)
async def get_fundamentals(
    symbol: str = Query("TSLA.US"),
) -> FundamentalsOut:
    data = _fetch_fundamentals(symbol)
    return FundamentalsOut(**data)
