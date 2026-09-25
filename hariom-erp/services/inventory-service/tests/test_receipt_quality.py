"""Real database checks for independent commercial and physical lot QC controls."""
import os
import uuid
from datetime import date
import pytest
if 'procurement_test' not in os.environ.get('DATABASE_URL', ''):
    pytest.skip('Requires isolated procurement_test database', allow_module_level=True)
from src.database import SessionLocal
from src.models import ItemMaster, PaperReel, InventoryQualityHold
from src.routers.manual_receipts import ManualReceiptCreate, post_manual_receipt, approve_manual_receipt
from src.routers.procurement import VersionAction
from src.routers.quality import QualityInspectionCreate, create_quality_inspection

PLANT = '00000000-0000-0000-0000-0000000000a1'
MAKER = {'sub': 'receipt-maker', 'roles': ['Store']}
CHECKER = {'sub': 'receipt-checker', 'roles': ['PlantManager']}
QC = {'sub': 'qc-inspector', 'roles': ['QC']}


def receipt(db):
    item = ItemMaster(item_code=f'QC-GATE-{uuid.uuid4().hex[:8]}', name='QC gated paper', type='RAW_PAPER',
        tracking_mode='REEL', uom='KG', plant_id=PLANT, quality_profile={'status':'approved','revision':1,
        'parameters':[{'code':'gsm','min':200,'max':260}]})
    db.add(item); db.commit()
    payload = ManualReceiptCreate(request_id=uuid.uuid4(), supplier_id=uuid.uuid4(), supplier_name='Isolated mill',
        reason='Isolated acceptance receipt', received_date=date.today(), invoice_no=uuid.uuid4().hex,
        invoice_date=date.today(), lines=[{'item_id':item.id, 'invoice_rate':30, 'incoming_qc_required':False,
        'lots':[{'source_reel_no':f'LOT-{n}','net_weight_kg':100,'width_mm':800,'physical_form':'REEL'} for n in range(2)]}])
    result=post_manual_receipt(payload, db, PLANT, MAKER)
    return result, [uuid.UUID(lot['id']) for lot in result['lots']]


def inspect(db, reel_id):
    return create_quality_inspection(QualityInspectionCreate(entity_type='REEL', entity_id=reel_id,
        readings={'gsm':230}, disposition='ACCEPT'), db, PLANT, QC)


def approve(db, result):
    return approve_manual_receipt(uuid.UUID(result['id']), VersionAction(expected_version=1,
        reason='Independent commercial approval'), db, PLANT, CHECKER)


def test_qc_before_commercial_remains_blocked_and_other_lot_remains_held():
    with SessionLocal() as db:
        result, ids=receipt(db)
        assert all(db.get(PaperReel, i).inward_metadata['quality_profile']['revision']==1 for i in ids)
        verdict=inspect(db,ids[0])
        assert verdict.status=='PASS' and db.get(PaperReel,ids[0]).stock_status=='BLOCKED'
        approve(db,result)
        assert db.get(PaperReel,ids[0]).stock_status=='UNRESTRICTED'
        assert db.get(PaperReel,ids[1]).stock_status=='QC_HOLD'
        inspect(db,ids[1])
        assert db.get(PaperReel,ids[1]).stock_status=='UNRESTRICTED'


def test_commercial_before_qc_does_not_clear_independent_hold():
    with SessionLocal() as db:
        result,ids=receipt(db)
        approve(db,result)
        assert all(db.get(PaperReel,i).stock_status=='QC_HOLD' for i in ids)
        db.add(InventoryQualityHold(plant_id=PLANT,entity_type='REEL',entity_id=ids[0],quantity=100,
            reason='Independent damage hold',status='HOLD',hold_kind='MANUAL',created_by='owner'))
        db.commit()
        verdict=inspect(db,ids[0])
        assert verdict.status=='PASS' and db.get(PaperReel,ids[0]).stock_status=='QC_HOLD'
        inspect(db,ids[1])
        assert db.get(PaperReel,ids[1]).stock_status=='UNRESTRICTED'


def test_residual_demand_counts_only_accepted_allocated_fg_and_caps_physical_balance():
    from src.models import StockBatch, StockTransaction, Reservation, TransactionType, ReferenceType
    from src.routers.ledger import material_issues_by_job
    with SessionLocal() as db:
        spec_id=uuid.uuid4();line_id=uuid.uuid4();job_id=uuid.uuid4()
        item=ItemMaster(item_code=f'FG-DEMAND-{uuid.uuid4().hex[:8]}',name='Demand FG',type='FINISHED_GOOD',tracking_mode='BULK',uom='PCS',plant_id=PLANT,active='true')
        db.add(item);db.flush()
        for status in ['UNRESTRICTED','QC_HOLD']:
            batch=StockBatch(item_id=item.id,batch_no=uuid.uuid4().hex,received_qty=100,plant_id=PLANT,stock_status=status,spec_id=spec_id)
            db.add(batch);db.flush()
            db.add(StockTransaction(item_id=item.id,batch_id=batch.id,plant_id=PLANT,transaction_type=TransactionType.FG_INWARD,qty_change=100,stock_status=status,reference_type=ReferenceType.PRODUCTION_JOB,reference_id=job_id))
            db.add(Reservation(sales_order_id=uuid.uuid4(),sales_order_line_id=line_id,item_id=item.id,batch_id=batch.id,spec_id=spec_id,reserved_qty=150,consumed_qty=0,status='ACTIVE',plant_id=PLANT,created_by='test'))
        db.commit()
        snapshot=material_issues_by_job(db,{'scope_all':False,'selected_plant_id':PLANT},QC)
        allocations=[row for row in snapshot['accepted_fg_allocations'] if row['line_id']==str(line_id)]
        assert len(allocations)==1
        assert allocations[0]['quantity_pcs']==100
        assert allocations[0]['source_job_ids']==[str(job_id)]
        isolated=material_issues_by_job(db,{'scope_all':False,'selected_plant_id':'00000000-0000-0000-0000-0000000000b1'},QC)
        assert not any(row['line_id']==str(line_id) for row in isolated['accepted_fg_allocations'])


def _outbox_task(db, event_id):
    import json
    from sqlalchemy import text
    row = db.execute(text('SELECT body, delivered_at FROM audit_outbox WHERE id = :id'), {'id': event_id}).mappings().one()
    return json.loads(row['body']), row['delivered_at']


class _AuthTransport:
    """Stands in for auth-service: records notification and audit posts."""
    def __init__(self):
        self.notifications, self.audits = [], []

    def post(self, url, json, headers, timeout):
        (self.notifications if url.endswith('/notifications/events') else self.audits).append(json)
        return type('Response', (), {'status_code': 200})()


def _run_relay(transport):
    import sys
    from pathlib import Path
    from src.database import engine
    shared = str(Path(__file__).resolve().parents[3] / 'shared')
    if shared not in sys.path:
        sys.path.insert(0, shared)
    from audit_relay import deliver_batch
    while deliver_batch(engine, 'http://auth/audit-events/ingest', 'test-token', transport=transport,
                        notify_endpoint='http://auth/notifications/events'):
        pass


def _assert_one_task_per_reel_and_relay_notifies_qc(db, reel_ids, receipt_id):
    event_ids = []
    for reel_id in reel_ids:
        task = db.get(PaperReel, reel_id).inward_metadata['incoming_qc_task']
        assert task['status'] == 'PENDING'
        body, delivered_at = _outbox_task(db, task['outbox_event_id'])
        assert delivered_at is None
        assert body['event_type'] == 'INCOMING_QC_TASK_DELIVERY'
        assert body['payload']['reel_id'] == str(reel_id) and 'batch_id' not in body['payload']
        assert body['payload']['receipt_id'] == str(receipt_id)
        assert body['notify']['recipient_roles'] == ['QC'] and body['notify']['href'] == '/quality/incoming'
        event_ids.append(task['outbox_event_id'])
    assert len(set(event_ids)) == len(reel_ids)
    first = _AuthTransport()
    _run_relay(first)
    notices = {row['event_id']: row for row in first.notifications if row['event_id'] in event_ids}
    assert set(notices) == set(event_ids)
    assert all(row['plant_id'] == PLANT and row['recipient_roles'] == ['QC'] for row in notices.values())
    assert {row['payload']['reel_id'] for row in notices.values()} == {str(reel_id) for reel_id in reel_ids}
    for reel_id, event_id in zip(reel_ids, event_ids):
        assert _outbox_task(db, event_id)[1] is not None
        reel = db.get(PaperReel, reel_id)
        db.refresh(reel)
        # Notifying QC never releases stock; only a QC verdict can.
        assert reel.stock_status in {'QC_HOLD', 'BLOCKED'}
    second = _AuthTransport()
    _run_relay(second)
    assert not set(event_ids) & {row['event_id'] for row in second.notifications}


def test_manual_reel_receipt_queues_one_qc_task_per_held_reel():
    with SessionLocal() as db:
        result, ids = receipt(db)
        _assert_one_task_per_reel_and_relay_notifies_qc(db, ids, result['id'])


def test_po_reel_receipt_queues_one_qc_task_per_held_reel():
    from src.models import PurchaseOrderRevision
    from src.routers.procurement import GovernedReceiptCreate, post_governed_receipt
    from src.routers.purchase import (PurchaseOrderCreate, RevisionActionPayload, approve_purchase_order,
        create_purchase_order, submit_purchase_order)
    with SessionLocal() as db:
        item = ItemMaster(item_code=f'QC-PO-{uuid.uuid4().hex[:8]}', name='QC gated PO paper', type='RAW_PAPER',
            tracking_mode='REEL', uom='KG', plant_id=PLANT, quality_profile={'status': 'approved', 'revision': 1,
            'parameters': [{'code': 'gsm', 'min': 200, 'max': 260}]})
        db.add(item); db.commit()
        created = create_purchase_order(PurchaseOrderCreate(request_id=uuid.uuid4(), supplier_id=uuid.uuid4(),
            supplier_name='Reel task mill', lines=[{'item_id': item.id, 'qty_ordered': 500, 'unit_cost': 30}]), db, PLANT, MAKER)
        revision = db.query(PurchaseOrderRevision).filter_by(purchase_order_id=created['id']).one()
        submitted = submit_purchase_order(created['id'], RevisionActionPayload(expected_version=created['version'],
            content_hash=revision.content_hash, reason='Ready'), db, PLANT, MAKER)
        approve_purchase_order(created['id'], RevisionActionPayload(expected_version=submitted['version'],
            content_hash=revision.content_hash, reason='Approved'), db, PLANT, CHECKER)
        posted = post_governed_receipt(GovernedReceiptCreate(request_id=uuid.uuid4(), purchase_order_id=created['id'],
            received_date=date.today(), invoice_no=uuid.uuid4().hex, invoice_date=date.today(),
            lines=[{'po_line_id': uuid.UUID(created['lines'][0]['id']), 'invoice_rate': 30, 'lots': [
                {'source_reel_no': f'PO-LOT-{uuid.uuid4().hex[:6]}-{n}', 'net_weight_kg': 100, 'width_mm': 800}
                for n in range(3)]}]), db, PLANT, MAKER)
        ids = [uuid.UUID(lot['id']) for lot in posted['created_lots']]
        assert len(ids) == 3
        assert all(db.get(PaperReel, i).stock_status == 'QC_HOLD' for i in ids)
        _assert_one_task_per_reel_and_relay_notifies_qc(db, ids, posted['id'])
