"""QCT-046 blank multi-page print seed; QCT-047 signed print after label change."""
from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

import httpx
import pytest
from sqlalchemy.orm import sessionmaker

URL = os.environ.get("HARI_OM_PRODUCTION_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or "hariom_nverify" not in URL:
    pytest.skip("Requires isolated hariom_nverify production Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from src.database import Base, engine
from src.routers.planning import _build_spec_snapshot, get_planning_job_card
from src.routers.quality import InspectionCreate, create_inspection
from tests.test_original_qct043_live import (
    ADMIN,
    PLANT,
    QC,
    SCOPE,
    Session,
    _admin_headers,
    _complete_profile,
    _create_approved_spec,
    _height_rule,
    _issue_job,
)


def setup_module() -> None:
    Base.metadata.create_all(engine)


def _artifact_path() -> Path:
    path = Path(__file__).resolve().parents[4] / "reports" / "qct046-job.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def test_qct046_blank_job_print_has_frozen_stage_rules():
    headers = _admin_headers()
    marker = f"QCT046-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        blank = _issue_job(db, spec, snapshot, "BLANK", status="CREATED")
        db.commit()
        payload = get_planning_job_card(
            blank.id,
            db=db,
            plant_scope=SCOPE,
            current_user=ADMIN,
        )
        profile = (payload.spec_snapshot or {}).get("qc_profile") or {}
        assert profile.get("status") == "approved"
        assert float(_height_rule(profile["stages"]["WINDER"]["parameters"])["max"]) == 122.0
        oven = profile["stages"]["OVEN"]["parameters"]
        assert {row["code"] for row in oven} >= {"pre_weight", "post_weight", "pre_moisture", "post_moisture"}
        inspections = payload.quality_inspections or []
        assert inspections == []
        _artifact_path().write_text(
            json.dumps({"blank_job_id": str(blank.id), "revision": int(profile.get("revision") or 1)})
        )
    finally:
        db.close()


def test_qct047_signed_print_keeps_old_label_after_dictionary_change():
    headers = _admin_headers()
    marker = f"QCT047-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    revision_a = int((spec.get("qc_profile") or {}).get("revision") or 1)
    db = Session()
    try:
        signed = _issue_job(db, spec, snapshot, "SIGNED")
        db.commit()
        evidence = create_inspection(
            InspectionCreate(
                job_card_id=signed.id,
                stage_type="WINDER",
                readings={"id": 77, "od": 91, "height": 120, "weight": 250, "cs": 100},
                sample_id="S1",
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert evidence.status == "PASS"
        profile = _complete_profile()
        for row in profile["stages"]["WINDER"]["parameters"]:
            if row["code"] == "height":
                row["label"] = "Ht-B"
                row["unit"] = "cm"
                row["method"] = "Dict-B"
                row["min"] = 10.0
                row["max"] = 14.0
        saved = httpx.put(
            f"{os.environ.get('HARI_OM_SPEC_URL', 'http://127.0.0.1:28003')}/specs/{spec['id']}/qc-profile",
            json={"qc_profile": profile, "status": "complete"},
            headers=headers,
            timeout=20.0,
        )
        assert saved.status_code == 200, saved.text
        body = saved.json()
        revision = int((body.get("qc_profile") or {}).get("revision") or 0)
        approved = httpx.post(
            f"{os.environ.get('HARI_OM_SPEC_URL', 'http://127.0.0.1:28003')}/specs/{spec['id']}/qc-profile/approve",
            json={"expected_revision": revision},
            headers=headers,
            timeout=20.0,
        )
        assert approved.status_code == 200, approved.text
        live_height = _height_rule(approved.json()["qc_profile"]["stages"]["WINDER"]["parameters"])
        assert live_height.get("label") == "Height"
        assert str(live_height.get("unit")) == "cm"
        assert live_height.get("method") == "Dict-B"
        assert float(live_height["max"]) == 14.0
        db.expire_all()
        print_payload = get_planning_job_card(
            signed.id,
            db=db,
            plant_scope=SCOPE,
            current_user=ADMIN,
        )
        reopened = print_payload.quality_inspections[0]
        frozen_print = _height_rule(reopened.get("frozen_rules") or [])
        assert float(frozen_print["max"]) == 122.0
        assert str(frozen_print.get("label") or "Height") == "Height"
        assert str(frozen_print.get("unit") or "mm") == "mm"
        assert frozen_print.get("method") != "Dict-B"
        assert int(reopened.get("profile_revision") or 0) == revision_a
        snap_height = _height_rule((print_payload.spec_snapshot or {})["qc_profile"]["stages"]["WINDER"]["parameters"])
        assert str(snap_height.get("label") or "Height") == "Height"
        assert str(snap_height.get("unit") or "mm") == "mm"
        assert float(snap_height["max"]) == 122.0
        path = Path(__file__).resolve().parents[4] / "reports" / "qct047-job.json"
        path.write_text(
            json.dumps(
                {
                    "job_id": str(signed.id),
                    "revision_a": revision_a,
                    "live_unit": "cm",
                    "live_method": "Dict-B",
                    "frozen_label": frozen_print.get("label") or "Height",
                    "frozen_unit": frozen_print.get("unit") or "mm",
                }
            )
        )
    finally:
        db.close()
