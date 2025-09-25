from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, Field
from pydantic import ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)


class CamelOrmModel(CamelModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, from_attributes=True)


class AdminLoginRequest(CamelModel):
    email: str
    password: str


class AdminBootstrapRequest(CamelModel):
    site_url: str
    admin_email: str
    admin_password: str
    db_dsn: str | None = None
    redis_dsn: str | None = None
    oss_conf: dict | None = None
    wx_app_id: str | None = None
    wx_secret: str | None = None
    mark_installed: bool = True


class AdminSettingsResponse(CamelOrmModel):
    site_url: str | None
    db_dsn: str | None
    redis_dsn: str | None
    oss_conf: dict | None
    wx_app_id: str | None
    installed: bool
    admin_email: str | None
    last_bootstrap_at: datetime | None


class AdminUpdateSettings(CamelModel):
    site_url: str | None = None
    db_dsn: str | None = None
    redis_dsn: str | None = None
    oss_conf: dict | None = None
    wx_app_id: str | None = None
    wx_secret: str | None = None
    admin_email: str | None = None
    admin_password: str | None = Field(default=None, min_length=8)
