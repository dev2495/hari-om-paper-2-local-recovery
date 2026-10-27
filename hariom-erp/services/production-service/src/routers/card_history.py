"""One history per job card and per sales order, and the QC flag register (client 2026-10-27).

The card's story was spread over the audit trail, run revisions, QC inspections, holds and dispatch.
Here it is one time-ordered list of plain events (who, when, what, before → after), so the job card
page, the order page and audits read the same thing. QC readings outside their band are flagged, not
held; the flag register lists every flagged reading stage by stage.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..entry_models import StageEntry
from ..lifecycle_rules import stage_unit
from ..models import AuditEvent, Dispatch, JobCard, QualityHold, QualityInspection
from ..utils.auth import get_current_plant_scope, require_role
from . import planning
from .entries import qc_flags

router = APIRouter(tags=["history"])
READ_ROLES = ["Owner", "Admin", "PlantManager", "Planner", "Production", "QC", "InProcessQC", "Operator", "Sales", "Dispatch", "Store"]
STAGE_LABEL = {"SLITTING": "Slitting", "WINDER": "Winding", "OVEN": "Oven", "PROCESS": "Process", "PACKING": "Packing", "QC": "Final QC", "DISPATCH": "Dispatch"}
DEFAULT_QC_REASONS = {"", "QC readings recorded", "More QC readings added"}


def _stage(value: Any) -> Optional[str]:
    text = str(value or "").upper()
    return text if text in STAGE_LABEL else None


def _entry_from(payload: dict[str, Any]) -> dict[str, Any]:
    result = payload.get("result") if isinstance(payload.get("result"), dict) else {}
    entry = result.get("entry") if isinstance(result.get("entry"), dict) else {}
    return entry


def _at(value: Optional[datetime]) -> Optional[str]:
    """Stored times are UTC without a zone; say so, so every screen shows plant time."""
    if value is None:
        return None
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()


def _run_text(entry: dict[str, Any]) -> str:
    stage = STAGE_LABEL.get(str(entry.get("stage") or ""), str(entry.get("stage") or "").title())
    unit = stage_unit(str(entry.get("stage") or ""))
    made, good = entry.get("produced") or 0, entry.get("accepted") or 0
    bits = [f"{stage} run #{entry.get('entry_no')}" if entry.get("entry_no") else stage]
    if entry.get("kind") == "QC_ONLY":
        return f"{stage}: QC without a run"
    bits.append(f"{made:,} {unit} made, {good:,} good")
    if entry.get("shift_code"):
        bits.append(str(entry["shift_code"]).replace("SHIFT_", "Shift "))
    if entry.get("business_date"):
        bits.append(str(entry["business_date"]))
    return " · ".join(bits)


def _audit_event(event: AuditEvent, card_no: Optional[str]) -> Optional[dict[str, Any]]:
    """Plain words for one audit row; None for technical rows nobody needs to read."""
    payload = event.payload or {}
    action = str(event.action or "")
    head, _, tail = action.partition(":")
    reason = str(payload.get("reason") or "").strip()
    entry = _entry_from(payload)
    kind, title, detail, stage = "OTHER", action.replace("_", " ").capitalize(), reason or None, _stage(entry.get("stage"))
    before, after = payload.get("before"), payload.get("after")
    if head == "entry_create" or head == "entries_batch":
        if entry.get("kind") == "QC_ONLY":
            kind, title = "QC", f"{STAGE_LABEL.get(entry.get('stage'), 'Stage')}: QC logged without a run"
        else:
            kind = "RUN"
            title = ("Run logged" if entry.get("status") == "SUBMITTED" else "Run saved as draft for the supervisor") if head == "entry_create" else "Runs logged together"
            detail = _run_text(entry) + (f" · {reason}" if reason else "") if entry else detail
    elif head == "submit":
        kind, title, detail = "RUN", "Run submitted by the supervisor", _run_text(entry) if entry else detail
    elif head == "edit":
        kind, title, detail = "RUN_EDIT", "Run changed", (f"{_run_text(entry)} · reason: {reason}" if entry else reason) or None
    elif head == "void":
        kind, title, detail = "RUN_VOID", "Run voided", (f"{_run_text(entry)} · reason: {reason}" if entry else reason) or None
    elif head == "observations":
        if reason in DEFAULT_QC_REASONS:
            return None  # the QC result row below says the same, with the verdict
        kind, title, detail = "QC", "QC readings corrected", f"{_run_text(entry)} · reason: {reason}" if entry else reason
    elif head in {"close", "reopen"}:
        stage = _stage(tail)
        kind = "STAGE_CLOSE" if head == "close" else "STAGE_REOPEN"
        short = bool((payload.get("result") or {}).get("short_close")) if isinstance(payload.get("result"), dict) else False
        title = f"{STAGE_LABEL.get(stage or '', 'Stage')} {'closed' if head == 'close' else 'reopened'}" + (" short" if short else "")
    elif action in {"release_sync_create", "released", "created"}:
        kind, title = "RELEASE", "Released from the sales order"
        detail = f"{payload.get('released_qty') or payload.get('qty') or ''} pcs".strip() if (payload.get("released_qty") or payload.get("qty")) else None
    elif action == "job_card_split":
        kind, title = "SPLIT", f"Split into a new card {payload.get('child_job_card_no') or ''}".strip()
        detail = f"{payload.get('qty')} pcs moved" + (f" · {payload.get('reason')}" if payload.get("reason") else "")
    elif action == "job_card_created_by_split":
        kind, title = "SPLIT", f"Created by splitting {payload.get('parent_job_card_no') or 'the parent card'}"
        detail = f"{payload.get('qty')} pcs" + (f" · {payload.get('reason')}" if payload.get("reason") else "")
    elif action == "job_card_amended":
        kind, title = "EDIT", "Quantity / colour changed"
    elif action == "job_card_force_closed":
        cancelled = str(payload.get("mode") or "").upper() == "CANCELLED"
        kind, title = "FORCE_CLOSE", "Cancelled: nothing was made" if cancelled else "Force closed"
        detail = " · ".join(bit for bit in (
            None if cancelled else (f"{payload.get('made_qty'):,.0f} pcs made" if payload.get("made_qty") is not None else None),
            f"{payload.get('returned_qty'):,.0f} pcs back to the order" if payload.get("returned_qty") else None, reason or None) if bit) or None
    elif action == "job_card_emergency_insert":
        kind, title = "PLAN", "Emergency insert"
        detail = " · ".join(str(x) for x in (payload.get("plan_date"), str(payload.get("shift_code") or "").replace("SHIFT_", "Shift "), payload.get("reason")) if x)
    elif action in {"planned", "plan_split"}:
        kind, stage = "PLAN", _stage(payload.get("stage"))
        title = f"{STAGE_LABEL.get(stage or '', 'Stage')} {'planned' if action == 'planned' else 'plan split'}"
        detail = payload.get("summary") or None
        after = payload.get("after")
    elif action == "winder_override":
        kind, title, detail = "PLAN", "Planned on another winder than the release winder", payload.get("note")
    elif action == "missed_slot_requeued":
        kind, stage, title = "PLAN", _stage(payload.get("stage")), "Slot passed with nothing logged: back to the planner queue"
        detail = f"{payload.get('plan_date')} · {str(payload.get('shift_code') or '').replace('SHIFT_', 'Shift ')}"
    elif action == "missed_slot_late_entry":
        kind, stage, title = "PLAN", _stage(payload.get("stage")), "Late entry: card back on the slot it ran in"
    elif action == "switched_to_batch_entry":
        kind, title = "OTHER", "Moved to batch entry"
    elif head in {"effect_retry", "residual_resolve", "attach_qc_profile", "provisional_theory_posted", "release_sync_replay_noop"}:
        return None
    elif action in {"stage_batch_completed", "completed", "running_entry", "draft_saved"}:
        kind, title = "RUN", {"stage_batch_completed": "Stages saved on the card form", "completed": "Stage saved on the card form", "running_entry": "Running entry on the card form", "draft_saved": "Card form draft saved"}[action]
        stage = _stage(payload.get("stage") or payload.get("selected_stage")) or stage
    elif action == "hold":
        kind, title = "HOLD", "Put on hold"
    return {
        "id": f"a:{event.id}", "at": _at(event.event_ts), "actor": event.actor_id, "role": event.actor_role,
        "kind": kind, "title": title, "detail": detail, "stage": stage, "stage_label": STAGE_LABEL.get(stage or "", None),
        "job_card_id": str(event.job_card_id) if event.job_card_id else None, "job_card_no": card_no, "flag": False,
        "before": before if isinstance(before, dict) else None, "after": after if isinstance(after, dict) else None,
    }


def card_events(db: Session, jobs: list[JobCard]) -> list[dict[str, Any]]:
    by_id = {job.id: job for job in jobs}
    ids = list(by_id)
    if not ids:
        return []
    events: list[dict[str, Any]] = []
    for event in db.query(AuditEvent).filter(AuditEvent.job_card_id.in_(ids)).order_by(AuditEvent.event_ts).all():
        row = _audit_event(event, by_id[event.job_card_id].job_card_no if event.job_card_id in by_id else None)
        if row:
            events.append(row)
    entries = {str(e.id): e for e in db.query(StageEntry).filter(StageEntry.job_card_id.in_(ids)).all()}
    for inspection in db.query(QualityInspection).filter(QualityInspection.job_card_id.in_(ids), QualityInspection.entry_mode == "CONTINUOUS").order_by(QualityInspection.created_at).all():
        job = by_id.get(inspection.job_card_id)
        entry = entries.get(str((inspection.evaluation or {}).get("entry_id") or inspection.sample_id or ""))
        flags = qc_flags(job, entry) if job is not None and entry is not None and str(inspection.status) == "FAIL" else []
        samples = len((inspection.readings or {}).get("samples") or [])
        label = STAGE_LABEL.get(inspection.stage_type, inspection.stage_type)
        run = f"run #{entry.entry_no}" if entry is not None and entry.kind != "QC_ONLY" else "no run"
        if flags:
            title = f"{label} QC: {len(flags)} reading{'s' if len(flags) != 1 else ''} outside the band (flagged)"
            detail = f"{run} · " + "; ".join(f"{f['label']} {f['value']} (band {f['min']}–{f['max']})" for f in flags[:4]) + (" …" if len(flags) > 4 else "")
        else:
            title = f"{label} QC: all readings in band"
            detail = f"{run} · {samples} sample{'s' if samples != 1 else ''}"
        events.append({"id": f"q:{inspection.id}", "at": _at(inspection.created_at), "actor": inspection.created_by, "role": None,
                       "kind": "QC_FLAG" if flags else "QC", "title": title, "detail": detail, "stage": inspection.stage_type, "stage_label": label,
                       "job_card_id": str(inspection.job_card_id), "job_card_no": job.job_card_no if job else None, "flag": bool(flags), "before": None, "after": None})
    for hold in db.query(QualityHold).filter(QualityHold.job_card_id.in_(ids)).all():
        job = by_id.get(hold.job_card_id)
        label = STAGE_LABEL.get(hold.stage_type, hold.stage_type)
        events.append({"id": f"h:{hold.id}", "at": _at(hold.created_at), "actor": hold.created_by, "role": None, "kind": "HOLD",
                       "title": f"{label}: put on hold", "detail": hold.reason, "stage": hold.stage_type, "stage_label": label, "job_card_id": str(hold.job_card_id),
                       "job_card_no": job.job_card_no if job else None, "flag": False, "before": None, "after": None})
        if hold.released_at:
            events.append({"id": f"hr:{hold.id}", "at": _at(hold.released_at), "actor": hold.released_by, "role": None, "kind": "HOLD",
                           "title": f"{label}: hold released", "detail": None, "stage": hold.stage_type, "stage_label": label, "job_card_id": str(hold.job_card_id),
                           "job_card_no": job.job_card_no if job else None, "flag": False, "before": None, "after": None})
    for dispatch in db.query(Dispatch).filter(Dispatch.job_card_id.in_(ids)).all():
        snap = dispatch.dispatch_snapshot or {}
        job = by_id.get(dispatch.job_card_id)
        qty = snap.get("dispatch_qty") or snap.get("qty")
        events.append({"id": f"d:{dispatch.id}", "at": _at(dispatch.created_at), "actor": snap.get("created_by") or snap.get("dispatched_by"), "role": None,
                       "kind": "DISPATCH", "title": f"Dispatched {qty:,.0f} pcs" if isinstance(qty, (int, float)) else "Dispatched",
                       "detail": " · ".join(str(x) for x in (snap.get("challan_no") or snap.get("dispatch_ref"), snap.get("date")) if x) or None,
                       "stage": "DISPATCH", "stage_label": "Dispatch", "job_card_id": str(dispatch.job_card_id), "job_card_no": job.job_card_no if job else None,
                       "flag": False, "before": None, "after": None})
    events.sort(key=lambda row: (row["at"] or "", row["id"]), reverse=True)
    return events


def _summary(events: list[dict[str, Any]]) -> dict[str, Any]:
    kinds = Counter(row["kind"] for row in events)
    return {"events": len(events), "by_kind": dict(kinds), "flags": sum(1 for row in events if row["flag"])}


@router.get("/job-cards/{job_card_id}/history")
def job_card_history(job_card_id: uuid.UUID, db: Session = Depends(get_db), plant_scope: dict = Depends(get_current_plant_scope), user: dict = Depends(require_role(READ_ROLES))):
    """Everything that happened to one card, newest first: release, plan, runs, QC (with flags), holds, closes, splits, edits, dispatch."""
    job = planning._apply_plant_scope_filter(db.query(JobCard).filter(JobCard.id == job_card_id), JobCard.plant_id, plant_scope).first()
    if job is None:
        raise HTTPException(status_code=404, detail="Job card not found")
    family = [job]
    events = card_events(db, family)
    return {"job_card_id": str(job.id), "job_card_no": job.job_card_no, "events": events, "summary": _summary(events)}


@router.get("/sales-orders/{sales_order_id}/card-history")
def sales_order_card_history(sales_order_id: uuid.UUID, db: Session = Depends(get_db), plant_scope: dict = Depends(get_current_plant_scope), user: dict = Depends(require_role(READ_ROLES))):
    """The production side of an order's history: every event of every card released from it."""
    jobs = planning._apply_plant_scope_filter(db.query(JobCard).filter(JobCard.sales_order_id == sales_order_id), JobCard.plant_id, plant_scope).all()
    events = card_events(db, jobs)
    return {"sales_order_id": str(sales_order_id), "job_cards": [{"id": str(j.id), "job_card_no": j.job_card_no, "status": str(j.status)} for j in jobs], "events": events, "summary": _summary(events)}


@router.get("/quality/flags")
def qc_flag_register(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    stage: Optional[str] = Query(None),
    job_card_id: Optional[uuid.UUID] = Query(None),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    user: dict = Depends(require_role(READ_ROLES)),
):
    """Every QC reading outside its band, stage by stage (flagged, never held)."""
    today = planning._plant_today()
    end = date_to or today
    start = date_from or (end - timedelta(days=30))
    if end < start:
        raise HTTPException(status_code=400, detail="The end date is before the start date")
    query = (
        db.query(StageEntry, JobCard).join(JobCard, JobCard.id == StageEntry.job_card_id)
        .filter(StageEntry.status.in_(["SUBMITTED", "DRAFT"]), StageEntry.evaluation["verdict"].astext == "FAIL")
    )
    if job_card_id:
        query = query.filter(StageEntry.job_card_id == job_card_id)
    else:
        query = query.filter(StageEntry.business_date >= start, StageEntry.business_date <= end)
    if stage:
        query = query.filter(StageEntry.stage == stage.upper())
    query = planning._apply_plant_scope_filter(query, JobCard.plant_id, plant_scope)
    rows: list[dict[str, Any]] = []
    for entry, job in query.order_by(StageEntry.business_date.desc(), StageEntry.created_at.desc()).limit(2000).all():
        snap = job.spec_snapshot or {}
        for flag in qc_flags(job, entry):
            rows.append({
                "entry_id": str(entry.id), "entry_no": entry.entry_no, "run": "QC without a run" if entry.kind == "QC_ONLY" else f"Run #{entry.entry_no}",
                "status": entry.status, "job_card_id": str(job.id), "job_card_no": job.job_card_no, "customer": snap.get("customer_name_snapshot") or snap.get("customer_name"),
                "sales_order_no": snap.get("sales_order_order_no"), "stage": entry.stage, "stage_label": STAGE_LABEL.get(entry.stage, entry.stage),
                "business_date": entry.business_date.isoformat() if entry.business_date else None, "shift_code": entry.shift_code,
                "machine_id": str(entry.machine_id) if entry.machine_id else None, "operator": entry.operator_name,
                "logged_by": (entry.details or {}).get("qc_name") or entry.created_by, "logged_at": _at(entry.created_at),
                **flag,
            })
    by_stage: dict[str, Counter] = defaultdict(Counter)
    for row in rows:
        by_stage[row["stage"]]["readings"] += 1
        by_stage[row["stage"]][row["label"]] += 1
    stages = []
    for name in ("WINDER", "OVEN", "PROCESS"):
        counts = by_stage.get(name, Counter())
        params = sorted(((label, n) for label, n in counts.items() if label != "readings"), key=lambda item: -item[1])
        stages.append({"stage": name, "label": STAGE_LABEL[name], "readings": counts.get("readings", 0),
                       "runs": len({row["entry_id"] for row in rows if row["stage"] == name}),
                       "cards": len({row["job_card_id"] for row in rows if row["stage"] == name}),
                       "parameters": [{"label": label, "readings": n} for label, n in params]})
    return {"date_from": start.isoformat(), "date_to": end.isoformat(), "rows": rows, "by_stage": stages,
            "summary": {"readings": len(rows), "runs": len({row["entry_id"] for row in rows}), "cards": len({row["job_card_id"] for row in rows})}}
