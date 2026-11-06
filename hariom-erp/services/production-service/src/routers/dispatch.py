from typing import Any, Optional
from contextlib import contextmanager
import hashlib
import json
import math
import os
import re
import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, or_, text
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.orm import Session
from datetime import date, datetime
from pydantic import BaseModel, ConfigDict, Field
import uuid

from ..config import get_settings
from ..due_risk import plant_today
from ..database import get_db, engine
from ..models import Dispatch, DispatchIdempotency, JobCard, JobCardStage, PackingRecord, QualityHold, SalesOrder
from ..card_lock import card_posting_lease
from ..dispatch_quantities import dispatchable_quantity, shipping_allowance, qc_excluded_quantities
from .. import boxes as box_rules
from ..entry_models import FgBox
from ..utils.auth import get_current_plant, get_current_plant_scope, require_role

router = APIRouter(prefix="/dispatch", tags=["dispatch"])
settings = get_settings()
QC_BLOCKING_STATUSES = {"HOLD"}
DISPATCH_ACCESS_ROLES = ["Admin", "Owner", "Dispatch", "Store", "PlantManager", "Supervisor", "Logistics"]
# Sales may look at the dispatch register and print sealed challans (role matrix: Sales "view"); it never writes.
DISPATCH_VIEW_ROLES = [*DISPATCH_ACCESS_ROLES, "Sales"]
DISPATCH_SEAL_ROLES = {"Admin", "Owner", "Dispatch"}
ORCHESTRATION_SNAPSHOT_KEYS = {
    "dispatch_request_id",
    "dispatch_ref",
    "inventory_dispatch_transaction_id",
    "inventory_transaction_id",
    "inventory_dispatch_status",
    "inventory_dispatch_external_ref",
    "inventory_batch_id",
    "inventory_item_id",
    "fg_inventory_inward_transaction_id",
    "sales_dispatch_status",
    "sales_validation_status",
    "orchestration_state",
    "orchestration_error",
    "seal_request",
    "sales_dispatch_ref",
    "box_ref_scope",
}


def _plant_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid plant_id: {value}") from exc


def _apply_job_plant_scope(query, plant_scope: dict):
    if plant_scope.get("scope_all"):
        return query.filter(JobCard.plant_id.in_([
            _plant_uuid(value) for value in plant_scope.get("allowed_plants") or []
        ]))
    selected = plant_scope.get("selected_plant_id")
    if not selected:
        raise HTTPException(status_code=400, detail="Select a plant to view dispatches")
    return query.filter(JobCard.plant_id == _plant_uuid(selected))


def _request_hash(payload: "DispatchPayload") -> str:
    payload_data = payload.model_dump(mode="json") if hasattr(payload, "model_dump") else payload.dict()
    snapshot = dict(payload_data.get("dispatch_snapshot") or {})
    payload_data["dispatch_snapshot"] = {
        key: value for key, value in snapshot.items() if key not in ORCHESTRATION_SNAPSHOT_KEYS
    }
    blob = json.dumps(payload_data, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _safe_flag_modified(instance: Any, key: str) -> None:
    if hasattr(instance, "_sa_instance_state"):
        flag_modified(instance, key)


def _acquire_dispatch_lock(db: Session, lock_name: str) -> None:
    """Serialize dispatch orchestration per job across workers/processes."""
    lock_key = int.from_bytes(hashlib.sha256(lock_name.encode("utf-8")).digest()[:8], "big", signed=True)
    db.execute(text("SELECT pg_advisory_xact_lock(:lock_key)"), {"lock_key": lock_key})


@contextmanager
def _sales_line_posting_lease(plant_id, line_id):
    """Keep competing cards off one commercial balance across DB checkpoints."""
    if not line_id:
        yield
        return
    key = int.from_bytes(hashlib.sha256(f"dispatch-sales-line:{plant_id}:{line_id}".encode()).digest()[:8], "big", signed=True)
    with engine.connect() as connection:
        locked = connection.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": key}).scalar()
        connection.commit()
        if not locked:
            raise HTTPException(409, "Another shipment for this order line is being saved right now. Wait a few seconds and try again.")
        try:
            yield
        finally:
            try:
                connection.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": key})
                connection.commit()
            except Exception:
                # A pooled connection must never keep a session lease after an error.
                connection.invalidate()
                raise


def _require_sales_line_available(db, job):
    if not job.sales_order_line_id:
        return
    other = db.query(Dispatch).join(JobCard, JobCard.id == Dispatch.job_card_id).filter(
        JobCard.plant_id == job.plant_id,
        JobCard.sales_order_line_id == job.sales_order_line_id,
        JobCard.id != job.id,
        Dispatch.status == "DRAFT",
        Dispatch.dispatch_snapshot["orchestration_state"].astext.in_(["PENDING", "FAILED"]),
    ).first()
    if other:
        raise HTTPException(409, "Another job card of this order line has an unfinished shipment. Open that card in Dispatch and press Retry shipment first, then seal this one.")

class DispatchPayload(BaseModel):
    job_card_id: uuid.UUID
    dispatch_snapshot: dict
    status: str = Field(..., pattern="^(DRAFT|SEALED)$")
    dispatch_request_id: Optional[str] = Field(default=None, min_length=1, max_length=120)
    sales_order_line_id: Optional[uuid.UUID] = None
    fg_item_id: Optional[uuid.UUID] = None
    fg_batch_id: Optional[uuid.UUID] = None
    dispatch_qty: Optional[float] = Field(default=None, gt=0)

class DispatchResponse(DispatchPayload):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime


def _number(value: Any) -> Optional[float]:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _dispatch_qty(snapshot: dict[str, Any], job_card: JobCard, packing_record: Optional[PackingRecord]) -> float:
    def quantity(value: Any) -> float:
        parsed = _number(value)
        if parsed is None or not math.isfinite(parsed) or parsed < 0:
            raise HTTPException(status_code=400, detail="Dispatch quantity must be a finite non-negative number")
        return parsed

    for key in ["qty", "dispatch_qty", "quantity", "total_qty", "packed_qty"]:
        if key in snapshot:
            return quantity(snapshot[key])
    summary = snapshot.get("summary")
    if isinstance(summary, dict) and "total_pcs" in summary:
        return quantity(summary["total_pcs"])

    items = snapshot.get("items")
    if isinstance(items, list) and items:
        total = 0.0
        for item in items:
            if not isinstance(item, dict):
                raise HTTPException(status_code=400, detail="Invalid dispatch item")
            key = next((key for key in ["total_pcs", "qty", "quantity", "dispatch_qty"] if key in item), None)
            if key is None:
                raise HTTPException(status_code=400, detail="Dispatch item quantity is missing")
            total += quantity(item[key])
        return quantity(total)

    if packing_record and float(packing_record.total_packed_qty or 0.0) > 0:
        return quantity(packing_record.total_packed_qty)
    return quantity(job_card.released_qty or job_card.planned_qty or 0.0)


def _dispatch_ref(snapshot: dict[str, Any], dispatch_id: uuid.UUID, request_id: str = "") -> str:
    if request_id:
        date_token = str(snapshot.get("date") or plant_today().isoformat()).replace("-", "")
        request_token = hashlib.sha256(request_id.encode("utf-8")).hexdigest()[:8].upper()
        fallback = f"DC-{date_token}-{request_token}"
    else:
        fallback = f"DC-{dispatch_id}"
    return str(snapshot.get("dispatch_ref") or snapshot.get("challan_no") or fallback)


def _existing_inventory_dispatch_id(snapshot: dict[str, Any]) -> Optional[str]:
    for key in ["inventory_dispatch_transaction_id", "inventory_transaction_id", "fg_dispatch_transaction_id"]:
        value = snapshot.get(key)
        if value:
            return str(value)
    return None


def _active_hold_count(db: Session, job_card_id: uuid.UUID) -> int:
    """Holds that stop a shipment: only holds placed on purpose that block movement (owner decision 3,
    2026-11-01). QC out of band is a flag, never a hold; advisory holds show as a warning only."""
    from .planning import _movement_blocking_holds
    holds = db.query(QualityHold).filter(QualityHold.job_card_id == job_card_id, QualityHold.status.in_(list(QC_BLOCKING_STATUSES))).all()
    return len(_movement_blocking_holds(db, holds))


def _box_ids(snapshot: dict[str, Any]) -> list[uuid.UUID]:
    raw = snapshot.get("box_ids") or []
    if not isinstance(raw, list):
        raise HTTPException(status_code=422, detail="Pick the boxes for this challan (a list of box ids).")
    try:
        return list(dict.fromkeys(uuid.UUID(str(value)) for value in raw))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="A box id on this challan is not valid") from exc


def _challan_boxes(db: Session, job_card: JobCard, snapshot: dict[str, Any], dispatch: Dispatch) -> list[FgBox]:
    """The boxes on this challan: the card's own, packed (or already on this same challan on a retry), in stock."""
    ids = _box_ids(snapshot)
    if not ids:
        raise HTTPException(status_code=422, detail="Tick or scan the boxes going on this challan.")
    boxes = db.query(FgBox).filter(FgBox.id.in_(ids), FgBox.job_card_id == job_card.id, FgBox.plant_id == job_card.plant_id).with_for_update().all()
    found = {box.id: box for box in boxes}
    missing = [str(value) for value in ids if value not in found]
    if missing:
        raise HTTPException(status_code=404, detail="Some boxes on this challan are not on this job card; refresh and pick them again.")
    problems = []
    for box in (found[value] for value in ids):
        if box.job_card_id != job_card.id:
            problems.append(f"{box.box_code} belongs to another job card")
        elif box.status == "DISPATCHED" and box.dispatch_id != dispatch.id:
            problems.append(f"{box.box_code} is already dispatched")
        elif box.status in ("RETAINED", "VOID"):
            problems.append(f"{box.box_code} is {box.status.lower()}")
        elif box.fg_status != "POSTED":
            problems.append(f"{box.box_code} is not in stock yet (posting {box.fg_status.lower()})")
    if problems:
        raise HTTPException(status_code=409, detail="These boxes cannot go on the challan: " + "; ".join(problems) + ".")
    return [found[value] for value in ids]


def _box_packing_block(job_card: JobCard, boxes: list[FgBox]) -> dict[str, Any]:
    """The challan's packing block from the spec (box code, qty per box, plastic / fadda per box) and the boxes."""
    snap = job_card.spec_snapshot or {}
    full = [box for box in boxes if not box.is_part]
    part = [box for box in boxes if box.is_part]
    return {
        "box_code": snap.get("box_code") or snap.get("box"),
        "box_size": snap.get("box_size"),
        "qty_per_box": box_rules.qty_per_box(job_card),
        "plastic_sku": snap.get("plastic_sku"), "plastic_per_box": snap.get("plastic_per_box"),
        "fadda_sku": snap.get("fadda_sku"), "fadda_per_box": snap.get("fadda_per_box"),
        "box_count": len(boxes), "full_boxes": len(full), "part_boxes": len(part),
        "total_pcs": sum(int(box.qty) for box in boxes),
    }


def _box_external_ref(snapshot: dict[str, Any], box_id: Any) -> str:
    """The stock-out key of one box on one challan. Older challans used the box id alone; a challan started
    since cancel-shipment adds its own id, so a box from a cancelled challan can ship again (3 Nov 2026)."""
    scope = str(snapshot.get("box_ref_scope") or "").strip()
    return f"PROD-DISPATCH-BOX-{box_id}" + (f"-{scope}" if scope else "")


def _post_inventory_box_dispatch(*, job_card: JobCard, boxes: list[FgBox], snapshot: dict[str, Any], dispatch_ref: str, token: str, plant_id: str) -> dict[str, Any]:
    """One stock-out per box batch, idempotent per box (a retry re-sends the same box keys)."""
    posted = dict(snapshot.get("inventory_box_transactions") or {})
    for box in boxes:
        if posted.get(str(box.id)):
            continue
        payload = {
            "item_id": str(box.fg_item_id), "batch_id": str(box.inventory_batch_id), "qty": float(box.qty),
            "effective_date": snapshot.get("date") or plant_today().isoformat(), "dispatch_ref": dispatch_ref[:100],
            "external_ref": _box_external_ref(snapshot, box.id), "production_job_id": str(job_card.id),
            "sales_order_id": str(job_card.sales_order_id) if job_card.sales_order_id else None,
            "sales_order_line_id": str(job_card.sales_order_line_id) if job_card.sales_order_line_id else None,
        }
        try:
            with httpx.Client(timeout=10.0) as client:
                response = client.post(f"{settings.INVENTORY_SERVICE_URL}/dispatch/", headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id}, json=payload)
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"Stores could not be reached to move box {box.box_code} out of stock. Nothing was sealed; try again.") from exc
        if response.status_code not in (200, 201):
            raise HTTPException(status_code=response.status_code, detail=f"Box {box.box_code} could not be moved out of stock: {_downstream_detail(response)}")
        posted[str(box.id)] = str(response.json().get("transaction_id"))
        snapshot["inventory_box_transactions"] = dict(posted)
    snapshot["inventory_dispatch_status"] = "POSTED"
    snapshot["inventory_dispatch_transaction_id"] = next(iter(posted.values()), None)
    return snapshot


def _require_final_qc(db: Session, plant_id: uuid.UUID, job_card: JobCard) -> None:
    from .planning import _final_spec_qc_passed
    if not _final_spec_qc_passed(db=db, plant_id=plant_id, job_card=job_card):
        raise HTTPException(status_code=409, detail="Final QC has not passed for this card. Record a passing final QC inspection, then seal the challan.")


def _downstream_detail(response: Any) -> str:
    """The plain message another service sent back (its JSON ``detail``), else its raw text."""
    try:
        body = response.json()
    except ValueError:
        body = None
    detail = body.get("detail") if isinstance(body, dict) else None
    if isinstance(detail, list):
        detail = "; ".join(str(row.get("msg") if isinstance(row, dict) else row) for row in detail)
    text_value = str(detail or getattr(response, "text", "") or f"error {getattr(response, 'status_code', '')}").strip()
    return text_value[:500]


AUTH_SERVICE_URL = os.getenv("AUTH_SERVICE_URL", "http://auth-service:8001")
# GST state / union-territory codes (first two digits of a GSTIN); same names as the party masters.
GST_STATE_NAMES = {
    "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
    "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
    "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya",
    "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
    "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "28": "Andhra Pradesh (old)",
    "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
    "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
    "97": "Other Territory", "99": "Centre Jurisdiction",
}
_GSTIN_SHAPE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][0-9A-Z][0-9A-Z]$")


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _gstin_state(gstin: str) -> tuple[str, str]:
    if not _GSTIN_SHAPE.match(gstin) or gstin[:2] not in GST_STATE_NAMES:
        return "", ""
    return gstin[:2], GST_STATE_NAMES[gstin[:2]]


def _without_blanks(values: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in values.items() if value not in (None, "")}


def _plant_challan_party(plant: Optional[dict]) -> dict[str, Any]:
    """Plant block of the challan from the plant master (same fields as the web's plantChallanParty)."""
    if not plant:
        return {}
    gstin = _clean(plant.get("gstin")).upper()
    code, state = _gstin_state(gstin)
    return _without_blanks({
        "id": _clean(plant.get("id")), "code": _clean(plant.get("code")), "name": _clean(plant.get("name")),
        "legal_name": _clean(plant.get("legal_name")), "address": _clean(plant.get("address")), "gstin": gstin,
        "state": state, "state_code": code,
    })


def _customer_challan_party(customer: Optional[dict]) -> dict[str, Any]:
    """Customer block of the challan from the customer master (same fields as the web's customerChallanParty)."""
    if not customer:
        return {}
    gstin = _clean(customer.get("gst_no") or customer.get("tax_id")).upper()
    tax_code, tax_state = _gstin_state(gstin)
    state_code = _clean(customer.get("billing_state_code")) or tax_code
    billing = _clean(customer.get("billing_full_address"))
    separate = any(_clean(customer.get(key)) for key in ("shipping_city", "shipping_state", "shipping_state_code", "shipping_pin_code")) or (
        _clean(customer.get("shipping_address")) and _clean(customer.get("shipping_address")) != _clean(customer.get("billing_address") or customer.get("address"))
    )
    # Goods go to a street, not to "Gujarat": the GSTIN alone fills the billing state, so a customer with only a
    # GSTIN (or only a city) has no dispatch address and the seal is refused (client 2026-10-28, checker round 2).
    street = _clean(customer.get("shipping_address")) if separate else _clean(customer.get("billing_address") or customer.get("address"))
    shipping = (_clean(customer.get("shipping_full_address")) or ("" if separate else billing)) if street else ""
    billing_state = _clean(customer.get("billing_state")) or GST_STATE_NAMES.get(state_code, "") or tax_state
    ship_name = _clean(customer.get("shipping_state")).lower()
    ship_code = (_clean(customer.get("shipping_state_code")) or next((code for code, name in GST_STATE_NAMES.items() if name.lower() == ship_name), "")) if separate else state_code
    ship_state = (_clean(customer.get("shipping_state")) or GST_STATE_NAMES.get(ship_code, "")) if separate else billing_state
    return _without_blanks({
        "id": _clean(customer.get("id")), "code": _clean(customer.get("customer_code")), "name": _clean(customer.get("name")),
        "gstin": gstin, "state": billing_state, "state_code": state_code,
        "billing_address": billing, "address": shipping, "ship_state": ship_state, "ship_state_code": ship_code,
        "contact_name": _clean(customer.get("dispatch_contact_name") or customer.get("primary_contact_name")),
        "contact_phone": _clean(customer.get("dispatch_contact_phone") or customer.get("primary_contact_phone")),
    })


def _master_get(url: str, token: str, plant_id: str, what: str) -> Any:
    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.get(url, headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id})
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"The {what} could not be read to fill the challan. Try Seal again in a minute.") from exc
    if response.status_code == 404:
        return None
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=f"The {what} could not be read to fill the challan: {_downstream_detail(response)}")
    try:
        return response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=f"The {what} sent back something unreadable. Try Seal again.") from exc


def _challan_parties_from_masters(db: Session, job_card: JobCard, plant_id: str, token: str) -> tuple[dict, dict]:
    """The plant and the order's customer, read from their masters at seal time (client 2026-10-28)."""
    plants = _master_get(f"{AUTH_SERVICE_URL}/plants", token, plant_id, "plant master") or []
    wanted = {str(job_card.plant_id), str(plant_id)}
    plant = next((row for row in plants if isinstance(row, dict) and (str(row.get("id")) in wanted or str(row.get("code")) in wanted)), None)
    order = db.query(SalesOrder).filter(SalesOrder.id == job_card.sales_order_id).first() if job_card.sales_order_id else None
    customer = None
    if order and order.customer_id:
        customer = _master_get(f"{settings.MASTERDATA_SERVICE_URL}/master/customers/{order.customer_id}", token, plant_id, "customer master")
    return _plant_challan_party(plant), _customer_challan_party(customer if isinstance(customer, dict) else None)


def _require_challan_document(*, db: Session, job_card: JobCard, snapshot: dict[str, Any], plant_id: str, token: str) -> dict[str, Any]:
    """Fill the plant and customer blocks from the masters and refuse a challan that would print blank.

    The browser checks the same things first; this keeps a direct API call from sealing a challan with a
    made-up or empty plant / customer block, or with no net weight.
    """
    company, customer = _challan_parties_from_masters(db, job_card, plant_id, token)
    plant_name = company.get("legal_name") or company.get("name") or "this plant"
    customer_name = customer.get("name") or "this customer"
    gaps: list[str] = []
    if not (company.get("legal_name") or company.get("name")):
        gaps.append("the plant's legal name is not in the plant master (System › Plants)")
    if not company.get("address"):
        gaps.append(f"the address of {plant_name} is not in the plant master (System › Plants)")
    if not company.get("gstin"):
        gaps.append(f"the GSTIN of {plant_name} is not in the plant master (System › Plants)")
    if not customer.get("name"):
        gaps.append("the customer of this order is not in the customer master for this plant (Masters › Customers)")
    elif not customer.get("address"):
        gaps.append(f"the dispatch (ship-to) street address of {customer_name} is not in the customer master (Masters › Customers)")
    transporter = snapshot.get("transporter") if isinstance(snapshot.get("transporter"), dict) else {}
    if not _clean(transporter.get("vehicle_no")):
        gaps.append("the vehicle number is empty")
    if not _clean(transporter.get("name")):
        gaps.append("the transporter name is empty")
    items = snapshot.get("items") if isinstance(snapshot.get("items"), list) else []
    first = items[0] if items and isinstance(items[0], dict) else {}
    net_weight = _number(first.get("net_weight"))
    if net_weight is None or not math.isfinite(net_weight) or net_weight <= 0:
        gaps.append("the net weight is empty or 0 kg (type it on the challan)")
    if gaps:
        raise HTTPException(status_code=422, detail="The challan cannot be sealed yet: " + "; ".join(gaps) + ".")
    return {**snapshot, "company": company, "customer": customer}


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
            detail="The finished goods of this card are not in stock yet (packing has not posted them). Close packing so the stock is posted, then seal the challan.",
        )

    payload = {
        "item_id": str(fg_item_id),
        "batch_id": str(inventory_batch_id),
        "qty": dispatch_qty,
        "effective_date": snapshot.get("date") or plant_today().isoformat(),
        "dispatch_ref": dispatch_ref,
        "external_ref": str(
            snapshot.get("inventory_dispatch_external_ref")
            or snapshot.get("external_ref")
            or f"PROD-DISPATCH-REQUEST-{snapshot.get('dispatch_request_id') or dispatch.id}"
        ),
        "production_job_id": str(job_card.id),
        "sales_order_id": str(job_card.sales_order_id) if job_card.sales_order_id else None,
        "sales_order_line_id": str(job_card.sales_order_line_id) if job_card.sales_order_line_id else None,
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
        raise HTTPException(status_code=response.status_code, detail=f"Stock could not be moved out for this challan: {_downstream_detail(response)}")
    result = response.json()
    snapshot["inventory_dispatch_transaction_id"] = str(result.get("transaction_id"))
    snapshot["inventory_transaction_id"] = str(result.get("transaction_id"))
    snapshot["inventory_batch_id"] = str(result.get("batch_id") or inventory_batch_id)
    snapshot["inventory_item_id"] = str(result.get("item_id") or fg_item_id)
    snapshot["fg_inventory_inward_transaction_id"] = packing_snapshot.get("inventory_transaction_id")
    snapshot["inventory_dispatch_status"] = "POSTED"
    return snapshot


def _post_sales_request(*, path: str, token: str, plant_id: str, payload: dict[str, Any], action: str) -> dict[str, Any]:
    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.post(
                f"{settings.SALES_SERVICE_URL}{path}",
                headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
                json=payload,
            )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"{action} failed: {exc}") from exc
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=f"{action} refused: {_downstream_detail(response)}")
    try:
        result = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=f"{action} returned malformed JSON") from exc
    return result if isinstance(result, dict) else {}


def _persist_dispatch_failure(
    *,
    db: Session,
    dispatch: Dispatch,
    idem: DispatchIdempotency,
    snapshot: dict[str, Any],
    error: HTTPException,
) -> None:
    snapshot["orchestration_state"] = "FAILED"
    snapshot["orchestration_error"] = str(error.detail)
    dispatch.status = "DRAFT"
    dispatch.dispatch_snapshot = dict(snapshot)
    _safe_flag_modified(dispatch, "dispatch_snapshot")
    idem.status = "FAILED"
    idem.error_message = str(error.detail)
    idem.response_snapshot = dict(snapshot)
    db.commit()

@router.post("/", response_model=DispatchResponse)
def create_or_update_dispatch(
    payload: DispatchPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(DISPATCH_ACCESS_ROLES))
):
    candidate=db.query(JobCard).filter(JobCard.id==payload.job_card_id,JobCard.plant_id==_plant_uuid(plant_id)).first()
    line_id = getattr(candidate, "sales_order_line_id", None) if payload.status == "SEALED" else None
    with _sales_line_posting_lease(plant_id, line_id):
        if candidate and (getattr(candidate,"spec_snapshot",None) or {}).get("entry_model")=="V2":
            with card_posting_lease(payload.job_card_id):
                return _create_or_update_dispatch(payload,db,plant_id,current_user)
        return _create_or_update_dispatch(payload,db,plant_id,current_user)


def _create_or_update_dispatch(payload,db,plant_id,current_user):
    # Check if job card exists
    plant_uuid = _plant_uuid(plant_id)
    _acquire_dispatch_lock(db, f"dispatch-job:{plant_uuid}:{payload.job_card_id}")
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
    if payload.status == "SEALED":
        if not request_id:
            raise HTTPException(status_code=422, detail="dispatch_request_id is required when sealing a dispatch")
        effective_roles = {str(role) for role in (current_user.get("roles") or [])}
        if not effective_roles.intersection(DISPATCH_SEAL_ROLES):
            raise HTTPException(status_code=403, detail="Only an Owner, Admin or Dispatch user can seal a challan.")

    idem = None
    request_hash = _request_hash(payload) if request_id else ""
    if request_id:
        idem = (
            db.query(DispatchIdempotency)
            # request_id has a global unique index. Looking it up by plant as
            # well would miss another plant's row and turn a valid conflict
            # into an unhandled unique-constraint 500 during commit.
            .filter(DispatchIdempotency.request_id == request_id)
            .first()
        )
        if idem:
            if idem.job_card_id != payload.job_card_id:
                raise HTTPException(status_code=409, detail="dispatch_request_id already belongs to another job card")
            if (idem.response_snapshot or {}).get("orchestration_state") == "CANCELLED":
                raise HTTPException(status_code=409, detail="This shipment was cancelled. Refresh the page and make a new challan.")
            if idem.request_hash != request_hash:
                raise HTTPException(status_code=409, detail="dispatch_request_id was already used with a different payload")
            if idem.status == "SUCCESS":
                completed = db.query(Dispatch).filter(Dispatch.job_card_id == payload.job_card_id, Dispatch.dispatch_snapshot["dispatch_request_id"].astext == request_id).first()
                if completed:
                    response_snapshot = {
                        **dispatch_snapshot,
                        **dict(idem.response_snapshot or {}),
                        "dispatch_request_id": request_id,
                        "orchestration_state": "SUCCESS",
                    }
                    return DispatchResponse(
                        id=completed.id,
                        job_card_id=payload.job_card_id,
                        dispatch_snapshot=response_snapshot,
                        status="SEALED",
                        dispatch_request_id=request_id,
                        sales_order_line_id=payload.sales_order_line_id,
                        fg_item_id=payload.fg_item_id,
                        fg_batch_id=payload.fg_batch_id,
                        dispatch_qty=payload.dispatch_qty,
                        created_at=completed.created_at,
                    )
                raise HTTPException(status_code=409, detail="Completed dispatch request has no dispatch record")
            if idem.status == "PENDING":
                pending_since = getattr(idem, "updated_at", None) or getattr(idem, "created_at", None)
                if pending_since and (datetime.utcnow() - pending_since).total_seconds() < 120:
                    raise HTTPException(
                        status_code=409,
                        detail="This shipment is already being saved. Wait a few seconds and press Retry shipment.",
                        headers={"Retry-After": "5"},
                    )

    # Check if a dispatch already exists
    dispatch = db.query(Dispatch).filter(Dispatch.job_card_id == payload.job_card_id, Dispatch.status == "DRAFT").first()
    persisted_snapshot = dict(dispatch.dispatch_snapshot or {}) if dispatch else {}

    if dispatch:
        previous = dispatch.dispatch_snapshot or {}
        if previous.get("orchestration_state") in {"PENDING", "FAILED"} and previous.get("dispatch_request_id") != request_id:
            raise HTTPException(status_code=409, detail="This card has an unfinished shipment. Open it and press Retry shipment to finish it before starting another.")
        if dispatch.status == "SEALED":
            raise HTTPException(status_code=400, detail="This challan is sealed and cannot be changed.")
        dispatch_snapshot = {**dict(dispatch.dispatch_snapshot or {}), **dispatch_snapshot}
        dispatch.dispatch_snapshot = dict(dispatch_snapshot)
        _safe_flag_modified(dispatch, "dispatch_snapshot")
        dispatch.status = "DRAFT" if payload.status == "SEALED" else payload.status
    else:
        dispatch = Dispatch(
            job_card_id=payload.job_card_id,
            dispatch_snapshot=dispatch_snapshot,
            status="DRAFT" if payload.status == "SEALED" else payload.status,
        )
        db.add(dispatch)

    db.flush()
    if payload.status != "SEALED":
        db.commit()
        db.refresh(dispatch)
        return dispatch

    _require_sales_line_available(db, job_card)

    active_holds = _active_hold_count(db, job_card.id)
    if active_holds:
        raise HTTPException(status_code=409, detail=f"{active_holds} hold(s) placed on this card stop all movement. Release them in Quality before sealing.")

    if box_rules.box_mode(db, job_card):
        return _seal_box_challan(db=db, job_card=job_card, dispatch=dispatch, idem=idem, payload=payload, plant_id=plant_id, plant_uuid=plant_uuid,
                                 current_user=current_user, dispatch_snapshot=dispatch_snapshot, request_id=request_id, request_hash=request_hash,
                                 persisted_snapshot=persisted_snapshot)

    qc_stage = None
    if (getattr(job_card,"spec_snapshot",None) or {}).get("entry_model")!="V2":
        # Owner decision 3 (2026-11-01): QC never holds or blocks dispatch; final QC out of band is a flag only.
        pass
    else:
        # Batch-entry card: final QC is the closed QC stage. On a Process-last card that is the Process
        # QC — every good batch QC-accepted before Process closes (client rule 2026-10-18).
        stages={s.stage_type:s for s in db.query(JobCardStage).filter_by(job_card_id=job_card.id).all()}
        if any(not stages.get(s) or stages[s].status!="COMPLETED" for s in ("PACKING","QC")):
            raise HTTPException(409,"Close the Process stage first (packing and its final QC close with it), then seal the challan.")
        qc_stage = stages["QC"]

    packing_record = db.query(PackingRecord).filter(PackingRecord.job_card_id == job_card.id).first()
    if not packing_record or float(packing_record.total_packed_qty or 0.0) <= 0:
        raise HTTPException(status_code=409, detail="Nothing is packed on this card yet. Close packing before sealing the challan.")

    dispatch_qty = _dispatch_qty(dispatch_snapshot, job_card, packing_record)
    if dispatch_qty <= 0:
        raise HTTPException(status_code=400, detail="Enter the shipment quantity (pcs) before sealing.")
    dispatchable_qty = dispatchable_quantity(job_card, packing_record, qc_stage)
    sealed = db.query(Dispatch).filter(Dispatch.job_card_id == job_card.id, Dispatch.status == "SEALED").all()
    previously_shipped = sum(float((row.dispatch_snapshot or {}).get("dispatch_qty") or (row.dispatch_snapshot or {}).get("qty") or 0) for row in sealed)
    dispatch_stage = db.query(JobCardStage).filter_by(job_card_id=job_card.id, stage_type="DISPATCH").first()
    retained_qty = float(((getattr(dispatch_stage, "actuals_snapshot", None) or {}).get("retained_fg_qty") or 0))
    if retained_qty > 0:
        raise HTTPException(409, "This card is reconciled with retained finished goods; create a governed new allocation before shipping that stock")
    remaining_qty = max(0, dispatchable_qty - previously_shipped - retained_qty)
    if dispatch_qty > remaining_qty + 0.0001:
        raise HTTPException(status_code=409, detail=f"Shipment quantity {dispatch_qty:g} pcs is more than the {remaining_qty:g} pcs of accepted finished goods left on this card.")
    allowance = shipping_allowance(job_card, dispatchable_qty, dispatch_stage)
    max_ship_qty = max(0, allowance - previously_shipped)
    if dispatch_qty > max_ship_qty + 0.0001:
        raise HTTPException(status_code=409, detail=f"Shipment quantity {dispatch_qty:g} pcs is more than this card's remaining released allocation of {max_ship_qty:g} pcs.")

    # Every seal attempt, a retry under the same request id included, reads the plant and customer from their
    # masters and refuses a challan that would print blank. The payload's own company / customer blocks are
    # never kept: the master copies are applied last, so a retry cannot swap in made-up details (checker r4).
    dispatch_snapshot = _require_challan_document(
        db=db, job_card=job_card, snapshot=dispatch_snapshot, plant_id=plant_id, token=current_user.get("token", ""),
    )

    # Freeze the plant business date once so a retry across midnight keeps
    # the original challan and inventory accounting date.
    dispatch_snapshot.setdefault("date", plant_today().isoformat())
    try:
        dispatch_snapshot["date"] = date.fromisoformat(str(dispatch_snapshot["date"])).isoformat()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Dispatch date must be YYYY-MM-DD") from exc
    dispatch_ref = _dispatch_ref(dispatch_snapshot, dispatch.id, request_id)
    # Keep human challan numbers separate from immutable receiver identities.
    # An old unfinished shipment keeps the reference under which Sales may
    # already have committed, so deployment cannot break its recovery.
    previous = persisted_snapshot
    legacy_pending = idem is not None and previous.get("orchestration_state") in {"PENDING", "FAILED"}
    sales_ref = (previous.get("sales_dispatch_ref") or
                 (previous.get("dispatch_ref") if legacy_pending else None) or
                 "DISPATCH-REQUEST:" + hashlib.sha256(request_id.encode()).hexdigest())
    token = current_user.get("token", "")
    if job_card.sales_order_line_id:
        _post_sales_request(
            path=f"/sales-orders/lines/{job_card.sales_order_line_id}/validate-dispatch",
            token=token, plant_id=plant_id,
            payload={"qty": dispatch_qty, "approved_spec_id": str(job_card.spec_id) if job_card.spec_id else None,
                     "dispatch_line_ref": sales_ref},
            action="The sales order check",
        )
    dispatch_snapshot.update(
        {
            "qty": dispatch_qty,
            "dispatch_qty": dispatch_qty,
            "dispatch_ref": dispatch_ref,
            "challan_no": dispatch_snapshot.get("challan_no") or dispatch_ref,
            "dispatch_request_id": request_id,
            "orchestration_state": "PENDING",
            "orchestration_error": None,
            "sales_dispatch_ref": sales_ref,
            "sales_validation_status": "VALIDATED" if job_card.sales_order_line_id else None,
        }
    )
    if not legacy_pending and not _existing_inventory_dispatch_id(dispatch_snapshot):
        dispatch_snapshot["inventory_dispatch_external_ref"] = "PROD-DISPATCH-REQUEST-" + hashlib.sha256(request_id.encode()).hexdigest()
    # Preserve the exact command for resuming after refresh or a different
    # authorized dispatch operator. Derived challan/posting fields must never
    # become a changed payload under the original idempotency key.
    if idem is None:
        dispatch_snapshot["seal_request"] = payload.model_dump(mode="json")
    dispatch.dispatch_snapshot = dict(dispatch_snapshot)
    _safe_flag_modified(dispatch, "dispatch_snapshot")
    if idem is None:
        idem = DispatchIdempotency(
            plant_id=plant_uuid,
            request_id=request_id,
            job_card_id=payload.job_card_id,
            request_hash=request_hash,
            status="PENDING",
            response_snapshot=dict(dispatch_snapshot),
        )
        db.add(idem)
    else:
        idem.status = "PENDING"
        idem.error_message = None
        idem.response_snapshot = dict(dispatch_snapshot)
    db.commit()

    try:
        dispatch_snapshot = _post_inventory_dispatch_if_needed(
            dispatch=dispatch,
            job_card=job_card,
            packing_record=packing_record,
            snapshot=dispatch_snapshot,
            dispatch_qty=dispatch_qty,
            dispatch_ref=dispatch_ref,
            token=token,
            plant_id=plant_id,
        )
        dispatch.dispatch_snapshot = dict(dispatch_snapshot)
        _safe_flag_modified(dispatch, "dispatch_snapshot")
        idem.response_snapshot = dict(dispatch_snapshot)
        db.commit()

        if job_card.sales_order_line_id:
            _post_sales_request(
                path=f"/sales-orders/lines/{job_card.sales_order_line_id}/record-dispatch",
                token=token,
                plant_id=plant_id,
                payload={"qty": dispatch_qty, "dispatch_line_ref": sales_ref},
                action="The sales order update",
            )
            dispatch_snapshot["sales_dispatch_status"] = "POSTED"

        dispatch_snapshot["orchestration_state"] = "SUCCESS"
        dispatch_snapshot["orchestration_error"] = None
        dispatch.dispatch_snapshot = dict(dispatch_snapshot)
        _safe_flag_modified(dispatch, "dispatch_snapshot")
        dispatch.status = "SEALED"
        if (getattr(job_card,"spec_snapshot",None) or {}).get("entry_model")=="V2":
            dispatch_stage=db.query(JobCardStage).filter_by(job_card_id=job_card.id,stage_type="DISPATCH").first()
            if dispatch_stage:
                shipped=previously_shipped+dispatch_qty
                dispatch_stage.output_qty=shipped;dispatch_stage.input_qty=shipped
                dispatch_stage.status="COMPLETED" if shipped>=dispatchable_qty-0.0001 else "RUNNING"
                dispatch_stage.actuals_snapshot={**(dispatch_stage.actuals_snapshot or {}),"produced_total":shipped,"accepted_total":shipped,"row_version":int((dispatch_stage.actuals_snapshot or {}).get("row_version",1))+1,"last_dispatch_id":str(dispatch.id),"closed_at":datetime.utcnow().isoformat() if dispatch_stage.status=="COMPLETED" else None}
        if previously_shipped + dispatch_qty >= dispatchable_qty - 0.0001:
            job_card.status = "COMPLETED"
            job_card.current_stage = "DONE"
        idem.status = "SUCCESS"
        idem.error_message = None
        idem.response_snapshot = dict(dispatch_snapshot)
        db.commit()
        db.refresh(dispatch)
        return dispatch
    except HTTPException as exc:
        _persist_dispatch_failure(
            db=db,
            dispatch=dispatch,
            idem=idem,
            snapshot=dispatch_snapshot,
            error=exc,
        )
        raise

def _seal_box_challan(*, db, job_card, dispatch, idem, payload, plant_id, plant_uuid, current_user, dispatch_snapshot, request_id, request_hash, persisted_snapshot):
    """Seal a challan built from boxes (owner decision 2, 2026-11-01): the boxes are the shipment."""
    from .entries import complete_if_shipped
    boxes = _challan_boxes(db, job_card, dispatch_snapshot, dispatch)
    dispatch_qty = float(sum(int(box.qty) for box in boxes))
    sealed = db.query(Dispatch).filter(Dispatch.job_card_id == job_card.id, Dispatch.status == "SEALED").all()
    previously_shipped = sum(float((row.dispatch_snapshot or {}).get("dispatch_qty") or (row.dispatch_snapshot or {}).get("qty") or 0) for row in sealed)
    dispatch_stage = db.query(JobCardStage).filter_by(job_card_id=job_card.id, stage_type="DISPATCH").first()
    boxed = float(box_rules.boxed_pcs(db, job_card.id))
    allowance = shipping_allowance(job_card, boxed, dispatch_stage)
    max_ship_qty = max(0.0, allowance - previously_shipped)
    if dispatch_qty > max_ship_qty + 0.0001:
        raise HTTPException(status_code=409, detail=f"These {len(boxes)} boxes hold {dispatch_qty:g} pcs, but only {max_ship_qty:g} pcs of this card's released quantity are left to ship. Leave the extra box(es) off; keep them with Retain surplus once the rest is shipped.")
    dispatch_snapshot = _require_challan_document(db=db, job_card=job_card, snapshot=dispatch_snapshot, plant_id=plant_id, token=current_user.get("token", ""))
    dispatch_snapshot.setdefault("date", plant_today().isoformat())
    try:
        dispatch_snapshot["date"] = date.fromisoformat(str(dispatch_snapshot["date"])).isoformat()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Dispatch date must be YYYY-MM-DD") from exc
    dispatch_ref = _dispatch_ref(dispatch_snapshot, dispatch.id, request_id)
    sales_ref = persisted_snapshot.get("sales_dispatch_ref") or "DISPATCH-REQUEST:" + hashlib.sha256(request_id.encode()).hexdigest()
    # A challan begun before this release keeps box-id-only stock keys, so its retry stays idempotent.
    if persisted_snapshot.get("box_ref_scope"):
        dispatch_snapshot["box_ref_scope"] = persisted_snapshot["box_ref_scope"]
    elif persisted_snapshot.get("orchestration_state") in {"PENDING", "FAILED"} or persisted_snapshot.get("inventory_box_transactions"):
        dispatch_snapshot.pop("box_ref_scope", None)
    else:
        dispatch_snapshot["box_ref_scope"] = str(dispatch.id)
    token = current_user.get("token", "")
    if job_card.sales_order_line_id:
        _post_sales_request(path=f"/sales-orders/lines/{job_card.sales_order_line_id}/validate-dispatch", token=token, plant_id=plant_id,
                            payload={"qty": dispatch_qty, "approved_spec_id": str(job_card.spec_id) if job_card.spec_id else None, "dispatch_line_ref": sales_ref},
                            action="The sales order check")
    dispatch_snapshot.update({
        "qty": dispatch_qty, "dispatch_qty": dispatch_qty, "dispatch_ref": dispatch_ref, "challan_no": dispatch_snapshot.get("challan_no") or dispatch_ref,
        "dispatch_request_id": request_id, "orchestration_state": "PENDING", "orchestration_error": None, "sales_dispatch_ref": sales_ref,
        "sales_validation_status": "VALIDATED" if job_card.sales_order_line_id else None,
        "box_ids": [str(box.id) for box in boxes],
        "boxes": [{"id": str(box.id), "box_code": box.box_code, "qty": int(box.qty), "is_part": bool(box.is_part), "qc_flagged": bool(box.qc_flagged)} for box in boxes],
        "box_packing": _box_packing_block(job_card, boxes),
        "packing_type": "Box", "units": len(boxes),
    })
    if idem is None:
        dispatch_snapshot["seal_request"] = payload.model_dump(mode="json")
    dispatch.dispatch_snapshot = dict(dispatch_snapshot)
    _safe_flag_modified(dispatch, "dispatch_snapshot")
    if idem is None:
        idem = DispatchIdempotency(plant_id=plant_uuid, request_id=request_id, job_card_id=payload.job_card_id, request_hash=request_hash, status="PENDING", response_snapshot=dict(dispatch_snapshot))
        db.add(idem)
    else:
        idem.status = "PENDING"; idem.error_message = None; idem.response_snapshot = dict(dispatch_snapshot)
    db.commit()
    try:
        dispatch_snapshot = _post_inventory_box_dispatch(job_card=job_card, boxes=boxes, snapshot=dispatch_snapshot, dispatch_ref=dispatch_ref, token=token, plant_id=plant_id)
        dispatch.dispatch_snapshot = dict(dispatch_snapshot)
        _safe_flag_modified(dispatch, "dispatch_snapshot")
        idem.response_snapshot = dict(dispatch_snapshot)
        db.commit()
        if job_card.sales_order_line_id:
            _post_sales_request(path=f"/sales-orders/lines/{job_card.sales_order_line_id}/record-dispatch", token=token, plant_id=plant_id,
                                payload={"qty": dispatch_qty, "dispatch_line_ref": sales_ref}, action="The sales order update")
            dispatch_snapshot["sales_dispatch_status"] = "POSTED"
        dispatch_snapshot["orchestration_state"] = "SUCCESS"
        dispatch_snapshot["orchestration_error"] = None
        dispatch.dispatch_snapshot = dict(dispatch_snapshot)
        _safe_flag_modified(dispatch, "dispatch_snapshot")
        dispatch.status = "SEALED"
        now = datetime.utcnow()
        for box in db.query(FgBox).filter(FgBox.id.in_([box.id for box in boxes])).all():
            box.status = "DISPATCHED"; box.dispatch_id = dispatch.id; box.dispatched_at = box.dispatched_at or now; box.row_version = int(box.row_version or 1) + 1
        shipped = previously_shipped + dispatch_qty
        if dispatch_stage is not None:
            dispatch_stage.output_qty = shipped; dispatch_stage.input_qty = shipped
            if dispatch_stage.status != "COMPLETED":
                dispatch_stage.status = "RUNNING"
            dispatch_stage.actuals_snapshot = {**(dispatch_stage.actuals_snapshot or {}), "produced_total": shipped, "accepted_total": shipped,
                                               "row_version": int((dispatch_stage.actuals_snapshot or {}).get("row_version", 1)) + 1, "last_dispatch_id": str(dispatch.id)}
        db.flush()
        complete_if_shipped(db, job_card)
        idem.status = "SUCCESS"; idem.error_message = None; idem.response_snapshot = dict(dispatch_snapshot)
        db.commit()
        db.refresh(dispatch)
        return dispatch
    except HTTPException as exc:
        _persist_dispatch_failure(db=db, dispatch=dispatch, idem=idem, snapshot=dispatch_snapshot, error=exc)
        raise


class CancelShipmentInput(BaseModel):
    # ENTRY_CORRECTION code from Masters › Reason codes ("Entry correction / void / reopen", owner decision 4).
    reason_code: Optional[str] = Field(default=None, max_length=40)
    reason_note: Optional[str] = Field(default=None, max_length=1000)


def _shipment_stock_refs(dispatch: Dispatch, snapshot: dict[str, Any]) -> list[str]:
    """Every stock-out key this draft may have used (posted, or sent with the reply lost)."""
    if isinstance(snapshot.get("box_ids"), list) and snapshot.get("box_ids"):
        return [_box_external_ref(snapshot, value) for value in snapshot["box_ids"]]
    refs = [snapshot.get("inventory_dispatch_external_ref"), snapshot.get("external_ref"),
            f"PROD-DISPATCH-REQUEST-{snapshot.get('dispatch_request_id') or dispatch.id}"]
    return [str(ref) for ref in dict.fromkeys(refs) if ref]


def _sales_counts_shipment(job_card: JobCard, sales_ref: str, token: str, plant_id: str) -> bool:
    """True when the order line already has this shipment's dispatch log (Sales recorded it)."""
    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.get(f"{settings.SALES_SERVICE_URL}/sales-orders/lines/{job_card.sales_order_line_id}",
                                  headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id})
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="Sales could not be reached to check this shipment. Nothing was cancelled; try again.") from exc
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Sales could not show this order line: {_downstream_detail(response)}. Nothing was cancelled.")
    logs = (response.json() or {}).get("dispatch_logs") or []
    return any(str(row.get("dispatch_line_ref") or "") == sales_ref for row in logs if isinstance(row, dict))


def _reverse_shipment_stock(refs: list[str], *, reversal_ref: str, choice, token: str, plant_id: str) -> list[dict[str, Any]]:
    """Put back whatever stock this draft moved out (idempotent per stock-out key in Stores)."""
    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.post(f"{settings.INVENTORY_SERVICE_URL}/dispatch/reverse",
                                   headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
                                   json={"external_refs": refs, "reversal_ref": reversal_ref, "reason": choice.text,
                                         "reason_code": choice.code, "reason_label": choice.label, "reason_note": choice.note})
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="Stores could not be reached to put the stock back. Nothing was cancelled; try again.") from exc
    if response.status_code not in (200, 201):
        raise HTTPException(status_code=response.status_code if response.status_code < 500 else 502,
                            detail=f"Stores could not put this shipment's stock back: {_downstream_detail(response)}. Nothing was cancelled.")
    return list((response.json() or {}).get("results") or [])


@router.post("/{dispatch_id}/cancel")
def cancel_unfinished_shipment(
    dispatch_id: uuid.UUID,
    payload: CancelShipmentInput,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(sorted(DISPATCH_SEAL_ROLES))),
):
    """Cancel a shipment whose seal failed half way (3 Nov 2026): any stock it moved out goes back, its boxes are
    ready again and a new challan can be made. Refused once Sales counts it (then Retry shipment finishes it)."""
    plant_uuid = _plant_uuid(plant_id)
    found = db.query(Dispatch).join(JobCard, JobCard.id == Dispatch.job_card_id).filter(
        Dispatch.id == dispatch_id, JobCard.plant_id == plant_uuid).first()
    if not found:
        raise HTTPException(status_code=404, detail="Dispatch not found")
    job_id = found.job_card_id
    line_id = db.query(JobCard.sales_order_line_id).filter(JobCard.id == job_id).scalar()
    db.rollback()
    # The same leases as sealing, so a Retry and a Cancel never run together.
    with _sales_line_posting_lease(plant_id, line_id), card_posting_lease(job_id):
        return _cancel_unfinished_shipment(db, dispatch_id, job_id, payload, plant_id, plant_uuid, current_user)


def _cancel_unfinished_shipment(db, dispatch_id, job_id, payload, plant_id, plant_uuid, current_user):
    from .planning import _record_audit_event
    from ..reasons import resolve_reason
    _acquire_dispatch_lock(db, f"dispatch-job:{plant_uuid}:{job_id}")
    job_card = db.query(JobCard).filter(JobCard.id == job_id, JobCard.plant_id == plant_uuid).first()
    dispatch = db.query(Dispatch).filter(Dispatch.id == dispatch_id, Dispatch.job_card_id == job_id).with_for_update().first()
    if not job_card or not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch not found")
    snapshot = dict(dispatch.dispatch_snapshot or {})
    state = snapshot.get("orchestration_state")
    if dispatch.status != "DRAFT" or state not in {"PENDING", "FAILED"}:
        raise HTTPException(status_code=409, detail="Only a shipment that stopped half way can be cancelled here. A plain draft is simply changed or left; a sealed challan stays.")
    request_id = str(snapshot.get("dispatch_request_id") or "")
    idem = db.query(DispatchIdempotency).filter(DispatchIdempotency.request_id == request_id).with_for_update().first() if request_id else None
    if state == "PENDING":
        since = getattr(idem, "updated_at", None) or getattr(idem, "created_at", None) if idem else None
        if since and (datetime.utcnow() - since).total_seconds() < 120:
            raise HTTPException(status_code=409, detail="This shipment is being saved right now. Wait two minutes, then cancel it if it is still stuck.")
    if snapshot.get("sales_dispatch_status") == "POSTED":
        raise HTTPException(status_code=409, detail="The sales order already counts this shipment, so it cannot be cancelled. Press Retry shipment to finish it.")
    choice = resolve_reason(category="ENTRY_CORRECTION", code=payload.reason_code, note=payload.reason_note, plant_id=plant_id,
                            token=current_user.get("token", ""), what="cancelling this shipment")
    token = current_user.get("token", "")
    sales_ref = str(snapshot.get("sales_dispatch_ref") or "")
    if job_card.sales_order_line_id and sales_ref and _sales_counts_shipment(job_card, sales_ref, token, plant_id):
        raise HTTPException(status_code=409, detail="The sales order already counts this shipment, so it cannot be cancelled. Press Retry shipment to finish it.")
    refs = _shipment_stock_refs(dispatch, snapshot)
    reversed_rows = _reverse_shipment_stock(refs, reversal_ref=f"PROD-DISPATCH-CANCEL-{dispatch.id}", choice=choice, token=token, plant_id=plant_id) if refs else []
    now = datetime.utcnow()
    # Boxes are marked shipped only when a seal finishes; any left pointing at this draft are ready again.
    released = []
    for box in db.query(FgBox).filter(FgBox.dispatch_id == dispatch.id, FgBox.job_card_id == job_card.id).all():
        box.status = "PACKED"; box.dispatch_id = None; box.dispatched_at = None; box.row_version = int(box.row_version or 1) + 1
        released.append(box.box_code)
    record = {"cancelled_at": now.isoformat(), "cancelled_by": current_user.get("sub"), "reason": choice.text, "reason_code": choice.code,
              "reason_label": choice.label, "reason_note": choice.note, "stock_reversals": reversed_rows, "boxes_released": released}
    if idem is not None:
        idem.status = "FAILED"
        idem.error_message = f"Cancelled: {choice.text}"[:500]
        idem.response_snapshot = {**dict(idem.response_snapshot or {}), "orchestration_state": "CANCELLED", "cancelled": record}
    _record_audit_event(db=db, plant_id=job_card.plant_id, entity_type="dispatch", entity_id=dispatch.id, action="SHIPMENT_CANCELLED",
                        actor_id=current_user.get("sub"), actor_role=",".join(current_user.get("roles") or []), job_card_id=job_card.id,
                        request_id=request_id or None, payload={**record, "dispatch_id": str(dispatch.id), "box_ids": snapshot.get("box_ids") or [],
                                                                "challan_no": snapshot.get("challan_no"), "dispatch_qty": snapshot.get("dispatch_qty")},
                        before_payload={"dispatch_snapshot": snapshot})
    # The unposted draft goes; its full contents stay in the audit (as Retain surplus does).
    db.delete(dispatch)
    db.commit()
    return {"cancelled": True, "dispatch_id": str(dispatch_id), "job_card_id": str(job_card.id), **record}


@router.get("/job-cards/{job_card_id}/boxes")
def dispatch_card_boxes(
    job_card_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(DISPATCH_VIEW_ROLES)),
):
    """The card's boxes for building a challan (tick or scan)."""
    job = _apply_job_plant_scope(db.query(JobCard).filter(JobCard.id == job_card_id), plant_scope).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job card not found")
    return {"summary": box_rules.box_summary(db, job), "boxes": [box_rules.box_dict(box) for box in box_rules.card_boxes(db, job.id)], **box_rules.label_fields(job)}


@router.get("/{dispatch_id}", response_model=DispatchResponse)
def get_dispatch(
    dispatch_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(DISPATCH_VIEW_ROLES))
):
    dispatch = _apply_job_plant_scope(
        db.query(Dispatch)
        .join(JobCard, JobCard.id == Dispatch.job_card_id)
        .filter(Dispatch.id == dispatch_id), plant_scope
    ).first()
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch not found")
    return dispatch

@router.get("/by-job/{job_card_id}", response_model=Optional[DispatchResponse])
def get_dispatch_by_job_card(
    job_card_id: uuid.UUID,
    include_sealed: bool = True,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(DISPATCH_VIEW_ROLES))
):
    query = _apply_job_plant_scope(db.query(Dispatch).join(JobCard, JobCard.id == Dispatch.job_card_id).filter(
        Dispatch.job_card_id == job_card_id), plant_scope)
    if not include_sealed:
        query = query.filter(Dispatch.status == "DRAFT")
    dispatch = query.order_by(Dispatch.created_at.desc()).first()
    return dispatch

@router.get("/by-job/{job_card_id}/sealed", response_model=list[DispatchResponse])
def list_sealed_dispatches_by_job_card(
    job_card_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(DISPATCH_VIEW_ROLES))
):
    """Every sealed challan of a card, oldest first: a box card can ship in several challans (issue #9)."""
    return _apply_job_plant_scope(db.query(Dispatch).join(JobCard, JobCard.id == Dispatch.job_card_id).filter(
        Dispatch.job_card_id == job_card_id, Dispatch.status == "SEALED"), plant_scope).order_by(Dispatch.created_at.asc()).all()


@router.get("/ready-jobs/", response_model=list[dict])
def get_ready_jobs_for_dispatch(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(DISPATCH_VIEW_ROLES))
):
    """
    Packed/packing handoffs and shipment history, restricted to the allowed plants.
    Candidate visibility is separate from the authoritative checks when sealing.
    """
    results = (_apply_job_plant_scope(
        db.query(JobCard, SalesOrder, Dispatch)
        .join(SalesOrder, JobCard.sales_order_id == SalesOrder.id)
        .outerjoin(Dispatch, JobCard.id == Dispatch.job_card_id)
        .filter(
            or_(and_(JobCard.status != "CANCELLED", JobCard.current_stage.in_(["PACKING", "QC", "DISPATCH", "DONE"])), Dispatch.status == "SEALED",
                # Box cards are on the register as soon as one box is packed, Process may still be running (2026-11-01).
                and_(JobCard.status != "CANCELLED", JobCard.id.in_(db.query(FgBox.job_card_id).filter(FgBox.status != "VOID")))),
        ), plant_scope
    )
        .order_by(JobCard.created_at.desc())
        .all()
    )

    grouped = {}
    for jc, so, dispatch in results:
        entry = grouped.setdefault(jc.id, {"id": jc.id, "job_card_no": jc.job_card_no,
            "plant_id": jc.plant_id, "status": jc.status,
            "current_stage": jc.current_stage, "spec_snapshot": jc.spec_snapshot,
            "planned_qty": jc.planned_qty, "customer_id": so.customer_id,
            "created_at": jc.created_at, "entry_model": (jc.spec_snapshot or {}).get("entry_model"),
            "shipments": [], "draft": None})
        if dispatch and dispatch.status == "SEALED":
            # dispatch_ref / challan_no (gate, 6 Nov 2026): the register shows "Tally T-… ✓" / "Not out of gate" per challan.
            entry["shipments"].append({"id": str(dispatch.id), "qty": float((dispatch.dispatch_snapshot or {}).get("dispatch_qty") or (dispatch.dispatch_snapshot or {}).get("qty") or 0), "created_at": dispatch.created_at,
                                       "dispatch_ref": (dispatch.dispatch_snapshot or {}).get("dispatch_ref") or (dispatch.dispatch_snapshot or {}).get("challan_no"),
                                       "challan_no": (dispatch.dispatch_snapshot or {}).get("challan_no") or (dispatch.dispatch_snapshot or {}).get("dispatch_ref")})
        elif dispatch:
            entry["draft"] = str(dispatch.id)
    ids = list(grouped)
    jobs = {jc.id: jc for jc, _, _ in results}
    packing = {p.job_card_id: p for p in db.query(PackingRecord).filter(PackingRecord.job_card_id.in_(ids)).all()} if ids else {}
    closing_stages = db.query(JobCardStage).filter(JobCardStage.job_card_id.in_(ids), JobCardStage.stage_type.in_(["QC", "DISPATCH"])).all() if ids else []
    qc = {s.job_card_id: s for s in closing_stages if s.stage_type == "QC"}
    dispatch_stages = {s.job_card_id: s for s in closing_stages if s.stage_type == "DISPATCH"}
    retained = {s.job_card_id: float((s.actuals_snapshot or {}).get("retained_fg_qty") or 0) for s in closing_stages if s.stage_type == "DISPATCH"}
    held = {key for key in ids if _active_hold_count(db, key)} if ids else set()
    box_rows = db.query(FgBox).filter(FgBox.job_card_id.in_(ids), FgBox.status != "VOID").all() if ids else []
    boxes_by_card: dict = {}
    for box in box_rows:
        boxes_by_card.setdefault(box.job_card_id, []).append(box)
    for key, entry in grouped.items():
        entry["shipments"].sort(key=lambda row: row["created_at"], reverse=True)
        entry["dispatched_qty"] = sum(row["qty"] for row in entry["shipments"])
        record = packing.get(key)
        entry["packed_qty"] = float(record.total_packed_qty or 0) if record else 0
        entry["released_qty"] = float(jobs[key].released_qty or jobs[key].planned_qty or 0)
        entry["dispatchable_qty"] = dispatchable_quantity(jobs[key], record, qc.get(key))
        final_qc_closed = qc.get(key) is not None and qc[key].status == "COMPLETED"
        entry.update(qc_excluded_quantities(jobs[key], record, qc.get(key)))
        entry["shipping_allowance"] = shipping_allowance(jobs[key], entry["dispatchable_qty"], dispatch_stages.get(key))
        entry["max_ship_qty"] = max(0, entry["shipping_allowance"] - entry["dispatched_qty"])
        entry["retained_qty"] = retained.get(key, 0)
        entry["physical_remaining_qty"] = max(0, entry["dispatchable_qty"] - entry["dispatched_qty"])
        entry["remaining_qty"] = max(0, entry["physical_remaining_qty"] - entry["retained_qty"])
        entry["dispatch_id"] = entry["draft"] or (entry["shipments"][0]["id"] if entry["shipments"] else None)
        entry["dispatch_status"] = "DRAFT" if entry.pop("draft") else ("SEALED" if entry["shipments"] and entry["remaining_qty"] <= 0.0001 else None)
        card_boxes = boxes_by_card.get(key)
        if card_boxes:
            # Box card: what can ship is the packed boxes already in stock, within the released quantity left.
            boxed = float(sum(b.qty for b in card_boxes))
            ready = [b for b in card_boxes if b.status == "PACKED" and b.fg_status == "POSTED"]
            entry["box_mode"] = True
            entry["boxes"] = {"total": len(card_boxes), "boxed_pcs": boxed, "packed": sum(1 for b in card_boxes if b.status == "PACKED"),
                              "ready": len(ready), "ready_pcs": float(sum(b.qty for b in ready)), "dispatched": sum(1 for b in card_boxes if b.status == "DISPATCHED"),
                              "retained": sum(1 for b in card_boxes if b.status == "RETAINED"), "flagged": sum(1 for b in card_boxes if b.qc_flagged),
                              "qty_per_box": box_rules.qty_per_box(jobs[key])}
            entry["packed_qty"] = boxed
            entry["dispatchable_qty"] = boxed
            entry["shipping_allowance"] = shipping_allowance(jobs[key], boxed, dispatch_stages.get(key))
            entry["max_ship_qty"] = max(0, min(entry["boxes"]["ready_pcs"], entry["shipping_allowance"] - entry["dispatched_qty"]))
            entry["retained_qty"] = float(sum(b.qty for b in card_boxes if b.status == "RETAINED"))
            entry["physical_remaining_qty"] = float(sum(b.qty for b in card_boxes if b.status == "PACKED"))
            entry["remaining_qty"] = entry["physical_remaining_qty"]
            done = jobs[key].status == "COMPLETED"
            entry["dispatch_status"] = "DRAFT" if entry["dispatch_status"] == "DRAFT" else ("SEALED" if done else None)
            entry["handoff_state"] = ("SEALED" if done else "QC_HOLD" if key in held else "BOXES_READY" if ready else
                                      "AWAITING_FG" if entry["boxes"]["packed"] else "PACKING")
            continue
        entry["handoff_state"] = (
            "REJECTED_QC" if entry["entry_model"] == "V2" and final_qc_closed and entry["packed_qty"] > 0 and entry["dispatchable_qty"] <= 0 else
            "RETAINED_FG" if entry["retained_qty"] > 0 else
            "SEALED" if entry["dispatch_status"] == "SEALED" else
            "QC_HOLD" if key in held else
            "AWAITING_PACKING" if entry["packed_qty"] <= 0 else
            "AWAITING_QC" if entry["entry_model"] == "V2" and not final_qc_closed else
            "AWAITING_FG" if not (record.snapshot or {}).get("inventory_batch_id") else
            "UNSEALED"
        )
    return list(grouped.values())
