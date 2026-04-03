from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import SentimentScore, Tweet

router = APIRouter(prefix="/api/tweets", tags=["tweets"])


class TweetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    username: str
    text: str
    published_at: datetime
    likes_count: int
    retweets_count: int
    replies_count: int
    is_tesla_related: bool
    fetched_at: datetime
    sentiment_score: float | None = None
    sentiment_label: str | None = None


@router.get("/", response_model=list[TweetOut])
async def list_tweets(
    db: AsyncSession = Depends(get_db),
    username: str = Query("elonmusk"),
    limit: int = Query(50, ge=1, le=500),
    tesla_only: bool | None = None,
) -> list[TweetOut]:
    max_ca = (
        select(
            SentimentScore.source_id.label("sid"),
            func.max(SentimentScore.computed_at).label("max_ca"),
        )
        .where(SentimentScore.source_type == "tweet")
        .group_by(SentimentScore.source_id)
    ).subquery()

    stmt = (
        select(Tweet, SentimentScore.score, SentimentScore.label)
        .outerjoin(max_ca, max_ca.c.sid == Tweet.id)
        .outerjoin(
            SentimentScore,
            (SentimentScore.source_id == Tweet.id)
            & (SentimentScore.source_type == "tweet")
            & (SentimentScore.computed_at == max_ca.c.max_ca),
        )
        .where(Tweet.username == username)
    )
    if tesla_only is True:
        stmt = stmt.where(Tweet.is_tesla_related.is_(True))
    elif tesla_only is False:
        stmt = stmt.where(Tweet.is_tesla_related.is_(False))
    stmt = stmt.order_by(Tweet.published_at.desc()).limit(limit)

    result = await db.execute(stmt)
    out: list[TweetOut] = []
    for row in result.all():
        tweet, score, label = row[0], row[1], row[2]
        out.append(
            TweetOut(
                id=tweet.id,
                username=tweet.username,
                text=tweet.text,
                published_at=tweet.published_at,
                likes_count=tweet.likes_count,
                retweets_count=tweet.retweets_count,
                replies_count=tweet.replies_count,
                is_tesla_related=tweet.is_tesla_related,
                fetched_at=tweet.fetched_at,
                sentiment_score=float(score) if score is not None else None,
                sentiment_label=label,
            )
        )
    return out
