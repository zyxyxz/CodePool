from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, Field

from app.models.team_membership import TeamRole
from app.models.team_invite import TeamInviteMode


class TeamSummary(BaseModel):
    team_id: int
    name: str
    role: TeamRole
    owner_id: int
    created_at: datetime

    class Config:
        use_enum_values = True


class TeamCreate(BaseModel):
    name: str
    description: str | None = None




class TeamMemberAdd(BaseModel):
    user_id: int
    role: TeamRole = TeamRole.MEMBER

class TeamMember(BaseModel):
    user_id: int
    nickname: str | None
    avatar_url: str | None
    role: TeamRole
    joined_at: datetime

    class Config:
        use_enum_values = True


class UpdateMemberRole(BaseModel):
    role: TeamRole


class TeamInviteCreate(BaseModel):
    mode: TeamInviteMode
    expires_in_minutes: int = Field(default=60, ge=5, le=10080)


class TeamInviteResponse(BaseModel):
    id: int
    team_id: int
    inviter_id: int
    mode: TeamInviteMode
    token: str
    expires_at: datetime
    used: bool

    class Config:
        use_enum_values = True
