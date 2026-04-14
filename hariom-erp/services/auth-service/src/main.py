from fastapi import FastAPI
from pydantic import BaseModel
from sqlalchemy.orm import Session
import os
import uuid

from .database import SessionLocal, engine
from . import models
from .plant_service import PLANT_A_ID, PLANT_B_ID
from .routers import auth, notifications, roles, users
from .security import hashing

app = FastAPI(title="Hari Om Paper ERP - Auth Service")

app.include_router(auth.router)
app.include_router(roles.router)
app.include_router(users.router)
app.include_router(notifications.router)

models.Base.metadata.create_all(bind=engine)


def seed_rbac_defaults():
    role_names = [
        "Owner",
        "Admin",
        "Sales",
        "Planner",
        "PlantManager",
        "Production",
        "Store",
        "QC",
        "Operator",
        "SpecMaker",
        "SpecApprover",
        "SOMaker",
        "SOApprover",
        "DispatchMaker",
        "DispatchApprover",
    ]

    permission_names = [
        "spec:approve",
        "spec:create",
        "so:create",
        "so:approve",
        "dispatch:create",
        "dispatch:approve",
        "dispatch:validate",
        "production:close",
        "inventory:reserve",
    ]

    role_permissions = {
        "SpecMaker": ["spec:create"],
        "SpecApprover": ["spec:approve"],
        "SOMaker": ["so:create"],
        "SOApprover": ["so:approve"],
        "DispatchMaker": ["dispatch:create", "dispatch:validate"],
        "DispatchApprover": ["dispatch:approve", "dispatch:validate"],
        "Production": ["production:close"],
        "Store": ["inventory:reserve"],
    }

    db: Session = SessionLocal()
    try:
        roles_by_name = {}
        for role_name in role_names:
            role = db.query(models.Role).filter(models.Role.name == role_name).first()
            if not role:
                role = models.Role(name=role_name)
                db.add(role)
                db.flush()
            roles_by_name[role_name] = role

        perms_by_name = {}
        for permission_name in permission_names:
            permission = db.query(models.Permission).filter(models.Permission.name == permission_name).first()
            if not permission:
                permission = models.Permission(name=permission_name)
                db.add(permission)
                db.flush()
            perms_by_name[permission_name] = permission

        for role_name, permission_list in role_permissions.items():
            role = roles_by_name[role_name]
            role.permissions = [perms_by_name[name] for name in permission_list]

        db.commit()
    finally:
        db.close()


seed_rbac_defaults()


def seed_default_plants():
    db: Session = SessionLocal()
    try:
        defaults = [
            (PLANT_A_ID, "PLANT_A", "Plant A"),
            (PLANT_B_ID, "PLANT_B", "Plant B"),
            (uuid.UUID("00000000-0000-0000-0000-0000000000ff"), "ALL", "All Visible Plants"),
        ]
        for plant_id, code, name in defaults:
            plant = db.query(models.Plant).filter(models.Plant.code == code).first()
            if not plant:
                db.add(models.Plant(id=plant_id, code=code, name=name, is_active=True))
            else:
                plant.name = name
                plant.is_active = True
        db.commit()
    finally:
        db.close()


seed_default_plants()


def seed_bootstrap_admin():
    db: Session = SessionLocal()
    try:
        admin_email = os.getenv("BOOTSTRAP_ADMIN_EMAIL", "admin@hariom.com")
        admin_password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "admin123")
        admin_name = os.getenv("BOOTSTRAP_ADMIN_NAME", "System Admin")
        admin_plant_code = os.getenv("BOOTSTRAP_ADMIN_PLANT_ID", "PLANT_A")
        admin_plant = db.query(models.Plant).filter(models.Plant.code == admin_plant_code).first()

        admin_roles = db.query(models.Role).filter(models.Role.name.in_(["Owner", "Admin", "Planner"])).all()
        if not admin_roles:
            admin_roles = [models.Role(name="Admin")]
            db.add_all(admin_roles)
            db.flush()

        active_plants = (
            db.query(models.Plant)
            .filter(models.Plant.is_active.is_(True), models.Plant.code != "ALL")
            .order_by(models.Plant.code.asc())
            .all()
        )
        existing_user = db.query(models.User).filter(models.User.email == admin_email).first()

        if existing_user is None:
            if db.query(models.User).count() > 0:
                return
            existing_user = models.User(
                name=admin_name,
                email=admin_email,
                plant_id=admin_plant.id if admin_plant else None,
                hashed_password=hashing.get_password_hash(admin_password),
                is_active=True,
            )
            db.add(existing_user)
            db.flush()

        role_map = {role.name: role for role in existing_user.roles}
        for role in admin_roles:
            role_map[role.name] = role
        existing_user.roles = list(role_map.values())
        existing_user.is_active = True
        existing_user.is_owner_all_plants = True
        existing_user.allowed_plants = active_plants
        if admin_plant:
            existing_user.plant_id = admin_plant.id

        db.commit()
    finally:
        db.close()


seed_bootstrap_admin()


class PlantCreate(BaseModel):
    code: str
    name: str
    is_active: bool = True


class PlantUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    is_active: bool | None = None


@app.get("/plants")
def list_plants():
    db: Session = SessionLocal()
    try:
        plants = db.query(models.Plant).order_by(models.Plant.code.asc()).all()
        return [{"id": plant.code, "code": plant.code, "name": plant.name, "is_active": plant.is_active} for plant in plants]
    finally:
        db.close()


@app.post("/plants")
def create_plant(payload: PlantCreate):
    db: Session = SessionLocal()
    try:
        existing = db.query(models.Plant).filter(models.Plant.code == payload.code).first()
        if existing:
            return {"id": existing.code, "code": existing.code, "name": existing.name, "is_active": existing.is_active}
        plant = models.Plant(id=uuid.uuid4(), code=payload.code, name=payload.name, is_active=payload.is_active)
        db.add(plant)
        db.commit()
        return {"id": plant.code, "code": plant.code, "name": plant.name, "is_active": plant.is_active}
    finally:
        db.close()


@app.patch("/plants/{plant_id}")
def update_plant(plant_id: str, payload: PlantUpdate):
    db: Session = SessionLocal()
    try:
        plant = db.query(models.Plant).filter(models.Plant.code == plant_id).first()
        if not plant:
            return {"message": "Plant not found"}
        updates = payload.model_dump(exclude_unset=True)
        for key, value in updates.items():
            setattr(plant, key, value)
        db.commit()
        return {"id": plant.code, "code": plant.code, "name": plant.name, "is_active": plant.is_active}
    finally:
        db.close()


@app.delete("/plants/{plant_id}")
def delete_plant(plant_id: str):
    db: Session = SessionLocal()
    try:
        plant = db.query(models.Plant).filter(models.Plant.code == plant_id).first()
        if not plant:
            return {"message": "Plant not found"}
        db.delete(plant)
        db.commit()
        return {"message": "Plant deleted"}
    finally:
        db.close()


@app.get("/")
def health_check():
    return {"status": "healthy", "service": "auth-service"}


@app.get("/health")
def detailed_health():
    return {"status": "healthy", "service": "auth-service"}
