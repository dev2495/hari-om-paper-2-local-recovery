"""Owner/Admin user administration with atomic history and session revocation."""
import json
import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, text
from sqlalchemy.orm import Session
from ..database import get_db
from .. import models
from ..security import hashing
from ..plant_service import apply_user_scope
from ..utils.deps import require_internal_event_request, require_role, get_session_claims
from .auth import serialize_user, UserResponse, UserCreate, _assign_roles

router = APIRouter(prefix="/users", tags=["users"])

class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = Field(default=None, min_length=1, max_length=160)
    email: Optional[str] = Field(default=None, min_length=1, max_length=254)
    password: Optional[str] = Field(default=None, min_length=12, max_length=128)
    plant_id: Optional[uuid.UUID] = None
    allowed_plant_ids: Optional[List[uuid.UUID]] = None
    is_owner_all_plants: Optional[bool] = None
    is_active: Optional[bool] = None
    role_names: Optional[List[str]] = None

    @field_validator("name", "email")
    @classmethod
    def clean_identity(cls, value, info):
        if value is None or not value.strip():
            raise ValueError("Name and username cannot be empty")
        value = value.strip()
        if info.field_name == "email":
            # Preserve historical username-only accounts as well as email logins.
            if any(char.isspace() for char in value):
                raise ValueError("Username cannot contain spaces")
            value = value.lower()
        return value

    @field_validator("password")
    @classmethod
    def strong_password(cls, value):
        if value is None:
            raise ValueError("Omit password to leave it unchanged")
        return UserCreate.validate_password_strength(value)


def _lock_administration(db):
    # Serialize create/edit/disable, including concurrent last-admin demotions.
    db.execute(text("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE"))


def _duplicate(db, email, excluded_id=None):
    query = db.query(models.User).filter(func.lower(func.trim(models.User.email)) == email.strip().lower())
    if excluded_id:
        query = query.filter(models.User.id != excluded_id)
    if query.first():
        raise HTTPException(status_code=409, detail="Username is already registered, including inactive accounts")


def _snapshot(user):
    return {"name": user.name, "email": user.email, "roles": sorted(r.name for r in user.roles),
            "active": user.is_active, "plant_id": str(user.plant_id),
            "allowed_plants": sorted(str(p.id) for p in user.allowed_plants),
            "all_plants": bool(user.is_owner_all_plants)}


def _audit(db, actor, user, event, before=None, password_changed=False):
    db.flush()
    db.add(models.AuditEvent(actor_user_id=actor.id, actor_email=actor.email,
        actor_role=",".join(get_session_claims(actor)["roles"]), source_service="auth-service",
        plant_id=str(user.plant_id) if user.plant_id else None, event_type=event,
        entity_type="User", entity_id=str(user.id), summary=f"{event}: {user.email}",
        payload=json.dumps({"before": before, "after": _snapshot(user), "password_changed": password_changed})))


def _guard_scope(user):
    if user.is_owner_all_plants and not {r.name for r in user.roles} & {"Owner", "Admin"}:
        raise HTTPException(status_code=400, detail="All-plant access requires an Owner or Admin role")


@router.get("/", response_model=List[UserResponse])
def list_users(db: Session = Depends(get_db), current_user=Depends(require_role(["Owner", "Admin"]))):
    return [serialize_user(u) for u in db.query(models.User).order_by(models.User.created_at.desc()).all()]


@router.get("/owners/active")
def list_active_owner_recipients(request: Request, db: Session = Depends(get_db)):
    require_internal_event_request(request)
    role = db.query(models.Role).filter(models.Role.name == "Owner").first()
    return {"items": [{"id": str(u.id), "email": u.email, "name": u.name} for u in (role.users if role else []) if u.is_active]}


@router.post("/", response_model=UserResponse)
def create_user(user_in: UserCreate, db: Session = Depends(get_db), current_user=Depends(require_role(["Owner", "Admin"]))):
    _lock_administration(db)
    _duplicate(db, str(user_in.email))
    user = models.User(name=user_in.name.strip(), email=str(user_in.email).strip().lower(),
                       hashed_password=hashing.get_password_hash(user_in.password), is_active=True)
    db.add(user)
    _assign_roles(user, user_in.role_names, db)
    apply_user_scope(db=db, user=user, plant_id=user_in.plant_id, allowed_plant_ids=user_in.allowed_plant_ids,
                     is_owner_all_plants=user_in.is_owner_all_plants)
    _guard_scope(user)
    _audit(db, current_user, user, "USER_CREATED")
    db.commit()
    db.refresh(user)
    return serialize_user(user)


@router.get("/{user_id}", response_model=UserResponse)
def get_user(user_id: uuid.UUID, db: Session = Depends(get_db), current_user=Depends(require_role(["Owner", "Admin"]))):
    user = db.get(models.User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return serialize_user(user)


@router.put("/{user_id}", response_model=UserResponse)
def update_user(user_id: uuid.UUID, payload: UserUpdate, db: Session = Depends(get_db), current_user=Depends(require_role(["Owner", "Admin"]))):
    _lock_administration(db)
    user = db.get(models.User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    before = _snapshot(user)
    updates = payload.model_dump(exclude_unset=True)
    if any(value is None for key, value in updates.items() if key != "plant_id"):
        raise HTTPException(status_code=400, detail="Fields cannot be null")
    if "email" in updates:
        _duplicate(db, updates["email"], user.id)
    roles_changed = "role_names" in updates
    if roles_changed:
        _assign_roles(user, updates.pop("role_names"), db)
    if roles_changed or any(k in updates for k in ("plant_id", "allowed_plant_ids", "is_owner_all_plants")):
        # Demotion automatically removes unrestricted scope; explicit true is rejected.
        admin = bool({r.name for r in user.roles} & {"Owner", "Admin"})
        apply_user_scope(db=db, user=user, plant_id=updates.pop("plant_id", user.plant_id),
            allowed_plant_ids=updates.pop("allowed_plant_ids", [p.id for p in user.allowed_plants]),
            is_owner_all_plants=updates.pop("is_owner_all_plants", user.is_owner_all_plants if admin else False))
    _guard_scope(user)
    password = updates.pop("password", None)
    if password is not None:
        user.hashed_password = hashing.get_password_hash(password)
    for field, value in updates.items():
        setattr(user, field, value)
    if str(user.id) == str(current_user.id) and not user.is_active:
        raise HTTPException(status_code=400, detail="Cannot disable your own account")
    db.flush()
    administrators = db.query(models.User).filter(models.User.is_active.is_(True), models.User.roles.any(models.Role.name.in_(["Owner", "Admin"]))).count()
    if not administrators:
        raise HTTPException(status_code=400, detail="Keep at least one active Owner or Admin")
    _audit(db, current_user, user, "USER_UPDATED", before, password is not None)
    db.commit()
    db.refresh(user)
    return serialize_user(user)


@router.delete("/{user_id}")
def delete_user(user_id: uuid.UUID, db: Session = Depends(get_db), current_user=Depends(require_role(["Owner", "Admin"]))):
    update_user(user_id, UserUpdate(is_active=False), db, current_user)
    return {"message": "User disabled successfully; history retained and sessions revoked"}
