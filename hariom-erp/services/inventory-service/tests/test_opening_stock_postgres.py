"""Go-live opening stock (client 2026-10-30, part C3), live PostgreSQL.

Batches on the go-live date until that month is closed, new numbers dated the go-live date, cleared
stock accepted by the issue desks without incoming QC, holds respected, month figures "opening_loads",
one post per request key, and Owner / Admin only on the server.
"""
import os
import uuid
from datetime import date

import pytest
from fastapi import HTTPException

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

from src.main import ensure_runtime_schema, ensure_stock_count_and_schedule_schema
from src.database import Base, SessionLocal, engine
from src.models import InventoryLocation, ItemMaster, PaperReel, StockBatch, StockTransaction
from src.routers.books import BooksLockPayload, lock_books_month
from src.routers.issue import IssueCreate, create_issue
from src.routers import opening_stock as opening_router, stock_control as stock_router
from src.routers.opening_stock import PreviewLine, PreviewPayload, get_opening_stock, opening_load_labels, preview_opening_load
from src.routers.reel_issues import ReelIssueCreate, create_reel_issue
from src.routers.stock_control import OpeningLoadPayload, create_opening_load, list_opening_loads, month_figures
from src.services.opening_stock import OPENING_CLOSED

OWNER = {"sub": "owner@example.com", "roles": ["Owner"], "actual_roles": ["Owner"], "role": "Owner", "token": ""}
ADMIN = {"sub": "admin@example.com", "roles": ["Admin"], "actual_roles": ["Admin"], "role": "Admin", "token": ""}
STORE = {"sub": "store@example.com", "roles": ["Store"], "actual_roles": ["Store"], "role": "Store", "token": ""}
GO_LIVE = date(2026, 10, 28)


def setup_module() -> None:
    Base.metadata.create_all(engine)
    ensure_runtime_schema()
    ensure_stock_count_and_schedule_schema()


def _item(db, plant, kind="RAW_PAPER", *, tracking="REEL", uom="KG", cost=None, code=None):
    item = ItemMaster(item_code=code or f"{kind[:4]}-{uuid.uuid4().hex[:6]}", name=f"{kind.title()} opening test", type=kind,
                      tracking_mode=tracking, uom=uom, plant_id=plant, active="true", unit_cost=cost)
    db.add(item)
    db.commit()
    return item


def _rack(db, plant, code="RACK-A1"):
    rack = InventoryLocation(plant_id=plant, code=code, name=f"Rack {code}", warehouse="RM", purpose="STORAGE", active="true")
    db.add(rack)
    db.commit()
    return rack


def _post(db, plant, lines, *, day=GO_LIVE, who=OWNER, key=None):
    payload = OpeningLoadPayload(effective_date=day, request_id=key or uuid.uuid4(), notes="Go-live", lines=lines)
    return create_opening_load(payload, db, plant, who)


def _detail(error) -> str:
    detail = error.value.detail
    return detail["message"] if isinstance(detail, dict) else detail


def _scope(plant):
    return {"scope_all": False, "selected_plant_id": plant, "allowed_plants": [plant]}


def test_batches_on_the_go_live_date_new_numbers_labels_and_month_figures():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant, cost=42.0, code="KRAFT-120")
        glue = _item(db, plant, "ADHESIVE", tracking="BULK", uom="KG", code="GLUE-PVA")
        boxes = _item(db, plant, "PACKAGING", tracking="BULK", uom="PCS", cost=12.0, code="BOX-5PLY")
        rack = _rack(db, plant)

        assert get_opening_stock(db, plant, OWNER)["opening"]["state"] == "NOT_STARTED"
        first = _post(db, plant, [
            {"item_id": paper.id, "qty": 812.5, "old_mark": "OLD-77", "vendor_name": "Shree Mills", "location_id": rack.id},
            {"item_id": paper.id, "qty": 640, "kind": "REEL"},
            {"item_id": glue.id, "qty": 120, "unit_cost": 85},
        ])
        assert [line.get("reel_code") or line.get("batch_no") for line in first["lines"]] == [
            "AT-261028-001", "AT-261028-002", "RM-GLUE-PVA-261028-001"]
        # Stores enter rack by rack: a second batch on the same go-live date is fine.
        second = _post(db, plant, [
            {"item_id": paper.id, "qty": 700},
            {"item_id": boxes.id, "qty": 400, "on_hold": True, "hold_reason": "Damp corner, check before use"},
        ], who=ADMIN)
        assert second["lines"][0]["reel_code"] == "AT-261028-003"

        reel = db.query(PaperReel).filter_by(plant_id=uuid.UUID(plant), reel_code="AT-261028-001").one()
        assert reel.inward_date == GO_LIVE and reel.stock_status == "UNRESTRICTED" and reel.location_id == rack.id
        assert reel.source_reel_no == "OLD-77" and reel.supplier_name == "Shree Mills"
        assert reel.genealogy_metadata["source_document_type"] == "OPENING_LOAD"
        assert reel.inward_metadata["source_label"] == "Opening stock (28 Oct 2026)"
        unplaced = db.query(PaperReel).filter_by(plant_id=uuid.UUID(plant), reel_code="AT-261028-002").one()
        store = db.query(InventoryLocation).filter_by(plant_id=plant, is_receiving_default=True).one()
        assert unplaced.location_id == store.id and store.code == "RM-STORE"
        glue_lot = db.query(StockBatch).filter_by(plant_id=plant, batch_no="RM-GLUE-PVA-261028-001").one()
        txn = db.query(StockTransaction).filter_by(batch_id=glue_lot.id).one()
        assert txn.transaction_type.value == "OPENING" and txn.effective_date == GO_LIVE and txn.movement_metadata["source"] == "Opening load"
        held = db.query(StockBatch).filter_by(item_id=boxes.id).one()
        assert held.stock_status == "QC_HOLD" and held.inward_metadata["hold_reason"].startswith("Damp")

        overview = get_opening_stock(db, plant, OWNER)
        assert overview["opening"]["state"] == "OPEN" and overview["opening"]["go_live_date"] == "2026-10-28"
        assert [batch["batch_no"] for batch in overview["batches"]] == [2, 1]
        assert overview["totals"] == {"batches": 2, "reels": 3, "lots": 2, "held": 1,
                                      "units": [{"uom": "KG", "qty": 2272.5}, {"uom": "PCS", "qty": 400.0}],
                                      "value": round(812.5 * 42 + 640 * 42 + 120 * 85 + 700 * 42 + 400 * 12, 2)}
        assert get_opening_stock(db, plant, STORE)["can_post"] is False
        assert len(list_opening_loads(db, _scope(plant), OWNER)["items"]) == 2

        labels = opening_load_labels(uuid.UUID(first["id"]), db, plant, STORE)
        assert labels["batch_no"] == 1 and len(labels["labels"]) == 3
        label = labels["labels"][0]
        assert label["code"] == "AT-261028-001" and label["old_mark"] == "OLD-77" and label["created_at"] == "2026-10-28"
        assert label["qr_value"] == f"HARIOM|REEL|{plant}|{reel.id}|AT-261028-001" and label["location_code"] == "RACK-A1"

        figures = month_figures("2026-10", db, plant, OWNER)
        rows = {row["item_code"]: row for row in figures["items"]}
        assert rows["KRAFT-120"]["opening_loads"] == 2152.5 and rows["KRAFT-120"]["received"] == 2152.5
        assert rows["GLUE-PVA"]["opening_loads"] == 120.0 and rows["BOX-5PLY"]["opening_loads"] == 400.0
        assert rows["KRAFT-120"]["opening"] == 0.0 and rows["KRAFT-120"]["closing"] == 2152.5


def test_a_different_date_is_refused_and_the_first_date_cannot_be_in_the_future():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        with pytest.raises(HTTPException) as future:
            _post(db, plant, [{"item_id": glue.id, "qty": 5}], day=date(2099, 1, 1))
        assert future.value.status_code == 422
        db.rollback()
        _post(db, plant, [{"item_id": glue.id, "qty": 5}])
        with pytest.raises(HTTPException) as other:
            _post(db, plant, [{"item_id": glue.id, "qty": 5}], day=date(2026, 10, 29))
        assert other.value.status_code == 409 and other.value.detail["code"] == "GO_LIVE_DATE_FIXED"
        assert _detail(other) == "This plant went live on 28 Oct 2026. Opening stock can only be added on 28 Oct 2026, not on 29 Oct 2026."
        db.rollback()
        check = preview_opening_load(PreviewPayload(effective_date=date(2026, 10, 29), lines=[PreviewLine(item_id=str(glue.id), qty=5)]), db, plant, OWNER)
        assert check["date"]["ok"] is False and check["can_post"] is False


def test_opening_stock_is_closed_once_the_go_live_month_is_closed():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        _post(db, plant, [{"item_id": glue.id, "qty": 50}], day=date(2026, 9, 25))
        lock_books_month(BooksLockPayload(month="2026-09", note="Month-end close"), db, plant, OWNER)
        for day in (date(2026, 9, 25), date(2026, 10, 2)):
            with pytest.raises(HTTPException) as closed:
                _post(db, plant, [{"item_id": glue.id, "qty": 5}], day=day)
            assert closed.value.status_code == 409 and _detail(closed) == OPENING_CLOSED
            db.rollback()
        overview = get_opening_stock(db, plant, OWNER)
        assert overview["opening"]["state"] == "CLOSED" and overview["can_post"] is False


def test_cleared_stock_is_issued_without_incoming_qc_and_a_hold_is_respected():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant)
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        _post(db, plant, [
            {"item_id": paper.id, "qty": 500},
            {"item_id": paper.id, "qty": 450, "on_hold": True, "hold_reason": "Edge damage"},
            {"item_id": glue.id, "qty": 30, "on_hold": True, "hold_reason": "Lid open"},
        ])
        cleared = db.query(PaperReel).filter_by(paper_id=paper.id, stock_status="UNRESTRICTED").one()
        held = db.query(PaperReel).filter_by(paper_id=paper.id, stock_status="QC_HOLD").one()
        issued = create_reel_issue(ReelIssueCreate(reel_id=cleared.id, shift="A", issue_date=date(2026, 10, 30)), db, plant, STORE)
        assert issued.issued_weight_kg == 500
        with pytest.raises(HTTPException) as refused:
            create_reel_issue(ReelIssueCreate(reel_id=held.id, shift="A", issue_date=date(2026, 10, 30)), db, plant, STORE)
        assert refused.value.status_code == 400 and "not QC-approved" in refused.value.detail
        db.rollback()
        with pytest.raises(HTTPException) as no_glue:
            create_issue(IssueCreate(item_id=glue.id, qty=5, shift="A", effective_date=date(2026, 10, 30)), db, plant, STORE)
        assert no_glue.value.status_code == 400
        db.rollback()
        _post(db, plant, [{"item_id": glue.id, "qty": 20}])
        given = create_issue(IssueCreate(item_id=glue.id, qty=5, shift="A", effective_date=date(2026, 10, 30)), db, plant, STORE)
        assert given


def test_the_same_request_key_posts_once_and_rows_are_checked_all_or_nothing():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        paper = _item(db, plant)
        key = uuid.uuid4()
        first = _post(db, plant, [{"item_id": glue.id, "qty": 10}], key=key)
        again = _post(db, plant, [{"item_id": glue.id, "qty": 10}], key=key)
        assert again["idempotent"] is True and again["id"] == first["id"]
        assert db.query(StockBatch).filter_by(item_id=glue.id).count() == 1
        # A bad row refuses the whole batch: nothing of it is posted.
        with pytest.raises(HTTPException) as bad:
            _post(db, plant, [{"item_id": glue.id, "qty": 10}, {"item_id": glue.id, "qty": 3, "kind": "REEL"},
                              {"item_id": paper.id, "qty": 9, "on_hold": True}])
        assert bad.value.status_code == 422 and "Row 2" in _detail(bad) and "Row 3" in _detail(bad)
        db.rollback()
        assert db.query(StockBatch).filter_by(item_id=glue.id).count() == 1
        check = preview_opening_load(PreviewPayload(effective_date=GO_LIVE, lines=[
            PreviewLine(item_id=str(paper.id), qty=4200, old_mark="M1"), PreviewLine(item_id=str(paper.id), qty=0, old_mark="m1"),
            PreviewLine(item_id=str(glue.id), qty=2),
        ]), db, plant, OWNER)
        assert check["can_post"] is False and check["lines"][1]["errors"][0]["field"] == "qty"
        warnings = " ".join(check["lines"][0]["warnings"] + check["lines"][1]["warnings"])
        assert "very heavy" in warnings and "also on row 1" in warnings and "No rate" in warnings
        assert check["totals"]["units"] == [{"uom": "KG", "qty": 4202.0}]


def _dependency(path: str, method: str):
    routes = [*stock_router.router.routes, *opening_router.router.routes]
    route = next(route for route in routes if route.path == path and method in route.methods)
    return next(dep.call for dep in route.dependant.dependencies if dep.name == "current_user")


@pytest.mark.parametrize("path", ["/inventory/stock-control/opening-loads", "/inventory/stock-control/opening-loads/preview"])
def test_only_owner_and_admin_post_or_check(path):
    checker = _dependency(path, "POST")
    for who in (OWNER, ADMIN):
        assert checker(current_user=who) is who
    for role in ("Store", "PlantManager", "GRN", "RMIssue", "Planner"):
        with pytest.raises(HTTPException) as denied:
            checker(current_user={"sub": "x@example.com", "roles": [role]})
        assert denied.value.status_code == 403


def test_two_posts_with_the_same_key_in_flight_at_once_post_one_batch_and_both_answer():
    """A second tab or a retry on a slow network: the second post waits on the plant lock, then answers
    with the first batch (idempotent) instead of a duplicate-key error."""
    import threading
    import time

    from sqlalchemy import text

    from src.models import InventoryOpeningLoad

    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        glue_id = _item(db, plant, "ADHESIVE", tracking="BULK").id
    key = uuid.uuid4()
    gate = SessionLocal()
    gate.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"opening-stock:{plant}"})
    results = {}

    def run(name):
        with SessionLocal() as db:
            try:
                results[name] = ("ok", _post(db, plant, [{"item_id": glue_id, "qty": 10}], key=key)["idempotent"])
            except Exception as exc:  # noqa: BLE001 - the test reports whatever went wrong
                results[name] = ("error", type(exc).__name__, str(exc)[:200])

    threads = [threading.Thread(target=run, args=(name,)) for name in ("a", "b")]
    for thread in threads:
        thread.start()
    time.sleep(1.0)
    gate.commit()
    gate.close()
    for thread in threads:
        thread.join(30)
    assert sorted(results.values()) == [("ok", False), ("ok", True)], results
    with SessionLocal() as db:
        assert db.query(InventoryOpeningLoad).filter_by(plant_id=plant).count() == 1
        assert db.query(StockBatch).filter_by(item_id=glue_id).count() == 1


def test_review_totals_leave_out_rows_with_errors_and_the_floor_or_dispatch_is_refused():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant, cost=40.0)
        boxes = _item(db, plant, "PACKAGING", tracking="BULK", uom="PCS", cost=2.0)
        finished = _item(db, plant, "FINISHED_GOOD", tracking="BULK", uom="PCS")
        floor = InventoryLocation(plant_id=plant, code="FLOOR-1", name="Floor", warehouse="PROD", purpose="WIP", active="true")
        bay = InventoryLocation(plant_id=plant, code="DSP-1", name="Dispatch bay", warehouse="FG", purpose="DISPATCH", active="true")
        db.add_all([floor, bay])
        db.commit()
        check = preview_opening_load(PreviewPayload(effective_date=GO_LIVE, lines=[
            PreviewLine(item_id=str(paper.id), qty=550),                         # fine
            PreviewLine(item_id=str(paper.id), kind="BULK", qty=9000),           # wrong type
            PreviewLine(item_id=str(finished.id), qty=5),                        # not a raw material
            PreviewLine(item_id=str(boxes.id), qty=60000, location_id=str(floor.id)),
            PreviewLine(item_id=str(boxes.id), qty=105, location_id=str(bay.id)),
            PreviewLine(item_id=str(boxes.id), qty=150000),                      # fine, very large
        ]), db, plant, OWNER)
        assert [line["ok"] for line in check["lines"]] == [True, False, False, False, False, True]
        assert "production floor" in check["lines"][3]["errors"][0]["message"]
        assert "dispatch bay" in check["lines"][4]["errors"][0]["message"]
        totals = check["totals"]
        assert totals["reels"] == 1 and totals["lots"] == 1
        assert totals["units"] == [{"uom": "KG", "qty": 550.0}, {"uom": "PCS", "qty": 150000.0}]
        assert [row["item_id"] for row in totals["items"]] == [str(paper.id), str(boxes.id)]
        # The finished good is refused, so it gets no "No rate" warning and is not an item without a rate.
        assert totals["items_without_rate"] == 0 and check["lines"][2]["warnings"] == []
        # Indian digit grouping, like the totals beside it.
        assert check["lines"][5]["warnings"][0].startswith("1,50,000 pcs is a very large lot")
        with pytest.raises(HTTPException) as refused:
            _post(db, plant, [{"item_id": boxes.id, "qty": 10, "location_id": floor.id}])
        assert refused.value.status_code == 422 and "production floor" in _detail(refused)
        db.rollback()


def test_the_review_names_the_rm_store_the_rows_will_post_to():
    """An old receiving default that is a dispatch bay is never used: review and post agree on the RM store."""
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        db.add(InventoryLocation(plant_id=plant, code="DSP-OLD", name="Old dispatch default", warehouse="FG", purpose="DISPATCH",
                                 active="true", is_receiving_default=True))
        db.commit()
        rack = _rack(db, plant, "RACK-S1")
        check = preview_opening_load(PreviewPayload(effective_date=GO_LIVE, lines=[PreviewLine(item_id=str(glue.id), qty=5)]), db, plant, OWNER)
        assert check["lines"][0]["location"] is None or check["lines"][0]["location"]["code"] != "DSP-OLD"
        assert get_opening_stock(db, plant, OWNER)["default_location"] is None or get_opening_stock(db, plant, OWNER)["default_location"]["code"] != "DSP-OLD"
        posted = _post(db, plant, [{"item_id": glue.id, "qty": 5}])
        lot = db.query(StockBatch).filter_by(item_id=glue.id).one()
        assert lot.location_id != db.query(InventoryLocation).filter_by(plant_id=plant, code="DSP-OLD").one().id
        named = check["lines"][0]["location"]
        posted_code = db.query(InventoryLocation).filter_by(id=lot.location_id).one().code
        if named is not None:
            assert named["code"] == posted_code
        else:
            assert posted_code == "RM-STORE"
        assert posted["id"] and rack.code == "RACK-S1"


# ---------------------------------------------------------------- round 2 checks (30 Oct 2026)


def test_a_scrap_bay_is_refused_and_pieces_are_whole_numbers():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        boxes = _item(db, plant, "PACKAGING", tracking="BULK", uom="PCS", cost=2.0)
        paper = _item(db, plant, cost=40.0)
        scrap = InventoryLocation(plant_id=plant, code="CK-SCR", name="Scrap bay", warehouse="RM", purpose="SCRAP", active="true")
        db.add(scrap)
        db.commit()
        check = preview_opening_load(PreviewPayload(effective_date=GO_LIVE, lines=[
            PreviewLine(item_id=str(paper.id), qty=500, location_id=str(scrap.id)),
            PreviewLine(item_id=str(boxes.id), qty=10.5),
            PreviewLine(item_id=str(boxes.id), qty=0),
            PreviewLine(item_id=str(paper.id), qty=0),
            PreviewLine(item_id=str(paper.id)),
            PreviewLine(item_id=str(boxes.id), qty=11),
        ]), db, plant, OWNER)
        messages = [[error["message"] for error in line["errors"]] for line in check["lines"]]
        assert messages[0] == ["CK-SCR is a scrap bay. Put opening stock on a store rack, such as the RM store."]
        assert messages[1] == [f"{boxes.name} is counted in whole pieces: enter 10 or 11, not 10.5."]
        assert messages[2] == ["Quantity must be more than 0."] and messages[3] == ["Weight must be more than 0 kg."]
        assert messages[4] == ["Enter the weight in kg."] and messages[5] == []
        assert check["can_post"] is False
        with pytest.raises(HTTPException) as refused:
            _post(db, plant, [{"item_id": paper.id, "qty": 500, "location_id": scrap.id}])
        assert refused.value.status_code == 422 and "scrap bay" in _detail(refused)
        db.rollback()


def test_a_plant_with_a_closed_month_cannot_start_opening_stock_and_earlier_movements_are_warned():
    """Opening stock is go-live only: a plant whose book already runs (a closed month) is closed for it, so a
    'go-live' batch can never land before or between closed months."""
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        lock_books_month(BooksLockPayload(month="2026-03", note="Month-end close"), db, plant, OWNER)
        overview = get_opening_stock(db, plant, OWNER)
        assert overview["opening"]["state"] == "CLOSED" and overview["can_post"] is False
        assert "March 2026 is closed" in overview["opening"]["closed_reason"]
        for day in (date(2026, 1, 10), date(2026, 7, 15)):
            check = preview_opening_load(PreviewPayload(effective_date=day, lines=[PreviewLine(item_id=str(glue.id), qty=5)]), db, plant, OWNER)
            assert check["date"]["ok"] is False and check["date"]["message"] == OPENING_CLOSED
            with pytest.raises(HTTPException) as closed:
                _post(db, plant, [{"item_id": glue.id, "qty": 5}], day=day)
            assert closed.value.status_code == 409 and closed.value.detail["code"] == "OPENING_CLOSED"
            assert "March 2026 is closed" in closed.value.detail["reason"]
            db.rollback()
        # A date inside the closed month itself gets the one closed-month refusal of every store movement.
        with pytest.raises(HTTPException) as locked:
            _post(db, plant, [{"item_id": glue.id, "qty": 5}], day=date(2026, 3, 20))
        assert locked.value.status_code == 409 and locked.value.detail["code"] == "BOOKS_LOCKED"
        assert locked.value.detail["opening_closed"] is True and "March 2026 is closed" in locked.value.detail["reason"]
        db.rollback()
        # The check before posting never says "ask the owner to re-open it": opening stock is closed here.
        march = preview_opening_load(PreviewPayload(effective_date=date(2026, 3, 20), lines=[PreviewLine(item_id=str(glue.id), qty=5)]), db, plant, OWNER)
        assert march["date"]["ok"] is False and march["date"]["message"] == OPENING_CLOSED

    other = str(uuid.uuid4())
    with SessionLocal() as db:
        glue = _item(db, other, "ADHESIVE", tracking="BULK")
        db.add(StockTransaction(item_id=glue.id, transaction_type="INWARD", qty_change=10, plant_id=other, reference_type="INTERNAL", reference_id=uuid.uuid4(),
                                stock_status="UNRESTRICTED", effective_date=date(2026, 10, 3)))
        db.commit()
        check = preview_opening_load(PreviewPayload(effective_date=GO_LIVE, lines=[PreviewLine(item_id=str(glue.id), qty=5)]), db, other, OWNER)
        assert check["date"]["ok"] is True and check["can_post"] is True
        assert check["date"]["warning"].startswith("This plant already has stock movements from 3 Oct 2026, before 28 Oct 2026.")
        same_day = preview_opening_load(PreviewPayload(effective_date=date(2026, 10, 3), lines=[PreviewLine(item_id=str(glue.id), qty=5)]), db, other, OWNER)
        assert same_day["date"]["warning"] is None


def test_a_reused_request_key_with_changed_rows_is_refused_and_the_same_rows_in_any_order_replay():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        boxes = _item(db, plant, "PACKAGING", tracking="BULK", uom="PCS", cost=2.0)
        paper = _item(db, plant, cost=40.0)
        key = uuid.uuid4()
        rows = [{"item_id": boxes.id, "qty": 2, "old_mark": "IDEM-1"}, {"item_id": paper.id, "qty": 300, "vendor_name": "Shree Mills"}]
        first = _post(db, plant, rows, key=key)
        again = _post(db, plant, list(reversed(rows)), key=key)
        assert again["idempotent"] is True and again["id"] == first["id"]
        for changed in (
            [*rows, {"item_id": boxes.id, "qty": 7, "old_mark": "IDEM-2"}],          # a row added
            [{**rows[0], "qty": 3}, rows[1]],                                      # a qty changed
            [rows[0], {**rows[1], "on_hold": True, "hold_reason": "Damp"}],        # put on hold
        ):
            with pytest.raises(HTTPException) as refused:
                _post(db, plant, changed, key=key)
            assert refused.value.status_code == 409 and refused.value.detail["code"] == "OPENING_REQUEST_CHANGED"
            assert "These rows were not posted" in _detail(refused) and first["document_no"] in _detail(refused)
            db.rollback()
        assert db.query(StockBatch).filter_by(item_id=boxes.id).count() == 1
        assert get_opening_stock(db, plant, OWNER)["totals"]["batches"] == 1


def test_the_bulk_label_api_keeps_the_inward_date_of_an_opening_lot():
    from src.routers.labels import get_batch_label

    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        _post(db, plant, [{"item_id": glue.id, "qty": 25}])
        lot = db.query(StockBatch).filter_by(item_id=glue.id).one()
        label = get_batch_label(lot.id, db, _scope(plant), OWNER)
        assert label["inward_date"] == "2026-10-28" and label["grn_no"] == "Opening stock (28 Oct 2026)"


def test_a_held_opening_lot_cleared_by_incoming_qc_is_usable_in_the_ledger():
    from src.routers.quality import QualityInspectionCreate, create_quality_inspection
    from src.services.stock_calc import get_usable_item_qty

    qc = {"sub": "qc@example.com", "roles": ["QC"], "actual_roles": ["QC"], "role": "QC", "token": ""}
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        glue = ItemMaster(item_code=f"GLUE-{uuid.uuid4().hex[:5]}", name="Glue hold test", type="ADHESIVE", tracking_mode="BULK", uom="KG",
                          plant_id=plant, active="true",
                          quality_profile={"status": "approved", "revision": 1, "parameters": [{"code": "viscosity", "unit": "cP", "min": 100, "max": 900}]})
        db.add(glue)
        db.commit()
        _post(db, plant, [{"item_id": glue.id, "qty": 100, "on_hold": True, "hold_reason": "Drum seal broken"}])
        lot = db.query(StockBatch).filter_by(item_id=glue.id).one()
        create_quality_inspection(QualityInspectionCreate(entity_type="BATCH", entity_id=lot.id, readings={"viscosity": 500}, disposition="ACCEPT"), db, plant, qc)
        db.expire_all()
        assert db.get(StockBatch, lot.id).stock_status == "UNRESTRICTED"
        assert [row.stock_status for row in db.query(StockTransaction).filter_by(batch_id=lot.id).all()] == ["UNRESTRICTED"]
        assert get_usable_item_qty(str(glue.id), db) == 100
