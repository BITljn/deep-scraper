# Tarco Current Scope

Tarco now focuses on two product areas:

- The Big Whale Watch: ARK, Berkshire Hathaway, and Duan H&H portfolio views.
- Macro: US market cap / GDP ratio for the last 10 years.
- VIX Fear Gauge: VIX history and TSLA daily close comparison.

## Backend

```text
backend/
├── app/
│   ├── main.py
│   ├── config.py
│   ├── database.py
│   ├── models/
│   │   ├── candlestick.py
│   │   ├── collect_job.py
│   │   ├── quote.py
│   │   └── vix.py
│   ├── routers/
│   │   ├── ark.py
│   │   ├── brk.py
│   │   ├── collect.py
│   │   ├── hh.py
│   │   ├── macro.py
│   │   ├── quotes.py
│   │   └── vix.py
│   ├── collectors/
│   │   ├── base.py
│   │   ├── manager.py
│   │   ├── quote_collector.py
│   │   └── vix_collector.py
│   └── scheduler.py
```

## Frontend

```text
frontend/src/
├── App.tsx
├── api/
│   ├── ark.ts
│   ├── brk.ts
│   ├── client.ts
│   ├── collect.ts
│   ├── hh.ts
│   ├── macro.ts
│   ├── quotes.ts
│   ├── types.ts
│   └── vix.ts
├── pages/
│   ├── HoldingsWatch.tsx
│   ├── MarketCapGdp.tsx
│   └── VixFear.tsx
└── components/
    ├── cards/
    ├── charts/
    └── layout/
```

## Data Jobs

- `quote`: Longbridge daily candlestick collection.
- `vix`: yfinance VIX daily history collection.
- `all`: runs `quote` and `vix`.

Legacy analysis and social-feed flows are intentionally removed.
