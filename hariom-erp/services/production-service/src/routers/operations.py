"""Operations honesty endpoints — short-close + downtime + data-entry-lag.

Three feature areas live in this single file so the operational surface stays
together:

    • POST /operations/short-close/{job_card_id}
          Close a job card with `gap_qty < planned_qty` and a normalized
          reason code. Caller picks one of three decisions:
              - CARRY_FORWARD    auto-spawn a top-up job card for the gap
              - SHORT_CLOSE_SO   reduce the SO line qty (sales role)
              - HOLD             leave the gap open, decide later

    • POST /operations/downtime
          Log a downtime event on a machine with start, end, reason.
          The optional `is_planned` flag separates maintenance from breakdown.

    • GET  /operations/data-entry-lag
          Roll-up of `entered_at - actual_end` across recent stages with
          median + p90 lag, and a list of the laggard rows.

Each handler emits an audit event for the operations timeline.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from statistics import median
from typing import Any, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import (
    JobCard,
    JobCardShortClose,
    JobCardStage,
    MachineDowntime,
)
from ..utils.auth import get_current_plant_scope, require_role
from ..utils.audit import record_audit_event

router = APIRouter(prefix="/operations", tags=["Operations"])
settings = get_settings()


def _scope_uuid(plant_scope: dict, *, action: str) -> Optional[uuid.UUID]:
    if plant_scope.get("scope_all"):
        return None
    selected = plant_scope.get("selected_plant_id")
    try:
        return uuid.UUID(str(selected)) if selected else None
    except (TypeError, ValueError):
        raise HTTPException(status_code=403, detail=f"Invalid plant scope for {action}")


def _apply_plant_scope(query, column, plant_scope: dict, *, action: str):
    selected = _scope_uuid(plant_scope, action=action)
    if selected is None:
        return query
    return query.filter(column == selected)


def _sync_sales_short_close(
    *,
    token: str,
    plant_id: uuid.UUID,
    sales_order_line_id: uuid.UUID,
    job_card_id: uuid.UUID,
    produced_qty: float,
    gap_qty: float,
    reason_code: str,
    notes: Optional[str],
) -> None:
    """Reduce the sales line/release lot for a SHORT_CLOSE_SO decision."""
    try:
        response = httpx.post(
            f"{settings.SALES_SERVICE_URL}/sales-orders/lines/{sales_order_line_id}/short-close",
            headers={"Authorization": f"Bearer {token}", "X-Plant-ID": str(plant_id)},
            json={
                "job_card_id": str(job_card_id),
                "produced_qty": produced_qty,
                "gap_qty": gap_qty,
                "reason_code": reason_code,
                "notes": notes,
            },
            timeout=10.0,
        )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Sales short-close sync failed: {exc}") from exc
    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"Sales short-close sync failed: {response.text[:240]}",
        )


# ──────────────────────────────────────────────────────────────────────────
# Short-close + carry-forward
# ──────────────────────────────────────────────────────────────────────────


class ShortClosePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    produced_qty: float = Field(..., ge=0)
    reason_code: str  # must exist in masterdata reason_code with category=SHORT_CLOSE
    decision: str  # CARRY_FORWARD | SHORT_CLOSE_SO | HOLD
    notes: Optional[str] = None


class ShortCloseResponse(BaseModel):
    id: uuid.UUID
    job_card_id: uuid.UUID
    planned_qty: float
    produced_qty: float
    gap_qty: float
    reason_code: str
    decision: str
    carry_forward_job_card_id: Optional[uuid.UUID] = None
    notes: Optional[str] = None
    created_at: datetime


@router.post("/short-close/{job_card_id}", response_model=ShortCloseResponse)
def short_close_job_card(
    job_card_id: uuid.UUID,
    payload: ShortClosePayload,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["PlantManager", "Admin", "Owner"])),
):
    decision = (payload.decision or "").strip().upper()
    if decision not in {"CARRY_FORWARD", "SHORT_CLOSE_SO", "HOLD"}:
        raise HTTPException(status_code=422, detail="decision must be CARRY_FORWARD, SHORT_CLOSE_SO, or HOLD")
    reason_code = (payload.reason_code or "").strip().upper()
    if not reason_code:
        raise HTTPException(status_code=422, detail="reason_code is required")

    # Plant-scope enforcement: a user cannot short-close a job card outside
    # their plant scope. ALL-scope (owner) passes; otherwise the job must
    # belong to the user's selected plant.
    query = db.query(JobCard).filter(JobCard.id == job_card_id)
    if not plant_scope.get("scope_all"):
        selected = plant_scope.get("selected_plant_id")
        try:
            scope_uuid = uuid.UUID(str(selected)) if selected else None
        except (TypeError, ValueError):
            scope_uuid = None
        if scope_uuid is None:
            raise HTTPException(status_code=403, detail="Invalid plant scope for short-close")
        query = query.filter(JobCard.plant_id == scope_uuid)
    job = query.first()
    if not job:
        raise HTTPException(status_code=404, detail="Job card not found in this plant scope")

    planned = float(job.planned_qty or 0.0)
    produced = float(payload.produced_qty or 0.0)
    gap = round(planned - produced, 4)
    if gap <= 0:
        raise HTTPException(status_code=400, detail="No gap — produced_qty meets or exceeds planned_qty. Use the normal close.")
    if decision == "SHORT_CLOSE_SO" and not job.sales_order_line_id:
        raise HTTPException(status_code=422, detail="Job card has no linked sales order line to short-close")

    actor_id = current_user.get("sub") or current_user.get("actor_identity") or "unknown"
    actor_role = current_user.get("acting_role") or (current_user.get("roles") or ["?"])[0]

    short = JobCardShortClose(
        plant_id=job.plant_id,
        job_card_id=job.id,
        planned_qty=planned,
        produced_qty=produced,
        gap_qty=gap,
        reason_code=reason_code,
        decision=decision,
        notes=(payload.notes or None),
        actor_id=str(actor_id),
        actor_role=str(actor_role),
    )
    db.add(short)
    db.flush()

    if decision == "SHORT_CLOSE_SO":
        _sync_sales_short_close(
            token=str(current_user.get("token") or ""),
            plant_id=job.plant_id,
            sales_order_line_id=job.sales_order_line_id,
            job_card_id=job.id,
            produced_qty=produced,
            gap_qty=gap,
            reason_code=reason_code,
            notes=payload.notes,
        )

    # Carry-forward branch: spawn a top-up job card sharing the same release lot + spec.
    carry_id: Optional[uuid.UUID] = None
    if decision == "CARRY_FORWARD" and gap > 0:
        # A top-up job card runs the gap through the full route again — it
        # always starts at WINDER (or the first stage of the routing) so the
        # gap qty is fully re-produced. We deliberately don't carry forward
        # the assigned machine because capacity should be re-validated by
        # the planner on the new JC.
        carry = JobCard(
            plant_id=job.plant_id,
            sales_order_id=job.sales_order_id,
            sales_order_line_id=job.sales_order_line_id,
            release_lot_id=job.release_lot_id,
            spec_id=job.spec_id,
            spec_snapshot=dict(job.spec_snapshot or {}),
            routing_snapshot=dict(job.routing_snapshot or {}),
            material_plan_snapshot=dict(job.material_plan_snapshot or {}),
            released_qty=gap,
            planned_qty=gap,
            assigned_winder_machine_id=None,
            product_code=job.product_code,
            status="CREATED",
            current_stage="WINDER",
            requires_slitting=bool(job.requires_slitting),
        )
        db.add(carry)
        db.flush()
        short.carry_forward_job_card_id = carry.id
        carry_id = carry.id

    # Mark the originating job card complete with the short qty.
    if job.status != "COMPLETED":
        job.status = "COMPLETED"

    db.commit()
    db.refresh(short)

    try:
        record_audit_event(
            db=db,
            plant_id=str(job.plant_id),
            entity_type="job_card",
            entity_id=str(job.id),
            action=f"short_close_{decision.lower()}",
            actor_id=str(actor_id),
            actor_role=str(actor_role),
            payload={
                "reason_code": reason_code,
                "planned_qty": planned,
                "produced_qty": produced,
                "gap_qty": gap,
                "carry_forward_job_card_id": str(carry_id) if carry_id else None,
                "notes": payload.notes or None,
            },
        )
    except Exception:
        pass  # audit best-effort

    return ShortCloseResponse(
        id=short.id,
        job_card_id=short.job_card_id,
        planned_qty=short.planned_qty,
        produced_qty=short.produced_qty,
        gap_qty=short.gap_qty,
        reason_code=short.reason_code,
        decision=short.decision,
        carry_forward_job_card_id=short.carry_forward_job_card_id,
        notes=short.notes,
        created_at=short.created_at,
    )


@router.get("/short-close", response_model=List[ShortCloseResponse])
def list_short_closes(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    query = db.query(JobCardShortClose)
    query = _apply_plant_scope(query, JobCardShortClose.plant_id, plant_scope, action="short-close history")
    if start_date:
        try:
            sd = date.fromisoformat(start_date)
            query = query.filter(JobCardShortClose.created_at >= datetime.combine(sd, datetime.min.time()))
        except ValueError:
            pass
    if end_date:
        try:
            ed = date.fromisoformat(end_date)
            query = query.filter(JobCardShortClose.created_at < datetime.combine(ed + timedelta(days=1), datetime.min.time()))
        except ValueError:
            pass
    rows = query.order_by(JobCardShortClose.created_at.desc()).limit(200).all()
    return [
        ShortCloseResponse(
            id=r.id,
            job_card_id=r.job_card_id,
            planned_qty=r.planned_qty,
            produced_qty=r.produced_qty,
            gap_qty=r.gap_qty,
            reason_code=r.reason_code,
            decision=r.decision,
            carry_forward_job_card_id=r.carry_forward_job_card_id,
            notes=r.notes,
            created_at=r.created_at,
        )
        for r in rows
    ]


# ──────────────────────────────────────────────────────────────────────────
# Machine downtime
# ──────────────────────────────────────────────────────────────────────────


class DowntimeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    machine_id: uuid.UUID
    machine_code: Optional[str] = None
    started_at: datetime
    ended_at: Optional[datetime] = None
    reason_code: str
    notes: Optional[str] = None
    is_planned: bool = False
    affected_job_card_ids: Optional[List[uuid.UUID]] = None


class DowntimeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ended_at: Optional[datetime] = None
    reason_code: Optional[str] = None
    notes: Optional[str] = None
    is_planned: Optional[bool] = None


class DowntimeResponse(BaseModel):
    id: uuid.UUID
    machine_id: uuid.UUID
    machine_code: Optional[str]
    started_at: datetime
    ended_at: Optional[datetime]
    duration_minutes: Optional[float]
    reason_code: str
    notes: Optional[str]
    is_planned: bool
    affected_job_card_ids: List[str]
    actor_id: Optional[str]
    created_at: datetime


def _serialize_downtime(row: MachineDowntime) -> DowntimeResponse:
    affected: List[str] = []
    raw = row.affected_job_card_ids or []
    if isinstance(raw, list):
        affected = [str(x) for x in raw]
    return DowntimeResponse(
        id=row.id,
        machine_id=row.machine_id,
        machine_code=row.machine_code,
        started_at=row.started_at,
        ended_at=row.ended_at,
        duration_minutes=row.duration_minutes,
        reason_code=row.reason_code,
        notes=row.notes,
        is_planned=bool(row.is_planned),
        affected_job_card_ids=affected,
        actor_id=row.actor_id,
        created_at=row.created_at,
    )


@router.post("/downtime", response_model=DowntimeResponse)
def create_downtime(
    payload: DowntimeCreate,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["PlantManager", "Planner", "Admin", "Owner"])),
):
    reason = (payload.reason_code or "").strip().upper()
    if not reason:
        raise HTTPException(status_code=422, detail="reason_code is required")
    if payload.ended_at and payload.ended_at < payload.started_at:
        raise HTTPException(status_code=422, detail="ended_at cannot be before started_at")
    duration: Optional[float] = None
    if payload.ended_at:
        duration = round((payload.ended_at - payload.started_at).total_seconds() / 60.0, 2)
    actor_id = current_user.get("sub") or current_user.get("actor_identity") or "unknown"
    actor_role = current_user.get("acting_role") or (current_user.get("roles") or ["?"])[0]
    selected_plant = plant_scope.get("selected_plant_id")
    # Downtime is always plant-specific — `MachineDowntime.plant_id` is
    # nullable=False, so even owner-on-ALL must commit against a specific
    # plant. Owners get the first allowed plant by default; everyone else
    # must have a selected plant in scope.
    if not selected_plant:
        allowed = plant_scope.get("allowed_plants") or []
        if allowed:
            selected_plant = allowed[0]
    if not selected_plant:
        raise HTTPException(status_code=400, detail="A plant must be selected to log downtime")
    try:
        plant_uuid = uuid.UUID(str(selected_plant))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"Invalid plant id: {selected_plant}")

    row = MachineDowntime(
        plant_id=plant_uuid,
        machine_id=payload.machine_id,
        machine_code=(payload.machine_code or None),
        started_at=payload.started_at,
        ended_at=payload.ended_at,
        duration_minutes=duration,
        reason_code=reason,
        notes=(payload.notes or None),
        is_planned=bool(payload.is_planned),
        actor_id=str(actor_id),
        actor_role=str(actor_role),
        affected_job_card_ids=[str(j) for j in (payload.affected_job_card_ids or [])],
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    try:
        record_audit_event(
            db=db,
            plant_id=str(plant_uuid) if plant_uuid else None,
            entity_type="machine_downtime",
            entity_id=str(row.id),
            action="downtime_logged",
            actor_id=str(actor_id),
            actor_role=str(actor_role),
            payload={
                "machine_id": str(payload.machine_id),
                "reason_code": reason,
                "duration_minutes": duration,
                "is_planned": bool(payload.is_planned),
                "notes": payload.notes or None,
            },
        )
    except Exception:
        pass

    return _serialize_downtime(row)


@router.put("/downtime/{downtime_id}", response_model=DowntimeResponse)
def update_downtime(
    downtime_id: uuid.UUID,
    payload: DowntimeUpdate,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["PlantManager", "Planner", "Admin", "Owner"])),
):
    query = db.query(MachineDowntime).filter(MachineDowntime.id == downtime_id)
    query = _apply_plant_scope(query, MachineDowntime.plant_id, plant_scope, action="downtime update")
    row = query.first()
    if not row:
        raise HTTPException(status_code=404, detail="Downtime row not found")
    updates = payload.model_dump(exclude_unset=True)
    if "reason_code" in updates and updates["reason_code"] is not None:
        row.reason_code = str(updates["reason_code"]).strip().upper()
    if "notes" in updates:
        row.notes = updates["notes"]
    if "is_planned" in updates and updates["is_planned"] is not None:
        row.is_planned = bool(updates["is_planned"])
    if "ended_at" in updates and updates["ended_at"] is not None:
        row.ended_at = updates["ended_at"]
        if row.started_at and row.ended_at and row.ended_at >= row.started_at:
            row.duration_minutes = round((row.ended_at - row.started_at).total_seconds() / 60.0, 2)
    db.commit()
    db.refresh(row)
    return _serialize_downtime(row)


@router.get("/downtime", response_model=List[DowntimeResponse])
def list_downtime(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    machine_id: Optional[uuid.UUID] = Query(None),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    query = db.query(MachineDowntime)
    query = _apply_plant_scope(query, MachineDowntime.plant_id, plant_scope, action="downtime list")
    if start_date:
        try:
            sd = date.fromisoformat(start_date)
            query = query.filter(MachineDowntime.started_at >= datetime.combine(sd, datetime.min.time()))
        except ValueError:
            pass
    if end_date:
        try:
            ed = date.fromisoformat(end_date)
            query = query.filter(MachineDowntime.started_at < datetime.combine(ed + timedelta(days=1), datetime.min.time()))
        except ValueError:
            pass
    if machine_id:
        query = query.filter(MachineDowntime.machine_id == machine_id)
    rows = query.order_by(MachineDowntime.started_at.desc()).limit(500).all()
    return [_serialize_downtime(r) for r in rows]


# ──────────────────────────────────────────────────────────────────────────
# Data-entry lag rollup
# ──────────────────────────────────────────────────────────────────────────


class LagSummary(BaseModel):
    sample_size: int
    median_minutes: float
    p90_minutes: float
    late_count: int  # rows where lag > 6h
    threshold_minutes: float


class LagRow(BaseModel):
    job_card_id: uuid.UUID
    stage_type: str
    actual_end: Optional[datetime]
    entered_at: Optional[datetime]
    lag_minutes: float
    entered_by: Optional[str]
    shift_code: Optional[str]


class DataEntryLagResponse(BaseModel):
    summary: LagSummary
    laggard_rows: List[LagRow]


@router.get("/data-entry-lag", response_model=DataEntryLagResponse)
def data_entry_lag(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    threshold_hours: float = Query(6.0, ge=0.0, le=72.0),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    """Compute median + p90 lag between actual_end and entered_at.

    Only counts stages where both timestamps exist and entered_at >= actual_end
    (stages still in progress without an actual_end are excluded).
    """
    query = db.query(JobCardStage).join(JobCard, JobCardStage.job_card_id == JobCard.id).filter(
        JobCardStage.actual_end.isnot(None),
        JobCardStage.entered_at.isnot(None),
    )
    query = _apply_plant_scope(query, JobCard.plant_id, plant_scope, action="data-entry lag")
    if start_date:
        try:
            sd = date.fromisoformat(start_date)
            query = query.filter(JobCardStage.actual_end >= datetime.combine(sd, datetime.min.time()))
        except ValueError:
            pass
    if end_date:
        try:
            ed = date.fromisoformat(end_date)
            query = query.filter(JobCardStage.actual_end < datetime.combine(ed + timedelta(days=1), datetime.min.time()))
        except ValueError:
            pass

    rows = query.order_by(JobCardStage.actual_end.desc()).limit(1000).all()

    lags: List[tuple[JobCardStage, float]] = []
    for r in rows:
        if not r.actual_end or not r.entered_at:
            continue
        delta = (r.entered_at - r.actual_end).total_seconds() / 60.0
        if delta < 0:
            continue
        lags.append((r, delta))

    threshold_minutes = float(threshold_hours) * 60.0
    if not lags:
        return DataEntryLagResponse(
            summary=LagSummary(
                sample_size=0, median_minutes=0.0, p90_minutes=0.0,
                late_count=0, threshold_minutes=threshold_minutes,
            ),
            laggard_rows=[],
        )

    minutes = sorted([m for _, m in lags])
    p50 = float(median(minutes))
    p90_idx = max(0, int(len(minutes) * 0.9) - 1)
    p90 = float(minutes[p90_idx])
    late_count = sum(1 for m in minutes if m > threshold_minutes)

    # Worst 20 rows for the surface table
    lags_sorted = sorted(lags, key=lambda x: x[1], reverse=True)[:20]
    laggard_rows = [
        LagRow(
            job_card_id=r.job_card_id,
            stage_type=r.stage_type or "",
            actual_end=r.actual_end,
            entered_at=r.entered_at,
            lag_minutes=round(m, 1),
            entered_by=r.entered_by,
            shift_code=r.shift_code,
        )
        for r, m in lags_sorted
    ]

    return DataEntryLagResponse(
        summary=LagSummary(
            sample_size=len(lags),
            median_minutes=round(p50, 1),
            p90_minutes=round(p90, 1),
            late_count=late_count,
            threshold_minutes=threshold_minutes,
        ),
        laggard_rows=laggard_rows,
    )
