from datetime import date, datetime
import math
from typing import Optional
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import String, cast, or_
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import ProductionJob, ReelIssue
from ..utils.auth import get_current_user, require_role, get_current_plant, get_current_plant_scope

router = APIRouter(prefix="/jobs", tags=["jobs"])
settings = get_settings()


def _reference_search_terms(value: str) -> list[str]:
    text = str(value or "").strip()
    if not text:
        return []
    if text.upper() in {"JC", "JOB", "JOB CARD", "JOB-CARD", "SO", "LINE"}:
        return []
    terms = [text]
    upper = text.upper()
    for prefix in ("JC-", "SO-", "LINE-"):
        if upper.startswith(prefix) and len(text) > len(prefix):
            terms.append(text[len(prefix):])
    compact = text.replace("-", "")
    if compact and compact != text:
        terms.append(compact)
    return list(dict.fromkeys(term for term in terms if term))


def _to_uuid(value) -> uuid.UUID:
    if isinstance(value, uuid.UUID):
        return value
    return uuid.UUID(str(value))


def _apply_plant_scope_filter(query, column, plant_scope: dict):
    if plant_scope.get("scope_all"):
        allowed_plants = plant_scope.get("allowed_plants") or []
        if allowed_plants:
            return query.filter(column.in_([_to_uuid(value) for value in allowed_plants]))
        return query
    return query.filter(column == _to_uuid(plant_scope["selected_plant_id"]))


class JobCreate(BaseModel):
    date: date
    shift: str
    sales_order_id: Optional[uuid.UUID] = None
    sales_order_line_id: Optional[uuid.UUID] = None
    spec_id: uuid.UUID
    recipe_id: uuid.UUID
    planned_tubes_qty: float = 0.0
    parchment_color: Optional[str] = None
    operator_name: str
    supervisor_name: Optional[str] = None
    mandrel_id: uuid.UUID
    total_reel_weight_issued: float
    bamboo_produced_qty: int = 0
    bamboo_scrap_qty: int = 0
    bamboo_weight_total: float = 0.0
    oven_input_weight: float = 0.0
    oven_output_weight: float = 0.0
    tubes_produced_qty: int = 0
    tube_scrap_qty: int = 0
    finished_weight: float = 0.0
    actual_cs: Optional[float] = None
    notes: Optional[str] = None
    tube_length_mm: int = 150


class JobUpdate(BaseModel):
    operator_name: Optional[str] = None
    supervisor_name: Optional[str] = None
    planned_tubes_qty: Optional[float] = None
    parchment_color: Optional[str] = None
    total_reel_weight_issued: Optional[float] = None
    bamboo_produced_qty: Optional[int] = None
    bamboo_scrap_qty: Optional[int] = None
    bamboo_weight_total: Optional[float] = None
    oven_input_weight: Optional[float] = None
    oven_output_weight: Optional[float] = None
    tubes_produced_qty: Optional[int] = None
    tube_scrap_qty: Optional[int] = None
    finished_weight: Optional[float] = None
    actual_cs: Optional[float] = None
    notes: Optional[str] = None
    tube_length_mm: Optional[int] = None
    job_state: Optional[str] = None


class ValidateJobPayload(BaseModel):
    expected_tube_weight: Optional[float] = None
    expected_tubes_per_bamboo: Optional[float] = None


class CloseJobPayload(BaseModel):
    fg_item_id: uuid.UUID
    fg_batch_no: Optional[str] = None
    idempotency_key: Optional[str] = None


class JobResponse(BaseModel):
    id: uuid.UUID
    job_card_no: Optional[str]
    plant_id: str
    date: date
    shift: str
    sales_order_id: Optional[uuid.UUID]
    sales_order_line_id: Optional[uuid.UUID]
    spec_id: uuid.UUID
    recipe_id: uuid.UUID
    planned_tubes_qty: float
    parchment_color: Optional[str]
    operator_name: str
    supervisor_name: Optional[str]
    mandrel_id: uuid.UUID
    total_reel_weight_issued: float
    bamboo_produced_qty: int
    bamboo_scrap_qty: int
    bamboo_weight_total: float
    oven_input_weight: float
    oven_output_weight: float
    tubes_produced_qty: int
    tube_scrap_qty: int
    finished_weight: float
    actual_cs: Optional[float]
    notes: Optional[str]
    job_state: str
    tube_length_mm: int
    expected_tubes_per_bamboo: Optional[float]
    expected_tube_weight: Optional[float]
    piece_variance_percent: Optional[float]
    weight_variance_percent: Optional[float]
    variance_severity: Optional[str]
    fg_posted: bool
    fg_transaction_ref: Optional[str]
    created_at: datetime
    validated_at: Optional[datetime]
    validated_by: Optional[str]
    closed_at: Optional[datetime]
    closed_by: Optional[str]

    class Config:
        from_attributes = True


def _fetch_spec(spec_id: uuid.UUID, token: str, plant_id: str) -> dict:
    with httpx.Client(timeout=10.0) as client:
        response = client.get(
            f"{settings.SPEC_SERVICE_URL}/specs/{spec_id}",
            headers={
                "Authorization": f"Bearer {token}",
                "X-Plant-ID": plant_id
            },
        )
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Unable to validate specification")
    return response.json()


def _fetch_recipe(recipe_id: uuid.UUID, token: str, plant_id: str) -> dict:
    with httpx.Client(timeout=10.0) as client:
        response = client.get(
            f"{settings.SPEC_SERVICE_URL}/recipes/{recipe_id}",
            headers={
                "Authorization": f"Bearer {token}",
                "X-Plant-ID": plant_id
            },
        )
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Unable to validate recipe")
    return response.json()


def _fetch_sales_order(order_id: uuid.UUID, token: str, plant_id: str) -> dict:
    with httpx.Client(timeout=10.0) as client:
        response = client.get(
            f"{settings.SALES_SERVICE_URL}/sales-orders/{order_id}",
            headers={
                "Authorization": f"Bearer {token}",
                "X-Plant-ID": plant_id
            },
        )
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Unable to validate sales order")
    return response.json()


def _fetch_sales_order_line(line_id: uuid.UUID, token: str, plant_id: str) -> dict:
    with httpx.Client(timeout=10.0) as client:
        response = client.get(
            f"{settings.SALES_SERVICE_URL}/sales-orders/lines/{line_id}",
            headers={
                "Authorization": f"Bearer {token}",
                "X-Plant-ID": plant_id
            },
        )
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Unable to validate sales order line")
    return response.json()


def _next_job_card_no(db: Session) -> str:
    date_part = datetime.utcnow().strftime("%Y%m%d")
    prefix = f"JC-{date_part}-"
    count = db.query(ProductionJob).filter(ProductionJob.job_card_no.like(f"{prefix}%")).count()
    return f"{prefix}{count + 1:04d}"


def _severity(piece_var: float, weight_var: float) -> str:
    peak = max(abs(piece_var), abs(weight_var))
    if peak >= settings.BAMBOO_CRITICAL_PERCENT:
        return "critical"
    if peak >= settings.BAMBOO_WARNING_PERCENT:
        return "warning"
    return "normal"


@router.post("/", response_model=JobResponse)
def create_job(
    job: JobCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["PlantManager", "Admin"])),
):
    payload = job.model_dump()
    payload["job_card_no"] = _next_job_card_no(db)
    payload["plant_id"] = plant_id

    if not job.sales_order_id or not job.sales_order_line_id:
        raise HTTPException(
            status_code=400,
            detail="SO-first workflow is enforced: sales_order_id and sales_order_line_id are required",
        )

    token = current_user.get("token", "")
    sales_order = _fetch_sales_order(job.sales_order_id, token, plant_id)
    if sales_order.get("status") not in ["released", "partially_dispatched"]:
        raise HTTPException(status_code=400, detail="Sales order must be released before job card creation")

    order_line = None
    for line in sales_order.get("lines", []):
        if line.get("id") == str(job.sales_order_line_id):
            order_line = line
            break
    if not order_line:
        order_line = _fetch_sales_order_line(job.sales_order_line_id, token, plant_id)

    if str(order_line.get("approved_spec_id")) != str(job.spec_id):
        raise HTTPException(status_code=400, detail="Job spec must match sales order line spec")

    if (payload.get("planned_tubes_qty") or 0) <= 0:
        payload["planned_tubes_qty"] = float(order_line.get("qty") or 0.0)

    if not payload.get("parchment_color"):
        payload["parchment_color"] = order_line.get("parchment_color")

    db_job = ProductionJob(**payload, job_state="submitted")
    db.add(db_job)
    db.commit()
    db.refresh(db_job)
    return db_job


@router.get("/", response_model=list[JobResponse])
def get_jobs(
    date: Optional[date] = Query(None),
    shift: Optional[str] = Query(None),
    operator_name: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    query = _apply_plant_scope_filter(db.query(ProductionJob), ProductionJob.plant_id, plant_scope)
    if date:
        query = query.filter(ProductionJob.date == date)
    if shift:
        query = query.filter(ProductionJob.shift == shift)
    if operator_name:
        query = query.filter(ProductionJob.operator_name.ilike(f"%{operator_name}%"))
    if state:
        query = query.filter(ProductionJob.job_state == state)
    if search and search.strip():
        conditions = []
        for term in _reference_search_terms(search):
            needle = f"%{term}%"
            conditions.extend(
                [
                    ProductionJob.job_card_no.ilike(needle),
                    ProductionJob.operator_name.ilike(needle),
                    ProductionJob.supervisor_name.ilike(needle),
                    cast(ProductionJob.id, String).ilike(needle),
                    cast(ProductionJob.sales_order_id, String).ilike(needle),
                ]
            )
        if conditions:
            query = query.filter(
                or_(*conditions)
            )
    return query.order_by(ProductionJob.date.desc(), ProductionJob.created_at.desc()).all()


@router.get("/{job_id}", response_model=JobResponse)
def get_job(
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user),
):
    job = db.query(ProductionJob).filter(
        ProductionJob.id == job_id,
        ProductionJob.plant_id == plant_id
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/{job_id}/print-card")
def get_job_print_card(
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user),
):
    job = db.query(ProductionJob).filter(
        ProductionJob.id == job_id,
        ProductionJob.plant_id == plant_id
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    token = current_user.get("token", "")
    spec = _fetch_spec(job.spec_id, token, plant_id)
    recipe = _fetch_recipe(job.recipe_id, token, plant_id)

    order_snapshot = None
    line_snapshot = None
    if job.sales_order_id:
        try:
            order_snapshot = _fetch_sales_order(job.sales_order_id, token, plant_id)
        except HTTPException:
            order_snapshot = None
    if job.sales_order_line_id:
        try:
            line_snapshot = _fetch_sales_order_line(job.sales_order_line_id, token, plant_id)
        except HTTPException:
            line_snapshot = None

    return {
        "job": {
            "id": str(job.id),
            "job_card_no": job.job_card_no,
            "date": str(job.date),
            "shift": job.shift,
            "job_state": job.job_state,
            "operator_name": job.operator_name,
            "supervisor_name": job.supervisor_name,
            "planned_tubes_qty": job.planned_tubes_qty,
            "parchment_color": job.parchment_color,
            "tube_length_mm": job.tube_length_mm,
            "mandrel_id": str(job.mandrel_id),
            "sales_order_id": str(job.sales_order_id) if job.sales_order_id else None,
            "sales_order_line_id": str(job.sales_order_line_id) if job.sales_order_line_id else None,
        },
        "spec": {
            "id": str(spec.get("id")),
            "customer_name": spec.get("customer_name"),
            "tube_size_id": spec.get("tube_size_id"),
            "required_cs": spec.get("required_cs"),
            "target_tube_weight": spec.get("target_tube_weight"),
            "shrink_percent": spec.get("shrink_percent"),
            "bamboo_max_length": spec.get("bamboo_max_length"),
            "cut_loss_mm": spec.get("cut_loss_mm"),
            "status": spec.get("status"),
        },
        "recipe": {
            "id": str(recipe.get("id")),
            "version": recipe.get("version"),
            "status": recipe.get("status"),
            "layers": recipe.get("layers", []),
        },
        "sales_order": order_snapshot,
        "sales_order_line": line_snapshot,
    }


@router.put("/{job_id}", response_model=JobResponse)
def update_job(
    job_id: uuid.UUID,
    job_update: JobUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["PlantManager", "Admin"])),
):
    db_job = db.query(ProductionJob).filter(
        ProductionJob.id == job_id,
        ProductionJob.plant_id == plant_id
    ).first()
    if not db_job:
        raise HTTPException(status_code=404, detail="Job not found")

    if db_job.job_state == "closed":
        raise HTTPException(status_code=400, detail="Closed jobs cannot be edited")

    update_data = job_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if field == "job_state" and value not in ["draft", "submitted", "validated"]:
            raise HTTPException(status_code=400, detail="Invalid job state")
        setattr(db_job, field, value)

    db.commit()
    db.refresh(db_job)
    return db_job


@router.post("/{job_id}/validate")
def validate_job(
    job_id: uuid.UUID,
    payload: ValidateJobPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["PlantManager", "Admin"])),
):
    job = db.query(ProductionJob).filter(
        ProductionJob.id == job_id,
        ProductionJob.plant_id == plant_id
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.job_state == "closed":
        raise HTTPException(status_code=400, detail="Closed job cannot be validated")

    if job.total_reel_weight_issued <= 0:
        raise HTTPException(status_code=400, detail="Invalid reel issued weight")

    reel_issues = db.query(ReelIssue).filter(ReelIssue.job_id == job.id).all()
    if not reel_issues:
        raise HTTPException(status_code=400, detail="At least one reel issue is required")

    token = current_user.get("token", "")
    spec = _fetch_spec(job.spec_id, token)
    recipe = _fetch_recipe(job.recipe_id, token)

    if spec.get("status") != "approved" or not spec.get("active", False):
        raise HTTPException(status_code=400, detail="Specification must be active and approved")

    if recipe.get("status") != "approved":
        raise HTTPException(status_code=400, detail="Recipe must be approved")

    expected_tube_weight = payload.expected_tube_weight or spec.get("target_tube_weight")
    if expected_tube_weight is None or expected_tube_weight <= 0:
        raise HTTPException(status_code=400, detail="Expected tube weight baseline is required")

    expected_tubes_per_bamboo = payload.expected_tubes_per_bamboo
    if expected_tubes_per_bamboo is None:
        bamboo_length = spec.get("bamboo_max_length", 1560)
        cut_loss = spec.get("cut_loss_mm", 40)
        usable = max(1, bamboo_length - cut_loss)
        expected_tubes_per_bamboo = max(1.0, math.floor(usable / max(1, job.tube_length_mm)))

    expected_total_tubes = max(1.0, job.bamboo_produced_qty * expected_tubes_per_bamboo)
    piece_variance_percent = abs(expected_total_tubes - job.tubes_produced_qty) / expected_total_tubes * 100.0

    expected_total_weight = max(0.001, expected_tube_weight * max(1, job.tubes_produced_qty))
    weight_variance_percent = abs(expected_total_weight - job.finished_weight) / expected_total_weight * 100.0

    severity = _severity(piece_variance_percent, weight_variance_percent)

    job.expected_tube_weight = expected_tube_weight
    job.expected_tubes_per_bamboo = expected_tubes_per_bamboo
    job.piece_variance_percent = round(piece_variance_percent, 4)
    job.weight_variance_percent = round(weight_variance_percent, 4)
    job.variance_severity = severity
    job.job_state = "validated"
    job.validated_at = datetime.utcnow()
    job.validated_by = current_user.get("sub")

    db.commit()
    db.refresh(job)

    return {
        "message": "Job validated",
        "job_id": str(job.id),
        "job_state": job.job_state,
        "piece_variance_percent": job.piece_variance_percent,
        "weight_variance_percent": job.weight_variance_percent,
        "severity": job.variance_severity,
    }


@router.post("/{job_id}/close")
def close_job(
    job_id: uuid.UUID,
    payload: CloseJobPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["PlantManager", "Admin"])),
):
    job = db.query(ProductionJob).filter(
        ProductionJob.id == job_id,
        ProductionJob.plant_id == plant_id
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.job_state == "closed":
        return {
            "message": "Job already closed",
            "job_id": str(job.id),
            "fg_posted": job.fg_posted,
            "fg_transaction_ref": job.fg_transaction_ref,
        }

    if job.job_state != "validated":
        raise HTTPException(status_code=400, detail="Only validated jobs can be closed")

    idempotency_key = payload.idempotency_key or f"FG_CLOSE:{job.id}"
    batch_no = payload.fg_batch_no or f"FG-{str(job.id).split('-')[0]}"

    inventory_payload = {
        "item_id": str(payload.fg_item_id),
        "batch_no": batch_no,
        "qty": job.finished_weight,
        "production_job_id": str(job.id),
        "spec_id": str(job.spec_id),
        "external_ref": idempotency_key,
    }

    try:
        with httpx.Client(timeout=15.0) as client:
            inventory_response = client.post(
                f"{settings.INVENTORY_SERVICE_URL}/fg-inward/",
                json=inventory_payload,
                headers={
                    "Authorization": f"Bearer {current_user.get('token', '')}",
                    "X-Plant-ID": plant_id
                },
            )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail=f"Inventory service unavailable: {str(exc)}")

    if inventory_response.status_code != 200:
        detail = inventory_response.text
        try:
            detail = inventory_response.json().get("detail", detail)
        except Exception:
            pass
        raise HTTPException(status_code=400, detail=f"Failed FG posting: {detail}")

    inventory_result = inventory_response.json()

    job.fg_posted = True
    job.fg_transaction_ref = idempotency_key
    job.job_state = "closed"
    job.closed_at = datetime.utcnow()
    job.closed_by = current_user.get("sub")

    db.commit()
    db.refresh(job)

    return {
        "message": "Job closed and FG posted",
        "job_id": str(job.id),
        "job_state": job.job_state,
        "fg_posted": job.fg_posted,
        "fg_transaction_ref": job.fg_transaction_ref,
        "inventory_posting": inventory_result,
    }


@router.delete("/{job_id}")
def delete_job(
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    db_job = db.query(ProductionJob).filter(
        ProductionJob.id == job_id,
        ProductionJob.plant_id == plant_id
    ).first()
    if not db_job:
        raise HTTPException(status_code=404, detail="Job not found")

    db.delete(db_job)
    db.commit()
    return {"message": "Job deleted successfully"}
