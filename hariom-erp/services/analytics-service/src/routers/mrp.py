"""Material coverage read model for MRP. Aggregates only; does not own stock."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from src.config import INVENTORY_SERVICE_URL, MASTER_DATA_SERVICE_URL, SALES_SERVICE_URL, SPEC_SERVICE_URL
from src.demand_coverage import build_coverage
from src.dependencies import get_plant_scope, get_token
from src.utils import scope_plant_ids, service_get

router = APIRouter(prefix="/mrp", tags=["MRP Coverage"])


def _open_purchase_lines(token: str, plant_id: str) -> list[dict[str, Any]]:
    payload = service_get(
        f"{INVENTORY_SERVICE_URL}/inventory/purchase/orders",
        token,
        plant_id=plant_id,
        params={"limit": 500},
    ) or {}
    orders = payload.get("items") if isinstance(payload, dict) else payload
    lines: list[dict[str, Any]] = []
    for order in orders or []:
        status = str(order.get("status") or "").upper()
        if status in {"CANCELLED", "RECEIVED"}:
            continue
        for line in order.get("lines") or []:
            lines.append(line)
    return lines


def _coverage_for_plant(token: str, plant_id: str) -> dict[str, Any]:
    demand = service_get(
        f"{SALES_SERVICE_URL}/sales-orders/open-demand",
        token,
        plant_id=plant_id,
        required=True,
        timeout=60.0,
    )
    if not isinstance(demand, dict):
        demand = {"unavailable": True, "lines": [], "coverage": None, "total_open_lines": 0}

    balances_payload = service_get(
        f"{INVENTORY_SERVICE_URL}/all-balances",
        token,
        plant_id=plant_id,
        required=True,
    ) or {}
    balances = balances_payload.get("items") if isinstance(balances_payload, dict) else balances_payload or []

    papers = service_get(
        f"{MASTER_DATA_SERVICE_URL}/master/papers/",
        token,
        plant_id=plant_id,
    ) or []
    if not isinstance(papers, list):
        papers = []

    spec_ids = sorted({str(line.get("approved_spec_id") or "") for line in demand.get("lines") or [] if line.get("approved_spec_id")})
    boms_by_spec: dict[str, dict[str, Any]] = {}
    for spec_id in spec_ids:
        bom_wrap = service_get(
            f"{SPEC_SERVICE_URL}/calculate/bom-for-spec/{spec_id}",
            token,
            plant_id=plant_id,
            timeout=45.0,
        )
        if isinstance(bom_wrap, dict):
            boms_by_spec[spec_id] = bom_wrap

    coverage = build_coverage(
        demand_payload=demand,
        boms_by_spec=boms_by_spec,
        balances=balances or [],
        papers=papers,
        open_purchase_lines=_open_purchase_lines(token, plant_id),
        plant_id=plant_id,
    )
    coverage["sources"] = {
        "sales_open_demand": True,
        "spec_bom_for_spec": True,
        "inventory_all_balances": True,
        "purchase_open_lines": True,
    }
    return coverage


@router.get("/coverage")
def material_coverage(
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    plants = scope_plant_ids(plant_scope)
    if not plants:
        return {
            "as_of": None,
            "completeness": "UNAVAILABLE",
            "notes": ["No plant is in scope. Coverage is not zero; select a plant."],
            "ledger": False,
            "plants": [],
            "materials": [],
        }
    plant_results = [_coverage_for_plant(token, plant_id) for plant_id in plants]
    if len(plant_results) == 1:
        return plant_results[0]
    materials = []
    for result in plant_results:
        for row in result.get("materials") or []:
            materials.append({**row, "plant_id": result.get("plant_id")})
    return {
        "as_of": plant_results[0].get("as_of") if plant_results else None,
        "completeness": "PARTIAL" if any(row.get("completeness") != "OK" for row in plant_results) else "OK",
        "ledger": False,
        "notes": [
            "Cross-plant coverage is listed separately. One plant's stock does not cover another.",
        ],
        "plants": plant_results,
        "materials": materials,
        "demand_source": {
            "total_open_lines": sum(int((row.get("demand_source") or {}).get("total_open_lines") or 0) for row in plant_results),
        },
    }
