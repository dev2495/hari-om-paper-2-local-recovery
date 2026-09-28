"""Job card lifecycle: view, edit (queued only), split, force-close, emergency insert,
live running entries (winder → oven flow) and winder queue load.

Every mutation writes an ``audit_events`` row on the job card and keeps the sales
release lot in step (one release lot = one job card = one color), so the sales order
tracker always shows the true released / returned / made quantities.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..job_card_numbering import allocate_child_job_card_no
from ..lifecycle_rules import (
    LIVE_FLOW_STAGES,
    OUTPUT_TOLERANCE,
    SegmentView,
    allowed_actions,
    lifecycle_state,
    made_qty,
    next_slot,
    plan_bump,
    plan_split_take,
    planned_in_stage_units,
    stage_unit,
    stage_units_to_pcs,
    within_output_tolerance,
)
from ..models import AuditEvent, JobCard, JobCardStage, JobCardStageSegment
from ..utils.auth import get_current_plant, require_role
from .missed_slots import restore_missed_slot_for_late_entry, sweep_missed_slots
from .planning import (
    PLANT_TIMEZONE,
    _all_stage_segments,
    _append_stage_segment,
    _build_job_card_snapshots,
    _current_actor_role,
    _derive_job_current_stage_and_status,
    _ensure_job_card_stages,
    _fetch_machine,
    _fetch_plant_closed_dates,
    _fetch_sales_order,
    _fetch_spec,
    _open_stage_segments,
    _pcs_per_bamboo_from_snapshot,
    _place_stage_segment,
    _record_audit_event,
    _required_capacity_for_job,
    _resolve_capacity_profile,
    _routing_stages_from_snapshot,
    _sync_stage_row_from_segments,
    _to_uuid,
)

router = APIRouter(tags=["job-card-lifecycle"])
settings = get_settings()

ROLES_PLAN = ["Owner", "Admin", "PlantManager", "Planner"]
ROLES_FLOOR = ["Owner", "Admin", "PlantManager", "Planner", "Operator"]


# ── helpers ────────────────────────────────────────────────────────────────


def _load_job(db: Session, job_card_id: uuid.UUID, plant_id: str) -> JobCard:
    job = db.query(JobCard).filter(JobCard.id == job_card_id, JobCard.plant_id == _to_uuid(plant_id)).with_for_update().first()
    if not job:
        raise HTTPException(status_code=404, detail="Job card not found")
    return job


def _routing(job: JobCard) -> list[str]:
    return list((job.routing_snapshot or {}).get("stages") or _routing_stages_from_snapshot(job.spec_snapshot or {}))


def _first_stage(job: JobCard) -> str:
    return str((job.routing_snapshot or {}).get("first_stage") or (_routing(job) or ["WINDER"])[0])


def _anchor_stage(job: JobCard) -> str:
    """Where 'made' is counted: the winder (slitting only prepares reels for it)."""
    routing = _routing(job)
    return "WINDER" if "WINDER" in routing else _first_stage(job)


def _ppb(job: JobCard) -> Optional[int]:
    return _pcs_per_bamboo_from_snapshot(job.spec_snapshot or {})


def _made_pcs(job: JobCard, views: list[SegmentView]) -> tuple[float, float]:
    """(made in pcs, made in the anchor stage's own unit)."""
    anchor = _anchor_stage(job)
    raw = made_qty([v for v in views if v.stage == anchor])
    pcs = stage_units_to_pcs(anchor, raw, _ppb(job))
    return round(pcs, 2), raw


def _segment_views(db: Session, job: JobCard) -> list[SegmentView]:
    rows = db.query(JobCardStageSegment).filter(JobCardStageSegment.job_card_id == job.id).all()
    return [
        SegmentView(
            id=str(row.id),
            stage=row.stage_type,
            status=row.status,
            planned_qty=float(row.planned_qty or 0.0),
            output_qty=float(row.output_qty or 0.0),
            machine_id=str(row.machine_id) if row.machine_id else None,
            plan_date=row.plan_date,
            shift_code=row.shift_code,
            sequence_no=int(row.sequence_no or 1),
            load=float(row.required_capacity or 0.0),
        )
        for row in rows
        if row.status != "CANCELLED"
    ]


def _state(db: Session, job: JobCard) -> tuple[str, list[SegmentView]]:
    views = _segment_views(db, job)
    return lifecycle_state(status=job.status, close_mode=job.close_mode, segments=views), views


def _sales_call(path: str, body: dict[str, Any], token: str, plant_id: Any) -> dict[str, Any]:
    try:
        response = httpx.post(
            f"{settings.SALES_SERVICE_URL}/sales-orders{path}",
            headers={"Authorization": f"Bearer {token}", "X-Plant-ID": str(plant_id)},
            json=body,
            timeout=12.0,
        )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Sales service unreachable: {exc}") from exc
    if response.status_code >= 400:
        try:
            detail = response.json().get("detail")
        except ValueError:
            detail = response.text[:240]
        raise HTTPException(status_code=response.status_code if response.status_code < 500 else 502, detail=detail or "Sales update failed")
    try:
        return response.json() or {}
    except ValueError:
        return {}


def _audit(db: Session, job: JobCard, action: str, current_user: dict, payload: dict[str, Any], before: Optional[dict] = None) -> None:
    _record_audit_event(
        db=db,
        plant_id=job.plant_id,
        entity_type="job_card",
        entity_id=job.id,
        action=action,
        actor_id=current_user.get("sub"),
        actor_role=_current_actor_role(current_user),
        job_card_id=job.id,
        payload=payload,
        before_payload=before,
        after_payload={"planned_qty": float(job.planned_qty or 0.0), "status": job.status, "parchment_color": job.parchment_color},
    )


def _rebuild_snapshots(job: JobCard, *, qty: float, color: Optional[str], token: str, plant_id: str) -> None:
    """Refreeze spec/routing/material snapshots for a new qty/color (queued cards only)."""
    live_order = _fetch_sales_order(job.sales_order_id, token, plant_id)
    line = next((row for row in (live_order.get("lines") or []) if str(row.get("id")) == str(job.sales_order_line_id)), None)
    if line is None:
        raise HTTPException(status_code=409, detail="The sales order line of this job card was not found")
    line_payload = {**line, "product_code": job.product_code or line.get("product_code")}
    if color:
        line_payload["parchment_color"] = color
    spec = _fetch_spec(job.spec_id, token, plant_id)
    priority = str((job.spec_snapshot or {}).get("priority") or live_order.get("priority") or "NORMAL").upper()
    spec_snapshot, routing_snapshot, material_plan_snapshot, requires_slitting = _build_job_card_snapshots(
        spec=spec, line=line_payload, live_order=live_order, priority=priority, token=token, plant_id=plant_id, planned_qty=qty
    )
    job.spec_snapshot, job.routing_snapshot, job.material_plan_snapshot = spec_snapshot, routing_snapshot, material_plan_snapshot
    job.requires_slitting = requires_slitting


def _resize_open_first_stage(db: Session, job: JobCard, qty: float) -> None:
    """A queued card has one open first-stage segment: give it the new qty/capacity."""
    stage_type = _first_stage(job)
    stage_row = db.query(JobCardStage).filter(JobCardStage.job_card_id == job.id, JobCardStage.stage_type == stage_type).first()
    open_segments = _open_stage_segments(db, job.id, stage_type)
    capacity = _required_capacity_for_job(stage=stage_type, planned_qty=qty, spec_snapshot=job.spec_snapshot or {})
    if open_segments:
        keep, extra = open_segments[0], open_segments[1:]
        keep.planned_qty = round(qty, 2)
        keep.required_capacity = capacity
        for row in extra:
            row.status = "CANCELLED"
    if stage_row is not None:
        stage_row.required_capacity = capacity
        _sync_stage_row_from_segments(stage_row, _all_stage_segments(db, job.id, stage_type))


# ── lifecycle view ─────────────────────────────────────────────────────────


@router.get("/job-cards/{job_card_id}/lifecycle")
def get_job_card_lifecycle(
    job_card_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(ROLES_FLOOR + ["Sales", "QC", "Store"])),
):
    job = db.query(JobCard).filter(JobCard.id == job_card_id, JobCard.plant_id == _to_uuid(plant_id)).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job card not found")
    state, views = _state(db, job)
    first = _first_stage(job)
    first_views = [v for v in views if v.stage == first]
    open_first = sum(v.planned_qty for v in first_views if v.status in {"PLANNED", "QUEUED", "ASSIGNED"})
    made_pcs, made_raw = _made_pcs(job, views)
    ppb = _ppb(job)
    stages_out = []
    for row in sorted(db.query(JobCardStage).filter(JobCardStage.job_card_id == job.id).all(), key=lambda r: _routing(job).index(r.stage_type) if r.stage_type in _routing(job) else 99):
        running_log = list((row.actuals_snapshot or {}).get("running_log") or [])
        stage_views = [v for v in views if v.stage == row.stage_type]
        stages_out.append(
            {
                "stage": row.stage_type,
                "unit": stage_unit(row.stage_type),
                "planned_in_unit": planned_in_stage_units(row.stage_type, float(job.planned_qty or 0.0), ppb),
                "status": row.status,
                "planned_qty": round(sum(v.planned_qty for v in stage_views), 2) or float(job.planned_qty or 0.0),
                "output_qty": round(sum(v.output_qty for v in stage_views if v.status in {"RUNNING", "COMPLETED"}), 2),
                "running_total": round(sum(float(entry.get("qty") or 0.0) for entry in running_log), 2),
                "running_entries": running_log[-20:],
                "segments": [
                    {"id": v.id, "status": v.status, "planned_qty": v.planned_qty, "output_qty": v.output_qty, "machine_id": v.machine_id, "plan_date": v.plan_date, "shift_code": v.shift_code, "sequence_no": v.sequence_no}
                    for v in sorted(stage_views, key=lambda v: (v.plan_date or date.max, v.shift_code or "", v.sequence_no))
                ],
            }
        )
    family_root = job.parent_job_card_id or job.id
    family = (
        db.query(JobCard)
        .filter((JobCard.id == family_root) | (JobCard.parent_job_card_id == family_root) | (JobCard.parent_job_card_id == job.id))
        .order_by(JobCard.created_at.asc())
        .all()
    )
    events = (
        db.query(AuditEvent)
        .filter(AuditEvent.job_card_id == job.id)
        .order_by(AuditEvent.event_ts.desc())
        .limit(60)
        .all()
    )
    return {
        "id": str(job.id),
        "job_card_no": job.job_card_no,
        "state": state,
        "status": job.status,
        "current_stage": job.current_stage,
        "first_stage": first,
        "parchment_color": job.parchment_color,
        "is_emergency": bool(job.is_emergency),
        "planned_qty": float(job.planned_qty or 0.0),
        "released_qty": float(job.released_qty or 0.0),
        "made_qty": made_pcs,
        "made_in_anchor_unit": made_raw,
        "anchor_stage": _anchor_stage(job),
        "pcs_per_bamboo": ppb,
        "open_first_stage_qty": round(open_first, 2),
        "returned_qty": float(job.returned_qty or 0.0),
        "output_tolerance_pct": round(OUTPUT_TOLERANCE * 100),
        "max_output_qty": round(float(job.planned_qty or 0.0) * (1 + OUTPUT_TOLERANCE), 2),
        "close_mode": job.close_mode,
        "missed_slot_count": int(job.missed_slot_count or 0),
        "missed_slot_open": bool(job.missed_slot_open),
        "last_missed_slot": job.last_missed_slot,
        "close_reason": job.close_reason,
        "closed_at": job.closed_at,
        "closed_by": job.closed_by,
        "actions": allowed_actions(state, has_release_lot=bool(job.release_lot_id), open_first_stage_qty=open_first),
        "stages": stages_out,
        "family": [
            {"id": str(row.id), "job_card_no": row.job_card_no, "split_kind": row.split_kind, "planned_qty": float(row.planned_qty or 0.0), "status": row.status, "close_mode": row.close_mode, "is_self": row.id == job.id}
            for row in family
        ],
        "events": [
            {"id": str(e.id), "action": e.action, "actor": e.actor_id, "role": e.actor_role, "at": e.event_ts, "payload": e.payload or {}}
            for e in events
        ],
        "sales_order_id": str(job.sales_order_id),
        "sales_order_line_id": str(job.sales_order_line_id) if job.sales_order_line_id else None,
        "release_lot_id": str(job.release_lot_id) if job.release_lot_id else None,
    }


# ── edit (queued only) ─────────────────────────────────────────────────────


class AmendPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    planned_qty: Optional[float] = Field(default=None, gt=0)
    parchment_color: Optional[str] = Field(default=None, max_length=100)
    parchment_color_id: Optional[uuid.UUID] = None
    reason: Optional[str] = Field(default=None, max_length=500)


@router.post("/job-cards/{job_card_id}/amend")
def amend_job_card(
    job_card_id: uuid.UUID,
    payload: AmendPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(ROLES_PLAN)),
):
    job = _load_job(db, job_card_id, plant_id)
    state, _ = _state(db, job)
    if state != "QUEUED":
        raise HTTPException(
            status_code=409,
            detail="Only a queued job card (not on the schedule yet) can be edited. Force-close it and re-release the balance instead.",
        )
    if not job.release_lot_id:
        raise HTTPException(status_code=409, detail="Job card has no sales release lot to amend")
    new_qty = float(payload.planned_qty or job.planned_qty or 0.0)
    new_color = (payload.parchment_color or "").strip() or job.parchment_color
    if abs(new_qty - float(job.planned_qty or 0.0)) < 1e-6 and (new_color or "") == (job.parchment_color or ""):
        raise HTTPException(status_code=400, detail="Nothing changed")
    before = {"planned_qty": float(job.planned_qty or 0.0), "parchment_color": job.parchment_color}
    token = current_user.get("token", "")

    # Production side first (snapshot rebuild can fail on a remote read); sales is told last, so a
    # refusal or failure anywhere leaves both sides unchanged. Sales amend is idempotent on retry.
    try:
        job.parchment_color = new_color
        job.planned_qty = round(new_qty, 4)
        job.released_qty = round(new_qty, 4)
        _rebuild_snapshots(job, qty=new_qty, color=new_color, token=token, plant_id=plant_id)
        _resize_open_first_stage(db, job, new_qty)
        db.flush()
        lot = _sales_call(
            f"/release-lots/{job.release_lot_id}/amend",
            {"job_card_id": str(job.id), "release_qty": new_qty, "parchment_color": new_color, "parchment_color_id": str(payload.parchment_color_id) if payload.parchment_color_id else None, "reason": payload.reason},
            token,
            plant_id,
        )
        job.parchment_color = lot.get("parchment_color") or new_color
        _audit(db, job, "job_card_amended", current_user, {"before": before, "after": {"planned_qty": new_qty, "parchment_color": job.parchment_color}, "reason": payload.reason}, before)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return get_job_card_lifecycle(job.id, db, plant_id, current_user)


# ── split ──────────────────────────────────────────────────────────────────


class SplitPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    qty: float = Field(..., gt=0)
    reason: Optional[str] = Field(default=None, max_length=500)
    # Same id on a retry (lost response) returns the first split instead of cutting a second card.
    request_id: Optional[str] = Field(default=None, max_length=120)


@router.post("/job-cards/{job_card_id}/split")
def split_job_card(
    job_card_id: uuid.UUID,
    payload: SplitPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(ROLES_PLAN)),
):
    """Cut ``qty`` of the not-yet-started balance into a new card ``ROOT-A`` (same color, own lot)."""
    job = _load_job(db, job_card_id, plant_id)
    child_id = uuid.uuid5(uuid.NAMESPACE_URL, f"hariom:split:{job.id}:{payload.request_id}") if payload.request_id else uuid.uuid4()
    earlier = db.get(JobCard, child_id) if payload.request_id else None
    if earlier is not None:
        return {"parent": get_job_card_lifecycle(job.id, db, plant_id, current_user), "child_job_card_id": str(earlier.id), "child_job_card_no": earlier.job_card_no, "replayed": True}
    state, views = _state(db, job)
    if state not in {"QUEUED", "SCHEDULED", "RUNNING"}:
        raise HTTPException(status_code=409, detail=f"A {state.lower().replace('_', ' ')} job card cannot be split")
    if not job.release_lot_id:
        raise HTTPException(status_code=409, detail="Job card has no sales release lot to split")
    first = _first_stage(job)
    first_views = [v for v in views if v.stage == first]
    qty = round(float(payload.qty), 4)
    try:
        changes = plan_split_take(first_views, qty)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if qty >= float(job.planned_qty or 0.0) - 1e-6:
        raise HTTPException(status_code=400, detail="Split must leave some quantity on the original card")
    token = current_user.get("token", "")
    before = {"planned_qty": float(job.planned_qty or 0.0)}

    for segment_id, new_qty in changes:
        segment = db.query(JobCardStageSegment).filter(JobCardStageSegment.id == uuid.UUID(segment_id)).first()
        if segment is None:
            continue
        if new_qty <= 1e-6:
            segment.status = "CANCELLED"
        else:
            ratio = new_qty / float(segment.planned_qty or new_qty)
            segment.required_capacity = round(float(segment.required_capacity or 0.0) * ratio, 2)
            segment.planned_qty = round(new_qty, 2)
    job.planned_qty = round(float(job.planned_qty or 0.0) - qty, 4)
    job.released_qty = round(float(job.released_qty or 0.0) - qty, 4)
    stage_row = db.query(JobCardStage).filter(JobCardStage.job_card_id == job.id, JobCardStage.stage_type == first).first()
    if stage_row is not None:
        _sync_stage_row_from_segments(stage_row, _all_stage_segments(db, job.id, first))

    child = JobCard(
        id=child_id,
        plant_id=job.plant_id,
        sales_order_id=job.sales_order_id,
        sales_order_line_id=job.sales_order_line_id,
        release_lot_id=None,
        spec_id=job.spec_id,
        spec_snapshot=dict(job.spec_snapshot or {}),
        routing_snapshot=dict(job.routing_snapshot or {}),
        material_plan_snapshot=dict(job.material_plan_snapshot or {}),
        released_qty=qty,
        planned_qty=qty,
        assigned_winder_machine_id=job.assigned_winder_machine_id,
        product_code=job.product_code,
        status="PLANNED",
        current_stage=first,
        requires_slitting=bool(job.requires_slitting),
        parent_job_card_id=job.parent_job_card_id or job.id,
        split_kind="SPLIT",
        parchment_color=job.parchment_color,
        is_emergency=False,
        job_card_no=allocate_child_job_card_no(db, job.job_card_no),
    )
    db.add(child)
    db.flush()
    try:
        _rebuild_snapshots(child, qty=qty, color=child.parchment_color, token=token, plant_id=plant_id)
        _rebuild_snapshots(job, qty=float(job.planned_qty), color=job.parchment_color, token=token, plant_id=plant_id) if state == "QUEUED" else None
    except HTTPException:
        pass  # snapshots stay copied from the parent; quantities below are authoritative
    _ensure_job_card_stages(db=db, job_card=child, routing_stages=_routing(child), first_stage=first)
    child_stage = db.query(JobCardStage).filter(JobCardStage.job_card_id == child.id, JobCardStage.stage_type == first).first()
    if child_stage is not None:
        open_rows = _open_stage_segments(db, child.id, first)
        capacity = _required_capacity_for_job(stage=first, planned_qty=qty, spec_snapshot=child.spec_snapshot or {})
        segment = open_rows[0] if open_rows else _append_stage_segment(
            db=db, job_card=child, stage_row=child_stage, machine_id=None, plan_date=datetime.now(PLANT_TIMEZONE).date(),
            shift_code=None, planned_qty=qty, required_capacity=capacity, split_source="NONE", split_parent_segment_id=None, status="QUEUED",
        )
        segment.machine_id, segment.shift_code, segment.status = None, None, "QUEUED"
        segment.planned_qty, segment.required_capacity = round(qty, 2), capacity
        child_stage.machine_id, child_stage.shift_code = None, None
        _sync_stage_row_from_segments(child_stage, _all_stage_segments(db, child.id, first))

    try:
        lot = _sales_call(
            f"/release-lots/{job.release_lot_id}/reallocate-carry-forward",
            {"carry_forward_job_card_id": str(child.id), "gap_qty": qty, "release_lot_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"hariom:split-release:{child.id}"))},
            token,
            plant_id,
        )
    except Exception:
        db.rollback()
        raise
    child.release_lot_id = uuid.UUID(str(lot.get("release_lot_id") or lot.get("id")))
    _audit(db, job, "job_card_split", current_user, {"child_job_card_id": str(child.id), "child_job_card_no": child.job_card_no, "qty": qty, "reason": payload.reason}, before)
    _audit(db, child, "job_card_created_by_split", current_user, {"parent_job_card_id": str(job.id), "parent_job_card_no": job.job_card_no, "qty": qty, "reason": payload.reason})
    db.commit()
    return {"parent": get_job_card_lifecycle(job.id, db, plant_id, current_user), "child_job_card_id": str(child.id), "child_job_card_no": child.job_card_no}


# ── force close ────────────────────────────────────────────────────────────


class ForceClosePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(..., min_length=3, max_length=500)


@router.post("/job-cards/{job_card_id}/force-close")
def force_close_job_card(
    job_card_id: uuid.UUID,
    payload: ForceClosePayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(ROLES_PLAN)),
):
    """Close at the qty actually made; the unmade balance goes back to the SO for re-release.

    Made qty keeps moving through the remaining stages (oven, process, packing …) as this
    same card/lot. Nothing made → the card is cancelled and its whole qty returns.
    """
    job = _load_job(db, job_card_id, plant_id)
    state, views = _state(db, job)
    if state not in {"QUEUED", "SCHEDULED", "RUNNING"}:
        raise HTTPException(status_code=409, detail=f"Job card is already {state.lower().replace('_', ' ')}")
    if not job.release_lot_id:
        raise HTTPException(status_code=409, detail="Job card has no sales release lot to return the balance to")
    first = _anchor_stage(job)
    first_rows = [row for row in _all_stage_segments(db, job.id, first) if row.status != "CANCELLED"]
    made_units = round(sum(float(row.output_qty or 0.0) for row in first_rows if row.status in {"RUNNING", "COMPLETED"}), 4)
    planned = float(job.planned_qty or 0.0)
    made = round(min(planned, stage_units_to_pcs(first, made_units, _ppb(job))), 4)
    returned = round(max(0.0, planned - made), 4)
    if returned <= 1e-6:
        raise HTTPException(status_code=400, detail="Everything planned is already made — complete the card normally instead")
    before = {"planned_qty": planned, "made_qty": made, "status": job.status}
    now = datetime.utcnow()

    if made <= 1e-6:
        for row in db.query(JobCardStageSegment).filter(JobCardStageSegment.job_card_id == job.id, JobCardStageSegment.status.notin_(["COMPLETED", "CANCELLED"])).all():
            row.status = "CANCELLED"
        job.status = "CANCELLED"
        job.close_mode = "CANCELLED"
    else:
        for row in first_rows:
            if row.status == "RUNNING":
                row.status = "COMPLETED"
                row.completed_at = row.completed_at or now
            elif row.status in {"PLANNED", "QUEUED", "ASSIGNED"}:
                row.status = "CANCELLED"
        db.flush()
        stage_row = db.query(JobCardStage).filter(JobCardStage.job_card_id == job.id, JobCardStage.stage_type == first).first()
        if stage_row is not None:
            _sync_stage_row_from_segments(stage_row, _all_stage_segments(db, job.id, first))
            stage_row.status = "COMPLETED"
            stage_row.output_qty = made_units
            stage_row.actual_end = stage_row.actual_end or now
        job.planned_qty = made
        routing = _routing(job)
        next_index = routing.index(first) + 1 if first in routing else len(routing)
        if next_index < len(routing):
            next_type = routing[next_index]
            next_row = db.query(JobCardStage).filter(JobCardStage.job_card_id == job.id, JobCardStage.stage_type == next_type).first()
            if next_row is not None:
                next_row.input_qty = next_row.input_qty if next_row.input_qty is not None else made_units
                next_row.required_capacity = _required_capacity_for_job(stage=next_type, planned_qty=made, spec_snapshot=job.spec_snapshot or {})
                next_row.plan_date = next_row.plan_date or (stage_row.plan_date if stage_row else None)
                if not [row for row in _all_stage_segments(db, job.id, next_type) if row.status != "CANCELLED"]:
                    _append_stage_segment(
                        db=db, job_card=job, stage_row=next_row, machine_id=next_row.machine_id, plan_date=next_row.plan_date,
                        shift_code=next_row.shift_code if next_row.machine_id else None, planned_qty=made,
                        required_capacity=float(next_row.required_capacity or 0.0), split_source="NONE", split_parent_segment_id=None,
                        status="ASSIGNED" if next_row.machine_id else "QUEUED",
                    )
                else:
                    for row in _open_stage_segments(db, job.id, next_type):
                        row.planned_qty = min(float(row.planned_qty or made), made)
                _sync_stage_row_from_segments(next_row, _all_stage_segments(db, job.id, next_type))
        stages = db.query(JobCardStage).filter(JobCardStage.job_card_id == job.id).all()
        job.current_stage, job.status = _derive_job_current_stage_and_status(stages)
        job.close_mode = "FORCE"

    job.returned_qty = returned
    job.released_qty = made
    job.close_reason = payload.reason.strip()
    job.closed_at = now
    job.closed_by = current_user.get("sub")
    db.flush()
    try:  # sales last: if it refuses, the card stays open; return-balance is idempotent on retry
        _sales_call(
            f"/release-lots/{job.release_lot_id}/return-balance",
            {"job_card_id": str(job.id), "returned_qty": returned, "reason": payload.reason},
            current_user.get("token", ""),
            plant_id,
        )
    except Exception:
        db.rollback()
        raise
    _audit(db, job, "job_card_force_closed", current_user, {"made_qty": made, "made_in_stage_unit": made_units, "stage": first, "returned_qty": returned, "reason": payload.reason, "mode": job.close_mode}, before)
    db.commit()
    return get_job_card_lifecycle(job.id, db, plant_id, current_user)


# ── emergency insert ───────────────────────────────────────────────────────


class EmergencyPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    job_card_id: uuid.UUID
    machine_id: uuid.UUID
    plan_date: date
    shift_code: str = Field(..., pattern="^SHIFT_[AB]$")
    reason: str = Field(..., min_length=3, max_length=500)


@router.post("/planning/emergency-insert")
def emergency_insert(
    payload: EmergencyPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(ROLES_PLAN)),
):
    """Put a card first in a slot and push the overflow of that slot (and onward) to later shifts."""
    job = _load_job(db, payload.job_card_id, plant_id)
    state, _ = _state(db, job)
    if state not in {"QUEUED", "SCHEDULED"}:
        raise HTTPException(status_code=409, detail="Only a queued or scheduled card can be inserted as an emergency")
    first = _first_stage(job)
    job.is_emergency = True
    # The emergency card goes in whole and first (no auto-split); the others make room.
    open_rows = [row for row in _open_stage_segments(db, job.id, first) if row.status in {"PLANNED", "QUEUED", "ASSIGNED"}]
    if not open_rows:
        raise HTTPException(status_code=409, detail="This card has no unstarted work left on its first stage")
    lead, rest = open_rows[0], open_rows[1:]
    lead.planned_qty = round(sum(float(row.planned_qty or 0.0) for row in open_rows), 2)
    lead.required_capacity = round(sum(float(row.required_capacity or 0.0) for row in open_rows), 2)
    for row in rest:
        row.status = "CANCELLED"
    lead.status = "ASSIGNED"
    db.flush()
    _place_stage_segment(db, lead, 1, payload.machine_id, payload.plan_date, payload.shift_code)
    stage_row = db.query(JobCardStage).filter(JobCardStage.job_card_id == job.id, JobCardStage.stage_type == first).first()
    if stage_row is not None:
        _sync_stage_row_from_segments(stage_row, _all_stage_segments(db, job.id, first))
    if job.status == "CREATED":
        job.status = "PLANNED"
    db.flush()
    pinned = {str(row.id) for row in _open_stage_segments(db, job.id, first)}
    token = current_user.get("token", "")
    machine = _fetch_machine(payload.machine_id, token, plant_id)
    closed = _fetch_plant_closed_dates(token, plant_id, payload.plan_date, horizon_days=45)
    moves: list[dict[str, Any]] = []
    slot_date, slot_shift = payload.plan_date, payload.shift_code
    for _ in range(40):
        capacity, _unit = _resolve_capacity_profile(
            db=db, plant_id=job.plant_id, stage=first, machine_id=payload.machine_id,
            machine_capacity=float(machine.get("capacity_value") or 0.0), on_day=slot_date,
        )
        rows = (
            db.query(JobCardStageSegment)
            .filter(
                JobCardStageSegment.plant_id == job.plant_id,
                JobCardStageSegment.stage_type == first,
                JobCardStageSegment.machine_id == payload.machine_id,
                JobCardStageSegment.plan_date == slot_date,
                JobCardStageSegment.shift_code == slot_shift,
                JobCardStageSegment.status.notin_(["COMPLETED", "CANCELLED"]),
            )
            .all()
        )
        views = [SegmentView(id=str(r.id), stage=first, status=r.status, planned_qty=float(r.planned_qty or 0), sequence_no=int(r.sequence_no or 1), load=float(r.required_capacity or 0)) for r in rows]
        to_move = plan_bump(views, float(capacity or 0.0), pinned)
        if not to_move:
            break
        target_date, target_shift = next_slot(slot_date, slot_shift, closed)
        for position, segment_id in enumerate(reversed(to_move), start=1):
            segment = next(r for r in rows if str(r.id) == segment_id)
            _place_stage_segment(db, segment, position, payload.machine_id, target_date, target_shift)
            stage_row = db.query(JobCardStage).filter(JobCardStage.job_card_id == segment.job_card_id, JobCardStage.stage_type == first).first()
            if stage_row is not None:
                _sync_stage_row_from_segments(stage_row, _all_stage_segments(db, segment.job_card_id, first))
            moved_job = db.query(JobCard).filter(JobCard.id == segment.job_card_id).first()
            moves.append({"segment_id": segment_id, "job_card_id": str(segment.job_card_id), "job_card_no": moved_job.job_card_no if moved_job else None, "from": {"date": str(slot_date), "shift": slot_shift}, "to": {"date": str(target_date), "shift": target_shift}})
        pinned = set()
        slot_date, slot_shift = target_date, target_shift
    _audit(db, job, "job_card_emergency_insert", current_user, {"machine_id": str(payload.machine_id), "plan_date": str(payload.plan_date), "shift_code": payload.shift_code, "reason": payload.reason, "bumped": moves})
    db.commit()
    return {"job_card_id": str(job.id), "job_card_no": job.job_card_no, "bumped": moves}


# ── live running entry (winder → oven continuous flow) ─────────────────────


class RunningEntryPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    stage: str = Field(..., pattern="^(WINDER|OVEN)$")
    qty: float = Field(..., ge=0)
    scrap_qty: float = Field(default=0.0, ge=0)
    shift_code: Optional[str] = Field(default=None, pattern="^SHIFT_[AB]$")
    entry_date: Optional[date] = None
    machine_id: Optional[uuid.UUID] = None
    note: Optional[str] = Field(default=None, max_length=300)
    # Same id on a retry (lost response) is recorded once.
    request_id: Optional[str] = Field(default=None, max_length=120)


@router.post("/job-cards/{job_card_id}/running-entry")
def add_running_entry(
    job_card_id: uuid.UUID,
    payload: RunningEntryPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(ROLES_FLOOR)),
):
    """Log output as it happens. Winder and oven run together on one card/lot; the oven
    can never be ahead of what was wound, and the winder may run up to +10% over plan."""
    job = _load_job(db, job_card_id, plant_id)
    if restore_missed_slot_for_late_entry(db, job, payload.stage, current_user.get("sub"), _current_actor_role(current_user)):
        db.flush()
    state, _ = _state(db, job)
    if state not in {"SCHEDULED", "RUNNING", "FORCE_CLOSED"}:
        raise HTTPException(status_code=409, detail="Put the card on the schedule before recording output")
    stage_type = payload.stage
    if stage_type not in _routing(job):
        raise HTTPException(status_code=400, detail=f"{stage_type} is not on this card's route")
    stage_row = db.query(JobCardStage).filter(JobCardStage.job_card_id == job.id, JobCardStage.stage_type == stage_type).first()
    if stage_row is None:
        raise HTTPException(status_code=400, detail=f"{stage_type} stage is missing on this card")
    if stage_row.status == "COMPLETED":
        raise HTTPException(status_code=409, detail=f"{stage_type} is already finalised")
    log = list((stage_row.actuals_snapshot or {}).get("running_log") or [])
    if payload.request_id and any(entry.get("request_id") == payload.request_id for entry in log):
        return {**get_job_card_lifecycle(job.id, db, plant_id, current_user), "replayed": True}
    total = sum(float(entry.get("qty") or 0.0) for entry in log) + float(payload.qty)
    planned_units = planned_in_stage_units(stage_type, float(job.planned_qty or 0.0), _ppb(job))
    if stage_type == "WINDER" and not within_output_tolerance(planned_units, total):
        raise HTTPException(
            status_code=409,
            detail=f"Winder total {total:,.0f} {stage_unit(stage_type)} would pass the +{int(OUTPUT_TOLERANCE * 100)}% limit ({planned_units * (1 + OUTPUT_TOLERANCE):,.0f})",
        )
    if stage_type == "OVEN":
        winder_row = db.query(JobCardStage).filter(JobCardStage.job_card_id == job.id, JobCardStage.stage_type == "WINDER").first()
        wound = 0.0
        if winder_row is not None:
            wound = max(
                sum(float(entry.get("qty") or 0.0) for entry in (winder_row.actuals_snapshot or {}).get("running_log") or []),
                float(winder_row.output_qty or 0.0),
            )
        if total > wound + 1e-6:
            raise HTTPException(status_code=409, detail=f"Oven total {total:,.0f} cannot pass what the winder has made so far ({wound:,.0f})")
    now = datetime.utcnow()
    entry = {
        "at": now.isoformat(),
        "date": str(payload.entry_date or datetime.now(PLANT_TIMEZONE).date()),
        "shift": payload.shift_code,
        "qty": round(float(payload.qty), 3),
        "scrap": round(float(payload.scrap_qty), 3),
        "machine_id": str(payload.machine_id) if payload.machine_id else (str(stage_row.machine_id) if stage_row.machine_id else None),
        "by": current_user.get("sub"),
        "note": payload.note,
        "request_id": payload.request_id,
    }
    stage_row.actuals_snapshot = {**(stage_row.actuals_snapshot or {}), "running_log": log + [entry]}
    segment_rows = _open_stage_segments(db, job.id, stage_type)
    segment = segment_rows[0] if segment_rows else _append_stage_segment(
        db=db, job_card=job, stage_row=stage_row, machine_id=payload.machine_id or stage_row.machine_id, plan_date=payload.entry_date or stage_row.plan_date,
        shift_code=payload.shift_code or stage_row.shift_code, planned_qty=float(job.planned_qty or 0.0),
        required_capacity=_required_capacity_for_job(stage=stage_type, planned_qty=float(job.planned_qty or 0.0), spec_snapshot=job.spec_snapshot or {}),
        split_source="NONE", split_parent_segment_id=None, status="RUNNING",
    )
    completed_before = sum(float(r.output_qty or 0.0) for r in _all_stage_segments(db, job.id, stage_type) if r.status == "COMPLETED")
    segment.status = "RUNNING"
    segment.started_at = segment.started_at or now
    segment.output_qty = round(max(0.0, total - completed_before), 3)
    segment.scrap_qty = round(float(segment.scrap_qty or 0.0) + float(payload.scrap_qty), 3)
    if payload.machine_id and not segment.machine_id:
        segment.machine_id = payload.machine_id
    stage_row.actual_start = stage_row.actual_start or now
    _sync_stage_row_from_segments(stage_row, _all_stage_segments(db, job.id, stage_type))
    stage_row.output_qty = round(total, 3)
    if job.status in {"CREATED", "PLANNED"}:
        job.status = "IN_PROGRESS"
    _record_audit_event(
        db=db, plant_id=job.plant_id, entity_type="job_card_stage", entity_id=stage_row.id, action="running_entry",
        actor_id=current_user.get("sub"), actor_role=_current_actor_role(current_user), job_card_id=job.id,
        payload={"stage": stage_type, **entry, "total": round(total, 3)},
    )
    db.commit()
    return get_job_card_lifecycle(job.id, db, plant_id, current_user)


# ── winder queue load (release dialog bar graph) ───────────────────────────


@router.get("/planning/winder-load")
def winder_queue_load(
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(ROLES_FLOOR + ["Sales"])),
):
    """Open pcs per winder: waiting in queue vs already on the calendar, next 7 days."""
    plant_uuid = _to_uuid(plant_id)
    rows = (
        db.query(JobCardStageSegment, JobCard)
        .join(JobCard, JobCard.id == JobCardStageSegment.job_card_id)
        .filter(
            JobCardStageSegment.plant_id == plant_uuid,
            JobCardStageSegment.stage_type == "WINDER",
            JobCardStageSegment.status.notin_(["COMPLETED", "CANCELLED"]),
            JobCard.status.notin_(["COMPLETED", "CANCELLED"]),
        )
        .all()
    )
    today = datetime.now(PLANT_TIMEZONE).date()
    machines: dict[str, dict[str, Any]] = {}
    for segment, job in rows:
        machine_key = str(segment.machine_id or job.assigned_winder_machine_id or "unassigned")
        bucket = machines.setdefault(machine_key, {"machine_id": machine_key, "queued_pcs": 0.0, "scheduled_pcs": 0.0, "running_pcs": 0.0, "cards": set(), "by_day": {}})
        remaining = max(0.0, float(segment.planned_qty or 0.0) - float(segment.output_qty or 0.0))
        bucket["cards"].add(str(job.id))
        if segment.status == "RUNNING":
            bucket["running_pcs"] += remaining
        elif segment.shift_code and segment.machine_id:
            bucket["scheduled_pcs"] += remaining
            if segment.plan_date and 0 <= (segment.plan_date - today).days < 7:
                key = str(segment.plan_date)
                bucket["by_day"][key] = bucket["by_day"].get(key, 0.0) + remaining
        else:
            bucket["queued_pcs"] += remaining
    return {
        "as_of": str(today),
        "machines": [
            {
                "machine_id": key,
                "queued_pcs": round(value["queued_pcs"], 0),
                "scheduled_pcs": round(value["scheduled_pcs"], 0),
                "running_pcs": round(value["running_pcs"], 0),
                "open_pcs": round(value["queued_pcs"] + value["scheduled_pcs"] + value["running_pcs"], 0),
                "cards": len(value["cards"]),
                "by_day": [{"date": day, "pcs": round(pcs, 0)} for day, pcs in sorted(value["by_day"].items())],
            }
            for key, value in sorted(machines.items())
        ],
    }


# ── missed slots (scheduled, no entry for 36h after the shift) ─────────────


@router.post("/planning/missed-slots/sweep")
def run_missed_slot_sweep(
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(ROLES_FLOOR + ["Sales"])),
):
    """Requeue overdue silent cards now; returns the ones moved (BFF notifies the planners)."""
    return {"requeued": sweep_missed_slots(db, _to_uuid(plant_id))}


@router.get("/planning/missed-slots")
def list_missed_slots(
    include_resolved: bool = False,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(ROLES_FLOOR + ["Sales", "QC", "Store"])),
):
    query = db.query(JobCard).filter(JobCard.missed_slot_count > 0)
    if str(plant_id).upper() != "ALL":
        query = query.filter(JobCard.plant_id == _to_uuid(plant_id))
    if not include_resolved:
        query = query.filter(JobCard.missed_slot_open.is_(True))
    rows = query.order_by(JobCard.created_at.desc()).limit(200).all()
    return [
        {
            "job_card_id": str(row.id),
            "job_card_no": row.job_card_no,
            "status": row.status,
            "planned_qty": float(row.planned_qty or 0.0),
            "parchment_color": row.parchment_color,
            "missed_slot_count": int(row.missed_slot_count or 0),
            "missed_slot_open": bool(row.missed_slot_open),
            "last_missed_slot": row.last_missed_slot,
            "sales_order_id": str(row.sales_order_id),
            "customer_name": (row.spec_snapshot or {}).get("customer_name_snapshot") or (row.spec_snapshot or {}).get("customer_name"),
            "product_code": row.product_code,
        }
        for row in rows
    ]


@router.get("/job-cards/spec-usage/{spec_id}")
def job_cards_spec_usage(
    spec_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_role(ROLES_FLOOR + ["Sales", "QC", "Store"])),
):
    """Running (not completed/cancelled) job cards on a specification (live-spec edit lock)."""
    rows = db.query(JobCard).filter(JobCard.spec_id == spec_id, JobCard.status.notin_(["COMPLETED", "CANCELLED"])).all()
    return {"spec_id": str(spec_id), "open_job_cards": len(rows), "job_card_nos": [row.job_card_no for row in rows][:20]}
