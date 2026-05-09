from datetime import date, datetime, timezone
from decimal import Decimal

from app.analysis.tax_calculator import FxBook
from app.models import TaxCashFlow, TaxFxRate
from app.routers.tax import _dividend_raw_rows


def _fx() -> FxBook:
    return FxBook([TaxFxRate(rate_date=date(2025, 12, 31), currency="USD", cny_rate=Decimal("7.03"))])


def test_dividend_raw_rows_dedupes_and_classifies_income_and_tax() -> None:
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

    rows = _dividend_raw_rows(flows, _fx(), date(2025, 12, 31))

    assert [row["kind"] for row in rows] == ["tax", "income", "income"]
    assert [row["symbol"] for row in rows] == ["NVDA.US", "TSM", "NVDA.US"]
    assert [row["amount"] for row in rows] == ["-0.10", "32.12", "1.00"]
    assert [row["cny_amount"] for row in rows] == ["0.70", "225.80", "7.03"]
