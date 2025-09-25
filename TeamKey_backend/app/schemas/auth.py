from __future__ import annotations

from pydantic import BaseModel


class LoginRequest(BaseModel):
    wx_code: str
    nickname: str | None = None
    avatar_url: str | None = None
    open_id: str | None = None
    openId: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict
