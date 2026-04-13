from fastapi import APIRouter, Depends, Request
import os

from src.middleware.auth import get_token
from src.services.http_client import proxy_to_service

router = APIRouter()
PRODUCTION_SERVICE_URL = os.getenv("PRODUCTION_SERVICE_URL", "http://localhost:28004")
MASTER_SERVICE_URL = os.getenv("MASTER_SERVICE_URL", "http://localhost:28002")


@router.get("/jobs")
async def get_jobs(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/jobs/", request, token)


@router.post("/jobs")
async def create_job(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/jobs/", request, token)


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, f"/jobs/{job_id}", request, token)


@router.get("/jobs/{job_id}/print-card")
async def get_job_print_card(job_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, f"/jobs/{job_id}/print-card", request, token)


@router.get("/jobs/{job_id}/loss")
async def get_job_loss(job_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, f"/jobs/{job_id}/loss", request, token)


@router.get("/jobs/{job_id}/summary")
async def get_job_summary(job_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, f"/jobs/{job_id}/summary", request, token)


@router.put("/jobs/{job_id}")
async def update_job(job_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, f"/jobs/{job_id}", request, token)


@router.post("/jobs/{job_id}/validate")
async def validate_job(job_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, f"/jobs/{job_id}/validate", request, token)


@router.post("/jobs/{job_id}/close")
async def close_job(job_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, f"/jobs/{job_id}/close", request, token)


@router.post("/jobs/{job_id}/reels")
async def add_reel_issue(job_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, f"/jobs/{job_id}/reels", request, token)


@router.get("/jobs/{job_id}/reels")
async def list_reel_issues(job_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, f"/jobs/{job_id}/reels", request, token)


@router.get("/machines")
async def get_machines(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, "/master/machines/", request, token)
