import logging
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.collectors.base import BaseCollector
from app.config import get_settings
from app.models.candlestick import Candlestick
from app.models.quote import StockQuote

logger = logging.getLogger(__name__)

PERIOD_MAP = {
    "day": None,  # resolved at import time below
}


def _get_lb_config():
    s = get_settings()
    from longbridge.openapi import Config

    return Config(
        app_key=s.LONGBRIDGE_APP_KEY,
        app_secret=s.LONGBRIDGE_APP_SECRET,
        access_token=s.LONGBRIDGE_ACCESS_TOKEN,
    )


class QuoteCollector(BaseCollector):
    name = "quote"

    async def collect(self, symbol: str, db: AsyncSession) -> int:
        count = 0
        try:
            from longbridge.openapi import AdjustType, Period, QuoteContext

            config = _get_lb_config()
            ctx = QuoteContext(config)

            quotes = ctx.quote([symbol])
            now = datetime.now(timezone.utc)
            for q in quotes:
                stmt = pg_insert(StockQuote).values(
                    symbol=symbol,
                    last_price=Decimal(str(q.last_done)),
                    open=Decimal(str(q.open)),
                    high=Decimal(str(q.high)),
                    low=Decimal(str(q.low)),
                    volume=int(q.volume),
                    turnover=Decimal(str(q.turnover)),
                    change_rate=Decimal(str(q.change_rate * 100)) if q.change_rate else None,
                    fetched_at=now,
                )
                stmt = stmt.on_conflict_do_nothing()
                await db.execute(stmt)
                count += 1

            last_row = (
                await db.execute(
                    select(Candlestick.ts)
                    .where(Candlestick.symbol == symbol, Candlestick.period == "day")
                    .order_by(Candlestick.ts.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()

            candle_count = 30 if last_row is None else 10
            candles = ctx.candlesticks(symbol, Period.Day, candle_count, AdjustType.ForwardAdjust)
            for c in candles:
                ts = datetime.fromtimestamp(c.timestamp, tz=timezone.utc) if isinstance(c.timestamp, (int, float)) else c.timestamp
                stmt = pg_insert(Candlestick).values(
                    symbol=symbol,
                    period="day",
                    ts=ts,
                    open=Decimal(str(c.open)),
                    high=Decimal(str(c.high)),
                    low=Decimal(str(c.low)),
                    close=Decimal(str(c.close)),
                    volume=int(c.volume),
                    turnover=Decimal(str(c.turnover)) if c.turnover else None,
                )
                stmt = stmt.on_conflict_do_nothing()
                await db.execute(stmt)
                count += 1

            await db.commit()
            logger.info("QuoteCollector: fetched %d records for %s", count, symbol)
        except Exception:
            logger.exception("QuoteCollector failed for %s", symbol)
            await db.rollback()
        return count
