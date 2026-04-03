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

### 4. VIX Fear Index — Yahoo Finance (yfinance)

CBOE Volatility Index (^VIX) measures market-wide fear/greed sentiment. Free via `yfinance` Python library.

| Capability | Method | Notes |
|-----------|--------|-------|
| Current VIX | `yf.Ticker("^VIX").info` | Real-time VIX level |
| Historical VIX | `yf.Ticker("^VIX").history(period="1y")` | Daily OHLC history |
| Intraday VIX | `yf.download("^VIX", interval="5m")` | 5-min intraday (last 60 days) |

VIX interpretation:
- < 15: Low fear, complacency
- 15-25: Normal range
- 25-35: Elevated fear
- > 35: Extreme fear / panic

VIX is a **contrarian signal** for growth stocks like TSLA — extreme fear (VIX spike) often precedes mean-reversion rallies; low VIX + bullish sentiment can signal complacency risk.

### 5. Financial News — Longbridge or RSS (Phase 2)

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
│    /api/vix         — VIX恐慌指数数据                        │
│                                                              │
│  Services:                                                   │
│    CollectorService    — 调度各数据源采集器                   │
│    AnalysisService     — NLP分析 + 指标计算                   │
│    BacktestService     — 回测引擎                            │
│                                                              │
│  Scheduler (APScheduler):                                    │
│    - 股价采集: 每5分钟 (交易时段)                             │
│    - 舆情采集: 每30分钟                                      │
│    - 推文采集: 每10分钟                                      │
│    - VIX采集: 每5分钟 (交易时段)                              │
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
│    vix_data           — VIX恐慌指数历史                       │
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

### vix_data

```sql
CREATE TABLE vix_data (
    id         BIGSERIAL PRIMARY KEY,
    ts         TIMESTAMPTZ NOT NULL,
    open       DECIMAL(8,4),
    high       DECIMAL(8,4),
    low        DECIMAL(8,4),
    close      DECIMAL(8,4),
    period     VARCHAR(10) NOT NULL DEFAULT 'day',  -- "5min","day"
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(ts, period)
);
CREATE INDEX idx_vix_time ON vix_data(ts DESC);
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
    -- VIX Fear Index
    vix_level         DECIMAL(8,4),
    vix_change        DECIMAL(8,4),           -- % change from previous bucket
    vix_regime        VARCHAR(10),            -- "low","normal","elevated","extreme"
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

### 5. VIX Fear Index Signal (VFS)

VIX as a contrarian/confirming indicator for TSLA positioning.

```
vix_level   = current VIX close value
vix_change  = (vix_t - vix_{t-1}) / vix_{t-1}   (rate of change)
vix_regime:
    < 15  → "low"       (complacency — contrarian risk for longs)
    15-25 → "normal"
    25-35 → "elevated"  (fear rising — watch for capitulation)
    > 35  → "extreme"   (panic — contrarian buy signal for growth stocks)

VFS_composite:
    When vix_regime="extreme" AND SPS trending positive → strong bullish signal
    When vix_regime="low" AND SPS turning negative → complacency risk signal
    When vix_change > +20% in one day → volatility shock event
```

The VIX signal is used both as a standalone indicator and as a **regime filter** for TarcoScore — the same SPS score has different implications in high-fear vs low-fear environments.

### 6. Tarco Score (Composite)

```
TarcoScore = w1 × normalize(DHI_zscore) +
             w2 × normalize(SPS_mean) +
             w3 × normalize(EM_composite) +
             w4 × normalize(MS_composite) +
             w5 × normalize(VFS_composite)

Default weights (before backtesting optimization):
  w1 = 0.20 (discussion heat)
  w2 = 0.30 (sentiment polarity — highest weight)
  w3 = 0.10 (engagement structure)
  w4 = 0.20 (musk signal — high impact on TSLA)
  w5 = 0.20 (VIX fear index — macro regime context)

normalize(): min-max scale to [0, 100] using 90-day rolling window

Signal:
  TarcoScore > 65 → "bullish"
  TarcoScore < 35 → "bearish"
  else → "neutral"

Regime-adjusted signal (Phase 1):
  When vix_regime="extreme":
    bullish threshold lowered to 55 (fear-driven opportunity)
    bearish threshold lowered to 25 (only strong bearish signals count in panic)
  When vix_regime="low":
    bullish threshold raised to 75 (require stronger conviction in complacent market)
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
- VFS_composite alone
- VIX_level alone (contrarian signals at extremes)
- TarcoScore (composite)
- TarcoScore regime-adjusted (with VIX-dynamic thresholds)

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
| Musk tweets | Every 10 min | Latest tweets from @elonmusk |
| VIX index | Every 5 min (market hours) | Real-time VIX snapshot |
| VIX daily history | Once daily (after market close) | Full day OHLC |
| Indicator compute | After each collection cycle | Recompute current bucket |

### Manual Trigger

`POST /api/collect` accepts:
```json
{
  "job_type": "all" | "quote" | "topic" | "tweet" | "vix",
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
- VIX: always fetch latest snapshot (append-only); daily history backfill on startup

---

## Frontend Design

### Visual Identity — Tesla / SpaceX Futuristic Aesthetic

The UI follows a **mission control / HUD** design language inspired by Tesla vehicle UI, SpaceX launch dashboards, and sci-fi command centers.

**Design System:**
- **Background**: Near-black (#0a0a0f) with subtle radial gradient mesh overlays
- **Surface**: Glassmorphism cards — `rgba(255,255,255,0.03)` with `backdrop-filter: blur(20px)`, thin `1px` borders at `rgba(255,255,255,0.06)`
- **Primary accent**: Electric cyan (#00d4ff) — used for key metrics, active states, chart highlights
- **Secondary accent**: Neon green (#00ff88) for bullish/positive, crimson red (#ff3366) for bearish/negative
- **Neutral text**: #e0e0e6 (primary), #6b6b7b (secondary)
- **Typography**: `Space Grotesk` (headings — geometric, technical), `JetBrains Mono` (numbers/data — monospaced for alignment), `Inter` (body text)
- **Glow effects**: Key metrics get a subtle `box-shadow: 0 0 30px rgba(0,212,255,0.15)` glow halo
- **Animations**: Staggered fade-in on page load, smooth number counting transitions, pulse glow on live data updates
- **Grid**: CSS Grid with asymmetric layouts — no boring equal-column rows; hero metrics get visual dominance
- **Micro-interactions**: Data refresh ripple effect, chart crosshair follows mouse with glow trail, card hover lift with border glow intensification

**Chart Theme:**
- Dark background, no grid lines (minimal axis ticks only)
- Candlestick: Hollow green up / solid red down, with volume bars in subtle translucent fill
- Line charts: Gradient fill under curve (cyan→transparent), line glow effect
- VIX overlay: Orange/amber color palette to contrast with TSLA cyan

### Pages

**1. Command Center (Dashboard Home)**
- **Hero row**: TSLA price (large, monospaced, with counting animation), change %, TarcoScore as radial gauge with gradient arc (red→amber→cyan→green), VIX level with regime badge (glowing color-coded pill)
- **K-line chart**: Full-width ECharts candlestick with dark theme, indicator overlays (DHI, SPS as subplot panels below), VIX as a faint amber line overlay on price chart
- **Indicator strip**: Horizontal row of mini spark-charts for each sub-indicator (DHI, SPS, EM, MS, VFS) — click to expand
- **Manual trigger**: Floating action button bottom-right with pulse animation, click → ripple + spinner → status toast
- **Live status bar**: Bottom strip showing last update times for each data source, connection health dots

**2. Sentiment Matrix**
- **Dual-axis chart**: SPS sentiment trend (cyan line) vs TSLA price (white line) on shared time axis, VIX regime background bands (green=low, transparent=normal, amber=elevated, red=extreme)
- **DHI heatmap**: Time × intensity grid showing community activity surges as heat blocks
- **Topic feed**: Scrolling card list with sentiment color bar on left edge (green/red/gray), engagement metrics as badge pills
- **Topic detail drawer**: Slide-in panel showing replies with threaded depth visualization

**3. Musk Signal**
- **Tweet timeline**: Vertical feed with glassmorphism cards, each showing tweet text, timestamp, engagement metrics, FinBERT sentiment color badge
- **Activity radar**: Circular chart showing tweet frequency by hour-of-day (when does Musk tweet about Tesla?)
- **Impact tracker**: Mini chart pairing each Tesla-related tweet with subsequent price movement (overlaid arrows)
- **Tesla mention filter**: Toggle to show only Tesla-keyword tweets

**4. VIX & Fear Dashboard**
- **VIX gauge**: Large radial gauge with regime zones color-coded (green < 15, white 15-25, amber 25-35, red > 35)
- **VIX vs TSLA correlation chart**: Dual-axis showing inverse relationship, with highlighted divergence zones
- **Regime history**: Timeline bar showing VIX regime changes over past 90 days
- **Fear-Greed crossover table**: When VIX spikes intersect with sentiment shifts, show marked events with price outcome

**5. Backtest Lab**
- **Control panel**: Dark selector cards for indicator × window combinations
- **Correlation matrix**: Heatmap grid (indicators vs windows) with color intensity = correlation strength
- **Equity curve**: Animated line chart of simulated strategy returns, with drawdown shading
- **Metrics dashboard**: Cards with glow borders showing Sharpe, accuracy, max drawdown, total signals
- **Split comparison**: Side-by-side indicator vs price overlay, synchronized zoom/pan

### Component Library

- **Styling**: **Tailwind CSS** — full custom control for the futuristic theme, no opinionated component library
- **Charts**: **ECharts** (via echarts-for-react) — best K-line/financial chart support, excellent dark theme
- **UI primitives**: **Radix UI** (headless) — accessible, unstyled primitives (dialogs, dropdowns, tooltips) that we skin ourselves
- **HTTP**: **axios** with interceptors
- **Server State**: **TanStack Query** — caching, polling, mutation management
- **Routing**: **React Router v7**
- **Animations**: **Framer Motion** — staggered entrances, layout animations, number morphing

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
│   │   ├── vix.py
│   │   ├── sentiment.py
│   │   ├── indicator.py
│   │   ├── backtest.py
│   │   └── collect_job.py
│   ├── routers/                   # API route handlers
│   │   ├── quotes.py
│   │   ├── sentiment.py
│   │   ├── tweets.py
│   │   ├── vix.py
│   │   ├── indicators.py
│   │   ├── backtest.py
│   │   └── collect.py
│   ├── collectors/                # Data source adapters
│   │   ├── base.py                # Abstract BaseCollector
│   │   ├── quote_collector.py     # Longbridge QuoteContext
│   │   ├── topic_collector.py     # Longbridge ContentContext
│   │   ├── tweet_collector.py     # x-tweet-fetcher wrapper
│   │   ├── vix_collector.py      # yfinance VIX data
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
│   ├── styles/
│   │   ├── globals.css            # Tailwind base + custom CSS vars + glow effects
│   │   └── theme.ts               # Color tokens, typography scale
│   ├── api/                       # API client functions
│   │   ├── client.ts              # axios instance
│   │   ├── quotes.ts
│   │   ├── sentiment.ts
│   │   ├── tweets.ts
│   │   ├── vix.ts
│   │   ├── indicators.ts
│   │   ├── backtest.ts
│   │   └── collect.ts
│   ├── pages/
│   │   ├── Dashboard.tsx          # Command Center
│   │   ├── SentimentMatrix.tsx    # Sentiment Matrix
│   │   ├── MuskSignal.tsx         # Musk Signal
│   │   ├── VixFear.tsx            # VIX & Fear Dashboard
│   │   └── BacktestLab.tsx        # Backtest Lab
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx       # Main layout with nav
│   │   │   ├── NavBar.tsx         # Side navigation
│   │   │   └── StatusBar.tsx      # Bottom live status strip
│   │   ├── charts/
│   │   │   ├── PriceChart.tsx     # ECharts K-line with dark theme
│   │   │   ├── TarcoGauge.tsx     # Radial score gauge with glow
│   │   │   ├── VixGauge.tsx       # VIX radial gauge with regime zones
│   │   │   ├── IndicatorChart.tsx # Indicator overlays
│   │   │   ├── HeatMap.tsx        # DHI activity heatmap
│   │   │   ├── CorrelationMatrix.tsx
│   │   │   └── EquityCurve.tsx
│   │   ├── cards/
│   │   │   ├── GlassCard.tsx      # Glassmorphism base card
│   │   │   ├── MetricCard.tsx     # Glowing metric display
│   │   │   ├── TopicCard.tsx      # Sentiment-colored topic card
│   │   │   └── TweetCard.tsx      # Tweet with sentiment badge
│   │   ├── CollectButton.tsx      # Floating action button with pulse
│   │   └── SparkLine.tsx          # Mini inline chart
│   └── hooks/
│       ├── useCollectJob.ts       # Poll job status
│       ├── useIndicators.ts
│       └── useAnimatedNumber.ts   # Counting animation hook
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
| VIX Data | yfinance | |
| Database | PostgreSQL 16 | |
| Frontend | React 18 + TypeScript | |
| Build Tool | Vite | |
| Styling | Tailwind CSS 4 | |
| UI Primitives | Radix UI (headless) | |
| Charts | ECharts (echarts-for-react) | |
| Animations | Framer Motion | |
| HTTP Client | axios | |
| Server State | TanStack Query | |
| Routing | React Router v7 | |

---

## Non-Goals (Explicit Exclusions)

- No trading execution (read-only intelligence)
- No user authentication (single-user tool)
- No mobile app
- No multi-language UI (Chinese primary, English data labels)
- No real-time streaming in Phase 1
- No news aggregation in Phase 1
