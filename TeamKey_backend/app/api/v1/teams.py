from __future__ import annotations

from datetime import datetime, timedelta
import secrets
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api import deps
from app.models import Team, TeamInvite, TeamInviteMode, TeamMembership, TeamRole, User
from app.schemas.team import (
    TeamCreate,
    TeamInviteCreate,
    TeamInviteResponse,
    TeamMember,
    TeamMemberAdd,
    TeamSummary,
    UpdateMemberRole,
)
from app.services import team_service
from app.services.audit import log_action

router = APIRouter(prefix="/teams", tags=["teams"])


@router.get("", response_model=list[TeamSummary])
def list_teams(current_user: User = Depends(deps.get_current_user), db: Session = Depends(deps.get_db_session)):
    memberships = (
        db.query(TeamMembership)
        .filter(TeamMembership.user_id == current_user.id)
        .all()
    )
    return [
        TeamSummary(
            team_id=m.team_id,
            name=m.team.name,
            role=m.role,
            owner_id=m.team.owner_id,
            created_at=m.team.created_at,
        )
        for m in memberships
    ]


@router.post("", response_model=TeamSummary, status_code=status.HTTP_201_CREATED)
def create_team(payload: TeamCreate, current_user: User = Depends(deps.get_current_user), db: Session = Depends(deps.get_db_session)):
    team = Team(name=payload.name, description=payload.description, owner_id=current_user.id)
    db.add(team)
    db.commit()
    db.refresh(team)
    team_service.create_default_membership(db, team, current_user)
    log_action(db, action="CREATE_TEAM", team_id=team.id, user_id=current_user.id, target_type="team", target_id=team.id)
    return TeamSummary(team_id=team.id, name=team.name, role=TeamRole.OWNER, owner_id=team.owner_id, created_at=team.created_at)


@router.get("/{team_id}/members", response_model=list[TeamMember])
def list_members(team_id: int, current_user: User = Depends(deps.get_current_user), db: Session = Depends(deps.get_db_session)):
    team_service.ensure_membership(db, team_id=team_id, user_id=current_user.id)
    memberships = (
        db.query(TeamMembership)
        .filter(TeamMembership.team_id == team_id)
        .all()
    )
    return [team_service.serialize_team_membership(m) for m in memberships]




@router.post("/{team_id}/members", status_code=status.HTTP_201_CREATED)
def add_member(
    team_id: int,
    payload: TeamMemberAdd,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db_session),
):
    team_service.ensure_admin(db, team_id=team_id, user_id=current_user.id)
    existing = db.query(TeamMembership).filter(TeamMembership.team_id == team_id, TeamMembership.user_id == payload.user_id).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Member already exists")
    membership = TeamMembership(team_id=team_id, user_id=payload.user_id, role=payload.role)
    db.add(membership)
    db.commit()
    log_action(
        db,
        action="ADD_MEMBER",
        team_id=team_id,
        user_id=current_user.id,
        target_type="team_member",
        target_id=payload.user_id,
        meta={"role": payload.role},
    )
    return {"success": True}

@router.patch("/{team_id}/members/{user_id}")
def update_member_role(
    team_id: int,
    user_id: int,
    payload: UpdateMemberRole,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db_session),
):
    team_service.ensure_admin(db, team_id=team_id, user_id=current_user.id)
    membership = (
        db.query(TeamMembership)
        .filter(TeamMembership.team_id == team_id, TeamMembership.user_id == user_id)
        .first()
    )
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    if membership.role == TeamRole.OWNER:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot modify owner role")
    membership.role = payload.role
    db.commit()
    log_action(
        db,
        action="UPDATE_MEMBER_ROLE",
        team_id=team_id,
        user_id=current_user.id,
        target_type="team_member",
        target_id=user_id,
        meta={"role": payload.role},
    )
    return {"success": True}


@router.delete("/{team_id}/members/{user_id}")
def remove_member(
    team_id: int,
    user_id: int,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db_session),
):
    requester = team_service.ensure_admin(db, team_id=team_id, user_id=current_user.id)
    membership = (
        db.query(TeamMembership)
        .filter(TeamMembership.team_id == team_id, TeamMembership.user_id == user_id)
        .first()
    )
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    if membership.role == TeamRole.OWNER:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot remove owner")
    db.delete(membership)
    db.commit()
    log_action(
        db,
        action="REMOVE_MEMBER",
        team_id=team_id,
        user_id=current_user.id,
        target_type="team_member",
        target_id=user_id,
        meta={"requester_role": requester.role},
    )
    return {"success": True}


def _serialize_invite(invite: TeamInvite) -> TeamInviteResponse:
    return TeamInviteResponse.model_validate(invite)


def _generate_invite_token(db: Session) -> str:
    while True:
        token = secrets.token_urlsafe(8)
        exists = db.query(TeamInvite).filter(TeamInvite.token == token).first()
        if not exists:
            return token


@router.post("/{team_id}/invites", response_model=TeamInviteResponse, status_code=status.HTTP_201_CREATED)
def create_invite(
    team_id: int,
    payload: TeamInviteCreate,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db_session),
):
    team_service.ensure_admin(db, team_id=team_id, user_id=current_user.id)
    expires_delta = timedelta(minutes=payload.expires_in_minutes or 60)
    expires_at = datetime.utcnow() + expires_delta
    token = _generate_invite_token(db)
    invite = TeamInvite(
        team_id=team_id,
        inviter_id=current_user.id,
        mode=payload.mode,
        token=token,
        expires_at=expires_at,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)
    log_action(
        db,
        action="CREATE_TEAM_INVITE",
        team_id=team_id,
        user_id=current_user.id,
        target_type="team_invite",
        target_id=invite.id,
        meta={"mode": invite.mode, "expires_at": invite.expires_at.isoformat()},
    )
    return _serialize_invite(invite)


@router.get("/{team_id}/invites", response_model=list[TeamInviteResponse])
def list_invites(
    team_id: int,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db_session),
):
    team_service.ensure_admin(db, team_id=team_id, user_id=current_user.id)
    invites = (
        db.query(TeamInvite)
        .filter(TeamInvite.team_id == team_id)
        .order_by(TeamInvite.created_at.desc())
        .all()
    )
    return [_serialize_invite(invite) for invite in invites]


@router.post("/invites/{token}/accept", response_model=TeamSummary)
def accept_invite(
    token: str,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db_session),
):
    invite = db.query(TeamInvite).filter(TeamInvite.token == token).first()
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found")
    if invite.used:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invite already used")
    if invite.expires_at < datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Invite expired")

    membership = (
        db.query(TeamMembership)
        .filter(TeamMembership.team_id == invite.team_id, TeamMembership.user_id == current_user.id)
        .first()
    )
    if not membership:
        membership = TeamMembership(team_id=invite.team_id, user_id=current_user.id, role=TeamRole.MEMBER)
        db.add(membership)

    invite.used = True
    invite.used_at = datetime.utcnow()
    db.commit()

    team = db.get(Team, invite.team_id)
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    log_action(
        db,
        action="ACCEPT_TEAM_INVITE",
        team_id=invite.team_id,
        user_id=current_user.id,
        target_type="team_invite",
        target_id=invite.id,
        meta={"mode": invite.mode},
    )

    return TeamSummary(
        team_id=team.id,
        name=team.name,
        role=membership.role,
        owner_id=team.owner_id,
        created_at=team.created_at,
    )
