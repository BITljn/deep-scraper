from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, DateTime, Numeric, String, UniqueConstraint, Index, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class VixData(Base):
    __tablename__ = "vix_data"
    __table_args__ = (
        UniqueConstraint("ts", "period"),
        Index("idx_vix_time", "ts"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    open: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    high: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    low: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    close: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    period: Mapped[str] = mapped_column(String(10), default="day")
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
