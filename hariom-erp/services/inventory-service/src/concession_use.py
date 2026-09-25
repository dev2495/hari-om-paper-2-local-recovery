"""Gate issue/WIP/dispatch against scoped concession stock."""

from __future__ import annotations

from typing import Any, Optional
import uuid

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .concession_partition import CONCESSION_STOCK_STATUS, ConcessionScopeError, assert_concession_use_allowed
from .models import InventoryQualityConcession


def latest_released_concession(
    db: Session,
    *,
    plant_id: str,
    entity_id: uuid.UUID,
) -> Optional[InventoryQualityConcession]:
    return (
        db.query(InventoryQualityConcession)
        .filter(
            InventoryQualityConcession.plant_id == plant_id,
            InventoryQualityConcession.released_entity_id == entity_id,
        )
        .order_by(InventoryQualityConcession.created_at.desc())
        .first()
    )


def guard_concession_stock(
    db: Session,
    *,
    plant_id: str,
    entity: Any,
    customer_id: Any = None,
    sales_order_id: Any = None,
    allowed_statuses: set[str],
    blocked_detail: str,
) -> None:
    status = str(getattr(entity, "stock_status", "") or "").upper()
    if status == CONCESSION_STOCK_STATUS:
        concession = latest_released_concession(db, plant_id=plant_id, entity_id=entity.id)
        try:
            assert_concession_use_allowed(
                concession,
                customer_id=customer_id,
                sales_order_id=sales_order_id,
            )
        except ConcessionScopeError as exc:
            raise HTTPException(status_code=409, detail=exc.as_dict()) from exc
        return
    allowed = {str(item).upper() for item in allowed_statuses}
    if status not in allowed:
        raise HTTPException(status_code=400, detail=blocked_detail)
