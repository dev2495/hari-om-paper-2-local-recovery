"""Stage short close on batch-entry cards (owner decision 1, 2026-11-01).

A stage closed short gives the unmade balance back to the sales order line at once:
``returned = (this stage's target in pcs) - (this stage's good output in pcs)``. Every downstream stage's
target is cut to what was passed on and its open planner slots shrink with it. Reopening the stage
reverses all of that (the order return only while the line still has those pcs unreleased).

Invariant: sum of all returns + finished goods in boxes == pcs released to the card (no overproduction)."""
from __future__ import annotations

import math
from datetime import datetime
from typing import Any, Optional

from fastapi import HTTPException

from .entry_models import CompletionEffect
from .lifecycle_rules import BAMBOO_STAGES, planned_in_stage_units, stage_unit
from .models import JobCard, JobCardStage, JobCardStageSegment

OPEN_SEGMENT = ("PLANNED", "QUEUED", "ASSIGNED", "RUNNING")


def current_released(job: JobCard) -> float:
    """Pcs released to the card now (older cards carry 0 here until something is returned: the plan)."""
    if float(job.released_qty or 0.0) or float(job.returned_qty or 0.0):
        return float(job.released_qty or 0.0)
    return float(job.planned_qty or 0.0)


def released_pcs(job: JobCard) -> float:
    """Pcs released to the card before any stage short close (current released + already returned)."""
    return current_released(job) + float(job.returned_qty or 0.0)


def stage_target_pcs(job: JobCard, row: JobCardStage) -> float:
    snapshot = row.actuals_snapshot or {}
    if snapshot.get("effective_target_pcs") is not None:
        return float(snapshot["effective_target_pcs"])
    return float(job.planned_qty or 0.0)


def to_pcs(stage: str, qty: float, ppb: Optional[int]) -> float:
    return float(qty) * ppb if stage in BAMBOO_STAGES and ppb else float(qty)


def _shrink_segments(db, job: JobCard, stage: str, target_pcs: float, ppb: Optional[int]) -> dict[str, Any]:
    """Open slots of ``stage`` shrink so planned + made never exceeds the new target (latest slots give first)."""
    rows = db.query(JobCardStageSegment).filter(JobCardStageSegment.job_card_id == job.id, JobCardStageSegment.stage_type == stage).all()
    before = {str(s.id): {"planned_qty": float(s.planned_qty or 0.0), "required_capacity": float(s.required_capacity or 0.0), "status": s.status} for s in rows}
    done_pcs = sum(to_pcs(stage, float(s.output_qty or 0.0), ppb) for s in rows if s.status == "COMPLETED")
    open_rows = [s for s in rows if s.status in OPEN_SEGMENT]
    allowed = max(0.0, target_pcs - done_pcs)
    total = sum(float(s.planned_qty or 0.0) for s in open_rows)
    excess = total - allowed
    if excess <= 1e-6:
        return before
    ordered = sorted(open_rows, key=lambda s: (s.plan_date is None, s.plan_date or datetime.min.date(), s.shift_code or "", s.sequence_no or 0, s.segment_no or 0), reverse=True)
    for seg in ordered:
        if excess <= 1e-6:
            break
        planned = float(seg.planned_qty or 0.0)
        cut = min(planned, excess)
        new = round(planned - cut, 2)
        if planned > 0 and seg.required_capacity:
            seg.required_capacity = round(float(seg.required_capacity) * (new / planned), 2)
        seg.planned_qty = new
        excess -= cut
        if new <= 1e-6 and seg.status in ("PLANNED", "QUEUED", "ASSIGNED") and not float(seg.output_qty or 0.0):
            seg.status = "CANCELLED"
    return before


def apply_short_close(db, job: JobCard, stage: str, row: JobCardStage, *, good: float, target: float, routing: list[str],
                      ppb: Optional[int], reason: str, user: dict, reason_code: Optional[str] = None,
                      reason_label: Optional[str] = None, reason_note: Optional[str] = None) -> dict[str, Any]:
    """Cut downstream targets and slots, give the balance back. Returns the short-close record.

    ``reason`` is the legacy text ("Label — note"); ``reason_code`` / ``reason_label`` / ``reason_note`` are the
    STAGE_SHORT_CLOSE master choice the caller checked (owner decision 4) and go on the record and to Sales."""
    good_pcs = to_pcs(stage, good, ppb)
    target_pcs = stage_target_pcs(job, row)
    returned = int(max(0, math.floor(target_pcs - good_pcs + 1e-6)))
    shrunk: dict[str, Any] = {}
    index = routing.index(stage)
    for following in routing[index + 1:]:
        nxt = db.query(JobCardStage).filter_by(job_card_id=job.id, stage_type=following).first()
        if nxt is None:
            continue
        snap = dict(nxt.actuals_snapshot or {})
        old_unit = snap.get("effective_target")
        old_pcs = snap.get("effective_target_pcs")
        current_unit = float(old_unit) if old_unit is not None else planned_in_stage_units(following, job.planned_qty, ppb)
        current_pcs = float(old_pcs) if old_pcs is not None else float(job.planned_qty or 0.0)
        new_pcs = min(current_pcs, good_pcs)
        if stage_unit(following) == "bamboo":
            new_unit = min(current_unit, float(good) if stage_unit(stage) == "bamboo" else float(math.ceil(good_pcs / ppb)) if ppb else current_unit)
        else:
            new_unit = min(current_unit, good_pcs)
        segments = _shrink_segments(db, job, following, new_pcs, ppb)
        shrunk[following] = {"effective_target": old_unit, "effective_target_pcs": old_pcs, "segments": segments}
        snap.update(effective_target=int(new_unit) if float(new_unit).is_integer() else new_unit, effective_target_pcs=new_pcs,
                    row_version=int(snap.get("row_version", 1)) + 1)
        nxt.actuals_snapshot = snap
    released_now = current_released(job)
    count = int((row.actuals_snapshot or {}).get("short_close_count") or 0) + 1
    return_key = f"{job.id}:{stage}:close:{count}"
    record = {"good": good, "target": target, "unit": stage_unit(stage), "good_pcs": good_pcs, "target_pcs": target_pcs,
              "returned_pcs": returned, "reason": reason, "reason_code": reason_code, "reason_label": reason_label, "reason_note": reason_note,
              "at": datetime.utcnow().isoformat(), "by": user.get("sub"),
              "return_key": return_key if returned and job.release_lot_id else None}
    if returned:
        job.returned_qty = round(float(job.returned_qty or 0.0) + returned, 4)
        job.released_qty = round(max(0.0, released_now - returned), 4)
        if job.release_lot_id:
            db.add(CompletionEffect(job_card_id=job.id, effect_key=f"{return_key}:sales_return", kind="sales_return",
                                    payload={"stage": stage, "plant_id": str(job.plant_id), "release_lot_id": str(job.release_lot_id),
                                             "job_card_id": str(job.id), "return_key": return_key, "qty": returned, "reason": reason,
                                             "reason_code": reason_code, "reason_label": reason_label, "reason_note": reason_note}))
    snap = dict(row.actuals_snapshot or {})
    snap.update(short_close=record, returned_pcs=returned, shrunk_from=shrunk, short_close_count=count)
    row.actuals_snapshot = snap
    return record


def reverse_short_close(db, job: JobCard, stage: str, row: JobCardStage, *, sales_reverse) -> Optional[dict[str, Any]]:
    """Undo a short close on reopen. ``sales_reverse(lot_id, return_key)`` gives the pcs back to the lot or raises 409."""
    snap = dict(row.actuals_snapshot or {})
    record = snap.get("short_close")
    if not record:
        return None
    returned = int(record.get("returned_pcs") or 0)
    key = record.get("return_key")
    if returned and key:
        # Row lock: the worker delivers with SKIP LOCKED, so it cannot deliver this return while the reopen decides.
        effect = db.query(CompletionEffect).filter_by(effect_key=f"{key}:sales_return").with_for_update().first()
        if effect is not None and effect.status != "DELIVERED" and not int(effect.attempts or 0):
            effect.status = "CANCELLED"
        elif effect is not None:
            # Delivered, or tried before (a timed-out call may have reached Sales): ask Sales to take it back;
            # a return Sales never recorded (404) is fine when it was never confirmed delivered.
            delivered = effect.status == "DELIVERED"
            if not delivered:
                effect.status = "CANCELLED"
            sales_reverse(str(effect.payload.get("release_lot_id")), key, missing_ok=not delivered)
    for following, before in (snap.get("shrunk_from") or {}).items():
        nxt = db.query(JobCardStage).filter_by(job_card_id=job.id, stage_type=following).first()
        if nxt is None:
            continue
        nsnap = dict(nxt.actuals_snapshot or {})
        for field in ("effective_target", "effective_target_pcs"):
            if before.get(field) is None:
                nsnap.pop(field, None)
            else:
                nsnap[field] = before[field]
        nsnap["row_version"] = int(nsnap.get("row_version", 1)) + 1
        nxt.actuals_snapshot = nsnap
        for seg_id, old in (before.get("segments") or {}).items():
            seg = db.get(JobCardStageSegment, __import__("uuid").UUID(seg_id))
            if seg is None or seg.status == "COMPLETED":
                continue
            seg.planned_qty = old.get("planned_qty", seg.planned_qty)
            seg.required_capacity = old.get("required_capacity", seg.required_capacity)
            if seg.status == "CANCELLED" and old.get("status") != "CANCELLED":
                seg.status = old.get("status") or "QUEUED"
    if returned:
        job.released_qty = round(current_released(job) + returned, 4)
        job.returned_qty = round(max(0.0, float(job.returned_qty or 0.0) - returned), 4)
    history = list(snap.get("short_close_history") or [])
    history.append({**record, "reopened_at": datetime.utcnow().isoformat()})
    for field in ("short_close", "returned_pcs", "shrunk_from"):
        snap.pop(field, None)
    snap["short_close_history"] = history
    row.actuals_snapshot = snap
    return record


def card_returns(db, job: JobCard) -> list[dict[str, Any]]:
    """Live (not reopened) short-close returns of a card, stage by stage."""
    out = []
    for row in db.query(JobCardStage).filter_by(job_card_id=job.id).all():
        record = (row.actuals_snapshot or {}).get("short_close")
        if record:
            out.append({"stage": row.stage_type, **record})
    return out
