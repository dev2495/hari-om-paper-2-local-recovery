"""Live PostgreSQL proofs for concession partitions, holds, and receipt pins.

Requires an isolated database whose name contains ``hariom_nverify`` and
``HARI_OM_LIVE_PG=1``. Does not use the default inventorydb.
"""
from __future__ import annotations

import os
import threading
import uuid
from datetime import date

import pytest

URL = os.environ.get("HARI_OM_INVENTORY_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or "hariom_nverify" not in URL:
    pytest.skip("Requires isolated hariom_nverify inventory Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from fastapi import HTTPException
from sqlalchemy.orm import sessionmaker

from src.database import Base, engine
from src.models import (
    InventoryLocation,
    InventoryQualityHold,
    InventoryQualityInspection,
    ItemMaster,
    ItemType,
    ReferenceType,
    StockBatch,
    StockTransaction,
    TrackingMode,
    TransactionType,
    UOM,
)
from src.quality_pin import pin_quality_profile_metadata
from src.quality_profile_lifecycle import apply_profile_save
from src.routers.dispatch import DispatchCreate, create_dispatch
from src.routers.issue import IssueCreate, create_issue
from src.routers.quality import QualityConcessionCreate, create_quality_concession, create_quality_inspection
from src.routers.quality import QualityInspectionCreate
from src.routers.stock_moves import StockMoveCreate, WipIssueCreate, create_stock_move, issue_batch_to_wip


PLANT = "PLANT_A"
Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def setup_module() -> None:
    Base.metadata.create_all(engine)


def _item(db, suffix: str, item_type: ItemType = ItemType.RAW_PAPER) -> ItemMaster:
    item = ItemMaster(
        item_code=f"NV-RM-{suffix}",
        name=f"Verify paper {suffix}",
        type=item_type,
        tracking_mode=TrackingMode.BULK,
        uom=UOM.KG,
        plant_id=PLANT,
        active="true",
        quality_profile={
            "status": "approved",
            "revision": 1,
            "parameters": [{"code": "gsm", "min": 200, "max": 260}],
        },
    )
    db.add(item)
    db.flush()
    return item


def _location(db, suffix: str) -> InventoryLocation:
    loc = InventoryLocation(code=f"NV-{suffix}", warehouse="WH", plant_id=PLANT, active="true")
    db.add(loc)
    db.flush()
    return loc


def _batch(db, item, location, qty: float, status: str, suffix: str) -> StockBatch:
    batch = StockBatch(
        item_id=item.id,
        batch_no=f"NV-B-{suffix}",
        received_qty=qty,
        location_id=location.id,
        stock_status=status,
        plant_id=PLANT,
        inward_metadata=pin_quality_profile_metadata({}, item.quality_profile),
    )
    db.add(batch)
    db.flush()
    db.add(
        StockTransaction(
            item_id=item.id,
            batch_id=batch.id,
            transaction_type=TransactionType.INWARD,
            qty_change=qty,
            reference_type=ReferenceType.PURCHASE,
            reference_id=uuid.uuid4(),
            plant_id=PLANT,
            location_id=location.id,
            stock_status=status,
            effective_date=date.today(),
        )
    )
    db.flush()
    return batch


def _inspection(db, batch, status="FAIL") -> InventoryQualityInspection:
    inspection = InventoryQualityInspection(
        plant_id=PLANT,
        entity_type="BATCH",
        entity_id=batch.id,
        material_type="RAW_PAPER",
        source="INWARD",
        status=status,
        readings={"gsm": 180},
        failures=[{"label": "gsm"}],
        created_by="inspector-1",
    )
    db.add(inspection)
    db.flush()
    db.add(
        InventoryQualityHold(
            plant_id=PLANT,
            entity_type="BATCH",
            entity_id=batch.id,
            source_inspection_id=inspection.id,
            quantity=float(batch.received_qty),
            reason="FAIL incoming",
            status="HOLD",
            hold_kind="INSPECTION",
            created_by="inspector-1",
        )
    )
    db.flush()
    return inspection


def test_partial_concession_keeps_residual_hold_and_blocks_issue():
    db = Session()
    try:
        token = uuid.uuid4().hex[:8]
        item = _item(db, token, ItemType.ADHESIVE)
        loc = _location(db, token)
        batch = _batch(db, item, loc, 1000, "QC_HOLD", token)
        primary = _inspection(db, batch)
        independent = InventoryQualityInspection(
            plant_id=PLANT,
            entity_type="BATCH",
            entity_id=batch.id,
            material_type="RAW_PAPER",
            source="INWARD",
            status="FAIL",
            readings={"gsm": 170},
            created_by="inspector-2",
        )
        db.add(independent)
        db.flush()
        db.add(
            InventoryQualityHold(
                plant_id=PLANT,
                entity_type="BATCH",
                entity_id=batch.id,
                source_inspection_id=independent.id,
                quantity=400,
                reason="independent moisture hold",
                status="HOLD",
                hold_kind="INDEPENDENT",
                created_by="inspector-2",
            )
        )
        db.commit()

        result = create_quality_concession(
            QualityConcessionCreate(
                inspection_id=primary.id,
                reason="authorized 600 kg",
                quantity=600,
                release_stock=True,
                operation_id=f"op-{token}",
            ),
            db=db,
            plant_id=PLANT,
            current_user={"sub": "owner-1", "roles": ["Owner"]},
        )
        assert result.measured_status == "FAIL"
        assert result.quantity == 600
        assert result.residual_qty == 400
        assert result.independent_holds_remaining >= 400
        db.refresh(batch)
        assert batch.stock_status == "QC_HOLD"
        assert batch.received_qty == 400
        child = db.query(StockBatch).filter(StockBatch.id == result.released_entity_id).one()
        assert child.stock_status == "UNRESTRICTED"
        assert child.received_qty == 600

        actor = {"sub": "store-1", "roles": ["Store", "Dispatch"]}
        with pytest.raises(HTTPException) as blocked_issue:
            create_issue(
                IssueCreate(
                    item_id=item.id,
                    batch_id=batch.id,
                    qty=10,
                    production_job_id=uuid.uuid4(),
                    reason_code="DIRECT_CORRECTION",
                ),
                db=db,
                plant_id=PLANT,
                current_user=actor,
            )
        assert blocked_issue.value.status_code == 400
        assert "QC_HOLD" in str(blocked_issue.value.detail)

        with pytest.raises(HTTPException) as blocked_wip:
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
                current_user=actor,
            )
        assert blocked_wip.value.status_code == 400
        assert "QC_HOLD" in str(blocked_wip.value.detail)

        with pytest.raises(HTTPException) as blocked_dispatch:
            create_dispatch(
                DispatchCreate(
                    item_id=item.id,
                    batch_id=batch.id,
                    qty=10,
                    dispatch_ref=f"NV-DSP-{token}",
                ),
                db=db,
                plant_id=PLANT,
                current_user=actor,
            )
        assert blocked_dispatch.value.status_code == 400
        assert "QC_HOLD" in str(blocked_dispatch.value.detail) or "dispatchable" in str(blocked_dispatch.value.detail)

        with pytest.raises(HTTPException) as blocked_move:
            create_stock_move(
                StockMoveCreate(
                    entity_type="BATCH",
                    entity_id=batch.id,
                    stock_status="UNRESTRICTED",
                    reason="escape hold",
                ),
                db=db,
                plant_id=PLANT,
                current_user=actor,
            )
        assert blocked_move.value.status_code == 400
        assert "QC_HOLD" in str(blocked_move.value.detail)
    finally:
        db.close()


def test_overlapping_concessions_cannot_double_release():
    db = Session()
    try:
        token = uuid.uuid4().hex[:8]
        item = _item(db, token)
        loc = _location(db, token)
        batch = _batch(db, item, loc, 1000, "QC_HOLD", token)
        inspection = _inspection(db, batch)
        db.commit()
        inspection_id = inspection.id
    finally:
        db.close()

    barrier = threading.Barrier(2)
    results: list[object] = []
    lock = threading.Lock()

    def worker(operation: str) -> None:
        session = Session()
        try:
            barrier.wait(timeout=10)
            outcome = create_quality_concession(
                QualityConcessionCreate(
                    inspection_id=inspection_id,
                    reason="race",
                    quantity=600,
                    release_stock=True,
                    operation_id=operation,
                ),
                db=session,
                plant_id=PLANT,
                current_user={"sub": "owner-1", "roles": ["Owner"]},
            )
            with lock:
                results.append(("ok", outcome.quantity, outcome.replayed))
        except HTTPException as exc:
            with lock:
                results.append(("err", exc.status_code, exc.detail))
        finally:
            session.close()

    threads = [
        threading.Thread(target=worker, args=(f"race-a-{token}",)),
        threading.Thread(target=worker, args=(f"race-b-{token}",)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    ok = [row for row in results if row[0] == "ok"]
    err = [row for row in results if row[0] == "err"]
    assert len(ok) == 1, results
    assert len(err) == 1, results
    assert ok[0][1] == 600
    assert err[0][1] == 400
    check = Session()
    try:
        parent = check.query(StockBatch).filter(StockBatch.batch_no == f"NV-B-{token}").one()
        children = [
            row
            for row in check.query(StockBatch).filter(StockBatch.item_id == parent.item_id).all()
            if row.id != parent.id
        ]
        released = sum(float(row.received_qty) for row in children if row.stock_status == "UNRESTRICTED")
        assert released == 600
        assert float(parent.received_qty) == 400
        assert parent.stock_status == "QC_HOLD"
    finally:
        check.close()


def test_receipt_pin_survives_later_master_edit():
    db = Session()
    try:
        token = uuid.uuid4().hex[:8]
        item = _item(db, token)
        loc = _location(db, token)
        batch = _batch(db, item, loc, 50, "QC_HOLD", token)
        first_rev = (batch.inward_metadata or {}).get("quality_profile", {}).get("revision")
        assert first_rev == 1
        item.quality_profile = apply_profile_save(
            item.quality_profile,
            {"parameters": [{"code": "gsm", "min": 100, "max": 900}]},
            requested_status="draft",
        )
        db.add(item)
        db.commit()
        db.refresh(batch)
        assert (batch.inward_metadata or {}).get("quality_profile", {}).get("revision") == 1
        assert (batch.inward_metadata or {}).get("quality_profile", {}).get("parameters")[0]["max"] == 260
    finally:
        db.close()


def test_fail_without_reason_persists_pending():
    db = Session()
    try:
        token = uuid.uuid4().hex[:8]
        item = _item(db, token)
        loc = _location(db, token)
        batch = _batch(db, item, loc, 80, "QC_HOLD", token)
        db.commit()
        payload = QualityInspectionCreate(
            entity_type="BATCH",
            entity_id=batch.id,
            source="INWARD",
            readings={"gsm": 100},
            reasons={},
            status="PASS",
        )
        response = create_quality_inspection(
            payload,
            db=db,
            plant_id=PLANT,
            current_user={"sub": "qc-1", "roles": ["QC"]},
        )
        assert response.status == "FAIL"
        assert response.evaluation.get("reason_pending") or response.evaluation.get("workflow_status") == "REASON_PENDING"
        stored = db.query(InventoryQualityInspection).filter(InventoryQualityInspection.id == response.id).one()
        assert stored.status == "FAIL"
        holds = (
            db.query(InventoryQualityHold)
            .filter(InventoryQualityHold.source_inspection_id == stored.id, InventoryQualityHold.status == "HOLD")
            .all()
        )
        assert holds
        assert all(hold.reason and str(hold.reason).strip() for hold in holds)
    finally:
        db.close()


def test_zero_unspecified_and_excess_concession_rejected():
    db = Session()
    try:
        token = uuid.uuid4().hex[:8]
        item = _item(db, token)
        loc = _location(db, token)
        batch = _batch(db, item, loc, 1000, "QC_HOLD", token)
        inspection = _inspection(db, batch)
        db.commit()
        actor = {"sub": "owner-1", "roles": ["Owner"]}
        for quantity in (0, None, 1200):
            with pytest.raises(HTTPException) as blocked:
                create_quality_concession(
                    QualityConcessionCreate(
                        inspection_id=inspection.id,
                        reason="invalid scope",
                        quantity=quantity,
                        release_stock=True,
                        operation_id=f"bad-{token}-{quantity}",
                    ),
                    db=db,
                    plant_id=PLANT,
                    current_user=actor,
                )
            assert blocked.value.status_code == 400
            detail = blocked.value.detail
            code = detail.get("code") if isinstance(detail, dict) else None
            assert code in {"INVALID_QUANTITY", "UNSPECIFIED_SCOPE", "EXCESS_QUANTITY"}
        db.refresh(batch)
        assert batch.stock_status == "QC_HOLD"
        assert float(batch.received_qty) == 1000
    finally:
        db.close()
