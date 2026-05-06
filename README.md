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

### 采集配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `COLLECT_SYMBOL` | `TSLA.US` | 要采集的股票代码 |
| `COLLECTOR_QUOTE_ENABLED` | `true` | 是否启用长桥日 K 线采集 |
| `COLLECTOR_VIX_ENABLED` | `false` | 是否启用 VIX 采集（yfinance） |

### 日志

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LOG_DIR` | `logs` | 日志文件目录（相对于 `backend/`） |
| `LOG_LEVEL` | `INFO` | 日志级别 |

## 功能

- Holdings：ARK、Berkshire Hathaway、Duan H&H 持仓与季度 13F 变动。
- Macro：美股市值 / GDP 最近 10 年季度数据。
- VIX：VIX 历史、风险状态，以及与 TSLA 日线收盘价的对比。
- Collect：手动或定时采集 TSLA 日 K 线和 VIX 数据。

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
