"""Client procurement acceptance on a disposable PostgreSQL database."""
import os, uuid
from datetime import date, datetime, timedelta
from io import BytesIO
from unittest.mock import patch
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
if 'procurement_test' not in os.environ.get('DATABASE_URL',''):
    pytest.skip('Disposable procurement database required', allow_module_level=True)
from src.database import SessionLocal
from src.models import ItemMaster, PurchaseOrderRevision, PurchaseRequisition, StockBatch, StockTransaction
from src.routers.purchase import PurchaseOrderCreate, RevisionActionPayload, create_purchase_order, submit_purchase_order, approve_purchase_order, create_purchase_order_revision
from src.routers.requisitions import RequisitionCreate, RequisitionDecision, create_requisition, decide_requisition
from src.routers.items import ItemCreate, create_item
from src.routers.issue import IssueCreate, create_issue
from src.routers.quality import _incoming_deadline, QualityInspectionCreate, create_quality_inspection
from src.routers.ledger import aggregate_transactions_by_item
from src.services.procurement_documents import build_lot_label_pdf
PLANT=str(uuid.uuid4())
USER={'sub':'employee@acceptance.test','roles':['Production']}
STORE={'sub':'store@acceptance.test','roles':['Store']}
OWNER={'sub':'owner@acceptance.test','roles':['Owner']}
ADMIN={'sub':'admin@acceptance.test','roles':['Admin']}
QC={'sub':'qc@acceptance.test','roles':['QC']}
def item(db, kind='TOOL', uom='PCS'):
    value=ItemMaster(item_code=uuid.uuid4().hex,name='Acceptance '+kind,type=kind,uom=uom,tracking_mode='BULK',plant_id=PLANT,active='true',quality_profile={'status':'approved','revision':1,'parameters':[{'code':'check','min':1,'max':2}]})
    db.add(value);db.commit();return value

def test_requisition_roles_retry_cross_plant_conversion_and_no_bypass():
    with SessionLocal() as db, patch('src.routers.purchase.emit_audit_event'):
        tool=item(db)
        po=PurchaseOrderCreate(request_id=uuid.uuid4(),category='OT',supplier_id=uuid.uuid4(),supplier_name='Tools vendor',lines=[{'item_id':tool.id,'qty_ordered':3,'unit_cost':200,'uom':'PCS'}])
        with pytest.raises(HTTPException) as missing: create_purchase_order(po,db,PLANT,STORE)
        assert missing.value.status_code==422
        # A misleading RM/PM category cannot evade requisition governance.
        with pytest.raises(HTTPException): create_purchase_order(po.model_copy(update={'category':'RM_PM'}),db,PLANT,STORE)
        req=RequisitionCreate(request_id=uuid.uuid4(),pr_date=date.today(),item_id=tool.id,quantity=3,reason='Replacement worn tooling')
        saved=create_requisition(req,db,PLANT,USER)
        assert create_requisition(req,db,PLANT,USER)['id']==saved['id']
        decision=RequisitionDecision(expected_version=1,decision='APPROVED',reason='Required for production')
        with pytest.raises(HTTPException) as denied: decide_requisition(uuid.UUID(saved['id']),decision,db,PLANT,ADMIN)
        assert denied.value.status_code==403
        with pytest.raises(HTTPException) as cross: decide_requisition(uuid.UUID(saved['id']),decision,db,str(uuid.uuid4()),OWNER)
        assert cross.value.status_code==404
        approved=decide_requisition(uuid.UUID(saved['id']),decision,db,PLANT,OWNER)
        assert approved['requested_by']==USER['sub']
        po=po.model_copy(update={'requisition_id':uuid.UUID(saved['id'])})
        created=create_purchase_order(po,db,PLANT,STORE)
        assert create_purchase_order(po,db,PLANT,STORE)['id']==created['id']
        assert db.get(PurchaseRequisition,uuid.UUID(saved['id'])).status=='CONVERTED'
        with pytest.raises(HTTPException) as duplicate: create_purchase_order(po.model_copy(update={'request_id':uuid.uuid4()}),db,PLANT,STORE)
        assert duplicate.value.status_code==409
        rev=db.query(PurchaseOrderRevision).filter_by(purchase_order_id=created['id']).one()
        submitted=submit_purchase_order(created['id'],RevisionActionPayload(expected_version=1,reason='Terms checked'),db,PLANT,STORE)
        with pytest.raises(HTTPException) as denied: approve_purchase_order(created['id'],RevisionActionPayload(expected_version=submitted['version']),db,PLANT,ADMIN)
        assert denied.value.status_code==403
        final=approve_purchase_order(created['id'],RevisionActionPayload(expected_version=submitted['version']),db,PLANT,OWNER)
        assert final['status']=='APPROVED' and final['metadata_json']['pr_no']==saved['pr_no']

def test_litre_master_requires_density_and_po_unit_matches():
    with SessionLocal() as db, patch('src.routers.items.emit_audit_event'):
        with pytest.raises(HTTPException): create_item(ItemCreate(item_code=uuid.uuid4().hex,name='Glue',type='ADHESIVE',uom='L'),db,PLANT,ADMIN)
        glue=create_item(ItemCreate(item_code=uuid.uuid4().hex,name='Glue litres',type='ADHESIVE',uom='L',density_kg_per_litre=1.2),db,PLANT,ADMIN)
        assert float(glue.density_kg_per_litre)==1.2
        po=PurchaseOrderCreate(request_id=uuid.uuid4(),supplier_id=uuid.uuid4(),supplier_name='Glue supplier',lines=[{'item_id':glue.id,'qty_ordered':10,'unit_cost':200,'uom':'KG'}])
        with pytest.raises(HTTPException) as mismatch: create_purchase_order(po,db,PLANT,STORE)
        assert mismatch.value.status_code==422
        db.rollback()

def test_qc_failure_can_be_recorded_hold_pass_and_department_enforced():
    with SessionLocal() as db:
        glue=item(db,'ADHESIVE','KG')
        batch=StockBatch(item_id=glue.id,batch_no=uuid.uuid4().hex,received_qty=10,plant_id=PLANT,stock_status='QC_HOLD',inward_metadata={'quality_profile':glue.quality_profile})
        db.add(batch);db.commit()
        payload=QualityInspectionCreate(entity_type='BATCH',entity_id=batch.id,readings={'check':9})
        with pytest.raises(HTTPException) as unauthorized: create_quality_inspection(payload,db,PLANT,STORE)
        assert unauthorized.value.status_code==403
        failed=create_quality_inspection(payload,db,PLANT,QC)
        assert failed.status=='FAIL' and db.get(StockBatch,batch.id).stock_status=='QC_HOLD'
        held=create_quality_inspection(payload.model_copy(update={'readings':{'check':1.5},'disposition':'HOLD'}),db,PLANT,QC)
        assert held.status=='PASS' and db.get(StockBatch,batch.id).stock_status=='QC_HOLD'
        assert _incoming_deadline(datetime.utcnow()-timedelta(hours=25))['overdue']
        assert not _incoming_deadline(datetime.utcnow())['overdue']

def test_issue_rejects_negative_and_wrong_item_batch_and_nets_returns():
    with pytest.raises(ValidationError): IssueCreate(item_id=uuid.uuid4(),qty=-1,production_job_id=uuid.uuid4(),reason_code='NON_RECIPE_CONSUMABLE')
    with SessionLocal() as db:
        first,second=item(db,'ADHESIVE','KG'),item(db,'ADHESIVE','KG')
        b1=StockBatch(item_id=first.id,batch_no=uuid.uuid4().hex,received_qty=20,plant_id=PLANT,stock_status='UNRESTRICTED')
        b2=StockBatch(item_id=second.id,batch_no=uuid.uuid4().hex,received_qty=20,plant_id=PLANT,stock_status='UNRESTRICTED')
        db.add_all([b1,b2]);db.flush()
        for b in (b1,b2): db.add(StockTransaction(item_id=b.item_id,batch_id=b.id,plant_id=PLANT,transaction_type='INWARD',qty_change=20,stock_status='UNRESTRICTED',reference_type='INTERNAL',reference_id=str(uuid.uuid4()),effective_date=date.today()))
        db.commit()
        with pytest.raises(HTTPException) as wrong: create_issue(IssueCreate(item_id=first.id,batch_id=b2.id,qty=1,production_job_id=uuid.uuid4(),reason_code='NON_RECIPE_CONSUMABLE'),db,PLANT,STORE)
        assert wrong.value.status_code==404
        for typ,qty in [('ISSUE_PRODUCTION',-10),('PRODUCTION_RETURN',3)]: db.add(StockTransaction(item_id=first.id,batch_id=b1.id,plant_id=PLANT,transaction_type=typ,qty_change=qty,stock_status='UNRESTRICTED',reference_type='INTERNAL',reference_id=str(uuid.uuid4()),effective_date=date.today()))
        db.commit()
        rows=aggregate_transactions_by_item(date.today(),date.today(),'ISSUE_PRODUCTION,ISSUE_FROM_REEL',db,{'selected_plant_id':PLANT},STORE)
        assert next(row for row in rows if row['item_id']==str(first.id))['issued_kg']==7

def test_a4_has_eight_labels_per_page_and_thermal_keeps_physical_size():
    import re
    labels=[{'amigo_no':f'AT {index:05}', 'qr_value':f'HARIOM|REEL|{PLANT}|{uuid.uuid4()}|AT-{index}', 'qty':1176,'item_code':'PAPER','gsm':351,'supplier_name':'VATSALYA','source_reel_no':str(75127+index),'inward_date':'2026-09-28'} for index in range(9)]
    a4=build_lot_label_pdf(labels,1,'PAPER_LOT_A4')
    assert re.search(rb"/Count\s+2\b", a4)
    thermal=build_lot_label_pdf(labels[:1],2)
    assert re.search(rb"/Count\s+2\b", thermal)
    assert re.search(rb"/MediaBox\s*\[\s*0\s+0\s+288\s+144\s*\]", thermal)


def test_bulk_returns_are_linked_idempotent_and_cannot_overcredit():
    from src.routers.issue import ProductionReturnCreate, return_from_production, list_returnable_issues
    from concurrent.futures import ThreadPoolExecutor
    with SessionLocal() as db:
        material=item(db, 'ADHESIVE', 'KG')
        batch=StockBatch(item_id=material.id,batch_no=uuid.uuid4().hex,received_qty=20,plant_id=PLANT,stock_status='UNRESTRICTED')
        db.add(batch);db.flush()
        original=StockTransaction(item_id=material.id,batch_id=batch.id,plant_id=PLANT,transaction_type='ISSUE_PRODUCTION',qty_change=-10,stock_status='UNRESTRICTED',reference_type='PRODUCTION_JOB',reference_id=str(uuid.uuid4()),effective_date=date.today())
        db.add(original);db.commit();issue_id=original.id
        payload=ProductionReturnCreate(request_id=uuid.uuid4(),issue_id=issue_id,quantity=3,effective_date=date.today(),reason='Unused adhesive')
        saved=return_from_production(payload,db,PLANT,STORE)
        assert return_from_production(payload,db,PLANT,STORE)['transaction_id']==saved['transaction_id']
        with pytest.raises(HTTPException) as changed:
            return_from_production(payload.model_copy(update={'quantity':4}),db,PLANT,STORE)
        assert changed.value.status_code==409
        db.rollback()
        assert next(row for row in list_returnable_issues(db,PLANT,STORE)['items'] if row['id']==str(issue_id))['returnable']==7
    def attempt(_):
        with SessionLocal() as db:
            try:
                return_from_production(payload.model_copy(update={'request_id':uuid.uuid4(),'quantity':5}),db,PLANT,STORE)
                return 'saved'
            except HTTPException as exc:
                assert exc.status_code==409
                return 'conflict'
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(attempt,range(2)))==['conflict','saved']
