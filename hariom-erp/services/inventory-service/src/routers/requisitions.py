"""Employee requisition -> Owner decision -> linked, independently approved PO."""
from datetime import date, datetime
from typing import Optional
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import ItemMaster, PurchaseRequisition
from ..services.procurement import canonical_hash
from ..utils.auth import get_current_user, get_current_plant
from .purchase import _next_doc_no

router = APIRouter(prefix="/inventory/purchase/requisitions", tags=["requisitions"])

class RequisitionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    request_id: uuid.UUID
    pr_date: date
    item_id: uuid.UUID
    quantity: float = Field(gt=0)
    reason: str = Field(min_length=3, max_length=2000)

class RequisitionDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1)
    decision: str = Field(pattern="^(APPROVED|REJECTED)$")
    reason: str = Field(min_length=3, max_length=2000)

def serialize(row):
    return {key: (str(value) if isinstance(value, uuid.UUID) else value.isoformat() if isinstance(value, (date, datetime)) else float(value) if key == "quantity" else value)
            for key in ("id", "pr_no", "pr_date", "item_id", "item_name", "quantity", "uom", "reason", "requested_by", "status", "version", "decided_by", "decided_at", "decision_reason", "purchase_order_id", "history")
            for value in [getattr(row, key)]}

@router.get("")
def list_requisitions(status: Optional[str] = Query(None), db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(get_current_user)):
    query = db.query(PurchaseRequisition).filter_by(plant_id=plant_id)
    if not set(current_user.get("roles") or []) & {"Owner", "Store", "PlantManager", "Admin", "Planner"}:
        query = query.filter_by(requested_by=current_user.get("sub"))
    if status:
        query = query.filter_by(status=status)
    return {"items": [serialize(row) for row in query.order_by(PurchaseRequisition.created_at.desc()).all()]}

@router.post("")
def create_requisition(payload: RequisitionCreate, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(get_current_user)):
    actor = current_user.get("sub")
    if not actor:
        raise HTTPException(403, "A signed-in requester is required")
    fingerprint = canonical_hash({**payload.model_dump(mode="json", exclude={"request_id"}), "requested_by": actor})
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"pr:{plant_id}:{payload.request_id}"})
    previous = db.query(PurchaseRequisition).filter_by(plant_id=plant_id, request_id=payload.request_id).first()
    if previous:
        if previous.request_fingerprint != fingerprint:
            raise HTTPException(409, "Request key already used with different requisition details")
        return serialize(previous)
    item = db.query(ItemMaster).filter_by(id=payload.item_id, plant_id=plant_id, active="true").first()
    if not item or str(getattr(item.type, "value", item.type)) == "FINISHED_GOOD":
        raise HTTPException(422, "Select an active purchasable material or tool in this plant")
    if not payload.reason.strip():
        raise HTTPException(422, "Explain the purchase requirement")
    row = PurchaseRequisition(plant_id=plant_id, pr_no=_next_doc_no(db, PurchaseRequisition, plant_id, "pr_no", "PR"),
        request_id=payload.request_id, request_fingerprint=fingerprint, pr_date=payload.pr_date,
        item_id=item.id, item_name=item.name, quantity=payload.quantity, uom=str(getattr(item.uom, "value", item.uom)),
        reason=payload.reason.strip(), requested_by=actor, status="SUBMITTED", version=1,
        history=[{"action": "SUBMITTED", "actor": actor, "at": datetime.utcnow().isoformat(), "reason": payload.reason.strip()}])
    db.add(row); db.commit(); db.refresh(row)
    return serialize(row)

@router.post("/{requisition_id}/decision")
def decide_requisition(requisition_id: uuid.UUID, payload: RequisitionDecision, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(get_current_user)):
    if "Owner" not in set(current_user.get("actual_roles", current_user.get("roles")) or []) or "Owner" not in set(current_user.get("roles") or []):
        raise HTTPException(403, "Only the Owner may approve or reject requisitions")
    row = db.query(PurchaseRequisition).filter_by(id=requisition_id, plant_id=plant_id).with_for_update().first()
    if not row:
        raise HTTPException(404, "Requisition not found in this plant")
    if row.status != "SUBMITTED" or row.version != payload.expected_version:
        raise HTTPException(409, "Requisition changed; reload before deciding")
    if not payload.reason.strip():
        raise HTTPException(422, "A decision reason is required")
    row.status = payload.decision; row.version += 1; row.decided_by = current_user["sub"]
    row.decided_at = datetime.utcnow(); row.decision_reason = payload.reason.strip()
    row.history = [*(row.history or []), {"action": row.status, "actor": row.decided_by, "at": row.decided_at.isoformat(), "reason": row.decision_reason}]
    db.commit(); db.refresh(row)
    return serialize(row)
