"""QC-rejected inward lots: queue state, return to supplier and the QUALITY debit-note claim."""
import os
import uuid
from datetime import date

import pytest

if 'procurement_test' not in os.environ.get('DATABASE_URL', ''):
    pytest.skip('Requires isolated procurement_test database', allow_module_level=True)

from fastapi import HTTPException

from src.database import SessionLocal
from src.models import InventoryQualityHold, ItemMaster, PaperReel, PurchaseDiscrepancy, PurchaseReceiptLine, ReceiptStockAllocation
from src.routers.manual_receipts import ManualReceiptCreate, approve_manual_receipt, post_manual_receipt
from src.routers.procurement import VersionAction
from src.routers.quality import (
    QualityInspectionCreate,
    SupplierReturnCreate,
    create_quality_inspection,
    list_pending_quality,
    return_rejected_lot_to_supplier,
)

PLANT = '00000000-0000-0000-0000-0000000000a1'
MAKER = {'sub': 'receipt-maker', 'roles': ['Store']}
CHECKER = {'sub': 'receipt-checker', 'roles': ['Owner']}
QC = {'sub': 'qc-inspector', 'roles': ['QC']}
STORE = {'sub': 'store-keeper', 'roles': ['Store']}
SCOPE = {'scope_all': False, 'selected_plant_id': PLANT, 'allowed_plants': [PLANT]}


def _receipt(db):
    item = ItemMaster(item_code=f'QC-RET-{uuid.uuid4().hex[:8]}', name='Return test paper', type='RAW_PAPER',
        tracking_mode='REEL', uom='KG', plant_id=PLANT, quality_profile={'status': 'approved', 'revision': 1,
        'parameters': [{'code': 'gsm', 'unit': 'g/m2', 'min': 200, 'max': 260}]})
    db.add(item); db.commit()
    payload = ManualReceiptCreate(request_id=uuid.uuid4(), supplier_id=uuid.uuid4(), supplier_name='Return mill',
        reason='Isolated return receipt', received_date=date.today(), invoice_no=uuid.uuid4().hex,
        invoice_date=date.today(), lines=[{'item_id': item.id, 'invoice_rate': 30, 'incoming_qc_required': False,
        'lots': [{'source_reel_no': f'RET-{uuid.uuid4().hex[:6]}-{n}', 'net_weight_kg': 100, 'width_mm': 800,
                  'physical_form': 'REEL'} for n in range(2)]}])
    result = post_manual_receipt(payload, db, PLANT, MAKER)
    approve_manual_receipt(uuid.UUID(result['id']), VersionAction(expected_version=1,
        reason='Independent commercial approval'), db, PLANT, CHECKER)
    return result, [uuid.UUID(lot['id']) for lot in result['lots']]


def _queue_row(db, reel_id):
    return next(row for row in list_pending_quality(db, SCOPE, QC) if row.entity_id == reel_id)


def test_rejected_reel_leaves_overdue_queue_and_returns_with_quality_claim():
    with SessionLocal() as db:
        result, (bad, good) = _receipt(db)
        awaiting = _queue_row(db, bad)
        assert awaiting.queue_state == 'AWAITING_INSPECTION'
        assert awaiting.grn_no == result['grn_no'] and awaiting.invoice_no

        # Returning before QC has rejected it is refused.
        with pytest.raises(HTTPException) as early:
            return_rejected_lot_to_supplier(SupplierReturnCreate(entity_type='REEL', entity_id=bad,
                reason='Looks wet'), db, PLANT, STORE)
        assert early.value.status_code == 409

        verdict = create_quality_inspection(QualityInspectionCreate(entity_type='REEL', entity_id=bad,
            readings={'gsm': 150}, reasons={'gsm': 'Mill supplied lighter grade'}, disposition='REJECT'), db, PLANT, QC)
        assert verdict.status == 'FAIL'
        rejected = _queue_row(db, bad)
        assert rejected.queue_state == 'REJECTED' and rejected.overdue is False
        assert rejected.last_inspection['status'] == 'FAIL'
        line_id = db.query(ReceiptStockAllocation).filter_by(reel_id=bad).one().receipt_line_id
        assert db.get(PurchaseReceiptLine, line_id).qc_status == 'REJECTED'

        done = return_rejected_lot_to_supplier(SupplierReturnCreate(entity_type='REEL', entity_id=bad,
            reason='GSM 150 against 200-260', return_reference='DC-778'), db, PLANT, STORE)
        assert done['stock_status'] == 'RETURNED' and done['returned_qty'] == 100
        assert done['claim_id'] and done['claim_amount'] == 3000.0
        db.expire_all()
        reel = db.get(PaperReel, bad)
        assert reel.current_weight_kg == 0 and reel.stock_status == 'RETURNED'
        assert reel.inward_metadata['supplier_return']['return_reference'] == 'DC-778'
        assert not db.query(InventoryQualityHold).filter_by(entity_id=bad, status='HOLD').count()
        claim = db.get(PurchaseDiscrepancy, uuid.UUID(done['claim_id']))
        assert claim.discrepancy_type == 'QUALITY' and claim.status == 'OPEN'
        assert all(row.entity_id != bad for row in list_pending_quality(db, SCOPE, QC))

        # The good reel on the same line is not blocked by the quality claim.
        create_quality_inspection(QualityInspectionCreate(entity_type='REEL', entity_id=good,
            readings={'gsm': 230}, disposition='ACCEPT'), db, PLANT, QC)
        db.expire_all()
        assert db.get(PaperReel, good).stock_status == 'UNRESTRICTED'

        with pytest.raises(HTTPException) as again:
            return_rejected_lot_to_supplier(SupplierReturnCreate(entity_type='REEL', entity_id=bad,
                reason='Second attempt'), db, PLANT, STORE)
        assert again.value.status_code == 409
