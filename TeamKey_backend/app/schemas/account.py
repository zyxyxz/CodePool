from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, Field

from app.models.account import TotpAlgorithm


class AccountCreate(BaseModel):
    team_id: int
    otpauth_url: str | None = None
    secret: str | None = None
    issuer: str | None = None
    label: str | None = None
    digits: int | None = Field(default=6, ge=6, le=8)
    period: int | None = Field(default=30, ge=15, le=120)
    algorithm: TotpAlgorithm | None = TotpAlgorithm.SHA1
    account_identifier: str | None = None
    remark: str | None = Field(default=None, max_length=200)


class AccountUpdate(BaseModel):
    issuer: str | None = None
    label: str | None = None
    account_identifier: str | None = None
    digits: int | None = Field(default=None, ge=6, le=8)
    period: int | None = Field(default=None, ge=15, le=120)
    algorithm: TotpAlgorithm | None = None
    remark: str | None = Field(default=None, max_length=200)


class AccountResponse(BaseModel):
    id: int
    team_id: int
    issuer: str
    label: str
    account_identifier: str | None
    remark: str | None = None
    digits: int
    period: int
    algorithm: TotpAlgorithm
    created_at: datetime
    updated_at: datetime

    class Config:
        use_enum_values = True
        from_attributes = True


class TotpResponse(BaseModel):
    account_id: int
    code: str
    period: int
    expires_in: int
