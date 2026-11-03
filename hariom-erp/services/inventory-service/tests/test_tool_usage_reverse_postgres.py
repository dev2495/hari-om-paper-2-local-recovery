"""A reopened stage takes back the tool usage its close posted (3 Nov 2026): exact keys, plant-scoped, idempotent."""
import os
import uuid

import pytest

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

from src.database import Base, SessionLocal, engine
from src.main import ensure_runtime_schema
from src.models import InventoryLocation, ToolAsset, ToolAssetAssignment
from src.routers.tool_assets import ToolUsage, ToolUsageReversal, record_tool_usage, reverse_tool_usage

ACTOR = {"sub": "worker@example.com", "roles": ["Owner"], "role": "Owner", "token": ""}


def setup_module() -> None:
    Base.metadata.create_all(engine)
    ensure_runtime_schema()


def _issued_tool(db, plant, card, stage="WINDING"):
    rack = InventoryLocation(plant_id=plant, code=f"T-{uuid.uuid4().hex[:5]}", name="Tool rack", warehouse="TOOLS", purpose="STORAGE", active="true")
    db.add(rack)
    db.flush()
    asset = ToolAsset(asset_no=f"TA-{uuid.uuid4().hex[:6]}", qr_value=f"QR-{uuid.uuid4().hex[:8]}", tool_definition_id=uuid.uuid4(), category="MANDREL",
                      definition_name="Mandrel 76", status="ISSUED", location_id=rack.id, plant_id=plant, current_job_card_id=card)
    db.add(asset)
    db.flush()
    db.add(ToolAssetAssignment(asset_id=asset.id, job_card_id=card, stage_type=stage, status="OPEN"))
    db.commit()
    return asset


def test_reopen_reverses_exactly_the_posted_usage_once_and_only_in_its_plant():
    plant, other, card = str(uuid.uuid4()), str(uuid.uuid4()), f"JC-{uuid.uuid4().hex[:6]}"
    with SessionLocal() as db:
        asset = _issued_tool(db, plant, card)
        record_tool_usage(str(asset.id), ToolUsage(job_card_id=card, stage_type="WINDING", good_qty=900, scrap_qty=12, usage_key=f"{card}:s1:1"), db, plant, ACTOR)
        db.refresh(asset)
        assert (asset.usage_count, asset.produced_qty, asset.scrap_qty) == (1, 900, 12)

        undo = ToolUsageReversal(job_card_id=card, stage_type="winding", usage_keys=[f"{card}:s1:1"], reversal_key="rev-1", reason="Stage reopened")
        assert reverse_tool_usage(undo, db, other, ACTOR)["count"] == 0, "another plant's reversal touches nothing"
        assert reverse_tool_usage(undo, db, plant, ACTOR)["reversed"] == [f"{card}:s1:1"]
        db.refresh(asset)
        assert (asset.usage_count, asset.produced_qty, asset.scrap_qty) == (0, 0, 0)
        assert reverse_tool_usage(undo, db, plant, ACTOR)["count"] == 0, "a retry finds nothing left to reverse"

        # The re-close posts again under its new key.
        record_tool_usage(str(asset.id), ToolUsage(job_card_id=card, stage_type="WINDING", good_qty=850, usage_key=f"{card}:s1:2"), db, plant, ACTOR)
        db.refresh(asset)
        assert (asset.usage_count, asset.produced_qty) == (1, 850)
