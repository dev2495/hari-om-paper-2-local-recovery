from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from src.dependencies import require_capability
from src.job_queue import queue_summary, recent_jobs

router = APIRouter(prefix="/jobs", tags=["Background Jobs"])

# The job queue spans every plant: Owner/Admin only (a bare token is not enough).
_system_only = require_capability("system:manage")


@router.get("/summary")
def background_jobs_summary(current_user: dict = Depends(_system_only)) -> dict:
    return queue_summary()


@router.get("/recent")
def background_jobs_recent(
    limit: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(_system_only),
) -> dict:
    return {"items": recent_jobs(limit=limit), "limit": limit}
