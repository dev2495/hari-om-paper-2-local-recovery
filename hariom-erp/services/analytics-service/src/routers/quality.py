from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query

from src.config import PRODUCTION_SERVICE_URL
from src.date_utils import parse_date_range
from src.dependencies import get_plant_scope, get_token
from src.utils import scope_plant_ids, service_get

router = APIRouter(prefix="/quality", tags=["Spec Compliance & Quality"])


def _parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _to_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


@router.get("/compliance")
def quality_compliance(
    start_date: str = Query(...),
    end_date: str = Query(...),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    start, end = parse_date_range(start_date, end_date)
    checks: list[dict[str, Any]] = []

    for scoped_plant_id in scope_plant_ids(plant_scope):
        cards = service_get(
            f"{PRODUCTION_SERVICE_URL}/job-cards",
            token,
            params={"limit": 500},
            plant_id=scoped_plant_id,
        )
        for card in cards or []:
            card_id = card.get("id")
            if not card_id:
                continue
            detail = service_get(f"{PRODUCTION_SERVICE_URL}/job-cards/{card_id}", token, plant_id=scoped_plant_id) or {}
            if not detail:
                continue
            stages = detail.get("stages") or []
            process_stage = next((row for row in stages if str(row.get("stage_type")).upper() == "PROCESS"), None)
            if not process_stage:
                continue
            completed_at = _parse_datetime(process_stage.get("actual_end")) or _parse_datetime(process_stage.get("entered_at"))
            if not completed_at:
                continue
            event_day = completed_at.date()
            if event_day < start or event_day > end:
                continue

            spec = detail.get("spec_snapshot") or {}
            measurements = (process_stage.get("entry_snapshot") or {}).get("final_measurements") or {}
            dimensions = [
                ("id", "id_min_mm", "id_max_mm"),
                ("od", "od_min_mm", "od_max_mm"),
                ("length", "length_min_mm", "length_max_mm"),
                ("weight", "weight_min_g", "weight_max_g"),
                ("cs", "cs_min_n", "cs_max_n"),
            ]

            failures: list[str] = []
            evaluated = 0
            for metric_key, min_key, max_key in dimensions:
                measured = _to_float(measurements.get(metric_key))
                spec_min = _to_float(spec.get(min_key))
                spec_max = _to_float(spec.get(max_key))
                if measured is None or spec_min is None or spec_max is None:
                    continue
                evaluated += 1
                if measured < spec_min or measured > spec_max:
                    failures.append(metric_key)

            compliant = evaluated > 0 and not failures
            checks.append(
                {
                    "date": event_day.isoformat(),
                    "job_card_id": detail.get("id"),
                    "customer_name": (spec.get("customer_name_snapshot") or spec.get("customer_name")),
                    "compliant": compliant,
                    "failed_metrics": failures,
                }
            )

    daily = defaultdict(lambda: {"checked": 0, "compliant": 0})
    for row in checks:
        bucket = daily[row["date"]]
        bucket["checked"] += 1
        if row["compliant"]:
            bucket["compliant"] += 1

    summary = [
        {
            "date": day,
            "checked_jobs": values["checked"],
            "compliant_jobs": values["compliant"],
            "compliance_percent": round((values["compliant"] / values["checked"] * 100.0), 2) if values["checked"] else 0.0,
        }
        for day, values in sorted(daily.items())
    ]

    return {
        "summary": summary,
        "details": sorted(checks, key=lambda item: (item["date"], str(item["job_card_id"]))),
    }


@router.get("/holds")
def quality_holds_summary(
    start_date: str = Query(...),
    end_date: str = Query(...),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    start, end = parse_date_range(start_date, end_date)
    holds: list[dict[str, Any]] = []
    for scoped_plant_id in scope_plant_ids(plant_scope):
        cards = service_get(
            f"{PRODUCTION_SERVICE_URL}/job-cards",
            token,
            params={"limit": 500},
            plant_id=scoped_plant_id,
        )
        for card in cards or []:
            detail = service_get(f"{PRODUCTION_SERVICE_URL}/job-cards/{card.get('id')}", token, plant_id=scoped_plant_id) or {}
            if not detail:
                continue
            spec = detail.get("spec_snapshot") or {}
            packing_record = detail.get("packing_record") or {}
            for hold in detail.get("quality_holds") or []:
                created_at = _parse_datetime(hold.get("created_at"))
                if not created_at:
                    continue
                event_day = created_at.date()
                if event_day < start or event_day > end:
                    continue
                holds.append(
                    {
                        "date": event_day.isoformat(),
                        "job_card_id": detail.get("id"),
                        "customer_name": spec.get("customer_name_snapshot") or spec.get("customer_name"),
                        "stage_type": hold.get("stage_type"),
                        "status": hold.get("status"),
                        "reason": hold.get("reason"),
                        "fg_batch_no": packing_record.get("fg_batch_no"),
                        "stock_status": packing_record.get("stock_status"),
                    }
                )

    daily = defaultdict(lambda: {"holds": 0, "released": 0})
    for row in holds:
        bucket = daily[row["date"]]
        bucket["holds"] += 1
        if str(row.get("status") or "").upper() == "RELEASED":
            bucket["released"] += 1

    return {
        "summary": [
            {"date": day, "holds": values["holds"], "released": values["released"]}
            for day, values in sorted(daily.items())
        ],
        "details": sorted(holds, key=lambda row: (row["date"], str(row["job_card_id"]))),
    }
