import asyncio
import csv
import time
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from io import StringIO

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError

from app.database import async_session
from app.models.fred_cache import FredObservation, FredSeriesCache

router = APIRouter(prefix="/api/macro", tags=["macro"])

_FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv"
_MARKET_CAP_SERIES = "NCBEILQ027S"
_GDP_SERIES = "GDP"
_SP500_SERIES = "SP500"
_NASDAQ100_SERIES = "NASDAQ100"
_CACHE_TTL = 3600
_DB_CACHE_TTL = 24 * 3600
_CACHE_VERSION = 1
_ratio_cache: tuple[float, list["MarketCapGdpPoint"]] | None = None
_index_cache: dict[tuple[str, date], tuple[float, list["MarketIndexPoint"]]] = {}


class MarketCapGdpPoint(BaseModel):
    date: date
    market_cap: Decimal
    gdp: Decimal
    ratio: Decimal


class MarketIndexPoint(BaseModel):
    date: date
    value: Decimal


class MarketIndexSeries(BaseModel):
    series_id: str
    name: str
    source_url: str
    items: list[MarketIndexPoint]


class MarketCapGdpOut(BaseModel):
    source: str
    source_url: str
    market_cap_series: str
    gdp_series: str
    units: str
    fetched_at: float
    years: int
    items: list[MarketCapGdpPoint]
    indices: list[MarketIndexSeries]


@dataclass(frozen=True)
class _Observation:
    date: date
    value: Decimal


def _start_date_key(start_date: date | None) -> str:
    return start_date.isoformat() if start_date else "all"


def _seconds_since(value: datetime) -> float:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - value).total_seconds()


async def _read_fred_db_cache(
    series_id: str,
    start_date: date | None,
    *,
    allow_stale: bool = False,
) -> list[_Observation] | None:
    start_date_key = _start_date_key(start_date)

    try:
        async with async_session() as session:
            metadata = await session.scalar(
                select(FredSeriesCache).where(
                    FredSeriesCache.series_id == series_id,
                    FredSeriesCache.start_date_key == start_date_key,
                    FredSeriesCache.cache_version == _CACHE_VERSION,
                )
            )
            if metadata is None:
                return None
            if not allow_stale and _seconds_since(metadata.fetched_at) >= _DB_CACHE_TTL:
                return None

            stmt = select(FredObservation).where(FredObservation.series_id == series_id)
            if start_date:
                stmt = stmt.where(FredObservation.observation_date >= start_date)
            rows = (await session.scalars(stmt.order_by(FredObservation.observation_date))).all()
    except SQLAlchemyError:
        return None

    if not rows:
        return None
    return [_Observation(date=row.observation_date, value=row.value) for row in rows]


async def _write_fred_db_cache(
    series_id: str,
    start_date: date | None,
    observations: list[_Observation],
) -> None:
    if not observations:
        return

    fetched_at = datetime.now(timezone.utc)
    observation_rows = [
        {
            "series_id": series_id,
            "observation_date": item.date,
            "value": item.value,
            "fetched_at": fetched_at,
        }
        for item in observations
    ]
    metadata_row = {
        "series_id": series_id,
        "start_date_key": _start_date_key(start_date),
        "cache_version": _CACHE_VERSION,
        "fetched_at": fetched_at,
    }

    try:
        async with async_session() as session:
            observations_insert = insert(FredObservation).values(observation_rows)
            await session.execute(
                observations_insert.on_conflict_do_update(
                    index_elements=["series_id", "observation_date"],
                    set_={
                        "value": observations_insert.excluded.value,
                        "fetched_at": observations_insert.excluded.fetched_at,
                    },
                )
            )

            metadata_insert = insert(FredSeriesCache).values(metadata_row)
            await session.execute(
                metadata_insert.on_conflict_do_update(
                    index_elements=["series_id", "start_date_key"],
                    set_={
                        "cache_version": metadata_insert.excluded.cache_version,
                        "fetched_at": metadata_insert.excluded.fetched_at,
                    },
                )
            )
            await session.commit()
    except SQLAlchemyError:
        pass


async def _fetch_fred_series(series_id: str, start_date: date | None = None) -> list[_Observation]:
    cached = await _read_fred_db_cache(series_id, start_date)
    if cached is not None:
        return cached

    params = {"id": series_id}
    if start_date:
        params["observation_start"] = start_date.isoformat()

    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            response = await client.get(_FRED_CSV, params=params)
        response.raise_for_status()
    except httpx.HTTPError:
        stale_cached = await _read_fred_db_cache(series_id, start_date, allow_stale=True)
        if stale_cached is not None:
            return stale_cached
        raise

    reader = csv.DictReader(StringIO(response.text))
    observations: list[_Observation] = []
    for row in reader:
        raw_date = row.get("observation_date")
        raw_value = row.get(series_id)
        if not raw_date or not raw_value or raw_value == ".":
            continue
        observations.append(
            _Observation(
                date=datetime.strptime(raw_date, "%Y-%m-%d").date(),
                value=Decimal(raw_value),
            )
        )
    await _write_fred_db_cache(series_id, start_date, observations)
    return observations


async def _load_ratio_series() -> tuple[float, list[MarketCapGdpPoint]]:
    global _ratio_cache

    now = time.time()
    if _ratio_cache and now - _ratio_cache[0] < _CACHE_TTL:
        return _ratio_cache

    market_cap_rows, gdp_rows = await asyncio.gather(
        _fetch_fred_series(_MARKET_CAP_SERIES),
        _fetch_fred_series(_GDP_SERIES),
    )
    gdp_by_date = {row.date: row.value for row in gdp_rows}

    points: list[MarketCapGdpPoint] = []
    for row in market_cap_rows:
        gdp = gdp_by_date.get(row.date)
        if gdp is None or gdp == 0:
            continue
        market_cap_billions = row.value / Decimal("1000")
        ratio = market_cap_billions / gdp * Decimal("100")
        points.append(
            MarketCapGdpPoint(
                date=row.date,
                market_cap=market_cap_billions.quantize(Decimal("0.001")),
                gdp=gdp,
                ratio=ratio.quantize(Decimal("0.01")),
            )
        )

    points.sort(key=lambda item: item.date)
    _ratio_cache = (now, points)
    return _ratio_cache


async def _load_index_series(series_id: str, start_date: date) -> tuple[float, list[MarketIndexPoint]]:
    now = time.time()
    key = (series_id, start_date)
    cached = _index_cache.get(key)
    if cached and now - cached[0] < _CACHE_TTL:
        return cached

    rows = await _fetch_fred_series(series_id, start_date=start_date)
    items = [
        MarketIndexPoint(date=row.date, value=row.value.quantize(Decimal("0.01")))
        for row in rows
    ]
    _index_cache[key] = (now, items)
    return now, items


def _start_date_for_years(latest: date, years: int) -> date:
    try:
        return latest.replace(year=latest.year - years)
    except ValueError:
        return latest.replace(year=latest.year - years, day=28)


@router.get("/market-cap-gdp", response_model=MarketCapGdpOut)
async def get_market_cap_gdp(
    years: int = Query(10, ge=1, le=50),
    indices: str | None = Query(None),
) -> MarketCapGdpOut:
    try:
        fetched_at, points = await _load_ratio_series()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if not points:
        raise HTTPException(status_code=502, detail="No FRED market-cap/GDP data available")

    start_date = _start_date_for_years(points[-1].date, years)
    items = [point for point in points if point.date >= start_date]
    index_series: list[MarketIndexSeries] = []
    requested_indices = {
        item.strip().upper()
        for item in (indices or "").split(",")
        if item.strip()
    }
    index_specs = [
        (_SP500_SERIES, "S&P 500", "https://fred.stlouisfed.org/series/SP500"),
        (_NASDAQ100_SERIES, "Nasdaq 100", "https://fred.stlouisfed.org/series/NASDAQ100"),
    ]
    selected_indices = [
        spec for spec in index_specs if spec[0] in requested_indices
    ]
    if selected_indices:
        try:
            loaded_indices = await asyncio.gather(
                *(
                    _load_index_series(series_id, start_date)
                    for series_id, _, _ in selected_indices
                )
            )
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        fetched_at = max(fetched_at, *(loaded_at for loaded_at, _ in loaded_indices))
        index_series = [
            MarketIndexSeries(
                series_id=series_id,
                name=name,
                source_url=source_url,
                items=items,
            )
            for (series_id, name, source_url), (_, items) in zip(selected_indices, loaded_indices)
        ]

    return MarketCapGdpOut(
        source="FRED",
        source_url="https://fred.stlouisfed.org/series/NCBEILQ027S",
        market_cap_series=_MARKET_CAP_SERIES,
        gdp_series=_GDP_SERIES,
        units="Percent; market cap and GDP in billions of U.S. dollars",
        fetched_at=fetched_at,
        years=years,
        items=items,
        indices=index_series,
    )
