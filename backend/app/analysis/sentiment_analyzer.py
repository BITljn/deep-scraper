"""Sentiment analysis for Longbridge topics / replies and tweets.

Uses SnowNLP for Chinese text sentiment scoring. Scores are mapped from
SnowNLP's native [0, 1] range to [-1, 1] so downstream indicators treat
positive/negative symmetrically.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal

from snownlp import SnowNLP
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sentiment import SentimentScore
from app.models.topic import Topic, TopicReply
from app.models.tweet import Tweet

logger = logging.getLogger(__name__)

MODEL_VERSION = "snownlp-v1"
BATCH_SIZE = 200


def _score_text(text: str) -> tuple[Decimal, str]:
    """Return (score, label) for a piece of text.

    SnowNLP.sentiments -> [0, 1]  (1 = most positive)
    We map to [-1, 1]:  mapped = raw * 2 - 1
    """
    raw = SnowNLP(text).sentiments  # 0..1
    mapped = raw * 2.0 - 1.0
    score = Decimal(str(round(mapped, 4)))

    if mapped > 0.3:
        label = "positive"
    elif mapped < -0.3:
        label = "negative"
    else:
        label = "neutral"
    return score, label


def _truncate(text: str, max_len: int = 200) -> str:
    return text[:max_len] if len(text) > max_len else text


class SentimentAnalyzer:
    @staticmethod
    async def analyze_unscored(db: AsyncSession) -> int:
        """Find topics, topic_replies and tweets that lack SentimentScore rows,
        run sentiment analysis on their text, and persist the results.

        Returns the number of new scores written.
        """
        total = 0
        total += await _score_topics(db)
        total += await _score_topic_replies(db)
        total += await _score_tweets(db)
        if total:
            logger.info("[sentiment] scored %d new records", total)
        return total


async def _score_topics(db: AsyncSession) -> int:
    scored_subq = (
        select(SentimentScore.source_id)
        .where(
            SentimentScore.source_type == "topic",
            SentimentScore.model_version == MODEL_VERSION,
        )
        .correlate(None)
    )

    rows = (
        await db.execute(
            select(Topic.id, Topic.title, Topic.description)
            .where(~Topic.id.in_(scored_subq))
            .order_by(Topic.published_at.desc())
            .limit(BATCH_SIZE)
        )
    ).all()

    count = 0
    for topic_id, title, description in rows:
        text = (title or "") + " " + (description or "")
        text = text.strip()
        if not text:
            continue
        try:
            score, label = _score_text(text)
        except Exception:
            logger.debug("[sentiment] skip topic %s — scoring failed", topic_id)
            continue

        stmt = pg_insert(SentimentScore).values(
            source_type="topic",
            source_id=topic_id,
            text_snippet=_truncate(text),
            score=score,
            label=label,
            model_version=MODEL_VERSION,
            computed_at=datetime.now(timezone.utc),
        ).on_conflict_do_nothing()
        await db.execute(stmt)
        count += 1

    if count:
        await db.commit()
        logger.info("[sentiment] scored %d topics", count)
    return count


async def _score_topic_replies(db: AsyncSession) -> int:
    scored_subq = (
        select(SentimentScore.source_id)
        .where(
            SentimentScore.source_type == "topic_reply",
            SentimentScore.model_version == MODEL_VERSION,
        )
        .correlate(None)
    )

    rows = (
        await db.execute(
            select(TopicReply.id, TopicReply.body)
            .where(~TopicReply.id.in_(scored_subq))
            .order_by(TopicReply.created_at.desc())
            .limit(BATCH_SIZE)
        )
    ).all()

    count = 0
    for reply_id, body in rows:
        text = (body or "").strip()
        if not text:
            continue
        try:
            score, label = _score_text(text)
        except Exception:
            logger.debug("[sentiment] skip reply %s — scoring failed", reply_id)
            continue

        stmt = pg_insert(SentimentScore).values(
            source_type="topic_reply",
            source_id=reply_id,
            text_snippet=_truncate(text),
            score=score,
            label=label,
            model_version=MODEL_VERSION,
            computed_at=datetime.now(timezone.utc),
        ).on_conflict_do_nothing()
        await db.execute(stmt)
        count += 1

    if count:
        await db.commit()
        logger.info("[sentiment] scored %d topic replies", count)
    return count


async def _score_tweets(db: AsyncSession) -> int:
    scored_subq = (
        select(SentimentScore.source_id)
        .where(
            SentimentScore.source_type == "tweet",
            SentimentScore.model_version == MODEL_VERSION,
        )
        .correlate(None)
    )

    rows = (
        await db.execute(
            select(Tweet.id, Tweet.text)
            .where(~Tweet.id.in_(scored_subq))
            .order_by(Tweet.published_at.desc())
            .limit(BATCH_SIZE)
        )
    ).all()

    count = 0
    for tweet_id, text in rows:
        text = (text or "").strip()
        if not text:
            continue
        try:
            score, label = _score_text(text)
        except Exception:
            logger.debug("[sentiment] skip tweet %s — scoring failed", tweet_id)
            continue

        stmt = pg_insert(SentimentScore).values(
            source_type="tweet",
            source_id=str(tweet_id),
            text_snippet=_truncate(text),
            score=score,
            label=label,
            model_version=MODEL_VERSION,
            computed_at=datetime.now(timezone.utc),
        ).on_conflict_do_nothing()
        await db.execute(stmt)
        count += 1

    if count:
        await db.commit()
        logger.info("[sentiment] scored %d tweets", count)
    return count
