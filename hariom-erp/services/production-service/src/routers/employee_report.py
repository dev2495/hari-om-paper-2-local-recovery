"""Employee performance report (owner decision 7, 1 Nov 2026).

Per operator, for a date range and optionally a shift, stage and department: runs, made, good, rejected,
reject %, flagged QC readings, shifts worked, hours written on the card and the last activity, with a
drill-down to the runs. The operator is the one recorded on each floor entry: batch entries (V2 cards,
``continuous_stage_entries``) and the old one-form stages (V1 cards, the stage's entry snapshot). The
department comes from Masters › Employees.

Quantities stay in the stage's own unit (bamboos at Winding and Oven, pieces at Process), so a row is one
operator at one stage. Read only.
"""
from __future__ import annotations

import os
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Iterable, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..entry_models import StageEntry
from ..lifecycle_rules import canonical_shift, plant_today, stage_unit
from ..models import JobCard, JobCardStage
from ..utils.auth import get_current_plant_scope, require_role

router = APIRouter(prefix="/reports", tags=["reports"])
REPORT_ROLES = ["PlantManager", "Planner"]  # Owner / Admin pass as super roles
FLOOR_STAGES = ("SLITTING", "WINDER", "OVEN", "PROCESS", "PACKING")
STAGE_WORDS = {"SLITTING": "Slitting", "WINDER": "Winding", "OVEN": "Oven", "PROCESS": "Process", "PACKING": "Packing"}
MAX_DAYS = 400
MAX_RUNS = 20000


def _shift(value: Any) -> Optional[str]:
    try:
        return canonical_shift(value)
    except ValueError:
        return str(value or "").upper() or None


def _name_key(name: Any) -> str:
    return " ".join(str(name or "").split()).upper()


def operator_key(operator_id: Any, name: Any) -> str:
    """One operator across entries: the Masters › Employees id, else the name as written (old forms)."""
    return f"id:{operator_id}" if operator_id else f"name:{_name_key(name)}"


def _moment(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def card_hours(start: Any, end: Any) -> Optional[float]:
    """Hours between the card's start and end time when both were written and make sense (under 24 h)."""
    begin, finish = _moment(start), _moment(end)
    if not begin or not finish:
        return None
    hours = (finish - begin).total_seconds() / 3600
    return round(hours, 2) if 0 < hours <= 24 else None


def _flagged(entry: StageEntry) -> int:
    """Out-of-band QC readings on one entry: the flag kept at submit, else the failed results of its evaluation."""
    details = entry.details or {}
    flag = details.get("qc_flag") or {}
    if isinstance(flag, dict) and flag.get("count"):
        return int(flag.get("count") or 0)
    results = (entry.evaluation or {}).get("results") or []
    return sum(1 for row in results if isinstance(row, dict) and row.get("verdict") == "FAIL")


def _readings(entry: StageEntry) -> int:
    """QC readings on one entry: one per check and sample (its evaluation results), else the samples taken."""
    results = (entry.evaluation or {}).get("results")
    if isinstance(results, list) and results:
        return len(results)
    samples = entry.samples or []
    return len(samples) if isinstance(samples, list) else 0


def summarise(runs: Iterable[dict[str, Any]], employees: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Group runs by operator and stage. Pure (unit-tested): each run carries operator_key, operator_name,
    operator_code, stage, made, good, rejected, flagged_qc, qc_readings, date, shift, hours, at, kind."""
    groups: dict[tuple[str, str], dict[str, Any]] = {}
    shifts: dict[tuple[str, str], set] = defaultdict(set)
    days: dict[tuple[str, str], set] = defaultdict(set)
    for run in runs:
        key = (run["operator_key"], run["stage"])
        employee = employees.get(run["operator_key"]) or {}
        row = groups.setdefault(key, {
            "operator_key": run["operator_key"], "operator_id": run.get("operator_id"),
            "operator_name": employee.get("name") or run.get("operator_name") or "Not recorded",
            "operator_code": employee.get("employee_code") or run.get("operator_code"),
            "department": employee.get("department"), "stage": run["stage"], "stage_label": STAGE_WORDS.get(run["stage"], run["stage"].title()),
            "unit": stage_unit(run["stage"]), "runs": 0, "made": 0, "good": 0, "rejected": 0, "flagged_qc": 0, "qc_readings": 0,
            "hours": 0.0, "hours_runs": 0, "last_activity": None, "sources": set(),
        })
        if run.get("kind") == "PRODUCTION":
            row["runs"] += 1
            row["made"] += int(run.get("made") or 0)
            row["good"] += int(run.get("good") or 0)
            row["rejected"] += int(run.get("rejected") or 0)
            if run.get("hours") is not None:
                row["hours"] += float(run["hours"])
                row["hours_runs"] += 1
        row["flagged_qc"] += int(run.get("flagged_qc") or 0)
        row["qc_readings"] += int(run.get("qc_readings") or 0)
        row["sources"].add(run.get("source") or "BATCH")
        if run.get("date"):
            days[key].add(run["date"])
            shifts[key].add((run["date"], run.get("shift") or "?"))
        at = run.get("at") or run.get("date")
        if at and (row["last_activity"] is None or str(at) > str(row["last_activity"])):
            row["last_activity"] = str(at)
    out = []
    for key, row in groups.items():
        made = row["made"]
        row.update({
            "reject_pct": round(row["rejected"] * 100.0 / made, 1) if made else None,
            "shifts_worked": len(shifts[key]), "days_worked": len(days[key]),
            "hours": round(row["hours"], 1) if row["hours_runs"] else None,
            "sources": sorted(row["sources"]),
        })
        out.append(row)
    return sorted(out, key=lambda item: (item["operator_name"].upper(), FLOOR_STAGES.index(item["stage"]) if item["stage"] in FLOOR_STAGES else 99))


def _employees(user: dict, plant_scope: dict) -> tuple[dict[str, dict[str, Any]], bool]:
    """Masters › Employees by id and by name (best effort: the report still works without departments)."""
    url = os.getenv("MASTERDATA_SERVICE_URL", os.getenv("MASTER_DATA_SERVICE_URL", "http://127.0.0.1:18002"))
    headers = {"Authorization": f"Bearer {user.get('token', '')}"}
    plant = plant_scope.get("selected_plant_id")
    if plant:
        headers["X-Plant-ID"] = str(plant)
    try:
        response = httpx.get(f"{url}/master/employees/", params={"include_inactive": "true"}, headers=headers, timeout=6)
        response.raise_for_status()
        rows = response.json()
    except (httpx.HTTPError, ValueError):
        return {}, False
    found: dict[str, dict[str, Any]] = {}
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        if row.get("id"):
            found[operator_key(row["id"], None)] = row
        if row.get("name"):
            found.setdefault(operator_key(None, row["name"]), row)
    return found, True


def _scope(query, column, plant_scope: dict):
    from .planning import _apply_plant_scope_filter

    return _apply_plant_scope_filter(query, column, plant_scope)


def _customer(job: JobCard) -> Optional[str]:
    snapshot = job.spec_snapshot or {}
    return snapshot.get("customer_name_snapshot") or snapshot.get("customer_name")


def collect_runs(db: Session, plant_scope: dict, start: date, end: date, stages: list[str], shift: Optional[str]) -> list[dict[str, Any]]:
    """Every floor entry in the range with its operator: batch entries and old one-form stages."""
    runs: list[dict[str, Any]] = []
    query = (
        db.query(StageEntry, JobCard).join(JobCard, JobCard.id == StageEntry.job_card_id)
        .filter(StageEntry.status == "SUBMITTED", StageEntry.kind.in_(["PRODUCTION", "QC_ONLY"]), StageEntry.stage.in_(stages),
                StageEntry.business_date >= start, StageEntry.business_date <= end)
    )
    query = _scope(query, JobCard.plant_id, plant_scope)
    for entry, job in query.order_by(StageEntry.business_date.desc(), StageEntry.created_at.desc()).limit(MAX_RUNS).all():
        entry_shift = _shift(entry.shift_code)
        if shift and entry_shift != shift:
            continue
        details = entry.details or {}
        runs.append({
            "source": "BATCH", "kind": "PRODUCTION" if entry.kind == "PRODUCTION" else "QC",
            "operator_key": operator_key(entry.operator_id, entry.operator_name), "operator_id": str(entry.operator_id) if entry.operator_id else None,
            "operator_name": entry.operator_name, "operator_code": entry.operator_code,
            "stage": entry.stage, "made": entry.produced or 0, "good": entry.accepted or 0, "rejected": entry.rejected or 0,
            "flagged_qc": _flagged(entry), "qc_readings": _readings(entry),
            "date": entry.business_date.isoformat() if entry.business_date else None, "shift": entry_shift,
            "hours": card_hours(details.get("start_time"), details.get("end_time")) if entry.kind == "PRODUCTION" else None,
            "at": entry.created_at.isoformat() if entry.created_at else None,
            "job_card_id": str(job.id), "job_card_no": job.job_card_no, "customer": _customer(job),
            "run": f"Run #{entry.entry_no}" if entry.kind == "PRODUCTION" else f"QC readings #{entry.entry_no}",
            "machine_id": str(entry.machine_id) if entry.machine_id else None,
        })

    stage_query = (
        db.query(JobCardStage, JobCard).join(JobCard, JobCard.id == JobCardStage.job_card_id)
        .filter(JobCardStage.stage_type.in_(stages), JobCardStage.status.in_(["COMPLETED", "RUNNING"]))
    )
    stage_query = _scope(stage_query, JobCard.plant_id, plant_scope)
    for row, job in stage_query.all():
        if (job.spec_snapshot or {}).get("entry_model") == "V2":
            continue  # V2 cards are counted from their batch entries above
        snapshot = row.entry_snapshot or {}
        name = snapshot.get("operator_name")
        if not name and not snapshot.get("operator_id"):
            continue
        moment = row.actual_end or row.actual_start
        day = (moment + timedelta(hours=5, minutes=30)).date() if moment else None
        if not day or day < start or day > end:
            continue
        row_shift = _shift(snapshot.get("shift_code") or row.shift_code)
        if shift and row_shift != shift:
            continue
        output, scrap = int(row.output_qty or 0), int(row.scrap_qty or 0)
        runs.append({
            "source": "CARD_FORM", "kind": "PRODUCTION",
            "operator_key": operator_key(snapshot.get("operator_id"), name), "operator_id": snapshot.get("operator_id"),
            "operator_name": name, "operator_code": snapshot.get("operator_code"),
            "stage": row.stage_type, "made": output + scrap, "good": output, "rejected": scrap, "flagged_qc": 0, "qc_readings": 0,
            "date": day.isoformat(), "shift": row_shift, "hours": card_hours(snapshot.get("start_time"), snapshot.get("end_time")),
            "at": moment.isoformat() if moment else None,
            "job_card_id": str(job.id), "job_card_no": job.job_card_no, "customer": _customer(job), "run": "Card form",
            "machine_id": str(row.machine_id) if row.machine_id else None,
        })
    return runs


@router.get("/employees")
def employee_performance(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    shift: Optional[str] = Query(None, max_length=20),
    stage: Optional[str] = Query(None, max_length=20),
    department: Optional[str] = Query(None, max_length=80),
    operator: Optional[str] = Query(None, max_length=300, description="An operator_key from the rows: returns that operator's runs too"),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    user: dict = Depends(require_role(REPORT_ROLES)),
):
    end = date_to or plant_today()
    start = date_from or (end - timedelta(days=30))
    if start > end:
        raise HTTPException(status_code=422, detail="The From date is after the To date")
    if (end - start).days > MAX_DAYS:
        raise HTTPException(status_code=422, detail=f"Choose at most {MAX_DAYS} days")
    stage_code = str(stage or "").strip().upper() or None
    if stage_code and stage_code not in FLOOR_STAGES:
        raise HTTPException(status_code=422, detail="Choose Winding, Oven, Process, Packing or Slitting")
    shift_code = _shift(shift) if shift else None
    wanted_department = str(department or "").strip().upper() or None

    employees, master_ok = _employees(user, plant_scope)
    runs = collect_runs(db, plant_scope, start, end, [stage_code] if stage_code else list(FLOOR_STAGES), shift_code)
    for run in runs:
        employee = employees.get(run["operator_key"]) or employees.get(operator_key(None, run.get("operator_name"))) or {}
        if employee.get("id") and run["operator_key"].startswith("name:"):
            run["operator_key"] = operator_key(employee["id"], None)  # an old form's name matched to the master
        run["department"] = employee.get("department")
    if wanted_department:
        runs = [run for run in runs if str(run.get("department") or "").strip().upper() == wanted_department]
    rows = summarise(runs, employees)

    totals = {
        "operators": len({row["operator_key"] for row in rows}),
        "runs": sum(row["runs"] for row in rows),
        "flagged_qc": sum(row["flagged_qc"] for row in rows),
        "by_unit": {},
    }
    for row in rows:
        unit = totals["by_unit"].setdefault(row["unit"], {"made": 0, "good": 0, "rejected": 0})
        for key in ("made", "good", "rejected"):
            unit[key] += row[key]
    for unit in totals["by_unit"].values():
        unit["reject_pct"] = round(unit["rejected"] * 100.0 / unit["made"], 1) if unit["made"] else None

    departments = sorted({str(row.get("department") or "").strip().upper() for row in employees.values() if row.get("department")})
    drill = None
    if operator:
        drill = sorted((run for run in runs if run["operator_key"] == operator), key=lambda run: (run.get("date") or "", run.get("at") or ""), reverse=True)
    return {
        "date_from": start.isoformat(), "date_to": end.isoformat(),
        "filters": {"shift": shift_code, "stage": stage_code, "department": wanted_department, "operator": operator},
        "departments": departments, "employees_loaded": master_ok, "stage_labels": STAGE_WORDS,
        "totals": totals, "rows": rows, "runs": drill,
    }
