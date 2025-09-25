from __future__ import annotations

from datetime import datetime
from enum import Enum
from sqlalchemy import DateTime, Enum as SqlEnum, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class AccountPermissionType(str, Enum):
    VIEW = "view"
    MANAGE = "manage"
    TEMPORARY = "temporary"


class AccountPermission(Base):
    __tablename__ = "account_permissions"
    __table_args__ = (UniqueConstraint("account_id", "user_id", name="uq_account_user"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    permission: Mapped[AccountPermissionType] = mapped_column(SqlEnum(AccountPermissionType), default=AccountPermissionType.VIEW)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    account: Mapped["Account"] = relationship("Account", back_populates="permissions")
    user: Mapped["User"] = relationship("User", back_populates="account_permissions")
