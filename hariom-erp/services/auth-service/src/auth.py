from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from typing import List
from pydantic import BaseModel, EmailStr
import uuid
from ..database import get_db
from .. import models
from ..security import hashing, jwt_handler
from ..utils.deps import get_current_user, require_role

router = APIRouter(prefix="/auth", tags=["auth"])

class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    plant_id: str = "PLANT_A"
    role_names: List[str] = []

class UserResponse(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    plant_id: str
    is_active: bool
    role: str | None = None
    roles: List[str]
    permissions: List[str]

    class Config:
        from_attributes = True


class UserStatusUpdate(BaseModel):
    is_active: bool


class UserRoleAssignment(BaseModel):
    role_names: List[str]


def serialize_user(user: models.User) -> dict:
    permissions = sorted({
        permission.name
        for role in user.roles
        for permission in role.permissions
    })
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "plant_id": user.plant.code if getattr(user, "plant", None) and user.plant else (str(user.plant_id) if user.plant_id else "PLANT_A"),
        "is_active": user.is_active,
        "role": sorted([role.name for role in user.roles])[0] if user.roles else None,
        "roles": sorted([role.name for role in user.roles]),
        "permissions": permissions,
    }


def create_user_record(user_in: UserCreate, db: Session) -> models.User:
    db_user = db.query(models.User).filter(models.User.email == user_in.email).first()
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

    if user_in.role_names:
        roles = db.query(models.Role).filter(models.Role.name.in_(user_in.role_names)).all()
        new_user.roles = roles

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


    db.refresh(user)
    return user

@router.post("/login")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == form_data.username).first()
    if not user or not hashing.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive"
        )

    claims = jwt_handler.build_user_claims(user)
    access_token = jwt_handler.create_access_token(data=claims)
    return {"access_token": access_token, "token_type": "bearer", "user": serialize_user(user)}

@router.get("/me", response_model=UserResponse)
def get_me(current_user: models.User = Depends(get_current_user)):
    return serialize_user(current_user)
