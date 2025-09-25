from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api import deps
from app.models import Account, AccountPermission, AccountPermissionType, User
from app.schemas.permission import PermissionGrant, PermissionResponse
from app.services import team_service
from app.services.audit import log_action

router = APIRouter(prefix="/permissions", tags=["permissions"])


@router.get("/{account_id}", response_model=list[PermissionResponse])
def list_permissions(account_id: int, current_user: User = Depends(deps.get_current_user), db: Session = Depends(deps.get_db_session)):
    account = db.get(Account, account_id)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    team_service.ensure_admin(db, team_id=account.team_id, user_id=current_user.id)
    permissions = (
        db.query(AccountPermission)
        .join(AccountPermission.user)
        .filter(AccountPermission.account_id == account_id)
        .all()
    )
    return [
        PermissionResponse(
            user_id=perm.user_id,
            nickname=perm.user.nickname if perm.user else None,
            permission=perm.permission,
            expires_at=perm.expires_at,
        )
        for perm in permissions
    ]


@router.post("/grant")
def grant_permission(payload: PermissionGrant, current_user: User = Depends(deps.get_current_user), db: Session = Depends(deps.get_db_session)):
    account = db.get(Account, payload.account_id)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    team_service.ensure_admin(db, team_id=account.team_id, user_id=current_user.id)
    permission = (
        db.query(AccountPermission)
        .filter(AccountPermission.account_id == payload.account_id, AccountPermission.user_id == payload.user_id)
        .first()
    )
    if not permission:
        permission = AccountPermission(
            account_id=payload.account_id,
            user_id=payload.user_id,
        )
        db.add(permission)
    permission.permission = payload.permission
    permission.expires_at = payload.expires_at
    db.commit()
    log_action(
        db,
        action="GRANT_PERMISSION",
        team_id=account.team_id,
        user_id=current_user.id,
        account_id=account.id,
        target_type="account_permission",
        target_id=payload.user_id,
        meta={"permission": payload.permission},
    )
    return {"success": True}


@router.post("/revoke")
def revoke_permission(payload: PermissionGrant, current_user: User = Depends(deps.get_current_user), db: Session = Depends(deps.get_db_session)):
    account = db.get(Account, payload.account_id)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    team_service.ensure_admin(db, team_id=account.team_id, user_id=current_user.id)
    permission = (
        db.query(AccountPermission)
        .filter(AccountPermission.account_id == payload.account_id, AccountPermission.user_id == payload.user_id)
        .first()
    )
    if not permission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Permission not found")
    db.delete(permission)
    db.commit()
    log_action(
        db,
        action="REVOKE_PERMISSION",
        team_id=account.team_id,
        user_id=current_user.id,
        account_id=account.id,
        target_type="account_permission",
        target_id=payload.user_id,
    )
    return {"success": True}
