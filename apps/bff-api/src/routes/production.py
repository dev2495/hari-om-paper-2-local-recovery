from fastapi import APIRouter, Depends, Request
import os

from src.middleware.auth import get_token
from src.services.books_guard import invalidate_books_cache
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


@router.get("/quality/inspections")
async def list_quality_inspections(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/quality/inspections", request, token)


@router.post("/quality/inspections")
async def create_quality_inspection(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/quality/inspections", request, token)


@router.get("/quality/holds")
async def list_quality_holds(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/quality/holds", request, token)


@router.post("/quality/holds")
async def create_quality_hold(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/quality/holds", request, token)


@router.post("/quality/holds/{hold_id}/release")
async def release_quality_hold(hold_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, f"/quality/holds/{hold_id}/release", request, token)


@router.post("/machines")
async def create_machine(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, "/master/machines/", request, token)


@router.put("/machines/{machine_id}")
async def update_machine(machine_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/machines/{machine_id}", request, token)


@router.delete("/machines/{machine_id}")
async def delete_machine(machine_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/machines/{machine_id}", request, token)


@router.post("/sales-orders")
async def create_planning_sales_order(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/sales-orders", request, token)


@router.post("/job-cards")
async def create_planning_job_card(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/job-cards", request, token)


@router.post("/sales-orders/{sales_order_id}/release-sync")
async def release_sync_sales_order(sales_order_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, f"/sales-orders/{sales_order_id}/release-sync", request, token)


@router.get("/job-cards")
async def list_planning_job_cards(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/job-cards", request, token)


@router.get("/job-cards/{job_card_id}")
async def get_planning_job_card(job_card_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, f"/job-cards/{job_card_id}", request, token)


@router.get("/genealogy/job-cards/{job_card_id}")
async def get_job_card_genealogy(job_card_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, f"/genealogy/job-cards/{job_card_id}", request, token)


@router.get("/planning/queues")
async def get_planning_queues(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/planning/queues", request, token)


@router.get("/planning/board")
async def get_planning_board(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/planning/board", request, token)


@router.patch("/planning/queues/reorder")
async def reorder_planning_queue(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/planning/queues/reorder", request, token)


@router.patch("/planning/board/move")
async def move_planning_board(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/planning/board/move", request, token)


@router.post("/job-cards/{job_card_id}/assign-machine")
async def assign_planning_machine(job_card_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, f"/job-cards/{job_card_id}/assign-machine", request, token)


@router.post("/job-cards/{job_card_id}/stage-output")
async def post_planning_stage_output(job_card_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, f"/job-cards/{job_card_id}/stage-output", request, token)


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


@router.get("/monthly-close-history")
async def get_monthly_close_history(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/reconciliation/monthly-close/history", request, token)


@router.post("/import-monthly-actuals")
async def import_monthly_actuals(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(PRODUCTION_SERVICE_URL, "/reconciliation/monthly-actuals/import", request, token)


@router.post("/approve-monthly-close")
async def approve_monthly_close(request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(PRODUCTION_SERVICE_URL, "/reconciliation/monthly-close/approve", request, token)
    # Bust the books-locked cache so the next mutation in /inventory sees the
    # newly locked period without a 60-second stale window.
    if 200 <= response.status_code < 300:
        plant_id = request.headers.get("X-Plant-ID", "")
        if plant_id:
            await invalidate_books_cache(plant_id)
        else:
            await invalidate_books_cache(None)
    return response


# ──────────────────────────────────────────────────────────────────────────
# Lifecycle gaps — new BFF endpoints
# ──────────────────────────────────────────────────────────────────────────


@router.get("/period-state/{month}")
async def get_period_state(month: str, request: Request, token: str = Depends(get_token)):
    """Gap 4: joint cert+reco posture for a month."""
    return await proxy_to_service(
        PRODUCTION_SERVICE_URL, f"/reconciliation/period-state/{month}", request, token
    )


@router.get("/weekly-drift")
async def get_weekly_drift(request: Request, token: str = Depends(get_token)):
    """Gap 9: read-only early-warning drift for a 7-day window."""
    return await proxy_to_service(
        PRODUCTION_SERVICE_URL, "/reconciliation/weekly-drift", request, token
    )


@router.get("/books-state")
async def get_books_state(request: Request, token: str = Depends(get_token)):
    """Gap 10: workspace-wide books-locked posture."""
    return await proxy_to_service(
        PRODUCTION_SERVICE_URL, "/reconciliation/books-state", request, token
    )


@router.get("/tolerance-settings")
async def get_tolerance_settings(request: Request, token: str = Depends(get_token)):
    """Variance tolerance values surfaced for the UI."""
    return await proxy_to_service(
        PRODUCTION_SERVICE_URL, "/reconciliation/tolerance-settings", request, token
    )


@router.put("/tolerance-settings")
async def put_tolerance_settings(request: Request, token: str = Depends(get_token)):
    """Owner/Admin only — upsert the per-plant tolerance row."""
    return await proxy_to_service(
        PRODUCTION_SERVICE_URL, "/reconciliation/tolerance-settings", request, token
    )
