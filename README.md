# Tarco

TSLA 行情采集与分析平台，前后端分离架构。

## 端口


| 服务                          | 默认端口   | 说明                                    |
| --------------------------- | ------ | ------------------------------------- |
| Backend (FastAPI + Uvicorn) | `8000` | API 服务                                |
| Frontend (Vite dev server)  | `5173` | 开发服务器，`/api` 请求代理到后端 `localhost:8000` |
| PostgreSQL                  | `5432` | 数据库                                   |


## 后端配置

后端通过 `backend/.env` 文件读取配置（基于 pydantic-settings），模板见 `backend/.env.example`。

### 数据库

| 变量             | 默认值                                                              | 说明            |
| -------------- | ---------------------------------------------------------------- | ------------- |
| `DATABASE_URL` | `postgresql+asyncpg://tarco:tarco_dev_2025@localhost:5432/tarco` | PostgreSQL 异步连接串，格式 `postgresql+asyncpg://user:password@host:port/dbname` |

应用启动时会自动执行 `CREATE TABLE IF NOT EXISTS`，无需手动建表。如需迁移可使用 `alembic`。

### 长桥 OpenAPI

行情数据和社区话题/评论通过长桥 OpenAPI 获取，需在 [长桥开放平台](https://open.longbridgeapp.com) 注册开发者账号。

| 变量                        | 默认值 | 说明          |
| ------------------------- | --- | ----------- |
| `LONGBRIDGE_APP_KEY`      | —   | 开发者 App Key |
| `LONGBRIDGE_APP_SECRET`   | —   | 开发者 App Secret |
| `LONGBRIDGE_ACCESS_TOKEN` | —   | 用户 Access Token（长期有效） |

**获取步骤：**

1. 前往 https://open.longbridgeapp.com 注册并完成实名认证
2. 在「我的应用」创建应用，获得 `App Key` 和 `App Secret`
3. 在「令牌管理」生成 Access Token（建议勾选"行情"和"社区"权限）
4. 将三个值填入 `backend/.env`

**用途：**
- **行情采集**（`quote_collector`）：通过 SDK 的 `QuoteContext` 获取实时报价和 K 线
- **社区话题/评论采集**（`topic_collector`）：通过 REST API `/v1/content/topics` 获取讨论帖及回复，用于情绪分析

### 采集标的与推文

| 变量               | 默认值        | 说明                              |
| ---------------- | ---------- | ------------------------------- |
| `COLLECT_SYMBOL` | `TSLA.US`  | 要采集的股票代码，格式 `SYMBOL.MARKET`（如 `TSLA.US`、`700.HK`） |
| `MUSK_USERNAME`  | `elonmusk` | 推文采集目标用户名（用于 Musk Signal 指标）    |

### X (Twitter) 推文采集

推文采集使用 [twscrape](https://github.com/vladkens/twscrape) 库，需要提供至少一个 X 账号。

| 变量                 | 默认值  | 说明                     |
| ------------------ | ---- | ---------------------- |
| `TWITTER_ACCOUNTS` | `[]` | JSON 数组，每个元素为一个账号对象    |

**账号格式：**

```json
[
  {
    "username": "your_x_username",
    "password": "your_password",
    "email": "your_email@example.com",
    "email_password": "your_email_password",
    "cookies": "auth_token=xxx;ct0=yyy"
  }
]
```

- `cookies` 字段可选，提供时直接使用 cookie 认证（更稳定、不触发登录流程）
- 不提供 `cookies` 时 twscrape 会自动执行登录（可能遇到验证码等问题）
- 可配置多个账号以提升采集稳定性

### 采集器开关

每个采集器可独立启/停，设为 `false` 时定时任务不会注册该采集器。

| 变量                        | 默认值     | 周期       | 说明                             |
| ------------------------- | ------- | -------- | ------------------------------ |
| `COLLECTOR_QUOTE_ENABLED` | `true`  | 每 5 分钟  | 长桥行情报价与 K 线采集                  |
| `COLLECTOR_TOPIC_ENABLED` | `true`  | 每 30 分钟 | 长桥社区话题 + 回复采集（情绪分析数据源）         |
| `COLLECTOR_TWEET_ENABLED` | `false` | 每 10 分钟 | X 推文采集（需配置 `TWITTER_ACCOUNTS`） |
| `COLLECTOR_VIX_ENABLED`   | `false` | 每 5 分钟  | CBOE VIX 恐慌指数采集（通过 yfinance）   |

### 日志

| 变量          | 默认值    | 说明                                         |
| ----------- | ------ | ------------------------------------------ |
| `LOG_DIR`   | `logs` | 日志文件目录（相对于 `backend/` 工作目录）                 |
| `LOG_LEVEL` | `INFO` | 日志级别（`DEBUG` / `INFO` / `WARNING` / `ERROR`） |

日志文件会自动按大小轮转，输出到 `{LOG_DIR}/tarco.log`，同时在控制台输出。


## 情绪分析流水线

长桥社区话题和用户评论会被自动整理为情绪指标，流程如下：

```
topic_collector 采集话题 + 回复
       ↓
  topics / topic_replies 表
       ↓
SentimentAnalyzer.analyze_unscored()
  · 使用 SnowNLP 对中文文本做情感打分
  · score 范围 [-1, 1]（正面 > 0.3, 负面 < -0.3, 中性居中）
  · 结果写入 sentiment_scores 表
       ↓
indicator_engine._compute_sps()
  · 在时间窗口内聚合 sentiment_scores
  · 按点赞数加权，计算加权平均情绪分 (SPS)
       ↓
  tarco_score 综合评分（SPS 占权 30%）
```

**数据源：**
- `topic` — 话题帖标题 + 描述
- `topic_reply` — 话题回复正文
- `tweet` — 推文正文（如启用推文采集）

**定时触发：** 每 15 分钟由调度器触发，先执行情绪分析再计算指标。


## 启动

### 1. 数据库

确保 PostgreSQL 已运行，且已创建 `tarco` 数据库和用户（或按 `.env` 中的配置调整）。应用启动时会自动建表。

```bash
# 示例：创建数据库和用户
psql -U postgres -c "CREATE USER tarco WITH PASSWORD 'tarco_dev_2025';"
psql -U postgres -c "CREATE DATABASE tarco OWNER tarco;"
```

### 2. 后端

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env  # 首次运行，填入长桥凭证等配置
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
      → 情绪分析 + 指标计算 (每 15 min)
  → 开始接收 HTTP 请求
```
