from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
import uuid
from ..database import get_db
from .. import models
from ..security import hashing
from ..utils.deps import get_current_user, require_role
from .auth import serialize_user, UserResponse, UserCreate

router = APIRouter(prefix="/users", tags=["users"])

class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    plant_id: Optional[str] = None
    is_active: Optional[bool] = None
    role_names: Optional[List[str]] = None

@router.get("/", response_model=List[UserResponse])
def list_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(["Admin"]))
):
    users = db.query(models.User).order_by(models.User.created_at.desc()).all()
    return [serialize_user(user) for user in users]

@router.post("/", response_model=UserResponse)
def create_user(
    user_in: UserCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(["Admin"]))
):
    db_user = db.query(models.User).filter(models.User.email == user_in.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    hashed_pw = hashing.get_password_hash(user_in.password)
    new_user = models.User(
        name=user_in.name,
        email=user_in.email,
        plant_id=user_in.plant_id,
        hashed_password=hashed_pw
    )

    if user_in.role_names:
        roles = db.query(models.Role).filter(models.Role.name.in_(user_in.role_names)).all()
        new_user.roles = roles

    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return serialize_user(new_user)

@router.get("/{user_id}", response_model=UserResponse)
def get_user(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(["Admin"]))
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return serialize_user(user)

@router.put("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(["Admin"]))
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    updates = payload.model_dump(exclude_unset=True)
    
    if "role_names" in updates:
        role_names = updates.pop("role_names")
        roles = db.query(models.Role).filter(models.Role.name.in_(role_names)).all()
        user.roles = roles
        
    for field, value in updates.items():
        setattr(user, field, value)
        
    db.commit()
    db.refresh(user)
    return serialize_user(user)

@router.delete("/{user_id}")
def delete_user(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(["Admin"]))
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check if deleting self
    if str(user.id) == str(current_user.id):
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
        
    db.delete(user)
    db.commit()
    return {"message": "User deleted successfully"}
