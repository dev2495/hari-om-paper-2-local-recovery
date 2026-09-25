import json
from types import SimpleNamespace
import pytest
from sqlalchemy import Column, String, create_engine, select
from sqlalchemy.orm import declarative_base, sessionmaker
from audit_outbox import install_outbox
from audit_relay import deliver_batch

@pytest.fixture
def workspace():
    base=declarative_base()
    class Record(base):
        __tablename__='orders'
        id=Column(String, primary_key=True)
        status=Column(String)
    engine=create_engine('sqlite://')
    factory=sessionmaker(bind=engine)
    outbox=install_outbox(base,factory,'test-service')
    base.metadata.create_all(engine)
    return engine,factory,Record,outbox

def test_business_and_history_commit_or_rollback_together(workspace):
    engine,factory,Record,outbox=workspace
    with factory() as db:
        db.add(Record(id='rollback',status='draft'));db.flush();db.rollback()
    with engine.connect() as conn:
        assert conn.execute(select(outbox)).all()==[]
    with factory() as db:
        db.add(Record(id='keep',status='draft'));db.commit()
        record=db.get(Record,'keep');record.status='approved';db.commit()
    with engine.connect() as conn:
        rows=conn.execute(select(outbox)).mappings().all()
        assert len(rows)==2
        update=json.loads(rows[1]['body'])
        assert update['payload']['before']['status']=='draft'
        assert update['payload']['after']['status']=='approved'

def test_failed_delivery_is_retained_and_retried_with_same_event_id(workspace):
    engine,factory,Record,outbox=workspace
    with factory() as db:
        db.add(Record(id='retry',status='approved'));db.commit()
    seen=[]
    class Transport:
        @staticmethod
        def post(url, json, **kwargs):
            seen.append(json['id'])
            if len(seen)==1: raise TimeoutError('network interrupted after receiver acceptance')
            return SimpleNamespace(status_code=200)
    with pytest.raises(TimeoutError): deliver_batch(engine,'internal','test-only',Transport)
    with engine.connect() as conn:
        assert conn.execute(select(outbox.c.delivered_at)).scalar() is None
    assert deliver_batch(engine,'internal','test-only',Transport)==1
    assert seen[0]==seen[1]
    assert deliver_batch(engine,'internal','test-only',Transport)==0


def _queue_task(engine, outbox, event_id='task-1'):
    from datetime import datetime
    body = {'id': event_id, 'occurred_at': '2026-09-25T00:00:00', 'source_service': 'inventory-service',
            'event_type': 'INCOMING_QC_TASK_DELIVERY', 'entity_type': 'purchase_receipt', 'entity_id': 'r1',
            'plant_id': 'PLANT_A', 'summary': 'Incoming QC task for GRN G1', 'payload': {'reel_id': 'reel-1'},
            'notify': {'title': 'Incoming QC: GRN G1', 'message': 'held', 'href': '/quality/incoming',
                       'recipient_roles': ['QC'], 'role_context': 'QC'}}
    with engine.begin() as conn:
        conn.execute(outbox.insert().values(id=event_id, occurred_at=datetime.utcnow(), body=json.dumps(body), attempts=0))


class _Recorder:
    def __init__(self, notify_status=200):
        self.calls, self.notify_status = [], notify_status

    def post(self, url, json, **kwargs):
        self.calls.append((url, json))
        return SimpleNamespace(status_code=self.notify_status if url == 'notify' else 200)


def test_notify_request_becomes_one_qc_notification_then_clean_audit_record(workspace):
    engine, factory, Record, outbox = workspace
    _queue_task(engine, outbox)
    transport = _Recorder()
    assert deliver_batch(engine, 'audit', 'test-only', transport, notify_endpoint='notify') == 1
    (notify_url, notice), (audit_url, audit) = transport.calls
    assert notify_url == 'notify' and audit_url == 'audit'
    assert notice['event_id'] == 'task-1' and notice['event_type'] == 'INCOMING_QC_TASK_DELIVERY'
    assert notice['recipient_roles'] == ['QC'] and notice['plant_id'] == 'PLANT_A'
    assert notice['href'] == '/quality/incoming' and notice['payload'] == {'reel_id': 'reel-1'}
    assert 'notify' not in audit and audit['id'] == 'task-1'
    assert deliver_batch(engine, 'audit', 'test-only', transport, notify_endpoint='notify') == 0


def test_failed_notification_keeps_task_pending_and_skips_audit(workspace):
    engine, factory, Record, outbox = workspace
    _queue_task(engine, outbox)
    failing = _Recorder(notify_status=503)
    with pytest.raises(RuntimeError):
        deliver_batch(engine, 'audit', 'test-only', failing, notify_endpoint='notify')
    assert [url for url, _ in failing.calls] == ['notify']
    with engine.connect() as conn:
        assert conn.execute(select(outbox.c.delivered_at)).scalar() is None
    with pytest.raises(RuntimeError):
        deliver_batch(engine, 'audit', 'test-only', _Recorder())  # no notification endpoint configured
    assert deliver_batch(engine, 'audit', 'test-only', _Recorder(), notify_endpoint='notify') == 1
