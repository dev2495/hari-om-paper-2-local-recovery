"""Scheduled-but-silent job cards: 36h after the planned shift ends with no floor entry
on any stage, the slot is released and the card goes back to the queue, flagged.

The floor may still enter the card later (paper cards are sometimes typed in after all
steps are done). A late entry puts the card back on the slot it actually ran in and
clears the flag; both moves stay in the audit trail and the tracker.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy.orm import Session

from ..lifecycle_rules import MISSED_SLOT_HOURS, is_missed_slot, missed_slot_deadline
from ..models import AuditEvent, JobCard, JobCardStage, JobCardStageSegment

ENTRY_STATUSES = {"RUNNING", "COMPLETED"}


def _stage_has_entry(db: Session, job: JobCard, stage_type: str) -> bool:
    if db.query(JobCardStageSegment.id).filter(
        JobCardStageSegment.job_card_id == job.id,
        JobCardStageSegment.stage_type == stage_type,
        JobCardStageSegment.status.in_(list(ENTRY_STATUSES)),
    ).first():
        return True
    row = db.query(JobCardStage).filter(JobCardStage.job_card_id == job.id, JobCardStage.stage_type == stage_type).first()
    return bool(row and ((row.actuals_snapshot or {}).get("running_log") or float(row.output_qty or 0) > 0 or row.status in ENTRY_STATUSES))


def sweep_missed_slots(db: Session, plant_uuid: uuid.UUID, *, now_local: Optional[datetime] = None) -> list[dict[str, Any]]:
    """Requeue one plant's overdue silent cards (idempotent; cheap indexed scan). Commits when it changed anything."""
    if plant_uuid is None:
        raise ValueError("Missed-slot sweep needs one concrete plant")
    from .planning import PLANT_TIMEZONE, _all_stage_segments, _sync_stage_row_from_segments

    now_local = now_local or datetime.now(PLANT_TIMEZONE).replace(tzinfo=None)
    horizon = (now_local - timedelta(hours=MISSED_SLOT_HOURS)).date()
    query = (
        db.query(JobCardStageSegment, JobCard)
        .join(JobCard, JobCard.id == JobCardStageSegment.job_card_id)
        .filter(
            JobCardStageSegment.status == "ASSIGNED",
            JobCardStageSegment.plan_date.isnot(None),
            JobCardStageSegment.plan_date <= horizon,
            JobCard.status.notin_(["COMPLETED", "CANCELLED"]),
        )
    )
    query = query.filter(JobCard.plant_id == plant_uuid)
    requeued: list[dict[str, Any]] = []
    seen: set[tuple[uuid.UUID, str]] = set()
    for segment, job in query.all():
        key = (job.id, segment.stage_type)
        if key in seen:
            continue
        if not is_missed_slot(plan_date=segment.plan_date, shift_code=segment.shift_code, has_any_entry=_stage_has_entry(db, job, segment.stage_type), now_local=now_local):
            continue
        seen.add(key)
        slot = {
            "stage": segment.stage_type,
            "machine_id": str(segment.machine_id) if segment.machine_id else None,
            "plan_date": str(segment.plan_date),
            "shift_code": segment.shift_code,
            "deadline": missed_slot_deadline(segment.plan_date, segment.shift_code).isoformat(),
            "requeued_at": now_local.isoformat(),
        }
        for row in db.query(JobCardStageSegment).filter(
            JobCardStageSegment.job_card_id == job.id,
            JobCardStageSegment.stage_type == segment.stage_type,
            JobCardStageSegment.status == "ASSIGNED",
        ).all():
            row.status = "QUEUED"
            row.shift_code = None
            row.machine_id = None
            row.plan_date = now_local.date()
            stage_row = db.query(JobCardStage).filter(JobCardStage.job_card_id == job.id, JobCardStage.stage_type == row.stage_type).first()
            if stage_row is not None:
                db.flush()
                _sync_stage_row_from_segments(stage_row, _all_stage_segments(db, job.id, row.stage_type))
        job.missed_slot_count = int(job.missed_slot_count or 0) + 1
        job.missed_slot_open = True
        job.last_missed_slot = slot
        db.add(
            AuditEvent(
                plant_id=job.plant_id,
                entity_type="job_card",
                entity_id=job.id,
                action="missed_slot_requeued",
                actor_id="system:missed-slot-sweep",
                actor_role="System",
                job_card_id=job.id,
                payload={**slot, "count": job.missed_slot_count, "rule": f"No floor entry {MISSED_SLOT_HOURS}h after the shift ended"},
            )
        )
        requeued.append({"job_card_id": str(job.id), "job_card_no": job.job_card_no, "plant_id": str(job.plant_id), **slot, "count": job.missed_slot_count})
    if requeued:
        db.commit()
    return requeued


def restore_missed_slot_for_late_entry(db: Session, job: JobCard, stage_type: str, actor: Optional[str], role: Optional[str]) -> bool:
    """Late entry on a requeued card: put it back on the slot it really ran in and clear the flag."""
    if not job.missed_slot_open or not job.last_missed_slot:
        return False
    from .planning import _all_stage_segments, _sync_stage_row_from_segments

    slot = dict(job.last_missed_slot or {})
    target_stage = slot.get("stage") or stage_type
    for row in db.query(JobCardStageSegment).filter(
        JobCardStageSegment.job_card_id == job.id,
        JobCardStageSegment.stage_type == target_stage,
        JobCardStageSegment.status.in_(["QUEUED", "PLANNED"]),
    ).all():
        row.machine_id = uuid.UUID(slot["machine_id"]) if slot.get("machine_id") else row.machine_id
        row.plan_date = datetime.fromisoformat(slot["plan_date"]).date() if slot.get("plan_date") else row.plan_date
        row.shift_code = slot.get("shift_code") or row.shift_code
        row.status = "ASSIGNED" if row.machine_id and row.shift_code else row.status
    stage_row = db.query(JobCardStage).filter(JobCardStage.job_card_id == job.id, JobCardStage.stage_type == target_stage).first()
    if stage_row is not None:
        db.flush()
        _sync_stage_row_from_segments(stage_row, _all_stage_segments(db, job.id, target_stage))
    job.missed_slot_open = False
    db.add(
        AuditEvent(
            plant_id=job.plant_id,
            entity_type="job_card",
            entity_id=job.id,
            action="missed_slot_late_entry",
            actor_id=actor,
            actor_role=role,
            job_card_id=job.id,
            payload={**slot, "note": "Late floor entry — card returned to the slot it ran in"},
        )
    )
    db.flush()
    return True
