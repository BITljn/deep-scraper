import json
import logging
from contextlib import aclosing
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from twscrape import API

from app.collectors.base import BaseCollector
from app.config import get_settings
from app.models.tweet import Tweet

logger = logging.getLogger(__name__)

TESLA_KEYWORDS = [
    "tesla", "tsla", "$tsla", "model s", "model 3", "model x", "model y",
    "cybertruck", "megapack", "powerwall", "fsd", "autopilot", "gigafactory",
    "supercharger",
]

_twscrape_api: API | None = None
_pool_ready = False


def _is_tesla_related(text: str) -> bool:
    lower = text.lower()
    return any(kw in lower for kw in TESLA_KEYWORDS)


async def _get_api() -> API:
    global _twscrape_api, _pool_ready

    if _twscrape_api is not None and _pool_ready:
        return _twscrape_api

    settings = get_settings()
    api = API(settings.TWSCRAPE_DB)

    accounts_cfg = json.loads(settings.TWITTER_ACCOUNTS)
    if not accounts_cfg:
        raise RuntimeError(
            "TWITTER_ACCOUNTS is empty – twscrape requires at least one X account. "
            'Set it to a JSON array, e.g. [{"username":"u1","password":"p1","email":"e1","email_password":"ep1"}]'
        )

    pool_info = await api.pool.accounts_info()
    already_added = {a["username"] for a in pool_info}
    need_login = False

    for acc in accounts_cfg:
        uname = acc["username"]
        if uname in already_added:
            continue

        cookies = acc.get("cookies", "")
        await api.pool.add_account(
            uname,
            acc.get("password", ""),
            acc.get("email", ""),
            acc.get("email_password", ""),
            cookies=cookies if cookies else None,
        )
        if cookies:
            logger.info("twscrape: added account @%s with cookies", uname)
        else:
            need_login = True
            logger.info("twscrape: added account @%s (pending login)", uname)

    if need_login:
        await api.pool.login_all()
        logger.info("twscrape: login_all completed")

    _twscrape_api = api
    _pool_ready = True
    logger.info("twscrape: account pool ready (%d accounts)", len(accounts_cfg))
    return api


class TweetCollector(BaseCollector):
    name = "tweet"

    async def collect(self, symbol: str, db: AsyncSession) -> int:
        import time

        t0 = time.monotonic()
        settings = get_settings()
        username = settings.MUSK_USERNAME
        count = 0
        skipped = 0
        fetched_total = 0

        existing_ids_result = await db.execute(
            select(Tweet.id)
            .where(Tweet.username == username)
            .order_by(Tweet.published_at.desc())
            .limit(200)
        )
        existing_ids = {row[0] for row in existing_ids_result.fetchall()}
        logger.info("[tweet] existing tweet IDs in DB: %d", len(existing_ids))

        try:
            logger.info("[tweet] initializing twscrape API ...")
            api = await _get_api()

            logger.info("[tweet] looking up user @%s ...", username)
            user = await api.user_by_login(username)
            if user is None:
                logger.error("[tweet] user @%s not found on X", username)
                return 0
            logger.info("[tweet] resolved @%s -> user_id=%s", username, user.id)

            logger.info("[tweet] fetching up to 20 tweets for user_id=%s ...", user.id)
            async with aclosing(api.user_tweets(user.id, limit=20)) as gen:
                async for tweet in gen:
                    fetched_total += 1
                    tweet_id = str(tweet.id)
                    if tweet_id in existing_ids:
                        skipped += 1
                        continue

                    text = tweet.rawContent or ""
                    pub_at = tweet.date or datetime.now(timezone.utc)
                    if pub_at.tzinfo is None:
                        pub_at = pub_at.replace(tzinfo=timezone.utc)

                    stmt = pg_insert(Tweet).values(
                        id=tweet_id,
                        username=username,
                        text=text,
                        published_at=pub_at,
                        likes_count=tweet.likeCount or 0,
                        retweets_count=tweet.retweetCount or 0,
                        replies_count=tweet.replyCount or 0,
                        is_tesla_related=_is_tesla_related(text),
                    )
                    stmt = stmt.on_conflict_do_nothing()
                    await db.execute(stmt)
                    count += 1

            await db.commit()
            elapsed = time.monotonic() - t0
            logger.info(
                "[tweet] OK for @%s: %d fetched, %d new, %d skipped (dup) in %.1fs",
                username, fetched_total, count, skipped, elapsed,
            )
        except Exception:
            elapsed = time.monotonic() - t0
            logger.exception(
                "[tweet] FAILED for @%s after %.1fs (%d fetched, %d saved before error)",
                username, elapsed, fetched_total, count,
            )
            await db.rollback()
        return count
