"""Plan vs actual (client 2026-10-25): did each floor run happen on the slot the planner gave it?

Every run written on the floor (a batch entry, or a stage saved on the old form) is compared with
the slot planned for it: plan date, shift and machine, and — when the card times were written —
whether the run sat inside that planned shift. A run logged before the planner placed the stage is
"run before planning"; a planned slot that passed with no entry at all is "missed". The planned slot
is the one in force when the run was entered (kept on the run); runs entered before that was kept
fall back to the stage's current slot.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..entry_models import StageEntry
from ..lifecycle_rules import SHIFT_HOURS, SHIFT_START, canonical_shift, stage_unit
from ..models import AuditEvent, JobCard, JobCardStage, JobCardStageSegment
from ..utils.auth import get_current_plant_scope, require_role

router = APIRouter(prefix="/reports", tags=["reports"])
FLOOR_STAGES = ("SLITTING", "WINDER", "OVEN", "PROCESS")
REPORT_ROLES = ["Owner", "Admin", "PlantManager", "Planner", "Production", "QC"]
STATUS_LABEL = {
    "ON_PLAN": "As planned",
    "OFF_PLAN": "Different from plan",
    "UNPLANNED": "Run before planning",
    "MISSED": "Planned, not run",
}


def _shift(value: Any) -> Optional[str]:
    try:
        return canonical_shift(value)
    except ValueError:
        return str(value or "").upper() or None


def _parse_date(value: Any) -> Optional[date]:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    try:
        return date.fromisoformat(str(value)[:10]) if value else None
    except ValueError:
        return None


def _card_time(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=None)


def shift_window(day: date, shift: Optional[str]) -> tuple[datetime, datetime]:
    start = datetime.combine(day, SHIFT_START.get(shift or "", time(8, 0)))
    return start, start + timedelta(hours=SHIFT_HOURS)


# The planner gate's message (stored on the entry) tells the floor what to do; the report says what happened.
_GATE_REASONS = (
    ("36 h entry window", "Its planner slot was more than 36 h old when the run was entered."),
    ("outside the next 3 days", "Its planner slot was more than 3 days ahead when the run was entered."),
    ("Schedule machine, shift", "No planner slot (machine, shift and date) when the run was entered."),
    ("Schedule this stage", "The stage was not on the planner when the run was entered."),
)
_NO_SLOT = "The stage had no planner slot when this run was entered."


def unplanned_reason(gate_message: Optional[str]) -> str:
    text = str(gate_message or "").strip()
    for marker, reason in _GATE_REASONS:
        if marker in text:
            return reason
    return text or _NO_SLOT


def classify(actual: dict[str, Any], planned: Optional[dict[str, Any]], unscheduled: Optional[dict[str, Any]]) -> dict[str, Any]:
    """Compare one run with its planned slot. Pure; unit-tested."""
    result: dict[str, Any] = {"status": "ON_PLAN", "deviations": [], "days_off": 0, "time_check": "NO_TIME"}
    plan_day = _parse_date((planned or {}).get("plan_date"))
    if unscheduled or not planned or not plan_day:
        result["status"] = "UNPLANNED"
        result["reason"] = unplanned_reason((unscheduled or {}).get("reason"))
        return result
    actual_day = _parse_date(actual.get("date"))
    if actual_day and actual_day != plan_day:
        result["days_off"] = (actual_day - plan_day).days
        result["deviations"].append("LATE" if result["days_off"] > 0 else "EARLY")
    planned_shift, actual_shift = _shift(planned.get("shift_code")), _shift(actual.get("shift_code"))
    if planned_shift and actual_shift and planned_shift != actual_shift:
        result["deviations"].append("SHIFT")
    planned_machine, actual_machine = planned.get("machine_id"), actual.get("machine_id")
    if planned_machine and actual_machine and str(planned_machine) != str(actual_machine):
        result["deviations"].append("MACHINE")
    start, end = _card_time(actual.get("start")), _card_time(actual.get("end"))
    if start or end:
        window_start, window_end = shift_window(plan_day, planned_shift)
        inside = all(window_start <= moment <= window_end for moment in (start, end) if moment)
        result["time_check"] = "IN_SLOT" if inside else "OUTSIDE_SLOT"
        if not inside and "SHIFT" not in result["deviations"] and not result["days_off"]:
            result["deviations"].append("TIME")
    if result["deviations"]:
        result["status"] = "OFF_PLAN"
    return result


def _slot(row: Any) -> Optional[dict[str, Any]]:
    if row is None or not getattr(row, "plan_date", None):
        return None
    return {"plan_date": row.plan_date.isoformat(), "shift_code": row.shift_code, "machine_id": str(row.machine_id) if row.machine_id else None}


def _scope(query, column, plant_scope: dict):
    from .planning import _apply_plant_scope_filter

    return _apply_plant_scope_filter(query, column, plant_scope)


def _customer(job: JobCard) -> Optional[str]:
    snapshot = job.spec_snapshot or {}
    return snapshot.get("customer_name_snapshot") or snapshot.get("customer_name")


@router.get("/plan-vs-actual")
def plan_vs_actual(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    stage: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    user: dict = Depends(require_role(REPORT_ROLES)),
):
    today = date.today()
    end = date_to or today
    start = date_from or (end - timedelta(days=30))
    stages = [stage.upper()] if stage and stage.upper() in FLOOR_STAGES else list(FLOOR_STAGES)
    rows: list[dict[str, Any]] = []

    # Batch entries: one row per submitted run.
    entry_query = (
        db.query(StageEntry, JobCard)
        .join(JobCard, JobCard.id == StageEntry.job_card_id)
        .filter(StageEntry.status == "SUBMITTED", StageEntry.kind == "PRODUCTION", StageEntry.stage.in_(stages),
                StageEntry.business_date >= start, StageEntry.business_date <= end)
    )
    entry_query = _scope(entry_query, JobCard.plant_id, plant_scope)
    entries = entry_query.order_by(StageEntry.business_date.desc(), StageEntry.created_at.desc()).limit(5000).all()
    segment_ids = {e.segment_id for e, _ in entries if e.segment_id}
    segments = {s.id: s for s in db.query(JobCardStageSegment).filter(JobCardStageSegment.id.in_(segment_ids)).all()} if segment_ids else {}
    for entry, job in entries:
        details = entry.details or {}
        unscheduled = details.get("unscheduled_entry")
        planned = details.get("planned_slot")
        if planned is None and not unscheduled:
            planned = _slot(segments.get(entry.segment_id))
            if planned and (details.get("machine_changed") or {}).get("from"):
                planned["machine_id"] = details["machine_changed"]["from"]
        actual = {"date": entry.business_date, "shift_code": entry.shift_code, "machine_id": str(entry.machine_id) if entry.machine_id else None,
                  "start": details.get("start_time"), "end": details.get("end_time")}
        verdict = classify(actual, planned, unscheduled)
        rows.append({
            "source": "BATCH", "job_card_id": str(job.id), "job_card_no": job.job_card_no, "customer": _customer(job), "stage": entry.stage,
            "run": f"Run #{entry.entry_no}", "actual_date": entry.business_date.isoformat() if entry.business_date else None,
            "actual_shift": _shift(entry.shift_code), "machine_id": actual["machine_id"], "produced": entry.produced, "accepted": entry.accepted,
            "unit": stage_unit(entry.stage), "card_start": details.get("start_time"), "card_end": details.get("end_time"),
            "planned_date": (planned or {}).get("plan_date"), "planned_shift": _shift((planned or {}).get("shift_code")),
            "planned_machine_id": (planned or {}).get("machine_id"), "operator": entry.operator_name, "entered_by": entry.created_by,
            "entered_at": entry.created_at.isoformat() if entry.created_at else None, **verdict,
        })

    # Old-form cards: one row per stage saved on the card.
    stage_query = (
        db.query(JobCardStage, JobCard)
        .join(JobCard, JobCard.id == JobCardStage.job_card_id)
        .filter(JobCardStage.stage_type.in_(stages), JobCardStage.status.in_(["COMPLETED", "RUNNING"]))
    )
    stage_query = _scope(stage_query, JobCard.plant_id, plant_scope)
    for row, job in stage_query.all():
        if (job.spec_snapshot or {}).get("entry_model") == "V2":
            continue
        moment = row.actual_end or row.actual_start
        actual_day = (moment + timedelta(hours=5, minutes=30)).date() if moment else None
        if not actual_day or actual_day < start or actual_day > end:
            continue
        actuals, entry = row.actuals_snapshot or {}, row.entry_snapshot or {}
        unscheduled = actuals.get("unscheduled_entry")
        planned = actuals.get("planned_slot") or (None if unscheduled else _slot(row))
        actual = {"date": actual_day, "shift_code": entry.get("shift_code") or row.shift_code, "machine_id": str(row.machine_id) if row.machine_id else None,
                  "start": entry.get("start_time"), "end": entry.get("end_time")}
        verdict = classify(actual, planned, unscheduled)
        rows.append({
            "source": "CARD_FORM", "job_card_id": str(job.id), "job_card_no": job.job_card_no, "customer": _customer(job), "stage": row.stage_type,
            "run": "Card form", "actual_date": actual_day.isoformat(), "actual_shift": _shift(actual["shift_code"]), "machine_id": actual["machine_id"],
            "produced": (row.output_qty or 0) + (row.scrap_qty or 0), "accepted": row.output_qty or 0, "unit": stage_unit(row.stage_type),
            "card_start": entry.get("start_time"), "card_end": entry.get("end_time"), "planned_date": (planned or {}).get("plan_date"),
            "planned_shift": _shift((planned or {}).get("shift_code")), "planned_machine_id": (planned or {}).get("machine_id"),
            "operator": entry.get("operator_name"), "entered_by": None, "entered_at": None, **verdict,
        })

    # Planned slots that passed with no floor entry (requeued by the 36-hour rule).
    missed_query = db.query(AuditEvent, JobCard).join(JobCard, JobCard.id == AuditEvent.job_card_id).filter(AuditEvent.action == "missed_slot_requeued")
    missed_query = _scope(missed_query, JobCard.plant_id, plant_scope)
    missed: list[dict[str, Any]] = []
    for event, job in missed_query.all():
        payload = event.payload or {}
        day = _parse_date(payload.get("plan_date"))
        if not day or day < start or day > end or str(payload.get("stage") or "").upper() not in stages:
            continue
        missed.append({
            "job_card_id": str(job.id), "job_card_no": job.job_card_no, "customer": _customer(job), "stage": payload.get("stage"),
            "planned_date": day.isoformat(), "planned_shift": _shift(payload.get("shift_code")), "planned_machine_id": payload.get("machine_id"),
            "requeued_at": payload.get("requeued_at"), "status": "MISSED",
        })

    counts = Counter(row["status"] for row in rows)
    runs = len(rows)
    deviations = Counter(code for row in rows for code in row.get("deviations", []))
    by_stage: dict[str, Counter] = defaultdict(Counter)
    by_machine: dict[str, Counter] = defaultdict(Counter)
    by_shift: dict[str, Counter] = defaultdict(Counter)
    for row in rows:
        for bucket, key in ((by_stage, row["stage"]), (by_machine, row.get("machine_id") or "—"), (by_shift, row.get("actual_shift") or "—")):
            bucket[key][row["status"]] += 1
            bucket[key]["runs"] += 1
    for item in missed:
        by_stage[item["stage"]]["MISSED"] += 1

    def table(groups: dict[str, Counter], key: str) -> list[dict[str, Any]]:
        out = []
        for name, values in groups.items():
            total = values.get("runs", 0)
            out.append({key: name, "runs": total, "on_plan": values.get("ON_PLAN", 0), "off_plan": values.get("OFF_PLAN", 0),
                        "unplanned": values.get("UNPLANNED", 0), "missed": values.get("MISSED", 0),
                        "adherence_pct": round(values.get("ON_PLAN", 0) * 100.0 / total, 1) if total else None})
        return sorted(out, key=lambda item: (-item["runs"], str(item[key])))

    cards: dict[str, dict[str, Any]] = {}
    for row in rows:
        card = cards.setdefault(row["job_card_id"], {"job_card_id": row["job_card_id"], "job_card_no": row["job_card_no"], "customer": row["customer"], "runs": 0, "on_plan": 0, "off_plan": 0, "unplanned": 0})
        card["runs"] += 1
        card[{"ON_PLAN": "on_plan", "OFF_PLAN": "off_plan", "UNPLANNED": "unplanned"}[row["status"]]] += 1

    return {
        "date_from": start.isoformat(), "date_to": end.isoformat(), "stages": stages, "status_labels": STATUS_LABEL,
        "summary": {
            "runs": runs, "on_plan": counts.get("ON_PLAN", 0), "off_plan": counts.get("OFF_PLAN", 0), "unplanned": counts.get("UNPLANNED", 0),
            "missed_slots": len(missed), "adherence_pct": round(counts.get("ON_PLAN", 0) * 100.0 / runs, 1) if runs else None,
            "late": deviations.get("LATE", 0), "early": deviations.get("EARLY", 0), "other_shift": deviations.get("SHIFT", 0),
            "other_machine": deviations.get("MACHINE", 0), "outside_slot_time": deviations.get("TIME", 0),
            "time_written": sum(1 for row in rows if row["time_check"] != "NO_TIME"),
        },
        "by_stage": table(by_stage, "stage"), "by_machine": table(by_machine, "machine_id"), "by_shift": table(by_shift, "shift"),
        "cards": sorted(cards.values(), key=lambda item: (-(item["off_plan"] + item["unplanned"]), item["job_card_no"] or "")),
        "rows": rows, "missed": missed,
    }
