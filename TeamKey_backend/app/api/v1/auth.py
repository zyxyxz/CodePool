from __future__ import annotations

from datetime import datetime
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api import deps
from app.core.security import create_access_token
from app.core.settings import settings
from app.models import User, TeamMembership
from app.schemas.auth import LoginRequest, TokenResponse
from app.schemas.team import TeamSummary
from app.services.wechat import wechat_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: Session = Depends(deps.get_db_session)):
    profile = await wechat_service.exchange_code(
        payload.wx_code,
        nickname=payload.nickname,
        avatar_url=payload.avatar_url,
        open_id_hint=payload.open_id or payload.openId,
    )
    user = db.query(User).filter_by(open_id=profile["open_id"]).first()
    if not user:
        user = User(open_id=profile["open_id"])
        db.add(user)
    user.union_id = profile.get("union_id")
    user.nickname = payload.nickname or profile.get("nickname") or user.nickname
    user.avatar_url = payload.avatar_url or profile.get("avatar_url") or user.avatar_url
    user.last_login_at = datetime.utcnow()
    db.commit()
    db.refresh(user)

    # ensure default admin membership if no teams and environment is new? not necessary here
    access_token = create_access_token({"sub": str(user.id), "openid": user.open_id})

    teams = [
        TeamSummary(
            team_id=m.team_id,
            name=m.team.name,
            role=m.role,
            owner_id=m.team.owner_id,
            created_at=m.team.created_at,
        )
        for m in db.query(TeamMembership).filter(TeamMembership.user_id == user.id).all()
    ]

    return TokenResponse(access_token=access_token, user={
        "id": user.id,
        "open_id": user.open_id,
        "openId": user.open_id,
        "nickname": user.nickname,
        "avatar_url": user.avatar_url,
        "avatarUrl": user.avatar_url,
        "teams": [team.model_dump() for team in teams],
    })


@router.get("/me")
def me(current_user: User = Depends(deps.get_current_user), db: Session = Depends(deps.get_db_session)):
    memberships = (
        db.query(TeamMembership)
        .filter(TeamMembership.user_id == current_user.id)
        .all()
    )
    teams = [
        TeamSummary(
            team_id=m.team_id,
            name=m.team.name,
            role=m.role,
            owner_id=m.team.owner_id,
            created_at=m.team.created_at,
        ).model_dump()
        for m in memberships
    ]
    return {
        "user": {
            "id": current_user.id,
            "open_id": current_user.open_id,
            "openId": current_user.open_id,
            "nickname": current_user.nickname,
            "avatar_url": current_user.avatar_url,
            "avatarUrl": current_user.avatar_url,
            "last_login_at": current_user.last_login_at,
        },
        "teams": teams,
    }
