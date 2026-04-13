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
    items: List[Dict[str, Any]] = []
    for scoped_plant_id in scope_plant_ids(plant_scope):
        balances = service_get(f"{INVENTORY_SERVICE_URL}/all-balances", token, plant_id=scoped_plant_id)
        items.extend(balances.get("items", []))

    total_qty = sum(float(item.get("available_qty", 0.0)) for item in items)
    breakdown = [
        {
            "type": item.get("type"),
            "item_code": item.get("item_code"),
            "name": item.get("name"),
            "available_qty": round(float(item.get("available_qty", 0.0)), 2),
        }
        for item in items
    ]

    grouped = defaultdict(float)
    for row in breakdown:
        grouped[row["type"]] += row["available_qty"]

    return {
        "total_value": round(total_qty, 2),
        "breakdown": [{"type": key, "value": round(value, 2)} for key, value in grouped.items()],
        "items": breakdown,
    }
