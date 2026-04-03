import logging
import time
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.collectors.base import BaseCollector
from app.models.vix import VixData

logger = logging.getLogger(__name__)


class VixCollector(BaseCollector):
    name = "vix"

    async def collect(self, symbol: str, db: AsyncSession) -> int:
        t0 = time.monotonic()
        count = 0
        try:
            import yfinance as yf

            logger.info("[vix] fetching ^VIX 3-month daily history ...")
            ticker = yf.Ticker("^VIX")
            hist = ticker.history(period="3mo", interval="1d")
            logger.info("[vix] yfinance returned %d rows", len(hist))

            for ts_idx, row in hist.iterrows():
                ts = ts_idx.to_pydatetime()
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)

                stmt = pg_insert(VixData).values(
                    ts=ts,
                    open=Decimal(str(round(row["Open"], 4))),
                    high=Decimal(str(round(row["High"], 4))),
                    low=Decimal(str(round(row["Low"], 4))),
                    close=Decimal(str(round(row["Close"], 4))),
                    period="day",
                )
                stmt = stmt.on_conflict_do_update(
                    index_elements=["ts", "period"],
                    set_={"close": Decimal(str(round(row["Close"], 4)))},
                )
                await db.execute(stmt)
                count += 1

            await db.commit()
            elapsed = time.monotonic() - t0
            logger.info("[vix] OK: upserted %d records in %.1fs", count, elapsed)
        except Exception:
            elapsed = time.monotonic() - t0
            logger.exception("[vix] FAILED after %.1fs (%d records before error)", elapsed, count)
            await db.rollback()
        return count
