from __future__ import annotations

from datetime import datetime, timedelta
import json
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api import deps
from app.core.settings import settings
from app.models import Account, Share, ShareMode, User
from app.schemas.share import ShareCreate, ShareResponse
from app.services import team_service
from app.services.audit import log_action
from app.utils.crypto import decrypt_secret, generate_token
from app.utils.totp import generate_code

router = APIRouter(prefix="/shares", tags=["shares"])


@router.post("", response_model=ShareResponse, status_code=status.HTTP_201_CREATED)
def create_share(
    payload: ShareCreate,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db_session),
):
    account = db.get(Account, payload.account_id)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    team_service.ensure_admin(db, team_id=account.team_id, user_id=current_user.id)
    if payload.mode == ShareMode.PACKAGE and not settings.enable_package_share:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Package sharing disabled")
    token = generate_token()
    share = Share(
        account_id=account.id,
        token=token,
        mode=payload.mode,
        expires_at=datetime.utcnow() + timedelta(minutes=payload.expires_in_minutes),
        created_by_id=current_user.id,
    )
    if payload.mode == ShareMode.PACKAGE:
        secret = decrypt_secret(account.secret_enc, account.salt)
        package_payload = {
            "issuer": account.issuer,
            "label": account.label,
            "account_identifier": account.account_identifier,
            "secret": secret,
            "digits": account.digits,
            "period": account.period,
            "algorithm": account.algorithm.value,
        }
        share.secret_enc_once = json.dumps(package_payload)
    db.add(share)
    db.commit()
    db.refresh(share)
    log_action(
        db,
        action="CREATE_SHARE",
        team_id=account.team_id,
        user_id=current_user.id,
        account_id=account.id,
        target_type="share",
        target_id=share.id,
        meta={"mode": share.mode},
    )
    return ShareResponse.model_validate(share)


@router.get("", response_model=list[ShareResponse])
def list_shares(account_id: int, current_user: User = Depends(deps.get_current_user), db: Session = Depends(deps.get_db_session)):
    account = db.get(Account, account_id)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    team_service.ensure_admin(db, team_id=account.team_id, user_id=current_user.id)
    shares = db.query(Share).filter(Share.account_id == account_id).order_by(Share.created_at.desc()).all()
    return [ShareResponse.model_validate(s) for s in shares]


@router.delete("/{share_id}")
def revoke_share(share_id: int, current_user: User = Depends(deps.get_current_user), db: Session = Depends(deps.get_db_session)):
    share = db.get(Share, share_id)
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share not found")
    account = share.account
    team_service.ensure_admin(db, team_id=account.team_id, user_id=current_user.id)
    db.delete(share)
    db.commit()
    log_action(
        db,
        action="REVOKE_SHARE",
        team_id=account.team_id,
        user_id=current_user.id,
        account_id=account.id,
        target_type="share",
        target_id=share_id,
    )
    return {"success": True}


@router.get("/public/{token}")
def redeem_share(token: str, db: Session = Depends(deps.get_db_session)):
    share = db.query(Share).filter(Share.token == token).first()
    if not share or share.used:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Token invalid")
    if share.expires_at < datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Token expired")
    if share.mode == ShareMode.CODE:
        data = generate_code(share.account)
        payload = {
            "account_id": share.account_id,
            "team_id": share.account.team_id,
            "code": data["code"],
            "period": data["period"],
            "expires_in": data["expires_in"],
        }
    else:
        if not share.secret_enc_once:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Share package unavailable")
        payload = json.loads(share.secret_enc_once)
    share.used = True
    db.commit()
    log_action(
        db,
        action="REDEEM_SHARE",
        team_id=share.account.team_id,
        account_id=share.account_id,
        target_type="share",
        target_id=share.id,
    )
    return payload
