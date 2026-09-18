"""Commercial sales-order contract helpers (dates, origin, parchment).

Server-side rules for R05 / R08 / R10. Create, edit, approval, delivery-schedule
inputs and bulk-import payloads all call these helpers so an old client cannot
bypass the date or parchment contract.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Iterable, Mapping, Optional, Sequence
import uuid


ORIGIN_CUSTOMER_PO = "CUSTOMER_PO"
ORIGIN_INTERNAL = "INTERNAL"
ORIGIN_REVIEW = "REVIEW"

ALLOWED_ORIGINS = {ORIGIN_CUSTOMER_PO, ORIGIN_INTERNAL, ORIGIN_REVIEW}

_MONTHS = (
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
)


class SalesCommercialError(ValueError):
    def __init__(self, message: str, *, field: Optional[str] = None, line_no: Optional[int] = None):
        super().__init__(message)
        self.field = field
        self.line_no = line_no


def format_customer_po_date(value: date) -> str:
    return f"{value.day} {_MONTHS[value.month - 1]} {value.year}"


def normalize_origin(value: Optional[str], *, default: str = ORIGIN_CUSTOMER_PO) -> str:
    origin = str(value or default).strip().upper()
    if origin in {"CUSTOMER-PO", "CUSTOMERPO", "PO", "CUSTOMER"}:
        return ORIGIN_CUSTOMER_PO
    if origin in {"INTERNAL", "INTERNAL_SO", "INTERNAL-SO"}:
        return ORIGIN_INTERNAL
    if origin in {"REVIEW", "ORIGIN_REVIEW", "UNKNOWN"}:
        return ORIGIN_REVIEW
    if origin not in ALLOWED_ORIGINS:
        raise SalesCommercialError(
            "Order origin must be CUSTOMER_PO or INTERNAL.",
            field="origin",
        )
    return origin


def delivery_date_error(customer_po_date: date, *, line_no: Optional[int] = None) -> str:
    message = (
        f"Delivery date must be after the Customer PO Date "
        f"({format_customer_po_date(customer_po_date)})."
    )
    if line_no:
        return f"Line {line_no}: {message}"
    return message


def _as_date(value: Any) -> Optional[date]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()[:10]
    if not text:
        return None
    return date.fromisoformat(text)


def requires_customer_po_date_rule(origin: str) -> bool:
    return normalize_origin(origin) == ORIGIN_CUSTOMER_PO


def validate_delivery_after_customer_po_date(
    delivery_date: Any,
    customer_po_date: Any,
    *,
    origin: str = ORIGIN_CUSTOMER_PO,
    line_no: Optional[int] = None,
) -> None:
    """R05: for customer-PO origin, delivery_date must be strictly later.

    Internal orders have no customer PO date; do not apply this rule to a
    nonexistent date. Equal and earlier dates both fail.
    """
    if not requires_customer_po_date_rule(origin):
        return
    po_date = _as_date(customer_po_date)
    due = _as_date(delivery_date)
    if po_date is None:
        raise SalesCommercialError(
            "Customer PO Date is required for customer PO orders.",
            field="po_date",
        )
    if due is None:
        raise SalesCommercialError(
            delivery_date_error(po_date, line_no=line_no),
            field="due_date",
            line_no=line_no,
        )
    if due <= po_date:
        raise SalesCommercialError(
            delivery_date_error(po_date, line_no=line_no),
            field="due_date",
            line_no=line_no,
        )


def validate_delivery_schedule_input(
    *,
    origin: str,
    customer_po_date: Any,
    schedule_rows: Sequence[Mapping[str, Any]] | None,
) -> None:
    """Same R05 rule for dated quantity / call-off rows."""
    if not schedule_rows:
        return
    errors: list[str] = []
    for index, row in enumerate(schedule_rows, start=1):
        line_no = row.get("line_no") or index
        delivery = row.get("delivery_date") or row.get("due_date") or row.get("scheduled_date")
        try:
            validate_delivery_after_customer_po_date(
                delivery,
                customer_po_date,
                origin=origin,
                line_no=int(line_no) if str(line_no).isdigit() else index,
            )
        except SalesCommercialError as exc:
            errors.append(str(exc))
    if errors:
        raise SalesCommercialError(" ".join(errors), field="delivery_date")


def validate_origin_and_external_po(
    *,
    origin: str,
    customer_id: Any,
    po_number: Optional[str],
    po_date: Any,
    internal_order_date: Any = None,
) -> tuple[str, Optional[str], Optional[date], Optional[date]]:
    resolved = normalize_origin(origin)
    if customer_id in (None, ""):
        raise SalesCommercialError("Customer is required.", field="customer_id")

    if resolved == ORIGIN_INTERNAL:
        order_date = _as_date(internal_order_date)
        if order_date is None:
            raise SalesCommercialError(
                "Internal order date is required for internal sales orders.",
                field="internal_order_date",
            )
        return resolved, None, None, order_date

    if resolved == ORIGIN_REVIEW:
        return resolved, (po_number or "").strip() or None, _as_date(po_date), _as_date(internal_order_date)

    number = (po_number or "").strip() or None
    if not number:
        raise SalesCommercialError(
            "Customer PO number is required for customer PO orders.",
            field="po_number",
        )
    resolved_po_date = _as_date(po_date)
    if resolved_po_date is None:
        raise SalesCommercialError(
            "Customer PO Date is required for customer PO orders.",
            field="po_date",
        )
    return resolved, number, resolved_po_date, None


def classify_historical_origin(*, po_number: Optional[str], origin: Optional[str] = None) -> str:
    """Blank historical PO numbers are not evidence of an internal order (R10 / COMM-05)."""
    if origin not in (None, ""):
        return normalize_origin(origin, default=ORIGIN_REVIEW)
    if (po_number or "").strip():
        return ORIGIN_CUSTOMER_PO
    return ORIGIN_REVIEW


def resolve_parchment_variant(
    *,
    parchment_required: Optional[bool],
    parchment_color: Optional[str],
    parchment_color_id: Any = None,
    line_no: Optional[int] = None,
) -> tuple[bool, Optional[uuid.UUID], Optional[str]]:
    """Persist the explicit boolean and clear stale color when unchecked (R08)."""
    color = (parchment_color or "").strip() or None
    color_id = parchment_color_id if parchment_color_id not in (None, "") else None
    if isinstance(color_id, str):
        try:
            color_id = uuid.UUID(color_id)
        except ValueError as exc:
            prefix = f"Line {line_no}: " if line_no else ""
            raise SalesCommercialError(
                f"{prefix}Parchment color selection is not a valid master variant.",
                field="parchment_color_id",
                line_no=line_no,
            ) from exc

    if parchment_required is False:
        return False, None, None

    if parchment_required is True:
        if not color and color_id is None:
            prefix = f"Line {line_no}: " if line_no else ""
            raise SalesCommercialError(
                f"{prefix}Parchment color is required when parchment is required.",
                field="parchment_color",
                line_no=line_no,
            )
        return True, color_id, color

    # Legacy clients sent only the color snapshot. Infer the boolean from it.
    if color or color_id is not None:
        return True, color_id, color
    return False, None, None


def validate_order_lines_delivery_dates(
    *,
    origin: str,
    customer_po_date: Any,
    lines: Iterable[Any],
) -> None:
    errors: list[str] = []
    for index, line in enumerate(lines, start=1):
        if isinstance(line, Mapping):
            line_no = line.get("line_no") or index
            due_date = line.get("due_date")
        else:
            line_no = getattr(line, "line_no", None) or index
            due_date = getattr(line, "due_date", None)
        try:
            line_no_int = int(line_no)
        except (TypeError, ValueError):
            line_no_int = index
        try:
            validate_delivery_after_customer_po_date(
                due_date,
                customer_po_date,
                origin=origin,
                line_no=line_no_int,
            )
        except SalesCommercialError as exc:
            errors.append(str(exc))
    if errors:
        raise SalesCommercialError(" ".join(errors), field="due_date")


def validate_bulk_import_order(row: Mapping[str, Any]) -> None:
    """Apply the same create contract to a bulk-import / spreadsheet row."""
    origin, _, po_date, _ = validate_origin_and_external_po(
        origin=row.get("origin") or ORIGIN_CUSTOMER_PO,
        customer_id=row.get("customer_id"),
        po_number=row.get("po_number"),
        po_date=row.get("po_date"),
        internal_order_date=row.get("internal_order_date"),
    )
    lines = row.get("lines") or []
    if not lines:
        raise SalesCommercialError("At least one line is required.", field="lines")
    validate_order_lines_delivery_dates(origin=origin, customer_po_date=po_date, lines=lines)
    validate_delivery_schedule_input(
        origin=origin,
        customer_po_date=po_date,
        schedule_rows=row.get("delivery_schedules") or [],
    )
    for index, line in enumerate(lines, start=1):
        resolve_parchment_variant(
            parchment_required=line.get("parchment_required") if isinstance(line, Mapping) else getattr(line, "parchment_required", None),
            parchment_color=line.get("parchment_color") if isinstance(line, Mapping) else getattr(line, "parchment_color", None),
            parchment_color_id=line.get("parchment_color_id") if isinstance(line, Mapping) else getattr(line, "parchment_color_id", None),
            line_no=index,
        )


def validate_persisted_order(order: Any) -> None:
    """Re-check stored dates/origin before approval so drafts cannot sneak through."""
    origin = normalize_origin(getattr(order, "origin", None), default=ORIGIN_CUSTOMER_PO)
    if origin == ORIGIN_REVIEW:
        raise SalesCommercialError(
            "This sales order origin is flagged for review and cannot be approved until it is classified as a customer PO or internal order.",
            field="origin",
        )
    origin, _, po_date, _ = validate_origin_and_external_po(
        origin=origin,
        customer_id=getattr(order, "customer_id", None),
        po_number=getattr(order, "po_number", None),
        po_date=getattr(order, "po_date", None),
        internal_order_date=getattr(order, "internal_order_date", None),
    )
    validate_order_lines_delivery_dates(
        origin=origin,
        customer_po_date=po_date,
        lines=getattr(order, "lines", []) or [],
    )
