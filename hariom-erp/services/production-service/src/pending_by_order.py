"""Server-side job-card summaries grouped by sales order.

Replaces the planner tracker’s in-browser join over a capped job-card page.
This is the production overlay only: commercial pending demand lives in sales.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any, Callable, Iterable, Optional


def _stage(job: Any) -> str:
    return str(getattr(job, "current_stage", None) or "UNASSIGNED").upper()


def _status(job: Any) -> str:
    return str(getattr(job, "status", None) or "").upper()


def flow_status_for_order(
    *,
    blocked: int,
    dispatch_ready: int,
    job_count: int,
    completed_count: int,
    open_count: int,
) -> str:
    if blocked:
        return "Blocked"
    if job_count and completed_count == job_count and open_count == 0:
        return "Completed"
    if dispatch_ready:
        return "Dispatch ready"
    if job_count:
        return "In production"
    return "Commercial open"


def summarize_job_cards_by_sales_order(
    jobs: Iterable[Any],
    *,
    hold_counts: Optional[dict[Any, int]] = None,
    today: Optional[date] = None,
    due_date_of: Optional[Callable[[Any], Optional[date]]] = None,
    classify_due_risk: Optional[Callable[[Optional[date], Optional[date]], Optional[str]]] = None,
    is_open_status: Optional[Callable[[Any], bool]] = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    holds = hold_counts or {}
    grouped: dict[str, dict[str, Any]] = {}

    for job in jobs:
        order_id = str(getattr(job, "sales_order_id", "") or "")
        if not order_id:
            continue
        bucket = grouped.get(order_id)
        if bucket is None:
            bucket = {
                "sales_order_id": order_id,
                "job_count": 0,
                "open_job_count": 0,
                "completed_job_count": 0,
                "blocked_job_count": 0,
                "dispatch_ready_job_count": 0,
                "released_qty": 0.0,
                "stage_counts": defaultdict(int),
                "job_card_ids": [],
                "due_priority": 0,
                "due_overdue": 0,
                "earliest_due": None,
            }
            grouped[order_id] = bucket

        bucket["job_count"] += 1
        job_id = str(getattr(job, "id", "") or "")
        if job_id:
            bucket["job_card_ids"].append(job_id)
        bucket["released_qty"] = round(
            float(bucket["released_qty"]) + float(getattr(job, "planned_qty", 0) or 0),
            4,
        )
        stage = _stage(job)
        bucket["stage_counts"][stage] += 1
        completed = _status(job) == "COMPLETED"
        open_job = is_open_status(getattr(job, "status", None)) if is_open_status else not completed
        if completed:
            bucket["completed_job_count"] += 1
        if open_job:
            bucket["open_job_count"] += 1
        active_holds = int(holds.get(getattr(job, "id", None), 0) or holds.get(job_id, 0) or 0)
        if active_holds > 0 or stage == "QC":
            bucket["blocked_job_count"] += 1
        if stage == "DISPATCH" and open_job:
            bucket["dispatch_ready_job_count"] += 1

        due = due_date_of(job) if due_date_of else getattr(job, "due_date", None)
        if due and (bucket["earliest_due"] is None or due < bucket["earliest_due"]):
            bucket["earliest_due"] = due
        if classify_due_risk and open_job:
            risk = classify_due_risk(due, today)
            if risk == "PRIORITY":
                bucket["due_priority"] += 1
            elif risk == "OVERDUE":
                bucket["due_overdue"] += 1

    items = []
    blocked_orders = 0
    dispatch_ready_orders = 0
    in_production_orders = 0
    completed_orders = 0
    for bucket in grouped.values():
        flow = flow_status_for_order(
            blocked=int(bucket["blocked_job_count"]),
            dispatch_ready=int(bucket["dispatch_ready_job_count"]),
            job_count=int(bucket["job_count"]),
            completed_count=int(bucket["completed_job_count"]),
            open_count=int(bucket["open_job_count"]),
        )
        if flow == "Blocked":
            blocked_orders += 1
        elif flow == "Dispatch ready":
            dispatch_ready_orders += 1
        elif flow == "In production":
            in_production_orders += 1
        elif flow == "Completed":
            completed_orders += 1
        items.append(
            {
                "sales_order_id": bucket["sales_order_id"],
                "job_count": bucket["job_count"],
                "open_job_count": bucket["open_job_count"],
                "completed_job_count": bucket["completed_job_count"],
                "blocked_job_count": bucket["blocked_job_count"],
                "dispatch_ready_job_count": bucket["dispatch_ready_job_count"],
                "released_qty": round(float(bucket["released_qty"]), 2),
                "stage_counts": dict(bucket["stage_counts"]),
                "job_card_ids": bucket["job_card_ids"],
                "due_priority": bucket["due_priority"],
                "due_overdue": bucket["due_overdue"],
                "earliest_due": bucket["earliest_due"].isoformat() if bucket["earliest_due"] else None,
                "flow_status": flow,
            }
        )

    items.sort(key=lambda row: row["sales_order_id"])
    summary = {
        "order_count": len(items),
        "blocked_order_count": blocked_orders,
        "dispatch_ready_order_count": dispatch_ready_orders,
        "in_production_order_count": in_production_orders,
        "completed_order_count": completed_orders,
        "job_count": sum(int(row["job_count"]) for row in items),
    }
    return items, summary
