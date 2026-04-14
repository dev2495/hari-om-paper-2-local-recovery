from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
import uuid
from ..database import get_db
from .. import models
from ..utils.deps import require_role
from ..workspace import seeded_role_groups

router = APIRouter(prefix="/roles", tags=["roles"])

class RoleCreate(BaseModel):
    name: str

class RoleAssignment(BaseModel):
    user_id: uuid.UUID
    role_name: str


class RoleMatrixUpdate(BaseModel):
    enabled_roles: list[str] | None = None


@router.get("/")
def list_roles(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(["Admin"]))
):
    roles = db.query(models.Role).order_by(models.Role.name.asc()).all()
    return [{"id": str(role.id), "name": role.name} for role in roles]

@router.post("/create")
def create_role(role_in: RoleCreate, db: Session = Depends(get_db)):
    db_role = db.query(models.Role).filter(models.Role.name == role_in.name).first()
    if db_role:
        raise HTTPException(status_code=400, detail="Role already exists")
    
    new_role = models.Role(name=role_in.name)
    db.add(new_role)
    db.commit()
    db.refresh(new_role)
    return new_role

@router.post("/assign")
def assign_role(assign_in: RoleAssignment, db: Session = Depends(get_db), current_user: models.User = Depends(require_role(["Admin"]))):
    user = db.query(models.User).filter(models.User.id == assign_in.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    role = db.query(models.Role).filter(models.Role.name == assign_in.role_name).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    
    if role not in user.roles:
        user.roles.append(role)
        db.commit()
    
    return {"message": f"Role {assign_in.role_name} assigned to user {user.email}"}


@router.get("/matrix")
def get_role_matrix(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(["Admin", "Owner"])),
):
    del current_user
    roles = db.query(models.Role).order_by(models.Role.name.asc()).all()
    role_names = [role.name for role in roles]
    return {
        "seeded_role_groups": seeded_role_groups(),
        "enabled_roles": role_names,
        "role_matrix": {
            role_name: {
                "label": role_name,
                "enabled": True,
            }
            for role_name in role_names
        },
    }


@router.put("/matrix")
def update_role_matrix(
    payload: RoleMatrixUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(["Admin", "Owner"])),
):
    del payload, current_user
    roles = db.query(models.Role).order_by(models.Role.name.asc()).all()
    role_names = [role.name for role in roles]
    return {
        "seeded_role_groups": seeded_role_groups(),
        "enabled_roles": role_names,
        "role_matrix": {
            role_name: {
                "label": role_name,
                "enabled": True,
            }
            for role_name in role_names
        },
    }
