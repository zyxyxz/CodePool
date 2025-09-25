from __future__ import annotations

from datetime import datetime
import json
from sqlalchemy.orm import Session

from app.core.security import hash_password, verify_password
from app.core.settings import settings
from app.models import AdminSetting


def _maybe_json(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return value
    return value


def get_or_create_admin_setting(db: Session) -> AdminSetting:
    setting = db.get(AdminSetting, 1)
    if not setting:
        setting = AdminSetting(id=1, installed=False)
        db.add(setting)
        db.commit()
        db.refresh(setting)
    return setting


def bootstrap(db: Session, *, site_url: str, admin_email: str, admin_password: str, **kwargs) -> AdminSetting:
    setting = get_or_create_admin_setting(db)
    if setting.installed:
        return setting
    setting.site_url = site_url
    setting.admin_email = admin_email
    setting.admin_password_hash = hash_password(admin_password)
    setting.db_dsn = kwargs.get("db_dsn")
    setting.redis_dsn = kwargs.get("redis_dsn")
    setting.oss_conf = _maybe_json(kwargs.get("oss_conf"))
    setting.wx_app_id = kwargs.get("wx_app_id")
    setting.wx_secret_enc = kwargs.get("wx_secret")
    setting.installed = kwargs.get("mark_installed", True)
    setting.last_bootstrap_at = datetime.utcnow()
    db.commit()
    db.refresh(setting)
    return setting


def update_settings(db: Session, **kwargs) -> AdminSetting:
    setting = get_or_create_admin_setting(db)
    for field, value in kwargs.items():
        if value is None:
            continue
        if field == "admin_password":
            setting.admin_password_hash = hash_password(value)
        elif field == "wx_secret":
            setting.wx_secret_enc = value
        elif field == "oss_conf":
            setting.oss_conf = _maybe_json(value)
        else:
            setattr(setting, field, value)
    setting.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(setting)
    return setting


def verify_admin_credentials(db: Session, email: str, password: str) -> bool:
    setting = get_or_create_admin_setting(db)
    if not setting.installed:
        return email == settings.admin_initial_email and password == settings.admin_initial_password
    if not setting.admin_email or not setting.admin_password_hash:
        return False
    if email != setting.admin_email:
        return False
    return verify_password(password, setting.admin_password_hash)
