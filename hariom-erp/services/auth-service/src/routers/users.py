from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
import uuid
from ..database import get_db
from .. import models
from ..notification_service import create_notifications
from ..security import hashing
from ..plant_service import apply_user_scope
from fastapi import Request

from ..utils.deps import get_current_user, require_internal_event_request, require_role
from .auth import serialize_user, UserResponse, UserCreate, _assign_roles

router = APIRouter(prefix="/users", tags=["users"])

class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    plant_id: Optional[uuid.UUID] = None
    allowed_plant_ids: Optional[List[uuid.UUID]] = None
    is_owner_all_plants: Optional[bool] = None
    is_active: Optional[bool] = None
    role_names: Optional[List[str]] = None

@router.get("/", response_model=List[UserResponse])
def list_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(["Admin"]))
):
    users = db.query(models.User).order_by(models.User.created_at.desc()).all()
    return [serialize_user(user) for user in users]


@router.get("/owners/active")
def list_active_owner_recipients(
    request: Request,
    db: Session = Depends(get_db),
):
    require_internal_event_request(request)
    owner_role = db.query(models.Role).filter(models.Role.name == "Owner").first()
    if not owner_role:
        return {"items": []}
    return {
        "items": [
            {
                "id": str(user.id),
                "email": user.email,
                "name": user.name,
            }
            for user in owner_role.users
            if user.is_active
        ]
    }

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
        hashed_password=hashed_pw
    )

    db.add(new_user)
    _assign_roles(new_user, user_in.role_names, db)
    apply_user_scope(
        db=db,
        user=new_user,
        plant_id=user_in.plant_id,
        allowed_plant_ids=user_in.allowed_plant_ids,
        is_owner_all_plants=user_in.is_owner_all_plants,
    )

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
    
    roles_changed = False
    if "role_names" in updates:
        _assign_roles(user, updates.pop("role_names"), db)
        roles_changed = True

    has_scope_update = (
        "plant_id" in updates
        or "allowed_plant_ids" in updates
        or "is_owner_all_plants" in updates
    )
    if has_scope_update or roles_changed:
        requested_plant_id = updates.pop("plant_id", user.plant_id)
        requested_allowed = updates.pop("allowed_plant_ids", [plant.id for plant in user.allowed_plants])
        requested_all = updates.pop("is_owner_all_plants", user.is_owner_all_plants)
        apply_user_scope(
            db=db,
            user=user,
            plant_id=requested_plant_id,
            allowed_plant_ids=requested_allowed,
            is_owner_all_plants=requested_all,
        )
        
    for field, value in updates.items():
        setattr(user, field, value)
        
    db.commit()
    db.refresh(user)
    create_notifications(
        db,
        event_type="RBAC_USER_UPDATED",
        title=f"User updated: {user.name}",
        message=f"{user.email} details or access were updated.",
        href="/system/users",
        recipient_roles=["Owner", "Admin"],
        recipient_user_ids=[user.id],
        actor_user_id=current_user.id,
        payload={
            "user_id": str(user.id),
            "roles": sorted([role.name for role in user.roles]),
            "is_active": user.is_active,
        },
    )
    db.commit()
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
        
    deleted_email = user.email
    deleted_id = str(user.id)
    db.delete(user)
    db.commit()
    create_notifications(
        db,
        event_type="RBAC_USER_DELETED",
        title="User deleted",
        message=f"{deleted_email} was removed from the ERP workspace.",
        href="/system/users",
        recipient_roles=["Owner", "Admin"],
        actor_user_id=current_user.id,
        payload={"user_id": deleted_id, "email": deleted_email},
    )
    db.commit()
    return {"message": "User deleted successfully"}
