from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
import uuid
from ..database import get_db
from .. import models
from ..utils.deps import require_role
from ..workspace import BUSINESS_ROLE_ORDER, OVERRIDE_RIGHTS, ROLE_CAPABILITIES, seeded_role_groups

router = APIRouter(prefix="/roles", tags=["roles"])

class RoleCreate(BaseModel):
    name: str

class RoleAssignment(BaseModel):
    user_id: uuid.UUID
    role_name: str


class RoleMatrixUpdate(BaseModel):
    enabled_roles: list[str] | None = None


def _business_role_order(role_name: str) -> int:
    try:
        return BUSINESS_ROLE_ORDER.index(role_name)
    except ValueError:
        return len(BUSINESS_ROLE_ORDER)


def _ordered_business_roles(db: Session) -> list[models.Role]:
    roles = db.query(models.Role).filter(models.Role.name.in_(BUSINESS_ROLE_ORDER)).all()
    return sorted(roles, key=lambda role: _business_role_order(role.name))


def _matrix_response(db: Session) -> dict:
    roles = _ordered_business_roles(db)
    role_names = [role.name for role in roles]
    return {
        "seeded_role_groups": seeded_role_groups(),
        "override_rights": OVERRIDE_RIGHTS,
        "enabled_roles": role_names,
        "role_matrix": {
            role_name: {
                "label": role_name,
                "enabled": True,
                "summary": ROLE_CAPABILITIES.get(role_name, {}).get("summary", ""),
                "permissions": ROLE_CAPABILITIES.get(role_name, {}).get("permissions", []),
            }
            for role_name in role_names
        },
    }


@router.get("/")
def list_roles(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(["Admin"]))
):
    roles = _ordered_business_roles(db)
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
    return _matrix_response(db)


@router.put("/matrix")
def update_role_matrix(
    payload: RoleMatrixUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(["Admin", "Owner"])),
):
    del current_user
    if payload.enabled_roles is not None:
        requested = []
        seen = set()
        invalid_roles = []
        for role_name in payload.enabled_roles:
            role_name = str(role_name or "").strip()
            if not role_name:
                continue
            if role_name not in BUSINESS_ROLE_ORDER:
                invalid_roles.append(role_name)
                continue
            if role_name not in seen:
                requested.append(role_name)
                seen.add(role_name)
        if invalid_roles:
            raise HTTPException(status_code=400, detail=f"Unknown roles: {', '.join(sorted(invalid_roles))}")

        enabled = {"Owner", "Admin", *requested}
        permission_names = sorted({permission for role in ROLE_CAPABILITIES.values() for permission in role["permissions"]})
        permissions = {}
        for permission_name in permission_names:
            permission = db.query(models.Permission).filter(models.Permission.name == permission_name).first()
            if not permission:
                permission = models.Permission(name=permission_name)
                db.add(permission)
                db.flush()
            permissions[permission_name] = permission

        for role_name in BUSINESS_ROLE_ORDER:
            role = db.query(models.Role).filter(models.Role.name == role_name).first()
            if role_name in enabled:
                if not role:
                    role = models.Role(name=role_name)
                    db.add(role)
                    db.flush()
                role.permissions = [permissions[name] for name in ROLE_CAPABILITIES.get(role_name, {}).get("permissions", [])]
            elif role:
                role.users = []
                role.permissions = []
                db.delete(role)
        db.commit()
    return _matrix_response(db)
