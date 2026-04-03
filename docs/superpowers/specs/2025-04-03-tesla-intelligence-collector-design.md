# Tesla Intelligence Collector (Tarco) — Design Spec

## Goal

Build a web-based Tesla intelligence dashboard that aggregates stock price, community sentiment, and Elon Musk tweets, computes composite sentiment indicators, and provides backtesting against historical price data. First version focuses on Tesla only; architecture supports future multi-stock expansion.

## Data Sources

### 1. Stock Price — Longbridge QuoteContext

| Capability | API Method | Notes |
|-----------|-----------|-------|
| Real-time quote | `ctx.quote(["TSLA.US"])` | Last price, volume, change, market cap |
| Candlesticks (K-line) | `ctx.candlesticks("TSLA.US", Period.Day, count, AdjustType)` | Max 1000 bars per call |
| Historical candlesticks | `ctx.history_candlesticks(...)` | Date-range query, max 1000 per call |

Periods: `Min1, Min5, Min15, Min30, Min60, Day, Week, Month, Year`.

### 2. Community Sentiment — Longbridge ContentContext

| Capability | API Method | Response Fields |
|-----------|-----------|-----------------|
| Topic list | `ctx.topics("TSLA.US")` | id, title, description, url, published_at, comments_count, likes_count, shares_count |
| Topic replies | `ctx.list_topic_replies(topic_id, page, size)` | id, body, author (member_id, name), reply_to_id, likes_count, comments_count, created_at |

### 3. Elon Musk Tweets — x-tweet-fetcher

Open-source Python library. Fetches tweets via Nitter backend without login or API keys.

- Fetches user timeline by username
- Returns tweet text, timestamp, likes, retweets, replies
- Fallback modes: Nitter (fastest) → Playwright (browser-based)
- Risk: Nitter instances can be unstable; the collector must handle failures gracefully

### 4. Financial News — Longbridge or RSS (Phase 2)

Deferred to a later phase. The architecture will include a `NewsCollector` interface for future integration.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      React Frontend                          │
│                                                              │
│  ┌────────────┐ ┌──────────────┐ ┌──────────┐ ┌───────────┐ │
│  │ Dashboard   │ │ Sentiment    │ │ Backtest │ │ Musk Feed │ │
│  │ (价格+指标) │ │ Panel(舆情)  │ │ Report   │ │ (推文流)  │ │
│  └────────────┘ └──────────────┘ └──────────┘ └───────────┘ │
│                                                              │
│  Manual Trigger Button: [🔄 拉取最新数据]                     │
└──────────────────────┬───────────────────────────────────────┘
                       │ REST API (JSON)
┌──────────────────────┴───────────────────────────────────────┐
│                      FastAPI Backend                          │
│                                                              │
│  Routers:                                                    │
│    /api/quotes      — 股价数据 CRUD + 实时报价                │
│    /api/sentiment   — 舆情指标查询                            │
│    /api/topics      — 长桥社区帖子和回复                      │
│    /api/tweets      — 马斯克推文                              │
│    /api/backtest    — 回测执行与结果                          │
│    /api/indicators  — 综合指标时间序列                        │
│    /api/collect     — 手动触发数据采集 (POST)                 │
│                                                              │
│  Services:                                                   │
│    CollectorService    — 调度各数据源采集器                   │
│    AnalysisService     — NLP分析 + 指标计算                   │
│    BacktestService     — 回测引擎                            │
│                                                              │
│  Scheduler (APScheduler):                                    │
│    - 股价采集: 每5分钟 (交易时段)                             │
│    - 舆情采集: 每30分钟                                      │
│    - 推文采集: 每60分钟                                      │
│    - 指标计算: 每次采集完成后触发                             │
└──────────────────────┬───────────────────────────────────────┘
                       │
┌──────────────────────┴───────────────────────────────────────┐
│                      PostgreSQL                               │
│                                                              │
│  Tables:                                                     │
│    stock_quotes       — OHLCV + 实时报价快照                  │
│    candlesticks       — K线数据 (多周期)                      │
│    topics             — 长桥社区帖子                          │
│    topic_replies      — 帖子回复                              │
│    tweets             — 马斯克推文                            │
│    sentiment_scores   — NLP情绪分析结果                       │
│    indicators         — 计算后的指标时间序列                  │
│    backtest_results   — 回测结果                              │
│    collect_jobs       — 采集任务状态追踪                      │
└──────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### stock_quotes

```sql
CREATE TABLE stock_quotes (
    id            BIGSERIAL PRIMARY KEY,
    symbol        VARCHAR(20) NOT NULL,       -- e.g. "TSLA.US"
    last_price    DECIMAL(12,4),
    open          DECIMAL(12,4),
    high          DECIMAL(12,4),
    low           DECIMAL(12,4),
    volume        BIGINT,
    turnover      DECIMAL(18,4),
    change_rate   DECIMAL(8,4),               -- percentage
    market_cap    DECIMAL(18,2),
    fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(symbol, fetched_at)
);
CREATE INDEX idx_quotes_symbol_time ON stock_quotes(symbol, fetched_at DESC);
```

### candlesticks

```sql
CREATE TABLE candlesticks (
    id         BIGSERIAL PRIMARY KEY,
    symbol     VARCHAR(20) NOT NULL,
    period     VARCHAR(10) NOT NULL,          -- "min1","min5","day","week" etc.
    ts         TIMESTAMPTZ NOT NULL,          -- candle open time
    open       DECIMAL(12,4),
    high       DECIMAL(12,4),
    low        DECIMAL(12,4),
    close      DECIMAL(12,4),
    volume     BIGINT,
    turnover   DECIMAL(18,4),
    UNIQUE(symbol, period, ts)
);
CREATE INDEX idx_candles_lookup ON candlesticks(symbol, period, ts DESC);
```

### topics

```sql
CREATE TABLE topics (
    id              VARCHAR(32) PRIMARY KEY,  -- Longbridge topic ID
    symbol          VARCHAR(20) NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT,
    url             TEXT,
    published_at    TIMESTAMPTZ NOT NULL,
    comments_count  INT DEFAULT 0,
    likes_count     INT DEFAULT 0,
    shares_count    INT DEFAULT 0,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_topics_symbol_time ON topics(symbol, published_at DESC);
```

### topic_replies

```sql
CREATE TABLE topic_replies (
    id              VARCHAR(32) PRIMARY KEY,
    topic_id        VARCHAR(32) NOT NULL REFERENCES topics(id),
    body            TEXT,
    reply_to_id     VARCHAR(32),              -- "0" = top-level
    author_id       VARCHAR(32),
    author_name     VARCHAR(128),
    likes_count     INT DEFAULT 0,
    comments_count  INT DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_replies_topic ON topic_replies(topic_id, created_at DESC);
```

### tweets

```sql
CREATE TABLE tweets (
    id              VARCHAR(64) PRIMARY KEY,  -- Tweet ID
    username        VARCHAR(64) NOT NULL,     -- "elonmusk"
    text            TEXT NOT NULL,
    published_at    TIMESTAMPTZ NOT NULL,
    likes_count     INT DEFAULT 0,
    retweets_count  INT DEFAULT 0,
    replies_count   INT DEFAULT 0,
    is_tesla_related BOOLEAN DEFAULT FALSE,   -- keyword match
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tweets_user_time ON tweets(username, published_at DESC);
```

### sentiment_scores

```sql
CREATE TABLE sentiment_scores (
    id              BIGSERIAL PRIMARY KEY,
    source_type     VARCHAR(20) NOT NULL,     -- "topic", "reply", "tweet"
    source_id       VARCHAR(64) NOT NULL,     -- FK to source table
    text_snippet    TEXT,                      -- first 500 chars analyzed
    score           DECIMAL(5,4) NOT NULL,    -- -1.0000 to +1.0000
    label           VARCHAR(10) NOT NULL,     -- "positive","negative","neutral"
    model_version   VARCHAR(32),              -- e.g. "finbert-v1"
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(source_type, source_id, model_version)
);
```

### indicators

```sql
CREATE TABLE indicators (
    id              BIGSERIAL PRIMARY KEY,
    symbol          VARCHAR(20) NOT NULL,
    ts              TIMESTAMPTZ NOT NULL,     -- time bucket
    bucket_size     VARCHAR(10) NOT NULL,     -- "1h", "4h", "1d"
    -- Discussion Heat Index
    dhi_raw         DECIMAL(8,4),
    dhi_zscore      DECIMAL(8,4),
    -- Sentiment Polarity Score
    sps_mean        DECIMAL(5,4),
    sps_std         DECIMAL(5,4),
    sps_count       INT,
    -- Engagement Metrics
    em_like_comment_ratio  DECIMAL(8,4),
    em_share_rate          DECIMAL(8,4),
    em_reply_depth_avg     DECIMAL(8,4),
    -- Musk Signal
    ms_tweet_count    INT,
    ms_sentiment      DECIMAL(5,4),
    ms_tesla_mention  BOOLEAN,
    -- Composite
    tarco_score       DECIMAL(5,2),           -- 0.00 to 100.00
    tarco_signal      VARCHAR(10),            -- "bullish","bearish","neutral"
    UNIQUE(symbol, ts, bucket_size)
);
CREATE INDEX idx_indicators_lookup ON indicators(symbol, bucket_size, ts DESC);
```

### backtest_results

```sql
CREATE TABLE backtest_results (
    id              BIGSERIAL PRIMARY KEY,
    symbol          VARCHAR(20) NOT NULL,
    indicator_name  VARCHAR(32) NOT NULL,     -- "tarco_score", "dhi", "sps" etc.
    window          VARCHAR(10) NOT NULL,     -- "1h","4h","1d","3d","1w"
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    -- Metrics
    pearson_corr    DECIMAL(6,4),
    spearman_corr   DECIMAL(6,4),
    signal_accuracy DECIMAL(5,4),             -- % of correct direction predictions
    avg_return      DECIMAL(8,4),             -- avg return following signal
    sharpe_ratio    DECIMAL(8,4),
    max_drawdown    DECIMAL(8,4),
    total_signals   INT,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### collect_jobs

```sql
CREATE TABLE collect_jobs (
    id              BIGSERIAL PRIMARY KEY,
    job_type        VARCHAR(20) NOT NULL,     -- "quote","topic","tweet","all"
    status          VARCHAR(20) NOT NULL,     -- "pending","running","completed","failed"
    trigger_type    VARCHAR(10) NOT NULL,     -- "manual","scheduled"
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    records_count   INT DEFAULT 0,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## Sentiment Indicator System

### 1. Discussion Heat Index (DHI)

Measures the rate of change in community activity.

```
posts_t     = count of new topics in time bucket t
comments_t  = sum of comments_count for topics in bucket t
engagement_t = sum of (likes + comments + shares) for topics in bucket t

DHI_raw = 0.4 × Δ(posts_t) + 0.3 × Δ(comments_t) + 0.3 × Δ(engagement_t)

where Δ(x) = (x_t - x_{t-1}) / x_{t-1}   (rate of change)

DHI_zscore = (DHI_raw - μ_30d) / σ_30d     (normalized against 30-day rolling stats)
```

**Interpretation**: DHI_zscore > 2.0 = abnormally hot; < -1.0 = abnormally quiet.

### 2. Sentiment Polarity Score (SPS)

NLP-based sentiment classification of text content.

- **Model**: `ProsusAI/finbert` (pre-trained for financial text, runs locally)
- **Inputs**: Topic titles + descriptions, reply body text, tweet text
- **Output per text**: score in [-1, +1], label (positive/negative/neutral)
- **Aggregation per bucket**:
  - `SPS_mean`: volume-weighted average sentiment
  - `SPS_std`: sentiment dispersion (high = divided opinions)
  - Weight: replies with more likes get higher weight

### 3. Engagement Metrics (EM)

Structural analysis of user interaction patterns.

```
like_comment_ratio = total_likes / max(total_comments, 1)
    High ratio (>5) = strong consensus
    Low ratio (<1)  = controversial, high debate

share_rate = total_shares / max(total_posts, 1)
    High = information spreading virally

reply_depth_avg = avg(max nested reply depth per topic)
    Deep threads = intensive discussion on specific points
```

### 4. Musk Signal (MS)

Tracks Elon Musk's Twitter activity as a leading indicator.

```
ms_tweet_count  = number of tweets in bucket
ms_sentiment    = FinBERT score of tweet text
ms_tesla_mention = any(keyword in tweet.text for keyword in TESLA_KEYWORDS)

TESLA_KEYWORDS = ["tesla", "tsla", "$tsla", "model s", "model 3", "model x",
                   "model y", "cybertruck", "megapack", "powerwall", "fsd",
                   "autopilot", "gigafactory", "supercharger"]
```

### 5. Tarco Score (Composite)

```
TarcoScore = w1 × normalize(DHI_zscore) +
             w2 × normalize(SPS_mean) +
             w3 × normalize(EM_composite) +
             w4 × normalize(MS_composite)

Default weights (before backtesting optimization):
  w1 = 0.25 (discussion heat)
  w2 = 0.35 (sentiment polarity — highest weight, most directly predictive)
  w3 = 0.15 (engagement structure)
  w4 = 0.25 (musk signal — historically high impact on TSLA)

normalize(): min-max scale to [0, 100] using 90-day rolling window

Signal:
  TarcoScore > 65 → "bullish"
  TarcoScore < 35 → "bearish"
  else → "neutral"
```

---

## Backtesting Engine

### Methodology

For each indicator I and forward window W:

1. Align indicator time series with price returns: `return(t, W) = (price(t+W) - price(t)) / price(t)`
2. Compute correlation: Pearson and Spearman rank correlation between I(t) and return(t, W)
3. Signal backtest: when I(t) crosses threshold, simulate long/short entry, measure outcome
4. Compute: accuracy, average return, Sharpe ratio, max drawdown

### Forward Windows

| Window | Purpose |
|--------|---------|
| 1h | Intraday reaction |
| 4h | Half-day momentum |
| 1d | Next-day effect |
| 3d | Short-term trend |
| 1w | Weekly outlook |

### Backtested Indicators

Each of these gets a full backtest report:
- DHI_zscore alone
- SPS_mean alone
- EM_composite alone
- MS_composite alone
- TarcoScore (composite)

### Weight Optimization

After initial backtesting with default weights, run a grid search over weight combinations to find the TarcoScore weights that maximize Sharpe ratio on the training period (first 70% of data), validated on the holdout (last 30%).

---

## Data Collection Strategy

### Scheduled Collection

| Data Source | Interval | Scope |
|------------|----------|-------|
| Stock quotes | Every 5 min (US market hours: 9:30-16:00 ET, pre/after hours: 4:00-20:00 ET) | Real-time snapshot |
| Candlesticks | Every 15 min (market hours) | Latest candles since last fetch |
| Community topics | Every 30 min | New/updated topics for TSLA.US |
| Topic replies | Every 30 min | New replies for active topics (last 7 days) |
| Musk tweets | Every 60 min | Latest tweets from @elonmusk |
| Indicator compute | After each collection cycle | Recompute current bucket |

### Manual Trigger

`POST /api/collect` accepts:
```json
{
  "job_type": "all" | "quote" | "topic" | "tweet",
  "symbol": "TSLA.US"
}
```

- Creates a `collect_jobs` record with `trigger_type="manual"`
- Runs the specified collectors immediately in background
- Returns job ID for polling status
- Frontend shows progress: pending → running → completed/failed
- Prevents duplicate concurrent jobs of the same type

### Incremental Logic

All collectors use **incremental fetching**:
- Quotes: always fetch latest snapshot (append-only)
- Candlesticks: fetch from last stored timestamp onward
- Topics: fetch full list, UPSERT by topic ID (update engagement counts)
- Replies: for each active topic, fetch from last stored reply timestamp
- Tweets: fetch timeline, skip already-stored tweet IDs

---

## Frontend Design

### Pages

**1. Dashboard (Home)**
- Hero: Current TSLA price, change %, TarcoScore gauge (0-100)
- K-line chart (ECharts) with indicator overlays (DHI, SPS as subplot)
- Manual trigger button: `[🔄 拉取最新数据]` with status indicator
- Last update timestamp

**2. Sentiment Panel**
- Community topic list (sortable by time, engagement, sentiment)
- Sentiment trend chart (SPS over time)
- DHI heatmap showing activity bursts
- Word cloud from recent topics/replies (Phase 2)

**3. Musk Feed**
- Tweet timeline with sentiment color coding (green/red/gray)
- Musk activity chart (tweet frequency)
- Tesla-mention highlights

**4. Backtest Report**
- Indicator selector + window selector
- Correlation table (all indicators × all windows)
- Equity curve chart for signal strategy
- Metrics cards: Sharpe, accuracy, max drawdown
- Indicator vs price overlay chart

### Component Library

- Charts: **ECharts** (via echarts-for-react) — best K-line/financial chart support
- UI: **Ant Design** — comprehensive component library with good table/form/gauge support
- HTTP: **axios** with SWR-like polling for status updates
- State: **React Query (TanStack Query)** for server state management

---

## Backend Structure

```
backend/
├── app/
│   ├── main.py                    # FastAPI app, lifespan, scheduler setup
│   ├── config.py                  # Settings from env vars
│   ├── database.py                # SQLAlchemy async engine + session
│   ├── models/                    # SQLAlchemy ORM models
│   │   ├── quote.py
│   │   ├── candlestick.py
│   │   ├── topic.py
│   │   ├── tweet.py
│   │   ├── sentiment.py
│   │   ├── indicator.py
│   │   ├── backtest.py
│   │   └── collect_job.py
│   ├── routers/                   # API route handlers
│   │   ├── quotes.py
│   │   ├── sentiment.py
│   │   ├── tweets.py
│   │   ├── indicators.py
│   │   ├── backtest.py
│   │   └── collect.py
│   ├── collectors/                # Data source adapters
│   │   ├── base.py                # Abstract BaseCollector
│   │   ├── quote_collector.py     # Longbridge QuoteContext
│   │   ├── topic_collector.py     # Longbridge ContentContext
│   │   ├── tweet_collector.py     # x-tweet-fetcher wrapper
│   │   └── manager.py            # CollectorManager: orchestrates all
│   ├── analysis/                  # Indicator computation
│   │   ├── sentiment_analyzer.py  # FinBERT NLP pipeline
│   │   ├── indicator_engine.py    # DHI, SPS, EM, MS, TarcoScore
│   │   └── backtest_engine.py     # Backtesting logic
│   └── scheduler.py               # APScheduler job definitions
├── alembic/                       # DB migrations
├── requirements.txt
└── .env.example
```

### Frontend Structure

```
frontend/
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── api/                       # API client functions
│   │   ├── client.ts              # axios instance
│   │   ├── quotes.ts
│   │   ├── sentiment.ts
│   │   ├── tweets.ts
│   │   ├── indicators.ts
│   │   ├── backtest.ts
│   │   └── collect.ts
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── SentimentPanel.tsx
│   │   ├── MuskFeed.tsx
│   │   └── BacktestReport.tsx
│   ├── components/
│   │   ├── PriceChart.tsx         # ECharts K-line
│   │   ├── TarcoGauge.tsx         # Score gauge
│   │   ├── IndicatorChart.tsx     # Indicator overlays
│   │   ├── TopicList.tsx
│   │   ├── TweetCard.tsx
│   │   ├── CollectButton.tsx      # Manual trigger
│   │   ├── BacktestTable.tsx
│   │   └── EquityCurve.tsx
│   └── hooks/
│       ├── useCollectJob.ts       # Poll job status
│       └── useIndicators.ts
├── package.json
├── vite.config.ts
└── tsconfig.json
```

---

## Future Expansion (Phase 2 — Real-time Streaming)

The architecture is designed so Phase 2 can add:
- **WebSocket endpoint** in FastAPI for real-time price push (using Longbridge's subscribe API)
- **Server-Sent Events** or WebSocket on frontend for live dashboard updates
- **CollectorManager** already abstracts data source; adding a `StreamingQuoteCollector` is additive
- **Multi-stock support**: all tables already have a `symbol` column; add a `watchlist` table and UI for managing tracked stocks

---

## Tech Stack Summary

| Layer | Technology | Version |
|-------|-----------|---------|
| Backend | Python 3.11+ | |
| API Framework | FastAPI | latest |
| ORM | SQLAlchemy 2.0 (async) | |
| DB Migration | Alembic | |
| Scheduler | APScheduler 3.x | |
| NLP | transformers + ProsusAI/finbert | |
| Longbridge SDK | longbridge (PyPI) | |
| Tweet Fetcher | x-tweet-fetcher | |
| Database | PostgreSQL 16 | |
| Frontend | React 18 + TypeScript | |
| Build Tool | Vite | |
| UI Library | Ant Design 5 | |
| Charts | ECharts (echarts-for-react) | |
| HTTP Client | axios | |
| Server State | TanStack Query | |

---

## Non-Goals (Explicit Exclusions)

- No trading execution (read-only intelligence)
- No user authentication (single-user tool)
- No mobile app
- No multi-language UI (Chinese primary, English data labels)
- No real-time streaming in Phase 1
- No news aggregation in Phase 1
