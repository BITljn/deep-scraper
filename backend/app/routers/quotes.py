from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Candlestick

router = APIRouter(prefix="/api/quotes", tags=["quotes"])
candlestick_router = APIRouter(tags=["candlesticks"])


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
