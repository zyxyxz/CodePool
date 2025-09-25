from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel


class UserBase(BaseModel):
    id: int
    open_id: str
    nickname: str | None
    avatar_url: str | None
    last_login_at: datetime | None

    class Config:
        from_attributes = True


class UserWithTeams(UserBase):
    teams: list["TeamSummary"] = []


from app.schemas.team import TeamSummary  # noqa: E402  circular reference fix
