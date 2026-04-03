from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Indicator, SentimentScore

router = APIRouter(prefix="/api/sentiment", tags=["sentiment"])


class SentimentScoreOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source_type: str
    source_id: str
    text_snippet: str | None
    score: Decimal
    label: str
    model_version: str | None
    computed_at: datetime


class SentimentBucketSummary(BaseModel):
    ts: datetime
    sps_mean: Decimal | None
    sps_std: Decimal | None
    sps_count: int | None


@router.get("/scores", response_model=list[SentimentScoreOut])
async def list_scores(
    db: AsyncSession = Depends(get_db),
    source_type: str | None = None,
    limit: int = Query(50, ge=1, le=2000),
) -> list[SentimentScoreOut]:
    stmt = select(SentimentScore).order_by(SentimentScore.computed_at.desc()).limit(limit)
    if source_type is not None:
        stmt = stmt.where(SentimentScore.source_type == source_type)
    rows = (await db.execute(stmt)).scalars().all()
    return [SentimentScoreOut.model_validate(r) for r in rows]


@router.get("/summary", response_model=list[SentimentBucketSummary])
async def sentiment_summary(
    db: AsyncSession = Depends(get_db),
    symbol: str = Query("TSLA.US"),
    bucket_size: str = Query("1d"),
    limit: int = Query(500, ge=1, le=5000),
) -> list[SentimentBucketSummary]:
    stmt = (
        select(Indicator)
        .where(Indicator.symbol == symbol, Indicator.bucket_size == bucket_size)
        .order_by(Indicator.ts.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [
        SentimentBucketSummary(
            ts=r.ts,
            sps_mean=r.sps_mean,
            sps_std=r.sps_std,
            sps_count=r.sps_count,
        )
        for r in rows
    ]
