import logging
from datetime import datetime, timezone

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.collectors.base import BaseCollector
from app.config import get_settings
from app.models.topic import Topic, TopicReply

logger = logging.getLogger(__name__)


def _get_lb_config():
    s = get_settings()
    from longbridge.openapi import Config

    return Config(
        app_key=s.LONGBRIDGE_APP_KEY,
        app_secret=s.LONGBRIDGE_APP_SECRET,
        access_token=s.LONGBRIDGE_ACCESS_TOKEN,
    )


class TopicCollector(BaseCollector):
    name = "topic"

    async def collect(self, symbol: str, db: AsyncSession) -> int:
        count = 0
        try:
            from longbridge.openapi import ContentContext

            config = _get_lb_config()
            ctx = ContentContext(config)

            topics = ctx.topics(symbol)
            topic_ids: list[str] = []

            for t in topics:
                pub_at = datetime.fromtimestamp(int(t.published_at), tz=timezone.utc)
                stmt = pg_insert(Topic).values(
                    id=t.id,
                    symbol=symbol,
                    title=t.title,
                    description=getattr(t, "description", None),
                    url=getattr(t, "url", None),
                    published_at=pub_at,
                    comments_count=t.comments_count,
                    likes_count=t.likes_count,
                    shares_count=t.shares_count,
                )
                stmt = stmt.on_conflict_do_update(
                    index_elements=["id"],
                    set_={
                        "comments_count": t.comments_count,
                        "likes_count": t.likes_count,
                        "shares_count": t.shares_count,
                    },
                )
                await db.execute(stmt)
                topic_ids.append(t.id)
                count += 1

            for tid in topic_ids[:10]:
                try:
                    replies = ctx.list_topic_replies(tid, page=1, size=50)
                    for r in replies:
                        created = datetime.fromtimestamp(int(r.created_at), tz=timezone.utc)
                        author = getattr(r, "author", None)
                        stmt = pg_insert(TopicReply).values(
                            id=r.id,
                            topic_id=tid,
                            body=getattr(r, "body", None),
                            reply_to_id=getattr(r, "reply_to_id", None),
                            author_id=author.member_id if author else None,
                            author_name=author.name if author else None,
                            likes_count=getattr(r, "likes_count", 0),
                            comments_count=getattr(r, "comments_count", 0),
                            created_at=created,
                        )
                        stmt = stmt.on_conflict_do_nothing()
                        await db.execute(stmt)
                        count += 1
                except Exception:
                    logger.warning("Failed to fetch replies for topic %s", tid)

            await db.commit()
            logger.info("TopicCollector: fetched %d records for %s", count, symbol)
        except Exception:
            logger.exception("TopicCollector failed for %s", symbol)
            await db.rollback()
        return count
