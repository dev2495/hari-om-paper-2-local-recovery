"""The Owner and an Admin may approve a purchase order they made themselves (user decision 2026-10-30).

Only the Owner or an Admin decides a PO; the real (assigned) role and the acting role must both be one
of them. The PO history marks such an approval "approved by the same person" with the role (live PostgreSQL).
"""
import os
import uuid
from datetime import date
from unittest.mock import patch

import pytest
from fastapi import HTTPException

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

from src.main import ensure_runtime_schema
from src.database import Base, SessionLocal, engine
from src.models import ItemMaster, PurchaseApprovalDecision, PurchaseOrderRevision
from src.routers.purchase import (
    PurchaseOrderCreate, RevisionActionPayload, approve_purchase_order, create_purchase_order,
    purchase_order_history, reject_purchase_order, submit_purchase_order,
)

PLANT = str(uuid.uuid4())
OWNER = {"sub": "owner.self@example.com", "roles": ["Owner"], "actual_roles": ["Owner"], "token": ""}
ADMIN = {"sub": "admin.self@example.com", "roles": ["Admin"], "actual_roles": ["Admin"], "token": ""}
STORE = {"sub": "store.self@example.com", "roles": ["Store"], "actual_roles": ["Store"], "token": ""}
PLANT_HEAD = {"sub": "pm.self@example.com", "roles": ["PlantManager"], "actual_roles": ["PlantManager"], "token": ""}
# The Owner switched to the Store desk: the acting role cannot decide, although he is the Owner.
OWNER_AS_STORE = {"sub": "owner.self@example.com", "actual_sub": "owner.self@example.com", "roles": ["Store"], "actual_roles": ["Owner"], "token": ""}


def setup_module() -> None:
    Base.metadata.create_all(engine)
    ensure_runtime_schema()


def _item(db):
    item = ItemMaster(item_code=f"SELF-{uuid.uuid4().hex[:8]}", name="Self approval adhesive", type="ADHESIVE", tracking_mode="BULK", uom="KG",
                      plant_id=PLANT, active="true",
                      quality_profile={"status": "approved", "revision": 1, "parameters": [{"code": "viscosity", "min": 1, "max": 9}]})
    db.add(item)
    db.commit()
    return item


def _made_and_submitted(db, maker):
    item = _item(db)
    created = create_purchase_order(PurchaseOrderCreate(
        request_id=uuid.uuid4(), category="RM_PM", supplier_id=uuid.uuid4(), supplier_name="Self mill", expected_date=date(2026, 11, 9),
        lines=[{"item_id": item.id, "qty_ordered": 50, "unit_cost": 40, "uom": "KG"}]), db, PLANT, maker)
    return submit_purchase_order(created["id"], RevisionActionPayload(expected_version=created["version"], reason="Ready"), db, PLANT, maker)


@pytest.mark.parametrize("maker,role", [(OWNER, "Owner"), (ADMIN, "Admin")])
def test_owner_and_admin_create_submit_and_approve_their_own_po(maker, role):
    with SessionLocal() as db, patch("src.routers.purchase.emit_audit_event") as audit:
        submitted = _made_and_submitted(db, maker)
        assert maker["sub"] in submitted["revision_makers"]
        approved = approve_purchase_order(submitted["id"], RevisionActionPayload(expected_version=submitted["version"], reason="Checked"), db, PLANT, maker)
        assert approved["status"] == "APPROVED" and approved["approved_by"] == maker["sub"]
        history = purchase_order_history(submitted["id"], db, PLANT, maker)["items"][0]
        assert history["approved_by"] == maker["sub"] and history["approved_by_same_person"] is True and history["approved_as"] == role
        revision = db.query(PurchaseOrderRevision).filter_by(purchase_order_id=submitted["id"]).one()
        decision = db.query(PurchaseApprovalDecision).filter_by(revision_id=revision.id, decision="APPROVED").one()
        assert decision.actor_role == role
        assert audit.call_args.kwargs["summary"].endswith(f"by the same person ({role})")


def test_a_second_person_approval_is_not_marked_same_person():
    with SessionLocal() as db, patch("src.routers.purchase.emit_audit_event"):
        submitted = _made_and_submitted(db, STORE)
        approved = approve_purchase_order(submitted["id"], RevisionActionPayload(expected_version=submitted["version"]), db, PLANT, ADMIN)
        assert approved["status"] == "APPROVED"
        history = purchase_order_history(submitted["id"], db, PLANT, ADMIN)["items"][0]
        assert history["approved_by_same_person"] is False and history["approved_as"] == "Admin"


@pytest.mark.parametrize("decider", [STORE, PLANT_HEAD, OWNER_AS_STORE])
def test_only_owner_or_admin_decide_a_po(decider):
    with SessionLocal() as db, patch("src.routers.purchase.emit_audit_event"):
        submitted = _made_and_submitted(db, STORE)
        for action in (approve_purchase_order, reject_purchase_order):
            with pytest.raises(HTTPException) as refused:
                action(submitted["id"], RevisionActionPayload(expected_version=submitted["version"], reason="Not mine to decide"), db, PLANT, decider)
            assert refused.value.status_code == 403
            assert "Owner or an Admin" in refused.value.detail


def test_owner_may_send_back_his_own_revision():
    with SessionLocal() as db, patch("src.routers.purchase.emit_audit_event"):
        submitted = _made_and_submitted(db, OWNER)
        rejected = reject_purchase_order(submitted["id"], RevisionActionPayload(expected_version=submitted["version"], reason="Wrong vendor"), db, PLANT, OWNER)
        assert rejected["status"] == "REJECTED"
