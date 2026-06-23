from __future__ import annotations

import os
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.config import ENV_FILE, get_settings
from app.routers.auth import require_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])

LONGBRIDGE_TOKEN_KEY = "LONGBRIDGE_ACCESS_TOKEN"


class LongbridgeTokenStatus(BaseModel):
    configured: bool
    token_preview: str | None
    env_file: str


class LongbridgeTokenInput(BaseModel):
    access_token: str = Field(min_length=1, max_length=4096)


def _token_preview(token: str) -> str | None:
    if not token:
        return None
    if len(token) <= 8:
        return "*" * len(token)
    return f"{token[:4]}...{token[-4:]}"


def _encode_env_value(value: str) -> str:
    if "\n" in value or "\r" in value:
        raise HTTPException(status_code=400, detail="Token must be a single line")
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _write_env_value(path: Path, key: str, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    line_value = _encode_env_value(value)
    replacement = f"{key}={line_value}\n"
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True) if path.exists() else []
    pattern = re.compile(rf"^(\s*(?:export\s+)?)({re.escape(key)})(\s*=).*$")
    updated = False
    next_lines: list[str] = []

    for line in lines:
        match = pattern.match(line.rstrip("\r\n"))
        if match and not line.lstrip().startswith("#"):
            prefix = match.group(1)
            next_lines.append(f"{prefix}{key}={line_value}\n")
            updated = True
        else:
            next_lines.append(line)

    if not updated:
        if next_lines and not next_lines[-1].endswith(("\n", "\r")):
            next_lines[-1] += "\n"
        next_lines.append(replacement)

    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text("".join(next_lines), encoding="utf-8")
    if path.exists():
        tmp_path.chmod(path.stat().st_mode)
    else:
        tmp_path.chmod(0o600)
    tmp_path.replace(path)


@router.get("/longbridge-token", response_model=LongbridgeTokenStatus)
async def get_longbridge_token_status(_: str = Depends(require_admin)) -> LongbridgeTokenStatus:
    token = get_settings().LONGBRIDGE_ACCESS_TOKEN
    return LongbridgeTokenStatus(
        configured=bool(token),
        token_preview=_token_preview(token),
        env_file=str(ENV_FILE),
    )


@router.post("/longbridge-token", response_model=LongbridgeTokenStatus)
async def refresh_longbridge_token(
    payload: LongbridgeTokenInput,
    _: str = Depends(require_admin),
) -> LongbridgeTokenStatus:
    access_token = payload.access_token.strip()
    if not access_token:
        raise HTTPException(status_code=400, detail="Token must not be empty")

    _write_env_value(ENV_FILE, LONGBRIDGE_TOKEN_KEY, access_token)
    os.environ[LONGBRIDGE_TOKEN_KEY] = access_token
    get_settings.cache_clear()

    return LongbridgeTokenStatus(
        configured=True,
        token_preview=_token_preview(access_token),
        env_file=str(ENV_FILE),
    )
