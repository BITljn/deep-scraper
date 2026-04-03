from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Boolean, DateTime, Index, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Indicator(Base):
    __tablename__ = "indicators"
    __table_args__ = (
        UniqueConstraint("symbol", "ts", "bucket_size"),
        Index("idx_indicators_lookup", "symbol", "bucket_size", "ts"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    bucket_size: Mapped[str] = mapped_column(String(10), nullable=False)

    dhi_raw: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    dhi_zscore: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))

    sps_mean: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))
    sps_std: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))
    sps_count: Mapped[int | None] = mapped_column(Integer)

    em_like_comment_ratio: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    em_share_rate: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    em_reply_depth_avg: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))

    ms_tweet_count: Mapped[int | None] = mapped_column(Integer)
    ms_sentiment: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))
    ms_tesla_mention: Mapped[bool | None] = mapped_column(Boolean)

    vix_level: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    vix_change: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    vix_regime: Mapped[str | None] = mapped_column(String(10))

    tarco_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    tarco_signal: Mapped[str | None] = mapped_column(String(10))
