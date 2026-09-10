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
