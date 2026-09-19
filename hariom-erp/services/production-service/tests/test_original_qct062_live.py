"""QCT-062: required instrument evidence controls readiness; no invented PASS."""
from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

import pytest
from fastapi import HTTPException

URL = os.environ.get("HARI_OM_PRODUCTION_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or "hariom_nverify" not in URL:
    pytest.skip("Requires isolated hariom_nverify production Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from src.database import Base, engine
from src.models import QualityHold, QualityInspection
from src.routers.planning import StageOutputPayload, _build_spec_snapshot, capture_stage_output
from src.routers.quality import InspectionCreate, create_inspection
from tests.test_original_qct043_live import (
    ADMIN,
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


PASS_READINGS = {"id": 77, "od": 91, "height": 120, "weight": 250, "cs": 100}
INSTRUMENT_ID = "CAL-HEIGHT-01"


def _instrument_profile():
    profile = _complete_profile()
    for row in profile["stages"]["WINDER"]["parameters"]:
        if row["code"] == "height":
            row["requires_instrument"] = True
            row["required_instrument_id"] = INSTRUMENT_ID
            row["method"] = "Vernier"
    return profile


def _valid_instrument():
    return {
        "instrument_id": INSTRUMENT_ID,
        "calibration_status": "valid",
        "calibration_due": "2099-12-31",
        "evidence_ref": "CERT-QCT062",
    }


def test_qct062_missing_and_expired_instrument_block_then_documented_evidence_passes():
    headers = _admin_headers()
    marker = f"QCT062-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _instrument_profile())
    height = next(
        row
        for row in ((spec.get("qc_profile") or {}).get("stages") or {}).get("WINDER", {}).get("parameters", [])
        if row.get("code") == "height"
    )
    assert height.get("requires_instrument") is True
    assert height.get("required_instrument_id") == INSTRUMENT_ID
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "INST", status="IN_PROGRESS")
        db.commit()
        db.refresh(job)

        with pytest.raises(HTTPException) as missing:
            create_inspection(
                InspectionCreate(
                    job_card_id=job.id,
                    stage_type="WINDER",
                    readings=dict(PASS_READINGS),
                    sample_id="QCT062-MISS",
                    final_submission=True,
                ),
                db=db,
                plant_id=PLANT,
                current_user=QC,
            )
        assert missing.value.status_code == 409
        detail = missing.value.detail
        assert isinstance(detail, dict)
        assert detail["code"] == "INVALID_INSTRUMENT"
        assert detail["instrument_status"] == "missing"
        assert detail["invented_calibration"] is False
        assert detail["silent_pass"] is False
        assert "calibration_due" not in (detail.get("evidence") or {}) or not (detail.get("evidence") or {}).get("calibration_due")

        expired_readings = dict(PASS_READINGS)
        expired_readings["instrument"] = {
            "instrument_id": INSTRUMENT_ID,
            "calibration_status": "expired",
            "calibration_due": "2020-01-01",
            "evidence_ref": "CERT-OLD",
        }
        with pytest.raises(HTTPException) as expired:
            create_inspection(
                InspectionCreate(
                    job_card_id=job.id,
                    stage_type="WINDER",
                    readings=expired_readings,
                    sample_id="QCT062-EXP",
                    final_submission=True,
                ),
                db=db,
                plant_id=PLANT,
                current_user=QC,
            )
        assert expired.value.status_code == 409
        assert expired.value.detail["code"] == "INVALID_INSTRUMENT"
        assert expired.value.detail["instrument_status"] == "expired"
        assert expired.value.detail["invented_calibration"] is False

        with pytest.raises(HTTPException) as output_exc:
            capture_stage_output(
                job.id,
                StageOutputPayload(
                    stage="WINDER",
                    save_mode="complete",
                    output_qty=4,
                    quality_checks=dict(PASS_READINGS),
                ),
                db=db,
                plant_id=PLANT,
                current_user=ADMIN,
            )
        assert output_exc.value.status_code == 409
        assert output_exc.value.detail["code"] == "INVALID_INSTRUMENT"

        assert db.query(QualityInspection).filter(QualityInspection.job_card_id == job.id).count() == 0
        assert db.query(QualityHold).filter(QualityHold.job_card_id == job.id).count() == 0

        ok_readings = dict(PASS_READINGS)
        ok_readings["instrument"] = _valid_instrument()
        saved = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="WINDER",
                readings=ok_readings,
                sample_id="QCT062-OK",
                final_submission=True,
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert saved.status == "PASS"
        stored = db.query(QualityInspection).filter(QualityInspection.job_card_id == job.id).one()
        assert stored.status == "PASS"
        evidence = (stored.readings or {}).get("instrument") or {}
        assert evidence.get("instrument_id") == INSTRUMENT_ID
        assert evidence.get("calibration_due") == "2099-12-31"
        assert evidence.get("evidence_ref") == "CERT-QCT062"
    finally:
        db.close()


def test_qct062_ui_job_seed():
    headers = _admin_headers()
    marker = f"QCT062UI-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _instrument_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "UI", status="IN_PROGRESS")
        db.commit()
        db.refresh(job)
        _reports().joinpath("qct062-ui-job.json").write_text(
            json.dumps(
                {
                    "job_id": str(job.id),
                    "requires_instrument": True,
                    "required_instrument_id": INSTRUMENT_ID,
                }
            )
        )
    finally:
        db.close()
