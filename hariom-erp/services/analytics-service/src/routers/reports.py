from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from io import BytesIO
from statistics import mean
from typing import Any, Optional

import os
import requests
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, StreamingResponse

from src.config import AUTH_SERVICE_URL, INVENTORY_SERVICE_URL, MASTER_DATA_SERVICE_URL, PRODUCTION_SERVICE_URL, SALES_SERVICE_URL
from src.dependencies import get_plant_scope, get_token
from src.report_exports import (
    emit_delivery_notification,
    get_owner_recipients,
    persist_owner_pack_pdf,
    render_owner_pack_html,
    render_owner_pack_pdf,
    send_owner_pack_email,
)
from src.utils import scope_plant_ids, service_get

router = APIRouter(prefix="/reports", tags=["Reports"])
INTERNAL_EVENT_TOKEN = os.getenv("INTERNAL_EVENT_TOKEN", "hariom-internal-events")
DAILY_REPORT_EMAIL = os.getenv("DAILY_REPORT_EMAIL", os.getenv("BOOTSTRAP_OWNER_EMAIL", "owner@hariom.com"))
DAILY_REPORT_PASSWORD = os.getenv("DAILY_REPORT_PASSWORD", os.getenv("BOOTSTRAP_OWNER_PASSWORD", "owner123"))


def _parse_dt(value: Any) -> Optional[datetime]:
    if value in (None, ""):
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _parse_day(value: Optional[str], fallback: date) -> date:
    if not value:
        return fallback
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return fallback


def _normalize_granularity(value: Optional[str]) -> str:
    normalized = str(value or "day").strip().lower()
    return normalized if normalized in {"day", "week", "month"} else "day"


def _available_range(snapshot: dict[str, Any], fallback_start: date, fallback_end: date) -> dict[str, str]:
    dates: list[date] = []
    for order in snapshot.get("orders") or []:
        created = _parse_dt(order.get("created_at"))
        if created:
            dates.append(created.date())
        due_date = _resolve_due_date(order)
        if due_date:
            dates.append(due_date)
        for event in order.get("_timeline_events") or []:
            event_dt = _parse_dt(event.get("timestamp"))
            if event_dt:
                dates.append(event_dt.date())

    for card in snapshot.get("job_cards") or []:
        try:
            if card.get("date"):
                dates.append(date.fromisoformat(str(card.get("date"))))
        except ValueError:
            pass
        for stage in card.get("stages") or []:
            stage_dt = _parse_dt(stage.get("actual_end")) or _parse_dt(stage.get("entered_at"))
            if stage_dt:
                dates.append(stage_dt.date())

    for inspection in snapshot.get("quality_inspections") or []:
        inspection_dt = _parse_dt(inspection.get("created_at"))
        if inspection_dt:
            dates.append(inspection_dt.date())

    for hold in snapshot.get("quality_holds") or []:
        hold_dt = _parse_dt(hold.get("created_at")) or _parse_dt(hold.get("updated_at"))
        if hold_dt:
            dates.append(hold_dt.date())

    if not dates:
        return {
            "start_date": fallback_start.isoformat(),
            "end_date": fallback_end.isoformat(),
        }
    return {
        "start_date": min(dates).isoformat(),
        "end_date": max(dates).isoformat(),
    }


def _bucket_key(day_value: date, granularity: str) -> str:
    if granularity == "week":
        week_start = day_value - timedelta(days=day_value.weekday())
        return week_start.isoformat()
    if granularity == "month":
        return f"{day_value.year:04d}-{day_value.month:02d}"
    return day_value.isoformat()


def _iter_bucket_labels(start_day: date, end_day: date, granularity: str) -> list[str]:
    labels: list[str] = []
    current = start_day
    seen: set[str] = set()
    while current <= end_day:
        label = _bucket_key(current, granularity)
        if label not in seen:
            labels.append(label)
            seen.add(label)
        if granularity == "month":
            current = (current.replace(day=1) + timedelta(days=32)).replace(day=1)
        else:
            current += timedelta(days=1)
    return labels


def _empty_series(start_day: date, end_day: date, granularity: str) -> dict[str, dict[str, Any]]:
    return {label: {"bucket": label} for label in _iter_bucket_labels(start_day, end_day, granularity)}


def _in_window(day_value: Optional[date], start_day: date, end_day: date) -> bool:
    if day_value is None:
        return False
    return start_day <= day_value <= end_day


def _resolve_due_date(order: dict[str, Any]) -> Optional[date]:
    values: list[date] = []
    for line in order.get("lines") or []:
        try:
            values.append(date.fromisoformat(str(line.get("due_date"))))
        except Exception:
            continue
    return min(values) if values else None


def _resolve_dispatch_events(order_id: str, token: str, plant_id: str) -> list[dict[str, Any]]:
    try:
        timeline = service_get(
            f"{SALES_SERVICE_URL}/sales-orders/{order_id}/timeline",
            token,
            params={"depth": "summary"},
            plant_id=plant_id,
        ) or {}
    except Exception:
        return []
    return list(timeline.get("events") or [])


def _load_scope_snapshot(token: str, plant_scope: dict) -> dict[str, Any]:
    plant_ids = scope_plant_ids(plant_scope)
    plants_payload = service_get(f"{AUTH_SERVICE_URL}/plants", token) or []
    plants = [plant for plant in plants_payload if not plant_ids or str(plant.get("id")) in plant_ids]
    plants_by_id = {str(plant.get("id")): plant for plant in plants}

    job_cards: list[dict[str, Any]] = []
    orders: list[dict[str, Any]] = []
    machines: list[dict[str, Any]] = []
    balances: list[dict[str, Any]] = []
    valuation_summaries: dict[str, dict[str, Any]] = {}
    quality_inspections: list[dict[str, Any]] = []
    quality_holds: list[dict[str, Any]] = []
    ready_jobs: list[dict[str, Any]] = []
    inventory_health: dict[str, dict[str, Any]] = {}

    for plant_id in plant_ids:
        card_summaries = service_get(
            f"{PRODUCTION_SERVICE_URL}/job-cards",
            token,
            params={"limit": 500},
            plant_id=plant_id,
        ) or []
        for summary in card_summaries:
            card_id = summary.get("id")
            if not card_id:
                continue
            detail = service_get(f"{PRODUCTION_SERVICE_URL}/job-cards/{card_id}", token, plant_id=plant_id)
            detail["plant_id"] = plant_id
            job_cards.append(detail)

        plant_orders = service_get(f"{SALES_SERVICE_URL}/sales-orders", token, plant_id=plant_id) or []
        for order in plant_orders:
            order["plant_id"] = plant_id
            order["_timeline_events"] = _resolve_dispatch_events(str(order.get("id")), token, plant_id)
            orders.append(order)

        balances_payload = service_get(f"{INVENTORY_SERVICE_URL}/all-balances", token, plant_id=plant_id) or {}
        balances.extend([{**row, "plant_id": plant_id} for row in balances_payload.get("items", [])])

        valuation_summaries[plant_id] = service_get(f"{INVENTORY_SERVICE_URL}/inventory/valuation/summary", token, plant_id=plant_id) or {}
        inventory_health[plant_id] = {
            "summary": service_get(f"{INVENTORY_SERVICE_URL}/inventory/health/summary", token, plant_id=plant_id) or {},
            "aging": service_get(f"{INVENTORY_SERVICE_URL}/inventory/health/aging", token, plant_id=plant_id) or {},
            "status": service_get(f"{INVENTORY_SERVICE_URL}/inventory/health/status-summary", token, plant_id=plant_id) or {},
            "locations": service_get(f"{INVENTORY_SERVICE_URL}/inventory/health/location-occupancy", token, plant_id=plant_id) or {},
            "genealogy": service_get(f"{INVENTORY_SERVICE_URL}/inventory/health/genealogy-exceptions", token, plant_id=plant_id) or {},
        }

        quality_inspections.extend(
            [{**row, "plant_id": plant_id} for row in (service_get(f"{PRODUCTION_SERVICE_URL}/quality/inspections", token, plant_id=plant_id) or [])]
        )
        quality_holds.extend(
            [{**row, "plant_id": plant_id} for row in (service_get(f"{PRODUCTION_SERVICE_URL}/quality/holds", token, plant_id=plant_id) or [])]
        )
        ready_jobs.extend(
            [{**row, "plant_id": plant_id} for row in (service_get(f"{PRODUCTION_SERVICE_URL}/dispatch/ready-jobs/", token, plant_id=plant_id) or [])]
        )
        machines.extend(
            [{**row, "plant_id": plant_id} for row in (service_get(f"{MASTER_DATA_SERVICE_URL}/master/machines/", token, plant_id=plant_id) or [])]
        )

    return {
        "plants": plants,
        "plants_by_id": plants_by_id,
        "job_cards": job_cards,
        "orders": orders,
        "machines": machines,
        "balances": balances,
        "valuation_summaries": valuation_summaries,
        "quality_inspections": quality_inspections,
        "quality_holds": quality_holds,
        "ready_jobs": ready_jobs,
        "inventory_health": inventory_health,
    }


def _compute_order_state(order: dict[str, Any], start_day: date, end_day: date) -> dict[str, Any]:
    due_date = _resolve_due_date(order)
    dispatch_events = [event for event in order.get("_timeline_events") or [] if str(event.get("event_type")).upper() == "SO_LINE_DISPATCH_RECORDED"]
    dispatch_dates = [(_parse_dt(event.get("timestamp")) or datetime.min).date() for event in dispatch_events if _parse_dt(event.get("timestamp"))]
    final_dispatch = max(dispatch_dates) if dispatch_dates else None
    created_at = (_parse_dt(order.get("created_at")) or datetime.min).date()
    closed = str(order.get("status") or "").lower() == "closed"
    on_time = bool(closed and due_date and final_dispatch and final_dispatch <= due_date)
    delayed_open = bool(
        due_date
        and due_date < end_day
        and str(order.get("status") or "").lower() in {"approved", "partially_released", "released", "partially_dispatched"}
    )
    return {
        "due_date": due_date,
        "created_at": created_at,
        "final_dispatch": final_dispatch,
        "closed": closed,
        "on_time": on_time,
        "delayed_open": delayed_open,
    }


def _build_order_series(snapshot: dict[str, Any], start_day: date, end_day: date, granularity: str) -> list[dict[str, Any]]:
    series = _empty_series(start_day, end_day, granularity)
    for order in snapshot["orders"]:
        state = _compute_order_state(order, start_day, end_day)
        created_bucket_key = _bucket_key(state["created_at"], granularity) if state["created_at"] else None
        created_bucket = series.get(created_bucket_key) if created_bucket_key else None
        if created_bucket and _in_window(state["created_at"], start_day, end_day):
            created_bucket["orders_created"] = created_bucket.get("orders_created", 0) + 1
        if created_bucket and str(order.get("status") or "").lower() in {"partially_released", "released", "partially_dispatched", "closed"}:
            created_bucket["released_or_better"] = created_bucket.get("released_or_better", 0) + 1
        if state["closed"] and state["final_dispatch"] and _in_window(state["final_dispatch"], start_day, end_day):
            series[_bucket_key(state["final_dispatch"], granularity)]["orders_closed"] = series[_bucket_key(state["final_dispatch"], granularity)].get("orders_closed", 0) + 1
        for event in order.get("_timeline_events") or []:
            if str(event.get("event_type") or "").upper() != "SO_LINE_DISPATCH_RECORDED":
                continue
            event_dt = _parse_dt(event.get("timestamp"))
            if not event_dt or not _in_window(event_dt.date(), start_day, end_day):
                continue
            bucket = series[_bucket_key(event_dt.date(), granularity)]
            bucket["dispatch_qty"] = round(float(bucket.get("dispatch_qty") or 0.0) + float((event.get("payload") or {}).get("qty") or 0.0), 2)
    return list(series.values())


def _build_stage_series(snapshot: dict[str, Any], start_day: date, end_day: date, granularity: str) -> list[dict[str, Any]]:
    series = _empty_series(start_day, end_day, granularity)
    for card in snapshot["job_cards"]:
        for stage in card.get("stages") or []:
            stage_type = str(stage.get("stage_type") or "").upper()
            stage_dt = (_parse_dt(stage.get("actual_end")) or _parse_dt(stage.get("entered_at")))
            if stage_type not in {"WINDER", "OVEN", "PROCESS", "PACKING", "QC", "DISPATCH"} or not stage_dt:
                continue
            if not _in_window(stage_dt.date(), start_day, end_day):
                continue
            bucket = series[_bucket_key(stage_dt.date(), granularity)]
            key = f"{stage_type.lower()}_qty"
            bucket[key] = round(float(bucket.get(key) or 0.0) + float(stage.get("output_qty") or 0.0), 2)
            if stage.get("machine_id"):
                bucket["machine_touches"] = int(bucket.get("machine_touches") or 0) + 1
    return list(series.values())


def _machine_utilization(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    machine_index = {str(machine.get("id")): machine for machine in snapshot["machines"]}
    usage: dict[str, dict[str, Any]] = {}
    for card in snapshot["job_cards"]:
        for stage in card.get("stages") or []:
            machine_id = str(stage.get("machine_id") or "")
            if not machine_id:
                continue
            machine = machine_index.get(machine_id, {})
            required = float(stage.get("required_capacity") or 0.0)
            bucket = usage.setdefault(
                machine_id,
                {
                    "machine_id": machine_id,
                    "machine_code": machine.get("code") or machine_id[:8],
                    "machine_name": machine.get("name") or machine_id[:8],
                    "plant_id": machine.get("plant_id"),
                    "department": machine.get("department"),
                    "capacity_value": float(machine.get("capacity_value") or 0.0),
                    "assigned_load": 0.0,
                    "jobs": 0,
                },
            )
            bucket["assigned_load"] += required
            bucket["jobs"] += 1

    rows = list(usage.values())
    for row in rows:
        capacity = float(row.get("capacity_value") or 0.0)
        row["utilization_percent"] = round((row["assigned_load"] / capacity * 100.0), 2) if capacity > 0 else 0.0
        row["assigned_load"] = round(float(row["assigned_load"]), 2)
    rows.sort(key=lambda row: (row["utilization_percent"], row["assigned_load"]), reverse=True)
    return rows[:12]


def _blocked_jobs(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    active_holds = {str(hold.get("job_card_id")) for hold in snapshot["quality_holds"] if str(hold.get("status") or "").upper() == "HOLD"}
    rows: list[dict[str, Any]] = []
    for card in snapshot["job_cards"]:
        status = str(card.get("status") or "").upper()
        if status in {"COMPLETED", "CANCELLED"}:
            continue
        current_stage = str(card.get("current_stage") or "WINDER").upper()
        current_row = next((stage for stage in card.get("stages") or [] if str(stage.get("stage_type") or "").upper() == current_stage), None)
        is_blocked = str(card.get("id")) in active_holds or str((current_row or {}).get("status") or "").upper() in {"PLANNED", "ASSIGNED"}
        if not is_blocked:
            continue
        rows.append(
            {
                "job_card_id": str(card.get("id")),
                "job_card_no": str(card.get("job_card_no") or card.get("id", ""))[:12],
                "customer_name": card.get("customer_name") or "-",
                "current_stage": current_stage,
                "status": (current_row or {}).get("status") or card.get("status"),
                "planned_qty": float(card.get("planned_qty") or 0.0),
                "plant_id": card.get("plant_id"),
            }
        )
    return rows[:20]


def _inventory_health_report(snapshot: dict[str, Any]) -> dict[str, Any]:
    low_stock_items: list[dict[str, Any]] = []
    overstock_items: list[dict[str, Any]] = []
    total_available = 0.0

    for row in snapshot["balances"]:
        available = float(row.get("available_qty") or 0.0)
        total_available += available
        if available <= 50:
            low_stock_items.append(
                {
                    "id": str(row.get("item_id")),
                    "item_code": row.get("item_code"),
                    "name": row.get("name"),
                    "available_qty": round(available, 2),
                    "type": row.get("type"),
                    "plant_id": row.get("plant_id"),
                }
            )
        if available >= 500:
            overstock_items.append(
                {
                    "id": str(row.get("item_id")),
                    "item_code": row.get("item_code"),
                    "name": row.get("name"),
                    "available_qty": round(available, 2),
                    "type": row.get("type"),
                    "plant_id": row.get("plant_id"),
                }
            )

    status_mix = []
    aging_buckets = []
    location_rows = []
    genealogy_rows = []
    blocked_qty = 0.0
    qc_hold_qty = 0.0
    dispatch_ready_job_count = len(snapshot["ready_jobs"])
    total_locations = 0
    occupied_locations = 0
    total_value = 0.0
    rm_value = 0.0
    wip_value = 0.0
    fg_value = 0.0

    for plant_id, health in snapshot["inventory_health"].items():
        summary = health.get("summary") or {}
        blocked_qty += float(summary.get("blocked_qty") or 0.0)
        qc_hold_qty += float(summary.get("qc_hold_qty") or 0.0)
        total_locations += int(summary.get("total_locations") or 0)
        occupied_locations += int(summary.get("occupied_locations") or 0)
        status_mix.extend([{**row, "plant_id": plant_id} for row in (health.get("status") or {}).get("rows", [])])
        aging_buckets.extend([{**row, "plant_id": plant_id} for row in (health.get("aging") or {}).get("buckets", [])])
        location_rows.extend([{**row, "plant_id": plant_id} for row in (health.get("locations") or {}).get("rows", [])])
        genealogy_rows.extend([{**row, "plant_id": plant_id} for row in (health.get("genealogy") or {}).get("rows", [])])

        valuation = snapshot["valuation_summaries"].get(plant_id) or {}
        rm_value += float(valuation.get("rm_value") or 0.0)
        wip_value += float(valuation.get("wip_value") or 0.0)
        fg_value += float(valuation.get("fg_value") or 0.0)
        total_value += float(valuation.get("total_value") or 0.0)

    low_stock_items.sort(key=lambda row: (row["available_qty"], row["name"]))
    overstock_items.sort(key=lambda row: row["available_qty"], reverse=True)
    location_rows.sort(key=lambda row: (row.get("warehouse") or "", row.get("code") or ""))

    return {
        "summary": {
            "total_value": round(total_value, 2),
            "rm_value": round(rm_value, 2),
            "wip_value": round(wip_value, 2),
            "fg_value": round(fg_value, 2),
            "total_available_qty": round(total_available, 2),
            "low_stock_count": len(low_stock_items),
            "overstock_count": len(overstock_items),
            "blocked_qty": round(blocked_qty, 2),
            "qc_hold_qty": round(qc_hold_qty, 2),
            "dispatch_ready_job_count": dispatch_ready_job_count,
            "occupied_locations": occupied_locations,
            "total_locations": total_locations,
        },
        "status_mix": status_mix,
        "aging_buckets": aging_buckets,
        "locations": location_rows[:24],
        "genealogy_exceptions": genealogy_rows[:16],
        "risk_items": {
            "low_stock": low_stock_items[:20],
            "overstock": overstock_items[:20],
        },
    }


def _quality_report(snapshot: dict[str, Any], start_day: date, end_day: date, granularity: str) -> dict[str, Any]:
    series = _empty_series(start_day, end_day, granularity)
    fail_by_stage: dict[str, int] = defaultdict(int)
    active_holds = [hold for hold in snapshot["quality_holds"] if str(hold.get("status") or "").upper() == "HOLD"]

    total = 0
    passed = 0
    failed = 0
    for inspection in snapshot["quality_inspections"]:
        inspection_dt = _parse_dt(inspection.get("created_at"))
        if not inspection_dt or not _in_window(inspection_dt.date(), start_day, end_day):
            continue
        total += 1
        bucket = series[_bucket_key(inspection_dt.date(), granularity)]
        bucket["checked"] = int(bucket.get("checked") or 0) + 1
        if str(inspection.get("status") or "").upper() == "PASS":
            passed += 1
            bucket["passed"] = int(bucket.get("passed") or 0) + 1
        else:
            failed += 1
            bucket["failed"] = int(bucket.get("failed") or 0) + 1
            fail_by_stage[str(inspection.get("stage_type") or "UNKNOWN").upper()] += 1

    return {
        "summary": {
            "checked": total,
            "passed": passed,
            "failed": failed,
            "compliance_percent": round((passed / total * 100.0), 2) if total else 0.0,
            "active_holds": len(active_holds),
        },
        "series": list(series.values()),
        "hold_rows": active_holds[:20],
        "fail_by_stage": [{"stage_type": stage, "count": count} for stage, count in sorted(fail_by_stage.items(), key=lambda item: item[1], reverse=True)],
    }


def _dispatch_report(snapshot: dict[str, Any], start_day: date, end_day: date, granularity: str) -> dict[str, Any]:
    order_series = _build_order_series(snapshot, start_day, end_day, granularity)
    ready_jobs = snapshot["ready_jobs"]
    dispatch_qty = sum(float(row.get("dispatch_qty") or 0.0) for row in order_series)
    closed_rows = [order for order in snapshot["orders"] if str(order.get("status") or "").lower() == "closed"]
    return {
        "summary": {
            "dispatch_qty": round(dispatch_qty, 2),
            "ready_job_count": len(ready_jobs),
            "closed_orders": len(closed_rows),
            "sealed_dispatches": len([row for row in ready_jobs if str(row.get("dispatch_status") or "").upper() == "SEALED"]),
        },
        "series": order_series,
        "ready_jobs": ready_jobs[:20],
    }


def _sales_report(snapshot: dict[str, Any], start_day: date, end_day: date, granularity: str) -> dict[str, Any]:
    series = _build_order_series(snapshot, start_day, end_day, granularity)
    delayed_orders: list[dict[str, Any]] = []
    lead_times: list[float] = []
    on_time_count = 0
    closed_count = 0
    release_backlog = 0

    for order in snapshot["orders"]:
        state = _compute_order_state(order, start_day, end_day)
        if state["closed"]:
            closed_count += 1
            if state["on_time"]:
                on_time_count += 1
            if state["final_dispatch"] and state["created_at"]:
                lead_times.append((state["final_dispatch"] - state["created_at"]).days)
        if state["delayed_open"]:
            delayed_orders.append(
                {
                    "order_id": str(order.get("id")),
                    "order_no": order.get("order_no"),
                    "customer_name": order.get("customer_name") or "-",
                    "due_date": state["due_date"].isoformat() if state["due_date"] else None,
                    "status": order.get("status"),
                    "plant_id": order.get("plant_id"),
                }
            )
        if str(order.get("status") or "").lower() in {"partially_released", "released", "partially_dispatched"}:
            release_backlog += 1

    delayed_orders.sort(key=lambda row: row["due_date"] or "")
    return {
        "summary": {
            "backlog_orders": release_backlog,
            "closed_orders": closed_count,
            "otif_percent": round((on_time_count / closed_count * 100.0), 2) if closed_count else 0.0,
            "release_to_dispatch_days": round(mean(lead_times), 2) if lead_times else 0.0,
            "delayed_orders": len(delayed_orders),
        },
        "series": series,
        "delayed_rows": delayed_orders[:20],
    }


def _production_report(snapshot: dict[str, Any], start_day: date, end_day: date, granularity: str) -> dict[str, Any]:
    stage_series = _build_stage_series(snapshot, start_day, end_day, granularity)
    machine_utilization = _machine_utilization(snapshot)
    blocked_jobs = _blocked_jobs(snapshot)
    active_cards = [card for card in snapshot["job_cards"] if str(card.get("status") or "").upper() not in {"COMPLETED", "CANCELLED"}]

    adherence_samples: list[float] = []
    stage_pipeline: dict[str, int] = defaultdict(int)
    for card in active_cards:
        stage_pipeline[str(card.get("current_stage") or "WINDER").upper()] += 1
    for card in snapshot["job_cards"]:
        for stage in card.get("stages") or []:
            plan_date = stage.get("plan_date")
            actual = _parse_dt(stage.get("actual_end")) or _parse_dt(stage.get("entered_at"))
            if not plan_date or not actual:
                continue
            try:
                planned_day = date.fromisoformat(str(plan_date))
            except ValueError:
                continue
            adherence_samples.append(100.0 if planned_day == actual.date() else 0.0)

    return {
        "summary": {
            "active_job_cards": len(active_cards),
            "blocked_jobs": len(blocked_jobs),
            "schedule_adherence_percent": round(mean(adherence_samples), 2) if adherence_samples else 0.0,
            "avg_machine_utilization_percent": round(mean([float(row.get("utilization_percent") or 0.0) for row in machine_utilization]), 2) if machine_utilization else 0.0,
        },
        "series": stage_series,
        "machine_utilization": machine_utilization,
        "stage_pipeline": [{"stage_type": key, "count": value} for key, value in sorted(stage_pipeline.items())],
        "blocked_rows": blocked_jobs,
    }


def _plant_compare(snapshot: dict[str, Any], inventory_report: dict[str, Any], sales_report: dict[str, Any]) -> list[dict[str, Any]]:
    delayed_by_plant: dict[str, int] = defaultdict(int)
    for row in sales_report["delayed_rows"]:
        delayed_by_plant[str(row.get("plant_id"))] += 1

    cards_by_plant: dict[str, int] = defaultdict(int)
    for card in snapshot["job_cards"]:
        cards_by_plant[str(card.get("plant_id"))] += 1

    ready_jobs_by_plant: dict[str, int] = defaultdict(int)
    for row in snapshot["ready_jobs"]:
        ready_jobs_by_plant[str(row.get("plant_id"))] += 1

    rows = []
    for plant in snapshot["plants"]:
        plant_id = str(plant.get("id"))
        valuation = snapshot["valuation_summaries"].get(plant_id) or {}
        health_summary = (snapshot["inventory_health"].get(plant_id) or {}).get("summary") or {}
        rows.append(
            {
                "plant_id": plant_id,
                "plant_code": plant.get("code") or plant_id[-4:],
                "plant_name": plant.get("name") or plant_id,
                "job_cards": cards_by_plant.get(plant_id, 0),
                "inventory_value": round(float(valuation.get("total_value") or 0.0), 2),
                "blocked_qty": round(float(health_summary.get("blocked_qty") or 0.0), 2),
                "ready_job_count": ready_jobs_by_plant.get(plant_id, 0),
                "delayed_orders": delayed_by_plant.get(plant_id, 0),
            }
        )
    rows.sort(key=lambda row: row["plant_code"])
    return rows


def _exception_report(snapshot: dict[str, Any], sales_report: dict[str, Any], inventory_report: dict[str, Any], production_report: dict[str, Any]) -> dict[str, Any]:
    return {
        "summary": {
            "delayed_orders": len(sales_report["delayed_rows"]),
            "low_stock_items": len(inventory_report["risk_items"]["low_stock"]),
            "overstock_items": len(inventory_report["risk_items"]["overstock"]),
            "blocked_jobs": len(production_report["blocked_rows"]),
            "active_qc_holds": len([row for row in snapshot["quality_holds"] if str(row.get("status") or "").upper() == "HOLD"]),
        },
        "delayed_orders": sales_report["delayed_rows"],
        "low_stock": inventory_report["risk_items"]["low_stock"],
        "overstock": inventory_report["risk_items"]["overstock"],
        "blocked_jobs": production_report["blocked_rows"],
        "active_holds": [row for row in snapshot["quality_holds"] if str(row.get("status") or "").upper() == "HOLD"][:20],
    }


def _build_reports(token: str, plant_scope: dict, start_date: Optional[str], end_date: Optional[str], granularity: Optional[str]) -> dict[str, Any]:
    end_day = _parse_day(end_date, date.today())
    start_day = _parse_day(start_date, end_day - timedelta(days=29))
    if start_day > end_day:
        start_day, end_day = end_day, start_day
    resolved_granularity = _normalize_granularity(granularity)

    snapshot = _load_scope_snapshot(token, plant_scope)
    available_range = _available_range(snapshot, start_day, end_day)
    inventory_report = _inventory_health_report(snapshot)
    sales_report = _sales_report(snapshot, start_day, end_day, resolved_granularity)
    production_report = _production_report(snapshot, start_day, end_day, resolved_granularity)
    quality_report = _quality_report(snapshot, start_day, end_day, resolved_granularity)
    dispatch_report = _dispatch_report(snapshot, start_day, end_day, resolved_granularity)
    plant_compare = _plant_compare(snapshot, inventory_report, sales_report)
    exceptions = _exception_report(snapshot, sales_report, inventory_report, production_report)

    active_cards = production_report["summary"]["active_job_cards"]
    backlog_orders = sales_report["summary"]["backlog_orders"]

    owner_pack = {
        "filters": {
            "start_date": start_day.isoformat(),
            "end_date": end_day.isoformat(),
            "granularity": resolved_granularity,
            "plant_scope": "ALL" if plant_scope.get("scope_all") else plant_scope.get("selected_plant_id"),
        },
        "available_range": available_range,
        "headline": {
            "active_job_cards": active_cards,
            "backlog_orders": backlog_orders,
            "dispatch_qty": dispatch_report["summary"]["dispatch_qty"],
            "inventory_value": inventory_report["summary"]["total_value"],
            "otif_percent": sales_report["summary"]["otif_percent"],
            "blocked_jobs": production_report["summary"]["blocked_jobs"],
            "low_stock_items": inventory_report["summary"]["low_stock_count"],
            "active_qc_holds": exceptions["summary"]["active_qc_holds"],
        },
        "production": production_report,
        "sales": sales_report,
        "quality": quality_report,
        "dispatch": dispatch_report,
        "inventory": inventory_report,
        "plant_compare": plant_compare,
        "exceptions": exceptions,
    }

    for report in (production_report, sales_report, quality_report, dispatch_report, inventory_report, exceptions):
        report["filters"] = {
            "start_date": start_day.isoformat(),
            "end_date": end_day.isoformat(),
            "granularity": resolved_granularity,
            "plant_scope": "ALL" if plant_scope.get("scope_all") else plant_scope.get("selected_plant_id"),
        }
        report["available_range"] = available_range

    return {
        "owner_pack": owner_pack,
        "production": production_report,
        "sales": sales_report,
        "quality": quality_report,
        "dispatch": dispatch_report,
        "inventory": inventory_report,
        "plant_compare": plant_compare,
        "exceptions": exceptions,
    }


def _resolve_daily_owner_token() -> tuple[str, dict[str, Any]]:
    response = requests.post(
        f"{AUTH_SERVICE_URL}/auth/login",
        data={"username": DAILY_REPORT_EMAIL, "password": DAILY_REPORT_PASSWORD},
        timeout=15.0,
    )
    if response.status_code != 200:
        raise RuntimeError("Unable to authenticate daily owner-pack sender")
    payload = response.json() or {}
    token = payload.get("access_token")
    user = payload.get("user") or {}
    if not token:
        raise RuntimeError("Daily owner-pack login returned no access token")
    return token, user


def build_daily_owner_pack(*, report_date: date | None = None) -> dict[str, Any]:
    report_date = report_date or date.today()
    token, user = _resolve_daily_owner_token()
    allowed_plants = [str(value) for value in (user.get("allowed_plant_ids") or user.get("allowed_plants") or []) if value]
    plant_scope = {
        "scope_all": True,
        "selected_plant_id": None,
        "allowed_plants": allowed_plants,
    }
    return _build_reports(
        token,
        plant_scope,
        report_date.isoformat(),
        report_date.isoformat(),
        "day",
    )["owner_pack"]


def _require_internal_token(request: Request) -> None:
    if request.headers.get("x-internal-token") != INTERNAL_EVENT_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid internal report token")


@router.get("/owner-pack")
def owner_pack_report(
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    granularity: Optional[str] = Query(default="day"),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    return _build_reports(token, plant_scope, start_date, end_date, granularity)["owner_pack"]


@router.get("/owner-pack/html", response_class=HTMLResponse)
def owner_pack_report_html(
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    granularity: Optional[str] = Query(default="day"),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    report = _build_reports(token, plant_scope, start_date, end_date, granularity)["owner_pack"]
    return HTMLResponse(render_owner_pack_html(report))


@router.get("/owner-pack/pdf")
def owner_pack_report_pdf(
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    granularity: Optional[str] = Query(default="day"),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    report = _build_reports(token, plant_scope, start_date, end_date, granularity)["owner_pack"]
    pdf_bytes = render_owner_pack_pdf(report)
    filename = f"hariom-owner-pack-{report['filters']['end_date']}.pdf"
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/owner-pack/send-daily")
def send_daily_owner_pack(request: Request, report_date: Optional[str] = Query(default=None)):
    _require_internal_token(request)
    resolved_date = _parse_day(report_date, date.today())
    report = build_daily_owner_pack(report_date=resolved_date)
    html = render_owner_pack_html(report, report_date=resolved_date)
    pdf_bytes = render_owner_pack_pdf(report, report_date=resolved_date)
    recipients = [row["email"] for row in get_owner_recipients() if row.get("email")]
    if not recipients:
        raise HTTPException(status_code=400, detail="No active Owner recipients configured")
    persist_owner_pack_pdf(pdf_bytes, resolved_date)
    try:
        send_owner_pack_email(report_date=resolved_date, pdf_bytes=pdf_bytes, html=html, recipients=recipients)
        emit_delivery_notification(
            success=True,
            report_date=resolved_date,
            detail=f"Daily owner close pack sent to {len(recipients)} owner recipients.",
        )
    except Exception as exc:
        emit_delivery_notification(
            success=False,
            report_date=resolved_date,
            detail=f"Daily owner close pack failed: {exc}",
        )
        raise
    return {
        "status": "sent",
        "report_date": resolved_date.isoformat(),
        "recipients": recipients,
    }


@router.get("/production")
def production_report(
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    granularity: Optional[str] = Query(default="day"),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    return _build_reports(token, plant_scope, start_date, end_date, granularity)["production"]


@router.get("/sales")
def sales_report(
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    granularity: Optional[str] = Query(default="day"),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    return _build_reports(token, plant_scope, start_date, end_date, granularity)["sales"]


@router.get("/quality")
def quality_report(
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    granularity: Optional[str] = Query(default="day"),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    return _build_reports(token, plant_scope, start_date, end_date, granularity)["quality"]


@router.get("/dispatch")
def dispatch_report(
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    granularity: Optional[str] = Query(default="day"),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    return _build_reports(token, plant_scope, start_date, end_date, granularity)["dispatch"]


@router.get("/inventory-health")
def inventory_health_report(
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    granularity: Optional[str] = Query(default="day"),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    return _build_reports(token, plant_scope, start_date, end_date, granularity)["inventory"]


@router.get("/plant-compare")
def plant_compare_report(
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    granularity: Optional[str] = Query(default="day"),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    reports = _build_reports(token, plant_scope, start_date, end_date, granularity)
    return {
        "rows": reports["plant_compare"],
        "filters": reports["owner_pack"]["filters"],
        "available_range": reports["owner_pack"].get("available_range", {}),
    }


@router.get("/exceptions")
def exception_report(
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    granularity: Optional[str] = Query(default="day"),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    reports = _build_reports(token, plant_scope, start_date, end_date, granularity)
    return {
        **reports["exceptions"],
        "filters": reports["owner_pack"]["filters"],
        "available_range": reports["owner_pack"].get("available_range", {}),
    }
