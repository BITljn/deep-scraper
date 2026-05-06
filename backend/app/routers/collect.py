import asyncio
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.collectors.manager import CollectorManager
from app.database import get_db
from app.models import CollectJob

router = APIRouter(prefix="/api/collect", tags=["collect"])
logger = logging.getLogger(__name__)

_manager = CollectorManager()


class CollectBody(BaseModel):
    job_type: str
    symbol: str = "TSLA.US"


class CollectJobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_type: str
    status: str
    trigger_type: str
    started_at: datetime | None = None
    completed_at: datetime | None = None
    records_count: int
    error_message: str | None = None
    created_at: datetime


class CollectCreateResponse(BaseModel):
    id: int | None = None
    status: str
    job_type: str


async def _run_in_background(job_type: str, symbol: str) -> None:
    try:
        await _manager.run_job(job_type=job_type, symbol=symbol, trigger_type="manual")
    except Exception:
        logger.exception("Background collect job failed: %s", job_type)


@router.post("/", response_model=CollectCreateResponse)
async def create_collect_job(body: CollectBody) -> CollectCreateResponse:
    if body.job_type == "all":
        for jt in ["quote", "vix"]:
            asyncio.create_task(_run_in_background(jt, body.symbol))
    else:
        asyncio.create_task(_run_in_background(body.job_type, body.symbol))
    return CollectCreateResponse(status="pending", job_type=body.job_type)


@router.get("/jobs", response_model=list[CollectJobOut])
async def list_jobs(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(10, ge=1, le=500),
) -> list[CollectJobOut]:
    stmt = select(CollectJob).order_by(CollectJob.created_at.desc()).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    return [CollectJobOut.model_validate(r) for r in rows]


@router.get("/jobs/{job_id}", response_model=CollectJobOut)
async def get_job(job_id: int, db: AsyncSession = Depends(get_db)) -> CollectJobOut:
    stmt = select(CollectJob).where(CollectJob.id == job_id)
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return CollectJobOut.model_validate(row)
