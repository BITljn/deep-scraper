import asyncio
import logging
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.backtest_engine import run_backtest
from app.database import async_session, get_db
from app.models import BacktestResult

router = APIRouter(prefix="/api/backtest", tags=["backtest"])
logger = logging.getLogger(__name__)


class BacktestResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    symbol: str
    indicator_name: str
    window: str
    start_date: date
    end_date: date
    pearson_corr: Decimal | None
    spearman_corr: Decimal | None
    signal_accuracy: Decimal | None
    avg_return: Decimal | None
    sharpe_ratio: Decimal | None
    max_drawdown: Decimal | None
    total_signals: int | None
    computed_at: datetime


@router.get("/results", response_model=list[BacktestResultOut])
async def list_backtest_results(
    db: AsyncSession = Depends(get_db),
    symbol: str = Query("TSLA.US"),
    indicator_name: str | None = None,
    window: str | None = None,
) -> list[BacktestResultOut]:
    stmt = select(BacktestResult).where(BacktestResult.symbol == symbol).order_by(BacktestResult.computed_at.desc())
    if indicator_name is not None:
        stmt = stmt.where(BacktestResult.indicator_name == indicator_name)
    if window is not None:
        stmt = stmt.where(BacktestResult.window == window)
    rows = (await db.execute(stmt)).scalars().all()
    return [BacktestResultOut.model_validate(r) for r in rows]


@router.post("/run")
async def trigger_backtest() -> dict[str, str]:
    async def _job() -> None:
        async with async_session() as db:
            try:
                await run_backtest(db)
            except Exception:
                logger.exception("run_backtest task failed")

    asyncio.create_task(_job())
    return {"status": "started"}
