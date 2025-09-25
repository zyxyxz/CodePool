from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api import deps
from app.models import Team, TeamMembership, TeamRole, User
from app.schemas.team import TeamCreate, TeamMember, TeamMemberAdd, TeamSummary, UpdateMemberRole
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
