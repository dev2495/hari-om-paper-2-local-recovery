"""QCT-048 oven pre then post; QCT-049 mismatched pair / missing pre-context."""
from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

import pytest

URL = os.environ.get("HARI_OM_PRODUCTION_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or not ("hariom_nverify" in URL or ("@127.0.0.1:5432/hariom_" in URL and "_integration_" in URL)):
    pytest.skip("Requires isolated hariom_nverify production Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from src.database import Base, engine
from src.routers.planning import _build_spec_snapshot
from src.routers.quality import InspectionCreate, create_inspection
from tests.test_original_qct043_live import (
    PLANT,
    QC,
    Session,
    _admin_headers,
    _complete_profile,
    _create_approved_spec,
    _issue_job,
)


def setup_module() -> None:
    Base.metadata.create_all(engine)


def _reports() -> Path:
    path = Path(__file__).resolve().parents[4] / "reports"
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_qct048_pre_save_then_later_post_keeps_same_pair():
    headers = _admin_headers()
    marker = f"QCT048-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "OVEN-PAIR", status="IN_PROGRESS")
        db.commit()
        pre = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="OVEN",
                readings={
                    "pre_weight": 1.5,
                    "pre_moisture": 5,
                    "oven_checkpoint": "PRE",
                    "pre_specimen_id": "PAIR-A",
                },
                sample_id="PAIR-A",
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert pre.status == "PASS"
        post_codes = {
            row["code"]: row["verdict"]
            for row in (pre.evaluation or {}).get("parameter_results") or []
        }
        assert post_codes.get("post_weight") == "NOT_APPLICABLE"
        assert post_codes.get("post_moisture") == "NOT_APPLICABLE"
        missing_post = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="OVEN",
                readings={"oven_checkpoint": "POST", "pre_specimen_id": "PAIR-A", "post_specimen_id": "PAIR-A"},
                sample_id="PAIR-A",
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert missing_post.status != "PASS"
        post = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="OVEN",
                readings={
                    "post_weight": 1.4,
                    "post_moisture": 4,
                    "oven_checkpoint": "POST",
                    "post_specimen_id": "PAIR-A",
                    "pre_specimen_id": "PAIR-A",
                },
                sample_id="PAIR-A",
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert post.status == "PASS"
        assert post.sample_id == "PAIR-A"
        assert str(post.parent_inspection_id) == str(pre.id)
        stored_post = dict(post.readings or {})
        assert stored_post.get("post_weight") == 1.4
        assert stored_post.get("pre_weight") in (None, "")
        _reports().joinpath("qct048-job.json").write_text(
            json.dumps({"job_id": str(job.id), "pair_id": "PAIR-A", "pre_id": str(pre.id), "post_id": str(post.id)})
        )
    finally:
        db.close()


def test_qct048_ui_job_seed():
    headers = _admin_headers()
    marker = f"QCT048UI-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "OVEN-UI", status="IN_PROGRESS")
        db.commit()
        _reports().joinpath("qct048-ui-job.json").write_text(json.dumps({"job_id": str(job.id), "pair_id": "PAIR-A"}))
    finally:
        db.close()


def test_qct049_post_without_pre_or_mismatched_pair_is_not_pass():
    headers = _admin_headers()
    marker = f"QCT049-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "OVEN-MISMATCH", status="IN_PROGRESS")
        db.commit()
        orphan = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="OVEN",
                readings={
                    "post_weight": 1.4,
                    "post_moisture": 4,
                    "oven_checkpoint": "POST",
                    "post_specimen_id": "PAIR-B",
                },
                sample_id="PAIR-B",
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert orphan.status != "PASS"
        assert orphan.status in {"INCOMPLETE", "FAIL", "INVALID"}
        create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="OVEN",
                readings={
                    "pre_weight": 1.5,
                    "pre_moisture": 5,
                    "oven_checkpoint": "PRE",
                    "pre_specimen_id": "PAIR-A",
                },
                sample_id="PAIR-A",
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        mismatched = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="OVEN",
                readings={
                    "pre_weight": 1.5,
                    "pre_moisture": 5,
                    "post_weight": 1.4,
                    "post_moisture": 4,
                    "oven_checkpoint": "POST",
                    "pre_specimen_id": "PAIR-A",
                    "post_specimen_id": "PAIR-B",
                },
                sample_id="PAIR-B",
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert mismatched.status == "FAIL"
        codes = {row.get("code") for row in (mismatched.failures or [])}
        results = (mismatched.evaluation or {}).get("parameter_results") or []
        assert "oven_pair" in codes or any(row.get("code") == "oven_pair" for row in results)
        assert mismatched.status != "PASS"
        _reports().joinpath("qct049-job.json").write_text(
            json.dumps({"job_id": str(job.id), "orphan_status": orphan.status, "mismatch_status": mismatched.status})
        )
    finally:
        db.close()


def test_qct049_ui_job_seed():
    headers = _admin_headers()
    marker = f"QCT049UI-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "OVEN-UI-MIS", status="IN_PROGRESS")
        db.commit()
        _reports().joinpath("qct049-ui-job.json").write_text(json.dumps({"job_id": str(job.id)}))
    finally:
        db.close()
