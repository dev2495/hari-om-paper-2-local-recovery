from fastapi import APIRouter, Depends, Request
import os

from src.middleware.auth import get_token
from src.services.http_client import proxy_to_service

router = APIRouter()
PRODUCTION_SERVICE_URL = os.getenv("PRODUCTION_SERVICE_URL", "http://localhost:28004")

@router.get("/ready-jobs")
async def get_ready_jobs_for_dispatch(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/dispatch/ready-jobs/", request, token)

@router.get("/by-job/{job_card_id}")
async def get_dispatch_by_job_card(job_card_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, f"/dispatch/by-job/{job_card_id}", request, token)

@router.post("/")
async def create_or_update_dispatch(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/dispatch/", request, token)

@router.get("/{dispatch_id}")
async def get_dispatch(dispatch_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, f"/dispatch/{dispatch_id}", request, token)
