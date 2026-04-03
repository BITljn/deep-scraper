from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Candlestick, StockQuote

router = APIRouter(prefix="/api/quotes", tags=["quotes"])
candlestick_router = APIRouter(tags=["candlesticks"])


class StockQuoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    symbol: str
    last_price: Decimal | None
    open: Decimal | None
    high: Decimal | None
    low: Decimal | None
    volume: int | None
    turnover: Decimal | None
    change_rate: Decimal | None
    market_cap: Decimal | None
    fetched_at: datetime


class CandlestickOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    symbol: str
    period: str
    ts: datetime
    open: Decimal | None
    high: Decimal | None
    low: Decimal | None
    close: Decimal | None
    volume: int | None
    turnover: Decimal | None


@router.get("/", response_model=list[StockQuoteOut])
async def list_quotes(
    db: AsyncSession = Depends(get_db),
    symbol: str = Query("TSLA.US"),
    limit: int = Query(100, ge=1, le=5000),
) -> list[StockQuoteOut]:
    stmt = (
        select(StockQuote)
        .where(StockQuote.symbol == symbol)
        .order_by(StockQuote.fetched_at.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [StockQuoteOut.model_validate(r) for r in rows]


@router.get("/latest", response_model=StockQuoteOut | None)
async def latest_quote(
    db: AsyncSession = Depends(get_db),
    symbol: str = Query("TSLA.US"),
) -> StockQuoteOut | None:
    stmt = (
        select(StockQuote)
        .where(StockQuote.symbol == symbol)
        .order_by(StockQuote.fetched_at.desc())
        .limit(1)
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    return StockQuoteOut.model_validate(row) if row else None


@candlestick_router.get("/api/candlesticks", response_model=list[CandlestickOut])
@router.get("/candlesticks", response_model=list[CandlestickOut], include_in_schema=False)
async def list_candlesticks(
    db: AsyncSession = Depends(get_db),
    symbol: str = Query("TSLA.US"),
    period: str = Query("day"),
    limit: int = Query(200, ge=1, le=5000),
) -> list[CandlestickOut]:
    period_lower = period.lower()
    stmt = (
        select(Candlestick)
        .where(Candlestick.symbol == symbol, Candlestick.period == period_lower)
        .order_by(Candlestick.ts.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [CandlestickOut.model_validate(r) for r in rows]
