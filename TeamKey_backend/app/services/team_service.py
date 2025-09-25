from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import Team, TeamMembership, TeamRole, User


def ensure_membership(db: Session, *, team_id: int, user_id: int) -> TeamMembership:
    membership = (
        db.query(TeamMembership)
        .filter(TeamMembership.team_id == team_id, TeamMembership.user_id == user_id)
        .first()
    )
    if not membership:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a team member")
    return membership


def ensure_admin(db: Session, *, team_id: int, user_id: int) -> TeamMembership:
    membership = ensure_membership(db, team_id=team_id, user_id=user_id)
    if membership.role not in {TeamRole.OWNER, TeamRole.ADMIN}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator permission required")
    return membership


def create_default_membership(db: Session, team: Team, owner: User) -> None:
    membership = TeamMembership(team_id=team.id, user_id=owner.id, role=TeamRole.OWNER)
    db.add(membership)
    db.commit()


def serialize_team_membership(membership: TeamMembership) -> dict:
    user = membership.user
    return {
        "user_id": user.id,
        "nickname": user.nickname,
        "avatar_url": user.avatar_url,
        "role": membership.role,
        "joined_at": membership.created_at,
    }
