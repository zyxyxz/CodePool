from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api import deps
from app.models import Account, AccountPermission, AccountPermissionType, TotpAlgorithm, User
from app.schemas.account import AccountCreate, AccountResponse, AccountUpdate, TotpResponse
from app.services import team_service
from app.services.audit import log_action
from app.utils.crypto import encrypt_secret
from app.utils.otp_parsing import parse_otpauth_url
from app.utils.totp import generate_code

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("", response_model=list[AccountResponse])
def list_accounts(
    team_id: int = Query(..., description="Team identifier"),
    q: str | None = None,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db_session),
):
    membership = team_service.ensure_membership(db, team_id=team_id, user_id=current_user.id)
    query = db.query(Account).filter(Account.team_id == team_id)
    if q:
        like = f"%{q}%"
        query = query.filter(
            (Account.issuer.ilike(like))
            | (Account.label.ilike(like))
            | (Account.account_identifier.ilike(like))
        )
    accounts = query.order_by(Account.updated_at.desc()).all()
    return [AccountResponse.model_validate(a) for a in accounts]


@router.post("", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
def create_account(
    payload: AccountCreate,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db_session),
):
    team_service.ensure_admin(db, team_id=payload.team_id, user_id=current_user.id)

    if payload.otpauth_url:
        parsed = parse_otpauth_url(payload.otpauth_url)
    else:
        if not payload.secret or not payload.issuer or not payload.label:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="issuer, label, secret are required")
        parsed = {
            "issuer": payload.issuer,
            "label": payload.label,
            "account_identifier": payload.account_identifier,
            "secret": payload.secret.replace(" ", "").upper(),
            "digits": payload.digits or 6,
            "period": payload.period or 30,
            "algorithm": payload.algorithm or TotpAlgorithm.SHA1,
        }

    enc = encrypt_secret(parsed["secret"])
    account = Account(
        team_id=payload.team_id,
        issuer=parsed["issuer"],
        label=parsed["label"],
        account_identifier=parsed.get("account_identifier"),
        algorithm=parsed.get("algorithm", TotpAlgorithm.SHA1),
        digits=parsed.get("digits", 6),
        period=parsed.get("period", 30),
        secret_enc=enc.cipher_text,
        salt=enc.salt,
        created_by_id=current_user.id,
    )
    account.remark = payload.remark
    db.add(account)
    db.commit()
    db.refresh(account)

    permission = AccountPermission(
        account_id=account.id,
        user_id=current_user.id,
        permission=AccountPermissionType.MANAGE,
    )
    db.add(permission)
    db.commit()

    log_action(
        db,
        action="CREATE_ACCOUNT",
        team_id=payload.team_id,
        user_id=current_user.id,
        account_id=account.id,
        target_type="account",
        target_id=account.id,
        meta={"issuer": account.issuer, "label": account.label},
    )
    return AccountResponse.model_validate(account)


@router.get("/{account_id}", response_model=AccountResponse)
def get_account(account_id: int, current_user: User = Depends(deps.get_current_user), db: Session = Depends(deps.get_db_session)):
    account = db.get(Account, account_id)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    team_service.ensure_membership(db, team_id=account.team_id, user_id=current_user.id)
    return AccountResponse.model_validate(account)


@router.get("/{account_id}/code", response_model=TotpResponse)
def get_totp(account_id: int, current_user: User = Depends(deps.get_current_user), db: Session = Depends(deps.get_db_session)):
    account = db.get(Account, account_id)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    team_service.ensure_membership(db, team_id=account.team_id, user_id=current_user.id)
    result = generate_code(account)
    log_action(
        db,
        action="VIEW_TOTP",
        team_id=account.team_id,
        user_id=current_user.id,
        account_id=account.id,
        target_type="account",
        target_id=account.id,
    )
    return TotpResponse(account_id=account.id, **result)


@router.patch("/{account_id}", response_model=AccountResponse)
def update_account(
    account_id: int,
    payload: AccountUpdate,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db_session),
):
    account = db.get(Account, account_id)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    team_service.ensure_admin(db, team_id=account.team_id, user_id=current_user.id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(account, field, value)
    db.commit()
    db.refresh(account)
    log_action(
        db,
        action="UPDATE_ACCOUNT",
        team_id=account.team_id,
        user_id=current_user.id,
        account_id=account.id,
        target_type="account",
        target_id=account.id,
    )
    return AccountResponse.model_validate(account)


@router.delete("/{account_id}")
def delete_account(account_id: int, current_user: User = Depends(deps.get_current_user), db: Session = Depends(deps.get_db_session)):
    account = db.get(Account, account_id)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    team_service.ensure_admin(db, team_id=account.team_id, user_id=current_user.id)
    db.delete(account)
    db.commit()
    log_action(
        db,
        action="DELETE_ACCOUNT",
        team_id=account.team_id,
        user_id=current_user.id,
        account_id=account.id,
        target_type="account",
        target_id=account_id,
    )
    return {"success": True}
