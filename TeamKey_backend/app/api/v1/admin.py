from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import cast, func, or_, String
from sqlalchemy.orm import Session, joinedload

from app.api import deps
from app.core.security import create_access_token, decode_access_token
from app.models import Account, AuditLog, Team, TeamMembership, User
from app.schemas.admin import (
    AdminBootstrapRequest,
    AdminLoginRequest,
    AdminSettingsResponse,
    AdminUpdateSettings,
)
from app.services import admin_settings as admin_settings_service

router = APIRouter(prefix="/admin", tags=["admin"])
bearer = HTTPBearer(auto_error=False)


def require_admin(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Admin token required")
    payload = decode_access_token(credentials.credentials)
    if not payload or payload.get("scope") != "admin":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid admin token")
    return payload


@router.post("/login")
def admin_login(payload: AdminLoginRequest, db: Session = Depends(deps.get_db_session)):
    if not admin_settings_service.verify_admin_credentials(db, payload.email, payload.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = create_access_token({"sub": payload.email, "scope": "admin"})
    setting = admin_settings_service.get_or_create_admin_setting(db)
    return {
        "token": token,
        "profile": {
            "email": payload.email,
            "installed": setting.installed,
        },
    }


@router.post("/bootstrap", response_model=AdminSettingsResponse)
def bootstrap(payload: AdminBootstrapRequest, db: Session = Depends(deps.get_db_session)):
    setting = admin_settings_service.bootstrap(
        db,
        site_url=payload.site_url,
        admin_email=payload.admin_email,
        admin_password=payload.admin_password,
        db_dsn=payload.db_dsn,
        redis_dsn=payload.redis_dsn,
        oss_conf=payload.oss_conf,
        wx_app_id=payload.wx_app_id,
        wx_secret=payload.wx_secret,
        mark_installed=payload.mark_installed,
    )
    return AdminSettingsResponse(
        site_url=setting.site_url,
        db_dsn=setting.db_dsn,
        redis_dsn=setting.redis_dsn,
        oss_conf=setting.oss_conf,
        wx_app_id=setting.wx_app_id,
        installed=setting.installed,
        admin_email=setting.admin_email,
        last_bootstrap_at=setting.last_bootstrap_at,
    )


@router.get("/settings", response_model=AdminSettingsResponse)
def get_settings(
    _: dict = Depends(require_admin),
    db: Session = Depends(deps.get_db_session),
):
    setting = admin_settings_service.get_or_create_admin_setting(db)
    return AdminSettingsResponse(
        site_url=setting.site_url,
        db_dsn=setting.db_dsn,
        redis_dsn=setting.redis_dsn,
        oss_conf=setting.oss_conf,
        wx_app_id=setting.wx_app_id,
        installed=setting.installed,
        admin_email=setting.admin_email,
        last_bootstrap_at=setting.last_bootstrap_at,
    )


@router.put("/settings", response_model=AdminSettingsResponse)
def update_settings(
    payload: AdminUpdateSettings,
    _: dict = Depends(require_admin),
    db: Session = Depends(deps.get_db_session),
):
    setting = admin_settings_service.update_settings(
        db,
        site_url=payload.site_url,
        db_dsn=payload.db_dsn,
        redis_dsn=payload.redis_dsn,
        oss_conf=payload.oss_conf,
        wx_app_id=payload.wx_app_id,
        wx_secret=payload.wx_secret,
        admin_email=payload.admin_email,
        admin_password=payload.admin_password,
    )
    return AdminSettingsResponse(
        site_url=setting.site_url,
        db_dsn=setting.db_dsn,
        redis_dsn=setting.redis_dsn,
        oss_conf=setting.oss_conf,
        wx_app_id=setting.wx_app_id,
        installed=setting.installed,
        admin_email=setting.admin_email,
        last_bootstrap_at=setting.last_bootstrap_at,
    )


@router.get("/stats")
def stats(_: dict = Depends(require_admin), db: Session = Depends(deps.get_db_session)):
    return {
        "user_count": db.query(User).filter(User.open_id.isnot(None)).count(),
        "team_count": db.query(Team).count(),
        "account_count": db.query(Account).count(),
        "membership_count": db.query(TeamMembership).count(),
    }


@router.get("/users")
def list_users(
    _: dict = Depends(require_admin),
    db: Session = Depends(deps.get_db_session),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    keyword: str | None = None,
):
    query = db.query(User).options(
        joinedload(User.memberships),
        joinedload(User.created_accounts),
    )
    if keyword:
        like = f"%{keyword}%"
        query = query.filter((User.nickname.ilike(like)) | (User.open_id.ilike(like)))
    total = query.count()
    items = (
        query.order_by(User.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    response_items = []
    for user in items:
        memberships = user.memberships or []
        created_accounts = user.created_accounts or []
        response_items.append(
            {
                "id": user.id,
                "nickname": user.nickname,
                "open_id": user.open_id,
                "avatar_url": user.avatar_url,
                "last_login_at": user.last_login_at,
                "created_at": user.created_at,
                "team_count": len({m.team_id for m in memberships}),
                "account_count": len(created_accounts),
            }
        )

    return {
        "items": response_items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/teams")
def list_teams_admin(
    _: dict = Depends(require_admin),
    db: Session = Depends(deps.get_db_session),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    keyword: str | None = None,
):
    query = db.query(Team).options(
        joinedload(Team.owner),
        joinedload(Team.memberships),
    )
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(Team.name.ilike(like))
    total = query.count()
    items = (
        query.order_by(Team.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    response_items = []
    for team in items:
        memberships = team.memberships or []
        response_items.append(
            {
                "id": team.id,
                "name": team.name,
                "description": team.description,
                "owner_id": team.owner_id,
                "owner_nickname": team.owner.nickname if team.owner else None,
                "owner_open_id": team.owner.open_id if team.owner else None,
                "member_count": len(memberships),
                "created_at": team.created_at,
            }
        )

    return {
        "items": response_items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/accounts")
def list_accounts_admin(
    _: dict = Depends(require_admin),
    db: Session = Depends(deps.get_db_session),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    team_id: int | None = None,
):
    query = db.query(Account).options(
        joinedload(Account.team),
        joinedload(Account.created_by),
    )
    if team_id:
        query = query.filter(Account.team_id == team_id)
    total = query.count()
    items = query.order_by(Account.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [
            {
                "id": account.id,
                "team_id": account.team_id,
                "team_name": account.team.name if account.team else None,
                "issuer": account.issuer,
                "label": account.label,
                "account_identifier": account.account_identifier,
                "remark": account.remark,
                "created_by_id": account.created_by_id,
                "created_by_nickname": account.created_by.nickname if account.created_by else None,
                "created_at": account.created_at,
            }
            for account in items
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/logs")
def list_audit_logs_admin(
    _: dict = Depends(require_admin),
    db: Session = Depends(deps.get_db_session),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    team_id: int | None = None,
    action: str | None = None,
    keyword: str | None = None,
):
    query = (
        db.query(AuditLog)
        .options(joinedload(AuditLog.user), joinedload(AuditLog.team))
        .order_by(AuditLog.created_at.desc())
    )

    if team_id:
        query = query.filter(AuditLog.team_id == team_id)
    if action:
        query = query.filter(AuditLog.action.ilike(f"%{action}%"))
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(
            or_(
                AuditLog.action.ilike(like),
                AuditLog.target_type.ilike(like),
                cast(AuditLog.target_id, String).ilike(like),
                cast(AuditLog.meta, String).ilike(like),
            )
        )

    total = query.count()
    items = (
        query.offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    response_items = []
    for log in items:
        response_items.append(
            {
                "id": log.id,
                "team_id": log.team_id,
                "team_name": log.team.name if log.team else None,
                "user_id": log.user_id,
                "user_nickname": log.user.nickname if log.user else None,
                "user_open_id": log.user.open_id if log.user else None,
                "action": log.action,
                "target_type": log.target_type,
                "target_id": log.target_id,
                "meta": log.meta,
                "created_at": log.created_at,
            }
        )

    return {
        "items": response_items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }
