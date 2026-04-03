from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Indicator

router = APIRouter(prefix="/api/indicators", tags=["indicators"])


class IndicatorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    symbol: str
    ts: datetime
    bucket_size: str
    dhi_raw: Decimal | None
    dhi_zscore: Decimal | None
    sps_mean: Decimal | None
    sps_std: Decimal | None
    sps_count: int | None
    em_like_comment_ratio: Decimal | None
    em_share_rate: Decimal | None
    em_reply_depth_avg: Decimal | None
    ms_tweet_count: int | None
    ms_sentiment: Decimal | None
    ms_tesla_mention: bool | None
    vix_level: Decimal | None
    vix_change: Decimal | None
    vix_regime: str | None
    tarco_score: Decimal | None
    tarco_signal: str | None


@router.get("/", response_model=list[IndicatorOut])
async def list_indicators(
    db: AsyncSession = Depends(get_db),
    symbol: str = Query("TSLA.US"),
    bucket_size: str = Query("1d"),
    limit: int = Query(200, ge=1, le=5000),
) -> list[IndicatorOut]:
    stmt = (
        select(Indicator)
        .where(Indicator.symbol == symbol, Indicator.bucket_size == bucket_size)
        .order_by(Indicator.ts.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [IndicatorOut.model_validate(r) for r in rows]


@router.get("/latest", response_model=IndicatorOut | None)
async def latest_indicator(
    db: AsyncSession = Depends(get_db),
    symbol: str = Query("TSLA.US"),
    bucket_size: str = Query("1d"),
) -> IndicatorOut | None:
    stmt = (
        select(Indicator)
        .where(Indicator.symbol == symbol, Indicator.bucket_size == bucket_size)
        .order_by(Indicator.ts.desc())
        .limit(1)
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    return IndicatorOut.model_validate(row) if row else None
