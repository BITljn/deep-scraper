import sys
from types import ModuleType

from app.longbridge_config import create_longbridge_config


def _install_fake_longbridge(monkeypatch, config_cls: type) -> None:
    package = ModuleType("longbridge")
    openapi = ModuleType("longbridge.openapi")
    openapi.Config = config_cls
    package.openapi = openapi
    monkeypatch.setitem(sys.modules, "longbridge", package)
    monkeypatch.setitem(sys.modules, "longbridge.openapi", openapi)


def test_create_longbridge_config_supports_constructor_api(monkeypatch) -> None:
    class Config:
        def __init__(self, app_key: str, app_secret: str, access_token: str) -> None:
            self.args = (app_key, app_secret, access_token)

    _install_fake_longbridge(monkeypatch, Config)

    config = create_longbridge_config("key", "secret", "token")

    assert config.args == ("key", "secret", "token")


def test_create_longbridge_config_supports_legacy_from_apikey_api(monkeypatch) -> None:
    class Config:
        @classmethod
        def from_apikey(cls, app_key: str, app_secret: str, access_token: str) -> tuple[str, str, str]:
            return (app_key, app_secret, access_token)

    _install_fake_longbridge(monkeypatch, Config)

    config = create_longbridge_config("key", "secret", "token")

    assert config == ("key", "secret", "token")
