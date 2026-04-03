import logging
import os
import sys
from logging.handlers import RotatingFileHandler

from app.config import get_settings


def setup_logging() -> None:
    settings = get_settings()
    log_dir = settings.LOG_DIR
    log_level = getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO)

    os.makedirs(log_dir, exist_ok=True)

    fmt = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    file_handler = RotatingFileHandler(
        os.path.join(log_dir, "tarco.log"),
        maxBytes=10 * 1024 * 1024,  # 10 MB
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(fmt)
    file_handler.setLevel(log_level)

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(fmt)
    console_handler.setLevel(log_level)

    root = logging.getLogger()
    root.setLevel(log_level)
    root.addHandler(file_handler)
    root.addHandler(console_handler)

    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
