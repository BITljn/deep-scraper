#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
CACHE_ROOT = ROOT / ".cache" / "longbridge_tax_sdk"
DEFAULT_ORDER_FIELDS = [
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
]
DEFAULT_EXECUTION_FIELDS = ["order_id", "trade_id", "symbol", "trade_done_at", "quantity", "price"]
DEFAULT_CASHFLOW_FIELDS = [
    "transaction_flow_name",
    "direction",
    "business_type",
    "balance",
    "currency",
    "business_time",
    "symbol",
    "description",
]
DEFAULT_DETAIL_FIELDS = [
    "order_id",
    "status",
    "quantity",
    "executed_quantity",
    "executed_price",
    "side",
    "symbol",
    "currency",
    "charge_detail",
]


@dataclass
class RateLimit:
    request_interval: float
    detail_interval: float
    backoff_seconds: float
    max_retries: int
    last_request_at: float = 0.0
    last_detail_at: float = 0.0

    def wait(self, detail: bool = False) -> None:
        now = time.monotonic()
        request_wait = self.request_interval - (now - self.last_request_at)
        detail_wait = self.detail_interval - (now - self.last_detail_at) if detail else 0.0
        sleep_for = max(request_wait, detail_wait)
        if sleep_for > 0:
            time.sleep(sleep_for)
        now = time.monotonic()
        self.last_request_at = now
        if detail:
            self.last_detail_at = now

    def call(self, label: str, func: Callable[..., Any], *args: Any, detail: bool = False, **kwargs: Any) -> Any:
        for attempt in range(1, self.max_retries + 1):
            self.wait(detail=detail)
            try:
                return func(*args, **kwargs)
            except Exception as exc:
                message = str(exc)
                limited = "429001" in message or "429002" in message or "request is limited" in message.lower()
                if not limited or attempt >= self.max_retries:
                    raise
                sleep_for = self.backoff_seconds * (2 ** (attempt - 1))
                print(
                    f"[rate-limit] {label} hit limit attempt={attempt}/{self.max_retries}; sleep={sleep_for:.1f}s",
                    file=sys.stderr,
                )
                time.sleep(sleep_for)


def scalar(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    raw = getattr(value, "value", None)
    if raw is not None and raw is not value and isinstance(raw, (str, int, float, bool)):
        return normalize_enum(raw)
    return normalize_enum(value)


def normalize_enum(value: Any) -> str:
    text = str(value)
    if "." in text:
        text = text.rsplit(".", 1)[-1]
    return text


def encode(value: Any, depth: int = 0, seen: set[int] | None = None) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if depth > 4:
        return str(value)
    seen = seen or set()
    obj_id = id(value)
    if obj_id in seen:
        return str(value)
    seen.add(obj_id)
    if isinstance(value, list):
        return [encode(item, depth + 1, seen) for item in value]
    if isinstance(value, tuple):
        return [encode(item, depth + 1, seen) for item in value]
    if isinstance(value, dict):
        return {str(key): encode(val, depth + 1, seen) for key, val in value.items()}

    raw = getattr(value, "value", None)
    if raw is not None and raw is not value:
        encoded_raw = encode(raw, depth + 1, seen)
        return encoded_raw if encoded_raw not in ({}, []) else str(value)

    fields = [name for name in dir(value) if not name.startswith("_")]
    out: dict[str, Any] = {}
    for field in fields:
        try:
            attr = getattr(value, field)
        except Exception:
            continue
        if callable(attr):
            continue
        out[field] = encode(attr, depth + 1, seen)
    return out or str(value)


def encode_charge_detail(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    items = []
    for item in getattr(value, "items", None) or []:
        fees = []
        for fee in getattr(item, "fees", None) or []:
            fees.append(
                {
                    "code": scalar(getattr(fee, "code", None)),
                    "name": scalar(getattr(fee, "name", None)),
                    "amount": scalar(getattr(fee, "amount", None)),
                    "currency": scalar(getattr(fee, "currency", None)),
                }
            )
        items.append(
            {
                "code": scalar(getattr(item, "code", None)),
                "name": scalar(getattr(item, "name", None)),
                "fees": fees,
            }
        )
    return {
        "total_amount": scalar(getattr(value, "total_amount", None)),
        "currency": scalar(getattr(value, "currency", None)),
        "items": items,
    }


def shallow_object(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool, Decimal, date, datetime)):
        return scalar(value)
    if isinstance(value, dict):
        return {str(key): shallow_object(val) for key, val in value.items()}
    if isinstance(value, (list, tuple)):
        return [shallow_object(item) for item in value]
    out = {}
    for field in dir(value):
        if field.startswith("_"):
            continue
        try:
            attr = getattr(value, field)
        except Exception:
            continue
        if callable(attr):
            continue
        out[field] = scalar(attr)
    return out or scalar(value)


def compact_object(obj: Any, preferred_fields: list[str]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for field in preferred_fields:
        if not hasattr(obj, field):
            continue
        value = getattr(obj, field)
        out[field] = encode_charge_detail(value) if field == "charge_detail" else scalar(value)

    extras = {}
    for field in dir(obj):
        if field.startswith("_") or field in out:
            continue
        try:
            value = getattr(obj, field)
        except Exception:
            continue
        if callable(value):
            continue
        if isinstance(value, list):
            extras[field] = [shallow_object(item) for item in value[:20]]
        elif field == "charge_detail":
            extras[field] = encode_charge_detail(value)
        else:
            extras[field] = scalar(value)
    out["_extra"] = extras
    return out or {"value": scalar(obj)}


def iter_items(resp: Any, key: str) -> list[Any]:
    if resp is None:
        return []
    if isinstance(resp, list):
        return resp
    value = getattr(resp, key, None)
    if value is not None:
        return list(value)
    encoded = encode(resp)
    if isinstance(encoded, dict):
        data = encoded.get("data", encoded)
        if isinstance(data, dict):
            value = data.get(key, data.get("list", []))
            return list(value or [])
    return []


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False, sort_keys=True))
            fh.write("\n")


def append_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False, sort_keys=True))
            fh.write("\n")


def load_existing_ids(path: Path, key: str) -> set[str]:
    return {str(row.get(key)) for row in read_jsonl(path) if row.get(key) not in (None, "")}


def parse_symbols(raw: str | None) -> list[str | None]:
    if not raw:
        return [None]
    symbols = [part.strip() for part in raw.split(",") if part.strip()]
    return symbols or [None]


def executed_quantity(row: dict[str, Any]) -> Decimal:
    return Decimal(str(row.get("executed_quantity") or "0"))


def log(message: str) -> None:
    print(message, flush=True)


def parse_date(value: str) -> datetime:
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


def window_range(args: argparse.Namespace) -> list[tuple[datetime, datetime]]:
    start = parse_date(args.start_date) if args.start_date else datetime(args.start_year, 1, 1, tzinfo=timezone.utc)
    end = parse_date(args.end_date) if args.end_date else datetime(args.end_year + 1, 1, 1, tzinfo=timezone.utc)
    windows = []
    cursor = start
    while cursor < end:
        window_end = min(cursor + timedelta(days=args.window_days), end)
        windows.append((cursor, window_end))
        if args.max_windows and len(windows) >= args.max_windows:
            break
        cursor = window_end
    return windows


def cache_dir(args: argparse.Namespace) -> Path:
    symbol_label = "all" if not args.symbols else args.symbols.replace(",", "_").replace(".", "-")
    if args.start_date or args.end_date:
        start_label = (args.start_date or str(args.start_year)).replace("-", "")
        end_label = (args.end_date or str(args.end_year)).replace("-", "")
        return Path(args.cache_dir) / f"{start_label}_{end_label}_{symbol_label}"
    return Path(args.cache_dir) / f"{args.start_year}_{args.end_year}_{symbol_label}"


def sdk_config():
    from longbridge.openapi import Config

    load_dotenv(ROOT / ".env")
    app_key = os.environ.get("LONGBRIDGE_APP_KEY", "")
    app_secret = os.environ.get("LONGBRIDGE_APP_SECRET", "")
    access_token = os.environ.get("LONGBRIDGE_ACCESS_TOKEN", "")
    if not app_key or not app_secret or not access_token:
        raise RuntimeError("Missing LONGBRIDGE_APP_KEY/LONGBRIDGE_APP_SECRET/LONGBRIDGE_ACCESS_TOKEN in backend/.env")
    return Config.from_apikey(app_key=app_key, app_secret=app_secret, access_token=access_token)


def fetch(args: argparse.Namespace) -> None:
    out_dir = cache_dir(args)
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = {
        "orders": out_dir / "orders.jsonl",
        "executions": out_dir / "executions.jsonl",
        "cashflows": out_dir / "cashflows.jsonl",
        "order_details": out_dir / "order_details.jsonl",
    }
    if not args.force_refresh and all(path.exists() for path in paths.values()):
        log(f"[cache] existing cache found at {out_dir}")
        summarize_dir(out_dir)
        return

    if args.force_refresh:
        for path in paths.values():
            if path.exists():
                path.unlink()

    from longbridge.openapi import TradeContext

    ctx = TradeContext(sdk_config())
    limiter = RateLimit(
        request_interval=args.request_interval,
        detail_interval=max(args.request_interval, args.detail_interval),
        backoff_seconds=args.backoff_seconds,
        max_retries=args.max_retries,
    )
    order_ids_seen = load_existing_ids(paths["orders"], "order_id")
    execution_ids_seen = load_existing_ids(paths["executions"], "trade_id")
    detail_ids_seen = load_existing_ids(paths["order_details"], "order_id")
    cashflow_keys_seen = {
        json.dumps(
            [
                row.get("business_time"),
                row.get("transaction_flow_name"),
                row.get("balance"),
                row.get("currency"),
                row.get("symbol"),
                row.get("description"),
            ],
            ensure_ascii=False,
        )
        for row in read_jsonl(paths["cashflows"])
    }

    detail_count = len(detail_ids_seen)
    for start_at, end_at in window_range(args):
        log(f"[window] {start_at.date()} -> {end_at.date()}")
        for symbol in parse_symbols(args.symbols):
            log(f"  calling history_orders symbol={symbol or '*'}")
            orders = iter_items(
                limiter.call(
                    "history_orders",
                    ctx.history_orders,
                    symbol=symbol,
                    start_at=start_at,
                    end_at=end_at,
                ),
                "orders",
            )
            order_rows = []
            for item in orders:
                row = compact_object(item, DEFAULT_ORDER_FIELDS)
                order_id = str(row.get("order_id") or "")
                if not order_id or order_id in order_ids_seen or executed_quantity(row) <= 0:
                    continue
                order_rows.append(row)
                order_ids_seen.add(order_id)
            append_jsonl(paths["orders"], order_rows)
            log(f"  orders symbol={symbol or '*'} new={len(order_rows)} total_seen={len(order_ids_seen)}")

            log(f"  calling history_executions symbol={symbol or '*'}")
            executions = iter_items(
                limiter.call(
                    "history_executions",
                    ctx.history_executions,
                    symbol=symbol,
                    start_at=start_at,
                    end_at=end_at,
                ),
                "trades",
            )
            execution_rows = []
            for item in executions:
                row = compact_object(item, DEFAULT_EXECUTION_FIELDS)
                trade_id = str(row.get("trade_id") or "")
                if not trade_id or trade_id in execution_ids_seen:
                    continue
                execution_rows.append(row)
                execution_ids_seen.add(trade_id)
            append_jsonl(paths["executions"], execution_rows)
            log(f"  executions symbol={symbol or '*'} new={len(execution_rows)} total_seen={len(execution_ids_seen)}")

        page = 1
        while True:
            log(f"  calling cash_flow page={page}")
            cashflows = iter_items(
                limiter.call(
                    "cash_flow",
                    ctx.cash_flow,
                    start_at=start_at,
                    end_at=end_at,
                    page=page,
                    size=args.cashflow_page_size,
                ),
                "list",
            )
            cashflow_rows = []
            for item in cashflows:
                row = compact_object(item, DEFAULT_CASHFLOW_FIELDS)
                key = json.dumps(
                    [
                        row.get("business_time"),
                        row.get("transaction_flow_name"),
                        row.get("balance"),
                        row.get("currency"),
                        row.get("symbol"),
                        row.get("description"),
                    ],
                    ensure_ascii=False,
                )
                if key in cashflow_keys_seen:
                    continue
                cashflow_rows.append(row)
                cashflow_keys_seen.add(key)
            append_jsonl(paths["cashflows"], cashflow_rows)
            log(f"  cashflows page={page} new={len(cashflow_rows)}")
            if cashflows and not cashflow_rows:
                log(f"  cashflows page={page} only repeated rows; stop paging this window")
                break
            if len(cashflows) < args.cashflow_page_size:
                break
            page += 1

        if args.with_order_details:
            orders_for_detail = [
                row
                for row in read_jsonl(paths["orders"])
                if str(row.get("order_id") or "") not in detail_ids_seen and executed_quantity(row) > 0
            ]
            if args.max_order_details:
                orders_for_detail = orders_for_detail[: max(0, args.max_order_details - detail_count)]
            for row in orders_for_detail:
                order_id = str(row.get("order_id"))
                try:
                    detail = limiter.call("order_detail", ctx.order_detail, order_id, detail=True)
                except Exception as exc:
                    print(f"  order_detail order_id={order_id} failed={exc}", file=sys.stderr, flush=True)
                    continue
                detail_row = compact_object(detail, DEFAULT_DETAIL_FIELDS)
                detail_row["order_id"] = order_id
                append_jsonl(paths["order_details"], [detail_row])
                detail_ids_seen.add(order_id)
                detail_count += 1
                log(f"  order_detail order_id={order_id} saved total={detail_count}")
                if args.max_order_details and detail_count >= args.max_order_details:
                    break

    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "start_year": args.start_year,
        "end_year": args.end_year,
        "symbols": parse_symbols(args.symbols),
        "window_days": args.window_days,
        "request_interval": args.request_interval,
        "detail_interval": args.detail_interval,
        "files": {name: str(path.relative_to(out_dir)) for name, path in paths.items()},
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    summarize_dir(out_dir)


def summarize_dir(out_dir: Path) -> None:
    paths = {
        "orders": out_dir / "orders.jsonl",
        "executions": out_dir / "executions.jsonl",
        "cashflows": out_dir / "cashflows.jsonl",
        "order_details": out_dir / "order_details.jsonl",
    }
    log(f"[summary] {out_dir}")
    for name, path in paths.items():
        rows = read_jsonl(path)
        log(f"  {name}: {len(rows)} rows")
        if rows:
            keys = sorted(rows[0].keys())
            log(f"    first keys: {', '.join(keys)}")
            log(f"    first row: {json.dumps(rows[0], ensure_ascii=False, sort_keys=True)[:1200]}")
    validate_dir(out_dir)


def validate_dir(out_dir: Path) -> bool:
    errors = []
    required = {
        "orders.jsonl": ["order_id"],
        "executions.jsonl": ["order_id", "trade_id", "symbol", "trade_done_at", "price", "quantity"],
        "cashflows.jsonl": ["transaction_flow_name", "balance", "currency", "business_time"],
        "order_details.jsonl": ["order_id"],
    }
    scalar_fields = {
        "orders.jsonl": ["side", "status", "order_type", "currency"],
        "cashflows.jsonl": ["direction", "business_type", "currency"],
        "order_details.jsonl": ["side", "status", "currency"],
    }
    for filename, keys in required.items():
        path = out_dir / filename
        for index, row in enumerate(read_jsonl(path), start=1):
            missing = [key for key in keys if row.get(key) in (None, "")]
            if missing:
                errors.append(f"{filename}:{index} missing {','.join(missing)}")
                if len(errors) >= 20:
                    break
            for field in scalar_fields.get(filename, []):
                if isinstance(row.get(field), (dict, list)):
                    errors.append(f"{filename}:{index} {field} must be scalar, got {type(row.get(field)).__name__}")
                    if len(errors) >= 20:
                        break
    if errors:
        log("[validate] failed")
        for err in errors[:20]:
            log(f"  - {err}")
        return False
    log("[validate] ok")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch Longbridge tax-related SDK data into a local JSONL cache.")
    parser.add_argument("command", choices=["fetch", "summary", "validate"])
    parser.add_argument("--cache-dir", default=str(CACHE_ROOT))
    parser.add_argument("--start-year", type=int, default=2019)
    parser.add_argument("--end-year", type=int, default=datetime.now(timezone.utc).year)
    parser.add_argument("--start-date", default="")
    parser.add_argument("--end-date", default="")
    parser.add_argument("--symbols", default=os.environ.get("LONGBRIDGE_TAX_SYMBOLS", ""))
    parser.add_argument("--window-days", type=int, default=90)
    parser.add_argument("--max-windows", type=int, default=0)
    parser.add_argument("--request-interval", type=float, default=1.0)
    parser.add_argument("--detail-interval", type=float, default=3.0)
    parser.add_argument("--backoff-seconds", type=float, default=10.0)
    parser.add_argument("--max-retries", type=int, default=6)
    parser.add_argument("--cashflow-page-size", type=int, default=100)
    parser.add_argument("--with-order-details", action="store_true")
    parser.add_argument("--max-order-details", type=int, default=20)
    parser.add_argument("--force-refresh", action="store_true")
    args = parser.parse_args()

    out_dir = cache_dir(args)
    if args.command == "fetch":
        fetch(args)
        return 0
    if args.command == "summary":
        summarize_dir(out_dir)
        return 0
    ok = validate_dir(out_dir)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
