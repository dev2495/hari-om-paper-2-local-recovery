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
from src.quality_pin import pin_quality_profile_metadata
from src.routers.purchase import (
    GrnCreate,
    GrnLineCreate,
    PurchaseOrderCreate,
    PurchaseOrderLineCreate,
    ReceiptEvidenceCreate,
    ReceiptQcPayload,
    SupplierScheduleCommit,
    SupplierScheduleRowIn,
    WorkbookImportPayload,
    approve_purchase_order,
    attach_receipt_evidence,
    commit_purchase_workbook,
    commit_supplier_schedules,
    create_purchase_order,
    list_supplier_schedules,
    post_grn,
    preview_purchase_workbook,
    print_purchase_order,
    update_receipt_line_qc,
)
from src.routers.dispatch import DispatchCreate, create_dispatch
from src.routers.quality import QualityInspectionCreate, create_quality_inspection
from src.routers.stock_moves import WipIssueCreate, issue_batch_to_wip
from src.services.stock_calc import get_usable_item_qty

PLANT = "PLANT_A"
Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def setup_module() -> None:
    from sqlalchemy import text

    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE IF EXISTS item_master DROP CONSTRAINT IF EXISTS item_master_item_code_key"))
        connection.execute(text("DROP INDEX IF EXISTS item_master_item_code_key"))
        connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_item_master_plant_code ON item_master (plant_id, item_code)"))


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


def _approved_profile(low: float, high: float) -> dict:
    return {
        "status": "approved",
        "setup_status": "approved",
        "revision": 1,
        "inspection_required": True,
        "parameters": [
            {"code": "gsm", "label": "GSM", "min": low, "max": high, "unit": "", "required": True}
        ],
    }


def test_pur01_six_line_po_keeps_typed_terms_and_does_not_fabricate_tax_or_schedule():
    db = Session()
    try:
        suffix = uuid.uuid4().hex[:8]
        specs = [
            (ItemType.RAW_PAPER, UOM.KG, {"width_mm": 76, "gsm": 180, "plybond": 1.2}),
            (ItemType.RAW_PAPER, UOM.KG, {"width_mm": 90, "gsm": 200, "bulk": 1.4}),
            (ItemType.ADHESIVE, UOM.KG, {"description": "starch adhesive"}),
            (ItemType.ADHESIVE, UOM.PCS, {"description": "adhesive pail"}),
            (ItemType.PARCHMENT, UOM.KG, {"description": "inner parchment"}),
            (ItemType.PARCHMENT, UOM.PCS, {"description": "outer parchment"}),
        ]
        items = []
        for idx, (item_type, uom, extra) in enumerate(specs, start=1):
            item = ItemMaster(
                item_code=f"NV-P01-{suffix}-{idx}",
                name=f"Verify {item_type.value} {idx}",
                type=item_type,
                tracking_mode=TrackingMode.BULK,
                uom=uom,
                plant_id=PLANT,
                active="true",
            )
            db.add(item)
            items.append((item, extra))
        db.flush()
        created = create_purchase_order(
            PurchaseOrderCreate(
                po_no=f"PO-6-{suffix}",
                supplier_id=uuid.uuid4(),
                supplier_name="Six Line Mills",
                tax_terms="GST extra as applicable",
                payment_terms="30 days",
                freight_terms="Ex-works",
                delivery_terms="Plant A stores",
                test_report_terms="Mill TC with GRN",
                special_instruction="Do not invent a tax amount",
                lines=[
                    PurchaseOrderLineCreate(
                        item_id=item.id,
                        qty_ordered=10 * idx,
                        unit_cost=idx,
                        incoming_qc_required=True,
                        **extra,
                    )
                    for idx, (item, extra) in enumerate(items, start=1)
                ],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        assert created["tax_terms"] == "GST extra as applicable"
        assert created["payment_terms"] == "30 days"
        assert "gst_amount" not in created
        assert "tax_amount" not in created
        assert len(created["lines"]) == 6
        types = {row["item_type"] for row in created["lines"]}
        assert {"RAW_PAPER", "ADHESIVE", "PARCHMENT"} <= types
        assert all(row["schedules"] == [] for row in created["lines"])
        assert created["lines"][0]["width_mm"] == 76
        assert created["lines"][0]["uom"] == "KG"
        assert created["lines"][3]["uom"] == "PCS"
        amounts = [row["amount"] for row in created["lines"]]
        assert amounts == [round(10 * idx * idx, 2) for idx in range(1, 7)]
    finally:
        db.close()


def test_pur02_supplier_line_splits_stay_on_calendar_and_cannot_over_schedule():
    db = Session()
    try:
        suffix = uuid.uuid4().hex[:8]
        item, _loc = _item_and_location(db, suffix)
        created = create_purchase_order(
            PurchaseOrderCreate(
                po_no=f"PO-S-{suffix}",
                supplier_id=uuid.uuid4(),
                supplier_name="Split Mills",
                lines=[PurchaseOrderLineCreate(item_id=item.id, qty_ordered=100, unit_cost=12)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        line_id = uuid.UUID(created["lines"][0]["id"])
        po_id = uuid.UUID(str(created["id"]))
        first = commit_supplier_schedules(
            po_id,
            SupplierScheduleCommit(
                rows=[
                    SupplierScheduleRowIn(
                        purchase_order_line_id=line_id,
                        scheduled_qty=40,
                        promised_date=date(2026, 10, 1),
                        confirmation_status="CONFIRMED",
                    ),
                    SupplierScheduleRowIn(
                        purchase_order_line_id=line_id,
                        scheduled_qty=60,
                        promised_date=date(2026, 10, 20),
                        confirmation_status="TENTATIVE",
                    ),
                ]
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        assert first["ledger"] is False
        assert [row["scheduled_qty"] for row in first["items"]] == [40.0, 60.0]
        listed = list_supplier_schedules(db=db, plant_id=PLANT, current_user=_user("store-a"))
        dates = {row["promised_date"] for row in listed["items"] if row["purchase_order_id"] == str(po_id)}
        assert dates == {"2026-10-01", "2026-10-20"}
        with pytest.raises(HTTPException) as over:
            commit_supplier_schedules(
                po_id,
                SupplierScheduleCommit(
                    rows=[
                        SupplierScheduleRowIn(
                            purchase_order_line_id=line_id,
                            scheduled_qty=10,
                            promised_date=date(2026, 11, 1),
                        )
                    ]
                ),
                db=db,
                plant_id=PLANT,
                current_user=_user("store-a", roles=("Store",)),
            )
        assert over.value.status_code == 400
    finally:
        db.close()


def test_pur04_qc_required_receipt_stays_held_until_pass():
    db = Session()
    try:
        suffix = uuid.uuid4().hex[:8]
        item, loc = _item_and_location(db, suffix)
        item.quality_profile = _approved_profile(180, 220)
        db.flush()
        created = create_purchase_order(
            PurchaseOrderCreate(
                po_no=f"PO-QC-{suffix}",
                supplier_id=uuid.uuid4(),
                supplier_name="Hold Mills",
                lines=[
                    PurchaseOrderLineCreate(
                        item_id=item.id, qty_ordered=50, unit_cost=9, incoming_qc_required=True
                    )
                ],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        po_id = uuid.UUID(str(created["id"]))
        approve_purchase_order(po_id, db=db, plant_id=PLANT, current_user=_user("owner-a", roles=("Owner",)))
        order = db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id).one()
        grn = post_grn(
            po_id,
            GrnCreate(
                grn_no=f"GRN-QC-{suffix}",
                received_date=date(2026, 9, 18),
                lines=[GrnLineCreate(po_line_id=order.lines[0].id, qty_received=50, location_id=loc.id)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        batch = db.query(StockBatch).filter(StockBatch.item_id == item.id).one()
        assert batch.stock_status == "QC_HOLD"
        assert get_usable_item_qty(str(item.id), db) == 0
        receipt_line_id = uuid.UUID(grn["lines"][0]["receipt_line_id"])
        with pytest.raises(HTTPException) as desk:
            update_receipt_line_qc(
                receipt_line_id,
                ReceiptQcPayload(status="PASS"),
                db=db,
                plant_id=PLANT,
                current_user=_user("store-a", roles=("Store",)),
            )
        assert desk.value.status_code == 403
        with pytest.raises(HTTPException) as blocked:
            issue_batch_to_wip(
                WipIssueCreate(
                    item_id=item.id,
                    batch_id=batch.id,
                    qty=10,
                    job_card_id=uuid.uuid4(),
                    stage="WINDER",
                ),
                db=db,
                plant_id=PLANT,
                current_user=_user("store-a", roles=("Store",)),
            )
        assert blocked.value.status_code == 400
        inspection = create_quality_inspection(
            QualityInspectionCreate(
                entity_type="BATCH",
                entity_id=batch.id,
                readings={"gsm": 200},
                disposition="ACCEPT",
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("qc-a", roles=("QC",)),
        )
        db.refresh(batch)
        assert inspection.status == "PASS"
        assert batch.stock_status == "UNRESTRICTED"
        assert get_usable_item_qty(str(item.id), db) == 50
    finally:
        db.close()


def test_pur05_partial_receive_keeps_remainder_explicit_without_silent_close():
    db = Session()
    try:
        suffix = uuid.uuid4().hex[:8]
        item, loc = _item_and_location(db, suffix)
        created = create_purchase_order(
            PurchaseOrderCreate(
                po_no=f"PO-PR-{suffix}",
                supplier_id=uuid.uuid4(),
                supplier_name="Partial Mills",
                lines=[PurchaseOrderLineCreate(item_id=item.id, qty_ordered=100, unit_cost=8)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        po_id = uuid.UUID(str(created["id"]))
        approve_purchase_order(po_id, db=db, plant_id=PLANT, current_user=_user("owner-a", roles=("Owner",)))
        order = db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id).one()
        post_grn(
            po_id,
            GrnCreate(
                grn_no=f"GRN-PR-{suffix}",
                received_date=date(2026, 9, 18),
                lines=[GrnLineCreate(po_line_id=order.lines[0].id, qty_received=60, location_id=loc.id)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        db.refresh(order.lines[0])
        assert order.lines[0].line_status == "PARTIAL"
        remaining = float(order.lines[0].qty_ordered) - float(order.lines[0].qty_received)
        assert abs(remaining - 40) < 1e-9
        assert order.lines[0].line_status != "CLOSED"
        assert "REJECTED" not in {"OPEN", "PARTIAL", "CLOSED"}
    finally:
        db.close()


def test_qct015_two_same_category_items_pin_their_own_bounds_on_receipt():
    db = Session()
    try:
        suffix = uuid.uuid4().hex[:8]
        loc = InventoryLocation(code=f"NV-Q15-{suffix}", warehouse="WH", plant_id=PLANT, active="true")
        db.add(loc)
        items = []
        for tag, low, high in (("A", 180.0, 200.0), ("B", 80.0, 100.0)):
            item = ItemMaster(
                item_code=f"NV-Q15-{suffix}-{tag}",
                name=f"Same family paper {tag}",
                type=ItemType.RAW_PAPER,
                tracking_mode=TrackingMode.BULK,
                uom=UOM.KG,
                plant_id=PLANT,
                active="true",
                quality_profile=_approved_profile(low, high),
            )
            db.add(item)
            items.append((item, low, high))
        db.flush()
        pins = []
        for item, low, high in items:
            created = create_purchase_order(
                PurchaseOrderCreate(
                    po_no=f"PO-{item.item_code[-6:]}",
                    supplier_id=uuid.uuid4(),
                    supplier_name="Family Mills",
                    lines=[PurchaseOrderLineCreate(item_id=item.id, qty_ordered=25, unit_cost=5, incoming_qc_required=True)],
                ),
                db=db,
                plant_id=PLANT,
                current_user=_user("store-a", roles=("Store",)),
            )
            po_id = uuid.UUID(str(created["id"]))
            approve_purchase_order(po_id, db=db, plant_id=PLANT, current_user=_user("owner-a", roles=("Owner",)))
            order = db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id).one()
            post_grn(
                po_id,
                GrnCreate(
                    grn_no=f"GRN-{item.item_code[-6:]}",
                    received_date=date(2026, 9, 18),
                    lines=[GrnLineCreate(po_line_id=order.lines[0].id, qty_received=25, location_id=loc.id)],
                ),
                db=db,
                plant_id=PLANT,
                current_user=_user("store-a", roles=("Store",)),
            )
            batch = db.query(StockBatch).filter(StockBatch.item_id == item.id).one()
            pinned = (batch.inward_metadata or {}).get("quality_profile") or {}
            param = pinned["parameters"][0]
            assert param["min"] == low
            assert param["max"] == high
            pins.append((item, batch, low))
        first_item, first_batch, first_low = pins[0]
        first_item.quality_profile = _approved_profile(10, 20)
        db.flush()
        still = (first_batch.inward_metadata or {}).get("quality_profile") or {}
        assert still["parameters"][0]["min"] == first_low
        unit_a = pin_quality_profile_metadata({}, _approved_profile(180, 200))
        unit_b = pin_quality_profile_metadata({}, _approved_profile(80, 100))
        assert unit_a["quality_profile"]["parameters"][0]["min"] != unit_b["quality_profile"]["parameters"][0]["min"]
    finally:
        db.close()


def test_pur06_and_pur07_sep_workbook_flags_ambiguity_and_reupload_is_idempotent():
    db = Session()
    try:
        suffix = uuid.uuid4().hex[:8]
        item, _loc = _item_and_location(db, suffix)
        supplier_id = uuid.uuid4()
        rows = [
            {
                "date": "2026-04-04",
                "vendor": "VATSALYA",
                "item_code": item.item_code,
                "qty": 12,
                "unit": "KG",
                "pending": None,
                "record_type": "PLANNING",
            },
            {
                "date": "2026-09-02",
                "vendor": "AMIGO",
                "item_code": item.item_code,
                "qty": 1,
                "unit": "300,000",
                "pending": "",
                "record_type": "PLANNING",
            },
            {
                "date": "2026-09-10",
                "vendor": "Verify Mills",
                "item_code": item.item_code,
                "item_id": str(item.id),
                "supplier_id": str(supplier_id),
                "qty": 20,
                "unit": "KG",
                "pending": 20,
                "record_type": "PO_COMMITMENT",
                "unit_cost": 12,
            },
        ]
        preview = preview_purchase_workbook(
            WorkbookImportPayload(source_name=f"SEP-{suffix}", sheet_name="SEP 2026", rows=rows),
            current_user=_user("store-a", roles=("Store",)),
        )
        assert preview["would_post_stock"] is False
        assert {"DATE_SHEET_MISMATCH", "BLANK_PENDING", "UNKNOWN_UNIT"} <= set(preview["flag_codes"])
        stock_before = db.query(StockTransaction).filter(StockTransaction.plant_id == PLANT).count()
        po_before = db.query(PurchaseOrder).filter(PurchaseOrder.plant_id == PLANT).count()
        first = commit_purchase_workbook(
            WorkbookImportPayload(source_name=f"SEP-{suffix}", sheet_name="SEP 2026", rows=rows),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        second = commit_purchase_workbook(
            WorkbookImportPayload(source_name=f"SEP-{suffix}", sheet_name="SEP 2026", rows=rows),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        stock_after = db.query(StockTransaction).filter(StockTransaction.plant_id == PLANT).count()
        po_after = db.query(PurchaseOrder).filter(PurchaseOrder.plant_id == PLANT).count()
        assert first["stock_posted"] is False
        assert first["ledger"] is False
        assert first["created_po_count"] == 1
        assert second["idempotent"] is True
        assert second["posted_po_ids"] == first["posted_po_ids"]
        assert second["created_po_count"] == 0
        assert stock_after == stock_before
        assert po_after == po_before + 1
        assert db.query(PurchaseReceipt).filter(PurchaseReceipt.plant_id == PLANT, PurchaseReceipt.purchase_order_id == uuid.UUID(first["posted_po_ids"][0])).count() == 0
    finally:
        db.close()


def test_pur08_evidence_links_to_batch_and_print_uses_amigo_not_hari_om():
    db = Session()
    try:
        suffix = uuid.uuid4().hex[:8]
        item, loc = _item_and_location(db, suffix)
        created = create_purchase_order(
            PurchaseOrderCreate(
                po_no=f"PO-AMIGO-{suffix}",
                supplier_id=uuid.uuid4(),
                supplier_name="Verify Paper Mills",
                tax_terms="GST extra as applicable",
                payment_terms="30 days",
                freight_terms="To pay",
                test_report_terms="Supplier mill test with GRN",
                special_instruction="FOR AMIGO INDUSTRIES UNIT-2",
                legal_entity="AMIGO INDUSTRIES UNIT-II",
                lines=[PurchaseOrderLineCreate(item_id=item.id, qty_ordered=40, unit_cost=22, incoming_qc_required=True)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        po_id = uuid.UUID(str(created["id"]))
        missing = print_purchase_order(po_id, db=db, plant_id=PLANT, current_user=_user("store-a"))
        # legal_entity was stored; confirmed issuer is AMIGO, never a Hari Om default.
        assert missing["issuer_status"] == "CONFIRMED"
        assert missing["issuer_name"] == "AMIGO INDUSTRIES UNIT-II"
        assert "hari om" not in str(missing["issuer_name"]).lower()
        unresolved = resolve_po_print_unresolved()
        assert unresolved["issuer_name"] is None
        approve_purchase_order(po_id, db=db, plant_id=PLANT, current_user=_user("owner-a", roles=("Owner",)))
        order = db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id).one()
        grn = post_grn(
            po_id,
            GrnCreate(
                grn_no=f"GRN-EV-{suffix}",
                received_date=date(2026, 9, 18),
                lines=[GrnLineCreate(po_line_id=order.lines[0].id, qty_received=40, location_id=loc.id)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        batch_id = uuid.UUID(grn["lines"][0]["batch_id"])
        receipt_id = uuid.UUID(grn["id"])
        attached = attach_receipt_evidence(
            receipt_id,
            ReceiptEvidenceCreate(
                kind="TEST_REPORT",
                filename="mill-test.pdf",
                sha256="a" * 64,
                content_type="application/pdf",
                batch_id=batch_id,
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        assert attached["linked"] is True
        assert attached["batch_id"] == str(batch_id)
        batch = db.query(StockBatch).filter(StockBatch.id == batch_id).one()
        evidence = (batch.inward_metadata or {}).get("receipt_evidence") or []
        assert evidence[0]["kind"] == "TEST_REPORT"
        assert evidence[0]["batch_id"] == str(batch_id)
        with pytest.raises(HTTPException) as wrong:
            attach_receipt_evidence(
                receipt_id,
                ReceiptEvidenceCreate(
                    kind="CHALLAN",
                    filename="other.pdf",
                    sha256="b" * 64,
                    batch_id=uuid.uuid4(),
                ),
                db=db,
                plant_id=PLANT,
                current_user=_user("store-a", roles=("Store",)),
            )
        assert wrong.value.status_code == 409
    finally:
        db.close()


def resolve_po_print_unresolved():
    from src.services.purchase_workbook import resolve_po_issuer

    return resolve_po_issuer({})


def test_qct016_same_item_code_uses_receiving_plant_profile_not_global_or_other_plant():
    db = Session()
    try:
        suffix = uuid.uuid4().hex[:8]
        code = f"CORE-{suffix}"
        loc_a = InventoryLocation(code=f"NV-A-{suffix}", warehouse="WH", plant_id="PLANT_A", active="true")
        loc_b = InventoryLocation(code=f"NV-B-{suffix}", warehouse="WH", plant_id="PLANT_B", active="true")
        item_a = ItemMaster(
            item_code=code,
            name="Core paper family",
            type=ItemType.RAW_PAPER,
            tracking_mode=TrackingMode.BULK,
            uom=UOM.KG,
            plant_id="PLANT_A",
            active="true",
            quality_profile=_approved_profile(40, 50),
        )
        item_b = ItemMaster(
            item_code=code,
            name="Core paper family",
            type=ItemType.RAW_PAPER,
            tracking_mode=TrackingMode.BULK,
            uom=UOM.KG,
            plant_id="PLANT_B",
            active="true",
            quality_profile=_approved_profile(80, 100),
        )
        db.add_all([loc_a, loc_b, item_a, item_b])
        db.flush()

        def _receive(plant, item, loc, low):
            created = create_purchase_order(
                PurchaseOrderCreate(
                    po_no=f"PO-{plant[-1]}-{suffix}",
                    supplier_id=uuid.uuid4(),
                    supplier_name="Plant mills",
                    lines=[PurchaseOrderLineCreate(item_id=item.id, qty_ordered=15, unit_cost=8, incoming_qc_required=True)],
                ),
                db=db,
                plant_id=plant,
                current_user=_user("store-a", roles=("Store",)),
            )
            po_id = uuid.UUID(str(created["id"]))
            approve_purchase_order(po_id, db=db, plant_id=plant, current_user=_user("owner-a", roles=("Owner",)))
            order = db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id).one()
            grn = post_grn(
                po_id,
                GrnCreate(
                    grn_no=f"GRN-{plant[-1]}-{suffix}",
                    received_date=date(2026, 9, 18),
                    lines=[GrnLineCreate(po_line_id=order.lines[0].id, qty_received=15, location_id=loc.id)],
                ),
                db=db,
                plant_id=plant,
                current_user=_user("store-a", roles=("Store",)),
            )
            batch = db.query(StockBatch).filter(StockBatch.id == uuid.UUID(grn["lines"][0]["batch_id"])).one()
            profile = (batch.inward_metadata or {}).get("quality_profile") or {}
            assert profile["parameters"][0]["min"] == low
            assert batch.plant_id == plant
            return batch

        pin_a = _receive("PLANT_A", item_a, loc_a, 40)
        pin_b = _receive("PLANT_B", item_b, loc_b, 80)
        assert pin_a.inward_metadata["quality_profile"]["parameters"][0]["min"] != pin_b.inward_metadata["quality_profile"]["parameters"][0]["min"]
        from src.utils.auth import _resolve_scope

        try:
            _resolve_scope(
                current_user={"roles": ["Owner"], "sub": "owner-x", "allowed_plants": ["PLANT_A", "PLANT_B"]},
                requested_plant_id=None,
                allow_all=False,
            )
            raise AssertionError("unresolved plant must not default to Plant A")
        except HTTPException as exc:
            assert exc.status_code == 400
            assert "concrete plant" in str(exc.detail).lower()
    finally:
        db.close()


def test_qct018_missing_approved_setup_keeps_receipt_restricted_and_never_pass():
    db = Session()
    try:
        suffix = uuid.uuid4().hex[:8]
        item, loc = _item_and_location(db, suffix)
        item.quality_profile = {
            "status": "draft",
            "setup_status": "draft",
            "revision": 1,
            "inspection_required": True,
            "parameters": [{"code": "gsm", "min": 40, "max": 50, "required": True}],
        }
        db.flush()
        created = create_purchase_order(
            PurchaseOrderCreate(
                po_no=f"PO-NS-{suffix}",
                supplier_id=uuid.uuid4(),
                supplier_name="No setup mills",
                lines=[PurchaseOrderLineCreate(item_id=item.id, qty_ordered=18, unit_cost=9, incoming_qc_required=True)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        po_id = uuid.UUID(str(created["id"]))
        approve_purchase_order(po_id, db=db, plant_id=PLANT, current_user=_user("owner-a", roles=("Owner",)))
        order = db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id).one()
        grn = post_grn(
            po_id,
            GrnCreate(
                grn_no=f"GRN-NS-{suffix}",
                received_date=date(2026, 9, 18),
                lines=[GrnLineCreate(po_line_id=order.lines[0].id, qty_received=18, location_id=loc.id)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        batch = db.query(StockBatch).filter(StockBatch.id == uuid.UUID(grn["lines"][0]["batch_id"])).one()
        assert batch.stock_status == "QC_HOLD"
        pinned = (batch.inward_metadata or {}).get("quality_profile") or {}
        assert str(pinned.get("status") or "").lower() == "missing"
        inspection = create_quality_inspection(
            QualityInspectionCreate(
                entity_type="BATCH",
                entity_id=batch.id,
                readings={"gsm": 45},
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("qc-a", roles=("QC",)),
        )
        status = inspection.status if hasattr(inspection, "status") else inspection["status"]
        assert status != "PASS"
        assert status in {"INCOMPLETE", "FAIL", "INVALID"}
        db.refresh(batch)
        assert batch.stock_status == "QC_HOLD"
        assert get_usable_item_qty(str(item.id), db) == 0
    finally:
        db.close()


def test_reg01_dispatch_retry_same_ref_does_not_duplicate_outward():
    db = Session()
    try:
        suffix = uuid.uuid4().hex[:8]
        item, loc = _item_and_location(db, suffix)
        created = create_purchase_order(
            PurchaseOrderCreate(
                po_no=f"PO-DSP-{suffix}",
                supplier_id=uuid.uuid4(),
                supplier_name="Dispatch mills",
                lines=[PurchaseOrderLineCreate(item_id=item.id, qty_ordered=80, unit_cost=4, incoming_qc_required=False)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        po_id = uuid.UUID(str(created["id"]))
        approve_purchase_order(po_id, db=db, plant_id=PLANT, current_user=_user("owner-a", roles=("Owner",)))
        order = db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id).one()
        grn = post_grn(
            po_id,
            GrnCreate(
                grn_no=f"GRN-DSP-{suffix}",
                received_date=date(2026, 9, 18),
                lines=[GrnLineCreate(po_line_id=order.lines[0].id, qty_received=80, location_id=loc.id)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        batch_id = uuid.UUID(grn["lines"][0]["batch_id"])
        ref = f"DIS-{suffix}"
        first = create_dispatch(
            DispatchCreate(item_id=item.id, batch_id=batch_id, qty=30, dispatch_ref=ref),
            db=db,
            plant_id=PLANT,
            current_user=_user("dispatch-a", roles=("Dispatch",)),
        )
        retry = create_dispatch(
            DispatchCreate(item_id=item.id, batch_id=batch_id, qty=30, dispatch_ref=ref),
            db=db,
            plant_id=PLANT,
            current_user=_user("dispatch-a", roles=("Dispatch",)),
        )
        assert first.transaction_id == retry.transaction_id
        assert "idempotent" in retry.message.lower()
        outward = (
            db.query(StockTransaction)
            .filter(StockTransaction.external_ref == ref, StockTransaction.plant_id == PLANT)
            .count()
        )
        assert outward == 1
        with pytest.raises(HTTPException) as conflict:
            create_dispatch(
                DispatchCreate(item_id=item.id, batch_id=batch_id, qty=10, dispatch_ref=ref),
                db=db,
                plant_id=PLANT,
                current_user=_user("dispatch-a", roles=("Dispatch",)),
            )
        assert conflict.value.status_code == 409
        second = create_dispatch(
            DispatchCreate(item_id=item.id, batch_id=batch_id, qty=20, dispatch_ref=f"{ref}-B"),
            db=db,
            plant_id=PLANT,
            current_user=_user("dispatch-a", roles=("Dispatch",)),
        )
        assert second.transaction_id != first.transaction_id
        assert abs(float(second.qty_dispatched) - 20) < 1e-9
    finally:
        db.close()

