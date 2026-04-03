from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import VixData

router = APIRouter(prefix="/api/vix", tags=["vix"])


class VixDataOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ts: datetime
    open: Decimal | None
    high: Decimal | None
    low: Decimal | None
    close: Decimal | None
    period: str
    fetched_at: datetime


@router.get("/", response_model=list[VixDataOut])
async def list_vix(
    db: AsyncSession = Depends(get_db),
    period: str = Query("day"),
    limit: int = Query(100, ge=1, le=5000),
) -> list[VixDataOut]:
    stmt = (
        select(VixData)
        .where(VixData.period == period)
        .order_by(VixData.ts.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [VixDataOut.model_validate(r) for r in rows]


@router.get("/latest", response_model=VixDataOut | None)
async def latest_vix(
    db: AsyncSession = Depends(get_db),
    period: str = Query("day"),
) -> VixDataOut | None:
    stmt = (
        select(VixData)
        .where(VixData.period == period)
        .order_by(VixData.ts.desc())
        .limit(1)
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    return VixDataOut.model_validate(row) if row else None
