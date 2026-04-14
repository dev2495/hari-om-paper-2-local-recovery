from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query

from src.config import MASTER_DATA_SERVICE_URL, PRODUCTION_SERVICE_URL
from src.date_utils import parse_date_range
from src.dependencies import get_plant_scope, get_token
from src.utils import scope_plant_ids, service_get

router = APIRouter(prefix="/production", tags=["Production"])


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


def _parse_cycle_hours(entry_snapshot: dict[str, Any], planned_start: Any, planned_end: Any) -> float | None:
    start_dt = _parse_datetime(planned_start)
    end_dt = _parse_datetime(planned_end)
    if start_dt and end_dt and end_dt >= start_dt:
        return (end_dt - start_dt).total_seconds() / 3600.0

    for key in ("cycle_time_hours", "cycle_time"):
        raw = entry_snapshot.get(key)
        if raw in (None, ""):
            continue
        if isinstance(raw, str) and ":" in raw:
            parts = raw.split(":")
            if len(parts) >= 2:
                try:
                    return float(parts[0]) + (float(parts[1]) / 60.0)
                except ValueError:
                    continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if value > 24:
            return value / 60.0
        if value > 0:
            return value

    raw_minutes = entry_snapshot.get("cycle_time_min")
    try:
        minutes = float(raw_minutes)
        if minutes > 0:
            return minutes / 60.0
    except (TypeError, ValueError):
        pass
    return None


def _collect_stage_rows(
    *,
    stage_type: str,
    start_date: str,
    end_date: str,
    token: str,
    plant_scope: dict,
) -> list[dict[str, Any]]:
    start, end = parse_date_range(start_date, end_date)
    rows: list[dict[str, Any]] = []
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
            detail = service_get(
                f"{PRODUCTION_SERVICE_URL}/job-cards/{card_id}",
                token,
                plant_id=scoped_plant_id,
            )
            for stage in detail.get("stages") or []:
                if str(stage.get("stage_type")).upper() != stage_type:
                    continue
                event_dt = (
                    _parse_datetime(stage.get("actual_end"))
                    or _parse_datetime(stage.get("entered_at"))
                    or _parse_datetime(detail.get("created_at"))
                )
                if not event_dt:
                    continue
                event_day = event_dt.date()
                if event_day < start or event_day > end:
                    continue
                rows.append(
                    {
                        "plant_id": scoped_plant_id,
                        "date": event_day.isoformat(),
                        "job_card_id": detail.get("id"),
                        "machine_id": stage.get("machine_id"),
                        "planned_qty": float(detail.get("planned_qty") or 0.0),
                        "input_qty": float(stage.get("input_qty") or 0.0),
                        "output_qty": float(stage.get("output_qty") or 0.0),
                        "scrap_qty": float(stage.get("scrap_qty") or 0.0),
                        "entry_snapshot": stage.get("entry_snapshot") or {},
                        "planned_start": stage.get("planned_start"),
                        "planned_end": stage.get("planned_end"),
                    }
                )
    return rows


def _collect_job_card_details(
    *,
    token: str,
    plant_scope: dict,
) -> list[dict[str, Any]]:
    details: list[dict[str, Any]] = []
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
            detail = service_get(
                f"{PRODUCTION_SERVICE_URL}/job-cards/{card_id}",
                token,
                plant_id=scoped_plant_id,
            )
            if detail:
                details.append(detail)
    return details


def _production_execution_snapshot(
    *,
    start_date: str | None,
    end_date: str | None,
    token: str,
    plant_scope: dict,
) -> dict[str, Any]:
    snapshots: list[dict[str, Any]] = []
    for scoped_plant_id in scope_plant_ids(plant_scope):
        snapshot = service_get(
            f"{PRODUCTION_SERVICE_URL}/analytics/execution-snapshot",
            token,
            params={
                **({"start_date": start_date} if start_date else {}),
                **({"end_date": end_date} if end_date else {}),
            },
            plant_id=scoped_plant_id,
            timeout=20.0,
        )
        if snapshot:
            snapshots.append(snapshot)

    trends_buckets: dict[str, dict[str, float]] = defaultdict(lambda: {"production": 0.0, "scrap": 0.0})
    live_rows: list[dict[str, Any]] = []
    wip_by_stage: dict[str, int] = defaultdict(int)
    oee_buckets: dict[tuple[str, str], dict[str, Any]] = defaultdict(
        lambda: {
            "machine_id": None,
            "stage_type": None,
            "segments": 0,
            "runtime_hours": 0.0,
            "planned_hours": 0.0,
            "planned_qty": 0.0,
            "output_qty": 0.0,
            "scrap_qty": 0.0,
        }
    )
    merged = {
        "trends": [],
        "scrap": [],
        "live_wip": {"kpis": {"live_jobs": 0, "blocked_jobs": 0, "completed_jobs": 0, "overdue_jobs": 0}, "wip_by_stage": [], "rows": []},
        "oee": [],
    }
    for snapshot in snapshots:
        for row in snapshot.get("trends") or []:
            bucket = trends_buckets[str(row.get("date"))]
            bucket["production"] += float(row.get("production") or 0.0)
            bucket["scrap"] += float(row.get("scrap") or 0.0)
        merged["scrap"].extend(snapshot.get("scrap") or [])
        live = snapshot.get("live_wip") or {}
        for key in ["live_jobs", "blocked_jobs", "completed_jobs", "overdue_jobs"]:
            merged["live_wip"]["kpis"][key] += int(((live.get("kpis") or {}).get(key)) or 0)
        for row in live.get("rows") or []:
            live_rows.append(row)
        for row in live.get("wip_by_stage") or []:
            wip_by_stage[str(row.get("stage") or "")] += int(row.get("jobs") or 0)
        for row in snapshot.get("oee") or []:
            key = (str(row.get("machine_id") or ""), str(row.get("stage_type") or ""))
            bucket = oee_buckets[key]
            bucket["machine_id"] = row.get("machine_id")
            bucket["stage_type"] = row.get("stage_type")
            for field in ["segments", "runtime_hours", "planned_hours", "planned_qty", "output_qty", "scrap_qty"]:
                bucket[field] += float(row.get(field) or 0.0)

    merged["trends"] = [
        {"date": day, "production": round(values["production"], 2), "scrap": round(values["scrap"], 2)}
        for day, values in sorted(trends_buckets.items())
    ]
    merged["scrap"] = sorted(merged["scrap"], key=lambda row: str(row.get("date") or ""))
    merged["live_wip"]["rows"] = live_rows
    merged["live_wip"]["wip_by_stage"] = [
        {"stage": stage, "jobs": count}
        for stage, count in sorted(wip_by_stage.items())
        if stage
    ]
    merged["oee"] = []
    for (_machine_id, _stage_type), bucket in sorted(oee_buckets.items()):
        planned_hours = float(bucket["planned_hours"] or 0.0)
        runtime_hours = float(bucket["runtime_hours"] or 0.0)
        planned_qty = float(bucket["planned_qty"] or 0.0)
        output_qty = float(bucket["output_qty"] or 0.0)
        scrap_qty = float(bucket["scrap_qty"] or 0.0)
        availability = (runtime_hours / planned_hours * 100.0) if planned_hours else 0.0
        quality = (output_qty / (output_qty + scrap_qty) * 100.0) if (output_qty + scrap_qty) else 0.0
        performance = (output_qty / planned_qty * 100.0) if planned_qty else 0.0
        merged["oee"].append(
            {
                "machine_id": bucket["machine_id"],
                "stage_type": bucket["stage_type"],
                "segments": int(bucket["segments"] or 0),
                "runtime_hours": round(runtime_hours, 2),
                "planned_hours": round(planned_hours, 2),
                "planned_qty": round(planned_qty, 2),
                "output_qty": round(output_qty, 2),
                "scrap_qty": round(scrap_qty, 2),
                "availability_percent": round(availability, 2),
                "quality_percent": round(quality, 2),
                "performance_percent": round(performance, 2),
                "oee_percent": round(availability * quality * performance / 10_000.0, 2),
            }
        )
    return merged


@router.get("/trends")
def production_trends(
    start_date: str = Query(...),
    end_date: str = Query(...),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    snapshot = _production_execution_snapshot(
        start_date=start_date,
        end_date=end_date,
        token=token,
        plant_scope=plant_scope,
    )
    return snapshot.get("trends") or []


@router.get("/shrink")
def production_shrink(
    start_date: str = Query(...),
    end_date: str = Query(...),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    rows = _collect_stage_rows(
        stage_type="OVEN",
        start_date=start_date,
        end_date=end_date,
        token=token,
        plant_scope=plant_scope,
    )
    response = []
    for row in rows:
        oven_in = float(row.get("input_qty") or 0.0)
        oven_out = float(row.get("output_qty") or 0.0)
        shrink = max(0.0, oven_in - oven_out)
        shrink_percent = (shrink / oven_in * 100.0) if oven_in else 0.0
        response.append(
            {
                "date": row["date"],
                "job_id": row.get("job_card_id"),
                "oven_input_weight": round(oven_in, 2),
                "oven_output_weight": round(oven_out, 2),
                "shrink_percent": round(shrink_percent, 2),
            }
        )

    return sorted(response, key=lambda item: item["date"])


@router.get("/scrap")
def production_scrap(
    start_date: str = Query(...),
    end_date: str = Query(...),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    snapshot = _production_execution_snapshot(
        start_date=start_date,
        end_date=end_date,
        token=token,
        plant_scope=plant_scope,
    )
    return snapshot.get("scrap") or []


@router.get("/winder")
def production_winder(
    start_date: str = Query(...),
    end_date: str = Query(...),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    rows = _collect_stage_rows(
        stage_type="WINDER",
        start_date=start_date,
        end_date=end_date,
        token=token,
        plant_scope=plant_scope,
    )
    winder_capacity = 0.0
    for scoped_plant_id in scope_plant_ids(plant_scope):
        machines = service_get(f"{MASTER_DATA_SERVICE_URL}/master/machines/", token, plant_id=scoped_plant_id) or []
        winder_capacity += sum(
            float(machine.get("capacity_value") or 0.0)
            for machine in machines
            if str(machine.get("department", "")).upper() == "WINDER"
        )

    buckets: dict[str, dict[str, float]] = defaultdict(
        lambda: {
            "produced_bamboo": 0.0,
            "accepted_bamboo": 0.0,
            "scrap_bamboo": 0.0,
        }
    )
    for row in rows:
        bucket = buckets[row["date"]]
        bucket["produced_bamboo"] += row["input_qty"]
        bucket["accepted_bamboo"] += row["output_qty"]
        bucket["scrap_bamboo"] += row["scrap_qty"]

    response = []
    for day, metrics in sorted(buckets.items()):
        accepted = metrics["accepted_bamboo"]
        produced = metrics["produced_bamboo"] or (accepted + metrics["scrap_bamboo"])
        utilization = (accepted / winder_capacity * 100.0) if winder_capacity > 0 else 0.0
        response.append(
            {
                "date": day,
                "produced_bamboo": round(produced, 2),
                "accepted_bamboo": round(accepted, 2),
                "scrap_bamboo": round(metrics["scrap_bamboo"], 2),
                "configured_capacity": round(winder_capacity, 2),
                "utilization_percent": round(utilization, 2),
            }
        )
    return response


@router.get("/oven")
def production_oven_analysis(
    start_date: str = Query(...),
    end_date: str = Query(...),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    rows = _collect_stage_rows(
        stage_type="OVEN",
        start_date=start_date,
        end_date=end_date,
        token=token,
        plant_scope=plant_scope,
    )
    buckets: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "bamboo_in": 0.0,
            "bamboo_out": 0.0,
            "moisture_before_sum": 0.0,
            "moisture_after_sum": 0.0,
            "moisture_count": 0,
            "cycle_sum": 0.0,
            "cycle_count": 0,
        }
    )

    for row in rows:
        bucket = buckets[row["date"]]
        entry = row["entry_snapshot"] or {}
        bucket["bamboo_in"] += row["input_qty"]
        bucket["bamboo_out"] += row["output_qty"]

        cycle_hours = _parse_cycle_hours(entry, row["planned_start"], row["planned_end"])
        if cycle_hours is not None:
            bucket["cycle_sum"] += cycle_hours
            bucket["cycle_count"] += 1

        for key, target in [("moisture_before", "moisture_before_sum"), ("moisture_after", "moisture_after_sum")]:
            try:
                bucket[target] += float(entry.get(key))
                bucket["moisture_count"] += 1
            except (TypeError, ValueError):
                continue

    response = []
    for day, metrics in sorted(buckets.items()):
        avg_cycle = metrics["cycle_sum"] / metrics["cycle_count"] if metrics["cycle_count"] else 0.0
        avg_moisture_before = (
            metrics["moisture_before_sum"] / metrics["moisture_count"] if metrics["moisture_count"] else 0.0
        )
        avg_moisture_after = (
            metrics["moisture_after_sum"] / metrics["moisture_count"] if metrics["moisture_count"] else 0.0
        )
        response.append(
            {
                "date": day,
                "bamboo_in": round(metrics["bamboo_in"], 2),
                "bamboo_out": round(metrics["bamboo_out"], 2),
                "avg_cycle_hours": round(avg_cycle, 2),
                "avg_moisture_before": round(avg_moisture_before, 2),
                "avg_moisture_after": round(avg_moisture_after, 2),
            }
        )
    return response


@router.get("/process")
def production_process_analysis(
    start_date: str = Query(...),
    end_date: str = Query(...),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    rows = _collect_stage_rows(
        stage_type="PROCESS",
        start_date=start_date,
        end_date=end_date,
        token=token,
        plant_scope=plant_scope,
    )
    buckets: dict[str, dict[str, float]] = defaultdict(
        lambda: {
            "input_tubes": 0.0,
            "output_tubes": 0.0,
            "scrap_tubes": 0.0,
        }
    )
    for row in rows:
        bucket = buckets[row["date"]]
        bucket["input_tubes"] += row["input_qty"]
        bucket["output_tubes"] += row["output_qty"]
        bucket["scrap_tubes"] += row["scrap_qty"]

    response = []
    for day, metrics in sorted(buckets.items()):
        input_qty = metrics["input_tubes"] if metrics["input_tubes"] > 0 else (metrics["output_tubes"] + metrics["scrap_tubes"])
        yield_percent = (metrics["output_tubes"] / input_qty * 100.0) if input_qty > 0 else 0.0
        response.append(
            {
                "date": day,
                "input_tubes": round(input_qty, 2),
                "output_tubes": round(metrics["output_tubes"], 2),
                "scrap_tubes": round(metrics["scrap_tubes"], 2),
                "yield_percent": round(yield_percent, 2),
            }
        )
    return response


@router.get("/live-wip")
def production_live_wip(
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    today = datetime.utcnow().date()
    snapshot = _production_execution_snapshot(
        start_date=(today.replace(day=1)).isoformat(),
        end_date=today.isoformat(),
        token=token,
        plant_scope=plant_scope,
    )
    return snapshot.get("live_wip") or {"kpis": {}, "wip_by_stage": [], "rows": []}


@router.get("/oee")
def production_oee(
    start_date: str = Query(...),
    end_date: str = Query(...),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    snapshot = _production_execution_snapshot(
        start_date=start_date,
        end_date=end_date,
        token=token,
        plant_scope=plant_scope,
    )
    return snapshot.get("oee") or []


@router.get("/consumption-variance")
def production_consumption_variance(
    start_date: str = Query(...),
    end_date: str = Query(...),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    start, end = parse_date_range(start_date, end_date)
    response: list[dict[str, Any]] = []
    for scoped_plant_id in scope_plant_ids(plant_scope):
        cards = service_get(
            f"{PRODUCTION_SERVICE_URL}/job-cards",
            token,
            params={"limit": 500},
            plant_id=scoped_plant_id,
        )
        for card in cards or []:
            detail = service_get(
                f"{PRODUCTION_SERVICE_URL}/job-cards/{card.get('id')}",
                token,
                plant_id=scoped_plant_id,
            )
            created_at = _parse_datetime(detail.get("created_at"))
            if not created_at or created_at.date() < start or created_at.date() > end:
                continue
            theoretical_total = 0.0
            theoretical_consumption = ((detail.get("material_plan_snapshot") or {}).get("theoretical_consumption") or {})
            if isinstance(theoretical_consumption, dict):
                for value in theoretical_consumption.values():
                    try:
                        theoretical_total += float(value)
                    except (TypeError, ValueError):
                        continue
            actual_total = 0.0
            allocations: list[dict[str, Any]] = []
            for stage in detail.get("stages") or []:
                for allocation in stage.get("material_allocations") or []:
                    allocations.append(allocation)
                    try:
                        actual_total += float(allocation.get("qty") or allocation.get("weight_kg") or allocation.get("issued_qty") or 0.0)
                    except (TypeError, ValueError):
                        continue
            response.append(
                {
                    "job_card_id": detail.get("id"),
                    "sales_order_id": detail.get("sales_order_id"),
                    "planned_qty": float(detail.get("planned_qty") or 0.0),
                    "theoretical_consumption": round(theoretical_total, 2),
                    "actual_consumption": round(actual_total, 2),
                    "variance": round(actual_total - theoretical_total, 2),
                    "allocation_count": len(allocations),
                }
            )
    return sorted(response, key=lambda row: abs(float(row["variance"])), reverse=True)
