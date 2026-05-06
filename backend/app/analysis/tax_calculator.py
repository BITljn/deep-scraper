from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import TaxCashFlow, TaxExecution, TaxFxRate, TaxOrder, TaxOrderFee

TAX_RATE = Decimal("0.20")
ZERO = Decimal("0")
MONEY = Decimal("0.01")


@dataclass
class SaleGain:
    symbol: str
    sell_time: datetime
    sell_order_id: str
    sell_trade_id: str
    sell_price: Decimal
    currency: str
    gain_cny: Decimal
    proceeds_cny: Decimal
    cost_cny: Decimal
    fee_cny: Decimal
    quantity: Decimal
    matched_quantity: Decimal
    unmatched_quantity: Decimal
    matches: list[dict]


@dataclass
class Lot:
    quantity: Decimal
    total_cost_cny: Decimal
    buy_time: datetime
    buy_order_id: str
    buy_trade_id: str
    buy_price: Decimal
    buy_currency: str
    buy_fee_cny: Decimal

    @property
    def unit_cost(self) -> Decimal:
        if self.quantity == 0:
            return ZERO
        return self.total_cost_cny / self.quantity


def _q(v: Decimal) -> Decimal:
    return v.quantize(MONEY, rounding=ROUND_HALF_UP)


def _dec(v: Decimal | str | int | float | None) -> Decimal:
    if v is None:
        return ZERO
    return Decimal(str(v))


def _enum_value(v: object) -> str:
    raw = getattr(v, "value", v)
    raw = getattr(raw, "name", raw)
    return str(raw or "")


def _country_from_symbol(symbol: str | None) -> str:
    if not symbol:
        return "UNKNOWN"
    upper = symbol.upper()
    if upper.endswith(".US"):
        return "US"
    if upper.endswith(".HK"):
        return "HK"
    return "UNKNOWN"


def _prev_month_end(year: int, filing_month: int) -> date:
    if filing_month == 1:
        return date(year - 1, 12, 31)
    return date(year, filing_month, 1).replace(day=1) - date.resolution


def _as_utc_date(dt: datetime) -> date:
    if dt.tzinfo is None:
        return dt.date()
    return dt.astimezone(timezone.utc).date()


class FxBook:
    def __init__(self, rows: list[TaxFxRate], max_stale_days: int = 7) -> None:
        by_currency: dict[str, list[tuple[date, Decimal]]] = defaultdict(list)
        for row in rows:
            by_currency[row.currency.upper()].append((row.rate_date, row.cny_rate))
        for values in by_currency.values():
            values.sort(key=lambda item: item[0])
        self._rates = by_currency
        self.missing: set[str] = set()
        self._max_stale_days = max_stale_days

    def rate(self, currency: str | None, on_date: date) -> Decimal:
        cur = (currency or "CNY").upper()
        if cur in {"", "CNY", "CNH"}:
            return Decimal("1")
        values = self._rates.get(cur)
        if not values:
            self.missing.add(f"{cur}@{on_date.isoformat()}")
            return ZERO
        best = None
        best_date = None
        for rate_date, rate in values:
            if rate_date > on_date:
                break
            best = rate
            best_date = rate_date
        if best is None:
            self.missing.add(f"{cur}@{on_date.isoformat()}")
            return ZERO
        if best_date is None or (on_date - best_date).days > self._max_stale_days:
            self.missing.add(f"{cur}@{on_date.isoformat()}")
            return ZERO
        return best


async def build_tax_report(
    db: AsyncSession,
    year: int,
    filing_month: int,
) -> dict:
    start = datetime(year, 1, 1, tzinfo=timezone.utc)
    end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    all_start = datetime(2010, 1, 1, tzinfo=timezone.utc)

    executions = (
        await db.execute(select(TaxExecution).where(TaxExecution.trade_done_at >= all_start).order_by(TaxExecution.trade_done_at))
    ).scalars().all()
    order_ids = {item.order_id for item in executions}
    orders = {}
    fees_by_order: dict[str, Decimal] = defaultdict(Decimal)
    if order_ids:
        order_rows = (await db.execute(select(TaxOrder).where(TaxOrder.order_id.in_(order_ids)))).scalars().all()
        orders = {row.order_id: row for row in order_rows}
        fee_rows = (await db.execute(select(TaxOrderFee).where(TaxOrderFee.order_id.in_(order_ids)))).scalars().all()
        for fee in fee_rows:
            fees_by_order[fee.order_id] += abs(_dec(fee.amount))

    cashflows = (
        await db.execute(select(TaxCashFlow).where(TaxCashFlow.business_time >= start, TaxCashFlow.business_time < end))
    ).scalars().all()
    fx_rows = (await db.execute(select(TaxFxRate))).scalars().all()
    fx = FxBook(list(fx_rows))

    tax_rate_date = _prev_month_end(year + 1, filing_month)
    schemes = []
    for cost_method in ["fifo", "weighted_average", "highest_cost"]:
        sales = _calculate_sales(executions, orders, fees_by_order, fx, year, cost_method, tax_rate_date)
        for loss_policy in ["per_sale", "symbol_net", "portfolio_net"]:
            schemes.append(_scheme_from_sales(cost_method, loss_policy, sales))

    dividends = _calculate_dividends(cashflows, fx, tax_rate_date)
    for scheme in schemes:
        gross_tax = _dec(scheme["capital_tax_cny"]) + dividends["dividend_tax_cny"]
        credit_used = min(dividends["foreign_tax_paid_cny"], gross_tax)
        scheme["dividend_income_cny"] = str(_q(dividends["dividend_income_cny"]))
        scheme["dividend_tax_cny"] = str(_q(dividends["dividend_tax_cny"]))
        scheme["foreign_tax_paid_cny"] = str(_q(dividends["foreign_tax_paid_cny"]))
        scheme["foreign_tax_credit_used_cny"] = str(_q(credit_used))
        scheme["tax_due_cny"] = str(_q(max(ZERO, gross_tax - credit_used)))

    explainable = [item for item in schemes if item["is_explainable"]]
    best = min(explainable or schemes, key=lambda item: _dec(item["tax_due_cny"]), default=None)
    economic = _calculate_economic_cashflows(cashflows, fx, tax_rate_date)

    unmatched_lots = _collect_unmatched_lots(schemes)
    status = "complete" if not fx.missing and not unmatched_lots else "incomplete"
    return {
        "year": year,
        "filing_month": filing_month,
        "status": status,
        "tax_rate": str(TAX_RATE),
        "tax_fx_rate_date": tax_rate_date.isoformat(),
        "missing_fx_rates": sorted(fx.missing)[:200],
        "unmatched_cost_lots": unmatched_lots,
        "best_scheme_key": best["scheme_key"] if best else None,
        "best_scheme": best,
        "schemes": schemes,
        "dividends": {k: str(_q(v)) if isinstance(v, Decimal) else v for k, v in dividends.items()},
        "economic_fx": {k: str(_q(v)) if isinstance(v, Decimal) else v for k, v in economic.items()},
        "raw_counts": {
            "executions": len([e for e in executions if start <= e.trade_done_at < end]),
            "cash_flows": len(cashflows),
            "orders": len(orders),
        },
        "notes": [
            "CRS is an information exchange regime, not a separate tax. This report estimates China individual income tax for overseas securities income.",
            "Tax schemes marked explainable are used when selecting the recommended lowest-tax result. Aggressive schemes need professional confirmation.",
            "Economic FX impact is shown separately and is not deducted from taxable income by default.",
        ],
    }


def _execution_fee_cny(
    execution: TaxExecution,
    order: TaxOrder | None,
    fees_by_order: dict[str, Decimal],
    fx: FxBook,
    tax_rate_date: date,
) -> Decimal:
    total_fee = fees_by_order.get(execution.order_id, ZERO)
    if total_fee == 0:
        return ZERO
    executed_qty = _dec(order.executed_quantity) if order else ZERO
    ratio = execution.quantity / executed_qty if executed_qty > 0 else Decimal("1")
    currency = order.currency if order else None
    return total_fee * ratio * fx.rate(currency, tax_rate_date)


def _calculate_sales(
    executions: list[TaxExecution],
    orders: dict[str, TaxOrder],
    fees_by_order: dict[str, Decimal],
    fx: FxBook,
    year: int,
    cost_method: str,
    tax_rate_date: date,
) -> list[SaleGain]:
    start = datetime(year, 1, 1, tzinfo=timezone.utc)
    end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    lots: dict[str, deque[Lot]] = defaultdict(deque)
    weighted_qty: dict[str, Decimal] = defaultdict(Decimal)
    weighted_cost: dict[str, Decimal] = defaultdict(Decimal)
    sales: list[SaleGain] = []

    for execution in executions:
        order = orders.get(execution.order_id)
        side = _enum_value(order.side if order else execution.raw.get("side") if execution.raw else "").lower()
        currency = (order.currency if order else None) or "USD"
        rate = fx.rate(currency, tax_rate_date)
        fee_cny = _execution_fee_cny(execution, order, fees_by_order, fx, tax_rate_date)
        gross_cny = execution.price * execution.quantity * rate

        if "buy" in side:
            total_cost = gross_cny + fee_cny
            if cost_method == "weighted_average":
                weighted_qty[execution.symbol] += execution.quantity
                weighted_cost[execution.symbol] += total_cost
            else:
                lots[execution.symbol].append(
                    Lot(
                        quantity=execution.quantity,
                        total_cost_cny=total_cost,
                        buy_time=execution.trade_done_at,
                        buy_order_id=execution.order_id,
                        buy_trade_id=execution.trade_id,
                        buy_price=execution.price,
                        buy_currency=currency,
                        buy_fee_cny=fee_cny,
                    )
                )
            continue

        if "sell" not in side:
            continue

        proceeds_cny = gross_cny - fee_cny
        matches: list[dict] = []
        if cost_method == "weighted_average":
            cost_cny, matched_quantity = _consume_weighted(execution.symbol, execution.quantity, weighted_qty, weighted_cost)
        else:
            cost_cny, matched_quantity, matches = _consume_lots(
                lots[execution.symbol],
                execution.quantity,
                highest_cost=cost_method == "highest_cost",
            )
        if start <= execution.trade_done_at < end:
            matched_ratio = matched_quantity / execution.quantity if execution.quantity > 0 else ZERO
            matched_proceeds = proceeds_cny * matched_ratio
            matched_fee = fee_cny * matched_ratio
            sales.append(
                SaleGain(
                    symbol=execution.symbol,
                    sell_time=execution.trade_done_at,
                    sell_order_id=execution.order_id,
                    sell_trade_id=execution.trade_id,
                    sell_price=execution.price,
                    currency=currency,
                    gain_cny=matched_proceeds - cost_cny,
                    proceeds_cny=matched_proceeds,
                    cost_cny=cost_cny,
                    fee_cny=matched_fee,
                    quantity=execution.quantity,
                    matched_quantity=matched_quantity,
                    unmatched_quantity=max(ZERO, execution.quantity - matched_quantity),
                    matches=matches,
                )
            )
    return sales


def _consume_weighted(
    symbol: str,
    quantity: Decimal,
    weighted_qty: dict[str, Decimal],
    weighted_cost: dict[str, Decimal],
) -> tuple[Decimal, Decimal]:
    qty = weighted_qty[symbol]
    if qty <= 0:
        return ZERO, ZERO
    sell_qty = min(quantity, qty)
    cost = weighted_cost[symbol] * sell_qty / qty
    weighted_qty[symbol] -= sell_qty
    weighted_cost[symbol] -= cost
    return cost, sell_qty


def _consume_lots(lots: deque[Lot], quantity: Decimal, highest_cost: bool) -> tuple[Decimal, Decimal, list[dict]]:
    remaining = quantity
    cost = ZERO
    matched = ZERO
    matches: list[dict] = []
    if highest_cost:
        ordered = sorted(list(lots), key=lambda lot: lot.unit_cost, reverse=True)
        lots.clear()
        lots.extend(ordered)
    while remaining > 0 and lots:
        lot = lots[0]
        take = min(remaining, lot.quantity)
        unit = lot.unit_cost
        match_cost = take * unit
        cost += match_cost
        matched += take
        matches.append(
            {
                "buy_time": lot.buy_time.isoformat(),
                "buy_order_id": lot.buy_order_id,
                "buy_trade_id": lot.buy_trade_id,
                "buy_price": str(lot.buy_price),
                "buy_currency": lot.buy_currency,
                "matched_quantity": str(take),
                "unit_cost_cny": str(_q(unit)),
                "matched_cost_cny": str(_q(match_cost)),
                "buy_fee_cny": str(_q(lot.buy_fee_cny)),
            }
        )
        lot.quantity -= take
        lot.total_cost_cny -= match_cost
        remaining -= take
        if lot.quantity <= 0:
            lots.popleft()
    return cost, matched, matches


def _scheme_from_sales(cost_method: str, loss_policy: str, sales: list[SaleGain]) -> dict:
    gains = [sale.gain_cny for sale in sales]
    by_symbol: dict[str, Decimal] = defaultdict(Decimal)
    for sale in sales:
        by_symbol[sale.symbol] += sale.gain_cny

    if loss_policy == "per_sale":
        taxable_gain = sum((max(gain, ZERO) for gain in gains), ZERO)
    elif loss_policy == "symbol_net":
        taxable_gain = sum((max(gain, ZERO) for gain in by_symbol.values()), ZERO)
    else:
        taxable_gain = max(sum(gains, ZERO), ZERO)

    is_explainable = cost_method in {"fifo", "weighted_average"} and loss_policy == "per_sale"
    risk_level = "standard" if is_explainable else "needs_review"
    if cost_method == "highest_cost" or loss_policy != "per_sale":
        risk_level = "aggressive"

    return {
        "scheme_key": f"{cost_method}:{loss_policy}",
        "cost_method": cost_method,
        "loss_policy": loss_policy,
        "risk_level": risk_level,
        "is_explainable": is_explainable,
        "capital_proceeds_cny": str(_q(sum((sale.proceeds_cny for sale in sales), ZERO))),
        "capital_cost_cny": str(_q(sum((sale.cost_cny for sale in sales), ZERO))),
        "capital_fees_cny": str(_q(sum((sale.fee_cny for sale in sales), ZERO))),
        "capital_realized_gain_cny": str(_q(sum(gains, ZERO))),
        "capital_taxable_gain_cny": str(_q(taxable_gain)),
        "capital_tax_cny": str(_q(taxable_gain * TAX_RATE)),
        "sale_count": len(sales),
        "matched_sale_quantity": str(sum((sale.matched_quantity for sale in sales), ZERO)),
        "unmatched_sale_quantity": str(sum((sale.unmatched_quantity for sale in sales), ZERO)),
        "unmatched_sale_symbols": sorted({sale.symbol for sale in sales if sale.unmatched_quantity > 0}),
        "cost_trace": _cost_trace_from_sales(sales),
    }


def _cost_trace_from_sales(sales: list[SaleGain]) -> list[dict]:
    out = []
    for index, sale in enumerate(sales, start=1):
        out.append(
            {
                "index": index,
                "symbol": sale.symbol,
                "sell_time": sale.sell_time.isoformat(),
                "sell_order_id": sale.sell_order_id,
                "sell_trade_id": sale.sell_trade_id,
                "sell_price": str(sale.sell_price),
                "currency": sale.currency,
                "sell_quantity": str(sale.quantity),
                "matched_quantity": str(sale.matched_quantity),
                "unmatched_quantity": str(sale.unmatched_quantity),
                "proceeds_cny": str(_q(sale.proceeds_cny)),
                "cost_cny": str(_q(sale.cost_cny)),
                "gain_cny": str(_q(sale.gain_cny)),
                "matches": sale.matches,
            }
        )
    return out


def _collect_unmatched_lots(schemes: list[dict]) -> list[dict]:
    for scheme in schemes:
        if scheme.get("cost_method") == "fifo" and scheme.get("loss_policy") == "per_sale":
            return [
                {"symbol": symbol, "quantity": scheme.get("unmatched_sale_quantity", "0")}
                for symbol in scheme.get("unmatched_sale_symbols", [])
            ]
    return []


def _cashflow_signed_amount(flow: TaxCashFlow) -> Decimal:
    amount = _dec(flow.balance)
    direction = str(flow.direction or "").lower()
    if direction in {"1", "out", "cashflowdirection.out"} and amount > 0:
        return -amount
    if direction in {"2", "in", "cashflowdirection.in"} and amount < 0:
        return -amount
    return amount


def _calculate_dividends(cashflows: list[TaxCashFlow], fx: FxBook, tax_rate_date: date) -> dict[str, Decimal | dict]:
    dividend_income = ZERO
    foreign_tax_paid = ZERO
    by_country: dict[str, Decimal] = defaultdict(Decimal)
    for flow in cashflows:
        label = f"{flow.transaction_flow_name} {flow.description or ''}".lower()
        amount = _cashflow_signed_amount(flow)
        amount_cny = abs(amount) * fx.rate(flow.currency, tax_rate_date)
        if any(token in label for token in ["dividend", "股息", "分红", "派息"]):
            if amount > 0:
                dividend_income += amount_cny
                by_country[_country_from_symbol(flow.symbol)] += amount_cny
            elif any(token in label for token in ["tax", "withholding", "withheld", "税", "预扣"]):
                foreign_tax_paid += amount_cny
        elif any(token in label for token in ["withholding tax", "dividend tax", "股息税", "预扣税"]):
            foreign_tax_paid += amount_cny

    return {
        "dividend_income_cny": dividend_income,
        "dividend_tax_cny": dividend_income * TAX_RATE,
        "foreign_tax_paid_cny": foreign_tax_paid,
        "dividend_income_by_country": {k: str(_q(v)) for k, v in sorted(by_country.items())},
    }


def _calculate_economic_cashflows(cashflows: list[TaxCashFlow], fx: FxBook, tax_rate_date: date) -> dict[str, Decimal | int]:
    event_value = ZERO
    filing_value = ZERO
    count = 0
    for flow in cashflows:
        amount = _cashflow_signed_amount(flow)
        event_rate = fx.rate(flow.currency, _as_utc_date(flow.business_time))
        filing_rate = fx.rate(flow.currency, tax_rate_date)
        event_value += amount * event_rate
        filing_value += amount * filing_rate
        count += 1
    return {
        "event_date_cash_value_cny": event_value,
        "filing_basis_cash_value_cny": filing_value,
        "observable_fx_effect_cny": event_value - filing_value,
        "observable_cash_flow_count": count,
    }
