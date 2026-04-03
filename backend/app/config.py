from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://tarco:tarco_dev_2025@localhost:5432/tarco"
    LONGBRIDGE_APP_KEY: str = ""
    LONGBRIDGE_APP_SECRET: str = ""
    LONGBRIDGE_ACCESS_TOKEN: str = ""
    NITTER_URL: str = "https://nitter.net"
    COLLECT_SYMBOL: str = "TSLA.US"
    MUSK_USERNAME: str = "elonmusk"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
