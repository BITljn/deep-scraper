from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Request, Response

router = APIRouter(prefix="/api/auth", tags=["auth"])

SESSION_COOKIE = "tarco_session"
SESSION_VALUE = "admin"
LOGIN_USERNAME = "admin"
LOGIN_PASSWORD = "123456"


class LoginInput(BaseModel):
    username: str
    password: str


def _auth_user(request: Request) -> str | None:
    if request.cookies.get(SESSION_COOKIE) == SESSION_VALUE:
        return LOGIN_USERNAME
    return None


@router.post("/login")
async def login(payload: LoginInput, response: Response) -> dict[str, str]:
    if payload.username != LOGIN_USERNAME or payload.password != LOGIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    response.set_cookie(
        key=SESSION_COOKIE,
        value=SESSION_VALUE,
        max_age=60 * 60 * 24 * 7,
        httponly=True,
        samesite="lax",
        secure=False,
        path="/",
    )
    return {"username": LOGIN_USERNAME}


@router.get("/me")
async def me(request: Request) -> dict[str, str]:
    username = _auth_user(request)
    if not username:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {"username": username}


@router.post("/logout")
async def logout(response: Response) -> dict[str, str]:
    response.delete_cookie(key=SESSION_COOKIE, path="/", samesite="lax")
    return {"status": "ok"}
