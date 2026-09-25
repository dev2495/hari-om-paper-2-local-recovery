"""Actual PO commitments, split GRN allocation, retries and dated revision conservation."""
import os
import uuid
from datetime import date
from unittest.mock import patch
import pytest
if 'procurement_test' not in os.environ.get('DATABASE_URL',''):
    pytest.skip('Isolated procurement_test database required', allow_module_level=True)
from fastapi import HTTPException
from src.database import SessionLocal
from src.models import PurchaseLineSchedule, ReceiptScheduleAllocation, PurchaseReceipt
from src.routers.purchase import (SupplierScheduleCommit, SupplierScheduleUpdate,
    commit_supplier_schedules, update_supplier_schedule)
from src.routers.procurement import GovernedReceiptCreate, post_governed_receipt
from test_procurement_postgres import _create_approved_po, PLANT, MAKER, CHECKER


def test_partial_receipt_spans_commitments_and_cancel_replace_conserves_the_po():
    with SessionLocal() as db, patch('src.routers.purchase.emit_audit_event'):
        po = _create_approved_po(db,supplier_id=uuid.uuid4(),quantity=100)
        line_id = uuid.UUID(po['lines'][0]['id'])
        result = commit_supplier_schedules(po['id'],SupplierScheduleCommit(rows=[
            {'purchase_order_line_id':line_id,'scheduled_qty':40,'promised_date':date(2026,9,21),'confirmation_status':'CONFIRMED'},
            {'purchase_order_line_id':line_id,'scheduled_qty':60,'promised_date':date(2026,9,25),'confirmation_status':'CONFIRMED'}]),db,PLANT,MAKER)
        payload = GovernedReceiptCreate(request_id=uuid.uuid4(),purchase_order_id=po['id'],received_date=date(2026,9,21),invoice_no=uuid.uuid4().hex,invoice_date=date(2026,9,21),lines=[{
            'po_line_id':line_id,'invoice_quantity':50,'invoice_rate':30,
            'lots':[{'source_reel_no':uuid.uuid4().hex,'net_weight_kg':50,'width_mm':120}]}])
        receipt = post_governed_receipt(payload,db,PLANT,MAKER)
        replay = post_governed_receipt(payload,db,PLANT,MAKER)
        assert replay['id'] == receipt['id'] and replay['idempotent']
        db.expire_all()
        saved = db.get(PurchaseReceipt,uuid.UUID(receipt['id']))
        allocations=db.query(ReceiptScheduleAllocation).filter_by(receipt_line_id=saved.lines[0].id).all()
        assert sorted(row.allocated_qty for row in allocations)==[10,40]
        second_id=uuid.UUID(result['items'][1]['id'])
        before_version = db.get(PurchaseLineSchedule, second_id).version
        revised=update_supplier_schedule(second_id,SupplierScheduleUpdate(expected_version=before_version,current_date=date(2026,9,27),confirmation_status='CONFIRMED',reason='Mill reconfirmed arrival'),db,PLANT,CHECKER)
        assert revised['change_history'][0]['reason']=='Mill reconfirmed arrival'
        assert revised['change_history'][0]['previous_date']=='2026-09-25'
        assert revised['promised_date']=='2026-09-25' and revised['current_date']=='2026-09-27'
        with pytest.raises(HTTPException) as stale:
            update_supplier_schedule(second_id,SupplierScheduleUpdate(expected_version=1,current_date=date(2026,9,28),confirmation_status='CONFIRMED',reason='Stale calendar edit'),db,PLANT,MAKER)
        assert stale.value.status_code==409
        db.rollback()
        cancelled=update_supplier_schedule(second_id,SupplierScheduleUpdate(expected_version=revised['version'],current_date=date(2026,9,27),confirmation_status='CANCELLED',reason='Replace outstanding commitment'),db,PLANT,CHECKER)
        assert cancelled['cancelled_qty']==50 and cancelled['allocated_qty']==10
        replacement=commit_supplier_schedules(po['id'],SupplierScheduleCommit(rows=[{'purchase_order_line_id':line_id,'scheduled_qty':50,'promised_date':date(2026,9,30)}]),db,PLANT,MAKER)
        assert replacement['items'][0]['remaining_qty']==50
        with pytest.raises(HTTPException):
            commit_supplier_schedules(po['id'],SupplierScheduleCommit(rows=[{'purchase_order_line_id':line_id,'scheduled_qty':1,'promised_date':date(2026,9,30)}]),db,PLANT,MAKER)
        db.rollback()
        assert sum(row.allocated_qty for row in db.query(ReceiptScheduleAllocation).filter_by(receipt_line_id=saved.lines[0].id))==50
