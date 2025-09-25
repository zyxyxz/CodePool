from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api import deps
from app.models import AuditLog, User
from app.services import team_service

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("/logs")
def list_logs(
    team_id: int | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db_session),
):
    query = db.query(AuditLog)
    if team_id:
        team_service.ensure_membership(db, team_id=team_id, user_id=current_user.id)
        query = query.filter(AuditLog.team_id == team_id)
    else:
        # only include logs for teams where user is member
        team_ids = [m.team_id for m in current_user.memberships]
        if team_ids:
            query = query.filter(AuditLog.team_id.in_(team_ids))
    query = query.order_by(AuditLog.created_at.desc())
    items = query.offset(offset).limit(limit).all()
    return [
        {
            "id": log.id,
            "team_id": log.team_id,
            "user": {
                "id": log.user.id if log.user else None,
                "nickname": log.user.nickname if log.user else None,
            },
            "action": log.action,
            "target_type": log.target_type,
            "target_id": log.target_id,
            "meta": log.meta,
            "created_at": log.created_at,
        }
        for log in items
    ]
