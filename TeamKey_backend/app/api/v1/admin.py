from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

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
    query = db.query(User)
    if keyword:
        like = f"%{keyword}%"
        query = query.filter((User.nickname.ilike(like)) | (User.open_id.ilike(like)))
    total = query.count()
    items = query.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [
            {
                "id": user.id,
                "nickname": user.nickname,
                "open_id": user.open_id,
                "last_login_at": user.last_login_at,
                "created_at": user.created_at,
            }
            for user in items
        ],
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
    query = db.query(Team)
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(Team.name.ilike(like))
    total = query.count()
    items = query.order_by(Team.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [
            {
                "id": team.id,
                "name": team.name,
                "description": team.description,
                "owner_id": team.owner_id,
                "created_at": team.created_at,
            }
            for team in items
        ],
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
    query = db.query(Account)
    if team_id:
        query = query.filter(Account.team_id == team_id)
    total = query.count()
    items = query.order_by(Account.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [
            {
                "id": account.id,
                "team_id": account.team_id,
                "issuer": account.issuer,
                "label": account.label,
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
):
    query = db.query(AuditLog).order_by(AuditLog.created_at.desc())
    total = query.count()
    items = query.offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [
            {
                "id": log.id,
                "team_id": log.team_id,
                "user_id": log.user_id,
                "action": log.action,
                "target_type": log.target_type,
                "target_id": log.target_id,
                "meta": log.meta,
                "created_at": log.created_at,
            }
            for log in items
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
