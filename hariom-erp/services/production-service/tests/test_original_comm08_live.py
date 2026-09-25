"""Original COMM-08 live job snapshot: ordered parchment conflicts, recipe stays."""
from __future__ import annotations

import json
import os
import uuid
from datetime import date
from pathlib import Path

import pytest

URL = os.environ.get("HARI_OM_PRODUCTION_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or not ("hariom_nverify" in URL or ("@127.0.0.1:5432/hariom_" in URL and "_integration_" in URL)):
    pytest.skip("Requires isolated hariom_nverify production Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from sqlalchemy.orm import sessionmaker

from src.database import Base, engine
from src.models import JobCard, PLANT_A_UUID, SalesOrder
from src.routers.planning import _apply_commercial_parchment, _build_document_snapshot

Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
REPORTS = Path(__file__).resolve().parents[4] / "reports"


def setup_module() -> None:
    Base.metadata.create_all(engine)


def _conflict_snapshot() -> dict:
    snapshot = {
        "id_min_mm": 109.5,
        "id_max_mm": 110.5,
        "od_min_mm": 123.5,
        "od_max_mm": 124.5,
        "length_min_mm": 114.0,
        "length_max_mm": 116.0,
        "weight_min_g": 220.0,
        "weight_max_g": 240.0,
        "cs_min_n": 430.0,
        "cs_max_n": 470.0,
        "moisture_min_pct": 6.0,
        "moisture_max_pct": 10.0,
        "bamboo_max_length": 1560,
        "cut_loss_mm": 40,
        "parchment_color": "Natural · Stripe",
        "parchment_allowed": True,
        "product_code": "COMM08-LIVE",
    }
    return _apply_commercial_parchment(
        snapshot,
        {"parchment_required": True, "parchment_color": "Blue · Floral"},
    )


def test_comm08_live_order_snapshot_keeps_recipe_and_records_conflict():
    db = Session()
    try:
        snapshot = _conflict_snapshot()
        assert snapshot["parchment_resolution"] == "CONFLICT"
        assert snapshot["parchment_color"] == "Natural · Stripe"
        assert snapshot["sales_order_line_parchment_color"] == "Blue · Floral"
        order = SalesOrder(
            plant_id=PLANT_A_UUID,
            customer_id=uuid.uuid4(),
            spec_id=uuid.uuid4(),
            order_qty=12,
            due_date=date.today(),
        )
        db.add(order)
        db.flush()
        job = JobCard(
            plant_id=PLANT_A_UUID,
            sales_order_id=order.id,
            spec_id=order.spec_id,
            spec_snapshot=snapshot,
            planned_qty=12,
            released_qty=12,
            status="PLANNED",
            current_stage="WINDER",
            product_code="COMM08-LIVE",
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        document = _build_document_snapshot(
            job_card=job,
            sales_order=order,
            spec_snapshot=dict(job.spec_snapshot or {}),
            stages=[],
            snapshot_mode="stored",
        )
        header = document["header"]
        assert header["parchment_resolution"] == "CONFLICT"
        assert header["approved_parchment_color"] == "Natural · Stripe"
        assert header["ordered_parchment_color"] == "Blue · Floral"
        assert "Natural" in str(header.get("color") or header.get("parchment_paper") or "")
        assert job.spec_snapshot["parchment_color"] == "Natural · Stripe"
        REPORTS.mkdir(parents=True, exist_ok=True)
        (REPORTS / "comm08_job.json").write_text(
            json.dumps({"job_card_id": str(job.id), "plant_id": str(job.plant_id)}),
            encoding="utf-8",
        )
    finally:
        db.close()
