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
from .workspace import BUSINESS_ROLE_ORDER, LEGACY_ROLE_NAMES, ROLE_CAPABILITIES, canonical_role_name

app = FastAPI(title="Hari Om Paper ERP - Auth Service")

app.include_router(auth.router)
app.include_router(roles.router)
app.include_router(users.router)
app.include_router(notifications.router)

models.Base.metadata.create_all(bind=engine)


def env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def is_production_environment() -> bool:
    candidates = [
        os.getenv("APP_ENV"),
        os.getenv("ENVIRONMENT"),
        os.getenv("FASTAPI_ENV"),
        os.getenv("NODE_ENV"),
    ]
    return any(str(value or "").strip().lower() in {"prod", "production"} for value in candidates)


def should_seed_demo_users() -> bool:
    # Local/demo remains frictionless, but production must opt in explicitly.
    return env_flag("SEED_DEMO_USERS", default=not is_production_environment())


def seed_rbac_defaults():
    role_names = BUSINESS_ROLE_ORDER
    permission_names = sorted({permission for role in ROLE_CAPABILITIES.values() for permission in role["permissions"]})
    role_permissions = {role: ROLE_CAPABILITIES[role]["permissions"] for role in BUSINESS_ROLE_ORDER}

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

        # Existing local databases may still contain the old maker/checker release roles.
        # Convert any manually created users to the condensed business role, then remove
        # seeded release-test accounts and role rows so they do not keep reappearing.
        for user in db.query(models.User).all():
            email = str(user.email or "").lower()
            name = str(user.name or "").lower()
            is_legacy_demo_user = (
                email.startswith("release.")
                or email.startswith("qa.")
                or ".maker@" in email
                or ".approver@" in email
                or email in {"so.maker@hariom.com", "so.approver@hariom.com"}
                or email.startswith("accept.")
                or " maker" in name
                or " approver" in name
            )
            if is_legacy_demo_user:
                # Keep historical notification FKs valid, but hide/deactivate
                # the legacy release-test accounts and detach old role rows.
                user.is_active = False
                user.roles = []
                continue
            next_role_names = {
                canonical_role_name(role.name)
                for role in user.roles
                if canonical_role_name(role.name)
            }
            if next_role_names:
                user.roles = [roles_by_name[name] for name in BUSINESS_ROLE_ORDER if name in next_role_names]

        db.flush()
        for legacy_name in LEGACY_ROLE_NAMES:
            legacy_role = db.query(models.Role).filter(models.Role.name == legacy_name).first()
            if legacy_role:
                legacy_role.users = []
                legacy_role.permissions = []
                db.delete(legacy_role)

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


def seed_canonical_demo_users():
    db: Session = SessionLocal()
    try:
        plant_a = db.query(models.Plant).filter(models.Plant.code == "PLANT_A").first()
        plant_b = db.query(models.Plant).filter(models.Plant.code == "PLANT_B").first()
        active_plants = (
            db.query(models.Plant)
            .filter(models.Plant.is_active.is_(True), models.Plant.code != "ALL")
            .order_by(models.Plant.code.asc())
            .all()
        )
        role_map = {role.name: role for role in db.query(models.Role).filter(models.Role.name.in_(BUSINESS_ROLE_ORDER)).all()}
        canonical_users = [
            ("owner@hariom.com", "System Owner", "owner123", ["Owner"], plant_a, True),
            ("sales@hariom.com", "Sales User A", "sales123", ["Sales"], plant_a, False),
            ("planner@hariom.com", "Planner User A", "planner123", ["Planner"], plant_a, False),
            ("plantmanager.a@hariom.com", "Plant Manager A", "managera123", ["PlantManager"], plant_a, False),
            ("plantmanager.b@hariom.com", "Plant Manager B", "managerb123", ["PlantManager"], plant_b, False),
            ("store@hariom.com", "Store User A", "store123", ["Store"], plant_a, False),
            ("dispatch@hariom.com", "Dispatch User A", "dispatch123", ["Dispatch"], plant_a, False),
            ("operator@hariom.com", "Operator User A", "operator123", ["Operator"], plant_a, False),
        ]
        for email, name, password, role_names, plant, is_all_plants in canonical_users:
            if not plant and not is_all_plants:
                continue
            user = db.query(models.User).filter(models.User.email == email).first()
            if user is None:
                user = models.User(
                    name=name,
                    email=email,
                    hashed_password=hashing.get_password_hash(password),
                    plant_id=plant.id if plant else None,
                    is_active=True,
                )
                db.add(user)
                db.flush()
            user.name = name
            user.is_active = True
            user.roles = [role_map[role_name] for role_name in role_names if role_name in role_map]
            user.is_owner_all_plants = bool(is_all_plants)
            if is_all_plants:
                user.allowed_plants = active_plants
                if plant:
                    user.plant_id = plant.id
            elif plant:
                user.plant_id = plant.id
                user.allowed_plants = [plant]
        db.commit()
    finally:
        db.close()


if should_seed_demo_users():
    seed_canonical_demo_users()


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
        return [{"id": str(plant.id), "code": plant.code, "name": plant.name, "is_active": plant.is_active} for plant in plants]
    finally:
        db.close()


@app.post("/plants")
def create_plant(payload: PlantCreate):
    db: Session = SessionLocal()
    try:
        existing = db.query(models.Plant).filter(models.Plant.code == payload.code).first()
        if existing:
            return {"id": str(existing.id), "code": existing.code, "name": existing.name, "is_active": existing.is_active}
        plant = models.Plant(id=uuid.uuid4(), code=payload.code, name=payload.name, is_active=payload.is_active)
        db.add(plant)
        db.commit()
        return {"id": str(plant.id), "code": plant.code, "name": plant.name, "is_active": plant.is_active}
    finally:
        db.close()


@app.patch("/plants/{plant_id}")
def update_plant(plant_id: str, payload: PlantUpdate):
    db: Session = SessionLocal()
    try:
        query = db.query(models.Plant).filter(models.Plant.code == plant_id)
        try:
            query = query.union(db.query(models.Plant).filter(models.Plant.id == uuid.UUID(plant_id)))
        except ValueError:
            pass
        plant = query.first()
        if not plant:
            return {"message": "Plant not found"}
        updates = payload.model_dump(exclude_unset=True)
        for key, value in updates.items():
            setattr(plant, key, value)
        db.commit()
        return {"id": str(plant.id), "code": plant.code, "name": plant.name, "is_active": plant.is_active}
    finally:
        db.close()


@app.delete("/plants/{plant_id}")
def delete_plant(plant_id: str):
    db: Session = SessionLocal()
    try:
        query = db.query(models.Plant).filter(models.Plant.code == plant_id)
        try:
            query = query.union(db.query(models.Plant).filter(models.Plant.id == uuid.UUID(plant_id)))
        except ValueError:
            pass
        plant = query.first()
        if not plant:
            return {"message": "Plant not found"}
        plant.is_active = False
        db.commit()
        return {"message": "Plant disabled"}
    finally:
        db.close()


@app.get("/")
def health_check():
    return {"status": "healthy", "service": "auth-service"}


@app.get("/health")
def detailed_health():
    return {"status": "healthy", "service": "auth-service"}
