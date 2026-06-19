import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel, field_validator
from datetime import datetime
import uuid
from ..database import get_db
from ..models import ItemMaster, ItemType, TrackingMode
from ..utils.audit_client import emit_audit_event
from ..utils.auth import get_current_user, require_role, get_current_plant, get_current_plant_scope

_audit_logger = logging.getLogger(__name__)

router = APIRouter(prefix="/items", tags=["items"])

# Pydantic schemas
class ItemCreate(BaseModel):
    item_code: str
    name: str
    type: str  # RAW_PAPER, ADHESIVE, PARCHMENT, FINISHED_GOOD
    tracking_mode: str | None = None  # REEL, BULK
    uom: str   # KG, PCS
    unit_cost: float | None = None
    cost_source: str | None = None
    reorder_level: float | None = 0
    safety_stock: float | None = 0
    lead_time_days: float | None = 0

    @field_validator("unit_cost")
    @classmethod
    def validate_unit_cost(cls, value: float | None):
        if value is not None and value < 0:
            raise ValueError("unit_cost must be non-negative")
        return value

    @field_validator("reorder_level", "safety_stock", "lead_time_days")
    @classmethod
    def validate_policy_numbers(cls, value: float | None):
        if value is not None and value < 0:
            raise ValueError("inventory policy values must be non-negative")
        return value

    @field_validator("cost_source")
    @classmethod
    def validate_cost_source(cls, value: str | None):
        if value is None:
            return value
        normalized = value.strip().upper()
        if normalized not in {"MANUAL", "SUPPLIER", "AVG_BATCH"}:
            raise ValueError("cost_source must be MANUAL, SUPPLIER, or AVG_BATCH")
        return normalized

    @field_validator("type")
    @classmethod
    def validate_type(cls, value: str):
        normalized = value.strip().upper()
        if normalized not in {item.value for item in ItemType}:
            raise ValueError("type must be RAW_PAPER, ADHESIVE, PARCHMENT, or FINISHED_GOOD")
        return normalized

    @field_validator("tracking_mode")
    @classmethod
    def validate_tracking_mode(cls, value: str | None):
        if value is None:
            return value
        normalized = value.strip().upper()
        if normalized not in {mode.value for mode in TrackingMode}:
            raise ValueError("tracking_mode must be REEL or BULK")
        return normalized

    @field_validator("uom")
    @classmethod
    def validate_uom(cls, value: str):
        normalized = value.strip().upper()
        if normalized not in {"KG", "PCS"}:
            raise ValueError("uom must be KG or PCS")
        return normalized

class ItemResponse(BaseModel):
    id: uuid.UUID
    item_code: str
    name: str
    type: str
    tracking_mode: str
    uom: str
    unit_cost: float | None = None
    cost_source: str | None = None
    reorder_level: float | None = 0
    safety_stock: float | None = 0
    lead_time_days: float | None = 0
    plant_id: str
    active: str
    created_at: datetime

    class Config:
        from_attributes = True


class ItemUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    tracking_mode: Optional[str] = None
    uom: Optional[str] = None
    unit_cost: Optional[float] = None
    cost_source: Optional[str] = None
    reorder_level: Optional[float] = None
    safety_stock: Optional[float] = None
    lead_time_days: Optional[float] = None
    active: Optional[str] = None

    @field_validator("unit_cost", "reorder_level", "safety_stock", "lead_time_days")
    @classmethod
    def validate_non_negative(cls, value: float | None):
        if value is not None and value < 0:
            raise ValueError("numeric policy values must be non-negative")
        return value

    @field_validator("cost_source")
    @classmethod
    def validate_cost_source(cls, value: str | None):
        if value is None:
            return value
        normalized = value.strip().upper()
        if normalized not in {"MANUAL", "SUPPLIER", "AVG_BATCH"}:
            raise ValueError("cost_source must be MANUAL, SUPPLIER, or AVG_BATCH")
        return normalized

    @field_validator("type")
    @classmethod
    def validate_type(cls, value: str | None):
        if value is None:
            return value
        normalized = value.strip().upper()
        if normalized not in {item.value for item in ItemType}:
            raise ValueError("type must be RAW_PAPER, ADHESIVE, PARCHMENT, or FINISHED_GOOD")
        return normalized

    @field_validator("tracking_mode")
    @classmethod
    def validate_tracking_mode(cls, value: str | None):
        if value is None:
            return value
        normalized = value.strip().upper()
        if normalized not in {mode.value for mode in TrackingMode}:
            raise ValueError("tracking_mode must be REEL or BULK")
        return normalized

    @field_validator("uom")
    @classmethod
    def validate_uom(cls, value: str | None):
        if value is None:
            return value
        normalized = value.strip().upper()
        if normalized not in {"KG", "PCS"}:
            raise ValueError("uom must be KG or PCS")
        return normalized

    @field_validator("active")
    @classmethod
    def validate_active(cls, value: str | None):
        if value is None:
            return value
        normalized = value.strip().lower()
        if normalized not in {"true", "false"}:
            raise ValueError("active must be true or false")
        return normalized

@router.get("/", response_model=List[ItemResponse])
def get_items(
    type: str = None,
    tracking_mode: str = None,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user)
):
    """List all active items"""
    query = db.query(ItemMaster).filter(ItemMaster.active == "true")
    if plant_scope.get("scope_all"):
        allowed_plants = plant_scope.get("allowed_plants") or []
        if allowed_plants:
            query = query.filter(ItemMaster.plant_id.in_(allowed_plants))
    else:
        query = query.filter(ItemMaster.plant_id == plant_scope["selected_plant_id"])
    
    if type:
        query = query.filter(ItemMaster.type == type.strip().upper())
    if tracking_mode:
        query = query.filter(ItemMaster.tracking_mode == tracking_mode.strip().upper())
    
    return query.all()

@router.post("/", response_model=ItemResponse)
def create_item(
    item: ItemCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    """Create new item (Admin only)"""
    # Check if item_code already exists in this plant
    existing = db.query(ItemMaster).filter(
        ItemMaster.item_code == item.item_code,
        ItemMaster.plant_id == plant_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Item code '{item.item_code}' already exists in this plant")
    
    payload = item.model_dump()
    item_type = payload["type"]
    tracking_mode = payload.get("tracking_mode") or (
        TrackingMode.REEL.value if item_type == ItemType.RAW_PAPER.value else TrackingMode.BULK.value
    )
    if item_type != ItemType.RAW_PAPER.value and tracking_mode == TrackingMode.REEL.value:
        raise HTTPException(status_code=400, detail="Only RAW_PAPER items can use REEL tracking")

    db_item = ItemMaster(
        item_code=payload["item_code"],
        name=payload["name"],
        type=item_type,
        tracking_mode=tracking_mode,
        uom=payload["uom"],
        unit_cost=payload.get("unit_cost"),
        cost_source=payload.get("cost_source"),
        reorder_level=payload.get("reorder_level") or 0,
        safety_stock=payload.get("safety_stock") or 0,
        lead_time_days=payload.get("lead_time_days") or 0,
        plant_id=plant_id,
    )
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="item_created",
            entity_type="item",
            entity_id=str(db_item.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"Item {db_item.item_code} ({db_item.name}) created",
            payload={
                "item_code": db_item.item_code,
                "name": db_item.name,
                "type": item_type,
                "tracking_mode": tracking_mode,
                "uom": payload["uom"],
                "unit_cost": payload.get("unit_cost"),
                "cost_source": payload.get("cost_source"),
            },
        )
    except Exception as exc:
        _audit_logger.warning("audit emit failed for item_created %s: %s", db_item.id, exc)
    return db_item


@router.put("/{item_id}", response_model=ItemResponse)
def update_item(
    item_id: uuid.UUID,
    item: ItemUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Store"])),
):
    """Update item costing and inventory policy controls."""
    db_item = db.query(ItemMaster).filter(
        ItemMaster.id == item_id,
        ItemMaster.plant_id == plant_id,
    ).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Item not found")

    payload = item.model_dump(exclude_unset=True)
    next_type = payload.get("type", db_item.type.value if hasattr(db_item.type, "value") else db_item.type)
    next_tracking = payload.get(
        "tracking_mode",
        db_item.tracking_mode.value if hasattr(db_item.tracking_mode, "value") else db_item.tracking_mode,
    )
    if next_type != ItemType.RAW_PAPER.value and next_tracking == TrackingMode.REEL.value:
        raise HTTPException(status_code=400, detail="Only RAW_PAPER items can use REEL tracking")

    changed_fields: list[str] = []
    for field in (
        "name",
        "type",
        "tracking_mode",
        "uom",
        "unit_cost",
        "cost_source",
        "reorder_level",
        "safety_stock",
        "lead_time_days",
        "active",
    ):
        if field in payload:
            setattr(db_item, field, payload[field])
            changed_fields.append(field)

    db.commit()
    db.refresh(db_item)
    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="item_updated",
            entity_type="item",
            entity_id=str(db_item.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"Item {db_item.item_code} updated ({', '.join(changed_fields) or 'no change'})",
            payload={
                "item_code": db_item.item_code,
                "changed_fields": changed_fields,
                "updates": {key: payload[key] for key in changed_fields},
            },
        )
    except Exception as exc:
        _audit_logger.warning("audit emit failed for item_updated %s: %s", db_item.id, exc)
    return db_item

@router.get("/{item_id}", response_model=ItemResponse)
def get_item(
    item_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user)
):
    """Get item details"""
    query = db.query(ItemMaster).filter(ItemMaster.id == item_id)
    if plant_scope.get("scope_all"):
        allowed_plants = plant_scope.get("allowed_plants") or []
        if allowed_plants:
            query = query.filter(ItemMaster.plant_id.in_(allowed_plants))
    else:
        query = query.filter(ItemMaster.plant_id == plant_scope["selected_plant_id"])
    item = query.first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.delete("/{item_id}")
def delete_item(
    item_id: uuid.UUID,
    force: bool = False,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Store", "Owner"])),
):
    """Soft-delete an item by setting active='false'.

    A hard delete is not permitted because StockTransaction + StockBatch rows
    foreign-key onto the item, and historical valuation must remain auditable.

    Refuses (HTTP 409) if the item still has positive stock-on-hand unless
    `force=true` is passed in the query string. The deactivation never deletes
    historical transactions or batches.
    """
    db_item = db.query(ItemMaster).filter(
        ItemMaster.id == item_id,
        ItemMaster.plant_id == plant_id,
    ).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Item not found")

    # Safety check: refuse if there is positive available balance unless force.
    if not force:
        from ..services import get_item_balance
        balance = float(get_item_balance(str(item_id), db) or 0.0)
        if balance > 0.001:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "ITEM_HAS_OPEN_BALANCE",
                    "message": (
                        f"Item still has {balance:.3f} units on hand. Issue or transfer the "
                        "balance first, or pass ?force=true to deactivate anyway "
                        "(the balance will remain visible on the inactive item)."
                    ),
                    "item_id": str(item_id),
                    "item_code": db_item.item_code,
                    "available_qty": balance,
                },
            )

    db_item.active = "false"
    db.commit()
    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="item_deleted",
            entity_type="item",
            entity_id=str(db_item.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"Item {db_item.item_code} soft-deleted (force={bool(force)})",
            payload={
                "item_code": db_item.item_code,
                "force": bool(force),
                "soft_delete": True,
            },
        )
    except Exception as exc:
        _audit_logger.warning("audit emit failed for item_deleted %s: %s", db_item.id, exc)
    return {
        "id": str(db_item.id),
        "item_code": db_item.item_code,
        "active": db_item.active,
        "message": "Item soft-deleted. Historical transactions are preserved.",
    }
