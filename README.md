# Tarco

持仓观察与 VIX 风险面板，前后端分离架构。

## 端口

| 服务 | 默认端口 | 说明 |
| --- | --- | --- |
| Backend (FastAPI + Uvicorn) | `8000` | API 服务 |
| Frontend (Vite dev server) | `5173` | 开发服务器，`/api` 请求代理到后端 `localhost:8000` |
| PostgreSQL | `5432` | 数据库 |

## 后端配置

后端通过 `backend/.env` 文件读取配置（基于 pydantic-settings），模板见 `backend/.env.example`。

### 数据库

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql+asyncpg://tarco:tarco_dev_2025@localhost:5432/tarco` | PostgreSQL 异步连接串 |

应用启动时会自动执行 `CREATE TABLE IF NOT EXISTS`。如需迁移可使用 `alembic`。

### 长桥 OpenAPI

TSLA K 线数据通过长桥 OpenAPI 获取，需在 [长桥开放平台](https://open.longbridgeapp.com) 注册开发者账号。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LONGBRIDGE_APP_KEY` | - | 开发者 App Key |
| `LONGBRIDGE_APP_SECRET` | - | 开发者 App Secret |
| `LONGBRIDGE_ACCESS_TOKEN` | - | 用户 Access Token |
| `LONGBRIDGE_TAX_START_YEAR` | `2019` | 境外证券税务流水采集起始年份 |
| `LONGBRIDGE_TAX_SYMBOLS` | - | 税务采集标的，逗号分隔；空值表示按 Longbridge 返回范围采集 |
| `LONGBRIDGE_TAX_REQUEST_INTERVAL_SECONDS` | `0.6` | 税务采集普通交易接口最小请求间隔 |
| `LONGBRIDGE_TAX_ORDER_DETAIL_INTERVAL_SECONDS` | `1.5` | 订单费用详情接口最小请求间隔 |
| `LONGBRIDGE_TAX_MAX_RETRIES` | `5` | 遇到 Longbridge 429 限频后的最大重试次数 |
| `LONGBRIDGE_TAX_BACKOFF_SECONDS` | `3.0` | 限频重试的初始退避秒数，后续指数增长 |
| `LONGBRIDGE_TAX_CACHE_ENABLED` | `true` | 是否优先读取本地 Longbridge 税务 JSONL 缓存 |
| `LONGBRIDGE_TAX_CACHE_DIR` | `.cache/longbridge_tax_sdk` | 本地税务 SDK 缓存目录 |

### 采集配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `COLLECT_SYMBOL` | `TSLA.US` | 要采集的股票代码 |
| `COLLECTOR_QUOTE_ENABLED` | `true` | 是否启用长桥日 K 线采集 |
| `COLLECTOR_VIX_ENABLED` | `false` | 是否启用 VIX 采集（yfinance） |
| `COLLECTOR_TAX_ENABLED` | `false` | 是否启用 Longbridge 境外证券税务流水采集 |

### 日志

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LOG_DIR` | `logs` | 日志文件目录（相对于 `backend/`） |
| `LOG_LEVEL` | `INFO` | 日志级别 |

## 功能

- Holdings：ARK、Berkshire Hathaway、Duan H&H 持仓与季度 13F 变动。
- Macro：美股市值 / GDP 最近 10 年季度数据。
- VIX：VIX 历史、风险状态，以及与 TSLA 日线收盘价的对比。
- CRS Tax：基于 Longbridge 历史成交、订单费用、股息/税费流水和人民币汇率，估算中国税收居民个人境外证券所得年度个税。
- Collect：手动或定时采集 TSLA 日 K 线和 VIX 数据。

### Longbridge 税务缓存工具

为避免反复触发 Longbridge `429002` 限频，可先把 SDK 数据拉到本地 JSONL 缓存，再让后端采集器优先读取缓存：

```bash
cd backend
python3 tools/longbridge_tax_cache.py fetch \
  --start-year 2025 --end-year 2025 \
  --request-interval 2.5 --detail-interval 8 \
  --backoff-seconds 30 --max-retries 6 \
  --with-order-details --max-order-details 20

python3 tools/longbridge_tax_cache.py validate --start-year 2025 --end-year 2025
python3 tools/longbridge_tax_cache.py summary --start-year 2025 --end-year 2025
```

调试格式时可先拉小窗口：

```bash
python3 tools/longbridge_tax_cache.py fetch \
  --start-date 2025-01-01 --end-date 2025-01-08 \
  --max-windows 1 --with-order-details --max-order-details 1
```

汇率可通过 API 从官方来源抓取并写入 `tax_fx_rates`：

```bash
curl -X POST http://localhost:8000/api/tax/fx-rates/fetch \
  -H 'Content-Type: application/json' \
  -d '{"start_date":"2024-01-01","end_date":"2025-12-31","currencies":["USD","HKD"]}'
```

接口优先使用中国货币网 / 中国外汇交易中心人民币汇率中间价历史接口；如果被官方站点限流或拦截，会回退到国家外汇管理局公开的历史 xlsx 文件。

## 启动

### 1. 数据库

```bash
psql -U postgres -c "CREATE USER tarco WITH PASSWORD 'tarco_dev_2025';"
psql -U postgres -c "CREATE DATABASE tarco OWNER tarco;"
```

### 2. 后端

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

启动后监听 `http://localhost:8000`。

### 3. 前端

```bash
cd frontend
npm install
npm run dev
```

启动后监听 `http://localhost:5173`。

## 启动流程

```text
uvicorn 启动
  -> FastAPI lifespan 回调
    -> init_db()         # 连接数据库并自动建表
    -> start_scheduler() # 启动 APScheduler 定时任务
      -> quote 采集 (每 5 min)
      -> vix   采集 (每 5 min, 默认关闭)
  -> 开始接收 HTTP 请求
```
