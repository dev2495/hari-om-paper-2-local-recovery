from fastapi import APIRouter, Depends, Request
import os

from src.middleware.auth import get_token
from src.services.http_client import proxy_to_service

router = APIRouter()
PRODUCTION_SERVICE_URL = os.getenv("PRODUCTION_SERVICE_URL", "http://127.0.0.1:18004")
MASTER_SERVICE_URL = os.getenv("MASTER_SERVICE_URL", "http://127.0.0.1:18002")


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


@router.post("/sales-orders")
async def create_planning_sales_order(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/sales-orders", request, token)


@router.post("/job-cards")
async def create_planning_job_card(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/job-cards", request, token)


@router.get("/job-cards")
async def get_planning_job_cards(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/job-cards", request, token)


@router.get("/job-cards/{job_card_id}")
async def get_planning_job_card(job_card_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, f"/job-cards/{job_card_id}", request, token)


@router.get("/planning/queues")
async def get_planning_queue(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/planning/queues", request, token)


@router.get("/planning/board")
async def get_planning_board(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/planning/board", request, token)


@router.get("/planning/export")
async def export_planning_board(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/planning/export", request, token)


@router.patch("/planning/queues/reorder")
async def reorder_planning_queue(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/planning/queues/reorder", request, token)


@router.post("/planning/board/move")
@router.patch("/planning/board/move")
async def move_planning_board(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/planning/board/move", request, token, force_method="PATCH")


@router.post("/planning/board/split")
async def split_planning_segment(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/planning/segments/split", request, token)


@router.post("/job-cards/{job_card_id}/assign-machine")
async def assign_machine(job_card_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, f"/job-cards/{job_card_id}/assign-machine", request, token)


@router.post("/job-cards/{job_card_id}/stage-output")
async def post_stage_output(job_card_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, f"/job-cards/{job_card_id}/stage-output", request, token)


@router.post("/shift-material-ledger")
async def create_shift_material_ledger(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/reconciliation/shift-ledger", request, token)


@router.get("/shift-material-ledger")
async def get_shift_material_ledger(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/reconciliation/shift-ledger", request, token)


@router.get("/shift-material-retally")
async def get_shift_material_retally(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/reconciliation/shift-ledger/retally", request, token)


@router.get("/plant-retally-summary")
async def get_plant_retally_summary(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/reconciliation/summary", request, token)


@router.get("/monthly-material-summary")
async def get_monthly_material_summary(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/reconciliation/monthly-summary", request, token)


@router.get("/monthly-close-state")
async def get_monthly_close_state(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/reconciliation/monthly-close", request, token)


@router.post("/import-monthly-actuals")
async def import_monthly_actuals(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/reconciliation/monthly-actuals/import", request, token)


@router.post("/approve-monthly-close")
async def approve_monthly_close(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/reconciliation/monthly-close/approve", request, token)
