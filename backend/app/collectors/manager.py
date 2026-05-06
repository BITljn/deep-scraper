from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.collectors.quote_collector import QuoteCollector
from app.collectors.vix_collector import VixCollector
from app.config import get_settings
from app.database import async_session
from app.models import CollectJob

logger = logging.getLogger(__name__)

_ALL_COLLECTORS = {
    QuoteCollector.name: QuoteCollector,
    VixCollector.name: VixCollector,
}


class CollectorManager:
    """Orchestrates quote and VIX collectors."""

    def __init__(self) -> None:
        settings = get_settings()
        self._collectors = {
            name: cls()
            for name, cls in _ALL_COLLECTORS.items()
            if settings.is_collector_enabled(name)
        }
        enabled = list(self._collectors.keys())
        logger.info("Enabled collectors: %s", enabled)
        self._running_jobs: set[str] = set()

    async def collect_all(self, symbol: str, db: AsyncSession) -> dict[str, int]:
        results: dict[str, int] = {}
        for name, collector in self._collectors.items():
            t0 = time.monotonic()
            try:
                count = await collector.collect(symbol, db)
                elapsed = time.monotonic() - t0
                results[name] = count
                logger.info(
                    "collect_all [%s] OK: %d records in %.1fs",
                    name, count, elapsed,
                )
            except Exception:
                elapsed = time.monotonic() - t0
                logger.exception(
                    "collect_all [%s] FAILED after %.1fs for %s",
                    name, elapsed, symbol,
                )
                results[name] = 0
        return results

    async def collect_type(self, job_type: str, symbol: str, db: AsyncSession) -> int:
        collector = self._collectors.get(job_type)
        if collector is None:
            logger.warning("collect_type: unknown or disabled job_type %r", job_type)
            return 0
        return await collector.collect(symbol, db)

    async def run_job(
        self,
        job_type: str,
        symbol: str,
        trigger_type: str = "manual",
    ) -> CollectJob:
        if job_type in self._running_jobs:
            raise RuntimeError(f"A job of type {job_type!r} is already running")

        self._running_jobs.add(job_type)
        now = datetime.now(timezone.utc)
        job = CollectJob(
            job_type=job_type,
            status="pending",
            trigger_type=trigger_type,
            started_at=now,
            records_count=0,
        )

        logger.info("[%s] job started (trigger=%s, symbol=%s)", job_type, trigger_type, symbol)
        t0 = time.monotonic()

        try:
            async with async_session() as db:
                db.add(job)
                await db.commit()
                await db.refresh(job)

                try:
                    count = await self.collect_type(job_type, symbol, db)
                    elapsed = time.monotonic() - t0
                    job.status = "completed"
                    job.records_count = count
                    job.completed_at = datetime.now(timezone.utc)
                    job.error_message = None
                    logger.info(
                        "[%s] job COMPLETED: %d records in %.1fs (job_id=%s)",
                        job_type, count, elapsed, job.id,
                    )
                except Exception as exc:
                    elapsed = time.monotonic() - t0
                    logger.exception(
                        "[%s] job FAILED after %.1fs: %s (job_id=%s)",
                        job_type, elapsed, exc, job.id,
                    )
                    job.status = "failed"
                    job.completed_at = datetime.now(timezone.utc)
                    job.error_message = str(exc)[:2000]

                await db.commit()
                await db.refresh(job)
        finally:
            self._running_jobs.discard(job_type)

        return job
