import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app.routers import admin


@pytest.fixture(autouse=True)
def clear_settings_cache() -> None:
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_login_rejects_wrong_password_without_session_cookie() -> None:
    client = TestClient(app)

    response = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})

    assert response.status_code == 401
    assert "tarco_session" not in response.cookies


def test_login_sets_session_cookie_and_me_returns_user() -> None:
    client = TestClient(app)

    response = client.post("/api/auth/login", json={"username": "admin", "password": "123456"})

    assert response.status_code == 200
    assert response.json() == {"username": "admin"}
    assert response.cookies.get("tarco_session")

    me_response = client.get("/api/auth/me")

    assert me_response.status_code == 200
    assert me_response.json() == {"username": "admin"}


def test_logout_clears_session_cookie() -> None:
    client = TestClient(app)
    client.post("/api/auth/login", json={"username": "admin", "password": "123456"})

    response = client.post("/api/auth/logout")

    assert response.status_code == 200
    assert response.cookies.get("tarco_session") is None
    assert client.get("/api/auth/me").status_code == 401


def test_admin_longbridge_token_requires_login() -> None:
    client = TestClient(app)

    response = client.get("/api/admin/longbridge-token")

    assert response.status_code == 401


def test_admin_longbridge_token_updates_env_file(tmp_path, monkeypatch) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text('DATABASE_URL="postgresql://example"\nLONGBRIDGE_ACCESS_TOKEN="old-token"\n', encoding="utf-8")
    monkeypatch.setattr(admin, "ENV_FILE", env_file)
    monkeypatch.delenv("LONGBRIDGE_ACCESS_TOKEN", raising=False)
    get_settings.cache_clear()
    client = TestClient(app)
    client.post("/api/auth/login", json={"username": "admin", "password": "123456"})

    response = client.post("/api/admin/longbridge-token", json={"access_token": "new-token-1234"})

    assert response.status_code == 200
    assert response.json()["configured"] is True
    assert response.json()["token_preview"] == "new-...1234"
    assert 'LONGBRIDGE_ACCESS_TOKEN="new-token-1234"' in env_file.read_text(encoding="utf-8")
    assert get_settings().LONGBRIDGE_ACCESS_TOKEN == "new-token-1234"


def test_admin_longbridge_token_status_returns_preview(monkeypatch) -> None:
    monkeypatch.setenv("LONGBRIDGE_ACCESS_TOKEN", "abcd1234wxyz")
    client = TestClient(app)
    client.post("/api/auth/login", json={"username": "admin", "password": "123456"})

    response = client.get("/api/admin/longbridge-token")

    assert response.status_code == 200
    assert response.json()["configured"] is True
    assert response.json()["token_preview"] == "abcd...wxyz"
    assert "abcd1234wxyz" not in response.text


def test_admin_longbridge_token_rejects_blank_token(tmp_path, monkeypatch) -> None:
    env_file = tmp_path / ".env"
    monkeypatch.setattr(admin, "ENV_FILE", env_file)
    client = TestClient(app)
    client.post("/api/auth/login", json={"username": "admin", "password": "123456"})

    response = client.post("/api/admin/longbridge-token", json={"access_token": "   "})

    assert response.status_code == 400
    assert not env_file.exists()


def test_admin_longbridge_token_rejects_multiline_token(tmp_path, monkeypatch) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text('LONGBRIDGE_ACCESS_TOKEN="old-token"\n', encoding="utf-8")
    monkeypatch.setattr(admin, "ENV_FILE", env_file)
    client = TestClient(app)
    client.post("/api/auth/login", json={"username": "admin", "password": "123456"})

    response = client.post("/api/admin/longbridge-token", json={"access_token": "new\ntoken"})

    assert response.status_code == 400
    assert env_file.read_text(encoding="utf-8") == 'LONGBRIDGE_ACCESS_TOKEN="old-token"\n'
