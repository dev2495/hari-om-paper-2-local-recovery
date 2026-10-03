"""Real dispatch discovery and allowed-plant read contracts after V2 completion."""
import os
import uuid
from datetime import date

import pytest
from fastapi import HTTPException

pytestmark = pytest.mark.skipif(
    "hardening_test" not in os.getenv("DATABASE_URL", ""),
    reason="Requires an isolated hardening_test PostgreSQL database",
)

A = "00000000-0000-0000-0000-0000000000a1"
B = "00000000-0000-0000-0000-0000000000b2"
USER = {"roles": ["Owner"], "allowed_plants": [A, B], "sub": "handoff-test"}


@pytest.fixture
def records():
    from src.database import Base, engine, SessionLocal
    from src.models import JobCard, JobCardStage, PackingRecord, SalesOrder

    Base.metadata.create_all(engine)
    connection = engine.connect()
    transaction = connection.begin()
    db = SessionLocal(bind=connection, join_transaction_mode="create_savepoint")

    def make(plant=A, stage="DISPATCH", qc="COMPLETED", posted=True, packed=50):
        order = SalesOrder(plant_id=uuid.UUID(plant), customer_id=uuid.uuid4(),
                           spec_id=uuid.uuid4(), order_qty=100, due_date=date.today())
        db.add(order); db.flush()
        job = JobCard(plant_id=order.plant_id, sales_order_id=order.id, spec_id=order.spec_id,
                      job_card_no="TEST-" + uuid.uuid4().hex[:12], planned_qty=50, released_qty=50,
                      status="IN_PROGRESS", current_stage=stage, spec_snapshot={"entry_model": "V2"})
        db.add(job); db.flush()
        db.add(JobCardStage(job_card_id=job.id, stage_type="QC", status=qc,
                            output_qty=packed if qc == "COMPLETED" else None))
        db.add(PackingRecord(job_card_id=job.id, total_packed_qty=packed,
                             fg_item_id=uuid.uuid4(),
                             snapshot={"inventory_batch_id": str(uuid.uuid4())} if posted else {}))
        db.flush()
        return job

    yield db, make
    db.close(); transaction.rollback(); connection.close()


def test_dispatch_stage_is_visible_with_human_ref_and_actual_partial_balance(records):
    from src.models import Dispatch
    from src.routers.dispatch import get_ready_jobs_for_dispatch
    from src.utils.auth import _resolve_scope
    db, make = records
    job = make(packed=52)
    shipment = Dispatch(job_card_id=job.id, status="SEALED", dispatch_snapshot={"dispatch_qty": 20})
    db.add(shipment); db.flush()
    rows = get_ready_jobs_for_dispatch(db, _resolve_scope(USER, "ALL", True), USER)
    result = next(row for row in rows if row["id"] == job.id)
    assert result["job_card_no"] == job.job_card_no
    assert result["plant_id"] == uuid.UUID(A)
    assert (result["packed_qty"], result["dispatched_qty"], result["remaining_qty"]) == (52, 20, 32)
    assert result["handoff_state"] == "UNSEALED"
    assert result["dispatch_status"] is None
    assert result["shipments"][0]["id"] == str(shipment.id)


def test_all_reads_keep_the_allowed_plant_filter_and_writes_require_one_plant(records):
    from src.models import Dispatch
    from src.routers.dispatch import get_dispatch, get_dispatch_by_job_card, get_ready_jobs_for_dispatch
    from src.utils.auth import _resolve_scope
    db, make = records
    own, other = make(A), make(B)
    own_dispatch = Dispatch(job_card_id=own.id, status="DRAFT", dispatch_snapshot={})
    other_dispatch = Dispatch(job_card_id=other.id, status="DRAFT", dispatch_snapshot={})
    db.add_all([own_dispatch, other_dispatch]); db.flush()
    scope = _resolve_scope({**USER, "allowed_plants": [A]}, "ALL", True)
    ids = {row["id"] for row in get_ready_jobs_for_dispatch(db, scope, USER)}
    assert own.id in ids and other.id not in ids
    assert get_dispatch(own_dispatch.id, db, scope, USER).id == own_dispatch.id
    assert get_dispatch_by_job_card(own.id, False, db, scope, USER).id == own_dispatch.id
    assert get_dispatch_by_job_card(other.id, False, db, scope, USER) is None
    with pytest.raises(HTTPException) as error:
        get_dispatch(other_dispatch.id, db, scope, USER)
    assert error.value.status_code == 404
    with pytest.raises(HTTPException) as error:
        _resolve_scope(USER, "ALL", False)
    assert error.value.status_code == 400


def test_candidates_show_qc_posting_and_hold_blockers_instead_of_false_readiness(records):
    from src.models import QualityHold
    from src.routers.dispatch import get_ready_jobs_for_dispatch
    from src.utils.auth import _resolve_scope
    db, make = records
    waiting = make(stage="QC", qc="QUEUED", posted=False)
    posting = make(posted=False)
    packing = make(stage="PACKING", packed=0, qc="QUEUED", posted=False)
    held = make()
    cancelled = make()
    cancelled.status = "CANCELLED"
    db.add(QualityHold(plant_id=uuid.UUID(A), job_card_id=held.id, stage_type="QC", status="HOLD",
                       reason="Investigate dimensional variance")); db.flush()
    rows = {row["id"]: row for row in get_ready_jobs_for_dispatch(db, _resolve_scope(USER, "ALL", True), USER)}
    assert rows[waiting.id]["handoff_state"] == "AWAITING_QC"
    assert rows[posting.id]["handoff_state"] == "AWAITING_FG"
    assert rows[packing.id]["handoff_state"] == "AWAITING_PACKING"
    assert rows[held.id]["handoff_state"] == "QC_HOLD"
    assert cancelled.id not in rows
