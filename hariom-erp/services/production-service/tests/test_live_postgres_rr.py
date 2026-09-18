"""Live production QC sample persistence, hold flag ignore, and 501+ export."""
from __future__ import annotations

import asyncio
import os
import uuid
from datetime import date, datetime

import pytest

URL = os.environ.get("HARI_OM_PRODUCTION_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or "hariom_nverify" not in URL:
    pytest.skip("Requires isolated hariom_nverify production Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from sqlalchemy.orm import sessionmaker

from src.database import Base, engine
from src.models import JobCard, JobCardStage, PLANT_A_UUID, QualityHold, QualityInspection, SalesOrder
from src.routers.planning import _sync_quality_artifacts, export_job_cards
from src.routers.quality import InspectionCreate, create_inspection


Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
QC_PROFILE = {
    "status": "approved",
    "revision": 1,
    "WINDER": {
        "parameters": [
            {"code": "id", "min": 50, "max": 55, "unit": "mm", "required": True},
            {"code": "od", "min": 100, "max": 110, "unit": "mm", "required": True},
            {"code": "height", "min": 145, "max": 155, "unit": "mm", "required": True},
            {"code": "weight", "min": 300, "max": 340, "unit": "g", "required": True},
            {"code": "cs", "min": 450, "max": 550, "unit": "N", "required": True},
        ]
    },
}
BOUNDS = {
    "id_min_mm": 50,
    "id_max_mm": 55,
    "od_min_mm": 100,
    "od_max_mm": 110,
    "length_min_mm": 145,
    "length_max_mm": 155,
    "weight_min_g": 300,
    "weight_max_g": 340,
    "cs_min_n": 450,
    "cs_max_n": 550,
    "qc_profile": QC_PROFILE,
}


def setup_module() -> None:
    Base.metadata.create_all(engine)


def _job(db, suffix: str) -> JobCard:
    order = SalesOrder(
        plant_id=PLANT_A_UUID,
        customer_id=uuid.uuid4(),
        spec_id=uuid.uuid4(),
        order_qty=10,
        due_date=date.today(),
    )
    db.add(order)
    db.flush()
    job = JobCard(
        plant_id=PLANT_A_UUID,
        sales_order_id=order.id,
        spec_id=order.spec_id,
        spec_snapshot=BOUNDS,
        planned_qty=10,
        released_qty=10,
        status="IN_PROGRESS",
        current_stage="WINDER",
        product_code=f"NV-{suffix}",
    )
    db.add(job)
    db.flush()
    return job


def test_every_winding_sample_persists_and_later_fail_matters():
    db = Session()
    try:
        job = _job(db, uuid.uuid4().hex[:6])
        stage = JobCardStage(
            job_card_id=job.id,
            stage_type="WINDER",
            status="RUNNING",
            quality_checks={
                "samples": [
                    {"sample_id": "S1", "readings": {"id": 52, "od": 105, "height": 150, "weight": 320, "cs": 500}},
                    {"sample_id": "S2", "readings": {"id": 52, "od": 130, "height": 150, "weight": 320, "cs": 500}},
                    {"sample_id": "S3", "readings": {"id": 52, "od": 105, "height": 150, "weight": 320, "cs": 500}},
                ]
            },
        )
        db.add(stage)
        db.flush()
        holds = _sync_quality_artifacts(
            db=db,
            plant_id=PLANT_A_UUID,
            job_card=job,
            stage=stage,
            selected_stage="WINDER",
            current_user={"sub": "qc-1", "roles": ["QC"]},
        )
        db.commit()
        rows = db.query(QualityInspection).filter(QualityInspection.job_card_id == job.id).all()
        sample_ids = sorted(str(row.sample_id) for row in rows)
        assert sample_ids == ["S1", "S2", "S3"]
        failed = [row for row in rows if row.status == "FAIL"]
        assert len(failed) == 1
        assert failed[0].sample_id == "S2"
        assert holds
        assert any(hold.source_inspection_id == failed[0].id for hold in holds)
    finally:
        db.close()


def test_client_hold_flag_ignored_and_fail_without_reason_persists():
    db = Session()
    try:
        job = _job(db, uuid.uuid4().hex[:6])
        db.commit()
        payload = InspectionCreate(
            job_card_id=job.id,
            stage_type="WINDER",
            readings={"id": 52, "od": 130, "height": 150, "weight": 320, "cs": 500},
            reasons={},
            sample_id="S-FAIL",
            create_hold_on_fail=False,
            final_submission=False,
        )
        response = create_inspection(
            payload,
            db=db,
            plant_id=str(PLANT_A_UUID),
            current_user={"sub": "qc-1", "roles": ["QC"]},
        )
        assert response.status == "FAIL"
        assert response.reason_pending or (response.evaluation or {}).get("workflow_status") == "REASON_PENDING"
        assert response.hold_id is not None
        hold = db.query(QualityHold).filter(QualityHold.id == response.hold_id).one()
        assert hold.status == "HOLD"
        stored = db.query(QualityInspection).filter(QualityInspection.id == response.id).one()
        assert stored.status == "FAIL"
        assert stored.readings["od"] == 130
    finally:
        db.close()


def test_export_includes_more_than_500_job_cards():
    db = Session()
    try:
        suffix = uuid.uuid4().hex[:6]
        for index in range(501):
            _job(db, f"{suffix}-{index}")
        db.commit()
        plant_scope = {
            "scope_all": False,
            "selected_plant_id": str(PLANT_A_UUID),
            "allowed_plants": [str(PLANT_A_UUID)],
        }
        response = export_job_cards(
            search=None,
            status=None,
            current_stage=None,
            stage=None,
            due_risk=None,
            db=db,
            plant_scope=plant_scope,
            current_user={"sub": "admin", "roles": ["Admin"]},
        )
        payload = b""
        iterator = getattr(response, "body_iterator", None)
        if hasattr(iterator, "getvalue"):
            text = iterator.getvalue()
        elif hasattr(iterator, "read"):
            raw = iterator.read()
            text = raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else str(raw)
        else:
            try:
                chunks = list(iterator)
            except TypeError:
                async def _collect():
                    parts = []
                    async for chunk in iterator:
                        parts.append(chunk)
                    return parts

                chunks = asyncio.run(_collect())
            decoded = []
            for chunk in chunks:
                decoded.append(chunk.decode("utf-8") if isinstance(chunk, (bytes, bytearray)) else str(chunk))
            text = "".join(decoded)
        assert text.count("\n") >= 501
    finally:
        db.close()
