from fastapi import APIRouter, Depends, Query
from typing import List, Dict, Any
from collections import defaultdict
from src.dependencies import get_token, get_plant_scope
from src.utils import service_get, scope_plant_ids
from src.config import PRODUCTION_SERVICE_URL
from src.date_utils import parse_iso_date

router = APIRouter(prefix="/production", tags=["Production"])

@router.get("/trends")
def production_trends(
    start_date: str = Query(...),
    end_date: str = Query(...),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    start = parse_iso_date(start_date)
    end = parse_iso_date(end_date)
    jobs: List[Dict[str, Any]] = []
    for scoped_plant_id in scope_plant_ids(plant_scope):
        jobs.extend(service_get(f"{PRODUCTION_SERVICE_URL}/jobs/", token, plant_id=scoped_plant_id))

    buckets = defaultdict(lambda: {"production": 0.0, "scrap": 0.0})
    for job in jobs:
        job_date = parse_iso_date(job["date"])
        if start <= job_date <= end:
            key = job_date.isoformat()
            buckets[key]["production"] += float(job.get("finished_weight", 0.0))
            buckets[key]["scrap"] += float(job.get("tube_scrap_qty", 0.0))

    return [
        {"date": day, "production": round(values["production"], 2), "scrap": round(values["scrap"], 2)}
        for day, values in sorted(buckets.items())
    ]

@router.get("/shrink")
def production_shrink(
    start_date: str = Query(...),
    end_date: str = Query(...),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    start = parse_iso_date(start_date)
    end = parse_iso_date(end_date)
    jobs: List[Dict[str, Any]] = []
    for scoped_plant_id in scope_plant_ids(plant_scope):
        jobs.extend(service_get(f"{PRODUCTION_SERVICE_URL}/jobs/", token, plant_id=scoped_plant_id))

    response = []
    for job in jobs:
        job_date = parse_iso_date(job["date"])
        if start <= job_date <= end:
            oven_in = float(job.get("oven_input_weight", 0.0))
            oven_out = float(job.get("oven_output_weight", 0.0))
            shrink = max(0.0, oven_in - oven_out)
            shrink_percent = (shrink / oven_in * 100.0) if oven_in else 0.0
            response.append(
                {
                    "date": job_date.isoformat(),
                    "job_id": job.get("id"),
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
    start = parse_iso_date(start_date)
    end = parse_iso_date(end_date)
    jobs: List[Dict[str, Any]] = []
    for scoped_plant_id in scope_plant_ids(plant_scope):
        jobs.extend(service_get(f"{PRODUCTION_SERVICE_URL}/jobs/", token, plant_id=scoped_plant_id))

    response = []
    for job in jobs:
        job_date = parse_iso_date(job["date"])
        if start <= job_date <= end:
            tubes = float(job.get("tubes_produced_qty", 0.0))
            scrap = float(job.get("tube_scrap_qty", 0.0))
            scrap_percent = (scrap / tubes * 100.0) if tubes else 0.0
            response.append(
                {
                    "date": job_date.isoformat(),
                    "job_id": job.get("id"),
                    "tubes_produced_qty": tubes,
                    "tube_scrap_qty": scrap,
                    "scrap_percent": round(scrap_percent, 2),
                    "severity": job.get("variance_severity"),
                }
            )

    return sorted(response, key=lambda item: item["date"])

@router.get("/winder")
def production_winder(
    start_date: str = Query(...),
    end_date: str = Query(...),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    # Based on stage entry_snapshots where stage_type == WINDER
    pass

@router.get("/oven")
def production_oven_analysis():
    pass

@router.get("/process")
def production_process_analysis():
    pass
