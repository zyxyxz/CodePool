from __future__ import annotations

from datetime import datetime
from sqlalchemy import DateTime, Integer, String, Boolean, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AdminSetting(Base):
    __tablename__ = "admin_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    site_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    db_dsn: Mapped[str | None] = mapped_column(String(255), nullable=True)
    redis_dsn: Mapped[str | None] = mapped_column(String(255), nullable=True)
    oss_conf: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    wx_app_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    wx_secret_enc: Mapped[str | None] = mapped_column(String(255), nullable=True)
    kms_conf: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    admin_email: Mapped[str | None] = mapped_column(String(128), nullable=True)
    admin_password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    installed: Mapped[bool] = mapped_column(Boolean, default=False)
    last_bootstrap_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
