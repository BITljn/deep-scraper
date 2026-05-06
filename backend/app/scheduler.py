import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.collectors.manager import CollectorManager
from app.config import get_settings

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()
manager = CollectorManager()


async def _collect_job(job_type: str) -> None:
    settings = get_settings()
    symbol = settings.COLLECT_SYMBOL
    try:
        job = await manager.run_job(job_type=job_type, symbol=symbol, trigger_type="scheduled")
        logger.info(
            "Scheduled [%s] finished: status=%s, records=%d",
            job_type, job.status, job.records_count,
        )
    except Exception:
        logger.exception("Scheduled [%s] job raised an exception", job_type)


async def collect_quotes() -> None:
    await _collect_job("quote")


async def collect_vix() -> None:
    await _collect_job("vix")


def start_scheduler() -> None:
    settings = get_settings()

    _jobs = [
        ("quote", collect_quotes, 5),
        ("vix", collect_vix, 5),
    ]

    registered = 0
    for name, func, interval_min in _jobs:
        if settings.is_collector_enabled(name):
            scheduler.add_job(func, "interval", minutes=interval_min, id=f"{name}_job", replace_existing=True)
            registered += 1
        else:
            logger.info("Scheduler: skipping disabled collector %s", name)

    scheduler.start()
    logger.info("Scheduler started with %d jobs", registered)


def stop_scheduler() -> None:
    scheduler.shutdown(wait=False)
    logger.info("Scheduler stopped")
