"""Accepted FG and one release allocation cannot consume a sibling card's balance."""
import os
import uuid
from datetime import date
from unittest.mock import patch

import pytest
from fastapi import HTTPException

if "hardening_test" not in os.getenv("DATABASE_URL", ""):
    pytest.skip("Requires isolated hardening_test PostgreSQL", allow_module_level=True)

from src.database import Base, engine, SessionLocal
from src.models import JobCard, JobCardStage, PackingRecord, SalesOrder, PLANT_A_UUID
from src.routers import dispatch as api

PLANT = str(PLANT_A_UUID)
USER = {"roles": ["Owner"], "token": "test", "sub": "allowance-test"}


@pytest.fixture
def records():
    Base.metadata.create_all(engine)
    connection = engine.connect(); transaction = connection.begin()
    db = SessionLocal(bind=connection, join_transaction_mode="create_savepoint")
    order = SalesOrder(customer_id=uuid.uuid4(), spec_id=uuid.uuid4(), order_qty=100, due_date=date.today())
    db.add(order); db.flush()
    line = uuid.uuid4()
    def make(packed=50, accepted=None, effective_target=None):
        job = JobCard(sales_order_id=order.id, sales_order_line_id=line, spec_id=order.spec_id,
                      planned_qty=50, released_qty=50, status="IN_PROGRESS", current_stage="DISPATCH",
                      spec_snapshot={"entry_model": "V2"}, routing_snapshot={"stages": ["PACKING", "QC", "DISPATCH"]})
        db.add(job); db.flush()
        db.add(JobCardStage(job_card_id=job.id, stage_type="PACKING", status="COMPLETED", output_qty=packed))
        db.add(JobCardStage(job_card_id=job.id, stage_type="QC", status="COMPLETED", output_qty=packed if accepted is None else accepted))
        db.add(JobCardStage(job_card_id=job.id, stage_type="DISPATCH", status="QUEUED",
                            actuals_snapshot={"effective_target": effective_target} if effective_target is not None else {}))
        db.add(PackingRecord(job_card_id=job.id, total_packed_qty=packed, fg_item_id=uuid.uuid4(),
                             snapshot={"inventory_batch_id": str(uuid.uuid4())}))
        db.flush()
        return job
    yield db, make
    db.close(); transaction.rollback(); connection.close()


def send(db, job, qty):
    return api.create_or_update_dispatch(api.DispatchPayload(job_card_id=job.id, status="SEALED", dispatch_qty=qty,
                                        dispatch_request_id=str(uuid.uuid4()), dispatch_snapshot={}), db, PLANT, USER)


def ready(db, job):
    rows = api.get_ready_jobs_for_dispatch(db, {"scope_all": False, "selected_plant_id": PLANT}, USER)
    return next(row for row in rows if row["id"] == job.id)


def test_excess_card_cannot_ship_a_sibling_release_allocation(records):
    db, make = records
    first, other = make(60), make(50)
    balance, outward = {"remaining": 100}, []
    def sales(**kw):
        qty = kw["payload"]["qty"]
        if kw["path"].endswith("validate-dispatch"):
            assert qty <= balance["remaining"]
        else:
            balance["remaining"] -= qty
        return {}
    def inventory(**kw):
        outward.append(kw["dispatch_qty"])
        return kw["snapshot"]
    with patch.object(api, "_require_final_qc"), patch.object(api, "_post_sales_request", side_effect=sales), patch.object(api, "_post_inventory_dispatch_if_needed", side_effect=inventory):
        with pytest.raises(HTTPException) as error: send(db, first, 60)
        assert error.value.status_code == 409 and "released allocation" in str(error.value.detail)
        assert outward == []
        send(db, first, 20)
        assert ready(db, first)["max_ship_qty"] == 30
        send(db, first, 30)
        first_state = ready(db, first)
        assert first_state["max_ship_qty"] == 0 and first_state["remaining_qty"] == 10
        assert first.status == "IN_PROGRESS"  # Surplus requires explicit retention.
        send(db, other, 50)
        assert other.status == "COMPLETED" and balance["remaining"] == 0
    assert outward == [20, 30, 50]


@pytest.mark.parametrize("gross, uninspected", [(45, 0), (50, 5)])
def test_final_qc_rejections_are_never_dispatchable_and_do_not_strand_card(records, gross, uninspected):
    db, make = records
    job = make(packed=gross, accepted=40, effective_target=40)
    qc = db.query(JobCardStage).filter_by(job_card_id=job.id, stage_type="QC").one()
    qc.scrap_qty = 5
    qc.actuals_snapshot = {"produced_total": 45, "accepted_total": 40, "rejected_total": 5}
    db.flush()
    before = ready(db, job)
    assert before["packed_qty"] == gross and before["dispatchable_qty"] == 40
    assert before["qc_rejected_qty"] == 5 and before["max_ship_qty"] == 40
    assert before["qc_uninspected_qty"] == uninspected
    outward = []
    def inventory(**kw):
        outward.append(kw["dispatch_qty"])
        return kw["snapshot"]
    with patch.object(api, "_require_final_qc"), patch.object(api, "_post_sales_request", return_value={}), patch.object(api, "_post_inventory_dispatch_if_needed", side_effect=inventory):
        with pytest.raises(HTTPException) as error: send(db, job, 45)
        assert error.value.status_code == 409
        assert outward == []
        send(db, job, 40)
    assert outward == [40] and job.status == "COMPLETED" and job.current_stage == "DONE"
    after = ready(db, job)
    assert after["remaining_qty"] == after["physical_remaining_qty"] == after["max_ship_qty"] == 0
    assert after["packed_qty"] == gross and after["qc_rejected_qty"] == 5
    assert after["qc_uninspected_qty"] == uninspected
    stage = db.query(JobCardStage).filter_by(job_card_id=job.id, stage_type="DISPATCH").one()
    assert stage.status == "COMPLETED" and stage.output_qty == 40


def test_all_qc_rejections_show_terminal_rejection_instead_of_waiting_for_fg(records):
    db, make = records
    job = make(packed=45, accepted=0, effective_target=0)
    packing = db.query(PackingRecord).filter_by(job_card_id=job.id).one()
    packing.snapshot = {}
    db.flush()
    row = ready(db, job)
    assert row["handoff_state"] == "REJECTED_QC"
    assert row["qc_rejected_qty"] == 45
    assert row["dispatchable_qty"] == row["max_ship_qty"] == row["physical_remaining_qty"] == 0
    with patch.object(api, "_require_final_qc"), patch.object(api, "_post_inventory_dispatch_if_needed") as inventory:
        with pytest.raises(HTTPException) as error: send(db, job, 1)
    assert error.value.status_code == 409
    inventory.assert_not_called()
