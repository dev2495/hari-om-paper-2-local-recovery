from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.routers import dashboard, production, loss, inventory, dispatch, quality, reports, deep_cuts
from src.cache import _build_cache_key
from src.routers.loss import _aggregate_loss_by_supplier


def _aggregate_shift_variance(rows):
    """Backward-compatible aggregation helper used by legacy tests."""
    buckets = {}
    for row in rows:
        shift = str(row.get("shift") or "UNKNOWN").upper()
        issued = float(row.get("issued_weight") or 0.0)
        consumed = float(row.get("consumed_weight") or 0.0)
        fg_weight = float(row.get("fg_weight") or 0.0)
        scrap = float(row.get("scrap_weight") or 0.0)
        loss = float(row.get("loss_weight") or 0.0)
        bucket = buckets.setdefault(
            shift,
            {
                "shift": shift,
                "issued_weight": 0.0,
                "consumed_weight": 0.0,
                "fg_weight": 0.0,
                "scrap_weight": 0.0,
                "loss_weight": 0.0,
            },
        )
        bucket["issued_weight"] += issued
        bucket["consumed_weight"] += consumed
        bucket["fg_weight"] += fg_weight
        bucket["scrap_weight"] += scrap
        bucket["loss_weight"] += loss

    result = []
    for shift, bucket in buckets.items():
        issued = bucket["issued_weight"]
        loss = bucket["loss_weight"]
        fg_weight = bucket["fg_weight"]
        result.append(
            {
                "shift": shift,
                "issued_weight": round(issued, 4),
                "consumed_weight": round(bucket["consumed_weight"], 4),
                "fg_weight": round(fg_weight, 4),
                "scrap_weight": round(bucket["scrap_weight"], 4),
                "loss_weight": round(loss, 4),
                "loss_percentage": round((loss / issued * 100.0), 4) if issued > 0 else 0.0,
                "yield_percentage": round((fg_weight / issued * 100.0), 4) if issued > 0 else 0.0,
            }
        )
    return sorted(result, key=lambda item: item["shift"])


def _aggregate_top_loss_reels(rows, limit=10):
    """Backward-compatible aggregation helper used by legacy tests."""
    buckets = {}
    for row in rows:
        reel_id = str(row.get("reel_id") or "")
        if not reel_id:
            continue
        bucket = buckets.setdefault(
            reel_id,
            {
                "reel_id": reel_id,
                "reel_code": row.get("reel_code"),
                "supplier_name": row.get("supplier_name"),
                "gsm": row.get("gsm"),
                "bf": row.get("bf"),
                "issued_weight": 0.0,
                "consumed_weight": 0.0,
                "fg_weight": 0.0,
                "scrap_weight": 0.0,
                "loss_weight": 0.0,
            },
        )
        bucket["issued_weight"] += float(row.get("issued_weight") or 0.0)
        bucket["consumed_weight"] += float(row.get("consumed_weight") or 0.0)
        bucket["fg_weight"] += float(row.get("fg_weight") or 0.0)
        bucket["scrap_weight"] += float(row.get("scrap_weight") or 0.0)
        bucket["loss_weight"] += float(row.get("loss_weight") or 0.0)

    response = list(buckets.values())
    for item in response:
        issued = item["issued_weight"]
        loss = item["loss_weight"]
        item["issued_weight"] = round(issued, 4)
        item["consumed_weight"] = round(item["consumed_weight"], 4)
        item["fg_weight"] = round(item["fg_weight"], 4)
        item["scrap_weight"] = round(item["scrap_weight"], 4)
        item["loss_weight"] = round(loss, 4)
        item["loss_percentage"] = round((loss / issued * 100.0), 4) if issued > 0 else 0.0
    response.sort(key=lambda item: item["loss_weight"], reverse=True)
    return response[: max(0, int(limit or 0))]

app = FastAPI(title="Hari Om Paper ERP - Analytics Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dashboard.router)
app.include_router(production.router)
app.include_router(loss.router)
app.include_router(inventory.router)
app.include_router(dispatch.router)
app.include_router(quality.router)
app.include_router(reports.router)
app.include_router(deep_cuts.router)

@app.get("/")
def health_check():
    return {
        "status": "healthy",
        "service": "analytics-service",
        "version": "1.0.0",
        "endpoints": [
            "/dashboard/overview",
            "/production/trends",
            "/production/shrink",
            "/production/scrap",
            "/production/winder",
            "/production/oven",
            "/production/process",
            "/inventory/valuation",
            "/dispatch/sales-trends",
            "/loss/supplier-loss",
            "/loss/gsm-bf-loss",
            "/quality/compliance",
            "/reports/owner-pack",
            "/reports/production",
            "/reports/sales",
            "/reports/quality",
            "/reports/dispatch",
            "/reports/inventory-health",
            "/reports/plant-compare",
            "/reports/exceptions",
            "/deep/machine-utilization",
            "/deep/customer-360",
            "/deep/operator-productivity",
            "/deep/leadtime-anatomy",
            "/deep/scrap-cost-ladder",
            "/deep/item-velocity",
        ],
    }

@app.get("/health")
def detailed_health():
    return {"status": "healthy", "service": "analytics-service"}
