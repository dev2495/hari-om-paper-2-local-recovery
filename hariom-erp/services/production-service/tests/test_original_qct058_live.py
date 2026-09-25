"""QCT-058: retrospective measured time after later stage and dispatch."""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import pytest

URL = os.environ.get("HARI_OM_PRODUCTION_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or not ("hariom_nverify" in URL or ("@127.0.0.1:5432/hariom_" in URL and "_integration_" in URL)):
    pytest.skip("Requires isolated hariom_nverify production Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from src.database import Base, engine
from src.models import Dispatch, JobCard, JobCardStage, PackingRecord, QualityHold
from src.routers.planning import _build_spec_snapshot, _ensure_job_card_stages, _routing_stages_from_snapshot
from src.routers.quality import InspectionCreate, LATE_EXCEPTION_LABEL, create_inspection
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
FAIL_REASONS = {"height": "paper card height measured short before oven"}


def _ensure_stages(db, job: JobCard, first_stage: str | None = None) -> None:
    routing = _routing_stages_from_snapshot(job.spec_snapshot or {})
    _ensure_job_card_stages(
        db=db,
        job_card=job,
        routing_stages=routing,
        first_stage=first_stage or job.current_stage or "WINDER",
    )
    db.flush()


def _complete_stage(db, job: JobCard, stage_type: str, qty: float, when: datetime) -> JobCardStage:
    row = (
        db.query(JobCardStage)
        .filter(JobCardStage.job_card_id == job.id, JobCardStage.stage_type == stage_type)
        .one()
    )
    row.output_qty = qty
    row.status = "COMPLETED"
    row.actual_start = when
    row.actual_end = when
    row.actuals_snapshot = {**(row.actuals_snapshot or {}), "stock_status": "UNRESTRICTED"}
    job.current_stage = stage_type
    db.flush()
    return row


def _seed_downstream_job(db, spec, snapshot, suffix: str):
    job = _issue_job(db, spec, snapshot, suffix, status="IN_PROGRESS")
    _ensure_stages(db, job, "WINDER")
    winder_time = datetime.utcnow() - timedelta(hours=5)
    oven_time = datetime.utcnow() - timedelta(hours=3)
    pack_time = datetime.utcnow() - timedelta(hours=2)
    ship_time = datetime.utcnow() - timedelta(hours=1)
    _complete_stage(db, job, "WINDER", 10, winder_time)
    _complete_stage(db, job, "OVEN", 10, oven_time)
    _complete_stage(db, job, "PACKING", 10, pack_time)
    packing = PackingRecord(
        plant_id=job.plant_id,
        job_card_id=job.id,
        total_packed_qty=10,
        bundle_count=1,
        qty_per_bundle=10,
        stock_status="UNRESTRICTED",
        snapshot={"qty": 10},
        created_at=pack_time,
    )
    db.add(packing)
    dispatch = Dispatch(
        job_card_id=job.id,
        status="SEALED",
        dispatch_snapshot={"qty": 6, "job_card_id": str(job.id)},
        created_at=ship_time,
    )
    db.add(dispatch)
    job.status = "COMPLETED"
    job.current_stage = "DONE"
    db.commit()
    db.refresh(job)
    db.refresh(dispatch)
    db.refresh(packing)
    return job, dispatch, packing, winder_time


def test_qct058_retrospective_fail_after_later_stage_and_dispatch():
    headers = _admin_headers()
    marker = f"QCT058-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job, dispatch, packing, winder_time = _seed_downstream_job(db, spec, snapshot, "LATE")
        failed = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="WINDER",
                readings=dict(FAIL_READINGS),
                reasons=dict(FAIL_REASONS),
                sample_id="QCT058-W1",
                measured_at=winder_time,
                entry_mode="PAPER_CARD",
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert failed.status == "FAIL"
        assert failed.measured_at
        assert failed.recorded_at
        assert failed.measured_at != failed.recorded_at
        assert failed.late_quality_exception is True
        assert failed.late_exception_label == LATE_EXCEPTION_LABEL
        assert failed.retroactive_prevention_claimed is False
        assert failed.exposure_after_dispatch is True
        assert any(str(row.get("stage_type") or "").upper() in {"OVEN", "PACKING"} for row in failed.evaluation.get("subsequent_stages") or [])
        surviving = failed.surviving_stock or failed.evaluation.get("surviving_stock") or []
        assert any(row.get("kind") == "FG" and float(row.get("qty") or 0) == 4 for row in surviving)
        shipments = failed.earlier_shipments or failed.evaluation.get("earlier_shipments") or []
        assert any(row.get("status") == "SEALED" and float(row.get("qty") or 0) == 6 for row in shipments)
        blob = json.dumps(failed.evaluation or {}).lower()
        assert "does not claim it was prevented" in blob
        assert "prevented the dispatch" not in blob
        db.expire_all()
        still_sealed = db.query(Dispatch).filter(Dispatch.id == dispatch.id).one()
        assert still_sealed.status == "SEALED"
        hold = db.query(QualityHold).filter(QualityHold.source_inspection_id == failed.id).one()
        assert hold.status == "HOLD"
        assert "not retroactively prevented" in str(hold.reason or "").lower()
        packing_row = db.query(PackingRecord).filter(PackingRecord.id == packing.id).one()
        assert packing_row.total_packed_qty == 10
        _reports().joinpath("qct058-job.json").write_text(
            json.dumps(
                {
                    "job_id": str(job.id),
                    "dispatch_id": str(dispatch.id),
                    "measured_at": failed.measured_at,
                    "recorded_at": failed.recorded_at,
                    "surviving_fg": 4,
                    "shipped_qty": 6,
                }
            )
        )
    finally:
        db.close()


def test_qct058_ui_job_seed():
    headers = _admin_headers()
    marker = f"QCT058UI-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job, dispatch, packing, winder_time = _seed_downstream_job(db, spec, snapshot, "LATE-UI")
        measured_local = winder_time.strftime("%Y-%m-%dT%H:%M")
        _reports().joinpath("qct058-ui-job.json").write_text(
            json.dumps(
                {
                    "job_id": str(job.id),
                    "dispatch_id": str(dispatch.id),
                    "packing_id": str(packing.id),
                    "measured_at_local": measured_local,
                }
            )
        )
    finally:
        db.close()
