"""QCT-051: same observations via all entry adapters share evidence and cannot shortcut PASS."""
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
from src.models import JobCardStage, QualityHold, QualityInspection
from src.routers.planning import _build_spec_snapshot, _sync_quality_artifacts
from src.routers.quality import (
    InspectionCreate,
    InspectionImportRequest,
    create_eod_inspection,
    create_inspection,
    create_legacy_inspection,
    create_supervisor_inspection,
    import_inspections,
    release_hold,
)
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


FAIL_READINGS = {"id": 77, "od": 91, "height": 90, "weight": 250, "cs": 100}
FAIL_REASONS = {"height": "measured short on winding"}
SAMPLE = "ADAPTER-1"
SHORTCUT = {
    "overall": "PASS",
    "status": "PASS",
    "verdict": "PASS",
    "disposition": "RELEASED",
    "stock_status": "UNRESTRICTED",
    "quality_waiver": True,
}


def test_qct051_all_entry_adapters_same_evidence_no_shortcut_pass():
    headers = _admin_headers()
    marker = f"QCT051-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "ADAPTER", status="IN_PROGRESS")
        db.commit()
        dedicated = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="WINDER",
                readings=dict(FAIL_READINGS),
                reasons=dict(FAIL_REASONS),
                sample_id=SAMPLE,
                entry_mode="DEDICATED_QC",
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert dedicated.status == "FAIL"
        assert dedicated.reused is False
        assert dedicated.observation_fingerprint
        assert "overall" not in (dedicated.readings or {})
        assert dedicated.hold_id is not None

        stage = JobCardStage(
            job_card_id=job.id,
            stage_type="WINDER",
            status="RUNNING",
            quality_checks={
                **FAIL_READINGS,
                **SHORTCUT,
                "reasons": dict(FAIL_REASONS),
                "sample_id": SAMPLE,
                "entry_mode": "INLINE",
            },
        )
        db.add(stage)
        db.flush()
        job = db.query(job.__class__).filter_by(id=job.id).one()
        holds = _sync_quality_artifacts(
            db=db,
            plant_id=job.plant_id,
            job_card=job,
            stage=stage,
            selected_stage="WINDER",
            current_user=QC,
        )
        db.commit()
        assert holds
        assert str(holds[0].id) == str(dedicated.hold_id)

        supervisor = create_supervisor_inspection(
            {
                "job_card_id": str(job.id),
                "stage_type": "WINDER",
                "readings": {**FAIL_READINGS, **SHORTCUT},
                "reasons": dict(FAIL_REASONS),
                "sample_id": SAMPLE,
                "overall": "PASS",
                "status": "PASS",
            },
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        eod = create_eod_inspection(
            {
                "job_id": str(job.id),
                "stage": "WINDER",
                "checks": {**FAIL_READINGS, **SHORTCUT},
                "reasons": dict(FAIL_REASONS),
                "sample": SAMPLE,
                "result": "PASS",
            },
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        imported = import_inspections(
            InspectionImportRequest(
                rows=[
                    {
                        "job_card_id": str(job.id),
                        "stage_type": "WINDER",
                        "readings": {**FAIL_READINGS, "overall": "PASS"},
                        "reasons": dict(FAIL_REASONS),
                        "sample_id": SAMPLE,
                    }
                ]
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        legacy = create_legacy_inspection(
            {
                "job_id": str(job.id),
                "stage": "WINDER",
                "checks": dict(FAIL_READINGS),
                "reasons": dict(FAIL_REASONS),
                "sample": SAMPLE,
                "status": "PASS",
                "overall": "PASS",
                "failures": [],
                "disposition": "RELEASED",
            },
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )

        for row in (supervisor, eod, imported[0], legacy):
            assert row.status == "FAIL"
            assert row.reused is True
            assert str(row.id) == str(dedicated.id)
            assert row.observation_fingerprint == dedicated.observation_fingerprint
            assert row.evaluation.get("verdict") == "FAIL"
            assert "overall" not in (row.readings or {})

        rows = db.query(QualityInspection).filter(QualityInspection.job_card_id == job.id).all()
        assert len(rows) == 1
        stored = rows[0]
        assert stored.status == "FAIL"
        assert stored.readings.get("height") == 90
        assert "overall" not in (stored.readings or {})
        assert "status" not in (stored.readings or {})
        holds_open = db.query(QualityHold).filter(QualityHold.job_card_id == job.id, QualityHold.status == "HOLD").all()
        assert len(holds_open) == 1
        assert str(holds_open[0].id) == str(dedicated.hold_id)

        shortcut_job = _issue_job(db, spec, snapshot, "SHORTCUT", status="IN_PROGRESS")
        db.commit()
        shortcut_row = create_inspection(
            InspectionCreate(
                job_card_id=shortcut_job.id,
                stage_type="WINDER",
                readings={**FAIL_READINGS, **SHORTCUT},
                reasons=dict(FAIL_REASONS),
                sample_id="SHORTCUT-1",
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert shortcut_row.status == "FAIL"
        assert shortcut_row.reused is False
        assert "overall" not in (shortcut_row.readings or {})

        _reports().joinpath("qct051-job.json").write_text(
            json.dumps(
                {
                    "job_id": str(job.id),
                    "inspection_id": str(dedicated.id),
                    "hold_id": str(dedicated.hold_id),
                    "fingerprint": dedicated.observation_fingerprint,
                    "shortcut_job_id": str(shortcut_job.id),
                }
            )
        )
    finally:
        db.close()


def test_qct051_ui_job_seed():
    headers = _admin_headers()
    marker = f"QCT051UI-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "ADAPTER-UI", status="IN_PROGRESS")
        db.commit()
        _reports().joinpath("qct051-ui-job.json").write_text(json.dumps({"job_id": str(job.id)}))
    finally:
        db.close()


def test_qct053_reason_keeps_fail_and_blocks_self_release():
    headers = _admin_headers()
    marker = f"QCT053-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "REASON", status="IN_PROGRESS")
        db.commit()
        recorded = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="WINDER",
                readings=dict(FAIL_READINGS),
                reasons={"height": "detailed valid reason: core crushed during winding, 12 mm short of Allowed 118-122"},
                sample_id="REASON-1",
                final_submission=True,
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert recorded.status == "FAIL"
        assert recorded.reason_pending is False
        assert recorded.hold_id is not None
        assert recorded.investigation_open is False
        with pytest.raises(HTTPException) as blocked:
            release_hold(
                recorded.hold_id,
                db=db,
                plant_id=PLANT,
                current_user=QC,
            )
        assert blocked.value.status_code == 403
        hold = db.query(QualityHold).filter(QualityHold.id == recorded.hold_id).one()
        assert hold.status == "HOLD"
        stored = db.query(QualityInspection).filter(QualityInspection.id == recorded.id).one()
        assert stored.status == "FAIL"
        _reports().joinpath("qct053-job.json").write_text(
            json.dumps({"job_id": str(job.id), "inspection_id": str(recorded.id), "hold_id": str(recorded.hold_id)})
        )
    finally:
        db.close()


def test_qct053_ui_job_seed():
    headers = _admin_headers()
    marker = f"QCT053UI-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "REASON-UI", status="IN_PROGRESS")
        db.commit()
        _reports().joinpath("qct053-ui-job.json").write_text(json.dumps({"job_id": str(job.id)}))
    finally:
        db.close()


UNKNOWN_CAUSE = {
    "code": "CAUSE_UNDER_INVESTIGATION",
    "note": "height measured short versus Allowed 118-122 mm; cause not yet known",
    "containment": "quarantine the wound reel at the QC cage",
    "assignee": "qc.supervisor",
    "investigation_status": "CLOSED",
    "root_cause": "invented operator error",
    "rca_complete": True,
}


def test_qct054_unknown_cause_honestly_recorded():
    headers = _admin_headers()
    marker = f"QCT054-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "UNKNOWN", status="IN_PROGRESS")
        db.commit()
        with pytest.raises(HTTPException) as blocked:
            create_inspection(
                InspectionCreate(
                    job_card_id=job.id,
                    stage_type="WINDER",
                    readings=dict(FAIL_READINGS),
                    reasons={"height": "Cause under investigation"},
                    sample_id="UNKNOWN-1",
                    final_submission=True,
                ),
                db=db,
                plant_id=PLANT,
                current_user=QC,
            )
        assert blocked.value.status_code == 400
        recorded = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="WINDER",
                readings=dict(FAIL_READINGS),
                reasons={"height": UNKNOWN_CAUSE},
                sample_id="UNKNOWN-1",
                final_submission=True,
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert recorded.status == "FAIL"
        assert recorded.reason_pending is False
        assert recorded.investigation_open is True
        assert recorded.investigation_status == "OPEN"
        assert recorded.hold_id is not None
        height = recorded.reasons["height"]
        assert height["code"] == "CAUSE_UNDER_INVESTIGATION"
        assert height["investigation_status"] == "OPEN"
        assert height["note"]
        assert height["containment"]
        assert height["assignee"] == "qc.supervisor"
        assert "root_cause" not in height
        assert height.get("rca_complete") is None
        stored = db.query(QualityInspection).filter(QualityInspection.id == recorded.id).one()
        assert stored.status == "FAIL"
        assert stored.evaluation.get("investigation_status") == "OPEN"
        assert stored.evaluation.get("investigation_open") is True
        hold = db.query(QualityHold).filter(QualityHold.id == recorded.hold_id).one()
        assert hold.status == "HOLD"
        _reports().joinpath("qct054-job.json").write_text(
            json.dumps({"job_id": str(job.id), "inspection_id": str(recorded.id), "hold_id": str(recorded.hold_id)})
        )
    finally:
        db.close()


def test_qct054_ui_job_seed():
    headers = _admin_headers()
    marker = f"QCT054UI-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "UNKNOWN-UI", status="IN_PROGRESS")
        db.commit()
        _reports().joinpath("qct054-ui-job.json").write_text(json.dumps({"job_id": str(job.id)}))
    finally:
        db.close()


THREE_FAIL_READINGS = {"id": 70, "od": 80, "height": 90, "weight": 250, "cs": 100}


def test_qct055_common_reason_for_several_fields():
    headers = _admin_headers()
    marker = f"QCT055-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "COMMON", status="IN_PROGRESS")
        db.commit()
        recorded = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="WINDER",
                readings=dict(THREE_FAIL_READINGS),
                reasons={
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
                },
                sample_id="COMMON-1",
                final_submission=True,
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert recorded.status == "FAIL"
        assert recorded.reason_pending is False
        assert recorded.grouped_case_id == "CASE-1"
        assert set(recorded.grouped_parameters) == {"id", "od", "height"}
        fail_codes = {str(row.get("code") or row.get("parameter") or "") for row in (recorded.failures or [])}
        assert {"id", "od", "height"}.issubset(fail_codes)
        for code in ("id", "od", "height"):
            entry = recorded.reasons[code]
            assert entry["common_cause_id"] == "CASE-1"
            assert "crushed core" in entry["explanation"]
        assert recorded.hold_id is not None
        hold = db.query(QualityHold).filter(QualityHold.id == recorded.hold_id).one()
        assert hold.status == "HOLD"
        stored = db.query(QualityInspection).filter(QualityInspection.id == recorded.id).one()
        assert stored.evaluation.get("grouped_case_id") == "CASE-1"
        _reports().joinpath("qct055-job.json").write_text(
            json.dumps({"job_id": str(job.id), "inspection_id": str(recorded.id), "hold_id": str(recorded.hold_id)})
        )
    finally:
        db.close()


def test_qct055_ui_job_seed():
    headers = _admin_headers()
    marker = f"QCT055UI-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "COMMON-UI", status="IN_PROGRESS")
        db.commit()
        _reports().joinpath("qct055-ui-job.json").write_text(json.dumps({"job_id": str(job.id)}))
    finally:
        db.close()


PASS_AFTER_FAIL = {**FAIL_READINGS, "height": 120}


def test_qct056_correction_keeps_original_fail_and_hold():
    headers = _admin_headers()
    marker = f"QCT056-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "CORR", status="IN_PROGRESS")
        db.commit()
        original = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="WINDER",
                readings=dict(FAIL_READINGS),
                reasons={"height": "measured short on winding"},
                sample_id="CORR-1",
                final_submission=True,
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert original.status == "FAIL"
        assert original.readings.get("height") == 90
        assert original.hold_id is not None
        original_hold_id = original.hold_id
        with pytest.raises(HTTPException) as blocked:
            create_inspection(
                InspectionCreate(
                    job_card_id=job.id,
                    stage_type="WINDER",
                    readings=dict(PASS_AFTER_FAIL),
                    sample_id="CORR-1",
                    final_submission=True,
                ),
                db=db,
                plant_id=PLANT,
                current_user=QC,
            )
        assert blocked.value.status_code == 400
        assert "original value is retained" in str(blocked.value.detail).lower()
        stored_original = db.query(QualityInspection).filter(QualityInspection.id == original.id).one()
        assert stored_original.status == "FAIL"
        assert stored_original.readings.get("height") == 90
        hold = db.query(QualityHold).filter(QualityHold.id == original_hold_id).one()
        assert hold.status == "HOLD"

        with pytest.raises(HTTPException) as stale:
            create_inspection(
                InspectionCreate(
                    job_card_id=job.id,
                    stage_type="WINDER",
                    readings=dict(PASS_AFTER_FAIL),
                    sample_id="CORR-1",
                    correction_reason="height was a transcription error from the vernier card",
                    expected_revision=99,
                    final_submission=True,
                ),
                db=db,
                plant_id=PLANT,
                current_user=QC,
            )
        assert stale.value.status_code == 409

        corrected = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="WINDER",
                readings=dict(PASS_AFTER_FAIL),
                sample_id="CORR-1",
                correction_reason="height was a transcription error from the vernier card",
                expected_revision=1,
                final_submission=True,
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert corrected.status == "PASS"
        assert str(corrected.parent_inspection_id) == str(original.id)
        assert corrected.correction_revision == 2
        assert corrected.correction_reason == "height was a transcription error from the vernier card"
        assert corrected.correction_actor == QC["sub"]
        assert corrected.correction_at
        assert corrected.prior_values["height"]["prior"] == 90
        assert corrected.prior_values["height"]["replacement"] == 120
        assert corrected.original_status == "FAIL"
        assert corrected.review_required is True
        assert corrected.readings.get("height") == 120

        db.refresh(stored_original)
        assert stored_original.status == "FAIL"
        assert stored_original.readings.get("height") == 90
        assert stored_original.evaluation.get("workflow_status") == "SUPERSEDED"
        assert str(stored_original.evaluation.get("superseded_by")) == str(corrected.id)
        db.refresh(hold)
        assert hold.status == "HOLD"
        assert db.query(QualityHold).filter(QualityHold.job_card_id == job.id, QualityHold.status == "HOLD").count() == 1
        rows = db.query(QualityInspection).filter(QualityInspection.job_card_id == job.id).all()
        assert len(rows) == 2
        _reports().joinpath("qct056-job.json").write_text(
            json.dumps(
                {
                    "job_id": str(job.id),
                    "original_id": str(original.id),
                    "correction_id": str(corrected.id),
                    "hold_id": str(original_hold_id),
                }
            )
        )
    finally:
        db.close()


def test_qct056_ui_job_seed():
    headers = _admin_headers()
    marker = f"QCT056UI-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "CORR-UI", status="IN_PROGRESS")
        db.commit()
        _reports().joinpath("qct056-ui-job.json").write_text(json.dumps({"job_id": str(job.id)}))
    finally:
        db.close()

