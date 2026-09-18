"""Original PUR-03 GRN replay/concurrency against isolated hariom_nverify inventory."""
from __future__ import annotations

import os
import threading
import uuid
from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

URL = os.environ.get("HARI_OM_INVENTORY_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or "hariom_nverify" not in URL:
    pytest.skip("Requires isolated hariom_nverify inventory Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from src.database import Base, engine
from src.models import (
    InventoryLocation,
    ItemMaster,
    ItemType,
    PurchaseOrder,
    PurchaseReceipt,
    StockBatch,
    StockTransaction,
    TrackingMode,
    UOM,
)
from src.routers.purchase import (
    GrnCreate,
    GrnLineCreate,
    PurchaseOrderCreate,
    PurchaseOrderLineCreate,
    approve_purchase_order,
    create_purchase_order,
    post_grn,
)

PLANT = "PLANT_A"
Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def setup_module() -> None:
    Base.metadata.create_all(engine)


def _user(sub: str, roles=("Store",)) -> dict:
    return {"sub": sub, "actual_sub": sub, "roles": list(roles), "token": ""}


def _item_and_location(db, suffix: str):
    item = ItemMaster(
        item_code=f"NV-PUR-{suffix}",
        name=f"Verify purchase {suffix}",
        type=ItemType.RAW_PAPER,
        tracking_mode=TrackingMode.BULK,
        uom=UOM.KG,
        plant_id=PLANT,
        active="true",
    )
    loc = InventoryLocation(code=f"NV-PUR-{suffix}", warehouse="WH", plant_id=PLANT, active="true")
    db.add(item)
    db.add(loc)
    db.flush()
    return item, loc


def test_pur03_same_grn_key_replays_and_balance_receive_does_not_overreceipt():
    db = Session()
    try:
        suffix = uuid.uuid4().hex[:8]
        item, loc = _item_and_location(db, suffix)
        created = create_purchase_order(
            PurchaseOrderCreate(
                po_no=f"PO-{suffix}",
                supplier_id=uuid.uuid4(),
                supplier_name="Verify Paper Mills",
                lines=[
                    PurchaseOrderLineCreate(
                        item_id=item.id,
                        qty_ordered=100,
                        unit_cost=30,
                        incoming_qc_required=True,
                    )
                ],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        po_id = uuid.UUID(str(created["id"] if isinstance(created, dict) else created.id))
        approve_purchase_order(po_id, db=db, plant_id=PLANT, current_user=_user("owner-a", roles=("Owner",)))
        order = db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id).one()
        po_line_id = order.lines[0].id
        grn_no = f"GRN-{suffix}"
        first = post_grn(
            po_id,
            GrnCreate(
                grn_no=grn_no,
                received_date=date(2026, 9, 18),
                lines=[GrnLineCreate(po_line_id=po_line_id, qty_received=40, location_id=loc.id)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        replay = post_grn(
            po_id,
            GrnCreate(
                grn_no=grn_no,
                received_date=date(2026, 9, 18),
                lines=[GrnLineCreate(po_line_id=po_line_id, qty_received=40, location_id=loc.id)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        assert replay.get("idempotent") is True
        assert replay["id"] == first["id"]
        receipts = db.query(PurchaseReceipt).filter(PurchaseReceipt.purchase_order_id == po_id).count()
        assert receipts == 1
        batches = db.query(StockBatch).filter(StockBatch.item_id == item.id).all()
        assert len(batches) == 1
        assert abs(float(batches[0].received_qty) - 40) < 1e-9
        with pytest.raises(HTTPException) as over:
            post_grn(
                po_id,
                GrnCreate(
                    grn_no=f"GRN-{suffix}-OVER",
                    received_date=date(2026, 9, 18),
                    lines=[GrnLineCreate(po_line_id=po_line_id, qty_received=70, location_id=loc.id)],
                ),
                db=db,
                plant_id=PLANT,
                current_user=_user("store-a", roles=("Store",)),
            )
        assert over.value.status_code == 400
        remaining = post_grn(
            po_id,
            GrnCreate(
                grn_no=f"GRN-{suffix}-BAL",
                received_date=date(2026, 9, 18),
                lines=[GrnLineCreate(po_line_id=po_line_id, qty_received=60, location_id=loc.id)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        assert remaining.get("idempotent") is not True
        db.refresh(order.lines[0])
        assert abs(float(order.lines[0].qty_received) - 100) < 1e-9
        total_in = sum(float(batch.received_qty) for batch in db.query(StockBatch).filter(StockBatch.item_id == item.id))
        assert abs(total_in - 100) < 1e-9
        tx_count = db.query(StockTransaction).filter(StockTransaction.item_id == item.id).count()
        assert tx_count >= 2
    finally:
        db.close()


def test_pur03_concurrent_remaining_balance_cannot_double_inward():
    db = Session()
    try:
        suffix = uuid.uuid4().hex[:8]
        item, loc = _item_and_location(db, suffix)
        created = create_purchase_order(
            PurchaseOrderCreate(
                po_no=f"PO-C-{suffix}",
                supplier_id=uuid.uuid4(),
                supplier_name="Verify Paper Mills",
                lines=[PurchaseOrderLineCreate(item_id=item.id, qty_ordered=100, unit_cost=30, incoming_qc_required=True)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        po_id = uuid.UUID(str(created["id"] if isinstance(created, dict) else created.id))
        approve_purchase_order(po_id, db=db, plant_id=PLANT, current_user=_user("owner-a", roles=("Owner",)))
        order = db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id).one()
        po_line_id = order.lines[0].id
        loc_id = loc.id
        item_id = item.id
        post_grn(
            po_id,
            GrnCreate(
                grn_no=f"GRN-{suffix}-40",
                received_date=date(2026, 9, 18),
                lines=[GrnLineCreate(po_line_id=po_line_id, qty_received=40, location_id=loc_id)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
    finally:
        db.close()

    barrier = threading.Barrier(2)
    results: list[object] = []
    lock = threading.Lock()

    def worker(tag: str) -> None:
        worker_engine = create_engine(URL, poolclass=NullPool)
        session = sessionmaker(bind=worker_engine, autoflush=False, autocommit=False)()
        try:
            barrier.wait(timeout=10)
            post_grn(
                po_id,
                GrnCreate(
                    grn_no=f"GRN-{suffix}-{tag}",
                    received_date=date(2026, 9, 18),
                    lines=[GrnLineCreate(po_line_id=po_line_id, qty_received=60, location_id=loc_id)],
                ),
                db=session,
                plant_id=PLANT,
                current_user=_user(f"store-{tag}", roles=("Store",)),
            )
            with lock:
                results.append(("ok", tag))
        except HTTPException as exc:
            session.rollback()
            with lock:
                results.append(("err", exc.status_code))
        except Exception as exc:
            session.rollback()
            with lock:
                results.append(("exc", type(exc).__name__, str(exc)))
        finally:
            session.close()

    threads = [threading.Thread(target=worker, args=("A",)), threading.Thread(target=worker, args=("B",))]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    assert len([row for row in results if row[0] == "ok"]) == 1, results
    assert len([row for row in results if row[0] == "err"]) == 1, results
    check = Session()
    try:
        line = check.query(PurchaseOrder).filter(PurchaseOrder.id == po_id).one().lines[0]
        assert abs(float(line.qty_received) - 100) < 1e-9
        total = sum(float(batch.received_qty) for batch in check.query(StockBatch).filter(StockBatch.item_id == item_id))
        assert abs(total - 100) < 1e-9
    finally:
        check.close()
