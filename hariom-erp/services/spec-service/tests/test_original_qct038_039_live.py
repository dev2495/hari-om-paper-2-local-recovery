"""QCT-038/039: canonical final limits; process-only vs contractual revision."""
from __future__ import annotations

import json
import os
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text
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
    FinalLimitsUpdate,
    QcProfileUpdate,
    SpecCreate,
    SpecUpdate,
    create_spec,
    update_spec,
    update_spec_final_limits,
    upsert_spec_qc_profile,
)

ensure_runtime_schema()
Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
PLANT = "00000000-0000-0000-0000-0000000000a1"
ADMIN = {"sub": "nverify-qct038-admin", "role": "Admin"}
QC = {"sub": "nverify-qct039-qc", "role": "QC"}
PROD_URL = os.environ.get("HARI_OM_PRODUCTION_DATABASE_URL") or (
    "postgresql://devarshthakkar@127.0.0.1:5432/hariom_nverify_productiondb"
)


def _draft_payload(marker: str, **fields) -> SpecCreate:
    return SpecCreate(
        customer_name=marker,
        customer_name_snapshot=marker,
        tube_size_id=uuid.uuid4(),
        mandrel_id=uuid.uuid4(),
        required_cs=100.0,
        target_tube_weight=250.0,
        id_min_mm=76.0,
        id_max_mm=78.0,
        od_min_mm=90.0,
        od_max_mm=92.0,
        length_min_mm=118.0,
        length_max_mm=122.0,
        weight_min_g=240.0,
        weight_max_g=260.0,
        cs_min_n=90.0,
        cs_max_n=110.0,
        **fields,
    )


def _issue_job(spec_id, snapshot: dict):
    prod = create_engine(PROD_URL)
    order_id = uuid.uuid4()
    job_id = uuid.uuid4()
    with prod.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO sales_orders (id, plant_id, customer_id, spec_id, order_qty, due_date, priority, status, created_at)
                VALUES (:id, :plant, :cid, :sid, 10, CURRENT_DATE, 'NORMAL', 'OPEN', NOW())
                """
            ),
            {"id": str(order_id), "plant": PLANT, "cid": str(uuid.uuid4()), "sid": str(spec_id)},
        )
        conn.execute(
            text(
                """
                INSERT INTO job_cards (
                    id, plant_id, sales_order_id, spec_id, spec_snapshot, routing_snapshot,
                    material_plan_snapshot, planned_qty, released_qty, status, current_stage,
                    requires_slitting, created_at
                ) VALUES (
                    :id, :plant, :oid, :sid, CAST(:snap AS jsonb), '{}'::jsonb, '{}'::jsonb,
                    10, 10, 'IN_PROGRESS', 'WINDER', FALSE, NOW()
                )
                """
            ),
            {
                "id": str(job_id),
                "plant": PLANT,
                "oid": str(order_id),
                "sid": str(spec_id),
                "snap": json.dumps(snapshot),
            },
        )
    return job_id


def _job_snapshot(job_id):
    prod = create_engine(PROD_URL)
    with prod.connect() as conn:
        row = conn.execute(
            text("SELECT spec_snapshot FROM job_cards WHERE id = :id"),
            {"id": str(job_id)},
        ).one()
    return row[0]


def test_qct038_one_canonical_rule_rejects_dual_writes():
    marker = f"QCT038-{uuid.uuid4()}"
    db = Session()
    try:
        created = create_spec(_draft_payload(marker), db=db, plant_id=PLANT, current_user=ADMIN)
        spec_id = created["id"] if isinstance(created, dict) else created.id
        assert created["final_limits"]["id_min_mm"] == 76.0
        assert created["qc_profile"]["final"]["id"]["min"] == 76.0
        assert created["qc_profile"]["final"]["id"]["source"] == "canonical"

        frozen = {
            "id_min_mm": 76.0,
            "id_max_mm": 78.0,
            "final_limits": {"id_min_mm": 76.0, "id_max_mm": 78.0},
        }
        job_id = _issue_job(spec_id, frozen)

        via_new = update_spec_final_limits(
            spec_id,
            FinalLimitsUpdate(id_min_mm=76.2, id_max_mm=78.0, expected_revision=created["write_revision"]),
            db=db,
            plant_id=PLANT,
            current_user=ADMIN,
        )
        assert via_new["id_min_mm"] == 76.2
        assert via_new["final_limits"]["id_min_mm"] == 76.2
        assert via_new["qc_profile"]["final"]["id"]["min"] == 76.2

        via_legacy = update_spec(
            spec_id,
            SpecUpdate(id_min_mm=76.4, expected_revision=via_new["write_revision"]),
            db=db,
            plant_id=PLANT,
            current_user=ADMIN,
        )
        assert via_legacy["id_min_mm"] == 76.4
        assert via_legacy["final_limits"]["id_min_mm"] == 76.4
        assert via_legacy["qc_profile"]["final"]["id"]["min"] == 76.4

        with pytest.raises(HTTPException) as dual:
            update_spec(
                spec_id,
                SpecUpdate(
                    id_min_mm=70.0,
                    qc_profile={"final": {"id": {"min": 80.0, "max": 82.0}}},
                    expected_revision=via_legacy["write_revision"],
                ),
                db=db,
                plant_id=PLANT,
                current_user=ADMIN,
            )
        assert dual.value.status_code == 409
        assert dual.value.detail["code"] == "CONFLICTING_FINAL_LIMITS"

        with pytest.raises(HTTPException) as qc_final:
            upsert_spec_qc_profile(
                spec_id,
                QcProfileUpdate(qc_profile={"final": {"id": {"min": 76.4, "max": 78.0}}}),
                db=db,
                plant_id=PLANT,
                current_user=ADMIN,
            )
        assert qc_final.value.status_code == 409
        assert qc_final.value.detail["code"] == "CONTRACTUAL_FINAL_REQUIRES_SPEC_COMMAND"

        db.expire_all()
        stored = db.query(SpecificationSheet).filter(SpecificationSheet.id == spec_id).one()
        assert stored.id_min_mm == 76.4
        snap = _job_snapshot(job_id)
        assert snap["id_min_mm"] == 76.0
        assert snap["final_limits"]["id_min_mm"] == 76.0

        stored.status = "approved"
        db.commit()
        replacement = update_spec_final_limits(
            spec_id,
            FinalLimitsUpdate(id_min_mm=75.0, expected_revision=int(stored.write_revision or 1)),
            db=db,
            plant_id=PLANT,
            current_user=ADMIN,
        )
        replacement_id = replacement["id"] if isinstance(replacement, dict) else replacement.id
        assert str(replacement_id) != str(spec_id)
        assert replacement["status"] == "draft"
        assert replacement["id_min_mm"] == 75.0
        db.expire_all()
        previous = db.query(SpecificationSheet).filter(SpecificationSheet.id == spec_id).one()
        assert previous.status == "obsolete"
        assert previous.id_min_mm == 76.4
        assert previous.active is False
    finally:
        db.close()


def test_qct039_process_only_does_not_rewrite_recipe_or_contract():
    marker = f"QCT039-{uuid.uuid4()}"
    db = Session()
    try:
        created = create_spec(_draft_payload(marker), db=db, plant_id=PLANT, current_user=ADMIN)
        spec_id = created["id"] if isinstance(created, dict) else created.id
        recipe = create_recipe(
            spec_id,
            RecipeCreate(notes="QCT-039 recipe must stay"),
            db=db,
            plant_id=PLANT,
            current_user=ADMIN,
        )
        recipe_id = recipe.id
        spec = db.query(SpecificationSheet).filter(SpecificationSheet.id == spec_id).one()
        spec.status = "approved"
        db.commit()

        process_only = upsert_spec_qc_profile(
            spec_id,
            QcProfileUpdate(
                qc_profile={
                    "status": "draft",
                    "stages": {
                        "PROCESS": {
                            "parameters": [
                                {"code": "moisture", "min": 2.0, "max": 8.0, "unit": "%", "required": True}
                            ]
                        }
                    },
                }
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert str(process_only["id"]) == str(spec_id)
        assert process_only["status"] == "approved"
        assert process_only["id_min_mm"] == 76.0
        assert process_only["final_limits"]["id_min_mm"] == 76.0
        db.expire_all()
        same_recipe = db.query(RecipeHeader).filter(RecipeHeader.id == recipe_id).one()
        assert str(same_recipe.spec_id) == str(spec_id)
        assert same_recipe.notes == "QCT-039 recipe must stay"
        stored = db.query(SpecificationSheet).filter(SpecificationSheet.id == spec_id).one()
        assert stored.id_min_mm == 76.0
        assert stored.target_tube_weight == 250.0

        contractual = update_spec(
            spec_id,
            SpecUpdate(id_min_mm=74.5, expected_revision=int(stored.write_revision or 1)),
            db=db,
            plant_id=PLANT,
            current_user=ADMIN,
        )
        new_id = contractual["id"] if isinstance(contractual, dict) else contractual.id
        assert str(new_id) != str(spec_id)
        assert contractual["status"] == "draft"
        assert contractual["id_min_mm"] == 74.5
        db.expire_all()
        old = db.query(SpecificationSheet).filter(SpecificationSheet.id == spec_id).one()
        assert old.status == "obsolete"
        assert old.id_min_mm == 76.0
        leftover_recipe = db.query(RecipeHeader).filter(RecipeHeader.id == recipe_id).one()
        assert str(leftover_recipe.spec_id) == str(spec_id)
        assert leftover_recipe.notes == "QCT-039 recipe must stay"
        assert db.query(RecipeHeader).filter(RecipeHeader.spec_id == new_id).count() == 0
    finally:
        db.close()
