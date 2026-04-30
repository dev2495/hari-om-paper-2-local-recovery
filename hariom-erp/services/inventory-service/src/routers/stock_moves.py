from __future__ import annotations

from datetime import datetime
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    InventoryLocation,
    PaperReel,
    ReelScanEvent,
    ReelScanEventType,
    ReelScanSource,
    ReferenceType,
    StockBatch,
    StockTransaction,
    TransactionType,
)
from ..services import get_batch_balance
from ..utils.auth import get_current_plant, require_role

router = APIRouter(prefix="/inventory/stock-moves", tags=["inventory-stock-moves"])

STOCK_STATUSES = {"UNRESTRICTED", "WIP", "QC_HOLD", "BLOCKED", "DISPATCH_STAGING", "SCRAP"}


class StockMoveCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_type: str
    entity_id: uuid.UUID
    to_location_id: uuid.UUID | None = None
    stock_status: str | None = None
    reason: str | None = Field(default=None, max_length=500)
    external_ref: str | None = Field(default=None, max_length=120)

    @field_validator("entity_type")
    @classmethod
    def validate_entity_type(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized not in {"BATCH", "REEL"}:
            raise ValueError("entity_type must be BATCH or REEL")
        return normalized

    @field_validator("stock_status")
    @classmethod
    def validate_stock_status(cls, value: str | None) -> str | None:
        if value is None:
            return value
        normalized = value.strip().upper()
        if normalized not in STOCK_STATUSES:
            raise ValueError("Invalid stock_status")
        return normalized


class StockMoveResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_type: str
    entity_id: uuid.UUID
    to_location_id: uuid.UUID | None = None
    stock_status: str
    recorded_at: datetime
    transaction_id: uuid.UUID | None = None


@router.post("", response_model=StockMoveResponse)
def create_stock_move(
    payload: StockMoveCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Store", "PlantManager", "Dispatch"])),
):
    location = None
    if payload.to_location_id:
        location = db.query(InventoryLocation).filter(
            InventoryLocation.id == payload.to_location_id,
            InventoryLocation.plant_id == plant_id,
        ).first()
        if not location:
            raise HTTPException(status_code=404, detail="Target location not found")

    if payload.entity_type == "BATCH":
        batch = db.query(StockBatch).filter(
            StockBatch.id == payload.entity_id,
            StockBatch.plant_id == plant_id,
        ).first()
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")
        if payload.external_ref:
            existing = db.query(StockTransaction).filter(
                StockTransaction.external_ref == payload.external_ref,
                StockTransaction.plant_id == plant_id,
            ).first()
            if existing:
                return StockMoveResponse(
                    entity_type="BATCH",
                    entity_id=batch.id,
                    to_location_id=existing.location_id,
                    stock_status=existing.stock_status,
                    recorded_at=existing.created_at,
                    transaction_id=existing.id,
                )

        batch.location_id = location.id if location else batch.location_id
        batch.location = location.code if location else batch.location
        batch.stock_status = payload.stock_status or batch.stock_status
        txn = StockTransaction(
            item_id=batch.item_id,
            batch_id=batch.id,
            transaction_type=TransactionType.MOVE,
            qty_change=0.0,
            reference_type=ReferenceType.INTERNAL,
            reference_id=batch.id,
            plant_id=plant_id,
            location_id=batch.location_id,
            stock_status=batch.stock_status,
            movement_metadata={"reason": payload.reason, "balance_after": get_batch_balance(str(batch.id), db)},
            external_ref=payload.external_ref,
        )
        db.add(txn)
        db.commit()
        db.refresh(txn)
        return StockMoveResponse(
            entity_type="BATCH",
            entity_id=batch.id,
            to_location_id=batch.location_id,
            stock_status=batch.stock_status,
            recorded_at=txn.created_at,
            transaction_id=txn.id,
        )

    reel = db.query(PaperReel).filter(
        PaperReel.id == payload.entity_id,
        PaperReel.plant_id == plant_id,
    ).first()
    if not reel:
        raise HTTPException(status_code=404, detail="Reel not found")

    reel.location_id = location.id if location else reel.location_id
    reel.stock_status = payload.stock_status or reel.stock_status
    event = ReelScanEvent(
        plant_id=uuid.UUID(str(plant_id)),
        reel_id=reel.id,
        event_type=ReelScanEventType.MOVE_SCAN,
        source=ReelScanSource.INVENTORY,
        operator_id=None,
        event_metadata={
            "to_location_id": str(reel.location_id) if reel.location_id else None,
            "stock_status": reel.stock_status,
            "reason": payload.reason,
            "external_ref": payload.external_ref,
        },
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return StockMoveResponse(
        entity_type="REEL",
        entity_id=reel.id,
        to_location_id=reel.location_id,
        stock_status=reel.stock_status,
        recorded_at=event.timestamp,
        transaction_id=None,
    )
