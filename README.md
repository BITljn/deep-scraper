# Tarco

TSLA 行情采集与分析平台，前后端分离架构。

## 端口


| 服务                          | 默认端口   | 说明                                    |
| --------------------------- | ------ | ------------------------------------- |
| Backend (FastAPI + Uvicorn) | `8000` | API 服务                                |
| Frontend (Vite dev server)  | `5173` | 开发服务器，`/api` 请求代理到后端 `localhost:8000` |
| PostgreSQL                  | `5432` | 数据库                                   |


## 配置

后端通过 `backend/.env` 文件读取配置（基于 pydantic-settings），可用变量：


| 变量                        | 默认值                                                              | 说明                |
| ------------------------- | ---------------------------------------------------------------- | ----------------- |
| `DATABASE_URL`            | `postgresql+asyncpg://tarco:tarco_dev_2025@localhost:5432/tarco` | 数据库连接串            |
| `LONGBRIDGE_APP_KEY`      | —                                                                | 长桥 API Key        |
| `LONGBRIDGE_APP_SECRET`   | —                                                                | 长桥 API Secret     |
| `LONGBRIDGE_ACCESS_TOKEN` | —                                                                | 长桥 Access Token   |
| `NITTER_URL`              | `https://nitter.net`                                             | Nitter 实例地址       |
| `COLLECT_SYMBOL`          | `TSLA.US`                                                        | 采集标的              |
| `MUSK_USERNAME`           | `elonmusk`                                                       | 推文采集用户名           |
| `COLLECTOR_QUOTE_ENABLED` | `true`                                                           | 启用行情采集（每 5 分钟）    |
| `COLLECTOR_TOPIC_ENABLED` | `true`                                                           | 启用话题采集（每 30 分钟）   |
| `COLLECTOR_TWEET_ENABLED` | `false`                                                          | 启用推文采集（每 10 分钟）   |
| `COLLECTOR_VIX_ENABLED`   | `false`                                                          | 启用 VIX 采集（每 5 分钟） |
| `LOG_DIR`                 | `logs`                                                           | 日志目录              |
| `LOG_LEVEL`               | `INFO`                                                           | 日志级别              |


## 启动

### 1. 数据库

确保 PostgreSQL 已运行，且已创建 `tarco` 数据库和用户（或按 `.env` 中的配置调整）。应用启动时会自动建表。

### 2. 后端

```bash
cd backend
pip install -r requirements.txt
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

```
uvicorn 启动
  → FastAPI lifespan 回调
    → init_db()         # 连接数据库并自动建表
    → start_scheduler() # 启动 APScheduler 定时任务
      → quote  采集 (每 5 min)
      → topic  采集 (每 30 min)
      → tweet  采集 (每 10 min, 默认关闭)
      → vix    采集 (每 5 min, 默认关闭)
      → 指标计算         (每 15 min)
  → 开始接收 HTTP 请求
```

