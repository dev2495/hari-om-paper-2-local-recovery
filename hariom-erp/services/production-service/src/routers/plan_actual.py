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
from ..lifecycle_rules import SHIFT_HOURS, SHIFT_START, canonical_shift, plant_today, planned_in_stage_units, stage_unit
from ..models import AuditEvent, JobCard, JobCardStage, JobCardStageSegment
from ..plan_match import Run, Slot, match_runs
from ..utils.auth import get_current_plant_scope, require_role
from .planning import _pcs_per_bamboo_from_snapshot

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
    today = plant_today()
    end = date_to or today
    start = date_from or (end - timedelta(days=30))
    stages = [stage.upper()] if stage and stage.upper() in FLOOR_STAGES else list(FLOOR_STAGES)
    rows: list[dict[str, Any]] = []

    # Every run written on the floor: a batch entry, or a stage saved on the old form.
    raw: list[dict[str, Any]] = []
    entry_query = (
        db.query(StageEntry, JobCard)
        .join(JobCard, JobCard.id == StageEntry.job_card_id)
        .filter(StageEntry.status == "SUBMITTED", StageEntry.kind == "PRODUCTION", StageEntry.stage.in_(stages),
                StageEntry.business_date >= start, StageEntry.business_date <= end)
    )
    entry_query = _scope(entry_query, JobCard.plant_id, plant_scope)
    planned_machine: dict[str, str] = {}
    for entry, job in entry_query.order_by(StageEntry.business_date.desc(), StageEntry.created_at.desc()).limit(5000).all():
        details = entry.details or {}
        changed = (details.get("machine_changed") or {}).get("from")
        if changed and entry.segment_id:
            planned_machine.setdefault(str(entry.segment_id), str(changed))
        raw.append({
            "key": f"e:{entry.id}", "job": job, "stage": entry.stage, "unscheduled": details.get("unscheduled_entry"),
            "actual": {"date": entry.business_date, "shift_code": entry.shift_code, "machine_id": str(entry.machine_id) if entry.machine_id else None,
                       "start": details.get("start_time"), "end": details.get("end_time")},
            "row": {"source": "BATCH", "run": f"Run #{entry.entry_no}", "produced": entry.produced, "accepted": entry.accepted,
                    "card_start": details.get("start_time"), "card_end": details.get("end_time"), "operator": entry.operator_name,
                    "entered_by": entry.created_by, "entered_at": entry.created_at.isoformat() if entry.created_at else None},
        })

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
        actuals, snapshot = row.actuals_snapshot or {}, row.entry_snapshot or {}
        # Old form run on another machine: its slot follows the machine used, so keep the planned one (as for runs).
        changed = actuals.get("machine_changed") or {}
        if changed.get("from") and changed.get("segment_id"):
            planned_machine.setdefault(str(changed["segment_id"]), str(changed["from"]))
        raw.append({
            "key": f"c:{row.id}", "job": job, "stage": row.stage_type, "unscheduled": actuals.get("unscheduled_entry"),
            "actual": {"date": actual_day, "shift_code": snapshot.get("shift_code") or row.shift_code, "machine_id": str(row.machine_id) if row.machine_id else None,
                       "start": snapshot.get("start_time"), "end": snapshot.get("end_time")},
            "row": {"source": "CARD_FORM", "run": "Card form", "produced": (row.output_qty or 0) + (row.scrap_qty or 0), "accepted": row.output_qty or 0,
                    "card_start": snapshot.get("start_time"), "card_end": snapshot.get("end_time"), "operator": snapshot.get("operator_name"),
                    "entered_by": None, "entered_at": None},
        })

    # Plan of record: each card's planner slots. A run is matched to the slot on its own date and shift
    # (same machine first), else the nearest one (client 2026-10-26: planning is separate, matched here).
    card_ids = list({item["job"].id for item in raw})
    pcs_per_bamboo = {item["job"].id: _pcs_per_bamboo_from_snapshot(item["job"].spec_snapshot or {}) for item in raw}
    slots: list[Slot] = []
    if card_ids:
        for segment in db.query(JobCardStageSegment).filter(
            JobCardStageSegment.job_card_id.in_(card_ids), JobCardStageSegment.stage_type.in_(stages),
            JobCardStageSegment.status.in_(["ASSIGNED", "RUNNING", "COMPLETED"]),
            JobCardStageSegment.plan_date.isnot(None), JobCardStageSegment.shift_code.isnot(None),
        ).all():
            slots.append(Slot(key=str(segment.id), card=str(segment.job_card_id), stage=segment.stage_type, day=segment.plan_date,
                              shift=_shift(segment.shift_code), machine=planned_machine.get(str(segment.id), str(segment.machine_id) if segment.machine_id else None),
                              planned=planned_in_stage_units(segment.stage_type, float(segment.planned_qty or 0), pcs_per_bamboo.get(segment.job_card_id))))
    matched = {m.run.key: m for m in match_runs(slots, [
        Run(key=item["key"], card=str(item["job"].id), stage=item["stage"], day=item["actual"]["date"], shift=_shift(item["actual"]["shift_code"]),
            machine=item["actual"]["machine_id"], made=float(item["row"]["produced"] or 0), good=float(item["row"]["accepted"] or 0),
            unscheduled=bool(item["unscheduled"]))
        for item in raw
    ])}
    for item in raw:
        job, match = item["job"], matched.get(item["key"])
        slot = match.slot if match else None
        planned = {"plan_date": slot.day.isoformat(), "shift_code": slot.shift, "machine_id": slot.machine} if slot else None
        verdict = classify(item["actual"], planned, item["unscheduled"])
        actual = item["actual"]
        rows.append({
            "source": item["row"]["source"], "job_card_id": str(job.id), "job_card_no": job.job_card_no, "customer": _customer(job), "stage": item["stage"],
            "run": item["row"]["run"], "actual_date": actual["date"].isoformat() if actual["date"] else None,
            "actual_shift": _shift(actual["shift_code"]), "machine_id": actual["machine_id"], "produced": item["row"]["produced"], "accepted": item["row"]["accepted"],
            "unit": stage_unit(item["stage"]), "card_start": item["row"]["card_start"], "card_end": item["row"]["card_end"],
            "planned_date": (planned or {}).get("plan_date"), "planned_shift": _shift((planned or {}).get("shift_code")),
            "planned_machine_id": (planned or {}).get("machine_id"), "operator": item["row"]["operator"], "entered_by": item["row"]["entered_by"],
            "entered_at": item["row"]["entered_at"], **verdict,
        })
    rows.sort(key=lambda row: (row["actual_date"] or "", row["entered_at"] or ""), reverse=True)

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
