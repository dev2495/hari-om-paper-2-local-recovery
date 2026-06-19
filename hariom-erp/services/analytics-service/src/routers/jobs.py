from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from src.dependencies import get_token
from src.job_queue import queue_summary, recent_jobs

router = APIRouter(prefix="/jobs", tags=["Background Jobs"])


@router.get("/summary")
def background_jobs_summary(token: str = Depends(get_token)) -> dict:
    return queue_summary()


@router.get("/recent")
def background_jobs_recent(
    limit: int = Query(50, ge=1, le=200),
    token: str = Depends(get_token),
) -> dict:
    return {"items": recent_jobs(limit=limit), "limit": limit}
