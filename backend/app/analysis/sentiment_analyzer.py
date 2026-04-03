"""Sentiment analysis for text sources (implement scoring pipeline as needed)."""

from sqlalchemy.ext.asyncio import AsyncSession


class SentimentAnalyzer:
    async def analyze_unscored(self, db: AsyncSession) -> None:
        """Find and score records that lack SentimentScore rows."""
        _ = db
