"""Real SQL paging, search and totals; transaction rolls back in the isolated clone."""
import os
import uuid
from datetime import datetime

import pytest
from sqlalchemy import event

if '_integration_' not in os.environ.get('DATABASE_URL', ''):
    pytest.skip('Requires the explicitly isolated integration database', allow_module_level=True)

from src.database import SessionLocal
from src.models import ItemMaster, PurchaseOrder, PurchaseOrderLine
from src.routers.purchase import list_purchase_orders

@pytest.fixture()
def seeded():
    db = SessionLocal()
    plant = 'REG-' + uuid.uuid4().hex[:16]
    item = db.query(ItemMaster).first()
    assert item, 'Existing isolated material fixture required'
    stamp = datetime(2026, 9, 21, 10)
    rows = []
    for index in range(105):
        order = PurchaseOrder(plant_id=plant, po_no=f'PAGING-{index:03}', supplier_id=uuid.uuid4(),
            supplier_name_snapshot='Vendor 100%' if index == 104 else 'Vendor ordinary',
            created_by='isolated-register-test', status='DRAFT', created_at=stamp)
        order.lines = [PurchaseOrderLine(item_id=item.id, uom='KG', qty_ordered=10, qty_received=1, qty_short_closed=2, unit_cost=2),
                       PurchaseOrderLine(item_id=item.id, uom='PCS', qty_ordered=3, qty_received=1, unit_cost=4)]
        rows.append(order)
    db.add_all(rows)
    db.add(PurchaseOrder(plant_id=plant+'-OTHER',po_no='PAGING-OTHER',supplier_id=uuid.uuid4(),supplier_name_snapshot='Other plant',created_by='test',status='DRAFT'))
    db.flush()
    yield db, plant, rows
    db.rollback();db.close()

def listing(db, plant, **kwargs):
    return list_purchase_orders(db=db,plant_id=plant,current_user={'role':'Admin'},
        q=kwargs.get('q'),status=kwargs.get('status'),limit=kwargs.get('limit',25),offset=kwargs.get('offset',0))

def test_pages_include_all_orders_and_have_stable_tie_breaker(seeded):
    db,plant,rows=seeded
    pages=[listing(db,plant,offset=offset) for offset in range(0,125,25)]
    ids=[str(row['id']) for page in pages for row in page['items']]
    assert len(ids)==len(set(ids))==105
    assert all(page['total']==105 for page in pages)
    assert len(pages[-1]['items'])==5
    assert pages[0]['summary']['open_by_uom']=={'KG':735.0,'PCS':210.0}
    assert pages[-1]['summary']==pages[0]['summary']

def test_search_finds_rows_beyond_first_page_and_escapes_wildcards(seeded):
    db,plant,rows=seeded
    result=listing(db,plant,q='100%')
    assert result['total']==1
    assert result['items'][0]['po_no']=='PAGING-104'
    assert result['summary']['open_by_uom']=={'KG':7.0,'PCS':2.0}
    assert listing(db,plant,q='_')['total']==0
    assert listing(db,plant,q='ordinary')['total']==104

def test_status_totals_and_cancellation_keep_units_separate(seeded):
    db,plant,rows=seeded
    rows[0].status='SUBMITTED';rows[1].status='APPROVED';rows[2].status='CANCELLED';db.flush()
    result=listing(db,plant)
    assert result['summary']['awaiting_approval']==1
    assert result['summary']['receivable']==1
    assert result['summary']['open_by_uom']=={'KG':728.0,'PCS':208.0}
    filtered=listing(db,plant,status='SUBMITTED')
    assert filtered['total']==1 and filtered['summary']['awaiting_approval']==1

def test_list_uses_bounded_relation_queries(seeded):
    db,plant,_=seeded
    db.expire_all()
    queries=[]
    def track(*args):queries.append(args[2])
    connection=db.connection()
    event.listen(connection,'before_cursor_execute',track)
    try:
        result=listing(db,plant,limit=50)
    finally:event.remove(connection,'before_cursor_execute',track)
    assert len(result['items'])==50
    assert len(queries)<=10, f'Expected batched relation loading, got {len(queries)} SQL queries'
