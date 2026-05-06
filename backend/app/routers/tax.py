from __future__ import annotations

import asyncio
import csv
import io
import logging
import re
from datetime import date, datetime, timezone
from decimal import Decimal

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.tax_calculator import build_tax_report
from app.analysis.fx_rates import fetch_and_store_fx_rates
from app.collectors.tax_collector import TaxCollector
from app.config import get_settings
from app.database import async_session, get_db
from app.models import CollectJob, TaxCashFlow, TaxExecution, TaxFxRate, TaxOrder, TaxReportSnapshot

router = APIRouter(prefix="/api/tax", tags=["tax"])
logger = logging.getLogger(__name__)


class TaxCollectBody(BaseModel):
    start_year: int | None = None
    end_year: int | None = None
    symbols: list[str] | None = None


class TaxCollectResponse(BaseModel):
    id: int | None = None
    status: str
    job_type: str = "tax"


class FxImportResponse(BaseModel):
    imported: int
    currencies: list[str]


class FxFetchBody(BaseModel):
    start_date: date
    end_date: date
    currencies: list[str] = ["USD", "HKD"]


class FxFetchResponse(BaseModel):
    imported: int
    currencies: list[str]
    by_currency: dict[str, int]
    source: str
    source_url: str


async def _run_tax_collect(body: TaxCollectBody) -> None:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    job = CollectJob(
        job_type="tax",
        status="pending",
        trigger_type="manual",
        started_at=now,
        records_count=0,
    )
    async with async_session() as db:
        db.add(job)
        await db.commit()
        await db.refresh(job)
        try:
            collector = TaxCollector()
            count = await collector.collect_range(
                db=db,
                start_year=body.start_year or settings.LONGBRIDGE_TAX_START_YEAR,
                end_year=body.end_year or now.year,
                symbols=body.symbols or None,
            )
            job.status = "completed"
            job.records_count = count
            job.completed_at = datetime.now(timezone.utc)
            job.error_message = None
        except Exception as exc:
            logger.exception("Tax collect job failed")
            await db.rollback()
            job.status = "failed"
            job.completed_at = datetime.now(timezone.utc)
            job.error_message = str(exc)[:2000]
        await db.commit()


@router.post("/collect", response_model=TaxCollectResponse)
async def collect_tax(body: TaxCollectBody) -> TaxCollectResponse:
    asyncio.create_task(_run_tax_collect(body))
    return TaxCollectResponse(status="pending")


@router.get("/report")
async def get_tax_report(
    year: int = Query(..., ge=2010, le=2100),
    filing_month: int = Query(6, ge=3, le=6),
    db: AsyncSession = Depends(get_db),
) -> dict:
    report = await build_tax_report(db, year=year, filing_month=filing_month)
    stmt = pg_insert(TaxReportSnapshot).values(
        tax_year=year,
        filing_month=filing_month,
        status=report["status"],
        best_scheme_key=report.get("best_scheme_key"),
        report=report,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["tax_year", "filing_month"],
        set_={
            "status": stmt.excluded.status,
            "best_scheme_key": stmt.excluded.best_scheme_key,
            "report": stmt.excluded.report,
        },
    )
    await db.execute(stmt)
    await db.commit()
    return report


@router.post("/fx-rates/import", response_model=FxImportResponse)
async def import_fx_rates(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
) -> FxImportResponse:
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("gb18030")
    rows = _parse_fx_rows(text)
    imported = 0
    currencies: set[str] = set()
    for rate_date, currency, cny_rate in rows:
        stmt = pg_insert(TaxFxRate).values(
            rate_date=rate_date,
            currency=currency,
            cny_rate=cny_rate,
            source=file.filename or "upload",
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["rate_date", "currency"],
            set_={"cny_rate": stmt.excluded.cny_rate, "source": stmt.excluded.source},
        )
        await db.execute(stmt)
        imported += 1
        currencies.add(currency)
    await db.commit()
    return FxImportResponse(imported=imported, currencies=sorted(currencies))


@router.post("/fx-rates/fetch", response_model=FxFetchResponse)
async def fetch_fx_rates(
    body: FxFetchBody,
    db: AsyncSession = Depends(get_db),
) -> FxFetchResponse:
    if body.end_date < body.start_date:
        raise HTTPException(status_code=400, detail="end_date must be on or after start_date")
    try:
        result = await fetch_and_store_fx_rates(
            db,
            start_date=body.start_date,
            end_date=body.end_date,
            currencies=body.currencies,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"FX source request failed: {exc}") from exc
    return FxFetchResponse(**result)


@router.get("/raw")
async def list_raw_tax_rows(
    kind: str = Query("executions", pattern="^(executions|orders|cashflows|fx)$"),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    year: int | None = Query(None, ge=2000, le=2100),
) -> dict:
    start = datetime(year, 1, 1, tzinfo=timezone.utc) if year else None
    end = datetime(year + 1, 1, 1, tzinfo=timezone.utc) if year else None
    if kind == "executions":
        stmt = select(TaxExecution)
        if start and end:
            stmt = stmt.where(TaxExecution.trade_done_at >= start, TaxExecution.trade_done_at < end)
        total = await _raw_count(db, stmt)
        rows = (await db.execute(stmt.order_by(TaxExecution.trade_done_at.desc()).offset(offset).limit(limit))).scalars().all()
        return _raw_response(kind, year, limit, offset, total, [_execution_out(row) for row in rows])
    if kind == "orders":
        stmt = select(TaxOrder).where(
            TaxOrder.executed_quantity > 0,
            TaxOrder.status.notin_(["Canceled", "Expired", "Rejected", "Unknown"]),
        )
        if start and end:
            stmt = stmt.where(TaxOrder.submitted_at >= start, TaxOrder.submitted_at < end)
        total = await _raw_count(db, stmt)
        rows = (await db.execute(stmt.order_by(TaxOrder.submitted_at.desc().nullslast()).offset(offset).limit(limit))).scalars().all()
        return _raw_response(kind, year, limit, offset, total, [_order_out(row) for row in rows])
    if kind == "cashflows":
        stmt = select(TaxCashFlow)
        if start and end:
            stmt = stmt.where(TaxCashFlow.business_time >= start, TaxCashFlow.business_time < end)
        total = await _raw_count(db, stmt)
        rows = (await db.execute(stmt.order_by(TaxCashFlow.business_time.desc()).offset(offset).limit(limit))).scalars().all()
        return _raw_response(kind, year, limit, offset, total, [_cashflow_out(row) for row in rows])
    stmt = select(TaxFxRate)
    if year:
        stmt = stmt.where(TaxFxRate.rate_date >= date(year, 1, 1), TaxFxRate.rate_date < date(year + 1, 1, 1))
    total = await _raw_count(db, stmt)
    rows = (await db.execute(stmt.order_by(TaxFxRate.rate_date.desc(), TaxFxRate.currency).offset(offset).limit(limit))).scalars().all()
    return _raw_response(kind, year, limit, offset, total, [_fx_out(row) for row in rows])


async def _raw_count(db: AsyncSession, stmt) -> int:
    return int((await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one())


def _raw_response(kind: str, year: int | None, limit: int, offset: int, total: int, items: list[dict]) -> dict:
    return {
        "kind": kind,
        "year": year,
        "limit": limit,
        "offset": offset,
        "total": total,
        "items": items,
    }


def _parse_fx_rows(text: str) -> list[tuple[date, str, Decimal]]:
    parsed: list[tuple[date, str, Decimal]] = []
    reader = csv.reader(io.StringIO(text))
    header: list[str] | None = None
    for raw_row in reader:
        row = [cell.strip() for cell in raw_row if cell.strip()]
        if not row:
            continue
        if header is None and any(token in ",".join(row).lower() for token in ["date", "日期", "美元", "港元", "currency"]):
            header = row
            continue
        parsed.extend(_parse_fx_csv_row(row, header))
    if not parsed:
        parsed.extend(_parse_fx_text(text))
    return parsed


def _parse_fx_csv_row(row: list[str], header: list[str] | None) -> list[tuple[date, str, Decimal]]:
    row_date = _find_date(row)
    if row_date is None:
        return []
    if header and len(header) == len(row):
        out = []
        for name, value in zip(header, row, strict=False):
            currency = _currency_from_label(name)
            if currency:
                rate = _rate_from_text(value)
                if rate is not None:
                    out.append((row_date, currency, rate))
        if out:
            return out
    if len(row) >= 3:
        currency = _currency_from_label(row[1])
        rate = _rate_from_text(row[2])
        if currency and rate is not None:
            return [(row_date, currency, rate)]
    return []


def _parse_fx_text(text: str) -> list[tuple[date, str, Decimal]]:
    out = []
    for line in text.splitlines():
        row_date = _find_date([line])
        if row_date is None:
            continue
        for currency, pattern in {
            "USD": r"(?:1美元|美元).*?([0-9]+(?:\.[0-9]+)?)",
            "HKD": r"(?:1港元|港元).*?([0-9]+(?:\.[0-9]+)?)",
        }.items():
            match = re.search(pattern, line)
            if match:
                out.append((row_date, currency, Decimal(match.group(1))))
    return out


def _find_date(row: list[str]) -> date | None:
    joined = " ".join(row)
    match = re.search(r"(20\d{2}|19\d{2})[-/年.]?(\d{1,2})[-/月.]?(\d{1,2})", joined)
    if not match:
        return None
    return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))


def _currency_from_label(label: str) -> str | None:
    upper = label.upper()
    if "USD" in upper or "美元" in label:
        return "USD"
    if "HKD" in upper or "港元" in label:
        return "HKD"
    if "CNY" in upper or "人民币" in label:
        return "CNY"
    return None


def _rate_from_text(value: str) -> Decimal | None:
    match = re.search(r"-?[0-9]+(?:\.[0-9]+)?", value)
    if not match:
        return None
    rate = Decimal(match.group(0))
    if rate > 100:
        rate = rate / Decimal("100")
    return rate


def _execution_out(row: TaxExecution) -> dict:
    return {
        "symbol": row.symbol,
        "trade_done_at": row.trade_done_at,
        "price": row.price,
        "quantity": row.quantity,
    }


def _order_out(row: TaxOrder) -> dict:
    return {
        "symbol": row.symbol,
        "side": row.side,
        "status": row.status,
        "currency": row.currency,
        "executed_price": row.executed_price,
        "executed_quantity": row.executed_quantity,
        "submitted_at": row.submitted_at,
        "updated_at": row.updated_at,
    }


def _cashflow_out(row: TaxCashFlow) -> dict:
    return {
        "transaction_flow_name": row.transaction_flow_name,
        "direction": row.direction,
        "business_type": row.business_type,
        "balance": row.balance,
        "currency": row.currency,
        "business_time": row.business_time,
        "symbol": row.symbol,
        "description": row.description,
    }


def _fx_out(row: TaxFxRate) -> dict:
    return {
        "rate_date": row.rate_date,
        "currency": row.currency,
        "cny_rate": row.cny_rate,
        "source": row.source,
    }
