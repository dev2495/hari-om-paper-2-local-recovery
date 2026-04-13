import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ProductionJob
from ..utils.auth import get_current_user, get_current_plant

router = APIRouter(tags=["reports"])


def _ensure_job(job_id: uuid.UUID, db: Session, plant_id: str) -> ProductionJob:
    job = db.query(ProductionJob).filter(
        ProductionJob.id == job_id,
        ProductionJob.plant_id == plant_id
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found in this plant")
    return job


@router.get("/jobs/{job_id}/loss")
def bamboo_loss_report(
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user),
):
    job = _ensure_job(job_id, db, plant_id)

    return {
        "job_id": str(job.id),
        "job_state": job.job_state,
        "piece_variance_percent": round(job.piece_variance_percent or 0.0, 4),
        "weight_variance_percent": round(job.weight_variance_percent or 0.0, 4),
        "severity": job.variance_severity or "unknown",
        "expected_tubes_per_bamboo": job.expected_tubes_per_bamboo,
        "expected_tube_weight": job.expected_tube_weight,
        "actual_tubes_produced": job.tubes_produced_qty,
        "actual_finished_weight": job.finished_weight,
    }


@router.get("/jobs/{job_id}/summary")
def get_job_summary(
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user),
):
    job = _ensure_job(job_id, db, plant_id)

    return {
        "job_id": str(job.id),
        "date": str(job.date),
        "shift": job.shift,
        "operator": job.operator_name,
        "supervisor": job.supervisor_name,
        "state": job.job_state,
        "production": {
            "bamboo_produced_qty": job.bamboo_produced_qty,
            "bamboo_scrap_qty": job.bamboo_scrap_qty,
            "tubes_produced_qty": job.tubes_produced_qty,
            "tube_scrap_qty": job.tube_scrap_qty,
            "finished_weight": job.finished_weight,
            "actual_cs": job.actual_cs,
        },
        "variance": {
            "piece_variance_percent": round(job.piece_variance_percent or 0.0, 4),
            "weight_variance_percent": round(job.weight_variance_percent or 0.0, 4),
            "severity": job.variance_severity,
        },
        "fg_posting": {
            "posted": job.fg_posted,
            "reference": job.fg_transaction_ref,
            "closed_at": job.closed_at.isoformat() if job.closed_at else None,
        },
    }
