from fastapi import APIRouter, Depends, Query, Response
from typing import List, Dict, Any
from collections import defaultdict
from src.dependencies import get_token, get_plant_scope
from src.utils import service_get, scope_plant_ids
from src.config import INVENTORY_SERVICE_URL

router = APIRouter(prefix="/inventory", tags=["Inventory Insight"])

@router.get("/valuation")
def inventory_valuation(
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    items = []
    for scoped_plant_id in scope_plant_ids(plant_scope):
        valuation = service_get(f"{INVENTORY_SERVICE_URL}/inventory/valuation/summary", token, plant_id=scoped_plant_id, required=True)
        items.extend(valuation.get("rows", []))
    grouped = defaultdict(float)
    for row in items:
        grouped[row.get("type") or "UNKNOWN"] += float(row.get("inventory_value") or 0)
    return {
        "total_value": round(sum(float(row.get("inventory_value") or 0) for row in items), 2),
        "breakdown": [{"type": key, "value": round(value, 2)} for key, value in grouped.items()],
        "items": items,
    }


@router.get("/locations")
def inventory_by_location(
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    location_totals: dict[str, dict[str, Any]] = {}
    for scoped_plant_id in scope_plant_ids(plant_scope):
        locations = service_get(f"{INVENTORY_SERVICE_URL}/inventory/locations", token, plant_id=scoped_plant_id) or []
        ledger_rows = (service_get(f"{INVENTORY_SERVICE_URL}/ledger", token, plant_id=scoped_plant_id) or {}).get("ledger", [])
        for location in locations:
            location_totals[str(location.get("id"))] = {
                "location_id": location.get("id"),
                "code": location.get("code"),
                "warehouse": location.get("warehouse"),
                "zone": location.get("zone"),
                "bin": location.get("bin"),
                "purpose": location.get("purpose"),
                "qty": 0.0,
            }
        for row in ledger_rows:
            location_id = str(row.get("location_id") or "")
            if not location_id or location_id not in location_totals:
                continue
            location_totals[location_id]["qty"] += float(row.get("qty_change") or 0.0)
    return sorted(
        [
            {**payload, "qty": round(payload["qty"], 2)}
            for payload in location_totals.values()
        ],
        key=lambda item: (item["warehouse"] or "", item["zone"] or "", item["bin"] or ""),
    )


@router.get("/slitting-genealogy")
def slitting_genealogy(
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    child_rows: list[dict[str, Any]] = []
    for scoped_plant_id in scope_plant_ids(plant_scope):
        reels = service_get(f"{INVENTORY_SERVICE_URL}/reels", token, plant_id=scoped_plant_id) or []
        for reel in reels:
            if reel.get("parent_reel_id"):
                child_rows.append(
                    {
                        "plant_id": scoped_plant_id,
                        "parent_reel_id": reel.get("parent_reel_id"),
                        "child_reel_id": reel.get("id"),
                        "child_reel_code": reel.get("reel_code"),
                        "weight_kg": float(reel.get("current_weight_kg") or 0.0),
                        "stock_status": reel.get("stock_status"),
                        "location_id": reel.get("location_id"),
                        "genealogy": reel.get("genealogy_metadata") or {},
                    }
                )
    grouped: dict[str, dict[str, Any]] = defaultdict(lambda: {"parent_reel_id": None, "children": [], "total_child_weight_kg": 0.0})
    for row in child_rows:
        parent_key = str(row["parent_reel_id"])
        grouped[parent_key]["parent_reel_id"] = row["parent_reel_id"]
        grouped[parent_key]["children"].append(row)
        grouped[parent_key]["total_child_weight_kg"] += row["weight_kg"]
    return [
        {
            "parent_reel_id": payload["parent_reel_id"],
            "total_child_weight_kg": round(payload["total_child_weight_kg"], 2),
            "children": payload["children"],
        }
        for payload in grouped.values()
    ]
