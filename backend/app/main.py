from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.routers import backtest, collect, indicators, quotes, sentiment, tweets, vix
from app.scheduler import start_scheduler, stop_scheduler


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(quotes.router)
app.include_router(sentiment.router)
app.include_router(tweets.router)
app.include_router(vix.router)
app.include_router(indicators.router)
app.include_router(backtest.router)
app.include_router(collect.router)


@app.get("/")
async def root() -> dict[str, str]:
    return {"status": "ok", "service": "tarco"}
