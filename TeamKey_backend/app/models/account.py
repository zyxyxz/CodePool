from __future__ import annotations

from datetime import datetime
from enum import Enum
from sqlalchemy import String, Integer, DateTime, Text, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class TotpAlgorithm(str, Enum):
    SHA1 = "SHA1"
    SHA256 = "SHA256"
    SHA512 = "SHA512"


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"))
    issuer: Mapped[str] = mapped_column(String(128))
    label: Mapped[str] = mapped_column(String(128))
    account_identifier: Mapped[str | None] = mapped_column(String(128), nullable=True)
    algorithm: Mapped[TotpAlgorithm] = mapped_column(default=TotpAlgorithm.SHA1)
    digits: Mapped[int] = mapped_column(Integer, default=6)
    period: Mapped[int] = mapped_column(Integer, default=30)
    secret_enc: Mapped[str] = mapped_column(Text)
    salt: Mapped[str] = mapped_column(String(128))
    extra_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    team: Mapped["Team"] = relationship("Team", back_populates="accounts")
    created_by: Mapped["User"] = relationship("User", back_populates="created_accounts")
    permissions: Mapped[list["AccountPermission"]] = relationship(back_populates="account", cascade="all, delete-orphan")
    shares: Mapped[list["Share"]] = relationship(back_populates="account", cascade="all, delete-orphan")
    audit_logs: Mapped[list["AuditLog"]] = relationship(back_populates="account")

    @property
    def remark(self) -> str | None:
        metadata = self.extra_metadata or {}
        value = metadata.get("remark")
        return value if value is not None else None

    @remark.setter
    def remark(self, value: str | None) -> None:
        metadata = dict(self.extra_metadata or {})
        if value and value.strip():
            metadata["remark"] = value.strip()
        else:
            metadata.pop("remark", None)
        self.extra_metadata = metadata or None
