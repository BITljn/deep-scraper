from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Date, DateTime, Index, Integer, JSON, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class TaxExecution(Base):
    __tablename__ = "tax_executions"
    __table_args__ = (
        UniqueConstraint("trade_id"),
        Index("idx_tax_executions_time", "trade_done_at"),
        Index("idx_tax_executions_symbol_time", "symbol", "trade_done_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    trade_id: Mapped[str] = mapped_column(String(128), nullable=False)
    order_id: Mapped[str] = mapped_column(String(128), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    trade_done_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(24, 8), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(24, 8), nullable=False)
    raw: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class TaxOrder(Base):
    __tablename__ = "tax_orders"
    __table_args__ = (
        UniqueConstraint("order_id"),
        Index("idx_tax_orders_symbol_time", "symbol", "submitted_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    order_id: Mapped[str] = mapped_column(String(128), nullable=False)
    symbol: Mapped[str | None] = mapped_column(String(32))
    side: Mapped[str | None] = mapped_column(String(20))
    status: Mapped[str | None] = mapped_column(String(40))
    currency: Mapped[str | None] = mapped_column(String(8))
    executed_price: Mapped[Decimal | None] = mapped_column(Numeric(24, 8))
    executed_quantity: Mapped[Decimal | None] = mapped_column(Numeric(24, 8))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    raw: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_row_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class TaxOrderFee(Base):
    __tablename__ = "tax_order_fees"
    __table_args__ = (
        UniqueConstraint("order_id", "fee_code", "fee_name", "currency"),
        Index("idx_tax_order_fees_order", "order_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    order_id: Mapped[str] = mapped_column(String(128), nullable=False)
    fee_code: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    fee_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="")
    amount: Mapped[Decimal] = mapped_column(Numeric(24, 8), nullable=False)
    raw: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TaxCashFlow(Base):
    __tablename__ = "tax_cash_flows"
    __table_args__ = (
        UniqueConstraint("business_time", "transaction_flow_name", "balance", "currency", "symbol", "description"),
        Index("idx_tax_cash_flows_time", "business_time"),
        Index("idx_tax_cash_flows_symbol_time", "symbol", "business_time"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    transaction_flow_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    direction: Mapped[str | None] = mapped_column(String(20))
    business_type: Mapped[str | None] = mapped_column(String(20))
    balance: Mapped[Decimal] = mapped_column(Numeric(24, 8), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False)
    business_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    symbol: Mapped[str | None] = mapped_column(String(32))
    description: Mapped[str | None] = mapped_column(Text)
    raw: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TaxFxRate(Base):
    __tablename__ = "tax_fx_rates"
    __table_args__ = (
        UniqueConstraint("rate_date", "currency"),
        Index("idx_tax_fx_rates_currency_date", "currency", "rate_date"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    rate_date: Mapped[date] = mapped_column(Date, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False)
    cny_rate: Mapped[Decimal] = mapped_column(Numeric(24, 8), nullable=False)
    source: Mapped[str] = mapped_column(String(80), nullable=False, default="manual")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TaxReportSnapshot(Base):
    __tablename__ = "tax_report_snapshots"
    __table_args__ = (UniqueConstraint("tax_year", "filing_month"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tax_year: Mapped[int] = mapped_column(Integer, nullable=False)
    filing_month: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    best_scheme_key: Mapped[str | None] = mapped_column(String(80))
    report: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
