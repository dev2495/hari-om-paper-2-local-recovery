"""QCT-060/061: queue missing-QC commercial release; checkpoint needs approved attach."""
from __future__ import annotations

import copy
import json
import os
import uuid
from datetime import date
from pathlib import Path

import httpx
import pytest
from fastapi import HTTPException

URL = os.environ.get("HARI_OM_PRODUCTION_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or "hariom_nverify" not in URL:
    pytest.skip("Requires isolated hariom_nverify production Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from src.database import Base, engine
from src.models import AuditEvent, JobCardStage, PLANT_A_UUID, QualityHold, QualityInspection
from src.routers import planning as planning_mod
from src.routers.planning import (
    StageOutputPayload,
    _create_or_sync_job_card_for_line,
    capture_stage_output,
)
from src.routers.quality import InspectionCreate, attach_approved_qc_profile, create_inspection
from tests.test_original_qct043_live import (
    PLANT,
    QC,
    Session,
    _admin_headers,
    _complete_profile,
)


def setup_module() -> None:
    Base.metadata.create_all(engine)


def _reports() -> Path:
    path = Path(__file__).resolve().parents[4] / "reports"
    path.mkdir(parents=True, exist_ok=True)
    return path


SPEC = os.environ.get("HARI_OM_SPEC_URL", "http://127.0.0.1:28003")
PASS_READINGS = {"id": 77, "od": 91, "height": 120, "weight": 250, "cs": 100}


def _create_spec_without_qc(headers: dict[str, str], marker: str) -> dict:
    created = httpx.post(
        f"{SPEC}/specs/",
        json={
            "customer_name": marker,
            "customer_name_snapshot": marker,
            "tube_size_id": str(uuid.uuid4()),
            "mandrel_id": str(uuid.uuid4()),
            "required_cs": 100.0,
            "target_tube_weight": 250.0,
            "id_min_mm": 76.0,
            "id_max_mm": 78.0,
            "od_min_mm": 90.0,
            "od_max_mm": 92.0,
            "length_min_mm": 118.0,
            "length_max_mm": 122.0,
            "weight_min_g": 240.0,
            "weight_max_g": 260.0,
            "cs_min_n": 90.0,
            "cs_max_n": 110.0,
            "moisture_min_pct": 5.0,
            "moisture_max_pct": 8.0,
            "bamboo_max_length": 1560.0,
            "cut_loss_mm": 40.0,
        },
        headers=headers,
        timeout=20.0,
    )
    assert created.status_code in {200, 201}, created.text
    return created.json()


def _approve_qc_on_spec(headers: dict[str, str], spec_id: str, profile: dict) -> dict:
    saved = httpx.put(
        f"{SPEC}/specs/{spec_id}/qc-profile",
        json={"qc_profile": profile, "status": "complete"},
        headers=headers,
        timeout=20.0,
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    revision = int((body.get("qc_profile") or {}).get("revision") or 1)
    approved = httpx.post(
        f"{SPEC}/specs/{spec_id}/qc-profile/approve",
        json={"expected_revision": revision},
        headers=headers,
        timeout=20.0,
    )
    assert approved.status_code == 200, approved.text
    return approved.json()


def _planner(token: str) -> dict:
    return {"sub": "nverify-qct060-planner", "roles": ["Admin", "Planner"], "role": "Admin", "token": token}


def _install_commercial_fakes(monkeypatch, spec_state: dict, winder_id: uuid.UUID) -> None:
    def fake_spec(spec_id, token, plant_id, require_approved_active=True):
        body = dict(spec_state["body"])
        body["id"] = str(spec_id)
        body["status"] = "approved"
        body["active"] = True
        return body

    def fake_machine(machine_id, token, plant_id):
        return {
            "id": str(machine_id),
            "plant_id": str(PLANT_A_UUID),
            "department": "WINDER",
            "is_active": True,
            "status": "UP",
        }

    monkeypatch.setattr(planning_mod, "_fetch_spec", fake_spec)
    monkeypatch.setattr(planning_mod, "_fetch_machine", fake_machine)
    monkeypatch.setattr(planning_mod, "_fetch_recipes_for_spec", lambda *a, **k: [])
    monkeypatch.setattr(planning_mod, "_fetch_spec_calculation", lambda *a, **k: {})
    monkeypatch.setattr(planning_mod, "_sync_sales_release_lot_job_card", lambda *a, **k: None)


def _queue_missing_release(db, monkeypatch, spec: dict, token: str, suffix: str):
    spec_state = {"body": spec}
    winder_id = uuid.uuid4()
    release_lot_id = uuid.uuid4()
    line_id = uuid.uuid4()
    order_id = uuid.uuid4()
    _install_commercial_fakes(monkeypatch, spec_state, winder_id)
    live_order = {
        "id": str(order_id),
        "customer_id": str(uuid.uuid4()),
        "status": "released",
        "priority": "NORMAL",
        "order_no": f"SO-QCT060-{suffix}",
        "po_number": f"PO-QCT060-{suffix}",
        "lines": [
            {
                "id": str(line_id),
                "qty": 10,
                "due_date": date.today().isoformat(),
                "approved_spec_id": str(spec["id"]),
                "product_code": f"NV-QCT060-{suffix}",
            }
        ],
    }
    line = live_order["lines"][0]
    job, created = _create_or_sync_job_card_for_line(
        db=db,
        plant_uuid=PLANT_A_UUID,
        live_order=live_order,
        line=line,
        release_lot_id=release_lot_id,
        winder_machine_id=winder_id,
        planned_qty=10.0,
        priority="NORMAL",
        product_code=line["product_code"],
        token=token,
        plant_id=PLANT,
        current_user=_planner(token),
    )
    db.commit()
    db.refresh(job)
    return job, created, live_order, line, release_lot_id, winder_id, spec_state


def test_qct060_queue_missing_qc_then_checkpoint_requires_resolution(monkeypatch):
    headers = _admin_headers()
    token = headers["Authorization"].split(" ", 1)[1]
    marker = f"QCT060-{uuid.uuid4()}"
    spec = _create_spec_without_qc(headers, marker)
    assert str(spec.get("qc_setup_status") or "missing") in {"missing", "draft", "incomplete"}
    stages = ((spec.get("qc_profile") or {}).get("stages") or {})
    assert not stages
    db = Session()
    try:
        job, created, *_rest = _queue_missing_release(db, monkeypatch, spec, token, "A")
        assert created is True
        snapshot = job.spec_snapshot or {}
        assert snapshot.get("missing_qc_setup") is True
        assert snapshot.get("missing_profile_marker") is True
        assert snapshot.get("qc_setup_status") == "missing"
        assert job.status == "PLANNED"
        winder = (
            db.query(JobCardStage)
            .filter(JobCardStage.job_card_id == job.id, JobCardStage.stage_type == "WINDER")
            .one()
        )
        assert winder.status == "QUEUED"
        with pytest.raises(HTTPException) as inspection_exc:
            create_inspection(
                InspectionCreate(
                    job_card_id=job.id,
                    stage_type="WINDER",
                    readings=dict(PASS_READINGS),
                    sample_id="QCT060-CHK",
                    final_submission=True,
                ),
                db=db,
                plant_id=PLANT,
                current_user=QC,
            )
        assert inspection_exc.value.status_code == 409
        detail = inspection_exc.value.detail
        assert isinstance(detail, dict)
        assert detail["code"] == "MISSING_QC_SETUP"
        assert detail["requires_approved_resolution"] is True
        assert detail["approved_resolution"] is False
        assert "approved resolution" in str(detail["message"]).lower()
        with pytest.raises(HTTPException) as output_exc:
            capture_stage_output(
                job.id,
                StageOutputPayload(stage="WINDER", save_mode="complete", output_qty=4),
                db=db,
                plant_id=PLANT,
                current_user=_planner(token),
            )
        assert output_exc.value.status_code == 409
        assert output_exc.value.detail["code"] == "MISSING_QC_SETUP"
        assert db.query(QualityInspection).filter(QualityInspection.job_card_id == job.id).count() == 0
        assert db.query(QualityHold).filter(QualityHold.job_card_id == job.id).count() == 0
        _reports().joinpath("qct060-job.json").write_text(
            json.dumps({"job_id": str(job.id), "qc_setup_status": snapshot.get("qc_setup_status")})
        )
    finally:
        db.close()


def test_qct060_ui_job_seed(monkeypatch):
    headers = _admin_headers()
    token = headers["Authorization"].split(" ", 1)[1]
    marker = f"QCT060UI-{uuid.uuid4()}"
    spec = _create_spec_without_qc(headers, marker)
    db = Session()
    try:
        job, created, *_rest = _queue_missing_release(db, monkeypatch, spec, token, "UI")
        assert created is True
        _reports().joinpath("qct060-ui-job.json").write_text(
            json.dumps(
                {
                    "job_id": str(job.id),
                    "missing_qc_setup": True,
                    "qc_setup_status": (job.spec_snapshot or {}).get("qc_setup_status"),
                }
            )
        )
    finally:
        db.close()


def test_qct061_attach_then_replay_does_not_reset(monkeypatch):
    headers = _admin_headers()
    token = headers["Authorization"].split(" ", 1)[1]
    marker = f"QCT061-{uuid.uuid4()}"
    spec = _create_spec_without_qc(headers, marker)
    db = Session()
    try:
        job, created, live_order, line, release_lot_id, winder_id, spec_state = _queue_missing_release(
            db, monkeypatch, spec, token, "B"
        )
        assert created is True
        assert (job.spec_snapshot or {}).get("missing_qc_setup") is True
        winder_before = (
            db.query(JobCardStage)
            .filter(JobCardStage.job_card_id == job.id, JobCardStage.stage_type == "WINDER")
            .one()
        )
        plan_date = winder_before.plan_date
        shift = winder_before.shift_code
        stage_status = winder_before.status
        approved = _approve_qc_on_spec(headers, spec["id"], _complete_profile())
        spec_state["body"] = approved
        first = attach_approved_qc_profile(
            job.id,
            db=db,
            plant_id=PLANT,
            current_user={"sub": "nverify-qct061-qc", "roles": ["QC"], "role": "QC", "token": token},
        )
        assert first.attached is True
        assert first.idempotent is False
        assert first.missing_qc_setup is False
        assert first.qc_setup_status == "attached"
        db.refresh(job)
        attached_snapshot = copy.deepcopy(job.spec_snapshot or {})
        assert attached_snapshot.get("qc_setup_status") == "attached"
        assert attached_snapshot.get("missing_qc_setup") is False
        assert int((attached_snapshot.get("qc_profile") or {}).get("revision") or 0) >= 1
        replayed, replay_created = _create_or_sync_job_card_for_line(
            db=db,
            plant_uuid=PLANT_A_UUID,
            live_order=live_order,
            line=line,
            release_lot_id=release_lot_id,
            winder_machine_id=winder_id,
            planned_qty=10.0,
            priority="NORMAL",
            product_code=line["product_code"],
            token=token,
            plant_id=PLANT,
            current_user=_planner(token),
        )
        db.commit()
        assert replay_created is False
        assert replayed.id == job.id
        db.refresh(job)
        assert job.spec_snapshot == attached_snapshot
        assert job.status == "PLANNED"
        winder_after = (
            db.query(JobCardStage)
            .filter(JobCardStage.job_card_id == job.id, JobCardStage.stage_type == "WINDER")
            .one()
        )
        assert winder_after.plan_date == plan_date
        assert winder_after.shift_code == shift
        assert winder_after.status == stage_status
        assert winder_after.actual_start is None
        second = attach_approved_qc_profile(
            job.id,
            db=db,
            plant_id=PLANT,
            current_user={"sub": "nverify-qct061-qc", "roles": ["QC"], "role": "QC", "token": token},
        )
        assert second.idempotent is True
        recorded = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="WINDER",
                readings=dict(PASS_READINGS),
                sample_id="QCT061-AFTER",
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert recorded.status == "PASS"
        audits = (
            db.query(AuditEvent)
            .filter(AuditEvent.job_card_id == job.id, AuditEvent.action == "attach_qc_profile")
            .all()
        )
        assert audits
        assert any(row.payload.get("explicit") for row in audits)
        _reports().joinpath("qct061-job.json").write_text(json.dumps({"job_id": str(job.id)}))
    finally:
        db.close()
