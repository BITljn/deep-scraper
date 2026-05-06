from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Date, DateTime, Index, Integer, Numeric, String
from sqlalchemy import UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class FredObservation(Base):
    __tablename__ = "fred_observations"
    __table_args__ = (
        UniqueConstraint("series_id", "observation_date"),
        Index("idx_fred_observations_lookup", "series_id", "observation_date"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    series_id: Mapped[str] = mapped_column(String(40), nullable=False)
    observation_date: Mapped[date] = mapped_column(Date, nullable=False)
    value: Mapped[Decimal] = mapped_column(Numeric(24, 6), nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )


class FredSeriesCache(Base):
    __tablename__ = "fred_series_cache"
    __table_args__ = (
        UniqueConstraint("series_id", "start_date_key"),
        Index("idx_fred_series_cache_lookup", "series_id", "start_date_key"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    series_id: Mapped[str] = mapped_column(String(40), nullable=False)
    start_date_key: Mapped[str] = mapped_column(String(16), nullable=False)
    cache_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
