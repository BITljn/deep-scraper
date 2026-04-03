import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.collectors.base import BaseCollector
from app.config import get_settings
from app.models.tweet import Tweet

logger = logging.getLogger(__name__)

TESLA_KEYWORDS = [
    "tesla", "tsla", "$tsla", "model s", "model 3", "model x", "model y",
    "cybertruck", "megapack", "powerwall", "fsd", "autopilot", "gigafactory",
    "supercharger",
]


def _is_tesla_related(text: str) -> bool:
    lower = text.lower()
    return any(kw in lower for kw in TESLA_KEYWORDS)


class TweetCollector(BaseCollector):
    name = "tweet"

    async def collect(self, symbol: str, db: AsyncSession) -> int:
        settings = get_settings()
        username = settings.MUSK_USERNAME
        count = 0

        existing_ids_result = await db.execute(
            select(Tweet.id).where(Tweet.username == username).order_by(Tweet.published_at.desc()).limit(200)
        )
        existing_ids = {row[0] for row in existing_ids_result.fetchall()}

        try:
            from x_tweet_fetcher import fetch_tweets

            tweets = fetch_tweets(
                username=username,
                nitter_url=settings.NITTER_URL,
                count=30,
            )

            for t in tweets:
                tweet_id = str(t.get("id", t.get("tweet_id", "")))
                if not tweet_id or tweet_id in existing_ids:
                    continue

                text = t.get("text", "")
                pub_at = t.get("published_at") or t.get("date") or t.get("timestamp")
                if isinstance(pub_at, str):
                    try:
                        pub_at = datetime.fromisoformat(pub_at)
                    except ValueError:
                        pub_at = datetime.now(timezone.utc)
                elif isinstance(pub_at, (int, float)):
                    pub_at = datetime.fromtimestamp(pub_at, tz=timezone.utc)
                else:
                    pub_at = datetime.now(timezone.utc)

                if pub_at.tzinfo is None:
                    pub_at = pub_at.replace(tzinfo=timezone.utc)

                stmt = pg_insert(Tweet).values(
                    id=tweet_id,
                    username=username,
                    text=text,
                    published_at=pub_at,
                    likes_count=int(t.get("likes", 0) or 0),
                    retweets_count=int(t.get("retweets", 0) or 0),
                    replies_count=int(t.get("replies", 0) or 0),
                    is_tesla_related=_is_tesla_related(text),
                )
                stmt = stmt.on_conflict_do_nothing()
                await db.execute(stmt)
                count += 1

            await db.commit()
            logger.info("TweetCollector: fetched %d new tweets for @%s", count, username)
        except Exception:
            logger.exception("TweetCollector failed for @%s", username)
            await db.rollback()
        return count
