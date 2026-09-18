"""QCT-040/041/042: client field names, notching applicability, stage basis."""
from __future__ import annotations

import os
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import sessionmaker

URL = os.environ.get("HARI_OM_SPEC_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or "hariom_nverify" not in URL:
    pytest.skip("Requires isolated hariom_nverify spec Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from src.main import ensure_runtime_schema
from src.database import engine
from src.models import SpecificationSheet
from src.qc_profile import EXACT_STAGE_LABELS, GENERIC_FORBIDDEN_LABELS, NOT_APPLICABLE_LABEL, winding_parameter
from src.routers.specs import (
    QcProfileApprovePayload,
    QcProfileUpdate,
    SpecCreate,
    SpecUpdate,
    approve_spec_qc_profile,
    create_spec,
    get_qc_parameter_dictionary,
    update_spec,
    upsert_spec_qc_profile,
)

ensure_runtime_schema()
Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
PLANT = "00000000-0000-0000-0000-0000000000a1"
ADMIN = {"sub": "nverify-qct040-admin", "role": "Admin"}


def _draft_payload(marker: str, **fields) -> SpecCreate:
    return SpecCreate(
        customer_name=marker,
        customer_name_snapshot=marker,
        tube_size_id=uuid.uuid4(),
        mandrel_id=uuid.uuid4(),
        required_cs=100.0,
        target_tube_weight=250.0,
        id_min_mm=76.0,
        id_max_mm=78.0,
        od_min_mm=90.0,
        od_max_mm=92.0,
        length_min_mm=150.0,
        length_max_mm=154.0,
        weight_min_g=240.0,
        weight_max_g=260.0,
        cs_min_n=90.0,
        cs_max_n=110.0,
        **fields,
    )


def _complete_bounds(*, winding_height_min=None, winding_specimen=None, process_specimen=None, notching_applicable=False):
    winding_height = {"code": "height", "unit": "mm", "required": True}
    if winding_height_min is not None:
        winding_height["min"] = winding_height_min
        winding_height["max"] = winding_height_min + 4
    if winding_specimen:
        winding_height["specimen"] = winding_specimen
    return {
        "notching_applicable": notching_applicable,
        "stages": {
            "WINDER": {
                "parameters": [
                    {"code": "id", "min": 76.0, "max": 78.0, "unit": "mm", "required": True},
                    {"code": "od", "min": 90.0, "max": 92.0, "unit": "mm", "required": True},
                    winding_height,
                    {"code": "weight", "min": 240.0, "max": 260.0, "unit": "g", "required": True, "specimen": winding_specimen},
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
                    {"code": "height", "min": 150.0, "max": 154.0, "unit": "mm", "required": True, "specimen": process_specimen},
                    {"code": "weight", "min": 240.0, "max": 260.0, "unit": "g", "required": True, "specimen": process_specimen},
                    {"code": "cs", "min": 90.0, "max": 110.0, "unit": "N", "required": True},
                    {"code": "notch_distance", "min": 0, "max": 0, "applicable": notching_applicable is not False},
                    {"code": "notch_depth", "min": 0, "max": 0, "applicable": notching_applicable is not False},
                    {"code": "moisture", "min": 1.0, "max": 9.0, "unit": "%", "required": True},
                ]
            },
        },
    }


def test_qct040_exact_client_names_survive_ui_save_read():
    marker = f"QCT040-{uuid.uuid4()}"
    dictionary = get_qc_parameter_dictionary(current_user=ADMIN)
    assert dictionary["client_labels"]["WINDER"] == list(EXACT_STAGE_LABELS["WINDER"])
    assert dictionary["client_labels"]["OVEN"] == list(EXACT_STAGE_LABELS["OVEN"])
    assert dictionary["client_labels"]["PROCESS"] == list(EXACT_STAGE_LABELS["PROCESS"])
    db = Session()
    try:
        created = create_spec(_draft_payload(marker), db=db, plant_id=PLANT, current_user=ADMIN)
        spec_id = created["id"] if isinstance(created, dict) else created.id
        saved = upsert_spec_qc_profile(
            spec_id,
            QcProfileUpdate(
                qc_profile={
                    "status": "draft",
                    "stages": {
                        "WINDER": {
                            "parameters": [
                                {"code": "id", "label": "Inner Diameter", "min": 76.0, "max": 78.0, "unit": "mm"},
                                {"code": "od", "label": "OD", "min": 90.0, "max": 92.0, "unit": "mm"},
                                {"code": "height", "label": "Length", "min": 118.0, "max": 122.0, "unit": "mm"},
                                {"code": "weight", "label": "Mass", "min": 240.0, "max": 260.0, "unit": "g"},
                                {"code": "cs", "label": "CS", "min": 90.0, "max": 110.0, "unit": "N"},
                            ]
                        }
                    },
                },
                status="draft",
            ),
            db=db,
            plant_id=PLANT,
            current_user=ADMIN,
        )
        stages = saved["qc_profile"]["stages"]
        for stage, expected in EXACT_STAGE_LABELS.items():
            labels = [row["label"] for row in stages[stage]["parameters"]]
            codes = [row["code"] for row in stages[stage]["parameters"]]
            assert tuple(labels) == expected
            assert GENERIC_FORBIDDEN_LABELS.isdisjoint(labels)
            if stage == "WINDER":
                assert codes == ["id", "od", "height", "weight", "cs"]
            if stage == "OVEN":
                assert codes == ["pre_weight", "post_weight", "pre_moisture", "post_moisture"]
            if stage == "PROCESS":
                assert codes == ["height", "weight", "cs", "notch_distance", "notch_depth", "moisture"]
        db.expire_all()
        stored = db.query(SpecificationSheet).filter(SpecificationSheet.id == spec_id).one()
        stored_labels = [row["label"] for row in stored.qc_profile["stages"]["WINDER"]["parameters"]]
        assert "I.D." in stored_labels
        assert "Height" in stored_labels
        assert "Inner Diameter" not in stored_labels
        assert "Length" not in stored_labels
    finally:
        db.close()


def test_qct041_not_applicable_and_unknown_changed_require_review():
    marker = f"QCT041-{uuid.uuid4()}"
    db = Session()
    try:
        created = create_spec(_draft_payload(f"{marker}-na"), db=db, plant_id=PLANT, current_user=ADMIN)
        spec_id = created["id"] if isinstance(created, dict) else created.id
        saved = upsert_spec_qc_profile(
            spec_id,
            QcProfileUpdate(
                qc_profile=_complete_bounds(
                    winding_height_min=100.0,
                    winding_specimen="winding caliper",
                    process_specimen="finished tube",
                    notching_applicable=False,
                ),
                status="complete",
            ),
            db=db,
            plant_id=PLANT,
            current_user=ADMIN,
        )
        distance = next(row for row in saved["qc_profile"]["stages"]["PROCESS"]["parameters"] if row["code"] == "notch_distance")
        depth = next(row for row in saved["qc_profile"]["stages"]["PROCESS"]["parameters"] if row["code"] == "notch_depth")
        assert distance["applicable"] is False
        assert distance["applicability_label"] == NOT_APPLICABLE_LABEL
        assert distance["min"] is None
        assert distance["max"] is None
        assert depth["min"] is None
        assert saved["qc_profile"].get("notching_review_required") is False
        approved = approve_spec_qc_profile(
            spec_id,
            QcProfileApprovePayload(expected_revision=int(saved["qc_profile"]["revision"])),
            db=db,
            plant_id=PLANT,
            current_user=ADMIN,
        )
        assert approved["qc_profile"]["status"] == "approved"
        shown = next(row for row in approved["qc_profile"]["stages"]["PROCESS"]["parameters"] if row["code"] == "notch_distance")
        assert shown["applicability_label"] == NOT_APPLICABLE_LABEL
        assert shown["min"] is None

        unknown = create_spec(_draft_payload(f"{marker}-unknown"), db=db, plant_id=PLANT, current_user=ADMIN)
        unknown_id = unknown["id"] if isinstance(unknown, dict) else unknown.id
        with pytest.raises(HTTPException) as complete_unknown:
            upsert_spec_qc_profile(
                unknown_id,
                QcProfileUpdate(
                    qc_profile={
                        "status": "complete",
                        "stages": {
                            "WINDER": {"parameters": [{"code": "height", "min": 118, "max": 122, "unit": "mm"}]}
                        },
                    },
                    status="complete",
                ),
                db=db,
                plant_id=PLANT,
                current_user=ADMIN,
            )
        assert complete_unknown.value.status_code == 400
        assert complete_unknown.value.detail["code"] == "NOTCHING_REVIEW_REQUIRED"
        drafted = upsert_spec_qc_profile(
            unknown_id,
            QcProfileUpdate(
                qc_profile={
                    "status": "draft",
                    "stages": {
                        "WINDER": {"parameters": [{"code": "height", "min": 118, "max": 122, "unit": "mm"}]}
                    },
                },
                status="draft",
            ),
            db=db,
            plant_id=PLANT,
            current_user=ADMIN,
        )
        notch = next(row for row in drafted["qc_profile"]["stages"]["PROCESS"]["parameters"] if row["code"] == "notch_distance")
        assert drafted["qc_profile"]["notching_review_required"] is True
        assert notch["applicable"] is None
        assert notch["min"] is None
        assert notch["max"] is None
        assert notch.get("applicability_label") != NOT_APPLICABLE_LABEL

        changed = update_spec(
            spec_id,
            SpecUpdate(
                profile={"notch_tooling": {"notch_type": "V-notch"}},
                expected_revision=approved["write_revision"],
            ),
            db=db,
            plant_id=PLANT,
            current_user=ADMIN,
        )
        assert changed["qc_profile"]["notching_review_required"] is True
        still_na = next(row for row in changed["qc_profile"]["stages"]["PROCESS"]["parameters"] if row["code"] == "notch_distance")
        assert still_na["min"] is None
        assert still_na.get("applicability_label") == NOT_APPLICABLE_LABEL
        with pytest.raises(HTTPException) as reapprove:
            approve_spec_qc_profile(
                spec_id,
                QcProfileApprovePayload(expected_revision=int(changed["qc_profile"]["revision"])),
                db=db,
                plant_id=PLANT,
                current_user=ADMIN,
            )
        assert reapprove.value.status_code == 400
        assert reapprove.value.detail["code"] == "NOTCHING_REVIEW_REQUIRED"
    finally:
        db.close()


def test_qct042_stage_basis_not_copied_from_finals():
    marker = f"QCT042-{uuid.uuid4()}"
    db = Session()
    try:
        created = create_spec(_draft_payload(marker), db=db, plant_id=PLANT, current_user=ADMIN)
        spec_id = created["id"] if isinstance(created, dict) else created.id
        assert created["length_min_mm"] == 150.0
        winding = winding_parameter(created.get("qc_profile"), "height")
        assert winding is None or winding.get("min") in {None, ""}
        saved = upsert_spec_qc_profile(
            spec_id,
            QcProfileUpdate(
                qc_profile=_complete_bounds(
                    winding_height_min=None,
                    winding_specimen="winding caliper",
                    process_specimen="finished tube",
                    notching_applicable=False,
                ),
                status="draft",
            ),
            db=db,
            plant_id=PLANT,
            current_user=ADMIN,
        )
        winding_row = next(row for row in saved["qc_profile"]["stages"]["WINDER"]["parameters"] if row["code"] == "height")
        process_row = next(row for row in saved["qc_profile"]["stages"]["PROCESS"]["parameters"] if row["code"] == "height")
        winding_weight = next(row for row in saved["qc_profile"]["stages"]["WINDER"]["parameters"] if row["code"] == "weight")
        process_weight = next(row for row in saved["qc_profile"]["stages"]["PROCESS"]["parameters"] if row["code"] == "weight")
        assert winding_row["min"] is None
        assert winding_row["max"] is None
        assert process_row["min"] == 150.0
        assert winding_row["min"] != process_row["min"]
        assert winding_row["basis_hint"] == "Height at winding"
        assert process_row["basis_hint"] == "Finished height"
        assert winding_row["specimen"] == "winding caliper"
        assert process_row["specimen"] == "finished tube"
        assert winding_weight["specimen"] == "winding caliper"
        assert process_weight["specimen"] == "finished tube"
        assert winding_row["basis_hint"] != process_row["basis_hint"]
    finally:
        db.close()
