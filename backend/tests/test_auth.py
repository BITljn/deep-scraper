from fastapi.testclient import TestClient

from app.main import app


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
