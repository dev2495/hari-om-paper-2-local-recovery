from __future__ import annotations

import uuid
from typing import Optional

from ..models import ReferenceType, StockTransaction, TransactionType


def build_wip_issue_transactions(
    *,
    item_id: uuid.UUID,
    batch_id: uuid.UUID,
    qty: float,
    job_card_id: uuid.UUID,
    plant_id: str,
    from_location_id: Optional[uuid.UUID],
    wip_location_id: Optional[uuid.UUID],
    stage: str,
    operator_id: Optional[str],
    external_ref: Optional[str] = None,
) -> list[StockTransaction]:
    if qty <= 0:
        raise ValueError("qty must be greater than zero")

    normalized_stage = str(stage or "").strip().upper() or "WIP"
    metadata = {
        "movement": "ISSUE_TO_WIP",
        "job_card_id": str(job_card_id),
        "stage": normalized_stage,
        "operator_id": operator_id,
    }
    base = {
        "item_id": item_id,
        "batch_id": batch_id,
        "transaction_type": TransactionType.MOVE,
        "reference_type": ReferenceType.PRODUCTION_JOB,
        "reference_id": job_card_id,
        "plant_id": plant_id,
    }
    return [
        StockTransaction(
            **base,
            qty_change=-abs(float(qty)),
            location_id=from_location_id,
            stock_status="UNRESTRICTED",
            movement_metadata={**metadata, "side": "STORE_OUT"},
            external_ref=f"{external_ref}:STORE" if external_ref else None,
        ),
        StockTransaction(
            **base,
            qty_change=abs(float(qty)),
            location_id=wip_location_id,
            stock_status="WIP",
            movement_metadata={**metadata, "side": "WIP_IN"},
            external_ref=f"{external_ref}:WIP" if external_ref else None,
        ),
    ]
