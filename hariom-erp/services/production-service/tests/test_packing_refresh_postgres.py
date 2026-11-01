"""Packing setup pushes a spec's packing amendment into open job cards that have not packed a box yet."""
import os
import uuid
from datetime import date

import pytest

pytestmark = pytest.mark.skipif("hardening_test" not in os.getenv("DATABASE_URL", ""), reason="Disposable PostgreSQL only")
A = "00000000-0000-0000-0000-0000000000a1"
B = "00000000-0000-0000-0000-0000000000b2"
USER = {"sub": "packing-test", "roles": ["Owner"], "allowed_plants": [A, B]}
VALUES = {
    "box_code": "R.125", "box_size": "350x300x200", "box_unit_weight_kg": "0.4", "qty_per_box": "45",
    "plastic_required": "true", "plastic_sku": "PS-150", "plastic_size": "1x1 m", "plastic_unit_weight_kg": "0.05",
    "plastic_weight_per_box_kg": "0.05", "plastic_per_box": "1", "fadda_sku": "", "fadda_unit_weight_kg": "",
    "fadda_weight_per_box_kg": "", "fadda_per_box": "0",
}


@pytest.fixture
def cards():
    from src import entry_models  # noqa: F401  (run tables)
    from src.database import Base, SessionLocal, engine
    from src.models import JobCard, JobCardStage, PackingRecord, SalesOrder

    Base.metadata.create_all(engine)
    conn = engine.connect()
    transaction = conn.begin()
    db = SessionLocal(bind=conn, join_transaction_mode="create_savepoint")
    spec_v1, spec_v2, other_spec = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    order = SalesOrder(plant_id=uuid.UUID(A), customer_id=uuid.uuid4(), spec_id=spec_v2, order_qty=1000, due_date=date.today())
    db.add(order)
    db.flush()
    snapshot = {"entry_model": "V2", "box_code": "R-150", "qty_per_box": "48", "plastic_per_box": "1", "fadda_per_box": "3", "bundle_type": "Box", "bopp_required": "No"}

    def card(spec_id, status="IN_PROGRESS", plant=A, **extra):
        job = JobCard(plant_id=uuid.UUID(plant), sales_order_id=order.id, spec_id=spec_id, planned_qty=100, released_qty=100,
                      spec_snapshot=dict(snapshot), routing_snapshot={}, status=status, current_stage="WINDER", job_card_no=f"T{uuid.uuid4().hex[:8]}", **extra)
        db.add(job)
        db.flush()
        return job

    jobs = {
        "open_v2": card(spec_v2, status="PLANNED"),
        "open_v1": card(spec_v1),
        "packed": card(spec_v2),
        "packing_closed": card(spec_v2),
        "completed": card(spec_v2, status="COMPLETED"),
        "other_spec": card(other_spec),
        "other_plant": card(spec_v2, plant=B),
    }
    db.add(PackingRecord(job_card_id=jobs["packed"].id, total_packed_qty=48, bundle_count=1))
    db.add(JobCardStage(job_card_id=jobs["packing_closed"].id, stage_type="PACKING", status="COMPLETED"))
    db.commit()
    yield db, jobs, [spec_v1, spec_v2]
    db.close()
    transaction.rollback()
    conn.close()


def refresh(db, spec_ids, plant=A, **extra):
    from src.routers.packing_refresh import PackingRefreshInput, refresh_packing_in_open_cards

    body = PackingRefreshInput(spec_ids=spec_ids, values=VALUES, source={"spec_id": str(spec_ids[-1]), "amendment_id": "am-1", "summary": "Box R.125 × 45 pcs"}, **extra)
    return refresh_packing_in_open_cards(body, db, plant, USER)


def test_open_unpacked_cards_take_the_packing_with_an_audit_row(cards):
    from src.models import AuditEvent

    db, jobs, spec_ids = cards
    result = refresh(db, spec_ids)
    assert result["updated"] == 2 and {c["id"] for c in result["updated_cards"]} == {str(jobs["open_v2"].id), str(jobs["open_v1"].id)}
    assert result["skipped_packed"] == 2
    assert {c["reason"] for c in result["skipped_cards"]} == {"already packed pieces", "packing is closed"}
    db.expire_all()
    snap = jobs["open_v1"].spec_snapshot
    assert snap["box_code"] == snap["box"] == "R.125" and snap["qty_per_box"] == "45" and snap["box_unit_weight_kg"] == "0.4"
    assert snap["plastic_required"] == "Yes" and snap["plastic_sku"] == "PS-150" and snap["fadda_sku"] is None and snap["fadda_per_box"] == "0"
    assert snap["entry_model"] == "V2" and snap["bundle_type"] == "Box"  # the rest of the frozen snapshot is untouched
    assert "Qty/Box 45" in snap["packing_instructions"] and "Box R.125" in snap["packing_instructions"]
    assert snap["packing_amendment"]["amendment_id"] == "am-1"
    for name in ("packed", "packing_closed", "completed", "other_spec", "other_plant"):
        assert jobs[name].spec_snapshot["box_code"] == "R-150", name
    event = db.query(AuditEvent).filter_by(job_card_id=jobs["open_v1"].id, action="packing_updated_from_spec").one()
    assert event.payload["before"]["qty_per_box"] == "48" and event.payload["after"]["qty_per_box"] == "45"
    assert "Box R.125 × 45 pcs" in event.payload["reason"]
    # Pushing the same packing again changes nothing and writes no second audit row.
    again = refresh(db, spec_ids)
    assert again["updated"] == 0 and again["unchanged"] == 2
    assert db.query(AuditEvent).filter_by(job_card_id=jobs["open_v1"].id, action="packing_updated_from_spec").count() == 1


def test_a_packed_box_keeps_the_card_on_its_packing_but_a_voided_box_does_not(cards):
    from datetime import datetime
    from src import entry_models

    db, jobs, spec_ids = cards
    FgBox = getattr(entry_models, "FgBox", None)
    if FgBox is None:
        pytest.skip("per-box FG table not built yet")
    db.execute(entry_models.FgBox.__table__.insert(), [
        {"id": uuid.uuid4(), "plant_id": jobs["open_v2"].plant_id, "job_card_id": jobs["open_v2"].id, "seq_no": 1, "box_code": f"B-{uuid.uuid4().hex[:10]}",
         "qty": 48, "is_part": False, "status": "PACKED", "allocations": [], "qc_flagged": False, "qc_flags": [], "packaging": {}, "fg_status": "PENDING",
         "label_prints": 0, "row_version": 1, "packed_at": datetime.utcnow()},
        {"id": uuid.uuid4(), "plant_id": jobs["open_v1"].plant_id, "job_card_id": jobs["open_v1"].id, "seq_no": 1, "box_code": f"B-{uuid.uuid4().hex[:10]}",
         "qty": 48, "is_part": False, "status": "VOID", "allocations": [], "qc_flagged": False, "qc_flags": [], "packaging": {}, "fg_status": "PENDING",
         "label_prints": 0, "row_version": 1, "packed_at": datetime.utcnow()},
    ])
    db.commit()
    result = refresh(db, spec_ids)
    assert [c["id"] for c in result["updated_cards"]] == [str(jobs["open_v1"].id)]
    assert {"id": str(jobs["open_v2"].id), "job_card_no": jobs["open_v2"].job_card_no, "reason": "boxes already packed"} in result["skipped_cards"]


def test_dry_run_counts_without_writing(cards):
    from src.models import AuditEvent

    db, jobs, spec_ids = cards
    result = refresh(db, spec_ids, dry_run=True)
    assert result["updated"] == 2 and result["dry_run"]
    db.expire_all()
    assert jobs["open_v2"].spec_snapshot["box_code"] == "R-150"
    assert not db.query(AuditEvent).filter_by(action="packing_updated_from_spec").count()


def test_card_history_reads_the_packing_update(cards):
    from src.routers.card_history import card_events

    db, jobs, spec_ids = cards
    refresh(db, spec_ids)
    events = [e for e in card_events(db, [jobs["open_v2"]]) if "acking" in e["title"]]
    assert events and events[0]["title"] == "Packing updated from spec"
    assert "Box R.125 × 45 pcs" in events[0]["detail"]
