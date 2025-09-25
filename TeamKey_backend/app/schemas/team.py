from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel

from app.models.team_membership import TeamRole


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
