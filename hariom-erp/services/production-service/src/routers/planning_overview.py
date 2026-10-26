"""Planning overview, planning report, saved planner views, multi-card board moves and a card's plan
(client 2026-10-26).

Planning is only the plan; the job card log is the truth. Every planned slot (machine, date, shift,
quantity) in a period is set against the floor runs logged for that card and stage, matched by date
and shift (src/plan_match.py). Nothing here blocks the floor.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..entry_models import StageEntry
from ..lifecycle_rules import MISSED_SLOT_HOURS, canonical_shift, missed_slot_deadline, planned_in_stage_units, stage_unit
from ..models import AuditEvent, JobCard, JobCardStage, JobCardStageSegment, PlannerView, SalesOrder
from ..plan_match import MATCH_LABEL, RESULT_LABEL, Run, Slot, adherence, match_runs, slot_result, slot_window
from ..schemas.planning import BoardMovePayload, ReorderQueuePayload
from ..utils.auth import get_current_plant, get_current_plant_scope, require_role
from . import planning

router = APIRouter(tags=["planning-overview"])
PLAN_STAGES = ("SLITTING", "WINDER", "OVEN", "PROCESS")
PLANNED_STATUSES = ("ASSIGNED", "RUNNING", "COMPLETED")
PLAN_ROLES = ["Owner", "Admin", "PlantManager", "Planner"]
REPORT_ROLES = ["Owner", "Admin", "PlantManager", "Planner", "Production", "QC"]
STAGE_LABEL = planning.PLAN_STAGE_LABEL
MAX_RANGE_DAYS = 62


def _now_local() -> datetime:
    return datetime.now(planning.PLANT_TIMEZONE).replace(tzinfo=None)


def _ist_day(moment: Optional[datetime]) -> Optional[date]:
    return (moment + timedelta(hours=5, minutes=30)).date() if moment else None


def _stages_param(value: Optional[str]) -> list[str]:
    if not value:
        return list(PLAN_STAGES)
    wanted = [part.strip().upper() for part in value.split(",") if part.strip()]
    stages = [stage for stage in PLAN_STAGES if stage in wanted]
    if not stages:
        raise HTTPException(status_code=400, detail="Choose at least one of Slitting, Winding, Oven or Process")
    return stages


def _range(date_from: Optional[date], date_to: Optional[date], default_back: int, default_ahead: int) -> tuple[date, date]:
    today = planning._plant_today()
    start = date_from or (today - timedelta(days=default_back))
    end = date_to or (today + timedelta(days=default_ahead))
    if end < start:
        raise HTTPException(status_code=400, detail="The end date is before the start date")
    if (end - start).days + 1 > MAX_RANGE_DAYS:
        raise HTTPException(status_code=400, detail=f"Choose at most {MAX_RANGE_DAYS} days")
    return start, end


def _is_v2(job: JobCard) -> bool:
    return (job.spec_snapshot or {}).get("entry_model") == "V2"


def _plan_and_runs(db: Session, plant_scope: dict, stages: list[str], start: date, end: date) -> dict[str, Any]:
    """Every planned slot touching the period, all slots and runs of those cards, and runs in the period."""
    in_range = (
        db.query(JobCardStageSegment.job_card_id)
        .join(JobCard, JobCard.id == JobCardStageSegment.job_card_id)
        .filter(
            JobCardStageSegment.stage_type.in_(stages),
            JobCardStageSegment.status.in_(PLANNED_STATUSES),
            JobCardStageSegment.machine_id.isnot(None),
            JobCardStageSegment.shift_code.isnot(None),
            JobCardStageSegment.plan_date >= start,
            JobCardStageSegment.plan_date <= end,
            JobCard.status != "CANCELLED",
        )
    )
    card_ids = {row[0] for row in planning._apply_plant_scope_filter(in_range, JobCard.plant_id, plant_scope).distinct().all()}

    run_cards = db.query(StageEntry.job_card_id).join(JobCard, JobCard.id == StageEntry.job_card_id).filter(
        StageEntry.status == "SUBMITTED", StageEntry.kind == "PRODUCTION", StageEntry.stage.in_(stages),
        StageEntry.business_date >= start, StageEntry.business_date <= end,
    )
    card_ids |= {row[0] for row in planning._apply_plant_scope_filter(run_cards, JobCard.plant_id, plant_scope).distinct().all()}

    # Old-form stages saved in the period (times are UTC; one day of margin either side for the IST date).
    window_start, window_end = datetime.combine(start - timedelta(days=1), datetime.min.time()), datetime.combine(end + timedelta(days=1), datetime.max.time())
    v1_cards = db.query(JobCardStage.job_card_id).join(JobCard, JobCard.id == JobCardStage.job_card_id).filter(
        JobCardStage.stage_type.in_(stages), JobCardStage.status.in_(["COMPLETED", "RUNNING"]),
        or_(JobCardStage.actual_end.between(window_start, window_end), JobCardStage.actual_start.between(window_start, window_end)),
    )
    for job_card_id, in planning._apply_plant_scope_filter(v1_cards, JobCard.plant_id, plant_scope).distinct().all():
        card_ids.add(job_card_id)

    if not card_ids:
        return {"jobs": {}, "stage_rows": {}, "segments": [], "entries": [], "sales": {}}
    ids = list(card_ids)
    jobs = {job.id: job for job in db.query(JobCard).filter(JobCard.id.in_(ids)).all()}
    stage_rows = {(row.job_card_id, row.stage_type): row for row in db.query(JobCardStage).filter(JobCardStage.job_card_id.in_(ids)).all()}
    segments = db.query(JobCardStageSegment).filter(
        JobCardStageSegment.job_card_id.in_(ids), JobCardStageSegment.stage_type.in_(stages), JobCardStageSegment.status != "CANCELLED"
    ).all()
    entries = db.query(StageEntry).filter(
        StageEntry.job_card_id.in_(ids), StageEntry.status == "SUBMITTED", StageEntry.kind == "PRODUCTION", StageEntry.stage.in_(stages)
    ).all()
    sales_ids = {job.sales_order_id for job in jobs.values() if job.sales_order_id}
    sales = {row.id: row for row in db.query(SalesOrder).filter(SalesOrder.id.in_(list(sales_ids))).all()} if sales_ids else {}
    return {"jobs": jobs, "stage_rows": stage_rows, "segments": segments, "entries": entries, "sales": sales}


def _pcs_per_bamboo(job: JobCard) -> Optional[int]:
    return planning._pcs_per_bamboo_from_snapshot(job.spec_snapshot or {})


def _build(db: Session, plant_scope: dict, stages: list[str], start: date, end: date, token: str, plant_id: Optional[str]) -> dict[str, Any]:
    now = _now_local()
    data = _plan_and_runs(db, plant_scope, stages, start, end)
    jobs, stage_rows = data["jobs"], data["stage_rows"]

    # Slots placed by a run logged before planning are the floor's record, not the planner's plan.
    floor_placed: set[uuid.UUID] = set()
    placed_by_run: dict[str, str] = {}
    # A run on another machine moves the slot to that machine; the planned one is kept on the run.
    planned_machine: dict[str, str] = {}
    runs: list[Run] = []
    run_meta: dict[str, dict[str, Any]] = {}
    for entry in data["entries"]:
        job = jobs.get(entry.job_card_id)
        if job is None:
            continue
        details = entry.details or {}
        unscheduled = bool(details.get("unscheduled_entry"))
        key = f"e:{entry.id}"
        changed = (details.get("machine_changed") or {}).get("from")
        if changed and entry.segment_id:
            planned_machine.setdefault(str(entry.segment_id), str(changed))
        if unscheduled and entry.segment_id:
            floor_placed.add(entry.segment_id)
            placed_by_run[key] = str(entry.segment_id)
        runs.append(Run(key=key, card=str(job.id), stage=entry.stage, day=entry.business_date, shift=canonical_shift_safe(entry.shift_code),
                        machine=str(entry.machine_id) if entry.machine_id else None, made=float(entry.produced or 0), good=float(entry.accepted or 0),
                        unscheduled=unscheduled))
        run_meta[key] = {"run": f"Run #{entry.entry_no}", "operator": entry.operator_name, "start": details.get("start_time"), "end": details.get("end_time")}
    for (job_card_id, stage_type), row in stage_rows.items():
        job = jobs.get(job_card_id)
        if job is None or _is_v2(job) or stage_type not in stages or row.status not in ("COMPLETED", "RUNNING"):
            continue
        moment = row.actual_end or row.actual_start
        day = _ist_day(moment)
        if not day:
            continue
        actuals, snapshot = row.actuals_snapshot or {}, row.entry_snapshot or {}
        made = float((row.output_qty or 0) + (row.scrap_qty or 0))
        if stage_type == "SLITTING" and row.status == "COMPLETED" and made <= 0:
            made = planned_in_stage_units(stage_type, float(job.planned_qty or 0), _pcs_per_bamboo(job))
        key = f"c:{row.id}"
        if actuals.get("unscheduled_entry"):
            placed = [seg.id for seg in data["segments"] if seg.job_card_id == job_card_id and seg.stage_type == stage_type]
            floor_placed.update(placed)
            if placed:
                placed_by_run[key] = str(placed[0])
        runs.append(Run(key=key, card=str(job.id), stage=stage_type, day=day, shift=canonical_shift_safe(snapshot.get("shift_code") or row.shift_code),
                        machine=str(row.machine_id) if row.machine_id else None, made=made, good=float(row.output_qty or made),
                        unscheduled=bool(actuals.get("unscheduled_entry"))))
        run_meta[key] = {"run": "Card form", "operator": snapshot.get("operator_name"), "start": snapshot.get("start_time"), "end": snapshot.get("end_time")}

    slots: list[Slot] = []
    slot_meta: dict[str, tuple[JobCardStageSegment, JobCard]] = {}
    for segment in data["segments"]:
        job = jobs.get(segment.job_card_id)
        if job is None or segment.status not in PLANNED_STATUSES or not (segment.machine_id and segment.plan_date and segment.shift_code):
            continue
        planned = planned_in_stage_units(segment.stage_type, float(segment.planned_qty or 0), _pcs_per_bamboo(job))
        slot = Slot(key=str(segment.id), card=str(job.id), stage=segment.stage_type, day=segment.plan_date, shift=canonical_shift_safe(segment.shift_code),
                    machine=planned_machine.get(str(segment.id), str(segment.machine_id)), planned=planned, status=segment.status)
        slots.append(slot)
        slot_meta[slot.key] = (segment, job)
    matches = match_runs(slots, runs)
    # A run logged before planning made its own slot: its pieces belong to that slot (still flagged as unplanned).
    by_key = {slot.key: slot for slot in slots}
    for match in matches:
        target = by_key.get(placed_by_run.get(match.run.key, ""))
        if match.kind == "UNPLANNED" and target is not None:
            target.made += match.run.made
            target.good += match.run.good
            target.runs += 1

    parts: Counter = Counter((s.card, s.stage) for s in slots)
    part_no: dict[str, int] = {}
    for (card, stage), _ in parts.items():
        ordered = sorted((s for s in slots if s.card == card and s.stage == stage), key=lambda s: (s.day, s.shift or "", s.key))
        for index, s in enumerate(ordered, start=1):
            part_no[s.key] = index
    has_entry = {(r.card, r.stage) for r in runs}
    customer_codes = planning._customer_codes(token, plant_id) if token else {}
    locks: dict[str, dict[uuid.UUID, str]] = {}

    slot_rows: list[dict[str, Any]] = []
    for slot in slots:
        segment, job = slot_meta[slot.key]
        if not (start <= slot.day <= end):
            continue
        result = slot_result(slot, now)
        placed = segment.id in floor_placed
        window_start, window_end = slot_window(slot.day, slot.shift)
        deadline = missed_slot_deadline(slot.day, slot.shift)
        silent = segment.status == "ASSIGNED" and (job.id and (str(job.id), slot.stage) not in has_entry) and now >= window_end
        snapshot = job.spec_snapshot or {}
        sales = data["sales"].get(job.sales_order_id) if job.sales_order_id else None
        previous_slot = None
        gates = planning.PLAN_GATED_STAGES.get(slot.stage, ())
        for gate in gates:
            earlier = [s for s in slots if s.card == slot.card and s.stage == gate and uuid.UUID(s.key) not in floor_placed]
            if earlier:
                previous_slot = min(earlier, key=lambda s: (s.day, s.shift or ""))
                break
        order_conflict = bool(not placed and previous_slot and (previous_slot.day, previous_slot.shift or "") > (slot.day, slot.shift or ""))
        slot_rows.append({
            "id": slot.key, "job_card_id": str(job.id), "job_card_no": job.job_card_no, "split_kind": job.split_kind,
            "parent_job_card_id": str(job.parent_job_card_id) if job.parent_job_card_id else None,
            "customer_id": str(snapshot.get("customer_id") or "") or None, "customer_name": snapshot.get("customer_name_snapshot") or snapshot.get("customer_name"),
            "customer_code": customer_codes.get(str(snapshot.get("customer_id") or "")),
            "sales_order_no": snapshot.get("sales_order_order_no"), "po_number": snapshot.get("sales_order_po_number"),
            "product_size_label": planning._size_label(snapshot), "parchment_color": getattr(job, "parchment_color", None) or snapshot.get("parchment_color"),
            "is_emergency": bool(job.is_emergency), "due_date": _due_date(job, sales),
            "stage": slot.stage, "machine_id": slot.machine, "plan_date": slot.day.isoformat(), "shift_code": slot.shift,
            "window_start": window_start.isoformat(), "window_end": window_end.isoformat(),
            "part_no": part_no.get(slot.key, 1), "parts": parts[(slot.card, slot.stage)],
            "planned_qty": round(slot.planned, 2), "planned_pcs": round(float(segment.planned_qty or 0), 2), "unit": stage_unit(slot.stage),
            "required_capacity": round(float(segment.required_capacity or 0), 2),
            "segment_status": segment.status, "card_status": str(job.status), "current_stage": job.current_stage,
            "result": "FLOOR_PLACED" if placed else result, "result_label": "Logged before planning" if placed else RESULT_LABEL[result],
            "placed_by_floor": placed,
            "made_in_slot": round(slot.made, 2), "good_in_slot": round(slot.good, 2), "made_elsewhere": round(slot.made_elsewhere, 2), "runs_in_slot": slot.runs,
            "requeue_at": deadline.isoformat() if silent else None,
            "hours_to_requeue": round((deadline - now).total_seconds() / 3600, 1) if silent else None,
            "previous_stage": gates[0] if gates else None, "order_conflict": order_conflict,
        })
    slot_rows.sort(key=lambda row: (row["plan_date"], row["shift_code"] or "", row["stage"], row["machine_id"] or "", row["job_card_no"] or ""))

    run_rows: list[dict[str, Any]] = []
    for match in matches:
        run = match.run
        if not (start <= run.day <= end):
            continue
        job = jobs.get(uuid.UUID(run.card))
        run_rows.append({
            "key": run.key, "job_card_id": run.card, "job_card_no": job.job_card_no if job else None, "stage": run.stage,
            "date": run.day.isoformat(), "shift_code": run.shift, "machine_id": run.machine, "made": run.made, "good": run.good, "unit": stage_unit(run.stage),
            "slot_id": match.slot.key if match.slot else None, "match": match.kind, "match_label": MATCH_LABEL[match.kind], "days_off": match.days_off,
            **run_meta.get(run.key, {}),
        })
    run_rows.sort(key=lambda row: (row["date"], row["shift_code"] or "", row["stage"]))
    return {"now": now, "slots": slot_rows, "runs": run_rows, "jobs": jobs, "stage_rows": stage_rows}


def canonical_shift_safe(value: Any) -> Optional[str]:
    try:
        return canonical_shift(value)
    except ValueError:
        return str(value or "").upper() or None


def _due_date(job: JobCard, sales: Optional[SalesOrder]) -> Optional[str]:
    snapshot = job.spec_snapshot or {}
    raw = snapshot.get("sales_order_line_due_date") or (sales.due_date.isoformat() if sales and sales.due_date else None)
    return str(raw)[:10] if raw else None


def _machines(stages: list[str], token: str, plant_id: Optional[str], db: Session, on_day: date) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not plant_id:
        return rows
    for stage in stages:
        try:
            machines = planning._fetch_stage_machines(stage, token, plant_id)
        except Exception:
            machines = []
        for machine in sorted(machines, key=lambda row: (str(row.get("code") or ""), str(row.get("name") or ""))):
            if machine.get("is_active") is False:
                continue
            capacity, unit = planning._oven_bamboo_capacity_profile(stage, machine)
            if not capacity:
                try:
                    capacity, unit = planning._resolve_capacity_profile(
                        db=db, plant_id=planning._to_uuid(plant_id), stage=stage, machine_id=planning._to_uuid(str(machine.get("id")), field="machine_id"),
                        machine_capacity=planning._snapshot_float(machine.get("capacity_value")), on_day=on_day,
                    )
                except Exception:
                    capacity, unit = None, None
            rows.append({"id": str(machine.get("id")), "code": machine.get("code"), "name": machine.get("name") or machine.get("code"), "stage": stage,
                         "capacity_per_shift": capacity, "capacity_unit": unit or planning.STAGE_DEFAULT_CAPACITY_UNITS.get(stage)})
    return rows


def _queue_summary(db: Session, plant_scope: dict, stages: list[str], today: date) -> list[dict[str, Any]]:
    query = (
        db.query(JobCardStageSegment, JobCard)
        .join(JobCard, JobCard.id == JobCardStageSegment.job_card_id)
        .filter(JobCardStageSegment.stage_type.in_(stages), JobCardStageSegment.status.in_(["QUEUED", "PLANNED"]), JobCard.status.notin_(["COMPLETED", "CANCELLED"]))
    )
    rows = planning._apply_plant_scope_filter(query, JobCard.plant_id, plant_scope).all()
    by_stage: dict[str, list[tuple[JobCardStageSegment, JobCard]]] = defaultdict(list)
    for segment, job in rows:
        by_stage[segment.stage_type].append((segment, job))
    out = []
    for stage in stages:
        items = by_stage.get(stage, [])
        locks = planning._planning_locks(db, [job.id for _, job in items], stage)
        cards: dict[uuid.UUID, dict[str, Any]] = {}
        for segment, job in items:
            card = cards.setdefault(job.id, {"qty": 0.0, "due": _due_date(job, None), "locked": job.id in locks, "missed": bool(job.missed_slot_open)})
            card["qty"] += float(segment.planned_qty or 0)
        open_cards = [c for c in cards.values() if not c["locked"]]
        due_soon = [c for c in open_cards if c["due"] and date.fromisoformat(c["due"]) <= today + timedelta(days=3)]
        out.append({
            "stage": stage, "label": STAGE_LABEL.get(stage, stage.title()),
            "open_cards": len(open_cards), "open_pcs": round(sum(c["qty"] for c in open_cards), 2),
            "due_3d": len(due_soon), "overdue": sum(1 for c in due_soon if date.fromisoformat(c["due"]) < today),
            "missed": sum(1 for c in open_cards if c["missed"]),
            "waiting_cards": sum(1 for c in cards.values() if c["locked"]),
            "waiting_for": planning.PLAN_GATED_STAGES.get(stage, (None,))[0],
        })
    return out


def _load(slots: list[dict[str, Any]], machines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    capacity = {m["id"]: m for m in machines}
    buckets: dict[tuple[str, str, str], dict[str, Any]] = {}
    for slot in slots:
        key = (slot["machine_id"], slot["plan_date"], slot["shift_code"] or "")
        bucket = buckets.setdefault(key, {"machine_id": slot["machine_id"], "stage": slot["stage"], "plan_date": slot["plan_date"], "shift_code": slot["shift_code"],
                                          "load": 0.0, "slots": 0, "planned_qty": 0.0, "made_qty": 0.0, "unit": slot["unit"]})
        bucket["load"] += slot["required_capacity"]
        bucket["slots"] += 1
        bucket["planned_qty"] += slot["planned_qty"]
        bucket["made_qty"] += slot["made_in_slot"]
    out = []
    for bucket in buckets.values():
        machine = capacity.get(bucket["machine_id"]) or {}
        cap = machine.get("capacity_per_shift")
        bucket["capacity"] = cap
        bucket["capacity_unit"] = machine.get("capacity_unit")
        bucket["pct"] = round(bucket["load"] * 100.0 / cap, 1) if cap else None
        bucket["load"] = round(bucket["load"], 2)
        out.append(bucket)
    return sorted(out, key=lambda row: (row["plan_date"], row["shift_code"] or "", row["stage"], row["machine_id"] or ""))


def _missed(db: Session, plant_scope: dict, stages: list[str], start: date, end: date) -> list[dict[str, Any]]:
    query = db.query(AuditEvent, JobCard).join(JobCard, JobCard.id == AuditEvent.job_card_id).filter(AuditEvent.action == "missed_slot_requeued")
    out = []
    for event, job in planning._apply_plant_scope_filter(query, JobCard.plant_id, plant_scope).all():
        payload = event.payload or {}
        try:
            day = date.fromisoformat(str(payload.get("plan_date"))[:10])
        except ValueError:
            continue
        if not (start <= day <= end) or str(payload.get("stage") or "").upper() not in stages:
            continue
        out.append({"job_card_id": str(job.id), "job_card_no": job.job_card_no, "stage": payload.get("stage"), "plan_date": day.isoformat(),
                    "shift_code": payload.get("shift_code"), "machine_id": payload.get("machine_id"), "requeued_at": payload.get("requeued_at"),
                    "still_open": bool(job.missed_slot_open)})
    return sorted(out, key=lambda row: (row["plan_date"], row["job_card_no"] or ""))


def _attention(slots: list[dict[str, Any]], load: list[dict[str, Any]], queue: list[dict[str, Any]], machines: dict[str, dict[str, Any]], now: datetime) -> list[dict[str, Any]]:
    """What a planner can still act on: silent slots before they requeue, and current or future slots only."""
    items: list[dict[str, Any]] = []
    for slot in slots:
        ahead = slot["result"] in {"UPCOMING", "IN_PROGRESS"} and not slot["placed_by_floor"]
        where = f"{slot['plan_date']} · {(slot['shift_code'] or '').replace('SHIFT_', 'Shift ')} · {(machines.get(slot['machine_id']) or {}).get('name') or 'machine'}"
        if slot["hours_to_requeue"] is not None:
            hours = slot["hours_to_requeue"]
            items.append({"kind": "SILENT_SLOT", "severity": "high" if hours <= 12 else "medium", "job_card_id": slot["job_card_id"], "job_card_no": slot["job_card_no"],
                          "stage": slot["stage"], "plan_date": slot["plan_date"], "shift_code": slot["shift_code"], "machine_id": slot["machine_id"],
                          "title": f"{slot['job_card_no']} {STAGE_LABEL.get(slot['stage'], slot['stage'])}: slot passed, nothing logged",
                          "detail": f"{where}. Goes back to the queue in {max(hours, 0):.0f} h unless a run is logged." if hours > 0 else f"{where}. Going back to the queue now."})
        if slot["order_conflict"] and ahead:
            items.append({"kind": "ORDER", "severity": "medium", "job_card_id": slot["job_card_id"], "job_card_no": slot["job_card_no"], "stage": slot["stage"],
                          "plan_date": slot["plan_date"], "shift_code": slot["shift_code"], "machine_id": slot["machine_id"],
                          "title": f"{slot['job_card_no']} {STAGE_LABEL.get(slot['stage'], slot['stage'])} is planned before its {STAGE_LABEL.get(slot['previous_stage'] or '', 'previous stage').lower()}",
                          "detail": f"{where}. Move it after the {STAGE_LABEL.get(slot['previous_stage'] or '', 'previous stage').lower()} slot."})
        if slot["due_date"] and ahead and slot["plan_date"] > slot["due_date"]:
            items.append({"kind": "AFTER_DUE", "severity": "medium", "job_card_id": slot["job_card_id"], "job_card_no": slot["job_card_no"], "stage": slot["stage"],
                          "plan_date": slot["plan_date"], "shift_code": slot["shift_code"], "machine_id": slot["machine_id"],
                          "title": f"{slot['job_card_no']} is planned after the customer due date ({slot['due_date']})", "detail": where})
    for bucket in load:
        _, shift_end = slot_window(date.fromisoformat(bucket["plan_date"]), bucket["shift_code"])
        if bucket["pct"] is not None and bucket["pct"] > 100 and shift_end > now:
            name = (machines.get(bucket["machine_id"]) or {}).get("name") or "Machine"
            items.append({"kind": "OVERLOAD", "severity": "medium", "stage": bucket["stage"], "plan_date": bucket["plan_date"], "shift_code": bucket["shift_code"],
                          "machine_id": bucket["machine_id"], "title": f"{name} over capacity: {bucket['pct']:.0f} %",
                          "detail": f"{bucket['plan_date']} · {(bucket['shift_code'] or '').replace('SHIFT_', 'Shift ')} · {bucket['slots']} slot(s)."})
    for row in queue:
        if row["overdue"] or row["due_3d"]:
            items.append({"kind": "QUEUE_DUE", "severity": "high" if row["overdue"] else "low", "stage": row["stage"],
                          "title": f"{row['label']}: {row['due_3d']} card(s) due within 3 days still not planned" + (f" ({row['overdue']} overdue)" if row["overdue"] else ""),
                          "detail": "Open the planner queue for this stage."})
    rank = {"high": 0, "medium": 1, "low": 2}
    return sorted(items, key=lambda item: (rank[item["severity"]], item.get("plan_date") or "", item.get("job_card_no") or ""))


def _counts(slots: list[dict[str, Any]]) -> dict[str, Any]:
    results = Counter(slot["result"] for slot in slots)
    return {
        "slots": len(slots), "cards": len({slot["job_card_id"] for slot in slots}),
        "planned_pcs": round(sum(slot["planned_pcs"] for slot in slots), 2),
        "done": results.get("DONE", 0), "partly": results.get("PARTLY", 0), "moved": results.get("MOVED", 0), "not_run": results.get("NOT_RUN", 0),
        "in_progress": results.get("IN_PROGRESS", 0), "upcoming": results.get("UPCOMING", 0), "not_needed": results.get("NOT_NEEDED", 0),
        "floor_placed": results.get("FLOOR_PLACED", 0),
        "adherence_pct": adherence(slot["result"] for slot in slots),
    }


@router.get("/planning/overview")
def planning_overview(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    stages: Optional[str] = Query(None, description="Comma list of SLITTING, WINDER, OVEN, PROCESS"),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    user: dict = Depends(require_role(PLAN_ROLES)),
):
    """Planned slots of a period against what the floor logged, machine load, queues and what needs action."""
    chosen = _stages_param(stages)
    start, end = _range(date_from, date_to, 1, 5)
    plant_id = plant_scope.get("selected_plant_id")
    if plant_id:
        planning._sweep_missed_slots_safely(db, plant_id)
    token = user.get("token", "")
    built = _build(db, plant_scope, chosen, start, end, token, plant_id)
    machines = _machines(chosen, token, plant_id, db, start)
    machine_map = {m["id"]: m for m in machines}
    load = _load(built["slots"], machines)
    queue = _queue_summary(db, plant_scope, chosen, planning._plant_today())
    days = [(start + timedelta(days=index)).isoformat() for index in range((end - start).days + 1)]
    closed = sorted(day.isoformat() for day in planning._fetch_plant_closed_dates(token, plant_id, start, (end - start).days + 1) if start <= day <= end) if plant_id else []
    by_stage = []
    for stage in chosen:
        stage_slots = [slot for slot in built["slots"] if slot["stage"] == stage]
        stage_load = [row for row in load if row["stage"] == stage and row["pct"] is not None]
        by_stage.append({"stage": stage, "label": STAGE_LABEL.get(stage, stage.title()), "unit": stage_unit(stage), **_counts(stage_slots),
                         "planned_qty": round(sum(slot["planned_qty"] for slot in stage_slots), 2),
                         "made_in_slot": round(sum(slot["made_in_slot"] for slot in stage_slots), 2),
                         "avg_load_pct": round(sum(row["pct"] for row in stage_load) / len(stage_load), 1) if stage_load else None,
                         "machines": sum(1 for m in machines if m["stage"] == stage)})
    unplanned_runs = [row for row in built["runs"] if row["match"] == "UNPLANNED"]
    missed = _missed(db, plant_scope, chosen, start, end)
    return {
        "date_from": start.isoformat(), "date_to": end.isoformat(), "days": days, "closed_days": closed,
        "today": planning._plant_today().isoformat(), "now": built["now"].isoformat(timespec="minutes"),
        "stages": chosen, "stage_labels": {stage: STAGE_LABEL.get(stage, stage.title()) for stage in chosen},
        "shifts": [{"code": "SHIFT_A", "label": "Shift A", "start": "08:00", "end": "20:00"}, {"code": "SHIFT_B", "label": "Shift B", "start": "20:00", "end": "08:00"}],
        "result_labels": {**RESULT_LABEL, "FLOOR_PLACED": "Logged before planning"}, "match_labels": MATCH_LABEL,
        "missed_slot_hours": MISSED_SLOT_HOURS,
        "machines": machines, "slots": built["slots"], "load": load, "queue": queue, "runs": built["runs"],
        "unplanned_runs": unplanned_runs, "missed": missed,
        "summary": {**_counts(built["slots"]), "unplanned_runs": len(unplanned_runs), "missed_slots": len(missed),
                    "queue_cards": sum(row["open_cards"] for row in queue), "waiting_cards": sum(row["waiting_cards"] for row in queue),
                    "overloaded_shifts": sum(1 for row in load if row["pct"] is not None and row["pct"] > 100)},
        "by_stage": by_stage,
        "attention": _attention(built["slots"], load, queue, machine_map, built["now"]),
    }


@router.get("/reports/planning")
def planning_report(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    stages: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    user: dict = Depends(require_role(REPORT_ROLES)),
):
    """How well the plan held for a period: slots done in their slot, load, missed slots, cards on time."""
    chosen = _stages_param(stages)
    start, end = _range(date_from, date_to, 29, 0)
    plant_id = plant_scope.get("selected_plant_id")
    token = user.get("token", "")
    built = _build(db, plant_scope, chosen, start, end, token, plant_id)
    slots = built["slots"]
    machines = _machines(chosen, token, plant_id, db, start)
    load = _load(slots, machines)

    def group(key) -> list[dict[str, Any]]:
        buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for slot in slots:
            buckets[key(slot)].append(slot)
        return [{"key": name, **_counts(rows), "planned_qty": round(sum(r["planned_qty"] for r in rows), 2),
                 "made_in_slot": round(sum(r["made_in_slot"] for r in rows), 2), "made_elsewhere": round(sum(r["made_elsewhere"] for r in rows), 2)}
                for name, rows in sorted(buckets.items())]

    machine_rows = group(lambda s: s["machine_id"] or "—")
    load_by_machine: dict[str, list[float]] = defaultdict(list)
    for row in load:
        if row["pct"] is not None:
            load_by_machine[row["machine_id"]].append(row["pct"])
    for row in machine_rows:
        values = load_by_machine.get(row["key"], [])
        row["avg_load_pct"] = round(sum(values) / len(values), 1) if values else None
        row["stage"] = next((m["stage"] for m in machines if m["id"] == row["key"]), None)

    # Card on-time: planned finish (end of its last slot per stage) against the stage close or last run.
    cards: list[dict[str, Any]] = []
    jobs = built["jobs"]
    by_card: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for slot in slots:
        by_card[(slot["job_card_id"], slot["stage"])].append(slot)
    runs_by_card: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for run in built["runs"]:
        runs_by_card[(run["job_card_id"], run["stage"])].append(run)
    for (card_id, stage), rows in by_card.items():
        job = jobs.get(uuid.UUID(card_id))
        planned_finish = max(datetime.fromisoformat(r["window_end"]) for r in rows)
        stage_row = built["stage_rows"].get((uuid.UUID(card_id), stage))
        closed_at = None
        if stage_row is not None and stage_row.status == "COMPLETED":
            closed = (stage_row.actuals_snapshot or {}).get("closed_at") if job and _is_v2(job) else None
            closed_at = datetime.fromisoformat(str(closed).replace("Z", "")) + timedelta(hours=5, minutes=30) if closed else (
                stage_row.actual_end + timedelta(hours=5, minutes=30) if stage_row.actual_end else None)
            if closed_at is None and runs_by_card.get((card_id, stage)):
                last = max(runs_by_card[(card_id, stage)], key=lambda r: (r["date"], r["shift_code"] or ""))
                closed_at = slot_window(date.fromisoformat(last["date"]), last["shift_code"])[1]
        late_days = (closed_at.date() - planned_finish.date()).days if closed_at else None
        cards.append({"job_card_id": card_id, "job_card_no": rows[0]["job_card_no"], "customer_name": rows[0]["customer_name"], "stage": stage,
                      "slots": len(rows), "planned_finish": planned_finish.isoformat(), "finished_at": closed_at.isoformat() if closed_at else None,
                      "status": ("ON_TIME" if closed_at <= planned_finish else "LATE") if closed_at else ("OPEN_LATE" if built["now"] > planned_finish else "OPEN"),
                      "late_days": late_days if late_days and late_days > 0 else 0})
    cards.sort(key=lambda row: (row["status"] not in ("LATE", "OPEN_LATE"), -row["late_days"], row["job_card_no"] or ""))
    finished = [row for row in cards if row["finished_at"]]
    trend = group(lambda s: s["plan_date"])
    missed = _missed(db, plant_scope, chosen, start, end)
    unplanned = [row for row in built["runs"] if row["match"] == "UNPLANNED"]
    return {
        "date_from": start.isoformat(), "date_to": end.isoformat(), "stages": chosen, "result_labels": {**RESULT_LABEL, "FLOOR_PLACED": "Logged before planning"},
        "summary": {**_counts(slots), "missed_slots": len(missed), "runs": len(built["runs"]), "unplanned_runs": len(unplanned),
                    "unplanned_share_pct": round(len(unplanned) * 100.0 / len(built["runs"]), 1) if built["runs"] else None,
                    "stages_finished": len(finished), "finished_on_time": sum(1 for row in finished if row["status"] == "ON_TIME"),
                    "on_time_pct": round(sum(1 for row in finished if row["status"] == "ON_TIME") * 100.0 / len(finished), 1) if finished else None,
                    "avg_load_pct": round(sum(r["pct"] for r in load if r["pct"] is not None) / max(1, sum(1 for r in load if r["pct"] is not None)), 1) if any(r["pct"] is not None for r in load) else None},
        "by_stage": [{"stage": row["key"], "label": STAGE_LABEL.get(row["key"], row["key"]), **{k: v for k, v in row.items() if k != "key"}} for row in group(lambda s: s["stage"])],
        "by_machine": [{"machine_id": row.pop("key"), **row} for row in machine_rows],
        "by_shift": [{"shift_code": row.pop("key"), **row} for row in group(lambda s: s["shift_code"] or "—")],
        "trend": [{"date": row.pop("key"), **row} for row in trend],
        "machines": machines, "cards": cards, "missed": missed, "unplanned_runs": unplanned, "slots": slots,
    }


@router.get("/job-cards/{job_card_id}/plan")
def job_card_plan(
    job_card_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    user: dict = Depends(require_role(REPORT_ROLES + ["Operator", "InProcessQC", "Dispatch"])),
):
    """This card's planner slots per stage and what the floor logged in each (read-only)."""
    query = planning._apply_plant_scope_filter(db.query(JobCard).filter(JobCard.id == job_card_id), JobCard.plant_id, plant_scope)
    job = query.first()
    if job is None:
        raise HTTPException(status_code=404, detail="Job card not found")
    segments = db.query(JobCardStageSegment).filter(JobCardStageSegment.job_card_id == job.id, JobCardStageSegment.stage_type.in_(list(PLAN_STAGES)),
                                                    JobCardStageSegment.status.in_(PLANNED_STATUSES), JobCardStageSegment.plan_date.isnot(None)).all()
    days = [segment.plan_date for segment in segments if segment.plan_date]
    entries = db.query(StageEntry.business_date).filter(StageEntry.job_card_id == job.id, StageEntry.status == "SUBMITTED").all()
    days += [row[0] for row in entries if row[0]]
    start = min(days) if days else planning._plant_today()
    end = max(days) if days else start
    if (end - start).days + 1 > MAX_RANGE_DAYS:
        start = end - timedelta(days=MAX_RANGE_DAYS - 1)
    scope = {"scope_all": False, "selected_plant_id": str(job.plant_id), "allowed_plants": [str(job.plant_id)]}
    built = _build(db, scope, list(PLAN_STAGES), start, end, user.get("token", ""), str(job.plant_id))
    slots = [slot for slot in built["slots"] if slot["job_card_id"] == str(job.id)]
    runs = [run for run in built["runs"] if run["job_card_id"] == str(job.id)]
    open_queue = db.query(JobCardStageSegment.stage_type).filter(JobCardStageSegment.job_card_id == job.id, JobCardStageSegment.stage_type.in_(list(PLAN_STAGES)),
                                                                 JobCardStageSegment.status.in_(["QUEUED", "PLANNED"])).all()
    stages_waiting = sorted({row[0] for row in open_queue}, key=lambda stage: PLAN_STAGES.index(stage))
    locks = {stage: planning._planning_locks(db, [job.id], stage).get(job.id) for stage in stages_waiting}
    return {
        "job_card_id": str(job.id), "job_card_no": job.job_card_no, "slots": slots, "runs": runs,
        "unplanned_stages": [{"stage": stage, "label": STAGE_LABEL.get(stage, stage), "waiting_for": locks.get(stage)} for stage in stages_waiting],
        "missed_slot_open": bool(job.missed_slot_open), "last_missed_slot": job.last_missed_slot,
        "summary": _counts(slots), "result_labels": {**RESULT_LABEL, "FLOOR_PLACED": "Logged before planning"}, "match_labels": MATCH_LABEL,
    }


# ── saved planner views ────────────────────────────────────────────────────


class PlannerViewPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(..., min_length=1, max_length=80)
    scope: str = "PERSONAL"
    stage: Optional[str] = None
    filters: dict[str, Any] = Field(default_factory=dict)
    position: int = 0

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("Give the view a name")
        return value

    @field_validator("scope")
    @classmethod
    def _scope(cls, value: str) -> str:
        value = str(value or "PERSONAL").upper()
        if value not in {"PERSONAL", "PLANT"}:
            raise ValueError("A view is for you (PERSONAL) or for everyone in the plant (PLANT)")
        return value

    @field_validator("stage")
    @classmethod
    def _stage(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, "", "ALL"):
            return None
        value = value.upper()
        if value not in planning.STAGE_SEQUENCE:
            raise ValueError("Unknown stage")
        return value

    @field_validator("filters")
    @classmethod
    def _filters(cls, value: dict[str, Any]) -> dict[str, Any]:
        import json

        if len(json.dumps(value, default=str)) > 8000:
            raise ValueError("Too many filters in one view")
        return value


def _view_dict(view: PlannerView, user: dict) -> dict[str, Any]:
    return {"id": str(view.id), "name": view.name, "scope": view.scope, "stage": view.stage, "filters": view.filters or {}, "position": view.position,
            "owner_name": view.owner_name, "mine": view.owner_id == str(user.get("sub")), "can_edit": _can_edit(view, user),
            "updated_at": view.updated_at.isoformat() if view.updated_at else None}


def _can_edit(view: PlannerView, user: dict) -> bool:
    roles = set(user.get("roles") or []) | {user.get("role")}
    return view.owner_id == str(user.get("sub")) or bool(roles & {"Owner", "Admin", "PlantManager"})


@router.get("/planning/views")
def list_planner_views(stage: Optional[str] = Query(None), db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), user: dict = Depends(require_role(PLAN_ROLES))):
    query = db.query(PlannerView).filter(PlannerView.plant_id == planning._to_uuid(plant_id))
    rows = [v for v in query.all() if v.scope == "PLANT" or v.owner_id == str(user.get("sub"))]
    if stage:
        rows = [v for v in rows if v.stage in (None, stage.upper())]
    rows.sort(key=lambda v: (v.position, v.name.lower()))
    return [_view_dict(v, user) for v in rows]


@router.post("/planning/views")
def create_planner_view(payload: PlannerViewPayload, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), user: dict = Depends(require_role(PLAN_ROLES))):
    plant_uuid = planning._to_uuid(plant_id)
    mine = [v for v in db.query(PlannerView).filter(PlannerView.plant_id == plant_uuid).all() if v.scope == "PLANT" or v.owner_id == str(user.get("sub"))]
    if any(v.name.lower() == payload.name.lower() and v.stage == payload.stage for v in mine):
        raise HTTPException(status_code=409, detail=f"A view called '{payload.name}' already exists")
    view = PlannerView(plant_id=plant_uuid, owner_id=str(user.get("sub")), owner_name=user.get("name") or user.get("full_name") or user.get("email"),
                       name=payload.name, scope=payload.scope, stage=payload.stage, filters=payload.filters,
                       position=payload.position or (max((v.position for v in mine), default=0) + 1))
    db.add(view)
    db.commit()
    db.refresh(view)
    return _view_dict(view, user)


@router.patch("/planning/views/{view_id}")
def update_planner_view(view_id: uuid.UUID, payload: PlannerViewPayload, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), user: dict = Depends(require_role(PLAN_ROLES))):
    view = db.query(PlannerView).filter(PlannerView.id == view_id, PlannerView.plant_id == planning._to_uuid(plant_id)).first()
    if view is None or (view.scope != "PLANT" and view.owner_id != str(user.get("sub"))):
        raise HTTPException(status_code=404, detail="View not found")
    if not _can_edit(view, user):
        raise HTTPException(status_code=403, detail="Only the person who made this view or a plant head can change it")
    view.name, view.scope, view.stage, view.filters, view.position = payload.name, payload.scope, payload.stage, payload.filters, payload.position
    view.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(view)
    return _view_dict(view, user)


@router.delete("/planning/views/{view_id}")
def delete_planner_view(view_id: uuid.UUID, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), user: dict = Depends(require_role(PLAN_ROLES))):
    view = db.query(PlannerView).filter(PlannerView.id == view_id, PlannerView.plant_id == planning._to_uuid(plant_id)).first()
    if view is None or (view.scope != "PLANT" and view.owner_id != str(user.get("sub"))):
        raise HTTPException(status_code=404, detail="View not found")
    if not _can_edit(view, user):
        raise HTTPException(status_code=403, detail="Only the person who made this view or a plant head can delete it")
    db.delete(view)
    db.commit()
    return {"deleted": str(view_id)}


# ── several cards onto the board at once ───────────────────────────────────


class BulkMovePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    moves: list[BoardMovePayload] = Field(..., min_length=1, max_length=50)


@router.post("/planning/board/move-bulk")
def move_many_planning_cards(payload: BulkMovePayload, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), user: dict = Depends(require_role(PLAN_ROLES))):
    """Place several queue cards in one go: all or nothing, in the order given (later cards follow earlier ones)."""
    results = []
    try:
        for index, move in enumerate(payload.moves):
            try:
                response = planning._reorder_stage_queue_core(
                    payload=ReorderQueuePayload(job_card_id=move.job_card_id, segment_id=move.segment_id, stage=move.stage, machine_id=move.machine_id,
                                                sequence_no=move.sequence_no, plan_date=move.plan_date, shift_code=move.shift_code),
                    db=db, plant_id=plant_id, current_user=user,
                )
            except HTTPException as exc:
                job = db.query(JobCard).filter(JobCard.id == move.job_card_id).first() if move.job_card_id else None
                if job is None and move.segment_id:
                    segment = db.query(JobCardStageSegment).filter(JobCardStageSegment.id == move.segment_id).first()
                    job = segment.job_card if segment else None
                label = job.job_card_no if job else f"card {index + 1}"
                detail = (exc.detail if isinstance(exc.detail, str) else str(exc.detail)).rstrip(". ")
                raise HTTPException(status_code=exc.status_code, detail=f"{label}: {detail}. Nothing was moved.")
            results.append(response)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"moved": len(results), "results": [r.model_dump(mode="json") for r in results],
            "warnings": [w for r in results for w in (r.warnings or [])]}
