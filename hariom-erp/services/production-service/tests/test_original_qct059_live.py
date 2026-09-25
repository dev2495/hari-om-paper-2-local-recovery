"""QCT-059: offline/paper draft, server version change, reconnect without release."""
from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy.orm.attributes import flag_modified

URL = os.environ.get("HARI_OM_PRODUCTION_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or not ("hariom_nverify" in URL or ("@127.0.0.1:5432/hariom_" in URL and "_integration_" in URL)):
    pytest.skip("Requires isolated hariom_nverify production Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from src.database import Base, engine
from src.models import QualityHold, QualityInspection
from src.routers.planning import _build_spec_snapshot
from src.routers.quality import (
    STALE_CONTEXT_MESSAGE,
    InspectionCreate,
    create_inspection,
    signed_profile_context,
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
FAIL_REASONS = {"height": "paper card height measured short while disconnected"}


def _bump_context(db, job) -> dict:
    snapshot = dict(job.spec_snapshot or {})
    current = signed_profile_context(snapshot)
    snapshot["quality_context_version"] = int(current["quality_context_version"]) + 1
    job.spec_snapshot = snapshot
    flag_modified(job, "spec_snapshot")
    db.commit()
    db.refresh(job)
    return signed_profile_context(job.spec_snapshot or {})


def test_qct059_offline_draft_stale_reconnect_keeps_observations_and_signed_context():
    headers = _admin_headers()
    marker = f"QCT059-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "OFFLINE", status="IN_PROGRESS")
        db.commit()
        db.refresh(job)
        draft_ctx = signed_profile_context(job.spec_snapshot or {})
        assert draft_ctx["quality_context_version"] >= 1
        assert draft_ctx["fingerprint"]

        with pytest.raises(HTTPException) as offline:
            create_inspection(
                InspectionCreate(
                    job_card_id=job.id,
                    stage_type="WINDER",
                    readings=dict(FAIL_READINGS),
                    reasons=dict(FAIL_REASONS),
                    sample_id="QCT059-PAPER",
                    entry_mode="OFFLINE_DRAFT",
                    expected_context_version=draft_ctx["quality_context_version"],
                    signed_profile_fingerprint=draft_ctx["fingerprint"],
                    final_submission=True,
                ),
                db=db,
                plant_id=PLANT,
                current_user=QC,
            )
        assert offline.value.status_code == 409
        offline_detail = offline.value.detail
        assert isinstance(offline_detail, dict)
        assert offline_detail["code"] == "OFFLINE_RELEASE_FORBIDDEN"
        assert offline_detail["offline_release"] is False
        assert STALE_CONTEXT_MESSAGE in offline_detail["message"]
        assert offline_detail["observations"]["readings"]["height"] == 90
        assert "paper card height" in str(offline_detail["observations"]["reasons"]["height"])
        assert offline_detail["signed_profile_context"]["fingerprint"] == draft_ctx["fingerprint"]
        assert db.query(QualityInspection).filter(QualityInspection.job_card_id == job.id).count() == 0
        assert db.query(QualityHold).filter(QualityHold.job_card_id == job.id).count() == 0

        current_ctx = _bump_context(db, job)
        assert current_ctx["quality_context_version"] == draft_ctx["quality_context_version"] + 1
        assert current_ctx["fingerprint"] != draft_ctx["fingerprint"]
        assert current_ctx["profile_revision"] == draft_ctx["profile_revision"]

        with pytest.raises(HTTPException) as stale:
            create_inspection(
                InspectionCreate(
                    job_card_id=job.id,
                    stage_type="WINDER",
                    readings=dict(FAIL_READINGS),
                    reasons=dict(FAIL_REASONS),
                    sample_id="QCT059-PAPER",
                    entry_mode="PAPER_CARD",
                    expected_context_version=draft_ctx["quality_context_version"],
                    signed_profile_fingerprint=draft_ctx["fingerprint"],
                ),
                db=db,
                plant_id=PLANT,
                current_user=QC,
            )
        assert stale.value.status_code == 409
        stale_detail = stale.value.detail
        assert isinstance(stale_detail, dict)
        assert stale_detail["code"] == "STALE_CONTEXT"
        assert stale_detail["offline_release"] is False
        assert STALE_CONTEXT_MESSAGE in stale_detail["message"]
        assert stale_detail["observations"]["readings"]["height"] == 90
        assert stale_detail["observations"]["sample_id"] == "QCT059-PAPER"
        assert stale_detail["signed_profile_context"]["quality_context_version"] == draft_ctx["quality_context_version"]
        assert stale_detail["signed_profile_context"]["fingerprint"] == draft_ctx["fingerprint"]
        assert stale_detail["current_profile_context"]["quality_context_version"] == current_ctx["quality_context_version"]
        assert db.query(QualityInspection).filter(QualityInspection.job_card_id == job.id).count() == 0
        assert db.query(QualityHold).filter(QualityHold.job_card_id == job.id).count() == 0

        recorded = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="WINDER",
                readings=dict(FAIL_READINGS),
                reasons=dict(FAIL_REASONS),
                sample_id="QCT059-RECONNECT",
                entry_mode="PAPER_CARD",
                expected_context_version=current_ctx["quality_context_version"],
                signed_profile_fingerprint=current_ctx["fingerprint"],
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert recorded.status == "FAIL"
        assert recorded.evaluation.get("quality_context_version") == current_ctx["quality_context_version"]
        _reports().joinpath("qct059-job.json").write_text(
            json.dumps(
                {
                    "job_id": str(job.id),
                    "draft_context_version": draft_ctx["quality_context_version"],
                    "current_context_version": current_ctx["quality_context_version"],
                    "inspection_id": str(recorded.id),
                }
            )
        )
    finally:
        db.close()


def test_qct059_ui_job_seed():
    headers = _admin_headers()
    marker = f"QCT059UI-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "OFFLINE-UI", status="IN_PROGRESS")
        db.commit()
        db.refresh(job)
        draft_ctx = signed_profile_context(job.spec_snapshot or {})
        _reports().joinpath("qct059-ui-job.json").write_text(
            json.dumps(
                {
                    "job_id": str(job.id),
                    "draft_context_version": draft_ctx["quality_context_version"],
                    "draft_fingerprint": draft_ctx["fingerprint"],
                    "profile_revision": draft_ctx["profile_revision"],
                }
            )
        )
    finally:
        db.close()


def test_qct059_bump_server_version():
    artifact_path = _reports() / "qct059-ui-job.json"
    artifact = json.loads(artifact_path.read_text())
    db = Session()
    try:
        from src.models import JobCard

        job = db.query(JobCard).filter(JobCard.id == uuid.UUID(str(artifact["job_id"]))).one()
        current = _bump_context(db, job)
        artifact["current_context_version"] = current["quality_context_version"]
        artifact["current_fingerprint"] = current["fingerprint"]
        artifact_path.write_text(json.dumps(artifact))
        assert current["quality_context_version"] == int(artifact["draft_context_version"]) + 1
    finally:
        db.close()
