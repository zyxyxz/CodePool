from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, Field

from app.models.share import ShareMode


class ShareCreate(BaseModel):
    account_id: int
    mode: ShareMode = ShareMode.CODE
    expires_in_minutes: int = Field(default=5, ge=1, le=1440)


class ShareResponse(BaseModel):
    id: int
    token: str
    mode: ShareMode
    expires_at: datetime
    used: bool

    class Config:
        use_enum_values = True
        from_attributes = True
