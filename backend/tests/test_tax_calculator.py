from datetime import date, datetime, timezone
from decimal import Decimal

from app.analysis.tax_calculator import (
    FxBook,
    _calculate_dividends,
    _calculate_sales,
    _scheme_from_sales,
)
from app.models import TaxCashFlow, TaxExecution, TaxFxRate, TaxOrder


def _fx() -> FxBook:
    return FxBook(
        [
            TaxFxRate(rate_date=date(2026, 5, 31), currency="USD", cny_rate=Decimal("7.20")),
            TaxFxRate(rate_date=date(2026, 5, 31), currency="HKD", cny_rate=Decimal("0.92")),
        ]
    )


def _execution(trade_id: str, order_id: str, symbol: str, day: str, price: str, quantity: str) -> TaxExecution:
    return TaxExecution(
        trade_id=trade_id,
        order_id=order_id,
        symbol=symbol,
        trade_done_at=datetime.fromisoformat(day).replace(tzinfo=timezone.utc),
        price=Decimal(price),
        quantity=Decimal(quantity),
    )


def _order(order_id: str, symbol: str, side: str, quantity: str, currency: str = "USD") -> TaxOrder:
    return TaxOrder(
        order_id=order_id,
        symbol=symbol,
        side=side,
        currency=currency,
        executed_quantity=Decimal(quantity),
    )


def test_fifo_weighted_and_highest_cost_change_taxable_gain() -> None:
    executions = [
        _execution("t1", "b1", "ABC.US", "2024-01-02T10:00:00", "10", "10"),
        _execution("t2", "b2", "ABC.US", "2024-02-02T10:00:00", "20", "10"),
        _execution("t3", "s1", "ABC.US", "2025-03-02T10:00:00", "30", "10"),
    ]
    orders = {
        "b1": _order("b1", "ABC.US", "Buy", "10"),
        "b2": _order("b2", "ABC.US", "Buy", "10"),
        "s1": _order("s1", "ABC.US", "Sell", "10"),
    }

    fifo = _calculate_sales(executions, orders, {}, _fx(), 2025, "fifo", date(2026, 5, 31))
    weighted = _calculate_sales(executions, orders, {}, _fx(), 2025, "weighted_average", date(2026, 5, 31))
    highest = _calculate_sales(executions, orders, {}, _fx(), 2025, "highest_cost", date(2026, 5, 31))

    assert fifo[0].gain_cny == Decimal("1440.00")
    assert weighted[0].gain_cny == Decimal("1080.00")
    assert highest[0].gain_cny == Decimal("720.00")


def test_loss_policies_affect_taxable_gain() -> None:
    executions = [
        _execution("t1", "b1", "AAA.US", "2024-01-02T10:00:00", "10", "10"),
        _execution("t2", "s1", "AAA.US", "2025-03-02T10:00:00", "30", "10"),
        _execution("t3", "b2", "BBB.US", "2024-01-02T10:00:00", "30", "10"),
        _execution("t4", "s2", "BBB.US", "2025-03-02T10:00:00", "10", "10"),
    ]
    orders = {
        "b1": _order("b1", "AAA.US", "Buy", "10"),
        "s1": _order("s1", "AAA.US", "Sell", "10"),
        "b2": _order("b2", "BBB.US", "Buy", "10"),
        "s2": _order("s2", "BBB.US", "Sell", "10"),
    }
    sales = _calculate_sales(executions, orders, {}, _fx(), 2025, "fifo", date(2026, 5, 31))

    per_sale = _scheme_from_sales("fifo", "per_sale", sales)
    portfolio = _scheme_from_sales("fifo", "portfolio_net", sales)

    assert per_sale["capital_taxable_gain_cny"] == "1440.00"
    assert portfolio["capital_taxable_gain_cny"] == "0.00"
    assert per_sale["is_explainable"] is True
    assert portfolio["is_explainable"] is False


def test_dividend_income_and_withholding_tax_are_separated() -> None:
    flows = [
        TaxCashFlow(
            transaction_flow_name="Dividend",
            balance=Decimal("100"),
            currency="USD",
            business_time=datetime(2025, 6, 1, tzinfo=timezone.utc),
            symbol="ABC.US",
        ),
        TaxCashFlow(
            transaction_flow_name="Dividend Withholding Tax",
            balance=Decimal("-30"),
            currency="USD",
            business_time=datetime(2025, 6, 1, tzinfo=timezone.utc),
            symbol="ABC.US",
        ),
    ]

    result = _calculate_dividends(flows, _fx(), date(2026, 5, 31))

    assert result["dividend_income_cny"] == Decimal("720.00")
    assert result["dividend_tax_cny"] == Decimal("144.0000")
    assert result["foreign_tax_paid_cny"] == Decimal("216.00")
