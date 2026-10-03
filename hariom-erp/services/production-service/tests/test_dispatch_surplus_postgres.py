"""Real card reconciliation leaves excess FG distinct from shipped quantities."""
import os
import uuid
from datetime import date
from unittest.mock import patch

import pytest
from fastapi import HTTPException

pytestmark = pytest.mark.skipif("hardening_test" not in os.getenv("DATABASE_URL", ""), reason="Disposable PostgreSQL only")
A = "00000000-0000-0000-0000-0000000000a1"
USER = {"sub": "surplus-test", "roles": ["Owner"], "allowed_plants": [A]}


@pytest.fixture
def record():
    from src.database import Base, engine, SessionLocal
    from src.models import Dispatch, JobCard, JobCardStage, PackingRecord, SalesOrder
    from src.routers import dispatch_surplus as api
    Base.metadata.create_all(engine)
    conn = engine.connect(); transaction = conn.begin()
    db = SessionLocal(bind=conn, join_transaction_mode="create_savepoint")
    order = SalesOrder(plant_id=uuid.UUID(A), customer_id=uuid.uuid4(), spec_id=uuid.uuid4(), order_qty=100, due_date=date.today())
    db.add(order); db.flush()
    job = JobCard(plant_id=uuid.UUID(A), sales_order_id=order.id, spec_id=order.spec_id,
                  planned_qty=100, released_qty=100, spec_snapshot={"entry_model": "V2"}, routing_snapshot={"stages": ["PACKING", "QC", "DISPATCH"]}, status="IN_PROGRESS", current_stage="DISPATCH")
    db.add(job); db.flush()
    db.add_all([JobCardStage(job_card_id=job.id, stage_type=name, output_qty=110 if name in ("PACKING","QC") else 100, status="COMPLETED" if name != "DISPATCH" else "RUNNING") for name in ("PACKING", "QC", "DISPATCH")])
    db.add(PackingRecord(job_card_id=job.id, total_packed_qty=110, fg_item_id=uuid.uuid4(), snapshot={"inventory_batch_id": str(uuid.uuid4())}))
    shipment = Dispatch(job_card_id=job.id, status="SEALED", dispatch_snapshot={"dispatch_qty": 100})
    db.add(shipment); db.commit()
    with patch.object(api, "_require_final_qc") as qc, patch("httpx.Client", side_effect=AssertionError("Surplus must not post stock or sales")):
        yield api, db, job, shipment, qc
    db.close(); transaction.rollback(); conn.close()


def command(api, **changes):
    return api.RetainSurplusInput(**{"request_id": "surplus-" + str(uuid.uuid4()), "expected_remaining_qty": 10, "reason": "Retain excess FG for a future allocation", **changes})


def test_exact_retry_closes_card_with_one_audit_and_separate_retained_balance(record):
    from src.models import AuditEvent, Dispatch, JobCardStage
    from src.routers.dispatch import get_ready_jobs_for_dispatch, create_or_update_dispatch, DispatchPayload
    from src.utils.auth import _resolve_scope
    api, db, job, shipment, qc = record
    draft = Dispatch(job_card_id=job.id, status="DRAFT", dispatch_snapshot={"items": [{"total_pcs": 10}]})
    db.add(draft); db.commit()
    body = command(api)
    result = api.retain_surplus(job.id, body, db, A, USER)
    assert api.retain_surplus(job.id, body, db, A, USER) == result
    assert result["retained_qty"] == 10 and result["shipped_qty"] == 100
    assert job.status == "COMPLETED" and job.current_stage == "DONE"
    stage = db.query(JobCardStage).filter_by(job_card_id=job.id, stage_type="DISPATCH").one()
    assert stage.status == "COMPLETED" and stage.output_qty == 100
    assert stage.actuals_snapshot["retained_fg_qty"] == 10
    events = db.query(AuditEvent).filter_by(job_card_id=job.id, action="SURPLUS_FG_RETAINED").all()
    assert len(events) == 1 and events[0].payload["discarded_unposted_drafts"][0]["id"] == str(draft.id)
    assert db.query(Dispatch).filter_by(job_card_id=job.id).count() == 1
    row = next(r for r in get_ready_jobs_for_dispatch(db, _resolve_scope(USER, A, True), USER) if r["id"] == job.id)
    assert (row["remaining_qty"], row["physical_remaining_qty"], row["retained_qty"]) == (0, 10, 10)
    assert row["handoff_state"] == "RETAINED_FG"
    from src.routers.entries import flow
    derived = flow(db, job)
    stage_state = next(s for s in derived['stages'] if s['stage'] == 'DISPATCH')
    assert stage_state['status'] == 'COMPLETED' and stage_state['available_from_upstream'] == 0
    assert stage_state['accepted_total'] == 100 and stage_state['retained_fg_qty'] == 10
    assert 'DISPATCH' not in derived['active_stages'] and not stage_state['blockers']
    with pytest.raises(HTTPException) as error:
        create_or_update_dispatch(DispatchPayload(job_card_id=job.id, status="SEALED", dispatch_request_id=str(uuid.uuid4()), dispatch_snapshot={}, dispatch_qty=10), db, A, USER)
    assert error.value.status_code == 409


@pytest.mark.parametrize("case", ["stale", "unshipped", "unfinished", "hold", "cross-plant", "no-final-qc"])
def test_surplus_guards_prevent_premature_or_unsafe_card_close(record, case):
    from src.models import AuditEvent, Dispatch, QualityHold
    api, db, job, shipment, qc = record
    body = command(api, expected_remaining_qty=9 if case == "stale" else 10)
    if case == "unshipped": shipment.dispatch_snapshot = {"dispatch_qty": 90}
    if case == "unfinished": db.add(Dispatch(job_card_id=job.id, status="DRAFT", dispatch_snapshot={"orchestration_state": "FAILED"}))
    if case == "hold": db.add(QualityHold(plant_id=job.plant_id, job_card_id=job.id, stage_type="QC", status="HOLD", reason="Investigate surplus QC"))
    if case == "no-final-qc": qc.side_effect = HTTPException(409, "Final QC required")
    db.commit()
    with pytest.raises(HTTPException) as error:
        api.retain_surplus(job.id, body, db, "00000000-0000-0000-0000-0000000000b2" if case == "cross-plant" else A, USER)
    assert error.value.status_code in (404, 409)
    assert job.status == "IN_PROGRESS"
    assert not db.query(AuditEvent).filter_by(job_card_id=job.id).count()


def test_changed_settlement_under_same_request_is_rejected(record):
    api, db, job, shipment, qc = record
    body = command(api)
    api.retain_surplus(job.id, body, db, A, USER)
    with pytest.raises(HTTPException) as error:
        api.retain_surplus(job.id, body.model_copy(update={"reason": "Different decision after settlement"}), db, A, USER)
    assert error.value.status_code == 409


@pytest.mark.parametrize('accepted,gross,unused', [(40,45,0), (40,50,5), (0,45,0)])
def test_fg_inward_posts_only_final_qc_accepted_quantity(record, accepted,gross,unused):
    from src.completion_worker import post_accepted_fg
    from src.models import AuditEvent, JobCardStage, PackingRecord
    from src.routers.entries import flow
    from types import SimpleNamespace
    api, db, job, shipment, qc_gate = record
    db.delete(shipment)
    packing = db.query(PackingRecord).filter_by(job_card_id=job.id).one()
    packing.total_packed_qty = gross
    stages = {s.stage_type:s for s in db.query(JobCardStage).filter_by(job_card_id=job.id).all()}
    stage = stages['PACKING']; stage.output_qty = gross
    stage.entry_snapshot = {'fg_item_id':str(packing.fg_item_id)}
    qc = stages['QC']; qc.output_qty = accepted
    qc.actuals_snapshot = {'close_reason':'Rejected pieces segregated in final QC ledger','produced_total':45,'rejected_total':45-accepted}
    stages['DISPATCH'].actuals_snapshot = {'effective_target':accepted}
    packing.snapshot = {}
    db.commit()
    posted = []
    class Client:
        def __init__(self, **kwargs):pass
        def __enter__(self):return self
        def __exit__(self, *args):pass
        def post(self, url, **kwargs):
            posted.append(kwargs['json'])
            return SimpleNamespace(status_code=200, headers={'content-type':'application/json'}, json=lambda:{'batch_id':str(uuid.uuid4()),'transaction_id':str(uuid.uuid4()),'stock_status':'UNRESTRICTED'})
    with patch('httpx.Client', Client):
        post_accepted_fg(db, job, stage, packing, qc, {'sub':'production-effects-test','token':'test'})
        db.commit()
    assert packing.snapshot['fg_accepted_qty'] == accepted
    assert packing.snapshot['qc_rejected_qty'] == 45-accepted
    assert packing.snapshot['qc_uninspected_qty'] == unused
    if accepted:
        assert len(posted) == 1 and posted[0]['qty'] == 40
        assert job.status == 'IN_PROGRESS'
        with pytest.raises(HTTPException):
            api.retain_surplus(job.id, command(api, expected_remaining_qty=5), db, A, USER)
    else:
        assert not posted and job.status == 'COMPLETED'
        assert not packing.snapshot.get('inventory_batch_id')
        post_accepted_fg(db,job,stage,packing,qc,{'sub':'production-effects-test','token':'test'})
        db.commit()
        assert db.query(AuditEvent).filter_by(job_card_id=job.id,action='FINAL_QC_ZERO_ACCEPTANCE').count() == 1
    derived = next(s for s in flow(db,job)['stages'] if s['stage'] == 'DISPATCH')
    assert derived['dispatchable_qty'] == accepted and derived['qc_rejected_qty'] == 45-accepted
    assert derived['qc_uninspected_qty'] == unused
    assert derived['max_ship_qty'] == accepted
    if not accepted:assert derived['status'] == 'COMPLETED' and not derived['blockers']
