from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.collectors.quote_collector import QuoteCollector
from app.collectors.topic_collector import TopicCollector
from app.collectors.tweet_collector import TweetCollector
from app.collectors.vix_collector import VixCollector
from app.database import async_session
from app.models import CollectJob

logger = logging.getLogger(__name__)


class CollectorManager:
    """Orchestrates quote, topic, tweet, and VIX collectors."""

    def __init__(self) -> None:
        self._collectors = {
            QuoteCollector.name: QuoteCollector(),
            TopicCollector.name: TopicCollector(),
            TweetCollector.name: TweetCollector(),
            VixCollector.name: VixCollector(),
        }
        self._running_jobs: set[str] = set()

    async def collect_all(self, symbol: str, db: AsyncSession) -> dict[str, int]:
        results: dict[str, int] = {}
        for name, collector in self._collectors.items():
            try:
                count = await collector.collect(symbol, db)
                results[name] = count
            except Exception:
                logger.exception("collect_all: collector %s failed for %s", name, symbol)
                results[name] = 0
        return results

    async def collect_type(self, job_type: str, symbol: str, db: AsyncSession) -> int:
        collector = self._collectors.get(job_type)
        if collector is None:
            logger.warning("collect_type: unknown job_type %r", job_type)
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

        try:
            async with async_session() as db:
                db.add(job)
                await db.commit()
                await db.refresh(job)

                try:
                    count = await self.collect_type(job_type, symbol, db)
                    job.status = "completed"
                    job.records_count = count
                    job.completed_at = datetime.now(timezone.utc)
                    job.error_message = None
                except Exception as exc:
                    logger.exception("run_job failed: type=%s symbol=%s", job_type, symbol)
                    job.status = "failed"
                    job.completed_at = datetime.now(timezone.utc)
                    job.error_message = str(exc)[:2000]

                await db.commit()
                await db.refresh(job)
        finally:
            self._running_jobs.discard(job_type)

        return job
