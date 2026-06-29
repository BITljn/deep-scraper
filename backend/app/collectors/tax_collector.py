from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.collectors.base import BaseCollector
from app.config import get_settings
from app.longbridge_config import get_longbridge_config
from app.models import TaxCashFlow, TaxExecution, TaxOrder, TaxOrderFee

logger = logging.getLogger(__name__)


def _get_lb_config():
    return get_longbridge_config()


def _dec(val) -> Decimal:
    if val in (None, ""):
        return Decimal("0")
    return Decimal(str(val))


def _ts(val) -> datetime | None:
    if val in (None, "", "0", 0):
        return None
    if isinstance(val, datetime):
        return val.replace(tzinfo=timezone.utc) if val.tzinfo is None else val.astimezone(timezone.utc)
    if isinstance(val, str) and any(sep in val for sep in ["-", "T", ":"]):
        ts = datetime.fromisoformat(val.replace("Z", "+00:00"))
        return ts.replace(tzinfo=timezone.utc) if ts.tzinfo is None else ts.astimezone(timezone.utc)
    return datetime.fromtimestamp(int(str(val)), tz=timezone.utc)


def _enum(val) -> str | None:
    if val is None:
        return None
    raw = getattr(val, "value", val)
    raw = getattr(raw, "name", raw)
    return _short_enum(raw)


def _short_enum(val) -> str | None:
    if val is None:
        return None
    text = str(val)
    if "." in text:
        text = text.rsplit(".", 1)[-1]
    if len(text) > 40:
        text = text[:40]
    return text


def _raw(obj, fields: Iterable[str]) -> dict:
    out = {}
    for field in fields:
        value = getattr(obj, field, None)
        if isinstance(value, Decimal):
            out[field] = str(value)
        elif isinstance(value, datetime):
            out[field] = value.isoformat()
        elif isinstance(value, list):
            out[field] = [str(item) for item in value]
        else:
            out[field] = _enum(value) if not isinstance(value, (str, int, float, bool, type(None))) else value
    return out


def _items(resp, key: str) -> list:
    if resp is None:
        return []
    if isinstance(resp, list):
        return resp
    value = getattr(resp, key, None)
    if value is not None:
        return list(value)
    if isinstance(resp, dict):
        data = resp.get("data", resp)
        return list(data.get(key, data.get("list", [])))
    return []


def _read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def _cache_has_rows(path: Path) -> bool:
    for name in ["orders.jsonl", "executions.jsonl", "cashflows.jsonl", "order_details.jsonl"]:
        file_path = path / name
        if file_path.exists() and file_path.stat().st_size > 0:
            return _cache_looks_structured(path)
    return False


def _cache_looks_structured(path: Path) -> bool:
    scalar_checks = {
        "orders.jsonl": ["side", "status", "order_type", "currency"],
        "cashflows.jsonl": ["direction", "business_type", "currency"],
        "order_details.jsonl": ["side", "status", "currency"],
    }
    for filename, fields in scalar_checks.items():
        rows = _read_jsonl(path / filename)
        if not rows:
            continue
        row = rows[0]
        for field in fields:
            value = row.get(field)
            if isinstance(value, (dict, list)):
                logger.warning("[tax] skipping cache %s because %s.%s is not scalar", path, filename, field)
                return False
    return True


def _is_executed_order_quantity(quantity) -> bool:
    return _dec(quantity) > 0


class TaxCollector(BaseCollector):
    name = "tax"

    def __init__(self) -> None:
        settings = get_settings()
        self._request_interval = max(0.0, settings.LONGBRIDGE_TAX_REQUEST_INTERVAL_SECONDS)
        self._detail_interval = max(self._request_interval, settings.LONGBRIDGE_TAX_ORDER_DETAIL_INTERVAL_SECONDS)
        self._max_retries = max(1, settings.LONGBRIDGE_TAX_MAX_RETRIES)
        self._backoff_seconds = max(0.5, settings.LONGBRIDGE_TAX_BACKOFF_SECONDS)
        self._cache_enabled = settings.LONGBRIDGE_TAX_CACHE_ENABLED
        self._cache_dir = Path(settings.LONGBRIDGE_TAX_CACHE_DIR)
        self._last_request_at = 0.0
        self._last_detail_at = 0.0

    async def collect(self, symbol: str, db: AsyncSession) -> int:
        settings = get_settings()
        symbols = [s.strip() for s in settings.LONGBRIDGE_TAX_SYMBOLS.split(",") if s.strip()]
        if not symbols and symbol and symbol.upper() not in {"ALL", "__ALL__"}:
            symbols = [symbol]
        return await self.collect_range(
            db=db,
            start_year=settings.LONGBRIDGE_TAX_START_YEAR,
            end_year=datetime.now(timezone.utc).year,
            symbols=symbols,
        )

    async def _pace(self, detail: bool = False) -> None:
        now = time.monotonic()
        request_wait = self._request_interval - (now - self._last_request_at)
        detail_wait = self._detail_interval - (now - self._last_detail_at) if detail else 0.0
        wait = max(request_wait, detail_wait)
        if wait > 0:
            await asyncio.sleep(wait)
        now = time.monotonic()
        self._last_request_at = now
        if detail:
            self._last_detail_at = now

    async def _sdk_call(self, label: str, func, *args, detail: bool = False, **kwargs):
        for attempt in range(1, self._max_retries + 1):
            await self._pace(detail=detail)
            try:
                return func(*args, **kwargs)
            except Exception as exc:
                message = str(exc)
                is_limited = "429002" in message or "429001" in message or "request is limited" in message.lower()
                if not is_limited or attempt >= self._max_retries:
                    raise
                sleep_for = self._backoff_seconds * (2 ** (attempt - 1))
                logger.warning(
                    "[tax] rate limited on %s (attempt %d/%d), sleeping %.1fs",
                    label,
                    attempt,
                    self._max_retries,
                    sleep_for,
                )
                await asyncio.sleep(sleep_for)

    async def collect_range(
        self,
        db: AsyncSession,
        start_year: int,
        end_year: int,
        symbols: list[str] | None = None,
    ) -> int:
        t0 = time.monotonic()
        cache_count = await self._collect_from_cache(db, start_year, end_year, symbols)
        if cache_count is not None:
            elapsed = time.monotonic() - t0
            logger.info("[tax] loaded %d records from local cache in %.1fs", cache_count, elapsed)
            return cache_count

        from longbridge.openapi import TradeContext

        ctx = TradeContext(_get_lb_config())
        count = 0
        query_symbols = symbols or [None]
        start = datetime(start_year, 1, 1, tzinfo=timezone.utc)
        end = datetime(end_year + 1, 1, 1, tzinfo=timezone.utc)

        cursor = start
        while cursor < end:
            window_end = min(cursor + timedelta(days=90), end)
            for sym in query_symbols:
                count += await self._collect_orders(ctx, db, sym, cursor, window_end)
                count += await self._collect_executions(ctx, db, sym, cursor, window_end)
            count += await self._collect_cashflows(ctx, db, cursor, window_end)
            await db.commit()
            cursor = window_end

        elapsed = time.monotonic() - t0
        logger.info("[tax] OK: %d records upserted in %.1fs", count, elapsed)
        return count

    async def _collect_from_cache(
        self,
        db: AsyncSession,
        start_year: int,
        end_year: int,
        symbols: list[str] | None,
    ) -> int | None:
        if not self._cache_enabled:
            return None
        cache_dir = self._cache_dir
        if not cache_dir.is_absolute():
            cache_dir = Path.cwd() / cache_dir
        candidates = self._cache_candidates(cache_dir, start_year, end_year, symbols)
        existing = [path for path in candidates if path.exists() and _cache_has_rows(path)]
        if not existing:
            return None

        total = 0
        for path in existing:
            logger.info("[tax] loading Longbridge tax cache from %s", path)
            total += await self._load_cache_dir(db, path)
        await db.commit()
        return total

    def _cache_candidates(
        self,
        cache_dir: Path,
        start_year: int,
        end_year: int,
        symbols: list[str] | None,
    ) -> list[Path]:
        symbol_label = "all"
        if symbols:
            symbol_label = "_".join(symbols).replace(".", "-")
        candidates = [
            cache_dir / f"{start_year}_{end_year}_{symbol_label}",
            cache_dir / f"{start_year}_{end_year}_all",
            cache_dir / f"{start_year}0101_{end_year + 1}0101_{symbol_label}",
            cache_dir / f"{start_year}0101_{end_year + 1}0101_all",
        ]
        return list(dict.fromkeys(candidates))

    async def _load_cache_dir(self, db: AsyncSession, path: Path) -> int:
        count = 0
        for row in _read_jsonl(path / "orders.jsonl"):
            count += await self._upsert_cached_order(db, row)
        for row in _read_jsonl(path / "executions.jsonl"):
            count += await self._upsert_cached_execution(db, row)
        for row in _read_jsonl(path / "cashflows.jsonl"):
            count += await self._upsert_cached_cashflow(db, row)
        for row in _read_jsonl(path / "order_details.jsonl"):
            count += await self._upsert_cached_order_detail(db, row)
        return count

    async def _upsert_cached_order(self, db: AsyncSession, row: dict) -> int:
        order_id = str(row.get("order_id") or "")
        if not order_id:
            return 0
        if not _is_executed_order_quantity(row.get("executed_quantity")):
            return 0
        stmt = pg_insert(TaxOrder).values(
            order_id=order_id,
            symbol=row.get("symbol"),
            side=_short_enum(row.get("side")),
            status=_short_enum(row.get("status")),
            currency=row.get("currency"),
            executed_price=_dec(row.get("executed_price")),
            executed_quantity=_dec(row.get("executed_quantity")),
            submitted_at=_ts(row.get("submitted_at")),
            updated_at=_ts(row.get("updated_at")),
            raw=row,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["order_id"],
            set_={
                "symbol": stmt.excluded.symbol,
                "side": stmt.excluded.side,
                "status": stmt.excluded.status,
                "currency": stmt.excluded.currency,
                "executed_price": stmt.excluded.executed_price,
                "executed_quantity": stmt.excluded.executed_quantity,
                "submitted_at": stmt.excluded.submitted_at,
                "updated_at": stmt.excluded.updated_at,
                "raw": stmt.excluded.raw,
            },
        )
        await db.execute(stmt)
        return 1

    async def _upsert_cached_execution(self, db: AsyncSession, row: dict) -> int:
        trade_id = str(row.get("trade_id") or "")
        order_id = str(row.get("order_id") or "")
        symbol = str(row.get("symbol") or "")
        if not trade_id or not order_id or not symbol:
            return 0
        stmt = pg_insert(TaxExecution).values(
            trade_id=trade_id,
            order_id=order_id,
            symbol=symbol,
            trade_done_at=_ts(row.get("trade_done_at")),
            price=_dec(row.get("price")),
            quantity=_dec(row.get("quantity")),
            raw=row,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["trade_id"],
            set_={
                "order_id": stmt.excluded.order_id,
                "symbol": stmt.excluded.symbol,
                "trade_done_at": stmt.excluded.trade_done_at,
                "price": stmt.excluded.price,
                "quantity": stmt.excluded.quantity,
                "raw": stmt.excluded.raw,
            },
        )
        await db.execute(stmt)
        return 1

    async def _upsert_cached_cashflow(self, db: AsyncSession, row: dict) -> int:
        stmt = pg_insert(TaxCashFlow).values(
            transaction_flow_name=str(row.get("transaction_flow_name") or ""),
            direction=_short_enum(row.get("direction")),
            business_type=_short_enum(row.get("business_type")),
            balance=_dec(row.get("balance")),
            currency=str(row.get("currency") or ""),
            business_time=_ts(row.get("business_time")),
            symbol=row.get("symbol"),
            description=row.get("description"),
            raw=row,
        )
        stmt = stmt.on_conflict_do_nothing()
        await db.execute(stmt)
        return 1

    async def _upsert_cached_order_detail(self, db: AsyncSession, row: dict) -> int:
        order_id = str(row.get("order_id") or "")
        if not order_id:
            return 0
        count = 0
        charge_detail = row.get("charge_detail") or {}
        for item in charge_detail.get("items") or []:
            item_name = str(item.get("name") or "")
            for fee in item.get("fees") or []:
                code = str(fee.get("code") or item.get("code") or "")
                name = str(fee.get("name") or item_name)
                currency = str(fee.get("currency") or charge_detail.get("currency") or "")
                amount = abs(_dec(fee.get("amount")))
                stmt = pg_insert(TaxOrderFee).values(
                    order_id=order_id,
                    fee_code=code,
                    fee_name=name,
                    currency=currency,
                    amount=amount,
                    raw={"item_name": item_name, **fee},
                )
                stmt = stmt.on_conflict_do_update(
                    index_elements=["order_id", "fee_code", "fee_name", "currency"],
                    set_={"amount": stmt.excluded.amount, "raw": stmt.excluded.raw},
                )
                await db.execute(stmt)
                count += 1
        return count

    async def _collect_executions(self, ctx, db: AsyncSession, symbol: str | None, start: datetime, end: datetime) -> int:
        resp = await self._sdk_call(
            "history_executions",
            ctx.history_executions,
            symbol=symbol,
            start_at=start,
            end_at=end,
        )
        rows = _items(resp, "trades")
        count = 0
        for item in rows:
            stmt = pg_insert(TaxExecution).values(
                trade_id=str(getattr(item, "trade_id")),
                order_id=str(getattr(item, "order_id")),
                symbol=str(getattr(item, "symbol")),
                trade_done_at=_ts(getattr(item, "trade_done_at")),
                price=_dec(getattr(item, "price")),
                quantity=_dec(getattr(item, "quantity")),
                raw=_raw(item, ["order_id", "trade_id", "symbol", "trade_done_at", "quantity", "price"]),
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["trade_id"],
                set_={
                    "order_id": stmt.excluded.order_id,
                    "symbol": stmt.excluded.symbol,
                    "trade_done_at": stmt.excluded.trade_done_at,
                    "price": stmt.excluded.price,
                    "quantity": stmt.excluded.quantity,
                    "raw": stmt.excluded.raw,
                },
            )
            await db.execute(stmt)
            count += 1
        return count

    async def _collect_orders(self, ctx, db: AsyncSession, symbol: str | None, start: datetime, end: datetime) -> int:
        resp = await self._sdk_call(
            "history_orders",
            ctx.history_orders,
            symbol=symbol,
            start_at=start,
            end_at=end,
        )
        rows = _items(resp, "orders")
        count = 0
        for item in rows:
            if not _is_executed_order_quantity(getattr(item, "executed_quantity", None)):
                continue
            order_id = str(getattr(item, "order_id"))
            raw = _raw(
                item,
                [
                    "order_id",
                    "status",
                    "stock_name",
                    "quantity",
                    "executed_quantity",
                    "price",
                    "executed_price",
                    "submitted_at",
                    "side",
                    "symbol",
                    "order_type",
                    "currency",
                    "updated_at",
                ],
            )
            stmt = pg_insert(TaxOrder).values(
                order_id=order_id,
                symbol=getattr(item, "symbol", None),
                side=_enum(getattr(item, "side", None)),
                status=_enum(getattr(item, "status", None)),
                currency=getattr(item, "currency", None),
                executed_price=_dec(getattr(item, "executed_price", None)),
                executed_quantity=_dec(getattr(item, "executed_quantity", None)),
                submitted_at=_ts(getattr(item, "submitted_at", None)),
                updated_at=_ts(getattr(item, "updated_at", None)),
                raw=raw,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["order_id"],
                set_={
                    "symbol": stmt.excluded.symbol,
                    "side": stmt.excluded.side,
                    "status": stmt.excluded.status,
                    "currency": stmt.excluded.currency,
                    "executed_price": stmt.excluded.executed_price,
                    "executed_quantity": stmt.excluded.executed_quantity,
                    "submitted_at": stmt.excluded.submitted_at,
                    "updated_at": stmt.excluded.updated_at,
                    "raw": stmt.excluded.raw,
                },
            )
            await db.execute(stmt)
            count += 1
            count += await self._collect_order_fees(ctx, db, order_id)
        return count

    async def _collect_order_fees(self, ctx, db: AsyncSession, order_id: str) -> int:
        existing_fee = (
            await db.execute(select(TaxOrderFee.id).where(TaxOrderFee.order_id == order_id).limit(1))
        ).scalar_one_or_none()
        if existing_fee is not None:
            return 0
        try:
            detail = await self._sdk_call("order_detail", ctx.order_detail, order_id, detail=True)
        except Exception:
            logger.exception("[tax] failed to fetch order detail for %s", order_id)
            return 0
        charge_detail = getattr(detail, "charge_detail", None)
        items = getattr(charge_detail, "items", None) or []
        count = 0
        for item in items:
            item_name = str(getattr(item, "name", "") or "")
            for fee in getattr(item, "fees", None) or []:
                code = str(getattr(fee, "code", "") or getattr(item, "code", "") or "")
                name = str(getattr(fee, "name", "") or item_name)
                currency = str(getattr(fee, "currency", "") or getattr(charge_detail, "currency", "") or "")
                amount = abs(_dec(getattr(fee, "amount", None)))
                stmt = pg_insert(TaxOrderFee).values(
                    order_id=order_id,
                    fee_code=code,
                    fee_name=name,
                    currency=currency,
                    amount=amount,
                    raw={"item_name": item_name, "code": code, "name": name, "currency": currency, "amount": str(amount)},
                )
                stmt = stmt.on_conflict_do_update(
                    index_elements=["order_id", "fee_code", "fee_name", "currency"],
                    set_={"amount": stmt.excluded.amount, "raw": stmt.excluded.raw},
                )
                await db.execute(stmt)
                count += 1
        return count

    async def _collect_cashflows(self, ctx, db: AsyncSession, start: datetime, end: datetime) -> int:
        page = 1
        size = 1000
        count = 0
        while True:
            resp = await self._sdk_call(
                "cash_flow",
                ctx.cash_flow,
                start_at=start,
                end_at=end,
                page=page,
                size=size,
            )
            rows = _items(resp, "list")
            if not rows:
                break
            for item in rows:
                stmt = pg_insert(TaxCashFlow).values(
                    transaction_flow_name=str(getattr(item, "transaction_flow_name", "") or ""),
                    direction=_enum(getattr(item, "direction", None)),
                    business_type=_enum(getattr(item, "business_type", None)),
                    balance=_dec(getattr(item, "balance", None)),
                    currency=str(getattr(item, "currency", "") or ""),
                    business_time=_ts(getattr(item, "business_time", None)),
                    symbol=getattr(item, "symbol", None),
                    description=getattr(item, "description", None),
                    raw=_raw(
                        item,
                        [
                            "transaction_flow_name",
                            "direction",
                            "business_type",
                            "balance",
                            "currency",
                            "business_time",
                            "symbol",
                            "description",
                        ],
                    ),
                )
                stmt = stmt.on_conflict_do_nothing()
                await db.execute(stmt)
                count += 1
            if len(rows) < size:
                break
            page += 1
        return count
