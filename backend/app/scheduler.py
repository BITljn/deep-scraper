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


async def collect_topics() -> None:
    await _collect_job("topic")


async def collect_tweets() -> None:
    await _collect_job("tweet")


async def collect_vix() -> None:
    await _collect_job("vix")


async def compute_indicators_job() -> None:
    from app.analysis.indicator_engine import compute_all_buckets
    from app.analysis.sentiment_analyzer import SentimentAnalyzer
    from app.database import async_session

    settings = get_settings()
    symbol = settings.COLLECT_SYMBOL
    logger.info("Scheduled indicator computation for %s", symbol)
    try:
        async with async_session() as db:
            await SentimentAnalyzer.analyze_unscored(db)
            await compute_all_buckets(symbol, "1h", hours_back=4, db=db)
            await compute_all_buckets(symbol, "1d", hours_back=48, db=db)
        logger.info("Indicator computation complete for %s", symbol)
    except Exception:
        logger.exception("Indicator computation failed")


def start_scheduler() -> None:
    settings = get_settings()

    _jobs = [
        ("quote", collect_quotes, 5),
        ("topic", collect_topics, 30),
        ("tweet", collect_tweets, 10),
        ("vix", collect_vix, 5),
    ]

    registered = 0
    for name, func, interval_min in _jobs:
        if settings.is_collector_enabled(name):
            scheduler.add_job(func, "interval", minutes=interval_min, id=f"{name}_job", replace_existing=True)
            registered += 1
        else:
            logger.info("Scheduler: skipping disabled collector %s", name)

    scheduler.add_job(compute_indicators_job, "interval", minutes=15, id="indicator_job", replace_existing=True)
    registered += 1

    scheduler.start()
    logger.info("Scheduler started with %d jobs", registered)


def stop_scheduler() -> None:
    scheduler.shutdown(wait=False)
    logger.info("Scheduler stopped")
