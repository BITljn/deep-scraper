from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, DateTime, Index, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class StockQuote(Base):
    __tablename__ = "stock_quotes"
    __table_args__ = (
        UniqueConstraint("symbol", "fetched_at"),
        Index("idx_quotes_symbol_time", "symbol", "fetched_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    last_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    open: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    high: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    low: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    volume: Mapped[int | None] = mapped_column(BigInteger)
    turnover: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    change_rate: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    market_cap: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
