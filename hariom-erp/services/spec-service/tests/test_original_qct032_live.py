"""QCT-032: injected commit failure while saving spec + QC draft on nverify."""
from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

URL = os.environ.get("HARI_OM_SPEC_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or "hariom_nverify" not in URL:
    pytest.skip("Requires isolated hariom_nverify spec Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from src.database import engine
from src.models import SpecificationSheet
from src.qc_profile import profile_status
from src.routers.specs import SpecCreate, create_spec

Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
PLANT = "00000000-0000-0000-0000-0000000000a1"


def test_qct032_injected_db_failure_rolls_back_spec_and_qc_draft():
    marker = f"QCT032-{uuid.uuid4()}"
    db = Session()
    try:
        assert db.query(SpecificationSheet).filter(SpecificationSheet.customer_name == marker).count() == 0

        def boom(*_args, **_kwargs):
            raise OperationalError("injected QCT-032 commit failure", None, None)

        db.commit = boom  # type: ignore[method-assign]
        payload = SpecCreate(
            customer_name=marker,
            customer_name_snapshot=marker,
            tube_size_id=uuid.uuid4(),
            mandrel_id=uuid.uuid4(),
            required_cs=100.0,
            target_tube_weight=250.0,
            qc_profile={
                "status": "draft",
                "stages": {
                    "WINDER": {
                        "parameters": [{"code": "id", "min": 76.0, "max": 78.0, "unit": "mm"}]
                    }
                },
            },
        )
        with pytest.raises(OperationalError, match="injected QCT-032"):
            create_spec(
                payload,
                db=db,
                plant_id=PLANT,
                current_user={"sub": "nverify-qct032", "role": "Admin"},
            )
        db.rollback()
    finally:
        db.close()

    verify = Session()
    try:
        rows = verify.query(SpecificationSheet).filter(SpecificationSheet.customer_name == marker).all()
        assert rows == []
        leftover_approved = (
            verify.query(SpecificationSheet)
            .filter(SpecificationSheet.customer_name == marker)
            .filter(SpecificationSheet.status == "approved")
            .all()
        )
        assert leftover_approved == []
        assert profile_status(None) == "missing"
    finally:
        verify.close()
