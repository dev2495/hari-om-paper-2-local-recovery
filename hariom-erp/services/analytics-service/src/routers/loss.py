from fastapi import APIRouter, Depends, Query, Response
from typing import List, Dict, Any
from collections import defaultdict
from src.dependencies import get_token, get_plant_scope
from src.utils import service_get, scope_plant_ids
from src.config import INVENTORY_SERVICE_URL, PRODUCTION_SERVICE_URL
from src.date_utils import parse_date_range, parse_iso_date
from src.cache import cached_compute
from datetime import date

router = APIRouter(prefix="/loss", tags=["Loss Intelligence"])

def _collect_reel_loss_rows(token: str, plant_scope: dict, start: date, end: date) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for scoped_plant_id in scope_plant_ids(plant_scope):
        issues = service_get(
            f"{INVENTORY_SERVICE_URL}/reel-issues",
            token,
            params={"date_from": start.isoformat(), "date_to": end.isoformat()},
            plant_id=scoped_plant_id,
        )
        if not issues:
            continue

        reel_ids = sorted({str(issue.get("reel_id")) for issue in issues if issue.get("reel_id")})
        reels: List[Dict[str, Any]] = []
        if reel_ids:
            reels = service_get(
                f"{INVENTORY_SERVICE_URL}/reels",
                token,
                params={"reel_ids": ",".join(reel_ids)},
                plant_id=scoped_plant_id,
            )
        reel_map = {str(reel.get("id")): reel for reel in reels if reel.get("id")}

        grouped: Dict[tuple[str, str, str], List[Dict[str, Any]]] = defaultdict(list)
        for issue in issues:
            issue_date = str(issue.get("issue_date"))
            if not issue_date:
                continue
            try:
                parsed_date = parse_iso_date(issue_date)
            except ValueError:
                continue
            if parsed_date < start or parsed_date > end:
                continue
            key = (
                issue_date,
                str(issue.get("winder_machine_id")),
                str(issue.get("shift", "")).upper(),
            )
            grouped[key].append(issue)

        for (issue_day, machine_id, shift), group in grouped.items():
            if not machine_id or machine_id == "None":
                continue
            recon = service_get(
                f"{PRODUCTION_SERVICE_URL}/reconciliation/winder-shift",
                token,
                params={
                    "winder_machine_id": machine_id,
                    "shift": shift,
                    "date": issue_day,
                },
                plant_id=scoped_plant_id,
            )
            group_issued = sum(float(issue.get("issued_weight_kg") or 0.0) for issue in group)
            group_loss = max(0.0, float(recon.get("loss_weight") or 0.0))
            group_fg = max(0.0, float(recon.get("fg_weight") or 0.0))
            group_scrap = max(0.0, float(recon.get("scrap_weight") or 0.0))

            for issue in group:
                issued = float(issue.get("issued_weight_kg") or 0.0)
                remaining = float(issue.get("remaining_weight_kg") or 0.0)
                consumed = max(0.0, issued - remaining)
                share = (issued / group_issued) if group_issued > 0 else 0.0
                reel_id = str(issue.get("reel_id"))
                reel = reel_map.get(reel_id, {})
                rows.append(
                    {
                        "plant_id": scoped_plant_id,
                        "date": issue_day,
                        "shift": shift,
                        "winder_machine_id": machine_id,
                        "reel_issue_id": str(issue.get("id")),
                        "reel_id": reel_id,
                        "reel_code": reel.get("reel_code"),
                        "supplier_name": reel.get("supplier_name") or "UNKNOWN",
                        "gsm": reel.get("gsm"),
                        "bf": reel.get("bf"),
                        "issued_weight": issued,
                        "consumed_weight": consumed,
                        "loss_weight": round(group_loss * share, 4),
                        "fg_weight": round(group_fg * share, 4),
                        "scrap_weight": round(group_scrap * share, 4),
                    }
                )
    return rows

def _aggregate_loss_by_supplier(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    buckets: Dict[str, Dict[str, float]] = defaultdict(lambda: {"issued_weight": 0.0, "loss_weight": 0.0})
    for row in rows:
        key = str(row.get("supplier_name") or "UNKNOWN")
        buckets[key]["issued_weight"] += float(row.get("issued_weight") or 0.0)
        buckets[key]["loss_weight"] += float(row.get("loss_weight") or 0.0)
    response = []
    for supplier, metrics in buckets.items():
        issued = metrics["issued_weight"]
        loss = metrics["loss_weight"]
        response.append(
            {
                "supplier_name": supplier,
                "issued_weight": round(issued, 4),
                "loss_weight": round(loss, 4),
                "loss_percentage": round((loss / issued * 100.0), 4) if issued > 0 else 0.0,
            }
        )
    return sorted(response, key=lambda item: item["loss_weight"], reverse=True)

def _aggregate_loss_by_gsm_bf(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    buckets: Dict[str, Dict[str, float]] = defaultdict(lambda: {"issued_weight": 0.0, "loss_weight": 0.0})
    for row in rows:
        key = f"{row.get('gsm', 'NA')}|{row.get('bf', 'NA')}"
        buckets[key]["issued_weight"] += float(row.get("issued_weight") or 0.0)
        buckets[key]["loss_weight"] += float(row.get("loss_weight") or 0.0)
    response = []
    for key, metrics in buckets.items():
        gsm_text, bf_text = key.split("|", 1)
        issued = metrics["issued_weight"]
        loss = metrics["loss_weight"]
        response.append(
            {
                "gsm": None if gsm_text == "NA" else float(gsm_text),
                "bf": None if bf_text == "NA" else float(bf_text),
                "issued_weight": round(issued, 4),
                "loss_weight": round(loss, 4),
                "loss_percentage": round((loss / issued * 100.0), 4) if issued > 0 else 0.0,
            }
        )
    return sorted(response, key=lambda item: item["loss_weight"], reverse=True)

@router.get("/supplier-loss")
def reel_loss_by_supplier(
    response: Response,
    start_date: str = Query(...),
    end_date: str = Query(...),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    start, end = parse_date_range(start_date, end_date)
    return cached_compute(
        endpoint_key="loss_by_supplier",
        params={"start_date": start.isoformat(), "end_date": end.isoformat()},
        plant_scope=plant_scope,
        response=response,
        producer=lambda: _aggregate_loss_by_supplier(_collect_reel_loss_rows(token, plant_scope, start, end)),
    )

@router.get("/gsm-bf-loss")
def reel_loss_by_gsm_bf(
    response: Response,
    start_date: str = Query(...),
    end_date: str = Query(...),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    start, end = parse_date_range(start_date, end_date)
    return cached_compute(
        endpoint_key="loss_by_gsm_bf",
        params={"start_date": start.isoformat(), "end_date": end.isoformat()},
        plant_scope=plant_scope,
        response=response,
        producer=lambda: _aggregate_loss_by_gsm_bf(_collect_reel_loss_rows(token, plant_scope, start, end)),
    )
