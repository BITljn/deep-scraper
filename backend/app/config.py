from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings


ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://tarco:tarco_dev_2025@localhost:5432/tarco"
    LONGBRIDGE_APP_KEY: str = ""
    LONGBRIDGE_APP_SECRET: str = ""
    LONGBRIDGE_ACCESS_TOKEN: str = ""
    COLLECT_SYMBOL: str = "TSLA.US"
    LONGBRIDGE_TAX_START_YEAR: int = 2019
    LONGBRIDGE_TAX_SYMBOLS: str = ""
    LONGBRIDGE_TAX_REQUEST_INTERVAL_SECONDS: float = 0.6
    LONGBRIDGE_TAX_ORDER_DETAIL_INTERVAL_SECONDS: float = 1.5
    LONGBRIDGE_TAX_MAX_RETRIES: int = 5
    LONGBRIDGE_TAX_BACKOFF_SECONDS: float = 3.0
    LONGBRIDGE_TAX_CACHE_ENABLED: bool = True
    LONGBRIDGE_TAX_CACHE_DIR: str = ".cache/longbridge_tax_sdk"
    TAX_FX_SOURCE_URL: str = "https://www.chinamoney.com.cn/ags/ms/cm-u-bk-ccpr/CcprHisNew"
    TAX_FX_SAFE_HISTORY_URL: str = "https://www.safe.gov.cn/safe/file/file/20260106/0f147e5357eb4c12a6406fc575cc21e8.xlsx"

    COLLECTOR_QUOTE_ENABLED: bool = True
    COLLECTOR_VIX_ENABLED: bool = False
    COLLECTOR_TAX_ENABLED: bool = False

    LOG_DIR: str = "logs"
    LOG_LEVEL: str = "INFO"

    model_config = {"env_file": ENV_FILE, "env_file_encoding": "utf-8", "extra": "ignore"}

    def is_collector_enabled(self, name: str) -> bool:
        key = f"COLLECTOR_{name.upper()}_ENABLED"
        return getattr(self, key, False)


@lru_cache
def get_settings() -> Settings:
    return Settings()
