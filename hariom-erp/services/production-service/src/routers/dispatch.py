from typing import Any, Optional
import hashlib
import json
import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.orm import Session
from datetime import datetime
from pydantic import BaseModel, Field
import uuid

from ..config import get_settings
from ..database import get_db
from ..models import Dispatch, DispatchIdempotency, JobCard, PackingRecord, QualityHold, SalesOrder
from ..utils.auth import get_current_plant, require_role

router = APIRouter(prefix="/dispatch", tags=["dispatch"])
settings = get_settings()
QC_BLOCKING_STATUSES = {"HOLD"}


def _plant_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid plant_id: {value}") from exc


def _request_hash(payload: "DispatchPayload") -> str:
    payload_data = payload.model_dump(mode="json") if hasattr(payload, "model_dump") else payload.dict()
    blob = json.dumps(payload_data, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _safe_flag_modified(instance: Any, key: str) -> None:
    if hasattr(instance, "_sa_instance_state"):
        flag_modified(instance, key)

class DispatchPayload(BaseModel):
    job_card_id: uuid.UUID
    dispatch_snapshot: dict
    status: str = Field(..., pattern="^(DRAFT|SEALED)$")
    dispatch_request_id: Optional[str] = None
    sales_order_line_id: Optional[uuid.UUID] = None
    fg_item_id: Optional[uuid.UUID] = None
    fg_batch_id: Optional[uuid.UUID] = None
    dispatch_qty: Optional[float] = None

class DispatchResponse(DispatchPayload):
    id: uuid.UUID
    created_at: datetime

    class Config:
        orm_mode = True


def _number(value: Any) -> Optional[float]:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _dispatch_qty(snapshot: dict[str, Any], job_card: JobCard, packing_record: Optional[PackingRecord]) -> float:
    for key in ["qty", "dispatch_qty", "quantity", "total_qty", "packed_qty"]:
        value = _number(snapshot.get(key))
        if value and value > 0:
            return value

    items = snapshot.get("items")
    if isinstance(items, list):
        total = 0.0
        for item in items:
            if not isinstance(item, dict):
                continue
            total += _number(item.get("qty") or item.get("quantity") or item.get("dispatch_qty")) or 0.0
        if total > 0:
            return total

    if packing_record and float(packing_record.total_packed_qty or 0.0) > 0:
        return float(packing_record.total_packed_qty or 0.0)
    return float(job_card.released_qty or job_card.planned_qty or 0.0)


def _dispatch_ref(snapshot: dict[str, Any], dispatch_id: uuid.UUID) -> str:
    return str(snapshot.get("dispatch_ref") or snapshot.get("challan_no") or f"DISPATCH:{dispatch_id}")


def _existing_inventory_dispatch_id(snapshot: dict[str, Any]) -> Optional[str]:
    for key in ["inventory_dispatch_transaction_id", "inventory_transaction_id", "fg_dispatch_transaction_id"]:
        value = snapshot.get(key)
        if value:
            return str(value)
    return None


def _active_hold_count(db: Session, job_card_id: uuid.UUID) -> int:
    return int(
        db.query(QualityHold)
        .filter(
            QualityHold.job_card_id == job_card_id,
            QualityHold.status.in_(list(QC_BLOCKING_STATUSES)),
        )
        .count()
    )


def _post_inventory_dispatch_if_needed(
    *,
    dispatch: Dispatch,
    job_card: JobCard,
    packing_record: PackingRecord,
    snapshot: dict[str, Any],
    dispatch_qty: float,
    dispatch_ref: str,
    token: str,
    plant_id: str,
) -> dict[str, Any]:
    existing_transaction_id = _existing_inventory_dispatch_id(snapshot)
    packing_snapshot = dict(packing_record.snapshot or {})
    fg_item_id = snapshot.get("fg_item_id") or str(packing_record.fg_item_id or "") or packing_snapshot.get("fg_item_id")
    inventory_batch_id = snapshot.get("inventory_batch_id") or packing_snapshot.get("inventory_batch_id")
    if not fg_item_id or not inventory_batch_id:
        raise HTTPException(
            status_code=409,
            detail="Cannot seal dispatch before PACKING has posted FG inventory for this job card",
        )

    payload = {
        "item_id": str(fg_item_id),
        "batch_id": str(inventory_batch_id),
        "qty": dispatch_qty,
        "dispatch_ref": dispatch_ref,
        "external_ref": str(snapshot.get("inventory_dispatch_external_ref") or snapshot.get("external_ref") or f"PROD-DISPATCH-{dispatch.id}"),
        "production_job_id": str(job_card.id),
        "sales_order_id": str(job_card.sales_order_id) if job_card.sales_order_id else None,
    }
    if existing_transaction_id:
        payload["existing_transaction_id"] = existing_transaction_id

    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.post(
                f"{settings.INVENTORY_SERVICE_URL}/dispatch/",
                headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
                json=payload,
            )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Inventory dispatch posting failed: {exc}") from exc

    if response.status_code not in (200, 201):
        raise HTTPException(status_code=response.status_code, detail=response.text)
    result = response.json()
    snapshot["inventory_dispatch_transaction_id"] = str(result.get("transaction_id"))
    snapshot["inventory_transaction_id"] = str(result.get("transaction_id"))
    snapshot["inventory_batch_id"] = str(result.get("batch_id") or inventory_batch_id)
    snapshot["inventory_item_id"] = str(result.get("item_id") or fg_item_id)
    snapshot["fg_inventory_inward_transaction_id"] = packing_snapshot.get("inventory_transaction_id")
    snapshot["inventory_dispatch_status"] = "POSTED"
    return snapshot

@router.post("/", response_model=DispatchResponse)
def create_or_update_dispatch(
    payload: DispatchPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Dispatch", "Store", "PlantManager", "Supervisor", "Logistics"]))
):
    # Check if job card exists
    plant_uuid = _plant_uuid(plant_id)
    job_card = db.query(JobCard).filter(JobCard.id == payload.job_card_id, JobCard.plant_id == plant_uuid).first()
    if not job_card:
        raise HTTPException(status_code=404, detail="Job Card not found")

    dispatch_snapshot = dict(payload.dispatch_snapshot or {})
    if payload.dispatch_request_id:
        dispatch_snapshot["dispatch_request_id"] = str(payload.dispatch_request_id)
    if payload.sales_order_line_id:
        dispatch_snapshot.setdefault("sales_order_line_id", str(payload.sales_order_line_id))
    if payload.fg_item_id:
        dispatch_snapshot.setdefault("fg_item_id", str(payload.fg_item_id))
    if payload.fg_batch_id:
        dispatch_snapshot.setdefault("fg_batch_id", str(payload.fg_batch_id))
        dispatch_snapshot.setdefault("inventory_batch_id", str(payload.fg_batch_id))
    if payload.dispatch_qty is not None:
        dispatch_snapshot.setdefault("dispatch_qty", float(payload.dispatch_qty))
        dispatch_snapshot.setdefault("qty", float(payload.dispatch_qty))
    request_id = str(dispatch_snapshot.get("dispatch_request_id") or "").strip()
    if request_id:
        request_hash = _request_hash(payload)
        idem = (
            db.query(DispatchIdempotency)
            .filter(
                DispatchIdempotency.plant_id == plant_uuid,
                DispatchIdempotency.request_id == request_id,
            )
            .first()
        )
        if idem:
            if idem.job_card_id != payload.job_card_id:
                raise HTTPException(status_code=409, detail="dispatch_request_id already belongs to another job card")
            if idem.request_hash != request_hash:
                raise HTTPException(status_code=409, detail="dispatch_request_id was already used with a different payload")
            if idem.status == "SUCCESS":
                response_snapshot = dict(idem.response_snapshot or {})
                merged_snapshot = {**dispatch_snapshot, **response_snapshot, "dispatch_request_id": request_id}
                return DispatchResponse(
                    id=getattr(db.query(Dispatch).filter(Dispatch.job_card_id == payload.job_card_id).first(), "id", uuid.uuid4()),
                    job_card_id=payload.job_card_id,
                    dispatch_snapshot=merged_snapshot,
                    status=payload.status,
                    dispatch_request_id=request_id,
                    sales_order_line_id=payload.sales_order_line_id,
                    fg_item_id=payload.fg_item_id,
                    fg_batch_id=payload.fg_batch_id,
                    dispatch_qty=payload.dispatch_qty,
                    created_at=datetime.utcnow(),
                )
        request_owner = (
            db.query(Dispatch)
            .filter(
                Dispatch.dispatch_snapshot["dispatch_request_id"].astext == request_id,
            )
            .first()
        )
        if request_owner and request_owner.job_card_id != payload.job_card_id:
            raise HTTPException(status_code=409, detail="dispatch_request_id already belongs to another job card")
        if request_owner and request_owner.status == "SEALED":
            return request_owner

    # Check if a dispatch already exists
    dispatch = db.query(Dispatch).filter(Dispatch.job_card_id == payload.job_card_id).first()

    if dispatch:
        if dispatch.status == "SEALED":
            raise HTTPException(status_code=400, detail="Cannot edit a SEALED dispatch")
        dispatch.dispatch_snapshot = dict(dispatch_snapshot)
        _safe_flag_modified(dispatch, "dispatch_snapshot")
        dispatch.status = payload.status
    else:
        dispatch = Dispatch(
            job_card_id=payload.job_card_id,
            dispatch_snapshot=dispatch_snapshot,
            status=payload.status
        )
        db.add(dispatch)

    db.flush()
    if payload.status == "SEALED":
        active_holds = _active_hold_count(db, job_card.id)
        if active_holds:
            raise HTTPException(status_code=409, detail=f"Cannot seal dispatch while {active_holds} quality hold(s) are active")

        packing_record = db.query(PackingRecord).filter(PackingRecord.job_card_id == job_card.id).first()
        if not packing_record or float(packing_record.total_packed_qty or 0.0) <= 0:
            raise HTTPException(status_code=409, detail="Cannot seal dispatch before production is packed")

        dispatch_qty = _dispatch_qty(dispatch_snapshot, job_card, packing_record)
        if dispatch_qty <= 0:
            raise HTTPException(status_code=400, detail="Dispatch quantity must be positive before sealing")
        packed_qty = float(packing_record.total_packed_qty or 0.0)
        if dispatch_qty > packed_qty + 0.0001:
            raise HTTPException(status_code=409, detail=f"Dispatch qty {dispatch_qty:g} cannot exceed packed qty {packed_qty:g}")

        dispatch_ref = _dispatch_ref(dispatch_snapshot, dispatch.id)
        dispatch_snapshot["qty"] = dispatch_qty
        dispatch_snapshot["dispatch_ref"] = dispatch_ref
        dispatch_snapshot = _post_inventory_dispatch_if_needed(
            dispatch=dispatch,
            job_card=job_card,
            packing_record=packing_record,
            snapshot=dispatch_snapshot,
            dispatch_qty=dispatch_qty,
            dispatch_ref=dispatch_ref,
            token=current_user.get("token", ""),
            plant_id=plant_id,
        )
        dispatch.dispatch_snapshot = dict(dispatch_snapshot)
        _safe_flag_modified(dispatch, "dispatch_snapshot")

        if job_card.sales_order_line_id:
            try:
                with httpx.Client(timeout=10.0) as client:
                    response = client.post(
                        f"{settings.SALES_SERVICE_URL}/sales-orders/lines/{job_card.sales_order_line_id}/record-dispatch",
                        headers={"Authorization": f"Bearer {current_user.get('token', '')}", "X-Plant-ID": plant_id},
                        json={"qty": dispatch_qty, "dispatch_line_ref": dispatch_ref},
                    )
                if response.status_code >= 400:
                    raise HTTPException(status_code=response.status_code, detail=response.text)
            except httpx.RequestError as exc:
                raise HTTPException(status_code=502, detail=f"Sales fulfillment update failed: {exc}") from exc

        job_card.status = "COMPLETED"
        job_card.current_stage = "DONE"

    db.commit()
    db.refresh(dispatch)
    return dispatch

@router.get("/{dispatch_id}", response_model=DispatchResponse)
def get_dispatch(
    dispatch_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Dispatch", "Store", "PlantManager", "Supervisor", "Logistics"]))
):
    dispatch = (
        db.query(Dispatch)
        .join(JobCard, JobCard.id == Dispatch.job_card_id)
        .filter(Dispatch.id == dispatch_id, JobCard.plant_id == _plant_uuid(plant_id))
        .first()
    )
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch not found")
    return dispatch

@router.get("/by-job/{job_card_id}", response_model=Optional[DispatchResponse])
def get_dispatch_by_job_card(
    job_card_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Dispatch", "Store", "PlantManager", "Supervisor", "Logistics"]))
):
    dispatch = (
        db.query(Dispatch)
        .join(JobCard, JobCard.id == Dispatch.job_card_id)
        .filter(Dispatch.job_card_id == job_card_id, JobCard.plant_id == _plant_uuid(plant_id))
        .first()
    )
    return dispatch

@router.get("/ready-jobs/", response_model=list[dict])
def get_ready_jobs_for_dispatch(
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Dispatch", "Store", "PlantManager", "Supervisor", "Logistics"]))
):
    """
    Returns job cards that are candidates for dispatch, meaning they have reached
    PACKING or DONE stages, or their corresponding dispatches are sealed (so we can view them).
    """
    results = (
        db.query(JobCard, SalesOrder, Dispatch)
        .join(SalesOrder, JobCard.sales_order_id == SalesOrder.id)
        .outerjoin(Dispatch, JobCard.id == Dispatch.job_card_id)
        .filter(
            JobCard.plant_id == _plant_uuid(plant_id),
            or_(JobCard.current_stage.in_(["PACKING", "DONE"]), Dispatch.status == "SEALED"),
        )
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
