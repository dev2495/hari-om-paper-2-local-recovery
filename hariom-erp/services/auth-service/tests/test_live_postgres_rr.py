"""Live two-plant notification recipient isolation with real user rows."""
from __future__ import annotations

import os
import uuid

import pytest

URL = os.environ.get("HARI_OM_AUTH_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or "hariom_nverify" not in URL:
    pytest.skip("Requires isolated hariom_nverify auth Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from sqlalchemy.orm import sessionmaker

from src.database import Base, engine
from src import models
from src.notification_service import create_notifications
from src.security.hashing import get_password_hash


Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
PLANT_A = uuid.UUID("00000000-0000-0000-0000-0000000000a1")
PLANT_B = uuid.UUID("00000000-0000-0000-0000-0000000000b2")


def setup_module() -> None:
    Base.metadata.create_all(engine)


def _ensure_role(db, name: str) -> models.Role:
    role = db.query(models.Role).filter(models.Role.name == name).first()
    if role:
        return role
    role = models.Role(name=name)
    db.add(role)
    db.flush()
    return role


def _user(db, email, roles, plant_id, extra_plants=None, all_plants=False, active=True):
    user = models.User(
        name=email,
        email=email,
        plant_id=plant_id,
        hashed_password=get_password_hash("Nverify_User1!"),
        is_active=active,
        is_owner_all_plants=all_plants,
    )
    user.roles = [_ensure_role(db, name) for name in roles]
    plants = [db.query(models.Plant).filter(models.Plant.id == plant_id).one()]
    for extra in extra_plants or []:
        plants.append(db.query(models.Plant).filter(models.Plant.id == extra).one())
    user.allowed_plants = plants
    db.add(user)
    db.flush()
    return user


def test_two_plant_users_and_limited_admin_do_not_cross_notify():
    db = Session()
    try:
        token = uuid.uuid4().hex[:8]
        for plant_id, code in ((PLANT_A, "PLANT_A"), (PLANT_B, "PLANT_B")):
            if not db.query(models.Plant).filter(models.Plant.id == plant_id).first():
                db.add(models.Plant(id=plant_id, code=code, name=code, is_active=True))
        db.flush()
        qc_a = _user(db, f"qc.a.{token}@hariom.test", ["QC"], PLANT_A)
        qc_b = _user(db, f"qc.b.{token}@hariom.test", ["QC"], PLANT_B)
        limited_admin = _user(db, f"admin.limited.{token}@hariom.test", ["Admin"], PLANT_A, all_plants=False)
        owner_all = _user(db, f"owner.all.{token}@hariom.test", ["Owner"], PLANT_A, extra_plants=[PLANT_B], all_plants=True)
        revoked = _user(db, f"qc.revoked.{token}@hariom.test", ["QC"], PLANT_A, active=False)
        db.commit()

        created_a = create_notifications(
            db,
            event_type="QC_HOLD",
            title="Plant A hold",
            message="inspection failed",
            recipient_roles=["QC", "Admin", "Owner"],
            plant_id=str(PLANT_A),
            event_id=f"evt-a-{token}",
        )
        created_b = create_notifications(
            db,
            event_type="QC_HOLD",
            title="Plant B hold",
            message="inspection failed",
            recipient_roles=["QC", "Admin", "Owner"],
            plant_id=str(PLANT_B),
            event_id=f"evt-b-{token}",
        )
        created_plantless = create_notifications(
            db,
            event_type="QC_HOLD",
            title="Plantless",
            message="no plant",
            recipient_user_ids=[qc_a.id, owner_all.id],
            plant_id=None,
            event_id=f"evt-none-{token}",
        )
        db.commit()

        def ids(event_id):
            return {
                row.user_id
                for row in db.query(models.Notification).filter(models.Notification.event_id == event_id)
            }

        plant_a_ids = ids(f"evt-a-{token}")
        plant_b_ids = ids(f"evt-b-{token}")
        assert qc_a.id in plant_a_ids
        assert limited_admin.id in plant_a_ids
        assert owner_all.id in plant_a_ids
        assert qc_b.id not in plant_a_ids
        assert revoked.id not in plant_a_ids
        assert qc_b.id in plant_b_ids
        assert limited_admin.id not in plant_b_ids
        assert owner_all.id in plant_b_ids
        assert created_plantless == 0
        assert not ids(f"evt-none-{token}")
        assert created_a >= 3
        assert created_b >= 2
    finally:
        db.close()
