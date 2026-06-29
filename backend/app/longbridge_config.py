from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.config import Settings


def create_longbridge_config(
    app_key: str,
    app_secret: str,
    access_token: str,
) -> Any:
    from longbridge.openapi import Config

    if hasattr(Config, "from_apikey"):
        return Config.from_apikey(
            app_key=app_key,
            app_secret=app_secret,
            access_token=access_token,
        )
    return Config(
        app_key=app_key,
        app_secret=app_secret,
        access_token=access_token,
    )


def get_longbridge_config(settings: "Settings | None" = None) -> Any:
    from app.config import get_settings

    s = settings or get_settings()
    return create_longbridge_config(
        app_key=s.LONGBRIDGE_APP_KEY,
        app_secret=s.LONGBRIDGE_APP_SECRET,
        access_token=s.LONGBRIDGE_ACCESS_TOKEN,
    )
