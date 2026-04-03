import asyncio
import logging
import time
from datetime import datetime, timezone

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.collectors.base import BaseCollector
from app.config import get_settings
from app.models.topic import Topic, TopicReply

logger = logging.getLogger(__name__)

LB_API_BASE = "https://openapi.longbridge.com"


def _get_http_client():
    from longbridge.openapi import HttpClient

    s = get_settings()
    return HttpClient(
        LB_API_BASE,
        s.LONGBRIDGE_APP_KEY,
        s.LONGBRIDGE_APP_SECRET,
        s.LONGBRIDGE_ACCESS_TOKEN,
    )


class TopicCollector(BaseCollector):
    name = "topic"

    async def collect(self, symbol: str, db: AsyncSession) -> int:
        t0 = time.monotonic()
        count = 0
        topic_count = 0
        reply_count = 0
        try:
            client = _get_http_client()

            logger.info("[topic] fetching topics for %s ...", symbol)
            data = await asyncio.to_thread(
                client.request, "GET", "/v1/content/topics/mine",
            )
            items = data.get("items", [])
            logger.info("[topic] API returned %d topics", len(items))
            topic_ids: list[str] = []

            for t in items:
                tickers = t.get("tickers", [])
                ticker_symbol = symbol.replace(".", "/")
                is_related = any(ticker_symbol in tk for tk in tickers)

                pub_at = datetime.fromtimestamp(int(t["created_at"]), tz=timezone.utc)
                stmt = pg_insert(Topic).values(
                    id=t["id"],
                    symbol=symbol if is_related else "",
                    title=t.get("title", ""),
                    description=t.get("description", ""),
                    url=t.get("detail_url", ""),
                    published_at=pub_at,
                    comments_count=t.get("comments_count", 0),
                    likes_count=t.get("likes_count", 0),
                    shares_count=t.get("shares_count", 0),
                )
                stmt = stmt.on_conflict_do_update(
                    index_elements=["id"],
                    set_={
                        "comments_count": t.get("comments_count", 0),
                        "likes_count": t.get("likes_count", 0),
                        "shares_count": t.get("shares_count", 0),
                    },
                )
                await db.execute(stmt)
                topic_ids.append(t["id"])
                topic_count += 1
                count += 1

            fetch_limit = min(len(topic_ids), 10)
            logger.info("[topic] fetching replies for %d topics ...", fetch_limit)
            for tid in topic_ids[:10]:
                try:
                    r_data = await asyncio.to_thread(
                        client.request, "GET", f"/v1/content/topics/{tid}/comments",
                    )
                    replies = r_data.get("items", [])
                    for r in replies:
                        created = datetime.fromtimestamp(int(r["created_at"]), tz=timezone.utc)
                        author = r.get("author", {})
                        stmt = pg_insert(TopicReply).values(
                            id=r["id"],
                            topic_id=tid,
                            body=r.get("body"),
                            reply_to_id=r.get("reply_to_id"),
                            author_id=author.get("member_id"),
                            author_name=author.get("name"),
                            likes_count=r.get("likes_count", 0),
                            comments_count=r.get("comments_count", 0),
                            created_at=created,
                        )
                        stmt = stmt.on_conflict_do_nothing()
                        await db.execute(stmt)
                        reply_count += 1
                        count += 1
                except Exception:
                    logger.warning("[topic] failed to fetch replies for topic %s", tid)

            await db.commit()
            elapsed = time.monotonic() - t0
            logger.info(
                "[topic] OK for %s: %d topics + %d replies = %d total in %.1fs",
                symbol, topic_count, reply_count, count, elapsed,
            )
        except Exception:
            elapsed = time.monotonic() - t0
            logger.exception(
                "[topic] FAILED for %s after %.1fs (%d records before error)",
                symbol, elapsed, count,
            )
            await db.rollback()
        return count
