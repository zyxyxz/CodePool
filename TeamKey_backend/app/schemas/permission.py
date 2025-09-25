from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel

from app.models.account_permission import AccountPermissionType


class PermissionGrant(BaseModel):
    account_id: int
    user_id: int
    permission: AccountPermissionType
    expires_at: datetime | None = None


class PermissionResponse(BaseModel):
    user_id: int
    nickname: str | None
    permission: AccountPermissionType
    expires_at: datetime | None

    class Config:
        use_enum_values = True
