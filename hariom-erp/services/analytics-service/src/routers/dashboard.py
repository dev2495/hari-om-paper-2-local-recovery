from fastapi import APIRouter, Depends, Query, Response
from typing import List, Dict, Any
from datetime import date
from src.dependencies import get_token, get_plant_scope
from src.utils import service_get, scope_plant_ids
from src.config import PRODUCTION_SERVICE_URL, SALES_SERVICE_URL, INVENTORY_SERVICE_URL, SPEC_SERVICE_URL, DISPATCH_SERVICE_URL
from src.date_utils import parse_iso_date

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

@router.get("/overview")
def dashboard_overview(
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    today = date.today().isoformat()

    jobs: List[Dict[str, Any]] = []
    sales_orders: List[Dict[str, Any]] = []
    balance_items: List[Dict[str, Any]] = []
    specs: List[Dict[str, Any]] = []
    today_dispatch_qty = 0.0

    for scoped_plant_id in scope_plant_ids(plant_scope):
        jobs.extend(service_get(f"{PRODUCTION_SERVICE_URL}/jobs/", token, plant_id=scoped_plant_id))
        sales_orders.extend(service_get(f"{SALES_SERVICE_URL}/sales-orders", token, plant_id=scoped_plant_id))
        balances_payload = service_get(f"{INVENTORY_SERVICE_URL}/all-balances", token, plant_id=scoped_plant_id)
        balance_items.extend(balances_payload.get("items", []))
        specs.extend(
            service_get(
                f"{SPEC_SERVICE_URL}/specs/",
                token,
                params={"status": "approved", "active_only": True},
                plant_id=scoped_plant_id,
            )
        )

        try:
            dispatch_today = service_get(
                f"{DISPATCH_SERVICE_URL}/reports/daily",
                token,
                params={"report_date": today},
                plant_id=scoped_plant_id,
            )
            today_dispatch_qty += float(dispatch_today.get("total_quantity", 0.0))
        except Exception:
            continue

    today_jobs = [j for j in jobs if j.get("date") == today]
    today_production = sum(float(j.get("finished_weight", 0.0)) for j in today_jobs)

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

    bamboo_alerts = [
        j for j in jobs if (j.get("variance_severity") in {"warning", "critical"})
    ]
    critical_alerts = [j for j in jobs if j.get("variance_severity") == "critical"]

    total_so = len(sales_orders)
    backlog_orders = [
        so for so in sales_orders if so.get("status") in {"released", "partially_dispatched"}
    ]
    closed_orders = [so for so in sales_orders if so.get("status") == "closed"]
    fill_rate = (len(closed_orders) / total_so * 100.0) if total_so else 0.0

    maker_checker_queue = len(
        [so for so in sales_orders if so.get("status") in {"draft", "submitted"}]
    )

    total_scrap = sum(float(j.get("tube_scrap_qty", 0.0)) for j in today_jobs)
    total_tubes = sum(float(j.get("tubes_produced_qty", 0.0)) for j in today_jobs)
    scrap_percent = (total_scrap / total_tubes * 100.0) if total_tubes else 0.0

    shrink_numerator = sum(
        max(0.0, float(j.get("oven_input_weight", 0.0)) - float(j.get("oven_output_weight", 0.0)))
        for j in today_jobs
    )
    shrink_denominator = sum(float(j.get("oven_input_weight", 0.0)) for j in today_jobs)
    shrink_percent = (shrink_numerator / shrink_denominator * 100.0) if shrink_denominator else 0.0

    bamboo_loss_percent = (
        sum(float(j.get("weight_variance_percent", 0.0)) for j in today_jobs) / len(today_jobs)
        if today_jobs
        else 0.0
    )

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
            "warning_or_higher": len(bamboo_alerts),
            "critical": len(critical_alerts),
        },
        "maker_checker_queue": maker_checker_queue,
    }
