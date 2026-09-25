from datetime import date, datetime, timezone
from types import SimpleNamespace
import uuid
from src.due_risk import plant_today
from src.routers import dispatch


def test_challan_uses_india_calendar_after_utc_midnight_boundary(monkeypatch):
    today=plant_today(datetime(2026,9,21,19,25,tzinfo=timezone.utc))
    assert today==date(2026,9,22)
    monkeypatch.setattr(dispatch,'plant_today',lambda:today)
    assert dispatch._dispatch_ref({},uuid.uuid4(),'stable-key').startswith('DC-20260922-')
    assert dispatch._dispatch_ref({'date':'2026-09-20'},uuid.uuid4(),'stable-key').startswith('DC-20260920-')


def test_inventory_post_keeps_frozen_dispatch_date_across_retry(monkeypatch):
    sent=[]
    class Client:
        def __init__(self,**kwargs):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def post(self,url,**kwargs):
            sent.append(kwargs['json'])
            return SimpleNamespace(status_code=200,json=lambda:{'transaction_id':'same-transaction'})
    monkeypatch.setattr(dispatch.httpx,'Client',Client)
    monkeypatch.setattr(dispatch,'plant_today',lambda:date(2026,9,23))
    job=SimpleNamespace(id=uuid.uuid4(),sales_order_id=None,sales_order_line_id=None)
    packing=SimpleNamespace(fg_item_id=uuid.uuid4(),snapshot={'inventory_batch_id':str(uuid.uuid4())})
    snapshot={'date':'2026-09-22','dispatch_request_id':'same-request'}
    dispatch._post_inventory_dispatch_if_needed(dispatch=SimpleNamespace(id=uuid.uuid4()),job_card=job,packing_record=packing,snapshot=snapshot,dispatch_qty=64,dispatch_ref='same-challan',token='test',plant_id='plant')
    assert sent[0]['effective_date']=='2026-09-22'
