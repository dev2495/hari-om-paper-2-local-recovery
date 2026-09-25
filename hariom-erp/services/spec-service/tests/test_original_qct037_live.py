"""QCT-037: assign one template to mixed applicable/non-applicable legacy specs."""
from __future__ import annotations

import json
import os
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

URL = os.environ.get("HARI_OM_SPEC_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or not ("hariom_nverify" in URL or ("@127.0.0.1:5432/hariom_" in URL and "_integration_" in URL)):
    pytest.skip("Requires isolated hariom_nverify spec Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from src.main import ensure_runtime_schema
from src.database import engine
from src.models import SpecificationSheet
from src.routers.specs import (
    AssignProfilePayload,
    QcProfileUpdate,
    SpecCreate,
    apply_qc_profile_assign,
    create_spec,
    preview_qc_profile_assign,
    upsert_spec_qc_profile,
)

ensure_runtime_schema()
Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
PLANT = "00000000-0000-0000-0000-0000000000a1"
ADMIN = {"sub": "nverify-qct037-admin", "role": "Admin"}
SALES = {"sub": "nverify-qct037-sales", "role": "Sales"}
PROD_URL = os.environ.get("HARI_OM_PRODUCTION_DATABASE_URL") or (
    "postgresql://devarshthakkar@127.0.0.1:5432/hariom_nverify_productiondb"
)


def _draft_payload(marker: str) -> SpecCreate:
    return SpecCreate(
        customer_name=marker,
        customer_name_snapshot=marker,
        tube_size_id=uuid.uuid4(),
        mandrel_id=uuid.uuid4(),
        required_cs=100.0,
        target_tube_weight=250.0,
        id_min_mm=76.0,
        id_max_mm=78.0,
    )


def _notching_template_profile() -> dict:
    return {
        "status": "complete",
        "notching_applicable": True,
        "stages": {
            "WINDER": {
                "parameters": [
                    {"code": "id", "min": 76.0, "max": 78.0, "unit": "mm", "required": True},
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
                    {"code": "notch_distance", "min": 10.0, "max": 12.0, "unit": "mm", "required": True, "applicable": True},
                    {"code": "notch_depth", "min": 1.0, "max": 2.0, "unit": "mm", "required": True, "applicable": True},
                    {"code": "moisture", "min": 1.0, "max": 9.0, "unit": "%", "required": True},
                ]
            },
        },
    }


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


def test_qct037_mixed_assign_preview_no_publish_no_job_rewrite():
    marker = f"QCT037-{uuid.uuid4()}"
    db = Session()
    try:
        template = create_spec(_draft_payload(f"{marker}-template"), db=db, plant_id=PLANT, current_user=ADMIN)
        template_id = template["id"] if isinstance(template, dict) else template.id
        upsert_spec_qc_profile(
            template_id,
            QcProfileUpdate(qc_profile=_notching_template_profile(), status="complete"),
            db=db,
            plant_id=PLANT,
            current_user=ADMIN,
        )

        applicable = create_spec(_draft_payload(f"{marker}-legacy"), db=db, plant_id=PLANT, current_user=ADMIN)
        applicable_id = applicable["id"] if isinstance(applicable, dict) else applicable.id

        mismatch = create_spec(_draft_payload(f"{marker}-nonotch"), db=db, plant_id=PLANT, current_user=ADMIN)
        mismatch_id = mismatch["id"] if isinstance(mismatch, dict) else mismatch.id
        upsert_spec_qc_profile(
            mismatch_id,
            QcProfileUpdate(
                qc_profile={
                    "status": "draft",
                    "notching_applicable": False,
                    "stages": {
                        "PROCESS": {
                            "parameters": [
                                {"code": "notch_distance", "applicable": False},
                                {"code": "notch_depth", "applicable": False},
                            ]
                        }
                    },
                }
            ),
            db=db,
            plant_id=PLANT,
            current_user=ADMIN,
        )

        retired = create_spec(_draft_payload(f"{marker}-obsolete"), db=db, plant_id=PLANT, current_user=ADMIN)
        retired_id = retired["id"] if isinstance(retired, dict) else retired.id
        db.expire_all()
        retired_row = db.query(SpecificationSheet).filter(SpecificationSheet.id == retired_id).one()
        retired_row.status = "obsolete"
        retired_row.active = False
        db.commit()

        frozen = {"id_min_mm": 76.0, "id_max_mm": 78.0, "qc_profile": {"status": "approved", "revision": 1}}
        job_id = _issue_job(applicable_id, frozen)
        assert _job_snapshot(job_id)["id_min_mm"] == 76.0

        payload = AssignProfilePayload(
            template_spec_id=template_id,
            spec_ids=[applicable_id, mismatch_id, retired_id],
            publish=False,
        )
        preview = preview_qc_profile_assign(payload, db=db, plant_id=PLANT, current_user=ADMIN)
        by_id = {row["spec_id"]: row for row in preview["results"]}
        assert preview["published"] is False
        assert preview["rewrites_issued_jobs"] is False
        assert by_id[str(applicable_id)]["applicable"] is True
        assert by_id[str(applicable_id)]["error"] is None
        assert by_id[str(mismatch_id)]["applicable"] is False
        assert by_id[str(mismatch_id)]["error"]["code"] == "NOTCHING_MISMATCH"
        assert by_id[str(retired_id)]["applicable"] is False
        assert by_id[str(retired_id)]["error"]["code"] == "SPEC_RETIRED"
        assert all(row["published"] is False and row["rewrites_issued_jobs"] is False for row in preview["results"])

        with pytest.raises(HTTPException) as forbidden:
            apply_qc_profile_assign(
                AssignProfilePayload(
                    template_spec_id=template_id,
                    spec_ids=[applicable_id, mismatch_id, retired_id],
                    publish=True,
                ),
                db=db,
                plant_id=PLANT,
                current_user=ADMIN,
            )
        assert forbidden.value.status_code == 400
        assert forbidden.value.detail["code"] == "AUTO_PUBLICATION_FORBIDDEN"
        db.expire_all()
        still_missing = db.query(SpecificationSheet).filter(SpecificationSheet.id == applicable_id).one()
        status = (still_missing.qc_profile or {}).get("status") if isinstance(still_missing.qc_profile, dict) else None
        assert status in {None, "missing"} or still_missing.qc_profile in {None, {}}

        applied = apply_qc_profile_assign(payload, db=db, plant_id=PLANT, current_user=ADMIN)
        assert applied["published"] is False
        assert applied["rewrites_issued_jobs"] is False
        assert str(applicable_id) in applied["applied_spec_ids"]
        assert str(mismatch_id) not in applied["applied_spec_ids"]
        assert str(retired_id) not in applied["applied_spec_ids"]

        db.expire_all()
        stored_applicable = db.query(SpecificationSheet).filter(SpecificationSheet.id == applicable_id).one()
        stored_mismatch = db.query(SpecificationSheet).filter(SpecificationSheet.id == mismatch_id).one()
        stored_retired = db.query(SpecificationSheet).filter(SpecificationSheet.id == retired_id).one()
        assert stored_applicable.qc_profile["status"] == "draft"
        assert stored_applicable.qc_profile.get("approved_by") in {None, ""}
        assert stored_applicable.status == "draft"
        assert stored_mismatch.qc_profile.get("notching_applicable") is False
        assert stored_retired.status == "obsolete"
        assert stored_retired.qc_profile in (None, {})

        snap = _job_snapshot(job_id)
        assert snap["id_min_mm"] == 76.0
        assert snap["qc_profile"]["status"] == "approved"
        assert snap["qc_profile"]["revision"] == 1
    finally:
        db.close()


def test_qct037_sales_cannot_assign():
    marker = f"QCT037-sales-{uuid.uuid4()}"
    db = Session()
    try:
        created = create_spec(_draft_payload(marker), db=db, plant_id=PLANT, current_user=ADMIN)
        spec_id = created["id"] if isinstance(created, dict) else created.id
        with pytest.raises(HTTPException) as denied:
            preview_qc_profile_assign(
                AssignProfilePayload(template_spec_id=spec_id, spec_ids=[spec_id]),
                db=db,
                plant_id=PLANT,
                current_user=SALES,
            )
        assert denied.value.status_code == 403
    finally:
        db.close()
