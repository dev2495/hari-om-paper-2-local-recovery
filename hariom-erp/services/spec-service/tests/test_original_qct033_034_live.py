"""QCT-033/034: save-key replay/conflict and stale revision on nverify specdb."""
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
from src.routers.specs import QcProfileUpdate, SpecCreate, create_spec, upsert_spec_qc_profile

ensure_runtime_schema()
Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
PLANT = "00000000-0000-0000-0000-0000000000a1"


def _draft_payload(marker: str, *, key: str, id_min: float = 76.0, tube_size_id=None, mandrel_id=None) -> SpecCreate:
    return SpecCreate(
        customer_name=marker,
        customer_name_snapshot=marker,
        tube_size_id=tube_size_id or uuid.uuid4(),
        mandrel_id=mandrel_id or uuid.uuid4(),
        required_cs=100.0,
        target_tube_weight=250.0,
        save_operation_key=key,
        qc_profile={
            "status": "draft",
            "stages": {
                "WINDER": {
                    "parameters": [{"code": "id", "min": id_min, "max": 78.0, "unit": "mm"}]
                }
            },
        },
    )


def test_qct033_matching_replay_returns_original_changed_payload_conflicts():
    marker = f"QCT033-{uuid.uuid4()}"
    key = f"save-{uuid.uuid4()}"
    tube_size_id = uuid.uuid4()
    mandrel_id = uuid.uuid4()
    original = _draft_payload(marker, key=key, id_min=76.0, tube_size_id=tube_size_id, mandrel_id=mandrel_id)
    db = Session()
    try:
        first = create_spec(
            original,
            db=db,
            plant_id=PLANT,
            current_user={"sub": "nverify-qct033", "role": "Admin"},
        )
        first_id = first["id"] if isinstance(first, dict) else first.id
        replay = create_spec(
            _draft_payload(marker, key=key, id_min=76.0, tube_size_id=tube_size_id, mandrel_id=mandrel_id),
            db=db,
            plant_id=PLANT,
            current_user={"sub": "nverify-qct033", "role": "Admin"},
        )
        replay_id = replay["id"] if isinstance(replay, dict) else replay.id
        assert str(replay_id) == str(first_id)
        with pytest.raises(HTTPException) as conflict:
            create_spec(
                _draft_payload(marker, key=key, id_min=74.0, tube_size_id=tube_size_id, mandrel_id=mandrel_id),
                db=db,
                plant_id=PLANT,
                current_user={"sub": "nverify-qct033", "role": "Admin"},
            )
        assert conflict.value.status_code == 409
        detail = conflict.value.detail
        assert isinstance(detail, dict)
        assert detail.get("code") == "SAVE_KEY_CONFLICT"
        assert str(detail.get("spec_id")) == str(first_id)
        rows = db.query(SpecificationSheet).filter(SpecificationSheet.customer_name == marker).all()
        assert len(rows) == 1
        id_row = next(row for row in (rows[0].qc_profile or {}).get("stages", {}).get("WINDER", {}).get("parameters", []) if row.get("code") == "id")
        assert id_row.get("min") == 76.0
        assert rows[0].status != "approved"
    finally:
        db.close()


def test_qct034_stale_editor_cannot_overwrite_newer_revision():
    marker = f"QCT034-{uuid.uuid4()}"
    db = Session()
    try:
        created = create_spec(
            _draft_payload(marker, key=f"save-{uuid.uuid4()}", id_min=76.0),
            db=db,
            plant_id=PLANT,
            current_user={"sub": "nverify-qct034", "role": "Admin"},
        )
        spec_id = created["id"] if isinstance(created, dict) else created.id
        write_revision = created["write_revision"] if isinstance(created, dict) else created.write_revision
        assert int(write_revision) == 1
        first_save = upsert_spec_qc_profile(
            spec_id,
            QcProfileUpdate(
                qc_profile={
                    "status": "draft",
                    "stages": {"WINDER": {"parameters": [{"code": "id", "min": 76.4, "max": 78.0, "unit": "mm"}]}},
                },
                status="draft",
                save_operation_key=f"qc-{uuid.uuid4()}",
                expected_revision=1,
            ),
            db=db,
            plant_id=PLANT,
            current_user={"sub": "nverify-qct034", "role": "Admin"},
        )
        current = first_save["write_revision"] if isinstance(first_save, dict) else first_save.write_revision
        assert int(current) == 2
        with pytest.raises(HTTPException) as stale:
            upsert_spec_qc_profile(
                spec_id,
                QcProfileUpdate(
                    qc_profile={
                        "status": "draft",
                        "stages": {"WINDER": {"parameters": [{"code": "id", "min": 70.0, "max": 78.0, "unit": "mm"}]}},
                    },
                    status="draft",
                    save_operation_key=f"qc-{uuid.uuid4()}",
                    expected_revision=1,
                ),
                db=db,
                plant_id=PLANT,
                current_user={"sub": "nverify-qct034", "role": "Admin"},
            )
        assert stale.value.status_code == 409
        detail = stale.value.detail
        assert isinstance(detail, dict)
        assert detail.get("code") == "STALE_REVISION"
        assert int(detail.get("current_revision")) == 2
        db.expire_all()
        stored = db.query(SpecificationSheet).filter(SpecificationSheet.id == spec_id).one()
        id_row = next(row for row in (stored.qc_profile or {}).get("stages", {}).get("WINDER", {}).get("parameters", []) if row.get("code") == "id")
        assert id_row.get("min") == 76.4
        assert int(stored.write_revision or 1) == 2
    finally:
        db.close()
