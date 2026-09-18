"""QCT-035/036: list-action QC draft on approved spec; role/state mutations."""
from __future__ import annotations

import os
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import sessionmaker

URL = os.environ.get("HARI_OM_SPEC_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or "hariom_nverify" not in URL:
    pytest.skip("Requires isolated hariom_nverify spec Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from src.main import ensure_runtime_schema
from src.database import engine
from src.models import RecipeHeader, SpecificationSheet
from src.routers.recipes import RecipeCreate, create_recipe
from src.routers.specs import (
    QcProfileApprovePayload,
    QcProfileUpdate,
    SpecCreate,
    approve_spec_qc_profile,
    create_spec,
    upsert_spec_qc_profile,
)

ensure_runtime_schema()
Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
PLANT = "00000000-0000-0000-0000-0000000000a1"
ADMIN = {"sub": "nverify-qct035-admin", "role": "Admin"}
QC = {"sub": "nverify-qct036-qc", "role": "QC"}
VIEWER = {"sub": "nverify-qct036-sales", "role": "Sales"}


def _draft_payload(marker: str) -> SpecCreate:
    return SpecCreate(
        customer_name=marker,
        customer_name_snapshot=marker,
        tube_size_id=uuid.uuid4(),
        mandrel_id=uuid.uuid4(),
        required_cs=100.0,
        target_tube_weight=250.0,
    )


def _complete_profile(*, id_min: float = 76.0, status: str = "draft") -> dict:
    return {
        "status": status,
        "stages": {
            "WINDER": {
                "parameters": [
                    {"code": "id", "min": id_min, "max": 78.0, "unit": "mm", "required": True},
                    {"code": "od", "min": 90.0, "max": 92.0, "unit": "mm", "required": True},
                    {"code": "height", "min": 118.0, "max": 122.0, "unit": "mm", "required": True},
                    {"code": "weight", "min": 240.0, "max": 260.0, "unit": "g", "required": True},
                    {"code": "cs", "min": 90.0, "max": 110.0, "unit": "N", "required": True},
                ]
            },
            "OVEN": {
                "parameters": [
                    {"code": "pre_weight", "min": 1.0, "max": 2.0, "unit": "g", "required": True},
                    {"code": "post_weight", "min": 1.0, "max": 2.0, "unit": "g", "required": True},
                    {"code": "pre_moisture", "min": 1.0, "max": 9.0, "unit": "%", "required": True},
                    {"code": "post_moisture", "min": 1.0, "max": 9.0, "unit": "%", "required": True},
                ]
            },
            "PROCESS": {
                "parameters": [
                    {"code": "height", "min": 118.0, "max": 122.0, "unit": "mm", "required": True},
                    {"code": "weight", "min": 240.0, "max": 260.0, "unit": "g", "required": True},
                    {"code": "cs", "min": 90.0, "max": 110.0, "unit": "N", "required": True},
                    {"code": "notch_distance", "applicable": False},
                    {"code": "notch_depth", "applicable": False},
                    {"code": "moisture", "min": 1.0, "max": 9.0, "unit": "%", "required": True},
                ]
            },
        },
    }


def test_qct035_approved_spec_qc_draft_keeps_spec_and_recipe_ids():
    marker = f"QCT035-{uuid.uuid4()}"
    db = Session()
    try:
        created = create_spec(_draft_payload(marker), db=db, plant_id=PLANT, current_user=ADMIN)
        spec_id = created["id"] if isinstance(created, dict) else created.id
        recipe = create_recipe(
            spec_id,
            RecipeCreate(notes="QCT-035 legacy recipe"),
            db=db,
            plant_id=PLANT,
            current_user=ADMIN,
        )
        recipe_id = recipe.id
        spec = db.query(SpecificationSheet).filter(SpecificationSheet.id == spec_id).one()
        spec.status = "approved"
        spec.qc_profile = None
        db.commit()

        saved = upsert_spec_qc_profile(
            spec_id,
            QcProfileUpdate(
                qc_profile={"status": "draft", "stages": {"WINDER": {"parameters": [{"code": "id", "min": 76.0, "max": 78.0, "unit": "mm"}]}}},
                status="draft",
                save_operation_key=f"qc-add-{uuid.uuid4()}",
            ),
            db=db,
            plant_id=PLANT,
            current_user=ADMIN,
        )
        saved_id = saved["id"] if isinstance(saved, dict) else saved.id
        assert str(saved_id) == str(spec_id)
        db.expire_all()
        stored = db.query(SpecificationSheet).filter(SpecificationSheet.id == spec_id).one()
        assert stored.status == "approved"
        assert str(stored.id) == str(spec_id)
        assert (stored.qc_profile or {}).get("status") == "draft"
        recipes = db.query(RecipeHeader).filter(RecipeHeader.spec_id == spec_id).all()
        assert [str(row.id) for row in recipes] == [str(recipe_id)]
        twins = db.query(SpecificationSheet).filter(SpecificationSheet.customer_name == marker).all()
        assert len(twins) == 1
        assert stored.status != "obsolete"
    finally:
        db.close()


def test_qct036_role_matrix_and_retired_spec_cannot_mutate():
    marker = f"QCT036-{uuid.uuid4()}"
    db = Session()
    try:
        created = create_spec(_draft_payload(marker), db=db, plant_id=PLANT, current_user=ADMIN)
        spec_id = created["id"] if isinstance(created, dict) else created.id
        with pytest.raises(HTTPException) as viewer_denied:
            upsert_spec_qc_profile(
                spec_id,
                QcProfileUpdate(
                    qc_profile={"status": "draft", "stages": {}},
                    status="draft",
                ),
                db=db,
                plant_id=PLANT,
                current_user=VIEWER,
            )
        assert viewer_denied.value.status_code == 403

        qc_saved = upsert_spec_qc_profile(
            spec_id,
            QcProfileUpdate(qc_profile=_complete_profile(status="draft"), status="draft"),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert (qc_saved["qc_profile"] if isinstance(qc_saved, dict) else qc_saved.qc_profile)["status"] != "approved"

        with pytest.raises(HTTPException) as qc_cannot_approve:
            approve_spec_qc_profile(
                spec_id,
                QcProfileApprovePayload(expected_revision=1),
                db=db,
                plant_id=PLANT,
                current_user=QC,
            )
        assert qc_cannot_approve.value.status_code == 403

        pending = upsert_spec_qc_profile(
            spec_id,
            QcProfileUpdate(qc_profile=_complete_profile(status="pending_review"), status="pending_review"),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        revision = int((pending["qc_profile"] if isinstance(pending, dict) else pending.qc_profile).get("revision") or 1)
        approved = approve_spec_qc_profile(
            spec_id,
            QcProfileApprovePayload(expected_revision=revision),
            db=db,
            plant_id=PLANT,
            current_user=ADMIN,
        )
        assert (approved["qc_profile"] if isinstance(approved, dict) else approved.qc_profile)["status"] == "approved"

        revision_saved = upsert_spec_qc_profile(
            spec_id,
            QcProfileUpdate(qc_profile=_complete_profile(id_min=76.2, status="draft"), status="draft"),
            db=db,
            plant_id=PLANT,
            current_user=ADMIN,
        )
        profile = revision_saved["qc_profile"] if isinstance(revision_saved, dict) else revision_saved.qc_profile
        assert profile.get("status") == "draft"
        assert int(profile.get("revision") or 0) >= 2
        assert str(revision_saved["id"] if isinstance(revision_saved, dict) else revision_saved.id) == str(spec_id)

        stored = db.query(SpecificationSheet).filter(SpecificationSheet.id == spec_id).one()
        stored.active = False
        stored.status = "obsolete"
        db.commit()
        with pytest.raises(HTTPException) as retired:
            upsert_spec_qc_profile(
                spec_id,
                QcProfileUpdate(qc_profile=_complete_profile(status="draft"), status="draft"),
                db=db,
                plant_id=PLANT,
                current_user=ADMIN,
            )
        assert retired.value.status_code == 400
        db.expire_all()
        frozen = db.query(SpecificationSheet).filter(SpecificationSheet.id == spec_id).one()
        assert frozen.status == "obsolete"
        assert frozen.active is False
    finally:
        db.close()
