from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
from pydantic import BaseModel, Field
import uuid

from ..database import get_db
from ..models import Dispatch, JobCard, SalesOrder
from ..utils.auth import require_role

router = APIRouter(prefix="/dispatch", tags=["dispatch"])

class DispatchPayload(BaseModel):
    job_card_id: uuid.UUID
    dispatch_snapshot: dict
    status: str = Field(..., pattern="^(DRAFT|SEALED)$")

class DispatchResponse(DispatchPayload):
    id: uuid.UUID
    created_at: datetime

    class Config:
        orm_mode = True

@router.post("/", response_model=DispatchResponse)
def create_or_update_dispatch(
    payload: DispatchPayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_role(["Admin", "Supervisor", "Logistics", "Store"]))
):
    # Check if job card exists
    job_card = db.query(JobCard).filter(JobCard.id == payload.job_card_id).first()
    if not job_card:
        raise HTTPException(status_code=404, detail="Job Card not found")

    # Check if a dispatch already exists
    dispatch = db.query(Dispatch).filter(Dispatch.job_card_id == payload.job_card_id).first()

    if dispatch:
        if dispatch.status == "SEALED":
            raise HTTPException(status_code=400, detail="Cannot edit a SEALED dispatch")
        dispatch.dispatch_snapshot = payload.dispatch_snapshot
        dispatch.status = payload.status
    else:
        dispatch = Dispatch(
            job_card_id=payload.job_card_id,
            dispatch_snapshot=payload.dispatch_snapshot,
            status=payload.status
        )
        db.add(dispatch)

    if payload.status == "SEALED":
        # Mark Job Card as dispatched
        job_card.status = "COMPLETED"

    db.commit()
    db.refresh(dispatch)
    return dispatch

@router.get("/{dispatch_id}", response_model=DispatchResponse)
def get_dispatch(
    dispatch_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_role(["Admin", "Supervisor", "Logistics", "Store"]))
):
    dispatch = db.query(Dispatch).filter(Dispatch.id == dispatch_id).first()
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch not found")
    return dispatch

@router.get("/by-job/{job_card_id}", response_model=Optional[DispatchResponse])
def get_dispatch_by_job_card(
    job_card_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_role(["Admin", "Supervisor", "Logistics", "Store"]))
):
    dispatch = db.query(Dispatch).filter(Dispatch.job_card_id == job_card_id).first()
    return dispatch

@router.get("/ready-jobs/", response_model=list[dict])
def get_ready_jobs_for_dispatch(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_role(["Admin", "Supervisor", "Logistics", "Store"]))
):
    """
    Returns job cards that are candidates for dispatch, meaning they have reached
    PACKING or DONE stages, or their corresponding dispatches are sealed (so we can view them).
    """
    results = (
        db.query(JobCard, SalesOrder, Dispatch)
        .join(SalesOrder, JobCard.sales_order_id == SalesOrder.id)
        .outerjoin(Dispatch, JobCard.id == Dispatch.job_card_id)
        .filter(JobCard.current_stage.in_(["PROCESS", "PACKING", "DONE"]))
        .order_by(JobCard.created_at.desc())
        .all()
    )

    valid_jobs = []
    for jc, so, dispatch in results:
        valid_jobs.append({
            "id": jc.id,
            "status": jc.status,
            "current_stage": jc.current_stage,
            "spec_snapshot": jc.spec_snapshot,
            "planned_qty": jc.planned_qty,
            "customer_id": so.customer_id,
            "dispatch_status": dispatch.status if dispatch else None,
            "dispatch_id": dispatch.id if dispatch else None,
            "created_at": jc.created_at
        })

    return valid_jobs
