from fastapi import APIRouter, Depends, Query
from typing import List, Dict, Any
from collections import defaultdict
from src.dependencies import get_token, get_plant_scope
from src.utils import service_get, scope_plant_ids
from src.config import SALES_SERVICE_URL, DISPATCH_SERVICE_URL
from src.date_utils import parse_iso_date
from datetime import datetime

router = APIRouter(prefix="/dispatch", tags=["Customer & Dispatch Analytics"])

@router.get("/sales-trends")
def sales_trends(
    start_date: str = Query(...),
    end_date: str = Query(...),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    start = parse_iso_date(start_date)
    end = parse_iso_date(end_date)
    orders: List[Dict[str, Any]] = []
    for scoped_plant_id in scope_plant_ids(plant_scope):
        orders.extend(service_get(f"{SALES_SERVICE_URL}/sales-orders", token, plant_id=scoped_plant_id))

    buckets = defaultdict(lambda: {"orders": 0, "released": 0, "closed": 0})
    for order in orders:
        created_at = datetime.fromisoformat(order["created_at"])
        created_day = created_at.date()
        if start <= created_day <= end:
            key = created_day.isoformat()
            buckets[key]["orders"] += 1
            if order.get("status") in {"released", "partially_dispatched", "closed"}:
                buckets[key]["released"] += 1
            if order.get("status") == "closed":
                buckets[key]["closed"] += 1

    return [
        {"date": day, **values}
        for day, values in sorted(buckets.items())
    ]
