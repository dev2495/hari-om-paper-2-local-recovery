"""QCT-043: inspect under rev A, approve rev B, old evidence/print stays A."""
from __future__ import annotations

import copy
import os
import uuid
from datetime import date

import httpx
import pytest
from sqlalchemy.orm import sessionmaker

URL = os.environ.get("HARI_OM_PRODUCTION_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or "hariom_nverify" not in URL:
    pytest.skip("Requires isolated hariom_nverify production Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from src.database import Base, engine
from src.models import JobCard, PLANT_A_UUID, QualityInspection, SalesOrder
from src.routers.planning import _build_spec_snapshot, get_planning_job_card
from src.routers.quality import InspectionCreate, create_inspection, list_inspections


Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
PLANT = "00000000-0000-0000-0000-0000000000a1"
AUTH = os.environ.get("HARI_OM_AUTH_URL", "http://127.0.0.1:28001")
SPEC = os.environ.get("HARI_OM_SPEC_URL", "http://127.0.0.1:28003")
ADMIN = {"sub": "nverify-qct043-admin", "roles": ["Admin"], "role": "Admin", "token": ""}
QC = {"sub": "nverify-qct043-qc", "roles": ["QC"], "role": "QC"}
SCOPE = {"scope_all": False, "selected_plant_id": PLANT, "allowed_plants": [PLANT]}


def setup_module() -> None:
    Base.metadata.create_all(engine)


def _complete_profile(*, id_min=76.0, id_max=78.0, notching_applicable=False):
    return {
        "status": "complete",
        "notching_applicable": notching_applicable,
        "stages": {
            "WINDER": {
                "parameters": [
                    {"code": "id", "min": id_min, "max": id_max, "unit": "mm", "required": True, "method": "Vernier"},
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
                    {"code": "notch_distance", "applicable": False},
                    {"code": "notch_depth", "applicable": False},
                    {"code": "moisture", "min": 1.0, "max": 9.0, "unit": "%", "required": True},
                ]
            },
        },
    }


def _admin_headers() -> dict[str, str]:
    response = httpx.post(
        f"{AUTH}/auth/login",
        data={"username": "admin@hariom.com", "password": "admin123"},
        timeout=10.0,
    )
    if response.status_code != 200:
        pytest.fail(f"Auth login unavailable: {response.status_code} {response.text}")
    token = (response.json() or {}).get("access_token")
    if not token:
        pytest.fail("Auth login returned no access_token")
    return {"Authorization": f"Bearer {token}", "X-Plant-ID": PLANT}


def _create_approved_spec(headers: dict[str, str], marker: str, profile: dict) -> dict:
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
    spec = created.json()
    spec_id = spec["id"]
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


def _approve_revision_b(headers: dict[str, str], spec_id: str, current: dict) -> dict:
    del current
    profile = _complete_profile()
    stages = dict(profile.get("stages") or {})
    winder = dict(stages.get("WINDER") or {})
    params = []
    for row in winder.get("parameters") or []:
        item = dict(row)
        if item.get("code") == "height":
            item["min"] = 10.0
            item["max"] = 14.0
        params.append(item)
    winder["parameters"] = params
    stages["WINDER"] = winder
    profile["stages"] = stages
    saved = httpx.put(
        f"{SPEC}/specs/{spec_id}/qc-profile",
        json={"qc_profile": profile, "status": "complete"},
        headers=headers,
        timeout=20.0,
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    revision = int((body.get("qc_profile") or {}).get("revision") or 0)
    approved = httpx.post(
        f"{SPEC}/specs/{spec_id}/qc-profile/approve",
        json={"expected_revision": revision},
        headers=headers,
        timeout=20.0,
    )
    assert approved.status_code == 200, approved.text
    return approved.json()


def _issue_job(db, spec: dict, snapshot: dict, suffix: str, status: str = "IN_PROGRESS") -> JobCard:
    order = SalesOrder(
        plant_id=PLANT_A_UUID,
        customer_id=uuid.uuid4(),
        spec_id=uuid.UUID(str(spec["id"])),
        order_qty=10,
        due_date=date.today(),
    )
    db.add(order)
    db.flush()
    job = JobCard(
        plant_id=PLANT_A_UUID,
        sales_order_id=order.id,
        spec_id=uuid.UUID(str(spec["id"])),
        spec_snapshot=snapshot,
        planned_qty=10,
        released_qty=10,
        status=status,
        current_stage="WINDER",
        product_code=f"NV-QCT043-{suffix}",
    )
    db.add(job)
    db.flush()
    return job


def _height_rule(rows) -> dict:
    return next(row for row in rows if str(row.get("code")) == "height")


def test_qct043_old_evidence_and_print_stay_rev_a_after_rev_b():
    headers = _admin_headers()
    marker = f"QCT043-{uuid.uuid4()}"
    spec_a = _create_approved_spec(headers, marker, _complete_profile())
    profile_a = spec_a.get("qc_profile") or {}
    assert profile_a.get("status") == "approved"
    revision_a = int(profile_a.get("revision") or 1)
    snapshot_a = _build_spec_snapshot(spec_a, "NORMAL")
    assert snapshot_a.get("moisture_min_pct") is not None
    assert int((snapshot_a.get("qc_profile") or {}).get("revision") or 0) == revision_a

    db = Session()
    try:
        inspected = _issue_job(db, spec_a, snapshot_a, "A")
        queued = _issue_job(db, spec_a, copy.deepcopy(snapshot_a), "Q", status="CREATED")
        db.commit()
        evidence = create_inspection(
            InspectionCreate(
                job_card_id=inspected.id,
                stage_type="WINDER",
                readings={"id": 77, "od": 91, "height": 120, "weight": 250, "cs": 100},
                sample_id="A1",
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert evidence.status == "PASS"
        assert int(evidence.evaluation.get("profile_revision") or 0) == revision_a
        assert float(_height_rule(evidence.frozen_rules)["max"]) == 122.0

        spec_b = _approve_revision_b(headers, spec_a["id"], spec_a)
        profile_b = spec_b.get("qc_profile") or {}
        revision_b = int(profile_b.get("revision") or 0)
        assert revision_b != revision_a
        assert float(_height_rule(profile_b["stages"]["WINDER"]["parameters"])["max"]) == 14.0

        db.expire_all()
        stored_job = db.query(JobCard).filter(JobCard.id == inspected.id).one()
        stored_profile = (stored_job.spec_snapshot or {}).get("qc_profile") or {}
        assert int(stored_profile.get("revision") or 0) == revision_a
        assert float(_height_rule(stored_profile["stages"]["WINDER"]["parameters"])["max"]) == 122.0
        queued_job = db.query(JobCard).filter(JobCard.id == queued.id).one()
        queued_profile = (queued_job.spec_snapshot or {}).get("qc_profile") or {}
        assert int(queued_profile.get("revision") or 0) == revision_a

        print_payload = get_planning_job_card(
            inspected.id,
            db=db,
            plant_scope=SCOPE,
            current_user=ADMIN,
        )
        print_profile = (print_payload.spec_snapshot or {}).get("qc_profile") or {}
        document_profile = (print_payload.document_snapshot or {}).get("qc_profile") or {}
        assert int(print_profile.get("revision") or 0) == revision_a
        assert int(document_profile.get("revision") or print_payload.document_snapshot.get("profile_revision") or 0) == revision_a
        assert float(_height_rule(print_profile["stages"]["WINDER"]["parameters"])["max"]) == 122.0
        reopened = print_payload.quality_inspections[0]
        assert reopened["status"] == "PASS"
        assert int(reopened.get("profile_revision") or 0) == revision_a
        assert float(_height_rule(reopened.get("frozen_rules") or [])["max"]) == 122.0
        assert reopened["readings"]["id"] == 77
        listed = list_inspections(
            job_card_id=inspected.id,
            status=None,
            limit=20,
            offset=0,
            db=db,
            plant_scope=SCOPE,
            current_user=QC,
        )
        assert listed[0].status == "PASS"
        assert float(_height_rule(listed[0].frozen_rules)["max"]) == 122.0

        snapshot_b = _build_spec_snapshot(spec_b, "NORMAL")
        prospective = _issue_job(db, spec_b, snapshot_b, "B")
        db.commit()
        assert int((prospective.spec_snapshot.get("qc_profile") or {}).get("revision") or 0) == revision_b
        assert float(_height_rule(prospective.spec_snapshot["qc_profile"]["stages"]["WINDER"]["parameters"])["max"]) == 14.0
        later = create_inspection(
            InspectionCreate(
                job_card_id=prospective.id,
                stage_type="WINDER",
                readings={"id": 77, "od": 91, "height": 120, "weight": 250, "cs": 100},
                sample_id="B1",
                reasons={"height": "outside rev B"},
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert later.status != "PASS"
        assert int(later.evaluation.get("profile_revision") or 0) == revision_b
        stored = db.query(QualityInspection).filter(QualityInspection.id == evidence.id).one()
        assert stored.status == "PASS"
        assert float(_height_rule((stored.evaluation or {}).get("frozen_rules") or [])["max"]) == 122.0
        from pathlib import Path
        import json

        artifact = Path(__file__).resolve().parents[4] / "reports" / "qct043-job.json"
        artifact.parent.mkdir(parents=True, exist_ok=True)
        artifact.write_text(
            json.dumps(
                {
                    "job_id": str(inspected.id),
                    "prospective_job_id": str(prospective.id),
                    "revision_a": revision_a,
                    "revision_b": revision_b,
                }
            )
        )
    finally:
        db.close()
