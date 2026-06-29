import logging
import time
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.collectors.base import BaseCollector
from app.longbridge_config import get_longbridge_config
from app.models.candlestick import Candlestick

logger = logging.getLogger(__name__)


def _get_lb_config():
    return get_longbridge_config()


def _dec(val) -> Decimal | None:
    if val is None:
        return None
    return Decimal(str(val))


class QuoteCollector(BaseCollector):
    name = "quote"

    async def collect(self, symbol: str, db: AsyncSession) -> int:
        t0 = time.monotonic()
        count = 0
        candle_count_saved = 0
        try:
            from longbridge.openapi import AdjustType, Period, QuoteContext

            config = _get_lb_config()
            ctx = QuoteContext(config)

            last_row = (
                await db.execute(
                    select(Candlestick.ts)
                    .where(Candlestick.symbol == symbol, Candlestick.period == "day")
                    .order_by(Candlestick.ts.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()

            candle_req = 60 if last_row is None else 10
            logger.info("[quote] fetching %d candlesticks for %s ...", candle_req, symbol)
            candles = ctx.candlesticks(symbol, Period.Day, candle_req, AdjustType.ForwardAdjust)
            for c in candles:
                ts = c.timestamp
                if isinstance(ts, (int, float)):
                    ts = datetime.fromtimestamp(ts, tz=timezone.utc)
                elif hasattr(ts, 'tzinfo') and ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)

                stmt = pg_insert(Candlestick).values(
                    symbol=symbol,
                    period="day",
                    ts=ts,
                    open=_dec(c.open),
                    high=_dec(c.high),
                    low=_dec(c.low),
                    close=_dec(c.close),
                    volume=int(c.volume) if c.volume else None,
                    turnover=_dec(c.turnover),
                )
                stmt = stmt.on_conflict_do_nothing()
                await db.execute(stmt)
                candle_count_saved += 1
                count += 1

            await db.commit()
            elapsed = time.monotonic() - t0
            logger.info(
                "[quote] OK for %s: %d candles in %.1fs",
                symbol, candle_count_saved, elapsed,
            )
        except Exception:
            elapsed = time.monotonic() - t0
            logger.exception(
                "[quote] FAILED for %s after %.1fs (%d records before error)",
                symbol, elapsed, count,
            )
            await db.rollback()
        return count
