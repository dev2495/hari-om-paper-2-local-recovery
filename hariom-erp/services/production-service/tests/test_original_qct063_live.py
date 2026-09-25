"""QCT-063: signed multi-field FAIL replay keeps one case/hold and does not duplicate quantity."""
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
from src.models import QualityHold, QualityInspection
from src.routers.planning import _build_spec_snapshot
from src.routers.quality import InspectionCreate, create_inspection, signed_profile_context
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


THREE_FAIL_READINGS = {"id": 70, "od": 80, "height": 90, "weight": 250, "cs": 100}
MULTI_FAIL_REASONS = {
    "id": {"common_cause_id": "CASE-1"},
    "od": {"common_cause_id": "CASE-1"},
    "height": {"common_cause_id": "CASE-1"},
    "__common__": {
        "id": "CASE-1",
        "explanation": "crushed core during winding affected ID, OD and height",
        "containment": "hold the entire winder cage",
        "assignee": "qc.supervisor",
        "applies_to": ["id", "od", "height"],
    },
}
SAMPLE = "QCT063-1"


def _fail_codes(recorded) -> set[str]:
    return {str(row.get("code") or row.get("parameter") or "") for row in (recorded.failures or [])}


def test_qct063_signed_multi_fail_retry_keeps_one_case_hold_and_quantity():
    headers = _admin_headers()
    marker = f"QCT063-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    signed = signed_profile_context(snapshot)
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "DURABLE", status="IN_PROGRESS")
        db.commit()
        db.refresh(job)
        planned = float(job.planned_qty)
        payload = InspectionCreate(
            job_card_id=job.id,
            stage_type="WINDER",
            readings=dict(THREE_FAIL_READINGS),
            reasons=dict(MULTI_FAIL_REASONS),
            sample_id=SAMPLE,
            final_submission=True,
            expected_context_version=signed["quality_context_version"],
            signed_profile_fingerprint=signed["fingerprint"],
        )
        first = create_inspection(payload, db=db, plant_id=PLANT, current_user=QC)
        assert first.status == "FAIL"
        assert first.reused is False
        assert first.grouped_case_id == "CASE-1"
        assert set(first.grouped_parameters) == {"id", "od", "height"}
        assert {"id", "od", "height"}.issubset(_fail_codes(first))
        assert first.hold_id is not None
        assert first.evaluation.get("affected_quantity") == planned
        assert first.evaluation.get("inspection_round") == 1
        assert first.evaluation.get("signed_profile_context", {}).get("fingerprint") == signed["fingerprint"]
        assert first.evaluation.get("case_scope", {}).get("sample_id") == SAMPLE
        assert first.evaluation.get("case_scope", {}).get("round") == 1

        replay = create_inspection(payload, db=db, plant_id=PLANT, current_user=QC)
        assert replay.reused is True
        assert replay.id == first.id
        assert replay.hold_id == first.hold_id
        assert replay.status == "FAIL"
        assert replay.grouped_case_id == "CASE-1"
        assert set(replay.grouped_parameters) == {"id", "od", "height"}
        assert {"id", "od", "height"}.issubset(_fail_codes(replay))
        assert replay.evaluation.get("affected_quantity") == planned
        assert replay.evaluation.get("affected_quantity") != planned * 2

        inspections = db.query(QualityInspection).filter(QualityInspection.job_card_id == job.id).all()
        holds = db.query(QualityHold).filter(QualityHold.job_card_id == job.id).all()
        assert len(inspections) == 1
        assert len(holds) == 1
        assert holds[0].status == "HOLD"
        assert holds[0].source_inspection_id == first.id
        db.refresh(job)
        assert float(job.planned_qty) == planned
        assert float(job.released_qty) == planned
        _reports().joinpath("qct063-job.json").write_text(
            json.dumps(
                {
                    "job_id": str(job.id),
                    "inspection_id": str(first.id),
                    "hold_id": str(first.hold_id),
                    "affected_quantity": planned,
                }
            )
        )
    finally:
        db.close()


def test_qct063_ui_job_seed():
    headers = _admin_headers()
    marker = f"QCT063UI-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "DURABLE-UI", status="IN_PROGRESS")
        db.commit()
        _reports().joinpath("qct063-ui-job.json").write_text(
            json.dumps({"job_id": str(job.id), "planned_qty": float(job.planned_qty)})
        )
    finally:
        db.close()
