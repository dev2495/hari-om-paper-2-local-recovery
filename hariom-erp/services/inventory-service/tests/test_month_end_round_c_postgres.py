"""Month-end fixes after the first build's last check (part C, 30 Oct 2026), live PostgreSQL: a plant
head reads every plant in their scope, the after-count check reads only items entered after the count,
and the month-end drawer names a supplier return by its own reference and the rack by its name."""
import os
import uuid
from datetime import date

import pytest
from fastapi import HTTPException

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

from src.main import ensure_runtime_schema, ensure_stock_count_and_schedule_schema
from src.database import Base, SessionLocal, engine
from src.models import InventoryQualityInspection
from src.routers import stock_control as stock_control_router
from src.routers.quality import SupplierReturnCreate, return_rejected_lot_to_supplier
from src.routers.stock_control import month_figure_sources, month_figures
from src.routers.stock_count import CountCreate, NotePayload, ScanPayload, approve_count, finish_rack, scan_in_count, start_count, submit_count
from src.services.books import ist_today, month_key
from src.utils.auth import _resolve_scope

from test_stock_count_flow_postgres import OWNER, STORE, _item, _lot, _rack, _reel


def setup_module() -> None:
    Base.metadata.create_all(engine)
    ensure_runtime_schema()
    ensure_stock_count_and_schedule_schema()


def test_a_plant_head_uses_every_plant_in_their_scope_and_no_other():
    home, second, other = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    head = {"sub": "pm@example.com", "roles": ["PlantManager"], "plant_id": home, "allowed_plants": [home, second]}
    assert _resolve_scope(current_user=head, requested_plant_id=second)["selected_plant_id"] == second
    assert _resolve_scope(current_user=head, requested_plant_id=None)["selected_plant_id"] == home
    with pytest.raises(HTTPException) as refused:
        _resolve_scope(current_user=head, requested_plant_id=other)
    assert refused.value.status_code == 403
    # A token with only its home plant keeps the old rule.
    single = {"sub": "store@example.com", "roles": ["Store"], "plant_id": home, "allowed_plants": []}
    with pytest.raises(HTTPException):
        _resolve_scope(current_user=single, requested_plant_id=second)


def test_the_after_count_check_reads_only_items_entered_after_the_approval(monkeypatch):
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant)
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        rack = _rack(db, plant, "RM-ME-01")
        reel = _reel(db, plant, paper, 600, at=rack, inward=date(2026, 8, 5))
        _lot(db, plant, glue, 20, at=rack, day=date(2026, 8, 6))
        db.commit()
        count = start_count(CountCreate(kind="MONTH_END", month="2026-08"), db, plant, STORE)
        cid = uuid.UUID(count["id"])
        scan_in_count(ScanPayload(rack=str(rack.id), code=reel.reel_code, counted_qty=600, client_ref="me-c-1"), cid, db, plant, STORE)
        finish_rack(cid, str(rack.id), db, plant, STORE)
        finish_rack(cid, "unassigned", db, plant, STORE)
        submit_count(NotePayload(), cid, db, plant, STORE)
        approve_count(NotePayload(), cid, db, plant, OWNER)

        seen: list[list[str]] = []
        real = stock_control_router.changes_after_count

        def spy(db_, plant_, count_, *, items=None, own_docs=None):
            seen.append(sorted(items or {}))
            return real(db_, plant_, count_, items=items, own_docs=own_docs)

        monkeypatch.setattr(stock_control_router, "changes_after_count", spy)
        # Nothing entered since the approval (beyond the count's own posting): no second book read.
        august = month_figures("2026-08", db, plant, OWNER)
        assert august["month_end_count"]["changed_after_count"] is False
        assert all(set(items) <= {str(paper.id)} for items in seen)
        seen.clear()

        # A back-dated glue GRN entered now: only glue is read again, and it is flagged.
        _lot(db, plant, glue, 10, at=rack, day=date(2026, 8, 25))
        db.commit()
        august = month_figures("2026-08", db, plant, OWNER)
        assert seen and all(items == [str(glue.id)] for items in seen)
        assert [(row["item_code"], row["qty"]) for row in august["month_end_count"]["changed_items"]] == [(glue.item_code, 10.0)]


def test_the_drawer_names_a_supplier_return_by_its_reference_and_the_rack_by_its_name():
    plant = str(uuid.uuid4())
    today = ist_today()
    with SessionLocal() as db:
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        rack = _rack(db, plant, "RM-STORE")
        lot = _lot(db, plant, glue, 40, at=rack, status="QC_HOLD", day=today)
        db.add(InventoryQualityInspection(plant_id=plant, entity_type="BATCH", entity_id=lot.id, material_type="ADHESIVE",
                                          status="FAIL", disposition="REJECT"))
        db.commit()
        return_rejected_lot_to_supplier(SupplierReturnCreate(entity_type="BATCH", entity_id=lot.id, reason="Wrong viscosity",
                                                             return_reference="RTV-ME-1"), db, plant, OWNER)
        sources = month_figure_sources(glue.id, month_key(today), db, plant, OWNER)
        sent_back = [row for row in sources["rows"] if row["kind"] == "SENT_BACK"]
        assert [row["doc"] for row in sent_back] == ["RTV-ME-1"]
        assert all(row["location_name"] == "Rack RM-STORE" for row in sources["rows"] if row.get("location_id"))
