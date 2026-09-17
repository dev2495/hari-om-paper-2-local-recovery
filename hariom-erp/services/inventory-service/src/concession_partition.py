"""Quantity-scoped concession partitions.

A concession records a measured FAIL and may release only an identified
quantity. The residual lot stays held. Independent holds are not released by
another inspection's concession. Measured status is never rewritten to PASS.
"""

from __future__ import annotations

from typing import Any, Optional


class ConcessionPartitionError(ValueError):
    def __init__(self, message: str, *, code: str):
        super().__init__(message)
        self.code = code
        self.message = message

    def as_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message}


def _qty(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if number != number or number in {float("inf"), float("-inf")}:
        return 0.0
    return round(number, 6)


def lot_quantity(*, batch: Any = None, reel: Any = None, rejection: Any = None) -> float:
    if batch is not None:
        return _qty(getattr(batch, "received_qty", 0))
    if reel is not None:
        current = getattr(reel, "current_weight_kg", None)
        inward = getattr(reel, "inward_weight_kg", None)
        return _qty(current if current not in (None, "") else inward)
    if rejection is not None:
        return _qty(getattr(rejection, "rejected_qty", None) or getattr(rejection, "qty", 0))
    return 0.0


def validate_concession_quantity(
    quantity: Any,
    lot_qty: float,
    *,
    independent_hold_qty: float = 0.0,
) -> tuple[float, float]:
    """Return (release_qty, residual_held_qty).

    Unspecified, zero, negative and over-balance scopes are rejected. Quantity
    covered by another independent hold cannot be released.
    """
    if quantity is None:
        raise ConcessionPartitionError(
            "Partial concession requires an identified quantity. Whole-lot release must send the full lot quantity.",
            code="UNSPECIFIED_SCOPE",
        )
    release_qty = _qty(quantity)
    if release_qty <= 0:
        raise ConcessionPartitionError(
            "Concession quantity must be greater than zero.",
            code="INVALID_QUANTITY",
        )
    lot = _qty(lot_qty)
    if release_qty - lot > 1e-9:
        raise ConcessionPartitionError(
            f"Concession quantity {release_qty} exceeds lot quantity {lot}.",
            code="EXCESS_QUANTITY",
        )
    independent = max(0.0, _qty(independent_hold_qty))
    residual = round(max(0.0, lot - release_qty), 6)
    if independent - residual > 1e-9:
        raise ConcessionPartitionError(
            "Concession cannot release quantity covered by an independent hold.",
            code="INDEPENDENT_HOLD",
        )
    return release_qty, residual


def split_batch_identity(batch_no: str, suffix: str) -> str:
    base = str(batch_no or "LOT").strip() or "LOT"
    token = str(suffix or "C").strip()[:12]
    return f"{base}-C-{token}"


def split_reel_code(reel_code: str, suffix: str) -> str:
    base = str(reel_code or "REEL").strip() or "REEL"
    token = str(suffix or "C").strip()[:12]
    return f"{base}-C-{token}"


def remaining_hold_quantity(holds: list[Any], *, excluding_inspection_id: Optional[str] = None) -> float:
    total = 0.0
    skip = str(excluding_inspection_id or "")
    for hold in holds or []:
        status = str(getattr(hold, "status", None) or (hold.get("status") if isinstance(hold, dict) else "") or "").upper()
        if status not in {"HOLD", "OPEN", "ACTIVE"}:
            continue
        source = str(
            getattr(hold, "source_inspection_id", None)
            or (hold.get("source_inspection_id") if isinstance(hold, dict) else "")
            or ""
        )
        if skip and source == skip:
            continue
        total += _qty(getattr(hold, "quantity", None) if not isinstance(hold, dict) else hold.get("quantity"))
    return round(total, 6)
