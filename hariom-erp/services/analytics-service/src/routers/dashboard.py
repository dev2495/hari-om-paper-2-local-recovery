from datetime import datetime
from fastapi import APIRouter, Depends, Query, Response
from typing import List, Dict, Any, Optional
from datetime import date
from src.dependencies import get_token, get_plant_scope
from src.utils import service_get, scope_plant_ids
from src.config import PRODUCTION_SERVICE_URL, SALES_SERVICE_URL, INVENTORY_SERVICE_URL, SPEC_SERVICE_URL
from src.routers.reports import _build_reports

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


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


def _dispatch_qty_from_sales_orders(sales_orders: List[Dict[str, Any]], today_iso: str) -> float:
    total = 0.0
    for order in sales_orders or []:
        for line in order.get("lines") or []:
            for log in line.get("dispatch_logs") or []:
                ts = _parse_dt(log.get("created_at"))
                if ts and ts.date().isoformat() == today_iso:
                    total += float(log.get("qty") or 0.0)
    return total


def _dispatch_qty_from_timeline_events(events: List[Dict[str, Any]], today_iso: str) -> float:
    total = 0.0
    for event in events or []:
        if str(event.get("event_type") or "").upper() != "SO_LINE_DISPATCH_RECORDED":
            continue
        ts = _parse_dt(event.get("timestamp"))
        if ts and ts.date().isoformat() == today_iso:
            total += float((event.get("payload") or {}).get("qty") or 0.0)
    return total


def _throughput_today_from_job_cards(job_cards: List[Dict[str, Any]], today_value: date) -> Dict[str, float]:
    throughput = {"WINDER": 0.0, "OVEN": 0.0, "PROCESS": 0.0, "PACKING": 0.0}
    for card in job_cards or []:
        for stage in card.get("stages") or []:
            stage_type = str(stage.get("stage_type") or "").upper()
            stage_ts = _parse_dt(stage.get("actual_end")) or _parse_dt(stage.get("entered_at"))
            if stage_type in throughput and stage_ts and stage_ts.date() == today_value:
                throughput[stage_type] += float(stage.get("output_qty") or 0.0)
    return throughput

@router.get("/overview")
def dashboard_overview(
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    today = date.today().isoformat()

    job_cards: List[Dict[str, Any]] = []
    sales_orders: List[Dict[str, Any]] = []
    balance_items: List[Dict[str, Any]] = []
    specs: List[Dict[str, Any]] = []
    today_dispatch_qty = 0.0

    for scoped_plant_id in scope_plant_ids(plant_scope):
        cards = service_get(
            f"{PRODUCTION_SERVICE_URL}/job-cards",
            token,
            params={"limit": 500},
            plant_id=scoped_plant_id,
        ) or []
        for card in cards or []:
            card_id = card.get("id")
            if not card_id:
                continue
            detail = service_get(
                f"{PRODUCTION_SERVICE_URL}/job-cards/{card_id}",
                token,
                plant_id=scoped_plant_id,
            )
            if isinstance(detail, dict):
                job_cards.append(detail)
        plant_sales_orders = service_get(f"{SALES_SERVICE_URL}/sales-orders", token, plant_id=scoped_plant_id) or []
        sales_orders.extend(plant_sales_orders)
        balances_payload = service_get(f"{INVENTORY_SERVICE_URL}/all-balances", token, plant_id=scoped_plant_id) or {}
        balance_items.extend(balances_payload.get("items", []))
        specs.extend(
            service_get(
                f"{SPEC_SERVICE_URL}/specs/",
                token,
                params={"status": "approved", "active_only": True},
                plant_id=scoped_plant_id,
            ) or []
        )

        for order in plant_sales_orders or []:
            order_id = order.get("id")
            if not order_id:
                continue
            try:
                timeline = service_get(
                    f"{SALES_SERVICE_URL}/sales-orders/{order_id}/timeline",
                    token,
                    params={"depth": "summary"},
                    plant_id=scoped_plant_id,
                ) or {}
                today_dispatch_qty += _dispatch_qty_from_timeline_events(timeline.get("events") or [], today)
            except Exception:
                continue

    today_production = 0.0
    total_scrap = 0.0
    total_tubes = 0.0
    shrink_numerator = 0.0
    shrink_denominator = 0.0
    variance_values: list[float] = []
    warning_or_higher = 0
    critical = 0
    for card in job_cards:
        for stage in card.get("stages") or []:
            stage_day = (
                (_parse_dt(stage.get("actual_end")) or _parse_dt(stage.get("entered_at")) or _parse_dt(card.get("created_at")))
            )
            if not stage_day or stage_day.date().isoformat() != today:
                continue
            stage_type = str(stage.get("stage_type") or "").upper()
            output_qty = float(stage.get("output_qty") or 0.0)
            scrap_qty = float(stage.get("scrap_qty") or 0.0)
            input_qty = float(stage.get("input_qty") or 0.0)
            if stage_type == "PACKING":
                today_production += output_qty
            if stage_type == "PROCESS":
                total_scrap += scrap_qty
                total_tubes += output_qty
                scrap_percent = (scrap_qty / output_qty * 100.0) if output_qty else 0.0
                if scrap_percent >= 5.0:
                    warning_or_higher += 1
                if scrap_percent >= 10.0:
                    critical += 1
                variance_values.append(scrap_percent)
            if stage_type == "OVEN":
                shrink_numerator += max(0.0, input_qty - output_qty)
                shrink_denominator += max(input_qty, 0.0)

    low_stock_items = []
    current_stock_value = 0.0
    for item in balance_items:
        available = float(item.get("available_qty", 0.0))
        current_stock_value += max(0.0, available)
        if available <= 50:
            low_stock_items.append(
                {
                    "item_code": item.get("item_code"),
                    "item_name": item.get("name"),
                    "current_stock": available,
                    "reorder_level": 50,
                    "category": item.get("type"),
                }
            )

    total_so = len(sales_orders)
    backlog_orders = [
        so for so in sales_orders if so.get("status") in {"partially_released", "released", "partially_dispatched"}
    ]
    closed_orders = [so for so in sales_orders if so.get("status") == "closed"]
    fill_rate = (len(closed_orders) / total_so * 100.0) if total_so else 0.0

    maker_checker_queue = len(
        [so for so in sales_orders if so.get("status") in {"draft", "submitted"}]
    )

    scrap_percent = (total_scrap / total_tubes * 100.0) if total_tubes else 0.0

    shrink_percent = (shrink_numerator / shrink_denominator * 100.0) if shrink_denominator else 0.0

    bamboo_loss_percent = (sum(variance_values) / len(variance_values)) if variance_values else 0.0

    return {
        "today_production": round(today_production, 2),
        "today_dispatch": round(float(today_dispatch_qty), 2),
        "current_stock_value": round(current_stock_value, 2),
        "shrink_percent": round(shrink_percent, 2),
        "scrap_percent": round(scrap_percent, 2),
        "bamboo_loss_percent": round(bamboo_loss_percent, 2),
        "active_specs": len(specs),
        "low_stock_items": low_stock_items,
        "so_backlog": len(backlog_orders),
        "fill_rate": round(fill_rate, 2),
        "bamboo_alerts": {
            "warning_or_higher": warning_or_higher,
            "critical": critical,
        },
        "maker_checker_queue": maker_checker_queue,
    }


@router.get("/owner")
def dashboard_owner(
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    granularity: Optional[str] = Query(default="day"),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    overview = dashboard_overview(token=token, plant_scope=plant_scope)
    today = date.today()

    job_cards: List[Dict[str, Any]] = []
    sales_orders: List[Dict[str, Any]] = []

    for scoped_plant_id in scope_plant_ids(plant_scope):
        cards = service_get(
            f"{PRODUCTION_SERVICE_URL}/job-cards",
            token,
            params={"limit": 500},
            plant_id=scoped_plant_id,
        ) or []
        for card in cards or []:
            card_id = card.get("id")
            if not card_id:
                continue
            detail = service_get(
                f"{PRODUCTION_SERVICE_URL}/job-cards/{card_id}",
                token,
                plant_id=scoped_plant_id,
            )
            if isinstance(detail, dict):
                job_cards.append(detail)
        sales_orders.extend(service_get(f"{SALES_SERVICE_URL}/sales-orders", token, plant_id=scoped_plant_id) or [])

    active_cards = [card for card in job_cards if str(card.get("status") or "").upper() not in {"COMPLETED", "CANCELLED"}]
    released_orders = [
        order for order in sales_orders if order.get("status") in {"partially_released", "released", "partially_dispatched"}
    ]
    delayed_orders = []
    due_today_orders = []
    at_risk_orders = []
    for order in released_orders:
        lines = order.get("lines") or []
        line_due_dates = []
        for line in lines:
            try:
                line_due_dates.append(date.fromisoformat(str(line.get("due_date"))))
            except Exception:
                continue
        if not line_due_dates:
            continue
        earliest_due = min(line_due_dates)
        if earliest_due < today:
            delayed_orders.append(order)
        elif earliest_due == today:
            due_today_orders.append(order)
        elif (earliest_due - today).days <= 2:
            at_risk_orders.append(order)

    wip_qty = 0.0
    stage_pipeline = {"WINDER": 0, "OVEN": 0, "PROCESS": 0, "PACKING": 0, "DONE": 0}
    throughput_today = _throughput_today_from_job_cards(job_cards, today)
    blocked_jobs = 0
    machine_counts: dict[str, dict[str, Any]] = {}
    fg_ready_qty = 0.0
    dispatch_pending_qty = 0.0
    for card in active_cards:
        current_stage = str(card.get("current_stage") or "WINDER").upper()
        stage_pipeline[current_stage if current_stage in stage_pipeline else "DONE"] += 1
        wip_qty += float(card.get("planned_qty") or 0.0)
        stages = card.get("stages") or []
        current_stage_row = next((row for row in stages if str(row.get("stage_type") or "").upper() == current_stage), None)
        if current_stage_row and str(current_stage_row.get("status") or "").upper() in {"PLANNED", "ASSIGNED"}:
            blocked_jobs += 1
        packing_stage = next(
            (row for row in stages if str(row.get("stage_type") or "").upper() == "PACKING" and str(row.get("status") or "").upper() == "COMPLETED"),
            None,
        )
        if packing_stage:
            packed_qty = float(packing_stage.get("output_qty") or 0.0)
            fg_ready_qty += packed_qty
            dispatch_pending_qty += packed_qty

    for card in job_cards:
        for stage in card.get("stages") or []:
            machine_id = str(stage.get("machine_id") or "")
            if not machine_id:
                continue
            stage_type = str(stage.get("stage_type") or "").upper()
            bucket = machine_counts.setdefault(
                machine_id,
                {"machine_id": machine_id, "stage_type": stage_type, "jobs": 0, "output_qty": 0.0},
            )
            bucket["jobs"] += 1
            bucket["output_qty"] += float(stage.get("output_qty") or 0.0)

    hotspots = sorted(
        machine_counts.values(),
        key=lambda row: (float(row.get("output_qty") or 0.0), int(row.get("jobs") or 0)),
        reverse=True,
    )[:5]

    report_pack = _build_reports(token, plant_scope, start_date, end_date, granularity)["owner_pack"]

    return {
        "headline": {
            "released_so_backlog": int(overview["so_backlog"]),
            "today_production": float(overview["today_production"]),
            "today_dispatch": float(overview["today_dispatch"]),
            "current_stock_value": float(overview["current_stock_value"]),
            "wip_qty": round(wip_qty, 2),
            "fill_rate": float(overview["fill_rate"]),
            "active_job_cards": len(active_cards),
            "active_specs": int(overview["active_specs"]),
        },
        "production": {
            "stage_pipeline": stage_pipeline,
            "throughput_today": throughput_today,
            "blocked_jobs": blocked_jobs,
            "machine_hotspots": hotspots,
        },
        "commercial": {
            "due_today_orders": len(due_today_orders),
            "delayed_orders": len(delayed_orders),
            "at_risk_orders": len(at_risk_orders),
            "dispatch_pending_orders": len(released_orders),
        },
        "inventory": {
            "low_stock_items": overview["low_stock_items"],
            "reel_exposure": len(overview["low_stock_items"]),
            "fg_ready_qty": round(fg_ready_qty, 2),
            "dispatch_pending_qty": round(dispatch_pending_qty, 2),
        },
        "quality": {
            "shrink_percent": float(overview["shrink_percent"]),
            "scrap_percent": float(overview["scrap_percent"]),
            "bamboo_loss_percent": float(overview["bamboo_loss_percent"]),
            "bamboo_alerts": overview["bamboo_alerts"],
        },
        "actions": {
            "maker_checker_queue": int(overview["maker_checker_queue"]),
            "capacity_alerts": int(overview["bamboo_alerts"]["warning_or_higher"]),
            "critical_alerts": int(overview["bamboo_alerts"]["critical"]),
            "delayed_dispatches": len(delayed_orders),
        },
        "filters": report_pack["filters"],
        "report_pack": report_pack,
    }
