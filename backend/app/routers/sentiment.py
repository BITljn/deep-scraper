from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Indicator, SentimentScore, Topic, TopicReply, Tweet

router = APIRouter(prefix="/api/sentiment", tags=["sentiment"])


class SentimentScoreOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source_type: str
    source_id: str
    text_snippet: str | None
    score: Decimal
    label: str
    model_version: str | None
    computed_at: datetime


class SentimentBucketSummary(BaseModel):
    ts: datetime
    sps_mean: Decimal | None
    sps_std: Decimal | None
    sps_count: int | None


class SentimentComment(BaseModel):
    id: int
    source_type: str
    source_id: str
    score: float
    label: str
    title: str
    body: str
    author: str | None
    published_at: str | None
    likes_count: int
    comments_count: int
    computed_at: str


class SentimentCommentsResponse(BaseModel):
    total: int
    items: list[SentimentComment]


@router.get("/scores", response_model=list[SentimentScoreOut])
async def list_scores(
    db: AsyncSession = Depends(get_db),
    source_type: str | None = None,
    limit: int = Query(50, ge=1, le=2000),
) -> list[SentimentScoreOut]:
    stmt = select(SentimentScore).order_by(SentimentScore.computed_at.desc()).limit(limit)
    if source_type is not None:
        stmt = stmt.where(SentimentScore.source_type == source_type)
    rows = (await db.execute(stmt)).scalars().all()
    return [SentimentScoreOut.model_validate(r) for r in rows]


@router.get("/summary", response_model=list[SentimentBucketSummary])
async def sentiment_summary(
    db: AsyncSession = Depends(get_db),
    symbol: str = Query("TSLA.US"),
    bucket_size: str = Query("1d"),
    limit: int = Query(500, ge=1, le=5000),
) -> list[SentimentBucketSummary]:
    stmt = (
        select(Indicator)
        .where(Indicator.symbol == symbol, Indicator.bucket_size == bucket_size)
        .order_by(Indicator.ts.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [
        SentimentBucketSummary(
            ts=r.ts,
            sps_mean=r.sps_mean,
            sps_std=r.sps_std,
            sps_count=r.sps_count,
        )
        for r in rows
    ]


@router.get("/comments", response_model=SentimentCommentsResponse)
async def list_comments(
    db: AsyncSession = Depends(get_db),
    source_type: str | None = None,
    label: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> SentimentCommentsResponse:
    """Return sentiment scores enriched with full source text from topics /
    topic_replies / tweets.  Supports filtering by source_type and label."""

    base_where = []
    if source_type is not None:
        base_where.append(SentimentScore.source_type == source_type)
    if label is not None:
        base_where.append(SentimentScore.label == label)

    count_stmt = select(func.count()).select_from(SentimentScore)
    for w in base_where:
        count_stmt = count_stmt.where(w)
    total: int = (await db.execute(count_stmt)).scalar_one()

    stmt = (
        select(SentimentScore)
        .where(*base_where)
        .order_by(SentimentScore.computed_at.desc())
        .offset(offset)
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()

    topic_ids = [r.source_id for r in rows if r.source_type == "topic"]
    reply_ids = [r.source_id for r in rows if r.source_type == "topic_reply"]
    tweet_ids = [r.source_id for r in rows if r.source_type == "tweet"]

    topics_map: dict[str, Topic] = {}
    if topic_ids:
        t_rows = (await db.execute(select(Topic).where(Topic.id.in_(topic_ids)))).scalars().all()
        topics_map = {t.id: t for t in t_rows}

    replies_map: dict[str, TopicReply] = {}
    if reply_ids:
        r_rows = (await db.execute(select(TopicReply).where(TopicReply.id.in_(reply_ids)))).scalars().all()
        replies_map = {r.id: r for r in r_rows}

    tweets_map: dict[str, Tweet] = {}
    if tweet_ids:
        tw_rows = (await db.execute(select(Tweet).where(Tweet.id.in_(tweet_ids)))).scalars().all()
        tweets_map = {t.id: t for t in tw_rows}

    items: list[SentimentComment] = []
    for r in rows:
        title = ""
        body = r.text_snippet or ""
        author: str | None = None
        published_at: str | None = None
        likes = 0
        comments = 0

        if r.source_type == "topic":
            t = topics_map.get(r.source_id)
            if t:
                title = t.title or ""
                body = t.description or t.title or ""
                published_at = t.published_at.isoformat() if t.published_at else None
                likes = t.likes_count or 0
                comments = t.comments_count or 0
        elif r.source_type == "topic_reply":
            rp = replies_map.get(r.source_id)
            if rp:
                title = f"回复 by {rp.author_name or 'anonymous'}"
                body = rp.body or ""
                author = rp.author_name
                published_at = rp.created_at.isoformat() if rp.created_at else None
                likes = rp.likes_count or 0
                comments = rp.comments_count or 0
        elif r.source_type == "tweet":
            tw = tweets_map.get(r.source_id)
            if tw:
                title = f"@{tw.username}"
                body = tw.text or ""
                author = tw.username
                published_at = tw.published_at.isoformat() if tw.published_at else None
                likes = tw.likes_count or 0
                comments = tw.replies_count or 0

        if not title:
            title = r.text_snippet[:60] if r.text_snippet else f"{r.source_type} #{r.source_id}"

        items.append(SentimentComment(
            id=r.id,
            source_type=r.source_type,
            source_id=r.source_id,
            score=float(r.score),
            label=r.label,
            title=title,
            body=body,
            author=author,
            published_at=published_at,
            likes_count=likes,
            comments_count=comments,
            computed_at=r.computed_at.isoformat() if r.computed_at else "",
        ))

    return SentimentCommentsResponse(total=total, items=items)
