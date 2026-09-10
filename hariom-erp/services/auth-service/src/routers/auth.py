from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from sqlalchemy import func, text
from datetime import datetime, timedelta
from typing import List
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
import os
import threading
import time
import uuid
from ..database import get_db
from .. import models
from ..security import hashing, jwt_handler
from ..utils.deps import get_current_user, require_role
from ..workspace import BUSINESS_ROLE_ORDER, canonical_role_name

router = APIRouter(prefix="/auth", tags=["auth"])

LOGIN_MAX_ATTEMPTS = int(os.getenv("LOGIN_MAX_ATTEMPTS", "5"))
LOGIN_WINDOW_SECONDS = int(os.getenv("LOGIN_WINDOW_SECONDS", "900"))
_login_attempts: dict[str, list[float]] = {}
_login_attempts_lock = threading.Lock()

class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    email: EmailStr
    password: str = Field(..., min_length=12, max_length=128)
    plant_id: str = "PLANT_A"
    role_names: List[str] = []
    allowed_plant_ids: List[uuid.UUID] = []
    is_owner_all_plants: bool = False

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Name is required")
        return value.strip()

    @field_validator("email", mode="before")
    @classmethod
    def clean_email(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("password must be at most 72 UTF-8 bytes")
        if not any(char.islower() for char in value):
            raise ValueError("password must contain a lowercase letter")
        if not any(char.isupper() for char in value):
            raise ValueError("password must contain an uppercase letter")
        if not any(char.isdigit() for char in value):
            raise ValueError("password must contain a number")
        if not any(not char.isalnum() for char in value):
            raise ValueError("password must contain a symbol")
        return value

class UserResponse(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    plant_id: str
    is_active: bool
    created_at: datetime | None = None
    role: str | None = None
    roles: List[str]
    permissions: List[str]
    allowed_plants: List[str] = []
    allowed_plant_ids: List[str] = []
    is_owner_all_plants: bool = False
    acting_role: str | None = None
    is_acting_session: bool = False

    model_config = ConfigDict(from_attributes=True)


class UserStatusUpdate(BaseModel):
    is_active: bool


class UserRoleAssignment(BaseModel):
    role_names: List[str]


class ActingRolePayload(BaseModel):
    role_name: str


def serialize_user(user: models.User) -> dict:
    allowed_plants = [str(plant.id) for plant in getattr(user, "allowed_plants", [])]
    if not allowed_plants and user.plant_id:
        allowed_plants = [str(user.plant_id)]
    canonical_roles = sorted(
        {canonical_role_name(role.name) for role in user.roles if canonical_role_name(role.name)},
        key=lambda role: BUSINESS_ROLE_ORDER.index(role) if role in BUSINESS_ROLE_ORDER else 999,
    )
    permissions = sorted({
        permission.name
        for role in user.roles
        for permission in role.permissions
    })
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "plant_id": str(user.plant_id) if user.plant_id else (allowed_plants[0] if allowed_plants else "PLANT_A"),
        "is_active": user.is_active,
        "created_at": getattr(user, "created_at", None),
        "role": canonical_roles[0] if canonical_roles else None,
        "roles": canonical_roles,
        "permissions": permissions,
        "allowed_plants": allowed_plants,
        "allowed_plant_ids": allowed_plants,
        "is_owner_all_plants": bool(getattr(user, "is_owner_all_plants", False)),
        "acting_role": None,
        "is_acting_session": False,
    }


def _assign_roles(user: models.User, role_names: List[str], db: Session) -> None:
    incoming = [str(role or "").strip() for role in (role_names or []) if str(role or "").strip()]
    unknown = [role for role in incoming if canonical_role_name(role) is None]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown roles: {', '.join(unknown)}")
    normalized = sorted({canonical_role_name(role) for role in incoming if canonical_role_name(role)})
    if not normalized:
        raise HTTPException(status_code=400, detail="Select at least one role")
    roles = db.query(models.Role).filter(models.Role.name.in_(normalized)).all()
    resolved = {role.name for role in roles}
    missing = [name for name in normalized if name not in resolved]
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown roles: {', '.join(missing)}")
    user.roles = roles


def create_user_record(user_in: UserCreate, db: Session) -> models.User:
    db_user = db.query(models.User).filter(func.lower(func.trim(models.User.email)) == str(user_in.email).strip().lower()).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    plant = None
    try:
        plant_uuid = uuid.UUID(str(user_in.plant_id))
        plant = db.query(models.Plant).filter(models.Plant.id == plant_uuid).first()
    except ValueError:
        plant = db.query(models.Plant).filter(models.Plant.code == user_in.plant_id).first()

    hashed_pw = hashing.get_password_hash(user_in.password)
    new_user = models.User(
        name=user_in.name,
        email=user_in.email,
        plant_id=plant.id if plant else None,
        hashed_password=hashed_pw
    )

    _assign_roles(new_user, user_in.role_names, db)

    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@router.post("/register", response_model=UserResponse)
def register(user_in: UserCreate, db: Session = Depends(get_db)):
    """Bootstrap-only registration. Disabled once at least one user exists."""
    existing_users = db.query(models.User).count()
    if existing_users > 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bootstrap registration disabled. Use /auth/users with admin credentials."
        )
    new_user = create_user_record(user_in, db)
    return serialize_user(new_user)

def _login_key(request: Request, email: str) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",", 1)[0].strip()
    remote = forwarded or (request.client.host if request.client else "unknown")
    return f"{remote}|{email.strip().lower()}"


def _active_login_attempts(key: str, now: float) -> list[float]:
    with _login_attempts_lock:
        active = [stamp for stamp in _login_attempts.get(key, []) if now - stamp < LOGIN_WINDOW_SECONDS]
        if active:
            _login_attempts[key] = active
        else:
            _login_attempts.pop(key, None)
        return active


def _record_login(db, request, username, success, user=None):
    db.add(models.AuditEvent(
        event_type="LOGIN_SUCCEEDED" if success else "LOGIN_FAILED",
        actor_user_id=user.id if user else None, actor_email=username,
        actor_role=",".join(r.name for r in user.roles) if success and user else None,
        entity_type="Session", source_service="auth-service",
        summary="Sign-in succeeded" if success else "Sign-in rejected",
        ip=_login_key(request, username).split("|", 1)[0],
        user_agent=(request.headers.get("user-agent") or "")[:255],
    ))
    db.commit()


@router.post("/login")
def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    key = _login_key(request, form_data.username)
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": "login:" + key})
    now = time.monotonic()
    persistent_failures = db.query(models.AuditEvent).filter(
        models.AuditEvent.event_type == "LOGIN_FAILED",
        models.AuditEvent.actor_email == form_data.username.strip().lower(),
        models.AuditEvent.ip == key.split("|", 1)[0],
        models.AuditEvent.occurred_at >= datetime.utcnow() - timedelta(seconds=LOGIN_WINDOW_SECONDS),
    ).count()
    if max(persistent_failures, len(_active_login_attempts(key, now))) >= LOGIN_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed login attempts. Retry after {LOGIN_WINDOW_SECONDS // 60} minutes.",
        )
    user = db.query(models.User).filter(func.lower(func.trim(models.User.email)) == form_data.username.strip().lower()).first()
    if not user or not hashing.verify_password(form_data.password, user.hashed_password):
        with _login_attempts_lock:
            _login_attempts.setdefault(key, []).append(now)
        _record_login(db, request, form_data.username.strip().lower(), False)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        _record_login(db, request, form_data.username.strip().lower(), False, user)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive"
        )

    with _login_attempts_lock:
        _login_attempts.pop(key, None)

    claims = jwt_handler.build_user_claims(user)
    access_token = jwt_handler.create_access_token(data=claims)
    _record_login(db, request, user.email, True, user)
    return {"access_token": access_token, "token_type": "bearer", "user": serialize_user(user)}


@router.post("/acting-role")
def set_acting_role(
    payload: ActingRolePayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    role_name = str(payload.role_name or "").strip()
    if not role_name:
        raise HTTPException(status_code=400, detail="role_name is required")

    user_role_map = {role.name: role for role in current_user.roles}
    role = user_role_map.get(role_name)
    if role is None:
        allow_unassigned = os.getenv("ALLOW_UNASSIGNED_ACTING_ROLES", "false").strip().lower() in {"1", "true", "yes", "on"}
        if allow_unassigned and {"Admin", "Owner"} & set(user_role_map.keys()):
            role = db.query(models.Role).filter(models.Role.name == role_name).first()
    if role is None:
        raise HTTPException(status_code=403, detail="Requested role is not assigned to this user")

    permissions = sorted({permission.name for permission in role.permissions})
    claims = jwt_handler.build_user_claims(current_user)
    claims.update(
        {
            "actual_sub": claims.get("sub"),
            "actual_user_id": claims.get("user_id"),
            "actual_roles": claims.get("roles", []),
            "acting_role": role_name,
            "effective_roles": [role_name],
            "roles": [role_name],
            "role": role_name,
            "permissions": permissions,
            "is_acting_session": True,
        }
    )
    access_token = jwt_handler.create_access_token(data=claims)
    return {"access_token": access_token, "token_type": "bearer", "acting_role": role_name}


@router.get("/me", response_model=UserResponse)
def get_me(request: Request, current_user: models.User = Depends(get_current_user)):
    response = serialize_user(current_user)
    payload = getattr(current_user, "token_payload", None) or jwt_handler.decode_access_token(getattr(current_user, "token", ""))
    if payload:
        acting_role = payload.get("acting_role")
        response["acting_role"] = acting_role
        response["is_acting_session"] = bool(payload.get("is_acting_session") and acting_role)
        if payload.get("effective_roles"):
            response["roles"] = sorted({str(role) for role in payload.get("effective_roles", []) if str(role).strip()})
            response["role"] = response["roles"][0] if response["roles"] else response.get("role")
        if payload.get("permissions"):
            response["permissions"] = sorted({str(permission) for permission in payload.get("permissions", []) if str(permission).strip()})
    return response


@router.post("/session/refresh")
def refresh_session(current_user: models.User = Depends(get_current_user)):
    """Rotate an active short-lived JWT after the user has shown activity."""
    payload = dict(getattr(current_user, "token_payload", None) or {})
    previous = payload
    payload = jwt_handler.build_user_claims(current_user)
    acting_role = previous.get("acting_role")
    if previous.get("is_acting_session"):
        role = next((role for role in current_user.roles if role.name == acting_role), None)
        if role is None:
            raise HTTPException(status_code=401, detail="Acting role is no longer assigned")
        payload.update(actual_sub=payload["sub"], actual_user_id=payload["user_id"],
                       actual_roles=payload["roles"], acting_role=acting_role,
                       effective_roles=[acting_role], roles=[acting_role], role=acting_role,
                       permissions=sorted({p.name for p in role.permissions}), is_acting_session=True)
    return {
        "access_token": jwt_handler.create_access_token(data=payload),
        "token_type": "bearer",
    }
