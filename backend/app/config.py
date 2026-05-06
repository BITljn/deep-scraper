from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://tarco:tarco_dev_2025@localhost:5432/tarco"
    LONGBRIDGE_APP_KEY: str = ""
    LONGBRIDGE_APP_SECRET: str = ""
    LONGBRIDGE_ACCESS_TOKEN: str = ""
    COLLECT_SYMBOL: str = "TSLA.US"

    COLLECTOR_QUOTE_ENABLED: bool = True
    COLLECTOR_VIX_ENABLED: bool = False

    LOG_DIR: str = "logs"
    LOG_LEVEL: str = "INFO"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    def is_collector_enabled(self, name: str) -> bool:
        key = f"COLLECTOR_{name.upper()}_ENABLED"
        return getattr(self, key, False)


@lru_cache
def get_settings() -> Settings:
    return Settings()
