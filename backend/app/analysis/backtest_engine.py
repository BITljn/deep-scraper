from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal

import numpy as np
from scipy.stats import pearsonr, spearmanr
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import BacktestResult, Candlestick, Indicator

logger = logging.getLogger(__name__)

WINDOWS = {"1h": 1, "4h": 4, "1d": 24, "3d": 72, "1w": 168}
INDICATOR_FIELDS = [
    "dhi_zscore",
    "sps_mean",
    "em_like_comment_ratio",
    "ms_sentiment",
    "vix_level",
    "tarco_score",
]

BUCKET_HOURS = {"1h": 1, "4h": 4, "1d": 24}


def _to_float(x) -> float | None:
    if x is None:
        return None
    if isinstance(x, Decimal):
        return float(x)
    return float(x)


def _compute_sharpe(returns: np.ndarray, periods_per_year: float) -> float:
    if returns.size < 2:
        return 0.0
    m = float(np.mean(returns))
    s = float(np.std(returns, ddof=1))
    if s == 0.0 or np.isnan(s):
        return 0.0
    return float(m / s * np.sqrt(periods_per_year))


def _compute_max_drawdown(returns: np.ndarray) -> float:
    if returns.size == 0:
        return 0.0
    equity = np.cumprod(1.0 + returns)
    peak = np.maximum.accumulate(equity)
    dd = (equity - peak) / np.maximum(peak, 1e-12)
    return float(np.min(dd)) if dd.size else 0.0


def _field_value(ind: Indicator, field: str) -> float | None:
    return _to_float(getattr(ind, field, None))


def _annualization_factor(bucket_size: str) -> float:
    h = float(BUCKET_HOURS.get(bucket_size, 24))
    steps_per_year = (365.25 * 24.0) / h
    return max(steps_per_year, 1.0)


def _align_forward_returns(
    ind_ts: list[datetime],
    ind_vals: list[float],
    candle_ts: np.ndarray,
    closes: np.ndarray,
    window_hours: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Pairs (indicator_value, forward_return) for overlapping timestamps."""
    if not ind_ts or candle_ts.size < 2:
        return np.array([]), np.array([])

    ct = np.array([t.timestamp() for t in ind_ts])
    cand_t = candle_ts.astype("float64")
    fwd_sec = float(window_hours) * 3600.0

    iv_out: list[float] = []
    r_out: list[float] = []

    for i, t in enumerate(ct):
        i0 = int(np.searchsorted(cand_t, t, side="left"))
        if i0 >= len(cand_t):
            continue
        t1 = t + fwd_sec
        i1 = int(np.searchsorted(cand_t, t1, side="right")) - 1
        if i1 <= i0 or i1 >= len(closes):
            continue
        p0 = float(closes[i0])
        p1 = float(closes[i1])
        if p0 == 0.0:
            continue
        ret = (p1 - p0) / p0
        iv_out.append(ind_vals[i])
        r_out.append(ret)

    return np.array(iv_out), np.array(r_out)


async def run_backtest(symbol: str, db: AsyncSession) -> list[BacktestResult]:
    ind_rows = (
        await db.execute(
            select(Indicator)
            .where(Indicator.symbol == symbol)
            .order_by(Indicator.ts.asc())
        )
    ).scalars().all()

    if not ind_rows:
        logger.warning("run_backtest: no indicators for %s", symbol)
        return []

    bucket_size = ind_rows[0].bucket_size
    period = bucket_size if bucket_size in ("1h", "4h", "1d", "day") else "day"
    if period == "1d":
        period = "day"

    candle_rows = (
        await db.execute(
            select(Candlestick)
            .where(Candlestick.symbol == symbol, Candlestick.period == period)
            .order_by(Candlestick.ts.asc())
        )
    ).scalars().all()

    if not candle_rows:
        candle_rows = (
            await db.execute(
                select(Candlestick)
                .where(Candlestick.symbol == symbol)
                .order_by(Candlestick.ts.asc())
            )
        ).scalars().all()

    if not candle_rows:
        logger.warning("run_backtest: no candlesticks for %s", symbol)
        return []

    candle_ts = np.array([r.ts.timestamp() for r in candle_rows], dtype="float64")
    closes = np.array([float(r.close or 0) for r in candle_rows], dtype="float64")

    ind_ts = [r.ts for r in ind_rows]
    start_d = min(r.ts.date() for r in ind_rows)
    end_d = max(r.ts.date() for r in ind_rows)

    await db.execute(delete(BacktestResult).where(BacktestResult.symbol == symbol))
    await db.flush()

    results: list[BacktestResult] = []
    ann = _annualization_factor(bucket_size)

    for field in INDICATOR_FIELDS:
        vals = [_field_value(r, field) for r in ind_rows]
        ind_vals_clean = [v for v in vals if v is not None]
        if len(ind_vals_clean) < 5:
            continue
        arr_iv = np.array(
            [v for v in vals if v is not None],
            dtype="float64",
        )
        ts_aligned = [t for t, v in zip(ind_ts, vals, strict=True) if v is not None]

        p65 = float(np.percentile(arr_iv, 65.0))
        p35 = float(np.percentile(arr_iv, 35.0))

        for wname, wh in WINDOWS.items():
            iv, rets = _align_forward_returns(ts_aligned, list(arr_iv), candle_ts, closes, wh)
            if iv.size < 5:
                br = BacktestResult(
                    symbol=symbol,
                    indicator_name=field,
                    window=wname,
                    start_date=start_d,
                    end_date=end_d,
                    pearson_corr=None,
                    spearman_corr=None,
                    signal_accuracy=None,
                    avg_return=None,
                    sharpe_ratio=None,
                    max_drawdown=None,
                    total_signals=0,
                )
                ins = pg_insert(BacktestResult).values(
                    symbol=br.symbol,
                    indicator_name=br.indicator_name,
                    window=br.window,
                    start_date=br.start_date,
                    end_date=br.end_date,
                    pearson_corr=br.pearson_corr,
                    spearman_corr=br.spearman_corr,
                    signal_accuracy=br.signal_accuracy,
                    avg_return=br.avg_return,
                    sharpe_ratio=br.sharpe_ratio,
                    max_drawdown=br.max_drawdown,
                    total_signals=br.total_signals,
                )
                await db.execute(ins)
                results.append(br)
                continue

            pc, sc = None, None
            try:
                pr = pearsonr(iv, rets)
                pr_val = float(pr.statistic) if hasattr(pr, "statistic") else float(pr[0])
                pc = pr_val if not np.isnan(pr_val) else None
            except Exception:
                pass
            try:
                sr = spearmanr(iv, rets)
                sr_val = float(sr.statistic) if hasattr(sr, "statistic") else float(sr[0])
                sc = sr_val if not np.isnan(sr_val) else None
            except Exception:
                pass

            strat_rets: list[float] = []
            correct = 0
            total = 0
            for i in range(iv.size):
                x = iv[i]
                r = rets[i]
                if x > p65:
                    total += 1
                    strat_rets.append(r)
                    if r > 0:
                        correct += 1
                elif x < p35:
                    total += 1
                    strat_rets.append(-r)
                    if r < 0:
                        correct += 1

            sr_arr = np.array(strat_rets, dtype="float64") if strat_rets else np.array([])
            acc = float(correct / total) if total else None
            avg_ret = float(np.mean(sr_arr)) if sr_arr.size else None
            sharpe = _compute_sharpe(sr_arr, ann) if sr_arr.size > 1 else None
            mdd = _compute_max_drawdown(sr_arr) if sr_arr.size else None

            br = BacktestResult(
                symbol=symbol,
                indicator_name=field,
                window=wname,
                start_date=start_d,
                end_date=end_d,
                pearson_corr=Decimal(str(round(pc, 4))) if pc is not None else None,
                spearman_corr=Decimal(str(round(sc, 4))) if sc is not None else None,
                signal_accuracy=Decimal(str(round(acc, 4))) if acc is not None else None,
                avg_return=Decimal(str(round(avg_ret, 4))) if avg_ret is not None else None,
                sharpe_ratio=Decimal(str(round(sharpe, 4))) if sharpe is not None else None,
                max_drawdown=Decimal(str(round(mdd, 4))) if mdd is not None else None,
                total_signals=total,
            )
            ins = pg_insert(BacktestResult).values(
                symbol=br.symbol,
                indicator_name=br.indicator_name,
                window=br.window,
                start_date=br.start_date,
                end_date=br.end_date,
                pearson_corr=br.pearson_corr,
                spearman_corr=br.spearman_corr,
                signal_accuracy=br.signal_accuracy,
                avg_return=br.avg_return,
                sharpe_ratio=br.sharpe_ratio,
                max_drawdown=br.max_drawdown,
                total_signals=br.total_signals,
            )
            await db.execute(ins)
            results.append(br)

    await db.commit()
    return results
