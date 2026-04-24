from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from statistics import mean, pstdev

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Indicator, SentimentScore, Topic, TopicReply, Tweet, VixData

logger = logging.getLogger(__name__)

BUCKET_HOURS = {"1h": 1, "4h": 4, "1d": 24}
WEIGHTS = {"dhi": 0.20, "sps": 0.30, "em": 0.10, "ms": 0.20, "vfs": 0.20}

SENTIMENT_MODEL = "snownlp-v1"
SOURCE_TOPIC = "topic"
SOURCE_TOPIC_REPLY = "topic_reply"
SOURCE_TWEET = "tweet"


def _to_utc(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        return ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc)


def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


def _compute_tarco_score(
    dhi_z: float | None,
    sps_m: float | None,
    em_comp: float | None,
    ms_comp: float | None,
    vfs_comp: float | None,
    vix_regime: str | None,
) -> tuple[float, str]:
    """Weighted composite 0–100 with VIX regime adjustments."""
    dz = _clamp(50.0 + 12.0 * float(dhi_z or 0.0), 0.0, 100.0)
    sp = _clamp((float(sps_m or 0.0) + 1.0) * 50.0, 0.0, 100.0)
    em = _clamp(float(em_comp or 50.0), 0.0, 100.0)
    ms = _clamp(float(ms_comp or 50.0), 0.0, 100.0)
    vf = _clamp(float(vfs_comp or 50.0), 0.0, 100.0)

    base = (
        WEIGHTS["dhi"] * dz
        + WEIGHTS["sps"] * sp
        + WEIGHTS["em"] * em
        + WEIGHTS["ms"] * ms
        + WEIGHTS["vfs"] * vf
    )

    regime = (vix_regime or "normal").lower()
    adj = 0.0
    if regime == "low":
        adj = 5.0
    elif regime == "normal":
        adj = 0.0
    elif regime == "elevated":
        adj = -10.0
    elif regime == "extreme":
        adj = -20.0

    score = _clamp(base + adj, 0.0, 100.0)
    sig = "neutral"
    if score >= 65.0:
        sig = "bullish"
    elif score <= 35.0:
        sig = "bearish"
    return score, sig


async def _compute_dhi(
    symbol: str,
    ts: datetime,
    bucket_td: timedelta,
    bucket_size: str,
    db: AsyncSession,
) -> tuple[Decimal | None, Decimal | None]:
    ts_e = _to_utc(ts)
    start = ts_e - bucket_td
    prev_start = start - bucket_td

    n_curr = (
        await db.execute(
            select(func.count())
            .select_from(Topic)
            .where(
                Topic.symbol == symbol,
                Topic.published_at > start,
                Topic.published_at <= ts_e,
            )
        )
    ).scalar_one()

    n_prev = (
        await db.execute(
            select(func.count())
            .select_from(Topic)
            .where(
                Topic.symbol == symbol,
                Topic.published_at > prev_start,
                Topic.published_at <= start,
            )
        )
    ).scalar_one()

    raw = (float(n_curr) - float(n_prev)) / max(float(n_prev), 1.0)

    hist = (
        await db.execute(
            select(Indicator.dhi_raw)
            .where(
                Indicator.symbol == symbol,
                Indicator.bucket_size == bucket_size,
                Indicator.ts < start,
                Indicator.ts >= ts_e - timedelta(days=30),
                Indicator.dhi_raw.isnot(None),
            )
            .order_by(Indicator.ts.asc())
        )
    ).scalars().all()

    vals = [float(x) for x in hist if x is not None]
    if len(vals) < 2:
        z = 0.0
    else:
        m = mean(vals)
        s = pstdev(vals) if len(vals) > 1 else 0.0
        z = (raw - m) / s if s and s > 0 else 0.0

    return Decimal(str(round(raw, 4))), Decimal(str(round(z, 4)))


async def _compute_sps(
    symbol: str,
    ts: datetime,
    bucket_td: timedelta,
    db: AsyncSession,
) -> tuple[Decimal | None, Decimal | None, int | None]:
    ts_e = _to_utc(ts)
    start = ts_e - bucket_td

    topic_ids = (
        await db.execute(
            select(Topic.id).where(
                Topic.symbol == symbol,
                Topic.published_at > start,
                Topic.published_at <= ts_e,
            )
        )
    ).scalars().all()

    reply_ids = (
        await db.execute(
            select(TopicReply.id)
            .join(Topic, Topic.id == TopicReply.topic_id)
            .where(
                Topic.symbol == symbol,
                TopicReply.created_at > start,
                TopicReply.created_at <= ts_e,
            )
        )
    ).scalars().all()

    tweet_ids = (
        await db.execute(
            select(Tweet.id).where(
                Tweet.published_at > start,
                Tweet.published_at <= ts_e,
            )
        )
    ).scalars().all()

    if not topic_ids and not reply_ids and not tweet_ids:
        return None, None, 0

    parts: list[tuple[float, float]] = []

    if topic_ids:
        rows = (
            await db.execute(
                select(SentimentScore.score, Topic.likes_count)
                .select_from(SentimentScore)
                .join(Topic, Topic.id == SentimentScore.source_id)
                .where(
                    SentimentScore.source_type == SOURCE_TOPIC,
                    SentimentScore.source_id.in_(topic_ids),
                    SentimentScore.model_version == SENTIMENT_MODEL,
                )
            )
        ).all()
        for sc, likes in rows:
            w = float(likes or 0) + 1.0
            parts.append((float(sc), w))

    if reply_ids:
        rows = (
            await db.execute(
                select(SentimentScore.score, TopicReply.likes_count)
                .select_from(SentimentScore)
                .join(TopicReply, TopicReply.id == SentimentScore.source_id)
                .where(
                    SentimentScore.source_type == SOURCE_TOPIC_REPLY,
                    SentimentScore.source_id.in_(reply_ids),
                    SentimentScore.model_version == SENTIMENT_MODEL,
                )
            )
        ).all()
        for sc, likes in rows:
            w = float(likes or 0) + 1.0
            parts.append((float(sc), w))

    if tweet_ids:
        rows = (
            await db.execute(
                select(SentimentScore.score).where(
                    SentimentScore.source_type == SOURCE_TWEET,
                    SentimentScore.source_id.in_(tweet_ids),
                    SentimentScore.model_version == SENTIMENT_MODEL,
                )
            )
        ).scalars().all()
        for sc in rows:
            parts.append((float(sc), 1.0))

    if not parts:
        return None, None, 0

    tw = sum(w for _, w in parts)
    mu = sum(s * w for s, w in parts) / tw if tw else 0.0
    var = sum(w * (s - mu) ** 2 for s, w in parts) / tw if tw else 0.0
    std = var**0.5

    return (
        Decimal(str(round(mu, 4))),
        Decimal(str(round(std, 4))),
        len(parts),
    )


async def _compute_em(
    symbol: str,
    ts: datetime,
    bucket_td: timedelta,
    db: AsyncSession,
) -> tuple[Decimal | None, Decimal | None, Decimal | None]:
    ts_e = _to_utc(ts)
    start = ts_e - bucket_td

    rows = (
        await db.execute(
            select(
                Topic.likes_count,
                Topic.comments_count,
                Topic.shares_count,
            ).where(
                Topic.symbol == symbol,
                Topic.published_at > start,
                Topic.published_at <= ts_e,
            )
        )
    ).all()

    if not rows:
        return None, None, None

    likes = sum(int(r[0] or 0) for r in rows)
    comments = sum(int(r[1] or 0) for r in rows)
    shares = sum(int(r[2] or 0) for r in rows)
    n = len(rows)

    lcr = float(likes) / max(float(comments), 1.0)
    sr = float(shares) / max(float(n), 1.0)
    rda = mean([float(r[1] or 0) for r in rows])

    return (
        Decimal(str(round(lcr, 4))),
        Decimal(str(round(sr, 4))),
        Decimal(str(round(rda, 4))),
    )


def _em_components_to_score(
    lcr: Decimal | None,
    sr: Decimal | None,
    rda: Decimal | None,
) -> float:
    if lcr is None and sr is None and rda is None:
        return 50.0
    a = _clamp(min(float(lcr or 0) / 5.0 * 100.0, 100.0))
    b = _clamp(min(float(sr or 0) * 20.0, 100.0))
    c = _clamp(min(float(rda or 0) * 10.0, 100.0))
    return (a + b + c) / 3.0


async def _compute_ms(
    ts: datetime,
    bucket_td: timedelta,
    db: AsyncSession,
) -> tuple[int | None, Decimal | None, bool | None]:
    ts_e = _to_utc(ts)
    start = ts_e - bucket_td
    musk = get_settings().MUSK_USERNAME

    tw_rows = (
        await db.execute(
            select(Tweet.id, Tweet.is_tesla_related).where(
                Tweet.username == musk,
                Tweet.published_at > start,
                Tweet.published_at <= ts_e,
            )
        )
    ).all()

    if not tw_rows:
        return 0, None, None

    ids = [r[0] for r in tw_rows]
    tesla_any = any(bool(r[1]) for r in tw_rows)

    scores = (
        await db.execute(
            select(SentimentScore.score).where(
                SentimentScore.source_type == SOURCE_TWEET,
                SentimentScore.source_id.in_(ids),
                SentimentScore.model_version == SENTIMENT_MODEL,
            )
        )
    ).scalars().all()

    if not scores:
        sent = None
    else:
        sent = mean(float(s) for s in scores)

    return (
        len(tw_rows),
        Decimal(str(round(sent, 4))) if sent is not None else None,
        tesla_any,
    )


def _ms_to_score(ms_sent: Decimal | None, tesla: bool | None, count: int) -> float:
    if not count:
        return 50.0
    base = _clamp((float(ms_sent or 0.0) + 1.0) * 50.0)
    if tesla:
        base = min(100.0, base + 5.0)
    return base


async def _compute_vfs(
    ts: datetime,
    bucket_td: timedelta,
    db: AsyncSession,
) -> tuple[Decimal | None, Decimal | None, str | None, float]:
    ts_e = _to_utc(ts)
    _ = bucket_td

    row = (
        await db.execute(
            select(VixData.close, VixData.ts)
            .where(VixData.period == "day", VixData.ts <= ts_e)
            .order_by(VixData.ts.desc())
            .limit(1)
        )
    ).first()

    if not row or row[0] is None:
        return None, None, None, 50.0

    close = float(row[0])
    prev_row = (
        await db.execute(
            select(VixData.close)
            .where(VixData.period == "day", VixData.ts < row[1])
            .order_by(VixData.ts.desc())
            .limit(1)
        )
    ).first()

    if prev_row and prev_row[0] is not None:
        pv = float(prev_row[0])
        chg = (close - pv) / max(pv, 1e-9)
    else:
        chg = 0.0

    if close < 15:
        regime = "low"
    elif close < 25:
        regime = "normal"
    elif close < 35:
        regime = "elevated"
    else:
        regime = "extreme"

    vfs = _clamp(100.0 - min(close, 80.0))

    return (
        Decimal(str(round(close, 4))),
        Decimal(str(round(chg, 4))),
        regime,
        vfs,
    )


async def compute_indicators(
    symbol: str,
    bucket_size: str,
    ts: datetime,
    db: AsyncSession,
) -> Indicator:
    hours = BUCKET_HOURS.get(bucket_size)
    if hours is None:
        raise ValueError(f"Unknown bucket_size: {bucket_size}")
    bucket_td = timedelta(hours=hours)
    ts_e = _to_utc(ts)

    dhi_raw, dhi_z = await _compute_dhi(symbol, ts_e, bucket_td, bucket_size, db)
    sps_mean, sps_std, sps_count = await _compute_sps(symbol, ts_e, bucket_td, db)
    em_lcr, em_sr, em_rda = await _compute_em(symbol, ts_e, bucket_td, db)
    ms_n, ms_sent, ms_tesla = await _compute_ms(ts_e, bucket_td, db)
    vix_lvl, vix_chg, vix_reg, vfs_comp = await _compute_vfs(ts_e, bucket_td, db)

    em_score = _em_components_to_score(em_lcr, em_sr, em_rda)
    ms_score = _ms_to_score(ms_sent, ms_tesla, ms_n or 0)

    tarco, sig = _compute_tarco_score(
        float(dhi_z) if dhi_z is not None else None,
        float(sps_mean) if sps_mean is not None else None,
        em_score,
        ms_score,
        vfs_comp,
        vix_reg,
    )

    row = {
        "symbol": symbol,
        "ts": ts_e,
        "bucket_size": bucket_size,
        "dhi_raw": dhi_raw,
        "dhi_zscore": dhi_z,
        "sps_mean": sps_mean,
        "sps_std": sps_std,
        "sps_count": sps_count,
        "em_like_comment_ratio": em_lcr,
        "em_share_rate": em_sr,
        "em_reply_depth_avg": em_rda,
        "ms_tweet_count": ms_n,
        "ms_sentiment": ms_sent,
        "ms_tesla_mention": ms_tesla,
        "vix_level": vix_lvl,
        "vix_change": vix_chg,
        "vix_regime": vix_reg,
        "tarco_score": Decimal(str(round(tarco, 2))),
        "tarco_signal": sig,
    }

    ins = pg_insert(Indicator).values(**row)
    ins = ins.on_conflict_do_update(
        index_elements=["symbol", "ts", "bucket_size"],
        set_={
            "dhi_raw": ins.excluded.dhi_raw,
            "dhi_zscore": ins.excluded.dhi_zscore,
            "sps_mean": ins.excluded.sps_mean,
            "sps_std": ins.excluded.sps_std,
            "sps_count": ins.excluded.sps_count,
            "em_like_comment_ratio": ins.excluded.em_like_comment_ratio,
            "em_share_rate": ins.excluded.em_share_rate,
            "em_reply_depth_avg": ins.excluded.em_reply_depth_avg,
            "ms_tweet_count": ins.excluded.ms_tweet_count,
            "ms_sentiment": ins.excluded.ms_sentiment,
            "ms_tesla_mention": ins.excluded.ms_tesla_mention,
            "vix_level": ins.excluded.vix_level,
            "vix_change": ins.excluded.vix_change,
            "vix_regime": ins.excluded.vix_regime,
            "tarco_score": ins.excluded.tarco_score,
            "tarco_signal": ins.excluded.tarco_signal,
        },
    )
    await db.execute(ins)
    await db.commit()

    result = (
        await db.execute(
            select(Indicator).where(
                Indicator.symbol == symbol,
                Indicator.ts == ts_e,
                Indicator.bucket_size == bucket_size,
            )
        )
    ).scalar_one()
    return result


async def compute_all_buckets(
    symbol: str,
    bucket_size: str,
    hours_back: int,
    db: AsyncSession,
) -> None:
    hours = BUCKET_HOURS.get(bucket_size)
    if hours is None:
        raise ValueError(f"Unknown bucket_size: {bucket_size}")
    bucket_td = timedelta(hours=hours)

    now = datetime.now(timezone.utc)
    ts = now
    end_floor = now - timedelta(hours=hours_back)

    while ts > end_floor:
        try:
            await compute_indicators(symbol, bucket_size, ts, db)
        except Exception:
            logger.exception(
                "compute_all_buckets failed symbol=%s bucket=%s ts=%s",
                symbol,
                bucket_size,
                ts.isoformat(),
            )
        ts -= bucket_td
