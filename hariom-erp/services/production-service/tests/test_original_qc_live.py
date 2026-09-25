"""Live QC-03/06/07/08 persistence against isolated hariom_nverify production."""
from __future__ import annotations

import os
import uuid
from datetime import date

import pytest
from fastapi import HTTPException

URL = os.environ.get("HARI_OM_PRODUCTION_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or not ("hariom_nverify" in URL or ("@127.0.0.1:5432/hariom_" in URL and "_integration_" in URL)):
    pytest.skip("Requires isolated hariom_nverify production Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.orm import sessionmaker

from datetime import datetime as _dt, timedelta as _td, timezone as _tz

# Stage completion requires the Start (A)/End (B) written on the job card.
CARD_TIMES = {"start_time": _dt.now(_tz.utc) - _td(hours=2), "end_time": _dt.now(_tz.utc) - _td(hours=1)}

from src.database import Base, engine
from src.models import JobCard, JobCardStage, PLANT_A_UUID, QualityHold, QualityInspection, SalesOrder
from src.routers.planning import _ensure_job_card_stages, _routing_stages_from_snapshot, capture_stage_output
from src.routers.quality import InspectionCreate, create_inspection, release_hold
from src.schemas.planning import StageOutputPayload


Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
QC_PROFILE = {
    "status": "approved",
    "revision": 4,
    "stages": {
        "WINDER": {
            "parameters": [
                {"code": "id", "label": "I.D.", "unit": "mm", "method": "Vernier", "specimen": "tube", "sampling": "1/10", "min": 76, "max": 78},
                {"code": "od", "label": "O.D.", "unit": "mm", "method": "Vernier", "specimen": "tube", "sampling": "1/10", "min": 90, "max": 92},
                {"code": "height", "label": "Height", "unit": "mm", "method": "Scale", "specimen": "tube", "sampling": "1/10", "min": 118, "max": 122},
                {"code": "weight", "label": "Weight", "unit": "g", "method": "Balance", "specimen": "tube", "sampling": "1/10", "min": 240, "max": 260},
                {"code": "cs", "label": "C.S.", "unit": "N", "method": "Crush", "specimen": "tube", "sampling": "1/10", "min": 300, "max": 340},
            ]
        },
        "OVEN": {
            "parameters": [
                {"code": "pre_weight", "label": "Pre-weight", "unit": "g", "method": "Balance", "specimen": "bamboo", "sampling": "identified pair", "min": 200, "max": 260},
                {"code": "post_weight", "label": "Post-weight", "unit": "g", "method": "Balance", "specimen": "bamboo", "sampling": "identified pair", "min": 180, "max": 240},
                {"code": "pre_moisture", "label": "Pre-moisture", "unit": "%", "method": "Moisture meter", "specimen": "bamboo", "sampling": "identified pair", "min": 8, "max": 12},
                {"code": "post_moisture", "label": "Post-moisture", "unit": "%", "method": "Moisture meter", "specimen": "bamboo", "sampling": "identified pair", "min": 4, "max": 8},
            ]
        },
        "PROCESS": {
            "parameters": [
                {"code": "height", "label": "Height", "unit": "mm", "min": 118, "max": 122},
                {"code": "weight", "label": "Weight", "unit": "g", "min": 220, "max": 250},
                {"code": "cs", "label": "C.S.", "unit": "N", "min": 300, "max": 340},
                {"code": "notch_distance", "label": "Notch distance", "unit": "mm", "min": 20, "max": 30},
                {"code": "notch_depth", "label": "Notch depth", "unit": "mm", "min": 2, "max": 4},
                {"code": "moisture", "label": "Moisture", "unit": "%", "min": 5, "max": 8},
            ]
        },
    },
}


def setup_module() -> None:
    Base.metadata.create_all(engine)


def _job(db, suffix: str, notch: bool = True) -> JobCard:
    order = SalesOrder(
        plant_id=PLANT_A_UUID,
        customer_id=uuid.uuid4(),
        spec_id=uuid.uuid4(),
        order_qty=10,
        due_date=date.today(),
    )
    db.add(order)
    db.flush()
    job = JobCard(
        plant_id=PLANT_A_UUID,
        sales_order_id=order.id,
        spec_id=order.spec_id,
        spec_snapshot={"qc_profile": QC_PROFILE, "notch_capability_required": notch},
        planned_qty=10,
        released_qty=10,
        status="IN_PROGRESS",
        current_stage="WINDER",
        product_code=f"NV-QC-{suffix}",
    )
    db.add(job)
    db.flush()
    return job


def _ensure_stages(db, job: JobCard) -> None:
    routing = _routing_stages_from_snapshot(job.spec_snapshot or {})
    _ensure_job_card_stages(
        db=db,
        job_card=job,
        routing_stages=routing,
        first_stage=job.current_stage or "WINDER",
    )
    db.flush()


def test_qc03_persists_winding_oven_and_process_field_names():
    db = Session()
    try:
        job = _job(db, uuid.uuid4().hex[:6])
        db.commit()
        winder = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="WINDER",
                readings={"id": 77, "od": 91, "height": 120, "weight": 250, "cs": 320},
                sample_id="W1",
            ),
            db=db,
            plant_id=str(PLANT_A_UUID),
            current_user={"sub": "qc-1", "roles": ["QC"]},
        )
        oven = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="OVEN",
                readings={
                    "pre_weight": 240,
                    "post_weight": 220,
                    "pre_moisture": 10,
                    "post_moisture": 6,
                    "pre_specimen_id": "B1",
                    "post_specimen_id": "B1",
                    "sample_id": "B1",
                },
                sample_id="B1",
            ),
            db=db,
            plant_id=str(PLANT_A_UUID),
            current_user={"sub": "qc-1", "roles": ["QC"]},
        )
        process = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="PROCESS",
                readings={"height": 120, "weight": 230, "cs": 320, "notch_distance": 24, "notch_depth": 3, "moisture": 6},
                sample_id="P1",
            ),
            db=db,
            plant_id=str(PLANT_A_UUID),
            current_user={"sub": "qc-1", "roles": ["QC"]},
        )
        stored = {row.stage_type: row for row in db.query(QualityInspection).filter(QualityInspection.job_card_id == job.id).all()}
        assert stored["WINDER"].status == "PASS"
        assert stored["OVEN"].status == "PASS"
        assert stored["PROCESS"].status == "PASS"
        winder_rules = {row["code"]: row for row in (winder.frozen_rules or stored["WINDER"].evaluation.get("frozen_rules") or [])}
        assert winder_rules["id"]["label"] == "I.D."
        assert winder_rules["id"]["method"] == "Vernier"
        assert winder_rules["weight"]["unit"] == "g"
        oven_rules = {row["code"]: row for row in (oven.frozen_rules or [])}
        assert oven_rules["pre_weight"]["pair_group"] == "oven_sample"
        assert (stored["WINDER"].evaluation or {}).get("profile_revision") in {4, "4"}
        assert stored["WINDER"].readings["id"] == 77
        assert stored["OVEN"].sample_id == "B1"
    finally:
        db.close()


def test_qc04_create_inspection_rejects_non_finite_as_not_pass():
    db = Session()
    try:
        job = _job(db, uuid.uuid4().hex[:6])
        db.commit()
        response = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="WINDER",
                readings={"id": "NaN", "od": 91, "height": 120, "weight": 250, "cs": 320},
                sample_id="BAD",
            ),
            db=db,
            plant_id=str(PLANT_A_UUID),
            current_user={"sub": "qc-1", "roles": ["QC"]},
        )
        assert response.status != "PASS"
        stored = db.query(QualityInspection).filter(QualityInspection.id == response.id).one()
        assert stored.status != "PASS"
    finally:
        db.close()


def test_qc06_oven_mismatch_persists_fail():
    db = Session()
    try:
        job = _job(db, uuid.uuid4().hex[:6])
        db.commit()
        response = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="OVEN",
                readings={
                    "pre_weight": 240,
                    "post_weight": 220,
                    "pre_moisture": 10,
                    "post_moisture": 6,
                    "pre_specimen_id": "S1",
                    "post_specimen_id": "S2",
                },
                sample_id="S2",
                reasons={"oven_pair": "mismatched pair attempted"},
            ),
            db=db,
            plant_id=str(PLANT_A_UUID),
            current_user={"sub": "qc-1", "roles": ["QC"]},
        )
        assert response.status == "FAIL"
        assert any(row.get("code") == "oven_pair" or row.get("parameter") == "oven_pair" for row in (response.failures or response.evaluation.get("parameter_results") or []))
    finally:
        db.close()


def test_qc07_historical_revision_stays_on_old_inspection():
    db = Session()
    try:
        job = _job(db, uuid.uuid4().hex[:6])
        db.commit()
        first = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="WINDER",
                readings={"id": 77, "od": 91, "height": 120, "weight": 250, "cs": 320},
                sample_id="H1",
            ),
            db=db,
            plant_id=str(PLANT_A_UUID),
            current_user={"sub": "qc-1", "roles": ["QC"]},
        )
        assert first.status == "PASS"
        frozen = list(first.frozen_rules)
        old_id_max = next(row["max"] for row in frozen if row["code"] == "id")
        snapshot = dict(job.spec_snapshot or {})
        profile = dict(snapshot.get("qc_profile") or {})
        profile["revision"] = 99
        stages = dict(profile.get("stages") or {})
        winder = dict(stages.get("WINDER") or {})
        params = []
        for row in winder.get("parameters") or []:
            item = dict(row)
            if item.get("code") == "id":
                item["min"] = 10
                item["max"] = 11
            params.append(item)
        winder["parameters"] = params
        stages["WINDER"] = winder
        profile["stages"] = stages
        snapshot["qc_profile"] = profile
        job.spec_snapshot = snapshot
        flag_modified(job, "spec_snapshot")
        db.commit()
        stored = db.query(QualityInspection).filter(QualityInspection.id == first.id).one()
        stored_rules = (stored.evaluation or {}).get("frozen_rules") or []
        stored_id = next(row for row in stored_rules if row["code"] == "id")
        assert stored_id["max"] == old_id_max
        assert stored.status == "PASS"
        later = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="WINDER",
                readings={"id": 77, "od": 91, "height": 120, "weight": 250, "cs": 320},
                sample_id="H2",
            ),
            db=db,
            plant_id=str(PLANT_A_UUID),
            current_user={"sub": "qc-1", "roles": ["QC"]},
        )
        assert later.status != "PASS"
    finally:
        db.close()


def test_qc08_fail_blocks_movement_retest_does_not_release_and_old_pass_cannot_clear_new_hold():
    db = Session()
    try:
        job = _job(db, uuid.uuid4().hex[:6])
        db.commit()
        first_pass = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="WINDER",
                readings={"id": 77, "od": 91, "height": 120, "weight": 250, "cs": 320},
                sample_id="OK1",
            ),
            db=db,
            plant_id=str(PLANT_A_UUID),
            current_user={"sub": "qc-1", "roles": ["QC"]},
        )
        assert first_pass.status == "PASS"
        failed = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="WINDER",
                readings={"id": 77, "od": 140, "height": 120, "weight": 250, "cs": 320},
                reasons={"od": "crushed ply"},
                sample_id="BAD1",
            ),
            db=db,
            plant_id=str(PLANT_A_UUID),
            current_user={"sub": "qc-1", "roles": ["QC"]},
        )
        assert failed.status == "FAIL"
        assert failed.hold_id is not None
        _ensure_stages(db, job)
        db.commit()
        recorded = capture_stage_output(
            job.id,
            StageOutputPayload(
                stage="WINDER",
                output_qty=1,
                save_mode="complete", **CARD_TIMES,
                actuals={"stock_status": "UNRESTRICTED", "disposition": "RELEASED"},
            ),
            db=db,
            plant_id=str(PLANT_A_UUID),
            current_user={"sub": "pm-1", "roles": ["PlantManager"]},
        )
        assert recorded.entry_saved is True
        assert recorded.job_card_status == "IN_PROGRESS"
        assert recorded.current_stage == "WINDER"
        assert recorded.stage_status != "COMPLETED"
        assert recorded.quality_hold_ids
        db.expire_all()
        winder = (
            db.query(JobCardStage)
            .filter(JobCardStage.job_card_id == job.id, JobCardStage.stage_type == "WINDER")
            .one()
        )
        assert winder.output_qty == 1
        assert (winder.actuals_snapshot or {}).get("stock_status") == "QC_HOLD"
        assert (winder.actuals_snapshot or {}).get("failed_qty_labelled_good") is False
        assert winder.status != "COMPLETED"
        with pytest.raises(HTTPException) as blocked:
            capture_stage_output(
                job.id,
                StageOutputPayload(stage="OVEN", output_qty=1, save_mode="complete", **CARD_TIMES),
                db=db,
                plant_id=str(PLANT_A_UUID),
                current_user={"sub": "pm-1", "roles": ["PlantManager"]},
            )
        assert blocked.value.status_code == 409
        assert blocked.value.detail["code"] == "JOB_HAS_ACTIVE_QC_HOLD"
        retest = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="WINDER",
                readings={"id": 77, "od": 91, "height": 120, "weight": 250, "cs": 320},
                sample_id="RETEST1",
                parent_inspection_id=failed.id,
            ),
            db=db,
            plant_id=str(PLANT_A_UUID),
            current_user={"sub": "qc-1", "roles": ["QC"]},
        )
        assert retest.status == "PASS"
        hold = db.query(QualityHold).filter(QualityHold.id == failed.hold_id).one()
        assert hold.status == "HOLD"
        with pytest.raises(HTTPException) as inspector:
            release_hold(
                failed.hold_id,
                db=db,
                plant_id=str(PLANT_A_UUID),
                current_user={"sub": "qc-1", "roles": ["QC"]},
            )
        assert inspector.value.status_code == 403
        released = release_hold(
            failed.hold_id,
            db=db,
            plant_id=str(PLANT_A_UUID),
            current_user={"sub": "owner-1", "roles": ["Owner"]},
        )
        assert released.status == "RELEASED"
        db.refresh(hold)
        assert hold.status == "RELEASED"
        assert first_pass.status == "PASS"
    finally:
        db.close()
