from __future__ import annotations

from typing import Any
from sqlalchemy.orm import Session

from app.models import AuditLog


def log_action(
    db: Session,
    *,
    action: str,
    team_id: int | None = None,
    user_id: int | None = None,
    account_id: int | None = None,
    target_type: str | None = None,
    target_id: int | None = None,
    meta: dict[str, Any] | None = None,
) -> AuditLog:
    log = AuditLog(
        action=action,
        team_id=team_id,
        user_id=user_id,
        account_id=account_id,
        target_type=target_type,
        target_id=target_id,
        meta=meta,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log
