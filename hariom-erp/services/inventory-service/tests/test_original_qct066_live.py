"""QCT-066: scoped concession use, other-use/expiry denial, FAIL stays FAIL.

Requires isolated ``hariom_nverify`` inventory Postgres and ``HARI_OM_LIVE_PG=1``.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import sessionmaker

URL = os.environ.get("HARI_OM_INVENTORY_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or not ("hariom_nverify" in URL or ("@127.0.0.1:5432/hariom_" in URL and "_integration_" in URL)):
    pytest.skip("Requires isolated hariom_nverify inventory Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from src.main import ensure_runtime_schema
from src.database import Base, engine
from src.models import (
    CustomerRejection,
    InventoryLocation,
    InventoryQualityConcession,
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
from src.routers.dispatch import DispatchCreate, create_dispatch
from src.routers.issue import IssueCreate, create_issue
from src.routers.quality import QualityConcessionCreate, create_quality_concession
from src.routers.stock_moves import StockMoveCreate, WipIssueCreate, create_stock_move, issue_batch_to_wip
from src.services.stock_calc import get_batch_balance, get_usable_item_qty

ensure_runtime_schema()

PLANT = "00000000-0000-0000-0000-0000000000a1"
OWNER = {"sub": "owner-1", "roles": ["Owner"], "role": "Owner"}
STORE = {"sub": "store-1", "roles": ["Store", "Dispatch"], "role": "Store"}
Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def setup_module() -> None:
    Base.metadata.create_all(engine)
    ensure_runtime_schema()


def _reports() -> Path:
    path = Path(__file__).resolve().parents[4] / "reports"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _detail_code(exc: HTTPException) -> str:
    detail = exc.detail
    if isinstance(detail, dict):
        return str(detail.get("code") or "")
    return str(detail)


def _item(db, suffix: str, item_type: ItemType = ItemType.ADHESIVE) -> ItemMaster:
    item = ItemMaster(
        item_code=f"NV-066-{suffix}",
        name=f"QCT066 paper {suffix}",
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
    loc = InventoryLocation(code=f"NV066-{suffix}", warehouse="WH", plant_id=PLANT, active="true")
    db.add(loc)
    db.flush()
    return loc


def _batch(db, item, location, qty: float, status: str, suffix: str) -> StockBatch:
    batch = StockBatch(
        item_id=item.id,
        batch_no=f"NV066-B-{suffix}",
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


def _inspection(db, batch) -> InventoryQualityInspection:
    inspection = InventoryQualityInspection(
        plant_id=PLANT,
        entity_type="BATCH",
        entity_id=batch.id,
        material_type="RAW_PAPER",
        source="INWARD",
        status="FAIL",
        readings={"gsm": 180},
        failures=[{"label": "gsm"}],
        evaluation={"status": "FAIL", "failures": [{"label": "gsm"}]},
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


def _fail_use(exc_info, code: str, status: int = 409) -> None:
    assert exc_info.value.status_code == status
    assert _detail_code(exc_info.value) == code


def test_qct066_scoped_concession_only_matching_unexpired_use():
    db = Session()
    try:
        token = uuid.uuid4().hex[:8]
        item = _item(db, token)
        loc = _location(db, token)
        batch = _batch(db, item, loc, 1000, "QC_HOLD", token)
        inspection = _inspection(db, batch)
        customer_ok = uuid.uuid4()
        order_ok = uuid.uuid4()
        customer_other = uuid.uuid4()
        order_other = uuid.uuid4()
        expires_at = datetime.utcnow() + timedelta(days=7)
        db.commit()

        result = create_quality_concession(
            QualityConcessionCreate(
                inspection_id=inspection.id,
                reason="authorized 600 kg for one customer/order",
                quantity=600,
                release_stock=True,
                operation_id=f"qct066-{token}",
                permitted_customer_id=customer_ok,
                permitted_sales_order_id=order_ok,
                expires_at=expires_at,
            ),
            db=db,
            plant_id=PLANT,
            current_user=OWNER,
        )
        assert result.measured_status == "FAIL"
        assert result.visibly_separate is True
        assert result.released_stock_status == "CONCESSION"
        assert result.quantity == 600
        assert result.residual_qty == 400
        assert result.permitted_customer_id == customer_ok
        assert result.permitted_sales_order_id == order_ok

        db.refresh(inspection)
        db.refresh(batch)
        assert inspection.status == "FAIL"
        assert batch.stock_status == "QC_HOLD"
        assert batch.received_qty == 400
        child = db.query(StockBatch).filter(StockBatch.id == result.released_entity_id).one()
        assert child.stock_status == "CONCESSION"
        assert child.received_qty == 600
        assert get_batch_balance(str(child.id), db) == 600
        assert get_batch_balance(str(batch.id), db) == 400
        assert get_usable_item_qty(str(item.id), db) == 0

        concession_row = db.query(InventoryQualityConcession).filter(
            InventoryQualityConcession.id == result.concession_id
        ).one()
        assert concession_row.measured_status == "FAIL"
        assert concession_row.permitted_customer_id == customer_ok
        assert str(inspection.id) != str(concession_row.id)

        job_id = uuid.uuid4()
        with pytest.raises(HTTPException) as other_issue:
            create_issue(
                IssueCreate(
                    item_id=item.id,
                    batch_id=child.id,
                    qty=10,
                    production_job_id=job_id,
                    reason_code="DIRECT_CORRECTION",
                    customer_id=customer_other,
                    sales_order_id=order_other,
                ),
                db=db,
                plant_id=PLANT,
                current_user=STORE,
            )
        _fail_use(other_issue, "CONCESSION_SCOPE_MISMATCH")

        with pytest.raises(HTTPException) as unspecified:
            create_issue(
                IssueCreate(
                    item_id=item.id,
                    batch_id=child.id,
                    qty=10,
                    production_job_id=job_id,
                    reason_code="DIRECT_CORRECTION",
                ),
                db=db,
                plant_id=PLANT,
                current_user=STORE,
            )
        _fail_use(unspecified, "CONCESSION_SCOPE_MISMATCH")

        with pytest.raises(HTTPException) as other_wip:
            issue_batch_to_wip(
                WipIssueCreate(
                    item_id=item.id,
                    batch_id=child.id,
                    qty=10,
                    job_card_id=uuid.uuid4(),
                    stage="WINDER",
                    customer_id=customer_other,
                    sales_order_id=order_other,
                ),
                db=db,
                plant_id=PLANT,
                current_user=STORE,
            )
        _fail_use(other_wip, "CONCESSION_SCOPE_MISMATCH")

        with pytest.raises(HTTPException) as other_dispatch:
            create_dispatch(
                DispatchCreate(
                    item_id=item.id,
                    batch_id=child.id,
                    qty=10,
                    dispatch_ref=f"NV-066-DSP-{token}",
                    customer_id=customer_other,
                    sales_order_id=order_other,
                ),
                db=db,
                plant_id=PLANT,
                current_user=STORE,
            )
        _fail_use(other_dispatch, "CONCESSION_SCOPE_MISMATCH")

        with pytest.raises(HTTPException) as escape:
            create_stock_move(
                StockMoveCreate(
                    entity_type="BATCH",
                    entity_id=child.id,
                    stock_status="UNRESTRICTED",
                    reason="treat concession as free stock",
                ),
                db=db,
                plant_id=PLANT,
                current_user=STORE,
            )
        assert escape.value.status_code == 400
        assert "CONCESSION" in str(escape.value.detail)

        matching = create_issue(
            IssueCreate(
                item_id=item.id,
                batch_id=child.id,
                qty=10,
                production_job_id=job_id,
                reason_code="DIRECT_CORRECTION",
                customer_id=customer_ok,
                sales_order_id=order_ok,
            ),
            db=db,
            plant_id=PLANT,
            current_user=STORE,
        )
        assert matching.qty_issued == 10

        db.refresh(inspection)
        assert inspection.status == "FAIL"

        concession_row = db.query(InventoryQualityConcession).filter(
            InventoryQualityConcession.id == result.concession_id
        ).one()
        concession_row.expires_at = datetime.utcnow() - timedelta(hours=1)
        db.commit()
        with pytest.raises(HTTPException) as expired:
            create_issue(
                IssueCreate(
                    item_id=item.id,
                    batch_id=child.id,
                    qty=10,
                    production_job_id=uuid.uuid4(),
                    reason_code="DIRECT_CORRECTION",
                    customer_id=customer_ok,
                    sales_order_id=order_ok,
                ),
                db=db,
                plant_id=PLANT,
                current_user=STORE,
            )
        _fail_use(expired, "CONCESSION_EXPIRED")

        db.refresh(inspection)
        assert inspection.status == "FAIL"
        db.refresh(child)
        assert child.stock_status == "CONCESSION"

        artifact = {
            "inspection_id": str(inspection.id),
            "concession_id": str(result.concession_id),
            "item_id": str(item.id),
            "released_entity_id": str(child.id),
            "residual_entity_id": str(batch.id),
            "customer_id": str(customer_ok),
            "sales_order_id": str(order_ok),
            "other_customer_id": str(customer_other),
            "other_sales_order_id": str(order_other),
            "expires_at": expires_at.isoformat(),
            "quantity": 600,
            "residual_qty": 400,
            "plant_id": PLANT,
            "measured_status": "FAIL",
            "released_stock_status": "CONCESSION",
        }
        (_reports() / "qct066-ui.json").write_text(json.dumps(artifact), encoding="utf8")
    finally:
        db.close()


def test_qct066_already_expired_authorization_cannot_be_approved():
    db = Session()
    try:
        token = uuid.uuid4().hex[:8]
        item = _item(db, token)
        loc = _location(db, token)
        batch = _batch(db, item, loc, 1000, "QC_HOLD", token)
        inspection = _inspection(db, batch)
        db.commit()
        with pytest.raises(HTTPException) as already:
            create_quality_concession(
                QualityConcessionCreate(
                    inspection_id=inspection.id,
                    reason="expired authorization",
                    quantity=600,
                    release_stock=True,
                    permitted_customer_id=uuid.uuid4(),
                    permitted_sales_order_id=uuid.uuid4(),
                    expires_at=datetime.utcnow() - timedelta(minutes=1),
                ),
                db=db,
                plant_id=PLANT,
                current_user=OWNER,
            )
        _fail_use(already, "CONCESSION_ALREADY_EXPIRED", status=400)
        db.refresh(inspection)
        assert inspection.status == "FAIL"
        db.refresh(batch)
        assert batch.stock_status == "QC_HOLD"
    finally:
        db.close()


def test_qct066_does_not_open_partial_customer_rejection():
    db = Session()
    try:
        token = uuid.uuid4().hex[:8]
        item = _item(db, token, ItemType.FINISHED_GOOD)
        loc = _location(db, token)
        batch = _batch(db, item, loc, 400, "QC_HOLD", f"{token}r")
        rejection = CustomerRejection(
            plant_id=PLANT,
            customer_name="QCT066 customer",
            item_id=item.id,
            batch_id=batch.id,
            rejected_qty=400,
            reason_code="QUALITY",
            status="QC_HOLD",
        )
        db.add(rejection)
        db.flush()
        inspection = InventoryQualityInspection(
            plant_id=PLANT,
            entity_type="CUSTOMER_REJECTION",
            entity_id=rejection.id,
            material_type="FINISHED_GOOD",
            source="CUSTOMER_REJECTION",
            status="FAIL",
            readings={"gsm": 180},
            failures=[{"label": "gsm"}],
            created_by="inspector-1",
        )
        db.add(inspection)
        db.flush()
        db.add(
            InventoryQualityHold(
                plant_id=PLANT,
                entity_type="CUSTOMER_REJECTION",
                entity_id=rejection.id,
                source_inspection_id=inspection.id,
                quantity=400,
                reason="FAIL return",
                status="HOLD",
                hold_kind="INSPECTION",
                created_by="inspector-1",
            )
        )
        db.commit()
        with pytest.raises(HTTPException) as partial:
            create_quality_concession(
                QualityConcessionCreate(
                    inspection_id=inspection.id,
                    reason="do not open QCT-107 via scope fields",
                    quantity=200,
                    release_stock=True,
                    permitted_customer_id=uuid.uuid4(),
                    permitted_sales_order_id=uuid.uuid4(),
                    expires_at=datetime.utcnow() + timedelta(days=1),
                ),
                db=db,
                plant_id=PLANT,
                current_user=OWNER,
            )
        _fail_use(partial, "PARTIAL_REJECTION_UNSUPPORTED", status=400)
    finally:
        db.close()


def test_qct066_ui_seed():
    db = Session()
    try:
        token = uuid.uuid4().hex[:8]
        item = _item(db, token)
        loc = _location(db, token)
        batch = _batch(db, item, loc, 1000, "QC_HOLD", token)
        inspection = _inspection(db, batch)
        customer_ok = uuid.uuid4()
        order_ok = uuid.uuid4()
        expires_at = datetime.utcnow() + timedelta(days=7)
        db.commit()
        result = create_quality_concession(
            QualityConcessionCreate(
                inspection_id=inspection.id,
                reason="authorized 600 kg for one customer/order",
                quantity=600,
                release_stock=True,
                operation_id=f"qct066-ui-{token}",
                permitted_customer_id=customer_ok,
                permitted_sales_order_id=order_ok,
                expires_at=expires_at,
            ),
            db=db,
            plant_id=PLANT,
            current_user=OWNER,
        )
        assert result.measured_status == "FAIL"
        assert result.released_stock_status == "CONCESSION"
        artifact = {
            "inspection_id": str(inspection.id),
            "concession_id": str(result.concession_id),
            "item_id": str(item.id),
            "released_entity_id": str(result.released_entity_id),
            "residual_entity_id": str(batch.id),
            "customer_id": str(customer_ok),
            "sales_order_id": str(order_ok),
            "other_customer_id": str(uuid.uuid4()),
            "other_sales_order_id": str(uuid.uuid4()),
            "expires_at": expires_at.isoformat(),
            "quantity": 600,
            "residual_qty": 400,
            "plant_id": PLANT,
            "measured_status": "FAIL",
            "released_stock_status": "CONCESSION",
        }
        (_reports() / "qct066-ui.json").write_text(json.dumps(artifact), encoding="utf8")
    finally:
        db.close()
