from datetime import date, datetime, timezone
from decimal import Decimal

from app.analysis.tax_calculator import (
    FxBook,
    _calculate_annual_sell_amount,
    _calculate_dividends,
    _calculate_money_market_cashflows,
    _calculate_position_quantities,
    _calculate_sales,
    _dedupe_cashflows,
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


def test_fx_book_uses_previous_year_end_rate_for_future_year_end() -> None:
    fx = FxBook(
        [
            TaxFxRate(rate_date=date(2025, 12, 31), currency="USD", cny_rate=Decimal("7.03")),
            TaxFxRate(rate_date=date(2026, 5, 31), currency="USD", cny_rate=Decimal("6.90")),
        ],
        as_of=date(2026, 5, 9),
    )

    assert fx.rate("USD", date(2026, 12, 31)) == Decimal("7.03")
    assert "USD@2026-12-31" not in fx.missing
    assert "USD@2026-12-31" in fx.estimated
    assert fx.used_dates["USD@2026-12-31"] == date(2025, 12, 31)


def test_fx_book_does_not_use_current_year_month_end_for_future_year_end() -> None:
    fx = FxBook(
        [TaxFxRate(rate_date=date(2026, 5, 31), currency="USD", cny_rate=Decimal("6.90"))],
        as_of=date(2026, 5, 9),
    )

    assert fx.rate("USD", date(2026, 12, 31)) == Decimal("0")
    assert "USD@2026-12-31" in fx.missing
    assert "USD@2026-12-31" not in fx.estimated


def test_fx_book_keeps_historical_stale_year_end_rate_missing() -> None:
    fx = FxBook(
        [TaxFxRate(rate_date=date(2025, 12, 31), currency="USD", cny_rate=Decimal("7.03"))],
        as_of=date(2027, 1, 1),
    )

    assert fx.rate("USD", date(2026, 12, 31)) == Decimal("0")
    assert "USD@2026-12-31" in fx.missing
    assert "USD@2026-12-31" not in fx.estimated


def test_fifo_lifo_weighted_and_highest_cost_change_taxable_gain() -> None:
    executions = [
        _execution("t1", "b1", "ABC.US", "2024-01-02T10:00:00", "10", "10"),
        _execution("t2", "b2", "ABC.US", "2024-02-02T10:00:00", "20", "10"),
        _execution("t3", "b3", "ABC.US", "2024-03-02T10:00:00", "5", "10"),
        _execution("t4", "s1", "ABC.US", "2025-03-02T10:00:00", "30", "10"),
    ]
    orders = {
        "b1": _order("b1", "ABC.US", "Buy", "10"),
        "b2": _order("b2", "ABC.US", "Buy", "10"),
        "b3": _order("b3", "ABC.US", "Buy", "10"),
        "s1": _order("s1", "ABC.US", "Sell", "10"),
    }

    fifo = _calculate_sales(executions, orders, {}, _fx(), 2025, "fifo", date(2026, 5, 31))
    lifo = _calculate_sales(executions, orders, {}, _fx(), 2025, "lifo", date(2026, 5, 31))
    weighted = _calculate_sales(executions, orders, {}, _fx(), 2025, "weighted_average", date(2026, 5, 31))
    highest = _calculate_sales(executions, orders, {}, _fx(), 2025, "highest_cost", date(2026, 5, 31))

    assert fifo[0].gain_cny == Decimal("1440.00")
    assert lifo[0].gain_cny == Decimal("1800.00")
    assert lifo[0].matches[0]["buy_order_id"] == "b3"
    assert weighted[0].gain_cny == Decimal("1320.00")
    assert highest[0].gain_cny == Decimal("720.00")


def test_cost_trace_includes_buy_lot_share_remaining() -> None:
    executions = [
        _execution("t1", "b1", "ABC.US", "2024-01-02T10:00:00", "10", "16"),
        _execution("t2", "s1", "ABC.US", "2025-03-02T10:00:00", "30", "8"),
    ]
    orders = {
        "b1": _order("b1", "ABC.US", "Buy", "16"),
        "s1": _order("s1", "ABC.US", "Sell", "8"),
    }

    sales = _calculate_sales(executions, orders, {}, _fx(), 2025, "fifo", date(2026, 5, 31))

    match = sales[0].matches[0]
    assert match["buy_order_id"] == "b1"
    assert match["buy_quantity"] == "16"
    assert match["matched_quantity"] == "8"
    assert match["buy_remaining_quantity"] == "8"


def test_annual_sell_amount_counts_current_year_sells_only() -> None:
    executions = [
        _execution("b1", "buy1", "ABC.US", "2025-01-02T10:00:00", "10", "10"),
        _execution("s1", "sell1", "ABC.US", "2025-03-02T10:00:00", "30", "10"),
        _execution("s2", "sell2", "ABC.US", "2024-03-02T10:00:00", "40", "10"),
    ]
    orders = {
        "buy1": _order("buy1", "ABC.US", "Buy", "10"),
        "sell1": _order("sell1", "ABC.US", "Sell", "10"),
        "sell2": _order("sell2", "ABC.US", "Sell", "10"),
    }

    amount = _calculate_annual_sell_amount(executions, orders, _fx(), 2025, date(2026, 5, 31))

    assert amount == Decimal("2160.00")


def test_option_contract_quantity_uses_100_multiplier() -> None:
    executions = [
        _execution("t1", "b1", "AMZN270115C230000.US", "2026-03-01T10:00:00", "10", "1"),
        _execution("t2", "s1", "AMZN270115C230000.US", "2026-03-02T10:00:00", "12", "1"),
    ]
    orders = {
        "b1": _order("b1", "AMZN270115C230000.US", "Buy", "1"),
        "s1": _order("s1", "AMZN270115C230000.US", "Sell", "1"),
    }

    sales = _calculate_sales(executions, orders, {}, _fx(), 2026, "fifo", date(2026, 5, 31))
    amount = _calculate_annual_sell_amount(executions, orders, _fx(), 2026, date(2026, 5, 31))

    assert sales[0].quantity == Decimal("100")
    assert sales[0].matched_quantity == Decimal("100")
    assert sales[0].proceeds_cny == Decimal("8640.00")
    assert sales[0].cost_cny == Decimal("7200.00")
    assert sales[0].gain_cny == Decimal("1440.00")
    assert amount == Decimal("8640.00")


def test_position_quantities_use_year_end_net_position_and_option_multiplier() -> None:
    executions = [
        _execution("b1", "buy1", "ABC.US", "2025-01-02T10:00:00", "10", "10"),
        _execution("s1", "sell1", "ABC.US", "2025-03-02T10:00:00", "30", "4"),
        _execution("b2", "buy2", "OPT260117C100000.US", "2025-04-02T10:00:00", "1", "1"),
        _execution("s2", "sell2", "OPT260117C100000.US", "2025-05-02T10:00:00", "2", "1"),
        _execution("b3", "buy3", "ABC.US", "2026-01-02T10:00:00", "11", "3"),
    ]
    orders = {
        "buy1": _order("buy1", "ABC.US", "Buy", "10"),
        "sell1": _order("sell1", "ABC.US", "Sell", "4"),
        "buy2": _order("buy2", "OPT260117C100000.US", "Buy", "1"),
        "sell2": _order("sell2", "OPT260117C100000.US", "Sell", "1"),
        "buy3": _order("buy3", "ABC.US", "Buy", "3"),
    }

    positions = _calculate_position_quantities(executions, orders, 2025)

    assert positions == {"ABC.US": Decimal("6")}


def test_position_quantities_can_use_all_imported_executions_for_current_position() -> None:
    executions = [
        _execution("b1", "buy1", "ABC.US", "2025-01-02T10:00:00", "10", "10"),
        _execution("s1", "sell1", "ABC.US", "2025-03-02T10:00:00", "30", "10"),
        _execution("b2", "buy2", "ABC.US", "2026-01-02T10:00:00", "11", "3"),
    ]
    orders = {
        "buy1": _order("buy1", "ABC.US", "Buy", "10"),
        "sell1": _order("sell1", "ABC.US", "Sell", "10"),
        "buy2": _order("buy2", "ABC.US", "Buy", "3"),
    }

    year_end_positions = _calculate_position_quantities(executions, orders, 2025)
    current_positions = _calculate_position_quantities(executions, orders, None)

    assert year_end_positions == {}
    assert current_positions == {"ABC.US": Decimal("3")}


def test_weighted_average_cost_trace_includes_buy_order() -> None:
    executions = [
        _execution("t1", "b1", "ABC.US", "2024-01-02T10:00:00", "10", "16"),
        _execution("t2", "s1", "ABC.US", "2025-03-02T10:00:00", "30", "8"),
    ]
    orders = {
        "b1": _order("b1", "ABC.US", "Buy", "16"),
        "s1": _order("s1", "ABC.US", "Sell", "8"),
    }

    sales = _calculate_sales(executions, orders, {}, _fx(), 2025, "weighted_average", date(2026, 5, 31))

    match = sales[0].matches[0]
    assert match["buy_order_id"] == "b1"
    assert match["buy_quantity"] == "16"
    assert match["matched_quantity"] == "8"
    assert match["buy_remaining_quantity"] == "8"


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


def test_dividend_cashflows_dedupe_and_ignore_withholding_exempt_text() -> None:
    flows = [
        TaxCashFlow(
            transaction_flow_name="Cash Dividend",
            balance=Decimal("1.00"),
            direction="Out",
            currency="USD",
            business_time=datetime(2025, 6, 1, tzinfo=timezone.utc),
            description="NVDA.US Cash Dividend: 0.01 USD per Share , Held:100",
        ),
        TaxCashFlow(
            transaction_flow_name="Cash Dividend",
            balance=Decimal("1.00"),
            direction="Out",
            currency="USD",
            business_time=datetime(2025, 6, 1, tzinfo=timezone.utc),
            description="NVDA.US Cash Dividend: 0.01 USD per Share , Held:100",
        ),
        TaxCashFlow(
            transaction_flow_name="Cash Dividend",
            balance=Decimal("32.12"),
            direction="Out",
            currency="USD",
            business_time=datetime(2025, 6, 2, tzinfo=timezone.utc),
            description="TSM Payment in Lieu of Dividend (Ordinary Div - NRA Withholding Exempt)",
        ),
        TaxCashFlow(
            transaction_flow_name="CO Other FEE",
            balance=Decimal("-0.10"),
            direction="Out",
            currency="USD",
            business_time=datetime(2025, 6, 3, tzinfo=timezone.utc),
            description="NVDA.US Cash Dividend Withholding Tax/Dividend Fee",
        ),
    ]

    result = _calculate_dividends(_dedupe_cashflows(flows), _fx(), date(2026, 5, 31))

    assert result["dividend_income_cny"] == Decimal("238.4640")
    assert result["dividend_tax_cny"] == Decimal("47.69280")
    assert result["foreign_tax_paid_cny"] == Decimal("0.72")


def test_money_market_cashflows_are_summarized_separately() -> None:
    flows = [
        TaxCashFlow(
            transaction_flow_name="Placement",
            balance=Decimal("-100"),
            currency="USD",
            business_time=datetime(2025, 6, 1, tzinfo=timezone.utc),
            description="GaoTeng WeValue USD Money Mkt A USD Acc",
        ),
        TaxCashFlow(
            transaction_flow_name="Redemption",
            balance=Decimal("105"),
            currency="USD",
            business_time=datetime(2025, 6, 2, tzinfo=timezone.utc),
            description="GaoTeng WeValue USD Money Mkt A USD Acc",
        ),
        TaxCashFlow(
            transaction_flow_name="Buy Contract - Unit Trust",
            balance=Decimal("-10"),
            currency="USD",
            business_time=datetime(2025, 6, 3, tzinfo=timezone.utc),
            description="Subscription of HK0000857299 of Taikang Kaitai US Dollar Money Mkt A USD",
        ),
    ]

    result = _calculate_money_market_cashflows(_dedupe_cashflows(flows), _fx(), date(2026, 5, 31))

    assert result["subscription_cny"] == Decimal("792.00")
    assert result["redemption_cny"] == Decimal("756.00")
    assert result["net_cashflow_cny"] == Decimal("-36.00")
    assert result["transaction_count"] == 3
