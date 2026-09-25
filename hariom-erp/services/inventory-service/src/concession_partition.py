"""Quantity-scoped concession partitions.

A concession records a measured FAIL and may release only an identified
quantity. The residual lot stays held. Independent holds are not released by
another inspection's concession. Measured status is never rewritten to PASS.

A customer/order/expiry authorization is a separate record. Scoped stock is
not universally interchangeable unrestricted supply.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

CONCESSION_STOCK_STATUS = "CONCESSION"
UNRESTRICTED_STOCK_STATUS = "UNRESTRICTED"


class ConcessionPartitionError(ValueError):
    def __init__(self, message: str, *, code: str):
        super().__init__(message)
        self.code = code
        self.message = message

    def as_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message}


class ConcessionScopeError(ValueError):
    def __init__(self, message: str, *, code: str):
        super().__init__(message)
        self.code = code
        self.message = message

    def as_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message}


def _naive_utc(value: datetime) -> datetime:
    if value.tzinfo is not None:
        return value.replace(tzinfo=None)
    return value


def _id_text(value: Any) -> str:
    if value in (None, ""):
        return ""
    return str(value)


def concession_is_scoped(
    *,
    permitted_customer_id: Any = None,
    permitted_sales_order_id: Any = None,
    expires_at: Any = None,
) -> bool:
    return bool(permitted_customer_id or permitted_sales_order_id or expires_at)


def concession_release_stock_status(
    *,
    permitted_customer_id: Any = None,
    permitted_sales_order_id: Any = None,
    expires_at: Any = None,
) -> str:
    if concession_is_scoped(
        permitted_customer_id=permitted_customer_id,
        permitted_sales_order_id=permitted_sales_order_id,
        expires_at=expires_at,
    ):
        return CONCESSION_STOCK_STATUS
    return UNRESTRICTED_STOCK_STATUS


def normalize_expires_at(value: Any, *, now: Optional[datetime] = None) -> Optional[datetime]:
    if value is None:
        return None
    if not isinstance(value, datetime):
        raise ConcessionScopeError("Concession expiry is invalid.", code="INVALID_EXPIRY")
    expires_at = _naive_utc(value)
    current = _naive_utc(now or datetime.utcnow())
    if expires_at <= current:
        raise ConcessionScopeError(
            "Concession expiry is already in the past.",
            code="CONCESSION_ALREADY_EXPIRED",
        )
    return expires_at


def assert_concession_use_allowed(
    concession: Any,
    *,
    customer_id: Any = None,
    sales_order_id: Any = None,
    now: Optional[datetime] = None,
) -> None:
    """Permit only unexpired, matching customer/order use of scoped stock."""
    if concession is None:
        raise ConcessionScopeError(
            "Concession stock has no authorization record.",
            code="CONCESSION_RECORD_MISSING",
        )
    current = _naive_utc(now or datetime.utcnow())
    expires_at = getattr(concession, "expires_at", None)
    if expires_at is not None:
        if isinstance(expires_at, datetime) and current >= _naive_utc(expires_at):
            raise ConcessionScopeError(
                "Concession authorization has expired.",
                code="CONCESSION_EXPIRED",
            )
    permitted_customer = getattr(concession, "permitted_customer_id", None)
    permitted_order = getattr(concession, "permitted_sales_order_id", None)
    if permitted_customer is not None and _id_text(permitted_customer) != _id_text(customer_id):
        raise ConcessionScopeError(
            "Concession is limited to another customer/order.",
            code="CONCESSION_SCOPE_MISMATCH",
        )
    if permitted_order is not None and _id_text(permitted_order) != _id_text(sales_order_id):
        raise ConcessionScopeError(
            "Concession is limited to another customer/order.",
            code="CONCESSION_SCOPE_MISMATCH",
        )


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
