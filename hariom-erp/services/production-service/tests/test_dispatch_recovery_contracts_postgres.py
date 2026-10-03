"""Receiver checkpoints, commercial-line leases and immutable shipment identities."""
import os
import threading
import uuid
from datetime import date
from unittest.mock import patch

import pytest
from fastapi import HTTPException

if "hardening_test" not in os.getenv("DATABASE_URL", ""):
    pytest.skip("Requires isolated hardening_test PostgreSQL", allow_module_level=True)

from src.database import Base, engine, SessionLocal
from src.models import Dispatch, DispatchIdempotency, JobCard, PackingRecord, SalesOrder, PLANT_A_UUID
from src.routers import dispatch as api

USER = {"roles": ["Owner"], "token": "test", "sub": "dispatch-recovery-test"}
PLANT = str(PLANT_A_UUID)


def make_card(db, line_id=None, packed=100):
    order = SalesOrder(customer_id=uuid.uuid4(), spec_id=uuid.uuid4(), order_qty=100, due_date=date.today())
    db.add(order); db.flush()
    job = JobCard(sales_order_id=order.id, sales_order_line_id=line_id or uuid.uuid4(), spec_id=order.spec_id,
                  planned_qty=100, released_qty=100, status="IN_PROGRESS", current_stage="PACKING")
    db.add(job); db.flush()
    db.add(PackingRecord(job_card_id=job.id, total_packed_qty=packed, fg_item_id=uuid.uuid4(),
                         snapshot={"inventory_batch_id": str(uuid.uuid4())}))
    db.flush()
    return job


@pytest.fixture
def records():
    Base.metadata.create_all(engine)
    connection = engine.connect(); transaction = connection.begin()
    db = SessionLocal(bind=connection, join_transaction_mode="create_savepoint")
    yield db
    db.close(); transaction.rollback(); connection.close()


def command(job, qty=60, request_id=None, challan="USER-CHALLAN"):
    return api.DispatchPayload(job_card_id=job.id, status="SEALED", dispatch_qty=qty,
                               dispatch_request_id=request_id or str(uuid.uuid4()),
                               dispatch_snapshot={"challan_no": challan})


def test_lost_sales_commit_response_replays_the_exact_immutable_identity(records):
    db = records; job = make_card(db)
    request = command(job, qty=100, request_id="x" * 120)
    committed_sales = {}; inventory_keys = set(); calls = []
    def sales(**kw):
        ref = kw["payload"]["dispatch_line_ref"]
        calls.append((kw["path"], ref))
        if kw["path"].endswith("validate-dispatch"):
            if committed_sales:
                assert committed_sales[ref] == kw["payload"]["qty"]
            return {}
        if ref not in committed_sales:
            committed_sales[ref] = kw["payload"]["qty"]
            raise HTTPException(502, "Sales committed but response was lost")
        return {}
    def inventory(**kw):
        snap = kw["snapshot"]
        inventory_keys.add(snap["inventory_dispatch_external_ref"])
        assert len(snap["inventory_dispatch_external_ref"]) <= 120
        return {**snap, "inventory_dispatch_transaction_id": "one-posted-transaction"}
    with patch.object(api, "_require_final_qc"), patch.object(api, "_post_sales_request", side_effect=sales), patch.object(api, "_post_inventory_dispatch_if_needed", side_effect=inventory):
        with pytest.raises(HTTPException):
            api.create_or_update_dispatch(request, db, PLANT, USER)
        draft = db.query(Dispatch).filter_by(job_card_id=job.id).one()
        assert draft.status == "DRAFT" and draft.dispatch_snapshot["orchestration_state"] == "FAILED"
        response = api.create_or_update_dispatch(api.DispatchPayload.model_validate(draft.dispatch_snapshot["seal_request"]), db, PLANT, USER)
        assert response.status == "SEALED"
        assert api.create_or_update_dispatch(request, db, PLANT, USER).id == response.id
    assert len(committed_sales) == len(inventory_keys) == 1
    assert all(ref != "USER-CHALLAN" and len(ref) <= 100 for _, ref in calls)
    assert job.status == "COMPLETED"


def test_duplicate_human_challan_does_not_share_a_sales_identity(records):
    db = records; job = make_card(db)
    sales_refs = []
    def sales(**kw):
        if kw["path"].endswith("record-dispatch"):
            sales_refs.append(kw["payload"]["dispatch_line_ref"])
        return {}
    with patch.object(api, "_require_final_qc"), patch.object(api, "_post_sales_request", side_effect=sales), patch.object(api, "_post_inventory_dispatch_if_needed", side_effect=lambda **kw: kw["snapshot"]):
        first = api.create_or_update_dispatch(command(job, 60), db, PLANT, USER)
        second = api.create_or_update_dispatch(command(job, 40), db, PLANT, USER)
    assert first.dispatch_snapshot["challan_no"] == second.dispatch_snapshot["challan_no"]
    assert len(set(sales_refs)) == 2


def test_existing_unfinished_shipment_preserves_its_old_receiver_references(records):
    db = records; job = make_card(db)
    request = command(job, 60, request_id="old-request")
    old = {"orchestration_state": "FAILED", "dispatch_request_id": "old-request",
           "dispatch_ref": "OLD-CHALLAN", "date": date.today().isoformat(), "qty": 60,
           "inventory_dispatch_transaction_id": "old-outward"}
    db.add(Dispatch(job_card_id=job.id, status="DRAFT", dispatch_snapshot=old))
    db.add(DispatchIdempotency(plant_id=PLANT_A_UUID, request_id="old-request", job_card_id=job.id,
                              request_hash=api._request_hash(request), status="FAILED", response_snapshot=old))
    db.flush()
    refs = []
    def sales(**kw):
        refs.append(kw["payload"]["dispatch_line_ref"])
        return {}
    def inventory(**kw):
        assert kw["snapshot"]["inventory_dispatch_transaction_id"] == "old-outward"
        assert "inventory_dispatch_external_ref" not in kw["snapshot"]
        return kw["snapshot"]
    with patch.object(api, "_require_final_qc"), patch.object(api, "_post_sales_request", side_effect=sales), patch.object(api, "_post_inventory_dispatch_if_needed", side_effect=inventory):
        assert api.create_or_update_dispatch(request, db, PLANT, USER).status == "SEALED"
    assert refs == ["OLD-CHALLAN", "OLD-CHALLAN"]


def test_failed_shipment_prevents_a_different_card_consuming_the_sales_balance(records):
    db = records; line = uuid.uuid4()
    first, other = make_card(db, line), make_card(db, line)
    db.add(Dispatch(job_card_id=first.id, status="DRAFT", dispatch_snapshot={"orchestration_state": "FAILED"}))
    db.flush()
    with patch.object(api, "_post_inventory_dispatch_if_needed") as inventory:
        with pytest.raises(HTTPException) as error:
            api.create_or_update_dispatch(command(other), db, PLANT, USER)
    assert error.value.status_code == 409
    inventory.assert_not_called()


def test_session_sales_line_lease_survives_commits_and_releases_after_error():
    line = uuid.uuid4()
    with pytest.raises(RuntimeError):
        with api._sales_line_posting_lease(PLANT, line):
            with engine.connect() as other:
                other.commit()
            with pytest.raises(HTTPException) as error:
                with api._sales_line_posting_lease(PLANT, line):
                    pass
            assert error.value.status_code == 409
            raise RuntimeError("injected failure")
    with api._sales_line_posting_lease(PLANT, line):
        pass


def test_two_cards_cannot_post_outward_from_the_same_remaining_sales_balance():
    Base.metadata.create_all(engine)
    db = SessionLocal(); line = uuid.uuid4()
    first, other = make_card(db, line, 80), make_card(db, line, 80)
    ids = [first.id, other.id]; order_ids = [first.sales_order_id, other.sales_order_id]
    db.commit()
    started, release = threading.Event(), threading.Event()
    result = []; outward = []; balance = {"remaining": 100}
    def sales(**kw):
        qty = kw["payload"]["qty"]
        if kw["path"].endswith("validate-dispatch"):
            if qty > balance["remaining"]:
                raise HTTPException(400, "Dispatch exceeds remaining")
        else:
            balance["remaining"] -= qty
        return {}
    def inventory(**kw):
        outward.append(kw["dispatch_qty"])
        started.set()
        assert release.wait(10)
        return kw["snapshot"]
    def first_ship():
        worker = SessionLocal()
        try:
            api.create_or_update_dispatch(command(first, 80), worker, PLANT, USER)
            result.append("SEALED")
        except Exception as exc:
            result.append(exc)
        finally:
            worker.close()
    try:
        with patch.object(api, "_require_final_qc"), patch.object(api, "_post_sales_request", side_effect=sales), patch.object(api, "_post_inventory_dispatch_if_needed", side_effect=inventory):
            thread = threading.Thread(target=first_ship); thread.start()
            assert started.wait(10)
            with pytest.raises(HTTPException) as error:
                api.create_or_update_dispatch(command(other, 80), db, PLANT, USER)
            assert error.value.status_code == 409
            release.set(); thread.join(10)
            assert not thread.is_alive() and result == ["SEALED"]
            db.rollback()
            with pytest.raises(HTTPException) as error:
                api.create_or_update_dispatch(command(other, 80), db, PLANT, USER)
            assert error.value.status_code == 400
            assert outward == [80] and balance["remaining"] == 20
    finally:
        release.set()
        if "thread" in locals(): thread.join(10)
        db.rollback()
        db.query(DispatchIdempotency).filter(DispatchIdempotency.job_card_id.in_(ids)).delete(synchronize_session=False)
        db.query(Dispatch).filter(Dispatch.job_card_id.in_(ids)).delete(synchronize_session=False)
        db.query(PackingRecord).filter(PackingRecord.job_card_id.in_(ids)).delete(synchronize_session=False)
        db.query(JobCard).filter(JobCard.id.in_(ids)).delete(synchronize_session=False)
        db.query(SalesOrder).filter(SalesOrder.id.in_(order_ids)).delete(synchronize_session=False)
        db.commit(); db.close()
