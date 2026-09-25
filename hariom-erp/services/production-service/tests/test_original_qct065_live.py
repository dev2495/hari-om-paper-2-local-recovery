"""QCT-065: inspector/store major concession via direct API is denied."""
from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

import pytest
from fastapi import HTTPException

URL = os.environ.get("HARI_OM_PRODUCTION_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or not ("hariom_nverify" in URL or ("@127.0.0.1:5432/hariom_" in URL and "_integration_" in URL)):
    pytest.skip("Requires isolated hariom_nverify production Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from src.database import Base, engine
from src.models import QualityHold, QualityInspection
from src.routers.planning import _build_spec_snapshot
from src.routers.quality import InspectionCreate, create_inspection, release_hold
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
STORE = {"sub": "nverify-qct065-store", "roles": ["Store"], "role": "Store"}


def test_qct065_inspector_and_store_concession_denied():
    headers = _admin_headers()
    marker = f"QCT065-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "CONC", status="IN_PROGRESS")
        db.commit()
        recorded = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="WINDER",
                readings=dict(FAIL_READINGS),
                reasons=dict(FAIL_REASONS),
                sample_id="QCT065-1",
                final_submission=True,
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert recorded.status == "FAIL"
        assert recorded.hold_id is not None

        with pytest.raises(HTTPException) as inspector_denied:
            release_hold(
                recorded.hold_id,
                db=db,
                plant_id=PLANT,
                current_user=QC,
            )
        assert inspector_denied.value.status_code == 403

        with pytest.raises(HTTPException) as store_denied:
            release_hold(
                recorded.hold_id,
                db=db,
                plant_id=PLANT,
                current_user=STORE,
            )
        assert store_denied.value.status_code == 403

        hold = db.query(QualityHold).filter(QualityHold.id == recorded.hold_id).one()
        assert hold.status == "HOLD"
        stored = db.query(QualityInspection).filter(QualityInspection.id == recorded.id).one()
        assert stored.status == "FAIL"
        _reports().joinpath("qct065-job.json").write_text(
            json.dumps(
                {
                    "job_id": str(job.id),
                    "inspection_id": str(recorded.id),
                    "hold_id": str(recorded.hold_id),
                }
            )
        )
    finally:
        db.close()


def test_qct065_ui_job_seed():
    headers = _admin_headers()
    marker = f"QCT065UI-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "CONC-UI", status="IN_PROGRESS")
        db.commit()
        _reports().joinpath("qct065-ui-job.json").write_text(json.dumps({"job_id": str(job.id)}))
    finally:
        db.close()
