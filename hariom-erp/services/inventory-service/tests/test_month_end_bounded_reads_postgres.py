"""Month-end round 2 (30 Oct 2026), live PostgreSQL: the book reads only the history up to the month end
in SQL, and the after-count check reads only rows entered after the approval, with the same figures as a
whole-history read (checker r2: month-figures read every ledger row, reel, issue and scan of the plant,
twice for most items once anything moved after the count)."""
import os
import uuid
from datetime import date, datetime

import pytest
from sqlalchemy import event

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

from src.main import ensure_runtime_schema, ensure_stock_count_and_schedule_schema
from src.database import Base, SessionLocal, engine
from src.models import ReelScanEvent, ReelScanEventType, ReelScanSource, StockTransaction
from src.services.stock_control import book_items, book_movements, book_period, changes_after_count

from test_stock_count_flow_postgres import _floor_issue, _item, _lot, _rack, _reel


def setup_module() -> None:
    Base.metadata.create_all(engine)
    ensure_runtime_schema()
    ensure_stock_count_and_schedule_schema()


def _key(move):
    source = move["source"]
    return (move["item_id"], move["day"], move["kind"], move["qty"], source.get("type"), source.get("id"))


def _seed(db, plant):
    paper = _item(db, plant)
    glue = _item(db, plant, "ADHESIVE", tracking="BULK")
    rack = _rack(db, plant, f"RM-B-{uuid.uuid4().hex[:4]}")
    august = _reel(db, plant, paper, 500, at=rack, inward=date(2026, 8, 5))
    september = _reel(db, plant, paper, 300, at=rack, inward=date(2026, 9, 10))
    _floor_issue(db, plant, august, date(2026, 8, 20), section="WINDER")
    _lot(db, plant, glue, 40, at=rack, day=date(2026, 8, 6))
    _lot(db, plant, glue, 15, at=rack, day=date(2026, 9, 3))
    # A correction entered today but dated back into August (effective date kept in the ledger / event).
    db.add(StockTransaction(item_id=glue.id, transaction_type="ADJUSTMENT", qty_change=-2, reference_type="ADJUSTMENT", reference_id=uuid.uuid4(),
                            plant_id=plant, effective_date=date(2026, 8, 31), movement_metadata={"voucher_no": "ADJ-T-1"}))
    db.add(ReelScanEvent(plant_id=uuid.UUID(plant), reel_id=september.id, event_type=ReelScanEventType.MOVE_SCAN, source=ReelScanSource.INVENTORY, timestamp=datetime.utcnow(),
                         event_metadata={"adjustment_qty_delta": -4, "effective_date": "2026-09-30", "voucher_no": "ADJ-T-2"}))
    db.add(ReelScanEvent(plant_id=uuid.UUID(plant), reel_id=august.id, event_type=ReelScanEventType.MOVE_SCAN, source=ReelScanSource.INVENTORY, timestamp=datetime.utcnow(),
                         event_metadata={"adjustment_qty_delta": 3, "effective_date": "2026-08-31T00:00:00", "voucher_no": "ADJ-T-3"}))
    db.flush()
    return paper, glue


def test_a_month_reads_up_to_its_end_with_the_same_figures_as_the_whole_history():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        _seed(db, plant)
        db.commit()
        items = book_items(db, plant)
        everything = book_movements(db, plant, items)
        for end in (date(2026, 7, 31), date(2026, 8, 31), date(2026, 9, 30)):
            whole = sorted(_key(move) for move in everything if move["day"] <= end)
            bounded = sorted(_key(move) for move in book_movements(db, plant, items, until=end, places=False))
            assert bounded == whole, end
        # The August book does not read September's GRN rows from the ledger at all.
        statements: list[str] = []

        def spy(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement)

        event.listen(engine, "before_cursor_execute", spy)
        try:
            august = book_period(db, plant, date(2026, 8, 1), date(2026, 8, 31))
        finally:
            event.remove(engine, "before_cursor_execute", spy)
        assert any("stock_transaction.effective_date <=" in sql for sql in statements)
        figures = {row["item_type"]: row for row in august["items"]}
        assert figures["ADHESIVE"]["received"] == 40 and figures["ADHESIVE"]["corrections"] == -2
        assert figures["RAW_PAPER"]["received"] == 500 and figures["RAW_PAPER"]["issued"] == 500
        assert figures["RAW_PAPER"]["corrections"] == 3


def test_the_after_count_check_reads_only_rows_entered_after_the_approval():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper, glue = _seed(db, plant)
        db.commit()
        approved = datetime.utcnow()
        count = type("Count", (), {"approved_at": approved, "certified_at": None, "month": date(2026, 8, 1)})()
        # Everything so far was entered before the approval: nothing changed after the count.
        assert changes_after_count(db, plant, count) == {}
        _lot(db, plant, glue, 7, at=None, day=date(2026, 8, 28))
        db.commit()
        changes = changes_after_count(db, plant, count)
        assert set(changes) == {str(glue.id)} and changes[str(glue.id)]["qty"] == 7
        rows = book_movements(db, plant, book_items(db, plant), until=date(2026, 8, 31), entered_after=approved, places=False)
        assert all(str(move["item_id"]) == str(glue.id) for move in rows if move["source"].get("type") == "LEDGER")
        assert not [move for move in rows if move["source"].get("type") == "LEDGER" and move["qty"] != 7]
