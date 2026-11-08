"""Gate module rules (6 Nov 2026, plan §4–§5): bills in, visitors, goods out, reminders and digests.

None of these functions commit; the router (or the worker) commits. Every function takes the plant the
caller resolved with ``get_current_plant`` (or the gate's own plant on the public path) and never reads
another plant's rows.

Flow in short
- Bill in: the watchman photographs a bill or challan and taps a category (BILL_CATEGORY reason master).
  GB-MATERIAL → WITH_STORES (Store is told, the entry shows on Purchase › Goods inward "At the gate");
  anything else → WITH_ACCOUNTS (Accounts / plant head file it in the Bills inbox). Store or Accounts can
  re-categorise (logged). Posting a GRN with the entry links the entry and all its photos to the GRN and
  to every reel and lot of that GRN.
- Visitors: self check-in from the gate QR (or the watchman's walk-in form) makes an ARRIVED visit with
  its own pass. The watchman lets in (IN) or denies (GATE_DENY reason). Let in tells the host, who may
  reply Send in / Ask to wait / Not available. Out by tapping Out or scanning the pass.
- Goods out (owner correction, 8 Nov 2026): the watchman only photographs. "+ Goods out" takes the Tally bill
  and our challan photos and the vehicle no. and makes a GOODS_OUT entry WITH_STORES (no challan, no Tally
  no.). Store (or Dispatch / the plant head) links it on the dispatch register: one or more challans, each with
  its Tally bill no. One ``dispatch_gate_out`` row per dispatch (challan); the plant head may unlink with a
  GATE_OUT_UNLINK reason. Same principle as bills in: the watchman photographs, Store links.
"""
from __future__ import annotations

import csv
import io
import logging
import os
import re
import secrets
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any, Iterable, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, text
from sqlalchemy.orm import Session

from ..models import (
    DocumentSeries,
    PurchaseReceipt,
    PurchaseReceiptLine,
    ReceiptStockAllocation,
    StockTransaction,
    TransactionType,
    ItemMaster,
)
from ..models_gate import (
    DispatchGateOut,
    Gate,
    GateEntry,
    GateNoticeLog,
    GatePlantSetting,
    GateVisit,
    GateVisitor,
)
from ..models_vault import Document, DocumentLink
from ..notify_outbox import enqueue_notification
from . import doc_vault as vault

log = logging.getLogger(__name__)

# ── Roles (Owner and Admin pass every require_role) ────────────────────────────────────────────
WATCHMAN = "Watchman"
DESK_ROLES = ["Watchman", "PlantManager"]
STORE_LINK_ROLES = ["Store", "GRN", "PlantManager"]
ACCOUNTS_ROLES = ["Accounts", "PlantManager"]
RECATEGORISE_ROLES = ["Store", "GRN", "Accounts", "PlantManager"]
HISTORY_ROLES = ["PlantManager"]
DISPATCH_DESK_ROLES = ["Dispatch", "PlantManager"]
# Goods out (8 Nov 2026): who links the watchman's photos to challans and types / changes a Tally bill no.
GOODS_OUT_LINK_ROLES = ["Store", "Dispatch", "PlantManager"]
TALLY_ROLES = GOODS_OUT_LINK_ROLES
GOODS_OUT_UNLINK_ROLES = ["PlantManager"]
GATE_READ_ROLES = sorted(set(DESK_ROLES + STORE_LINK_ROLES + ACCOUNTS_ROLES + DISPATCH_DESK_ROLES))
# Visitor phone numbers and photos (plan §4 privacy).
PRIVACY_ROLES = frozenset({"Watchman", "PlantManager", "Owner", "Admin"})

MATERIAL_CATEGORY = "GB-MATERIAL"
MOBILE = re.compile(r"^[6-9][0-9]{9}$")
VEHICLE = re.compile(r"^[A-Z0-9 -]{4,20}$")
MAX_OPEN_VISITS_PER_MOBILE = 3
NO_SHOW_AFTER = timedelta(hours=12)
UNLINKED_REMINDER_AFTER = timedelta(hours=24)
LEAVING_LOOKBACK_DAYS = 3
CHALLAN_LOOKBACK_DAYS = 30
# A goods-out entry of the 7 Nov release (watchman picked the challan) is OUT; startup moves it to LINKED.
LINKED_STATES = ("LINKED", "OUT")
PUBLIC_PHOTO_WINDOW = timedelta(minutes=30)
DEFAULT_CLOSE = time(19, 0)
DEFAULT_RETENTION_DAYS = 365

# A host picked as a department: who gets the notification. Keep identical to auth-service
# routers/users.py GATE_DEPARTMENTS (the host list the visitor sees).
DEPARTMENTS: dict[str, tuple[str, tuple[str, ...]]] = {
    "MANAGEMENT": ("Management", ("Owner",)),
    "PLANT": ("Plant head", ("PlantManager",)),
    "ACCOUNTS": ("Accounts", ("Accounts",)),
    "STORES": ("Stores", ("Store", "GRN", "RMIssue")),
    "QUALITY": ("Quality", ("QC", "InwardQC", "InProcessQC")),
    "PLANNING": ("Planning", ("Planner",)),
    "DISPATCH": ("Dispatch", ("Dispatch",)),
    "SALES": ("Sales", ("Sales",)),
    "ADMIN": ("Office / admin", ("Admin",)),
    "PRODUCTION": ("Production floor", ("Operator",)),
}
REPLY_WORDS = {"SEND_IN": "Send in", "WAIT": "Ask to wait", "NOT_AVAILABLE": "Not available"}
STATUS_WORDS = {
    "AT_GATE": "At the gate", "WITH_STORES": "With Stores", "WITH_ACCOUNTS": "With Accounts", "LINKED": "Linked to GRN",
    "FILED": "Filed", "OUT": "Gone out", "VOID": "Void",
    "ARRIVED": "Waiting at gate", "IN": "Inside", "DENIED": "Denied", "NO_SHOW": "Did not come in",
}
# A visitor who went out has "Left"; a goods-out gate entry has "Gone out".
VISIT_STATUS_WORDS = {**STATUS_WORDS, "OUT": "Left"}


def _zone() -> ZoneInfo:
    return ZoneInfo(os.getenv("PLANT_TIMEZONE", "Asia/Kolkata") or "Asia/Kolkata")


def local_now(now: Optional[datetime] = None) -> datetime:
    return (now.replace(tzinfo=timezone.utc) if now else datetime.now(timezone.utc)).astimezone(_zone())


def plant_today(now: Optional[datetime] = None) -> date:
    return local_now(now).date()


def day_start_utc(day: date) -> datetime:
    return datetime.combine(day, time.min, tzinfo=_zone()).astimezone(timezone.utc).replace(tzinfo=None)


def iso(value: Optional[datetime]) -> Optional[str]:
    return value.replace(tzinfo=timezone.utc).isoformat() if value else None


def roles_of(current_user: dict) -> set[str]:
    return {str(role) for role in (current_user.get("roles") or [])} | ({str(current_user["role"])} if current_user.get("role") else set())


def actor_of(current_user: dict) -> str:
    return vault.actor_of(current_user)


def sees_private(current_user: dict) -> bool:
    return bool(roles_of(current_user) & PRIVACY_ROLES)


def is_watchman_only(current_user: dict) -> bool:
    roles = roles_of(current_user)
    return WATCHMAN in roles and not roles & {"Owner", "Admin", "PlantManager"}


def clean_text(value: Any, limit: int) -> Optional[str]:
    text_value = re.sub(r"\s+", " ", str(value or "")).strip()
    return text_value[:limit] or None


def clean_vehicle(value: Any) -> Optional[str]:
    raw = re.sub(r"\s+", " ", str(value or "").upper()).strip()
    if not raw:
        return None
    if not VEHICLE.match(raw):
        raise HTTPException(status_code=422, detail="Write the vehicle number as on the plate, e.g. GJ 01 AB 1234.")
    return raw


def clean_mobile(value: Any) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    if len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if not MOBILE.match(digits):
        raise HTTPException(status_code=422, detail="Enter a 10-digit Indian mobile number (starts with 6, 7, 8 or 9).")
    return digits


def masked_mobile(mobile: Optional[str]) -> Optional[str]:
    return f"{mobile[:2]}xxxxxx{mobile[-2:]}" if mobile and len(mobile) == 10 else None


def new_token() -> str:
    """128 random bits, URL-safe (22 characters)."""
    return secrets.token_urlsafe(16)


# ── Numbers: GE-YYMM-NNN and V-YYMM-NNN (the document_series pattern) ───────────────────────────
def next_series_no(db: Session, plant_id: str, document_type: str, prefix: str, model, column, now: Optional[datetime] = None) -> str:
    local = local_now(now)
    category = f"{prefix}-{local:%y%m}"
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"doc-series:{plant_id}:{document_type}:{category}"})
    counter = db.query(DocumentSeries).filter(
        DocumentSeries.plant_id == str(plant_id), DocumentSeries.document_type == document_type,
        DocumentSeries.category == category,
    ).with_for_update().first()
    if not counter:
        counter = DocumentSeries(plant_id=str(plant_id), document_type=document_type, category=category, prefix=prefix, next_value=1)
        db.add(counter)
        db.flush()
    sequence = int(counter.next_value or 1)
    candidate = f"{category}-{sequence:03d}"
    while db.query(model.id).filter(model.plant_id == str(plant_id), column == candidate).first():
        sequence += 1
        candidate = f"{category}-{sequence:03d}"
    counter.next_value = sequence + 1
    counter.version = int(counter.version or 1) + 1
    return candidate


# ── Settings ───────────────────────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class GateSettings:
    plant_id: str
    gate_close_time: time
    visitor_retention_days: int
    version: int
    updated_by: Optional[str] = None


def settings_for(db: Session, plant_id: str) -> GateSettings:
    row = db.get(GatePlantSetting, str(plant_id))
    if not row:
        return GateSettings(str(plant_id), DEFAULT_CLOSE, DEFAULT_RETENTION_DAYS, 0)
    return GateSettings(str(plant_id), row.gate_close_time or DEFAULT_CLOSE, int(row.visitor_retention_days or DEFAULT_RETENTION_DAYS), int(row.version or 1),
                        row.updated_by)


def settings_payload(settings: GateSettings) -> dict[str, Any]:
    return {"plant_id": settings.plant_id, "gate_close_time": settings.gate_close_time.strftime("%H:%M"),
            "visitor_retention_days": settings.visitor_retention_days, "version": settings.version, "updated_by": settings.updated_by,
            "defaults": {"gate_close_time": DEFAULT_CLOSE.strftime("%H:%M"), "visitor_retention_days": DEFAULT_RETENTION_DAYS}}


def update_settings(db: Session, plant_id: str, *, gate_close_time: time, visitor_retention_days: int, expected_version: int, actor: str) -> GateSettings:
    row = db.query(GatePlantSetting).filter(GatePlantSetting.plant_id == str(plant_id)).with_for_update().first()
    current = int(row.version or 1) if row else 0
    if current != int(expected_version):
        raise HTTPException(status_code=409, detail="The gate settings changed since you opened them. Reload and save again.")
    if not 30 <= int(visitor_retention_days) <= 3650:
        raise HTTPException(status_code=422, detail="Keep visitor photos for 30 to 3,650 days.")
    if not row:
        row = GatePlantSetting(plant_id=str(plant_id), version=0)
        db.add(row)
    row.gate_close_time = gate_close_time
    row.visitor_retention_days = int(visitor_retention_days)
    row.updated_by = actor
    row.updated_at = datetime.utcnow()
    row.version = current + 1
    db.flush()
    return settings_for(db, plant_id)


def is_overstay(visit: GateVisit, settings: GateSettings, now: Optional[datetime] = None) -> bool:
    """Still inside after the plant's gate close time (today's, or the visit came in on an earlier day)."""
    if visit.status != "IN" or not visit.in_at:
        return False
    current = local_now(now)
    came = local_now(visit.in_at)
    if came.date() < current.date():
        return True
    return current.time() >= settings.gate_close_time


# ── Gates ──────────────────────────────────────────────────────────────────────────────────────
def gate_payload(gate: Gate, *, with_token: bool = False) -> dict[str, Any]:
    payload = {"id": str(gate.id), "plant_id": gate.plant_id, "code": gate.code, "name": gate.name, "direction": gate.direction,
               "active": bool(gate.active), "version": int(gate.version or 1), "token_rotated_at": iso(gate.token_rotated_at),
               "token_rotated_by": gate.token_rotated_by, "created_at": iso(gate.created_at)}
    if with_token:
        payload["qr_token"] = gate.qr_token
        payload["public_path"] = f"/visit/{gate.qr_token}"
    return payload


def get_gate(db: Session, plant_id: str, gate_id: Any, *, active_only: bool = False, for_update: bool = False) -> Gate:
    try:
        key = uuid.UUID(str(gate_id))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Pick the gate you are at.") from exc
    query = db.query(Gate).filter(Gate.id == key, Gate.plant_id == str(plant_id))
    if for_update:
        query = query.with_for_update()
    gate = query.first()
    if not gate:
        raise HTTPException(status_code=404, detail="That gate is not in this plant. Pick your gate again.")
    if active_only and not gate.active:
        raise HTTPException(status_code=409, detail=f"{gate.name} is switched off in System › Gates. Pick another gate.")
    return gate


def create_gate(db: Session, plant_id: str, *, code: str, name: str, direction: str, actor: str) -> Gate:
    code_value = re.sub(r"[^A-Z0-9-]", "", str(code or "").upper())[:20]
    name_value = clean_text(name, 120)
    direction_value = str(direction or "BOTH").upper()
    if not code_value or not name_value:
        raise HTTPException(status_code=422, detail="Give the gate a short code (e.g. G1) and a name (e.g. Main gate).")
    if direction_value not in ("IN", "OUT", "BOTH"):
        raise HTTPException(status_code=422, detail="A gate is for In, Out or Both.")
    if db.query(Gate.id).filter(Gate.plant_id == str(plant_id), Gate.code == code_value).first():
        raise HTTPException(status_code=409, detail=f"Gate {code_value} already exists in this plant.")
    gate = Gate(plant_id=str(plant_id), code=code_value, name=name_value, direction=direction_value, active=True,
                qr_token=new_token(), created_by=actor, version=1)
    db.add(gate)
    db.flush()
    return gate


def update_gate(db: Session, gate: Gate, *, changes: dict[str, Any], expected_version: int) -> Gate:
    if int(gate.version or 1) != int(expected_version):
        raise HTTPException(status_code=409, detail=f"{gate.name} changed since you opened it. Reload and try again.")
    if "name" in changes and changes["name"] is not None:
        name_value = clean_text(changes["name"], 120)
        if not name_value:
            raise HTTPException(status_code=422, detail="The gate needs a name.")
        gate.name = name_value
    if "direction" in changes and changes["direction"] is not None:
        direction_value = str(changes["direction"]).upper()
        if direction_value not in ("IN", "OUT", "BOTH"):
            raise HTTPException(status_code=422, detail="A gate is for In, Out or Both.")
        gate.direction = direction_value
    if "active" in changes and changes["active"] is not None:
        gate.active = bool(changes["active"])
    gate.version = int(gate.version or 1) + 1
    db.flush()
    return gate


def rotate_token(db: Session, gate: Gate, *, actor: str, expected_version: int) -> Gate:
    if int(gate.version or 1) != int(expected_version):
        raise HTTPException(status_code=409, detail=f"{gate.name} changed since you opened it. Reload and try again.")
    gate.qr_token = new_token()
    gate.token_rotated_at = datetime.utcnow()
    gate.token_rotated_by = actor
    gate.version = int(gate.version or 1) + 1
    db.flush()
    return gate


def gate_by_token(db: Session, token: str) -> Gate:
    value = str(token or "").strip()
    gate = db.query(Gate).filter(Gate.qr_token == value).first() if 16 <= len(value) <= 64 else None
    if not gate or not gate.active:
        raise HTTPException(status_code=404, detail="This gate QR is not in use any more. Ask the watchman to check you in.")
    return gate


# ── Notifications ──────────────────────────────────────────────────────────────────────────────
def notify(db: Session, *, plant_id: str, event_type: str, title: str, message: str, href: Optional[str],
           roles: Iterable[str] = (), emails: Iterable[str] = (), action: Optional[dict[str, Any]] = None,
           entity_id: Any = None, payload: Optional[dict[str, Any]] = None, priority: Optional[str] = "action") -> Optional[str]:
    return enqueue_notification(db, plant_id=str(plant_id), event_type=event_type, title=title, message=message, href=href,
                                recipient_roles=list(roles), recipient_user_emails=list(emails), action=action,
                                entity_type="gate", entity_id=str(entity_id or ""), payload=payload, priority=priority)


# ── Bills in ───────────────────────────────────────────────────────────────────────────────────
def route_for(category_code: str) -> tuple[str, str]:
    return ("STORES", "WITH_STORES") if str(category_code or "").upper() == MATERIAL_CATEGORY else ("ACCOUNTS", "WITH_ACCOUNTS")


def doc_kind_for(route: str) -> str:
    return "VENDOR_BILL" if route == "STORES" else "EXPENSE_BILL"


def _history(entry: GateEntry, actor: str, action: str, **detail: Any) -> None:
    entry.history = [*(entry.history or []), {"at": datetime.utcnow().isoformat(), "by": actor, "action": action,
                                              **{key: value for key, value in detail.items() if value is not None}}]


def entry_documents(db: Session, entry: GateEntry, access: Optional[vault.DocumentAccess] = None) -> list[Document]:
    return vault.documents_for(db, entry.plant_id, "GATE_ENTRY", entry.id, access=access)


def _notify_route(db: Session, entry: GateEntry, *, reminder: bool = False) -> None:
    who = entry.party_text or "a vendor"
    vehicle = f" · {entry.vehicle_no}" if entry.vehicle_no else ""
    if entry.route == "STORES":
        href = f"/purchase/inward?gate_entry={entry.id}"
        notify(db, plant_id=entry.plant_id,
               event_type="GATE_MATERIAL_UNLINKED_24H" if reminder else "GATE_MATERIAL_ARRIVED",
               title=(f"Material bill {entry.entry_no} still has no GRN" if reminder else f"Material at the gate · {entry.entry_no}"),
               message=(f"The bill photographed at the gate {'more than 24 hours ago ' if reminder else ''}from {who}{vehicle} "
                        f"is waiting for a GRN. Open Goods inward › At the gate, pick it and post the GRN."),
               href=href, roles=["Store", "GRN"] + (["PlantManager"] if reminder else []), entity_id=entry.id,
               action={"kind": "GATE_ENTRY", "id": str(entry.id), "buttons": [{"key": "grn", "label": "Make GRN", "href": href, "tone": "primary"}]})
    elif entry.route == "ACCOUNTS":
        href = f"/gate/bills?entry={entry.id}"
        notify(db, plant_id=entry.plant_id, event_type="GATE_BILL_TO_FILE",
               title=f"{entry.category_label or 'Bill'} to file · {entry.entry_no}",
               message=f"A {str(entry.category_label or 'bill').lower()} came in at the gate{(' from ' + entry.party_text) if entry.party_text else ''}. "
                       "Fill in party, bill number, date, amount and cost head in Gate › Bills inbox, then tap Filed.",
               href=href, roles=["Accounts", "PlantManager"], entity_id=entry.id,
               action={"kind": "GATE_ENTRY", "id": str(entry.id), "buttons": [{"key": "open", "label": "Open bill", "href": href, "tone": "primary"}]})


def create_bill_entry(db: Session, *, plant_id: str, gate: Gate, category_code: str, category_label: str, actor: str,
                      request_id: Optional[uuid.UUID], vendor_id: Optional[str] = None, vendor_name: Optional[str] = None,
                      vehicle_no: Optional[str] = None, note: Optional[str] = None) -> tuple[GateEntry, bool]:
    if request_id:
        existing = db.query(GateEntry).filter(GateEntry.plant_id == str(plant_id), GateEntry.request_id == request_id).first()
        if existing:
            if existing.kind != "BILL_IN" or str(existing.gate_id) != str(gate.id):
                raise HTTPException(status_code=409, detail="This request key was used for another gate entry. Reload and save again.")
            return existing, False
    if gate.direction == "OUT":
        raise HTTPException(status_code=409, detail=f"{gate.name} is an out gate. Pick the gate where the bill came in.")
    route, status = route_for(category_code)
    entry = GateEntry(
        plant_id=str(plant_id), entry_no=next_series_no(db, plant_id, "GATE_ENTRY", "GE", GateEntry, GateEntry.entry_no),
        request_id=request_id, gate_id=gate.id, direction="IN", kind="BILL_IN", category_code=str(category_code).upper(),
        category_label=category_label, route=route, status=status, vehicle_no=clean_vehicle(vehicle_no),
        party_id=clean_text(vendor_id, 64), party_text=clean_text(vendor_name, 200), note=clean_text(note, 500),
        history=[], created_by=actor, version=1,
    )
    _history(entry, actor, "CREATED", category=entry.category_code, route=route)
    db.add(entry)
    db.flush()
    _notify_route(db, entry)
    return entry, True


def get_entry(db: Session, plant_id: str, entry_id: Any, *, for_update: bool = False) -> GateEntry:
    try:
        key = uuid.UUID(str(entry_id))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="Gate entry not found.") from exc
    query = db.query(GateEntry).filter(GateEntry.id == key, GateEntry.plant_id == str(plant_id))
    if for_update:
        query = query.with_for_update()
    entry = query.first()
    if not entry:
        raise HTTPException(status_code=404, detail="That gate entry is not in this plant.")
    return entry


def _check_version(entry: GateEntry, expected_version: Optional[int]) -> None:
    if expected_version is not None and int(entry.version or 1) != int(expected_version):
        raise HTTPException(status_code=409, detail=f"{entry.entry_no} changed since you opened it (someone else acted on it). Reload and try again.")


def recategorise(db: Session, entry: GateEntry, *, category_code: str, category_label: str, actor: str, expected_version: Optional[int]) -> GateEntry:
    _check_version(entry, expected_version)
    if entry.kind != "BILL_IN" or entry.status not in ("AT_GATE", "WITH_STORES", "WITH_ACCOUNTS"):
        raise HTTPException(status_code=409, detail=f"{entry.entry_no} is {STATUS_WORDS.get(entry.status, entry.status).lower()}; its category can no longer change.")
    new_code = str(category_code).upper()
    if new_code == entry.category_code:
        return entry
    old_route, old_code = entry.route, entry.category_code
    route, status = route_for(new_code)
    entry.category_code, entry.category_label, entry.route, entry.status = new_code, category_label, route, status
    entry.reminded_at = None
    entry.version = int(entry.version or 1) + 1
    _history(entry, actor, "RECATEGORISED", **{"from": old_code, "to": new_code, "route_from": old_route, "route_to": route})
    kind = doc_kind_for(route)
    for document in entry_documents(db, entry):
        if document.kind != kind or document.category != new_code:
            vault.update_document(db, document, changes={"kind": kind, "category": new_code}, actor=actor, expected_version=int(document.version))
    db.flush()
    if route != old_route:
        _notify_route(db, entry)
    return entry


def receipt_stock_targets(db: Session, receipt: PurchaseReceipt) -> list[tuple[str, str]]:
    """Every reel and lot of a GRN as (entity_type, id)."""
    line_ids = [row.id for row in db.query(PurchaseReceiptLine.id).filter(PurchaseReceiptLine.receipt_id == receipt.id).all()]
    targets: list[tuple[str, str]] = []
    if line_ids:
        for reel_id, batch_id in db.query(ReceiptStockAllocation.reel_id, ReceiptStockAllocation.batch_id).filter(
                ReceiptStockAllocation.receipt_line_id.in_(line_ids)).all():
            if reel_id:
                targets.append(("REEL", str(reel_id)))
            elif batch_id:
                targets.append(("BATCH", str(batch_id)))
        for (batch_id,) in db.query(PurchaseReceiptLine.batch_id).filter(PurchaseReceiptLine.receipt_id == receipt.id,
                                                                         PurchaseReceiptLine.batch_id.isnot(None)).all():
            targets.append(("BATCH", str(batch_id)))
    seen: set[tuple[str, str]] = set()
    return [target for target in targets if not (target in seen or seen.add(target))]


def sync_entry_links(db: Session, entry: GateEntry, actor: str) -> int:
    """Give every photo of a linked entry the GRN and stock links (photos that uploaded after the link);
    the Tally bill and challan photos of a goods-out entry get a link to every challan Store linked it to."""
    if entry.kind == "GOODS_OUT":
        if entry.status not in LINKED_STATES:
            return 0
        refs = [row.dispatch_ref for row in entry_links(db, entry.plant_id, [entry.id]).get(str(entry.id), [])]
        if not refs and entry.dispatch_ref:
            refs = [entry.dispatch_ref]
        made = 0
        for document in entry_documents(db, entry):
            have = {(link.entity_type, link.entity_id) for link in document.links or []}
            for ref in refs:
                if ("DISPATCH", ref) not in have:
                    _, created = vault.link_document(db, document, "DISPATCH", ref, actor, plant_id=entry.plant_id)
                    made += 1 if created else 0
        return made
    if entry.status != "LINKED" or not entry.receipt_id:
        return 0
    receipt = db.query(PurchaseReceipt).filter(PurchaseReceipt.id == entry.receipt_id, PurchaseReceipt.plant_id == entry.plant_id).first()
    if not receipt:
        return 0
    targets = [("GRN", str(receipt.id)), *receipt_stock_targets(db, receipt)]
    made = 0
    for document in entry_documents(db, entry):
        have = {(link.entity_type, link.entity_id) for link in document.links or []}
        for entity_type, entity_id in targets:
            if (entity_type, entity_id) in have:
                continue
            _, created = vault.link_document(db, document, entity_type, entity_id, actor, plant_id=entry.plant_id)
            made += 1 if created else 0
        if receipt.supplier_name_snapshot and not document.party_name:
            document.party_name = receipt.supplier_name_snapshot
            document.party_type = document.party_type or "SUPPLIER"
            document.party_id = document.party_id or (str(receipt.supplier_id) if receipt.supplier_id else None)
    return made


def check_linkable(db: Session, plant_id: str, entry_id: Any) -> GateEntry:
    """Called before a GRN posts with ``gate_entry_id``: the entry must be a material bill of this plant
    that no other GRN has taken."""
    entry = get_entry(db, plant_id, entry_id, for_update=True)
    if entry.kind != "BILL_IN" or entry.route != "STORES":
        raise HTTPException(status_code=409, detail=f"{entry.entry_no} is not a material bill. Re-categorise it as Material first, or post the GRN without it.")
    if entry.status == "VOID":
        raise HTTPException(status_code=409, detail=f"{entry.entry_no} is void.")
    return entry


def link_receipt(db: Session, entry: GateEntry, receipt: PurchaseReceipt, *, actor: str, expected_version: Optional[int] = None) -> GateEntry:
    _check_version(entry, expected_version)
    if str(receipt.plant_id) != str(entry.plant_id):
        raise HTTPException(status_code=404, detail="That GRN is not in this plant.")
    if entry.status == "LINKED":
        if str(entry.receipt_id) == str(receipt.id):
            sync_entry_links(db, entry, actor)
            return entry
        other = db.get(PurchaseReceipt, entry.receipt_id)
        raise HTTPException(status_code=409, detail=f"{entry.entry_no} is already linked to GRN {other.grn_no if other else ''}.".replace(" .", "."))
    if entry.kind != "BILL_IN" or entry.route != "STORES" or entry.status not in ("AT_GATE", "WITH_STORES"):
        raise HTTPException(status_code=409, detail=f"{entry.entry_no} is not a material bill waiting for a GRN.")
    entry.receipt_id = receipt.id
    entry.status = "LINKED"
    entry.linked_by, entry.linked_at = actor, datetime.utcnow()
    if not entry.party_text and receipt.supplier_name_snapshot:
        entry.party_text = receipt.supplier_name_snapshot
        entry.party_id = entry.party_id or (str(receipt.supplier_id) if receipt.supplier_id else None)
    entry.version = int(entry.version or 1) + 1
    _history(entry, actor, "LINKED", grn_no=receipt.grn_no, receipt_id=str(receipt.id))
    db.flush()
    sync_entry_links(db, entry, actor)
    db.flush()
    return entry


def link_on_grn_post(db: Session, plant_id: str, gate_entry_id: Any, receipt: PurchaseReceipt, actor: str) -> Optional[GateEntry]:
    """The hook the GRN posts call just before commit (PO and manual GRN)."""
    if not gate_entry_id:
        return None
    db.flush()
    entry = check_linkable(db, plant_id, gate_entry_id)
    return link_receipt(db, entry, receipt, actor=actor)


def file_bill(db: Session, entry: GateEntry, *, party_name: str, party_id: Optional[str], bill_no: str, bill_date: date,
              amount: Decimal, cost_head_code: str, cost_head_label: str, actor: str, expected_version: Optional[int]) -> GateEntry:
    _check_version(entry, expected_version)
    if entry.kind != "BILL_IN" or entry.route != "ACCOUNTS" or entry.status not in ("WITH_ACCOUNTS", "AT_GATE", "FILED"):
        raise HTTPException(status_code=409, detail=f"{entry.entry_no} is not an expense bill for Accounts.")
    party = clean_text(party_name, 200)
    number = clean_text(bill_no, 120)
    if not party or not number or not bill_date:
        raise HTTPException(status_code=422, detail="Fill in the party, the bill number and the bill date.")
    if amount is None or amount < 0 or amount > Decimal("999999999999"):
        raise HTTPException(status_code=422, detail="Enter the bill amount (zero or more).")
    if bill_date > plant_today() + timedelta(days=1):
        raise HTTPException(status_code=422, detail="The bill date is in the future. Check the date on the bill.")
    was = entry.status
    entry.party_text, entry.party_id = party, clean_text(party_id, 64)
    entry.bill_no, entry.bill_date, entry.bill_amount = number, bill_date, Decimal(str(amount)).quantize(Decimal("0.01"))
    entry.cost_head_code, entry.cost_head_label = str(cost_head_code).upper(), cost_head_label
    entry.status = "FILED"
    entry.filed_by, entry.filed_at = actor, datetime.utcnow()
    entry.version = int(entry.version or 1) + 1
    _history(entry, actor, "REFILED" if was == "FILED" else "FILED", bill_no=number, amount=str(entry.bill_amount), cost_head=entry.cost_head_code)
    for document in entry_documents(db, entry):
        vault.update_document(db, document, changes={"party_type": "OTHER", "party_name": party, "ref_no": number, "ref_date": bill_date,
                                                     "amount": entry.bill_amount}, actor=actor, expected_version=int(document.version))
    db.flush()
    return entry


def entry_links(db: Session, plant_id: str, entry_ids: Iterable[Any]) -> dict[str, list[DispatchGateOut]]:
    """The challans each goods-out entry is linked to (dispatch_gate_out rows), oldest link first."""
    keys = [key for key in (_as_uuid(value) for value in entry_ids) if key]
    if not keys:
        return {}
    out: dict[str, list[DispatchGateOut]] = {}
    for row in (db.query(DispatchGateOut).filter(DispatchGateOut.plant_id == str(plant_id), DispatchGateOut.gate_entry_id.in_(keys))
                .order_by(DispatchGateOut.linked_at.asc().nullsfirst(), DispatchGateOut.dispatch_ref.asc()).all()):
        out.setdefault(str(row.gate_entry_id), []).append(row)
    return out


def _as_uuid(value: Any) -> Optional[uuid.UUID]:
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


def challan_words(refs: list[str]) -> str:
    if not refs:
        return ""
    return f"challan {refs[0]}" + (f" + {len(refs) - 1} more" if len(refs) > 1 else "")


def status_label(entry: GateEntry, refs: Optional[list[str]] = None) -> str:
    if entry.kind == "GOODS_OUT":
        if entry.status in LINKED_STATES:
            words = challan_words(refs or ([entry.dispatch_ref] if entry.dispatch_ref else []))
            return f"Linked to {words}" if words else "Linked"
        if entry.status == "WITH_STORES":
            return "With Stores"
    return STATUS_WORDS.get(entry.status, entry.status)


def link_payload(row: DispatchGateOut) -> dict[str, Any]:
    return {"dispatch_ref": row.dispatch_ref, "tally_bill_no": row.tally_bill_no,
            "tally_bill_date": row.tally_bill_date.isoformat() if row.tally_bill_date else None,
            "linked_by": row.linked_by, "linked_at": iso(row.linked_at), "out_at": iso(row.out_at)}


def entry_payload(db: Session, entry: GateEntry, *, gates: Optional[dict[str, Gate]] = None, documents: Optional[list[Document]] = None,
                  receipts: Optional[dict[str, PurchaseReceipt]] = None, access: Optional[vault.DocumentAccess] = None,
                  photos_missing: Optional[list[str]] = None, links: Optional[list[DispatchGateOut]] = None) -> dict[str, Any]:
    gate = (gates or {}).get(str(entry.gate_id)) if gates is not None else (db.get(Gate, entry.gate_id) if entry.gate_id else None)
    docs = documents if documents is not None else entry_documents(db, entry, access)
    if entry.kind == "GOODS_OUT" and links is None:
        links = entry_links(db, entry.plant_id, [entry.id]).get(str(entry.id), [])
    # The first challan Store picked (entry.dispatch_ref) leads; the rest follow in link order.
    links = sorted(links or [], key=lambda row: row.dispatch_ref != entry.dispatch_ref)
    refs = [row.dispatch_ref for row in links] or ([entry.dispatch_ref] if entry.kind == "GOODS_OUT" and entry.dispatch_ref else [])
    # A goods-out entry of the 7 Nov release still OUT (startup not yet run) reads as linked.
    shown_status = "LINKED" if entry.kind == "GOODS_OUT" and entry.status == "OUT" else entry.status
    receipt = None
    if entry.receipt_id:
        receipt = (receipts or {}).get(str(entry.receipt_id)) if receipts is not None else db.get(PurchaseReceipt, entry.receipt_id)
    return {
        "id": str(entry.id), "entry_no": entry.entry_no, "plant_id": entry.plant_id, "kind": entry.kind, "direction": entry.direction,
        "gate_id": str(entry.gate_id) if entry.gate_id else None, "gate_name": gate.name if gate else None,
        "category_code": entry.category_code, "category_label": entry.category_label, "route": entry.route,
        "status": shown_status, "status_label": status_label(entry, refs),
        "vehicle_no": entry.vehicle_no, "party_id": entry.party_id, "party_text": entry.party_text, "note": entry.note,
        "receipt_id": str(entry.receipt_id) if entry.receipt_id else None, "grn_no": receipt.grn_no if receipt else None,
        "dispatch_ref": entry.dispatch_ref, "dispatch_refs": refs, "links": [link_payload(row) for row in links],
        "bill_no": entry.bill_no, "bill_date": entry.bill_date.isoformat() if entry.bill_date else None,
        "bill_amount": float(entry.bill_amount) if entry.bill_amount is not None else None,
        "cost_head_code": entry.cost_head_code, "cost_head_label": entry.cost_head_label,
        "filed_by": entry.filed_by, "filed_at": iso(entry.filed_at), "linked_by": entry.linked_by, "linked_at": iso(entry.linked_at),
        "created_by": entry.created_by, "created_at": iso(entry.created_at), "version": int(entry.version or 1),
        "documents": [vault.document_payload(db, document) for document in docs],
        "document_count": len(docs), "history": list(entry.history or []),
        "photos_missing": ([label for kind, label in GOODS_OUT_PHOTOS if kind not in {document.kind for document in docs}]
                           if entry.kind == "GOODS_OUT" and photos_missing is None else (photos_missing or [])),
        "waiting_hours": round((datetime.utcnow() - entry.created_at).total_seconds() / 3600, 1) if entry.created_at else None,
    }


def entries_payload(db: Session, entries: list[GateEntry], access: Optional[vault.DocumentAccess] = None) -> list[dict[str, Any]]:
    if not entries:
        return []
    gate_ids = {entry.gate_id for entry in entries if entry.gate_id}
    gates = {str(gate.id): gate for gate in db.query(Gate).filter(Gate.id.in_(gate_ids)).all()} if gate_ids else {}
    receipt_ids = {entry.receipt_id for entry in entries if entry.receipt_id}
    receipts = {str(row.id): row for row in db.query(PurchaseReceipt).filter(PurchaseReceipt.id.in_(receipt_ids)).all()} if receipt_ids else {}
    ids = [str(entry.id) for entry in entries]
    query = (db.query(Document, DocumentLink.entity_id).join(DocumentLink, DocumentLink.document_id == Document.id)
             .filter(DocumentLink.entity_type == "GATE_ENTRY", DocumentLink.entity_id.in_(ids), Document.status == "ACTIVE"))
    # Every active photo of the entry is counted (the watchman may open only their own photos of today, but
    # the desk still says a photo is saved instead of "No photo").
    counts = dict(db.query(DocumentLink.entity_id, func.count(Document.id)).join(Document, Document.id == DocumentLink.document_id)
                  .filter(DocumentLink.entity_type == "GATE_ENTRY", DocumentLink.entity_id.in_(ids), Document.status == "ACTIVE")
                  .group_by(DocumentLink.entity_id).all())
    if access is not None:
        query = vault.visible_filter(query, access)
    by_entry: dict[str, list[Document]] = {}
    for document, entity_id in query.order_by(Document.uploaded_at.asc()).all():
        by_entry.setdefault(str(entity_id), []).append(document)
    # Goods-out photo status is counted over every photo (not only those this login may open).
    photos = goods_out_photos_missing(db, entries[0].plant_id, [(entry.id, entry.dispatch_ref) for entry in entries if entry.kind == "GOODS_OUT"])
    links = entry_links(db, entries[0].plant_id, [entry.id for entry in entries if entry.kind == "GOODS_OUT"])
    return [{**entry_payload(db, entry, gates=gates, documents=by_entry.get(str(entry.id), []), receipts=receipts,
                             photos_missing=photos.get(str(entry.id), []), links=links.get(str(entry.id), [])),
             "photo_count": int(counts.get(str(entry.id), 0))}
            for entry in entries]


def at_the_gate(db: Session, plant_id: str) -> list[GateEntry]:
    return (db.query(GateEntry).filter(GateEntry.plant_id == str(plant_id), GateEntry.kind == "BILL_IN",
                                       GateEntry.route == "STORES", GateEntry.status.in_(["AT_GATE", "WITH_STORES"]))
            .order_by(GateEntry.created_at.asc()).limit(200).all())


def receipt_gate_entries(db: Session, plant_id: str, receipt_ids: Iterable[Any]) -> dict[str, list[dict[str, Any]]]:
    keys = []
    for value in receipt_ids:
        try:
            keys.append(uuid.UUID(str(value)))
        except (TypeError, ValueError):
            continue
    if not keys:
        return {}
    out: dict[str, list[dict[str, Any]]] = {}
    for entry in db.query(GateEntry).filter(GateEntry.plant_id == str(plant_id), GateEntry.receipt_id.in_(keys)).order_by(GateEntry.created_at).all():
        out.setdefault(str(entry.receipt_id), []).append({"id": str(entry.id), "entry_no": entry.entry_no, "linked_at": iso(entry.linked_at)})
    return out


# ── Visitors ───────────────────────────────────────────────────────────────────────────────────
def known_visitor(db: Session, plant_id: str, mobile: str) -> Optional[GateVisitor]:
    return db.query(GateVisitor).filter(GateVisitor.plant_id == str(plant_id), GateVisitor.mobile == mobile).first()


@dataclass
class HostChoice:
    user_id: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    department_key: Optional[str] = None

    @property
    def department_label(self) -> Optional[str]:
        return DEPARTMENTS.get(self.department_key or "", (None, ()))[0]


def _host_words(visit: GateVisit) -> str:
    if visit.host_name:
        return f"{visit.host_name}{(' · ' + visit.host_department) if visit.host_department else ''}"
    return visit.host_department or "—"


def create_visit(db: Session, *, plant_id: str, gate: Gate, mobile: str, name: str, company: Optional[str], purpose_code: str,
                 purpose_label: str, purpose_note: Optional[str], host: HostChoice, people: int, vehicle_no: Optional[str],
                 source: str, actor: str, request_id: Optional[uuid.UUID]) -> tuple[GateVisit, bool]:
    mobile_value = clean_mobile(mobile)
    if request_id:
        existing = db.query(GateVisit).filter(GateVisit.plant_id == str(plant_id), GateVisit.request_id == request_id).first()
        if existing:
            if existing.gate_id != gate.id:
                raise HTTPException(status_code=409, detail="This check-in was already sent from another gate.")
            return existing, False
    name_value = clean_text(name, 120)
    if not name_value or len(name_value) < 2:
        raise HTTPException(status_code=422, detail="Write your name.")
    if not host.user_id and not host.department_key:
        raise HTTPException(status_code=422, detail="Say whom you are here to meet (a person or a department).")
    if host.department_key and host.department_key not in DEPARTMENTS:
        raise HTTPException(status_code=422, detail="Pick a department from the list.")
    people_value = int(people or 1)
    if not 1 <= people_value <= 50:
        raise HTTPException(status_code=422, detail="People coming in: 1 to 50.")
    if gate.direction == "OUT":
        raise HTTPException(status_code=409, detail=f"{gate.name} is an exit gate. Check in at the entry gate.")
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"gate-visitor:{plant_id}:{mobile_value}"})
    visitor = known_visitor(db, plant_id, mobile_value)
    if visitor and visitor.blocked and source == "SELF":
        raise HTTPException(status_code=403, detail="This number cannot check in here. Please speak to the watchman at the gate.")
    if source == "SELF" and visitor:
        open_visits = db.query(func.count(GateVisit.id)).filter(GateVisit.plant_id == str(plant_id), GateVisit.visitor_id == visitor.id,
                                                              GateVisit.status.in_(["ARRIVED", "IN"])).scalar() or 0
        if open_visits >= MAX_OPEN_VISITS_PER_MOBILE:
            raise HTTPException(status_code=429, detail="This number already has 3 open visits. Please speak to the watchman at the gate.")
    now = datetime.utcnow()
    if not visitor:
        visitor = GateVisitor(plant_id=str(plant_id), mobile=mobile_value, name=name_value, company=clean_text(company, 160), visits_count=0)
        db.add(visitor)
        db.flush()
    else:
        visitor.name = name_value
        visitor.company = clean_text(company, 160) or visitor.company
    visitor.visits_count = int(visitor.visits_count or 0) + 1
    visitor.last_visit_at = now
    visit = GateVisit(
        plant_id=str(plant_id), visit_no=next_series_no(db, plant_id, "GATE_VISIT", "V", GateVisit, GateVisit.visit_no),
        request_id=request_id, pass_token=new_token(), gate_id=gate.id, visitor_id=visitor.id, visitor_name=name_value,
        company=clean_text(company, 160), purpose_code=str(purpose_code).upper(), purpose_label=purpose_label,
        purpose_note=clean_text(purpose_note, 300), host_user_id=clean_text(host.user_id, 64), host_name=clean_text(host.name, 160),
        host_email=(clean_text(host.email, 200) or "").lower() or None,
        host_department=host.department_label if host.department_key else None,
        people=people_value, vehicle_no=clean_vehicle(vehicle_no), source=source, status="ARRIVED", arrived_at=now,
        created_by=actor, version=1,
    )
    # A host chosen as a department keeps its key for the notification (label shown to people).
    if host.department_key and not host.user_id:
        visit.host_department = host.department_label
        visit.host_user_id = None
    db.add(visit)
    db.flush()
    return visit, True


def department_key_of(visit: GateVisit) -> Optional[str]:
    if visit.host_user_id:
        return None
    for key, (label, _roles) in DEPARTMENTS.items():
        if label == visit.host_department:
            return key
    return None


def get_visit(db: Session, plant_id: str, visit_id: Any, *, for_update: bool = False) -> GateVisit:
    try:
        key = uuid.UUID(str(visit_id))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="Visit not found.") from exc
    query = db.query(GateVisit).filter(GateVisit.id == key, GateVisit.plant_id == str(plant_id))
    if for_update:
        query = query.with_for_update()
    visit = query.first()
    if not visit:
        raise HTTPException(status_code=404, detail="That visit is not in this plant.")
    return visit


def visit_by_pass(db: Session, pass_token: str, *, for_update: bool = False) -> GateVisit:
    value = str(pass_token or "").strip()
    if not 16 <= len(value) <= 64:
        raise HTTPException(status_code=404, detail="This pass is not valid. Check in again at the gate.")
    query = db.query(GateVisit).filter(GateVisit.pass_token == value)
    if for_update:
        query = query.with_for_update()
    visit = query.first()
    if not visit:
        raise HTTPException(status_code=404, detail="This pass is not valid. Check in again at the gate.")
    return visit


def pass_token_from_scan(value: str) -> str:
    """The pass QR carries ``HARIOM|VISIT|<token>`` or a ``/visit/pass/<token>`` link; a bare token works too."""
    raw = str(value or "").strip()
    match = re.search(r"/visit/pass/([A-Za-z0-9_-]{16,64})", raw)
    if match:
        return match.group(1)
    if raw.upper().startswith("HARIOM|VISIT|"):
        return raw.split("|", 2)[2].strip()
    return raw


def _host_recipients(visit: GateVisit) -> tuple[list[str], list[str]]:
    if visit.host_email:
        return [], [visit.host_email]
    key = department_key_of(visit)
    return (list(DEPARTMENTS[key][1]) if key else ["PlantManager"]), []


def let_in(db: Session, visit: GateVisit, *, actor: str, expected_version: Optional[int] = None) -> GateVisit:
    if expected_version is not None and int(visit.version or 1) != int(expected_version):
        raise HTTPException(status_code=409, detail=f"{visit.visit_no} changed since you opened it. Reload and try again.")
    if visit.status == "IN":
        return visit
    if visit.status != "ARRIVED":
        raise HTTPException(status_code=409, detail=f"{visit.visit_no} is {VISIT_STATUS_WORDS.get(visit.status, visit.status).lower()}; it cannot be let in.")
    visit.status, visit.in_at, visit.in_by = "IN", datetime.utcnow(), actor
    visit.version = int(visit.version or 1) + 1
    db.flush()
    roles, emails = _host_recipients(visit)
    base = f"/api/gate/visits/{visit.id}/reply"
    people = f" ({visit.people} people)" if int(visit.people or 1) > 1 else ""
    notify(db, plant_id=visit.plant_id, event_type="GATE_VISITOR_ARRIVED",
           title=f"Visitor for you: {visit.visitor_name}{people}",
           message=f"{visit.visitor_name}{(' from ' + visit.company) if visit.company else ''} is at the gate for {visit.purpose_label.lower()}"
                   f"{(' (' + visit.purpose_note + ')') if visit.purpose_note else ''}. The watchman has let them in. Tell the gate what to do.",
           href=f"/gate?visit={visit.id}", roles=roles, emails=emails, entity_id=visit.id,
           action={"kind": "GATE_VISIT", "id": str(visit.id), "buttons": [
               {"key": "send_in", "label": "Send in", "method": "POST", "path": base, "body": {"reply": "SEND_IN"}, "tone": "primary"},
               {"key": "wait", "label": "Ask to wait", "method": "POST", "path": base, "body": {"reply": "WAIT"}, "tone": "secondary"},
               {"key": "not_available", "label": "Not available", "method": "POST", "path": base, "body": {"reply": "NOT_AVAILABLE"}, "tone": "secondary"},
           ]}, payload={"visit_no": visit.visit_no})
    return visit


def deny(db: Session, visit: GateVisit, *, reason_code: str, reason_label: str, reason_note: Optional[str], actor: str,
         expected_version: Optional[int] = None) -> GateVisit:
    if expected_version is not None and int(visit.version or 1) != int(expected_version):
        raise HTTPException(status_code=409, detail=f"{visit.visit_no} changed since you opened it. Reload and try again.")
    if visit.status == "DENIED":
        return visit
    if visit.status != "ARRIVED":
        raise HTTPException(status_code=409, detail=f"{visit.visit_no} is {VISIT_STATUS_WORDS.get(visit.status, visit.status).lower()}; only a visitor waiting at the gate can be denied.")
    visit.status, visit.denied_by = "DENIED", actor
    visit.deny_code, visit.deny_label, visit.deny_note = reason_code, reason_label, reason_note
    visit.out_at = datetime.utcnow()
    visit.version = int(visit.version or 1) + 1
    db.flush()
    return visit


def mark_out(db: Session, visit: GateVisit, *, actor: str) -> GateVisit:
    if visit.status == "OUT":
        return visit
    if visit.status != "IN":
        raise HTTPException(status_code=409, detail=f"{visit.visit_no} is {VISIT_STATUS_WORDS.get(visit.status, visit.status).lower()}; only a visitor inside can go out.")
    visit.status, visit.out_at, visit.out_by = "OUT", datetime.utcnow(), actor
    visit.version = int(visit.version or 1) + 1
    db.flush()
    return visit


def may_reply(visit: GateVisit, current_user: dict) -> bool:
    roles = roles_of(current_user)
    if roles & {"Owner", "Admin", "PlantManager"}:
        return True
    if visit.host_user_id and str(current_user.get("user_id") or "") == str(visit.host_user_id):
        return True
    if visit.host_email and str(current_user.get("sub") or "").lower() == visit.host_email:
        return True
    key = department_key_of(visit)
    return bool(key and roles & set(DEPARTMENTS[key][1]))


def host_reply(db: Session, visit: GateVisit, *, reply: str, current_user: dict) -> GateVisit:
    value = str(reply or "").upper()
    if value not in REPLY_WORDS:
        raise HTTPException(status_code=422, detail="Reply Send in, Ask to wait or Not available.")
    if not may_reply(visit, current_user):
        raise HTTPException(status_code=403, detail="Only the person or department the visitor came to meet can reply.")
    if visit.status not in ("ARRIVED", "IN"):
        raise HTTPException(status_code=409, detail=f"{visit.visitor_name} is no longer inside ({VISIT_STATUS_WORDS.get(visit.status, visit.status).lower()}).")
    visit.host_reply, visit.host_reply_by, visit.host_reply_at = value, actor_of(current_user), datetime.utcnow()
    visit.version = int(visit.version or 1) + 1
    db.flush()
    return visit


def visit_payload(visit: GateVisit, *, gate: Optional[Gate], visitor: Optional[GateVisitor], private: bool,
                  settings: Optional[GateSettings] = None, now: Optional[datetime] = None) -> dict[str, Any]:
    payload = {
        "id": str(visit.id), "visit_no": visit.visit_no, "status": visit.status, "status_label": VISIT_STATUS_WORDS.get(visit.status, visit.status),
        "gate_id": str(visit.gate_id), "gate_name": gate.name if gate else None, "visitor_name": visit.visitor_name,
        "company": visit.company, "purpose_code": visit.purpose_code, "purpose_label": visit.purpose_label, "purpose_note": visit.purpose_note,
        "host_user_id": visit.host_user_id, "host_name": visit.host_name, "host_department": visit.host_department,
        "host_words": _host_words(visit), "people": int(visit.people or 1), "vehicle_no": visit.vehicle_no, "source": visit.source,
        "arrived_at": iso(visit.arrived_at), "in_at": iso(visit.in_at), "in_by": visit.in_by, "out_at": iso(visit.out_at), "out_by": visit.out_by,
        "denied_by": visit.denied_by, "deny_code": visit.deny_code, "deny_label": visit.deny_label, "deny_note": visit.deny_note,
        "host_reply": visit.host_reply, "host_reply_label": REPLY_WORDS.get(visit.host_reply or ""), "host_reply_by": visit.host_reply_by,
        "host_reply_at": iso(visit.host_reply_at), "version": int(visit.version or 1), "created_by": visit.created_by,
        "visits_count": int(visitor.visits_count or 0) if visitor else None,
        "overstay": is_overstay(visit, settings, now) if settings else False,
        "has_photo": bool(visit.photo_doc_id and not visit.photo_purged_at),
    }
    if private:
        payload["mobile"] = visitor.mobile if visitor else None
        payload["photo_url"] = f"/api/gate/visits/{visit.id}/photo" if payload["has_photo"] else None
    else:
        payload["mobile"] = masked_mobile(visitor.mobile) if visitor else None
        payload["photo_url"] = None
    return payload


def visits_payload(db: Session, visits: list[GateVisit], *, private: bool, settings: Optional[GateSettings] = None) -> list[dict[str, Any]]:
    if not visits:
        return []
    gates = {gate.id: gate for gate in db.query(Gate).filter(Gate.id.in_({visit.gate_id for visit in visits})).all()}
    visitors = {row.id: row for row in db.query(GateVisitor).filter(GateVisitor.id.in_({visit.visitor_id for visit in visits})).all()}
    now = datetime.utcnow()
    return [visit_payload(visit, gate=gates.get(visit.gate_id), visitor=visitors.get(visit.visitor_id), private=private,
                          settings=settings, now=now) for visit in visits]


def public_pass_payload(db: Session, visit: GateVisit) -> dict[str, Any]:
    """What the visitor's own phone shows: no host contact details, no phone number."""
    gate = db.get(Gate, visit.gate_id)
    return {
        "visit_no": visit.visit_no, "status": visit.status, "status_label": VISIT_STATUS_WORDS.get(visit.status, visit.status),
        "visitor_name": visit.visitor_name, "company": visit.company, "purpose_label": visit.purpose_label,
        "host_words": _host_words(visit), "people": int(visit.people or 1), "gate_name": gate.name if gate else None,
        "arrived_at": iso(visit.arrived_at), "in_at": iso(visit.in_at), "out_at": iso(visit.out_at),
        "host_reply": visit.host_reply, "host_reply_label": REPLY_WORDS.get(visit.host_reply or ""),
        "deny_label": visit.deny_label if visit.status == "DENIED" else None,
        "has_photo": bool(visit.photo_doc_id and not visit.photo_purged_at),
        "photo_allowed": visit.status == "ARRIVED" and not visit.photo_doc_id and visit.arrived_at is not None
        and datetime.utcnow() - visit.arrived_at <= PUBLIC_PHOTO_WINDOW,
        "pass_code": f"HARIOM|VISIT|{visit.pass_token}",
    }


def attach_public_photo(db: Session, visit: GateVisit, *, data: bytes, filename: Optional[str]) -> Document:
    if visit.status != "ARRIVED":
        raise HTTPException(status_code=409, detail="The photo can be added only while you wait at the gate.")
    if visit.photo_doc_id:
        raise HTTPException(status_code=409, detail="Your photo is already saved.")
    if not visit.arrived_at or datetime.utcnow() - visit.arrived_at > PUBLIC_PHOTO_WINDOW:
        raise HTTPException(status_code=409, detail="The photo can be added within 30 minutes of checking in. The watchman can take it.")
    mime = vault.sniff_mime(data)
    if mime not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(status_code=415, detail="Send a photo (JPEG, PNG or WebP).")
    document, _ = vault.create_document(db, plant_id=visit.plant_id, data=data, filename=filename or "visitor.jpg", kind="VISITOR_PHOTO",
                                        actor=f"visitor:{visit.visit_no}", source="GATE", party_type="VISITOR",
                                        party_name=visit.visitor_name, ref_no=visit.visit_no, link=("VISIT", str(visit.id)), dedupe=False)
    visit.photo_doc_id = document.id
    visit.version = int(visit.version or 1) + 1
    db.flush()
    return document


def attach_desk_photo(db: Session, visit: GateVisit, document_id: Any, actor: str) -> GateVisit:
    """The watchman's own photo of a walk-in (uploaded through the vault with link VISIT)."""
    document = vault.get_document(db, document_id, [visit.plant_id])
    if document.kind != "VISITOR_PHOTO":
        raise HTTPException(status_code=422, detail="That file is not a visitor photo.")
    vault.link_document(db, document, "VISIT", str(visit.id), actor, plant_id=visit.plant_id)
    visit.photo_doc_id = document.id
    visit.version = int(visit.version or 1) + 1
    db.flush()
    return visit


# ── Watchman desk ──────────────────────────────────────────────────────────────────────────────
def desk(db: Session, plant_id: str, gate: Gate, current_user: dict, now: Optional[datetime] = None) -> dict[str, Any]:
    if adopt_desk_photos(db, plant_id):
        db.flush()
    settings = settings_for(db, plant_id)
    today_start = day_start_utc(plant_today(now))
    private = sees_private(current_user)
    access = vault.access_for(current_user)
    open_visits = (db.query(GateVisit).filter(GateVisit.plant_id == str(plant_id), GateVisit.status.in_(["ARRIVED", "IN"]))
                   .order_by(GateVisit.arrived_at.asc()).limit(300).all())
    waiting = [v for v in open_visits if v.status == "ARRIVED"]
    inside = [v for v in open_visits if v.status == "IN"]
    entries_today = (db.query(GateEntry).filter(GateEntry.plant_id == str(plant_id), GateEntry.created_at >= today_start)
                     .order_by(GateEntry.created_at.desc()).limit(300).all())
    visits_today = (db.query(GateVisit).filter(GateVisit.plant_id == str(plant_id), GateVisit.arrived_at >= today_start)
                    .order_by(GateVisit.arrived_at.desc()).limit(300).all())
    if is_watchman_only(current_user):
        actor = actor_of(current_user)
        mine_entries = [entry for entry in entries_today if entry.created_by == actor]
        mine_visits = [visit for visit in visits_today if visit.created_by == actor or visit.in_by == actor or visit.out_by == actor
                       or visit.denied_by == actor or (visit.source == "SELF" and visit.gate_id == gate.id)]
    else:
        mine_entries, mine_visits = entries_today, visits_today
    vehicles = [entry for entry in entries_today if entry.kind == "BILL_IN" and entry.vehicle_no]
    waiting_payload = visits_payload(db, waiting, private=private, settings=settings)
    inside_payload = visits_payload(db, inside, private=private, settings=settings)
    # Goods out today whose Tally bill / challan photo is not in the vault yet (the truck was not held for it).
    goods_out_today = [entry for entry in mine_entries if entry.kind == "GOODS_OUT"]
    missing = goods_out_photos_missing(db, plant_id, [(entry.id, entry.dispatch_ref) for entry in goods_out_today])
    photos_pending = [{"entry_id": str(entry.id), "entry_no": entry.entry_no, "dispatch_ref": entry.dispatch_ref, "missing": missing[str(entry.id)]}
                      for entry in goods_out_today if missing.get(str(entry.id))]
    return {
        "gate": gate_payload(gate), "settings": settings_payload(settings),
        "counts": {"waiting": len(waiting), "inside": len(inside), "people_inside": sum(int(v.people or 1) for v in inside),
                   "overstay": sum(1 for row in inside_payload if row["overstay"]), "bills_today": sum(1 for e in entries_today if e.kind == "BILL_IN"),
                   "vehicles_today": len(vehicles),
                   # Goods out today whose photos Stores has not linked to a challan yet ("leaving" kept for old phones).
                   "to_link": sum(1 for e in entries_today if e.kind == "GOODS_OUT" and e.status == "WITH_STORES"),
                   "leaving": sum(1 for e in entries_today if e.kind == "GOODS_OUT" and e.status == "WITH_STORES"),
                   "out_today": sum(1 for e in entries_today if e.kind == "GOODS_OUT")},
        "photos_pending": photos_pending,
        "waiting": waiting_payload, "inside": inside_payload,
        "vehicles": entries_payload(db, vehicles[:30], access),
        "today": {"entries": entries_payload(db, mine_entries, access), "visits": visits_payload(db, mine_visits, private=private, settings=settings)},
        "server_time": iso(datetime.utcnow()),
    }


# ── Goods out ──────────────────────────────────────────────────────────────────────────────────
def _dispatch_rows(db: Session, plant_id: str, since_day: date):
    rows = (db.query(StockTransaction, ItemMaster.item_code, ItemMaster.name, ItemMaster.uom)
            .join(ItemMaster, ItemMaster.id == StockTransaction.item_id)
            .filter(StockTransaction.plant_id == str(plant_id), StockTransaction.transaction_type == TransactionType.DISPATCH,
                    or_(StockTransaction.effective_date >= since_day, and_(StockTransaction.effective_date.is_(None),
                                                                           StockTransaction.created_at >= day_start_utc(since_day))))
            .order_by(StockTransaction.created_at.asc()).all())
    if not rows:
        return []
    reversal_refs = [f"DISPATCH-REVERSAL-{txn.id}" for txn, *_ in rows]
    reversed_ids = {ref[len("DISPATCH-REVERSAL-"):] for (ref,) in db.query(StockTransaction.external_ref)
                    .filter(StockTransaction.external_ref.in_(reversal_refs)).all()}
    return [(txn, code, name, uom) for txn, code, name, uom in rows if str(txn.id) not in reversed_ids]


def dispatch_ref_of(txn: StockTransaction) -> Optional[str]:
    metadata = txn.movement_metadata if isinstance(txn.movement_metadata, dict) else {}
    value = str(metadata.get("dispatch_ref") or "").strip()
    return value or None


def dispatch_groups(db: Session, plant_id: str, since_day: date) -> dict[str, dict[str, Any]]:
    """Live (not reversed) dispatches since a day, one group per challan (dispatch_ref) with its items."""
    groups: dict[str, dict[str, Any]] = {}
    for txn, code, name, uom in _dispatch_rows(db, plant_id, since_day):
        ref = dispatch_ref_of(txn)
        if not ref:
            continue
        group = groups.setdefault(ref, {"dispatch_ref": ref, "items": {}, "posted_at": txn.created_at, "effective_date": txn.effective_date,
                                        "job_card_ids": set()})
        item = group["items"].setdefault(code, {"item_code": code, "item_name": name, "uom": getattr(uom, "value", str(uom)), "qty": 0.0})
        item["qty"] += abs(float(txn.qty_change or 0))
        metadata = txn.movement_metadata if isinstance(txn.movement_metadata, dict) else {}
        if metadata.get("production_job_id"):
            group["job_card_ids"].add(str(metadata["production_job_id"]))
    return groups


def leaving_today(db: Session, plant_id: str, *, now: Optional[datetime] = None) -> list[dict[str, Any]]:
    """Dispatches of the last few days with no linked gate-out photo yet, and today's that have one."""
    today = plant_today(now)
    groups = dispatch_groups(db, plant_id, today - timedelta(days=LEAVING_LOOKBACK_DAYS))
    if not groups:
        return []
    outs = {row.dispatch_ref: row for row in db.query(DispatchGateOut).filter(DispatchGateOut.plant_id == str(plant_id),
                                                                              DispatchGateOut.dispatch_ref.in_(list(groups))).all()}
    today_start = day_start_utc(today)
    result = []
    for ref, group in groups.items():
        out = outs.get(ref)
        went_out = bool(out and out.out_at)
        if went_out and out.out_at < today_start:
            continue
        posted_day = group["effective_date"] or (local_now(group["posted_at"]).date() if group["posted_at"] else today)
        result.append({
            "dispatch_ref": ref, "items": list(group["items"].values()),
            "qty_total": round(sum(item["qty"] for item in group["items"].values()), 3), "posted_at": iso(group["posted_at"]),
            "posted_day": posted_day.isoformat() if posted_day else None, "carried_over": bool(posted_day and posted_day < today),
            "job_card_ids": sorted(group["job_card_ids"]), "tally_bill_no": out.tally_bill_no if out else None,
            "tally_bill_date": out.tally_bill_date.isoformat() if out and out.tally_bill_date else None,
            "vehicle_no": out.vehicle_no if out else None, "out": went_out, "out_at": iso(out.out_at) if out else None,
            "gate_entry_id": str(out.gate_entry_id) if out and out.gate_entry_id else None,
        })
    result.sort(key=lambda row: (row["out"], row["posted_at"] or ""))
    return result


def dispatch_exists(db: Session, plant_id: str, dispatch_ref: str) -> bool:
    reference_id = uuid.uuid5(uuid.NAMESPACE_URL, dispatch_ref)
    rows = db.query(StockTransaction).filter(StockTransaction.plant_id == str(plant_id), StockTransaction.transaction_type == TransactionType.DISPATCH,
                                             StockTransaction.reference_id == reference_id).all()
    if not rows:
        return False
    reversed_refs = {ref for (ref,) in db.query(StockTransaction.external_ref).filter(
        StockTransaction.external_ref.in_([f"DISPATCH-REVERSAL-{row.id}" for row in rows])).all()}
    return any(f"DISPATCH-REVERSAL-{row.id}" not in reversed_refs for row in rows)


def clean_tally_no(value: Any) -> str:
    number = re.sub(r"\s+", " ", str(value or "")).strip().upper()
    if not number:
        raise HTTPException(status_code=422, detail="Type the Tally bill number from the printed Tally bill.")
    if len(number) > 60:
        raise HTTPException(status_code=422, detail="The Tally bill number is too long (60 characters at most).")
    return number


def _gate_out_row(db: Session, plant_id: str, dispatch_ref: str) -> Optional[DispatchGateOut]:
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"gate-out:{plant_id}:{dispatch_ref}"})
    return db.query(DispatchGateOut).filter(DispatchGateOut.plant_id == str(plant_id), DispatchGateOut.dispatch_ref == dispatch_ref).with_for_update().first()


def set_tally(db: Session, plant_id: str, dispatch_ref: str, *, tally_bill_no: str, tally_bill_date: Optional[date], actor: str,
              expected_version: Optional[int] = None) -> DispatchGateOut:
    """Store or the dispatch desk types the Tally bill no. on a challan (before or after it leaves). Never the
    watchman (the route allows Store / Dispatch / PlantManager only)."""
    ref = clean_text(dispatch_ref, 100)
    if not ref or not dispatch_exists(db, plant_id, ref):
        raise HTTPException(status_code=404, detail="That dispatch is not in this plant (or it was cancelled).")
    number = clean_tally_no(tally_bill_no)
    row = _gate_out_row(db, plant_id, ref)
    if row and expected_version is not None and int(row.version or 1) != int(expected_version):
        raise HTTPException(status_code=409, detail="The Tally bill number was changed by someone else. Reload and try again.")
    if not row:
        row = DispatchGateOut(plant_id=str(plant_id), dispatch_ref=ref, version=0)
        db.add(row)
    row.tally_bill_no, row.tally_bill_date = number, tally_bill_date or row.tally_bill_date
    row.tally_by, row.tally_at = actor, datetime.utcnow()
    row.version = int(row.version or 0) + 1
    db.flush()
    return row


def _notify_goods_out(db: Session, entry: GateEntry) -> None:
    href = f"/logistics/dispatch?gate_out={entry.id}"
    vehicle = f" ({entry.vehicle_no})" if entry.vehicle_no else ""
    notify(db, plant_id=entry.plant_id, event_type="GATE_GOODS_OUT_TO_LINK", title=f"Goods out at the gate · {entry.entry_no}",
           message=(f"A truck{vehicle} left at {local_now(entry.created_at).strftime('%H:%M')}. The watchman took the Tally bill and challan "
                    "photos. Open Dispatch register › Gone out at the gate, pick the challan(s) and add the Tally bill no."),
           href=href, roles=["Store", "Dispatch"], entity_id=entry.id,
           action={"kind": "GATE_ENTRY", "id": str(entry.id), "buttons": [{"key": "link", "label": "Link challan", "href": href, "tone": "primary"}]})


def create_goods_out(db: Session, *, plant_id: str, gate: Gate, vehicle_no: Optional[str], actor: str,
                     request_id: Optional[uuid.UUID]) -> tuple[GateEntry, bool]:
    """The watchman's "+ Goods out": photos (sent next through the vault outbox) and the vehicle no. only.
    The entry waits WITH_STORES until Store links it to the challan(s) with the Tally bill no."""
    if request_id:
        existing = db.query(GateEntry).filter(GateEntry.plant_id == str(plant_id), GateEntry.request_id == request_id).first()
        if existing:
            if existing.kind != "GOODS_OUT" or str(existing.gate_id) != str(gate.id):
                raise HTTPException(status_code=409, detail="This request key was used for another gate entry. Reload and try again.")
            return existing, False
    if gate.direction == "IN":
        raise HTTPException(status_code=409, detail=f"{gate.name} is an entry gate. Pick the gate the truck leaves from.")
    vehicle = clean_vehicle(vehicle_no)
    if not vehicle:
        raise HTTPException(status_code=422, detail="Type the vehicle number of the truck that is leaving.")
    entry = GateEntry(
        plant_id=str(plant_id), entry_no=next_series_no(db, plant_id, "GATE_ENTRY", "GE", GateEntry, GateEntry.entry_no),
        request_id=request_id, gate_id=gate.id, direction="OUT", kind="GOODS_OUT", category_code="DISPATCH", category_label="Goods out",
        route="DISPATCH", status="WITH_STORES", vehicle_no=vehicle, history=[], created_by=actor, version=1,
    )
    _history(entry, actor, "OUT", vehicle_no=vehicle)
    db.add(entry)
    db.flush()
    _notify_goods_out(db, entry)
    return entry, True


@dataclass
class ChallanLink:
    dispatch_ref: str
    tally_bill_no: str
    tally_bill_date: Optional[date] = None


def _entry_day(entry: GateEntry) -> date:
    return local_now(entry.created_at).date() if entry.created_at else plant_today()


def link_goods_out(db: Session, entry: GateEntry, *, links: list[ChallanLink], actor: str, expected_version: Optional[int] = None) -> GateEntry:
    """Store links the watchman's goods-out photos to one or more challans, each with its Tally bill no.
    Each challan gets its ``dispatch_gate_out`` row (out time and watchman from the entry, Store as linker);
    the entry's photos are linked to every challan; the entry becomes LINKED."""
    if entry.kind != "GOODS_OUT":
        raise HTTPException(status_code=409, detail=f"{entry.entry_no} is not a goods-out entry.")
    cleaned: list[ChallanLink] = []
    for link in links:
        ref = clean_text(link.dispatch_ref, 100)
        if not ref:
            raise HTTPException(status_code=422, detail="Pick the challan that went out on this truck.")
        if ref in {row.dispatch_ref for row in cleaned}:
            raise HTTPException(status_code=422, detail=f"Challan {ref} is picked twice.")
        number = clean_tally_no(link.tally_bill_no)
        when = link.tally_bill_date or _entry_day(entry)
        if when > plant_today() + timedelta(days=1):
            raise HTTPException(status_code=422, detail="The Tally bill date is in the future. Check the date on the Tally bill.")
        cleaned.append(ChallanLink(ref, number, when))
    if not cleaned:
        raise HTTPException(status_code=422, detail="Pick at least one challan that went out on this truck.")
    if entry.status in LINKED_STATES:
        current = sorted(row.dispatch_ref for row in entry_links(db, entry.plant_id, [entry.id]).get(str(entry.id), []))
        if current == sorted(row.dispatch_ref for row in cleaned):
            return entry  # the same link sent twice (double tap, retry)
        raise HTTPException(status_code=409, detail=f"{entry.entry_no} is already linked to {challan_words(current) or 'a challan'}. "
                                                    "To change it, the plant head unlinks it first.")
    _check_version(entry, expected_version)
    if entry.status != "WITH_STORES":
        raise HTTPException(status_code=409, detail=f"{entry.entry_no} is {STATUS_WORDS.get(entry.status, entry.status).lower()}; it cannot be linked.")
    now = datetime.utcnow()
    for link in cleaned:
        if not dispatch_exists(db, entry.plant_id, link.dispatch_ref):
            raise HTTPException(status_code=404, detail=f"Challan {link.dispatch_ref} is not a dispatch of this plant (or it was cancelled).")
        row = _gate_out_row(db, entry.plant_id, link.dispatch_ref)
        if row and row.out_at and row.gate_entry_id and row.gate_entry_id != entry.id:
            other = db.get(GateEntry, row.gate_entry_id)
            raise HTTPException(status_code=409, detail=f"Challan {link.dispatch_ref} is already linked to gate entry "
                                                        f"{other.entry_no if other else ''} (out {local_now(row.out_at).strftime('%d %b %H:%M')}).".replace("entry  (", "entry ("))
        if not row:
            row = DispatchGateOut(plant_id=str(entry.plant_id), dispatch_ref=link.dispatch_ref, version=0)
            db.add(row)
        if row.tally_bill_no and row.tally_bill_no != link.tally_bill_no:
            _history(entry, actor, "TALLY_CHANGED", dispatch_ref=link.dispatch_ref, **{"from": row.tally_bill_no, "to": link.tally_bill_no})
        if row.tally_bill_no != link.tally_bill_no or not row.tally_by:
            row.tally_by, row.tally_at = actor, now
        row.tally_bill_no, row.tally_bill_date = link.tally_bill_no, link.tally_bill_date
        row.vehicle_no = entry.vehicle_no
        row.gate_entry_id = entry.id
        row.out_at, row.out_by = entry.created_at or now, entry.created_by
        row.linked_by, row.linked_at = actor, now
        row.version = int(row.version or 0) + 1
    entry.dispatch_ref = cleaned[0].dispatch_ref
    entry.status = "LINKED"
    entry.linked_by, entry.linked_at = actor, now
    entry.reminded_at = None
    entry.version = int(entry.version or 1) + 1
    _history(entry, actor, "LINKED", challans=[{"dispatch_ref": row.dispatch_ref, "tally_bill_no": row.tally_bill_no} for row in cleaned])
    db.flush()
    sync_entry_links(db, entry, actor)
    # The vault search finds the photos by challan and Tally number too.
    for document in entry_documents(db, entry):
        ref_no = cleaned[0].tally_bill_no if document.kind == "TALLY_BILL" else cleaned[0].dispatch_ref if document.kind == "OUR_CHALLAN" else None
        if ref_no and not document.ref_no:
            changes: dict[str, Any] = {"ref_no": ref_no}
            if document.kind == "TALLY_BILL" and not document.ref_date:
                changes["ref_date"] = cleaned[0].tally_bill_date
            vault.update_document(db, document, changes=changes, actor=actor, expected_version=int(document.version))
    db.flush()
    return entry


def unlink_goods_out(db: Session, entry: GateEntry, *, reason_code: str, reason_label: str, actor: str, expected_version: Optional[int],
                     dispatch_ref: Optional[str] = None) -> GateEntry:
    """Plant head (or Owner / Admin) undoes a wrong link, with a GATE_OUT_UNLINK reason (logged on the entry).
    One challan or all of them; with none left the entry goes back to Stores to link again."""
    if entry.kind != "GOODS_OUT":
        raise HTTPException(status_code=409, detail=f"{entry.entry_no} is not a goods-out entry.")
    _check_version(entry, expected_version)
    if entry.status not in LINKED_STATES:
        raise HTTPException(status_code=409, detail=f"{entry.entry_no} is not linked to a challan.")
    rows = entry_links(db, entry.plant_id, [entry.id]).get(str(entry.id), [])
    ref = clean_text(dispatch_ref, 100)
    chosen = [row for row in rows if not ref or row.dispatch_ref == ref]
    if ref and not chosen:
        raise HTTPException(status_code=404, detail=f"{entry.entry_no} is not linked to challan {ref}.")
    documents = entry_documents(db, entry)
    for row in chosen:
        db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"gate-out:{entry.plant_id}:{row.dispatch_ref}"})
        for document in documents:
            vault.unlink_document(db, document, "DISPATCH", row.dispatch_ref, actor)
        row.gate_entry_id = None
        row.out_at = row.out_by = None
        row.linked_by = row.linked_at = None
        row.vehicle_no = None
        row.version = int(row.version or 0) + 1
    left = [row for row in rows if row not in chosen]
    if left:
        entry.dispatch_ref = left[0].dispatch_ref
    else:
        entry.status = "WITH_STORES"
        entry.dispatch_ref = None
        entry.linked_by = entry.linked_at = None
    entry.version = int(entry.version or 1) + 1
    _history(entry, actor, "UNLINKED", challans=[row.dispatch_ref for row in chosen], reason_code=reason_code, reason=reason_label)
    db.flush()
    if not left:
        _notify_goods_out(db, entry)
    return entry


def gone_out_to_link(db: Session, plant_id: str) -> list[GateEntry]:
    """Goods-out photos the watchman took that no challan has yet (the "Gone out at the gate" strip)."""
    return (db.query(GateEntry).filter(GateEntry.plant_id == str(plant_id), GateEntry.kind == "GOODS_OUT", GateEntry.status == "WITH_STORES")
            .order_by(GateEntry.created_at.asc()).limit(200).all())


def challans_to_link(db: Session, plant_id: str, *, q: Optional[str] = None, day: Optional[date] = None, limit: int = 60) -> list[dict[str, Any]]:
    """Challans of the last 30 days not yet linked to a gate-out photo; the entry's own day first, then newest."""
    today = plant_today()
    groups = dispatch_groups(db, plant_id, today - timedelta(days=CHALLAN_LOOKBACK_DAYS))
    if not groups:
        return []
    rows = {row.dispatch_ref: row for row in db.query(DispatchGateOut).filter(DispatchGateOut.plant_id == str(plant_id),
                                                                              DispatchGateOut.dispatch_ref.in_(list(groups))).all()}
    term = (q or "").strip().lower()
    result = []
    for ref, group in groups.items():
        row = rows.get(ref)
        if row and row.out_at:
            continue
        if term and term not in ref.lower() and not any(term in str(item["item_name"] or "").lower() or term in str(item["item_code"] or "").lower()
                                                         for item in group["items"].values()):
            continue
        posted_day = group["effective_date"] or (local_now(group["posted_at"]).date() if group["posted_at"] else today)
        result.append({
            "dispatch_ref": ref, "items": list(group["items"].values()),
            "qty_total": round(sum(item["qty"] for item in group["items"].values()), 3), "posted_at": iso(group["posted_at"]),
            "posted_day": posted_day.isoformat() if posted_day else None, "same_day": bool(day and posted_day == day),
            "tally_bill_no": row.tally_bill_no if row else None,
            "tally_bill_date": row.tally_bill_date.isoformat() if row and row.tally_bill_date else None,
            "version": int(row.version or 1) if row else None,
        })
    same = [item for item in result if item["same_day"]]
    rest = sorted([item for item in result if not item["same_day"]], key=lambda item: item["posted_at"] or "", reverse=True)
    return (sorted(same, key=lambda item: item["posted_at"] or "", reverse=True) + rest)[:limit]


GOODS_OUT_PHOTOS = (("TALLY_BILL", "Tally bill"), ("OUR_CHALLAN", "Challan"))


def goods_out_photos_missing(db: Session, plant_id: str, pairs: Iterable[tuple[Any, Optional[str]]]) -> dict[str, list[str]]:
    """Which of the two goods-out photos (Tally bill, our challan) are not in the vault yet, per gate entry.

    ``pairs`` are (gate entry id, dispatch ref). A photo counts when an active document of that kind is linked
    to the gate entry or to the dispatch. The truck is never held for it: the register and the gate history
    show "Photos missing" and the watchman desk lists the uploads still pending (the phone retries them)."""
    wanted = [(str(entry_id), str(ref or "")) for entry_id, ref in pairs if entry_id]
    if not wanted:
        return {}
    entry_ids = [entry_id for entry_id, _ in wanted]
    refs = [ref for _, ref in wanted if ref]
    kinds = [kind for kind, _ in GOODS_OUT_PHOTOS]
    link_filter = and_(DocumentLink.entity_type == "GATE_ENTRY", DocumentLink.entity_id.in_(entry_ids))
    if refs:
        link_filter = or_(link_filter, and_(DocumentLink.entity_type == "DISPATCH", DocumentLink.entity_id.in_(refs)))
    have: dict[tuple[str, str], set[str]] = {}
    for kind, entity_type, entity_id in (db.query(Document.kind, DocumentLink.entity_type, DocumentLink.entity_id)
                                         .join(DocumentLink, DocumentLink.document_id == Document.id)
                                         .filter(Document.plant_id == str(plant_id), Document.status == "ACTIVE",
                                                 Document.kind.in_(kinds), link_filter).all()):
        have.setdefault((entity_type, str(entity_id)), set()).add(kind)
    result: dict[str, list[str]] = {}
    for entry_id, ref in wanted:
        present = have.get(("GATE_ENTRY", entry_id), set()) | (have.get(("DISPATCH", ref), set()) if ref else set())
        result[entry_id] = [label for kind, label in GOODS_OUT_PHOTOS if kind not in present]
    return result


def dispatch_status(db: Session, plant_id: str, refs: Iterable[str]) -> dict[str, dict[str, Any]]:
    wanted = [str(ref).strip() for ref in refs if str(ref or "").strip()][:300]
    if not wanted:
        return {}
    out: dict[str, dict[str, Any]] = {}
    rows = db.query(DispatchGateOut).filter(DispatchGateOut.plant_id == str(plant_id), DispatchGateOut.dispatch_ref.in_(wanted)).all()
    missing = goods_out_photos_missing(db, plant_id, [(row.gate_entry_id, row.dispatch_ref) for row in rows if row.out_at and row.gate_entry_id])
    entry_ids = [row.gate_entry_id for row in rows if row.gate_entry_id]
    entries = {str(entry.id): entry for entry in db.query(GateEntry).filter(GateEntry.id.in_(entry_ids)).all()} if entry_ids else {}
    for row in rows:
        entry = entries.get(str(row.gate_entry_id)) if row.gate_entry_id else None
        out[row.dispatch_ref] = {"photos_missing": missing.get(str(row.gate_entry_id), []) if row.out_at and row.gate_entry_id else [],
                                 "tally_bill_no": row.tally_bill_no, "tally_bill_date": row.tally_bill_date.isoformat() if row.tally_bill_date else None,
                                 "out": bool(row.out_at), "out_at": iso(row.out_at), "vehicle_no": row.vehicle_no, "version": int(row.version or 1),
                                 "gate_entry_id": str(row.gate_entry_id) if row.gate_entry_id else None,
                                 "gate_entry_no": entry.entry_no if entry else None, "gate_entry_version": int(entry.version or 1) if entry else None,
                                 "linked": bool(row.out_at and row.gate_entry_id), "linked_by": row.linked_by, "linked_at": iso(row.linked_at)}
    return out


# ── History ────────────────────────────────────────────────────────────────────────────────────
HISTORY_TYPES = ("VISITOR", "BILL_IN", "GOODS_OUT")


def history(db: Session, plant_id: str, *, date_from: date, date_to: date, gate_id: Optional[str], kind: Optional[str],
            status: Optional[str], q: Optional[str], private: bool, limit: int = 200, offset: int = 0) -> dict[str, Any]:
    start, end = day_start_utc(date_from), day_start_utc(date_to + timedelta(days=1))
    kind_value = str(kind or "").upper() or None
    status_value = str(status or "").upper() or None
    term = f"%{q.strip()}%" if q and q.strip() else None
    gate_key = None
    if gate_id:
        try:
            gate_key = uuid.UUID(str(gate_id))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Unknown gate.") from exc
    gates = {gate.id: gate for gate in db.query(Gate).filter(Gate.plant_id == str(plant_id)).all()}
    rows: list[dict[str, Any]] = []
    cap = 5000
    if kind_value in (None, "VISITOR"):
        query = (db.query(GateVisit, GateVisitor).join(GateVisitor, GateVisitor.id == GateVisit.visitor_id)
                 .filter(GateVisit.plant_id == str(plant_id), GateVisit.arrived_at >= start, GateVisit.arrived_at < end))
        if gate_key:
            query = query.filter(GateVisit.gate_id == gate_key)
        if status_value:
            query = query.filter(GateVisit.status == status_value)
        if term:
            clauses = [GateVisit.visitor_name.ilike(term), GateVisit.company.ilike(term), GateVisit.vehicle_no.ilike(term),
                       GateVisit.visit_no.ilike(term), GateVisit.host_name.ilike(term)]
            if private:
                clauses.append(GateVisitor.mobile.ilike(term))
            query = query.filter(or_(*clauses))
        for visit, visitor in query.order_by(GateVisit.arrived_at.desc()).limit(cap).all():
            rows.append({"type": "VISITOR", "type_label": "Visitor", "id": str(visit.id), "no": visit.visit_no, "at": iso(visit.arrived_at),
                         "gate": gates[visit.gate_id].name if visit.gate_id in gates else None, "status": visit.status,
                         "status_label": VISIT_STATUS_WORDS.get(visit.status, visit.status), "name": visit.visitor_name, "company": visit.company,
                         "mobile": visitor.mobile if private else masked_mobile(visitor.mobile), "vehicle_no": visit.vehicle_no,
                         "detail": visit.purpose_label + (f" · {visit.purpose_note}" if visit.purpose_note else ""), "host": _host_words(visit),
                         "people": int(visit.people or 1), "in_at": iso(visit.in_at), "out_at": iso(visit.out_at),
                         "reference": visit.deny_label or (REPLY_WORDS.get(visit.host_reply or "") or ""), "by": visit.in_by or visit.created_by})
    if kind_value in (None, "BILL_IN", "GOODS_OUT"):
        query = db.query(GateEntry).filter(GateEntry.plant_id == str(plant_id), GateEntry.created_at >= start, GateEntry.created_at < end)
        if kind_value:
            query = query.filter(GateEntry.kind == kind_value)
        if gate_key:
            query = query.filter(GateEntry.gate_id == gate_key)
        if status_value:
            query = query.filter(GateEntry.status.in_(LINKED_STATES) if status_value == "LINKED" else GateEntry.status == status_value)
        if term:
            linked = db.query(DispatchGateOut.gate_entry_id).filter(DispatchGateOut.plant_id == str(plant_id), DispatchGateOut.gate_entry_id.isnot(None),
                                                                   or_(DispatchGateOut.tally_bill_no.ilike(term), DispatchGateOut.dispatch_ref.ilike(term)))
            query = query.filter(or_(
                GateEntry.entry_no.ilike(term), GateEntry.party_text.ilike(term), GateEntry.vehicle_no.ilike(term),
                GateEntry.bill_no.ilike(term), GateEntry.dispatch_ref.ilike(term), GateEntry.id.in_(linked)))
        entries = query.order_by(GateEntry.created_at.desc()).limit(cap).all()
        tally = entry_links(db, plant_id, [entry.id for entry in entries if entry.kind == "GOODS_OUT"]) if entries else {}
        receipts = {row.id: row for row in db.query(PurchaseReceipt).filter(
            PurchaseReceipt.id.in_([entry.receipt_id for entry in entries if entry.receipt_id])).all()} if entries else {}
        photos = goods_out_photos_missing(db, plant_id, [(entry.id, entry.dispatch_ref) for entry in entries if entry.kind == "GOODS_OUT"])
        for entry in entries:
            outs = sorted(tally.get(str(entry.id), []), key=lambda row: row.dispatch_ref != entry.dispatch_ref)
            receipt = receipts.get(entry.receipt_id) if entry.receipt_id else None
            if entry.kind == "GOODS_OUT":
                reference = ("; ".join(f"Challan {row.dispatch_ref} · Tally {row.tally_bill_no}" for row in outs) if outs
                             else "With Stores to link" if entry.status == "WITH_STORES" else (f"Challan {entry.dispatch_ref}" if entry.dispatch_ref else ""))
            else:
                reference = f"GRN {receipt.grn_no}" if receipt else (f"Bill {entry.bill_no}" if entry.bill_no else "")
            rows.append({"type": entry.kind, "type_label": "Bill in" if entry.kind == "BILL_IN" else "Goods out", "id": str(entry.id),
                         "no": entry.entry_no, "at": iso(entry.created_at), "gate": gates[entry.gate_id].name if entry.gate_id in gates else None,
                         "status": "LINKED" if entry.kind == "GOODS_OUT" and entry.status == "OUT" else entry.status,
                         "status_label": status_label(entry, [row.dispatch_ref for row in outs]), "name": entry.party_text,
                         "company": None, "mobile": None, "vehicle_no": entry.vehicle_no, "detail": entry.category_label,
                         "host": None, "people": None, "in_at": None, "out_at": iso(entry.created_at) if entry.kind == "GOODS_OUT" else None,
                         "reference": reference, "by": entry.created_by,
                         "photos_missing": photos.get(str(entry.id), []) if entry.kind == "GOODS_OUT" else [],
                         "amount": float(entry.bill_amount) if entry.bill_amount is not None else None})
    rows.sort(key=lambda row: row["at"] or "", reverse=True)
    total = len(rows)
    counts = {key: sum(1 for row in rows if row["type"] == key) for key in HISTORY_TYPES}
    return {"items": rows[offset:offset + limit], "total": total, "counts": counts, "limit": limit, "offset": offset,
            "truncated": total >= cap}


def history_csv(rows: list[dict[str, Any]]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["Type", "Number", "Date / time", "Gate", "Status", "Name / party", "Company", "Mobile", "Vehicle",
                     "Purpose / category", "Whom to meet", "People", "In", "Out", "Reference", "Amount", "By"])

    def when(value: Optional[str]) -> str:
        if not value:
            return ""
        return local_now(datetime.fromisoformat(value).replace(tzinfo=None)).strftime("%d-%m-%Y %H:%M")

    for row in rows:
        writer.writerow([row["type_label"], row["no"], when(row["at"]), row.get("gate") or "", row["status_label"], row.get("name") or "",
                         row.get("company") or "", row.get("mobile") or "", row.get("vehicle_no") or "", row.get("detail") or "",
                         row.get("host") or "", row.get("people") or "", when(row.get("in_at")), when(row.get("out_at")),
                         row.get("reference") or "", row.get("amount") if row.get("amount") is not None else "", row.get("by") or ""])
    return buffer.getvalue()


# ── Sweeps (worker) ────────────────────────────────────────────────────────────────────────────
def _once(db: Session, plant_id: str, kind: str, day: date, key: str = "") -> bool:
    """True the first time (and records it); False when this notice was already sent."""
    if db.query(GateNoticeLog.id).filter(GateNoticeLog.plant_id == plant_id, GateNoticeLog.kind == kind, GateNoticeLog.day == day,
                                         GateNoticeLog.key == key).first():
        return False
    db.add(GateNoticeLog(plant_id=plant_id, kind=kind, day=day, key=key))
    db.flush()
    return True


def gate_plants(db: Session) -> list[str]:
    return [plant for (plant,) in db.query(Gate.plant_id).distinct().all()]


def remind_unlinked_material(db: Session, now: Optional[datetime] = None) -> int:
    cutoff = (now or datetime.utcnow()) - UNLINKED_REMINDER_AFTER
    rows = (db.query(GateEntry).filter(GateEntry.kind == "BILL_IN", GateEntry.route == "STORES", GateEntry.status.in_(["AT_GATE", "WITH_STORES"]),
                                       GateEntry.created_at < cutoff, GateEntry.reminded_at.is_(None)).with_for_update(skip_locked=True).limit(200).all())
    for entry in rows:
        _notify_route(db, entry, reminder=True)
        entry.reminded_at = now or datetime.utcnow()
    return len(rows)


def mark_no_shows(db: Session, now: Optional[datetime] = None) -> int:
    cutoff = (now or datetime.utcnow()) - NO_SHOW_AFTER
    rows = db.query(GateVisit).filter(GateVisit.status == "ARRIVED", GateVisit.arrived_at < cutoff).with_for_update(skip_locked=True).limit(500).all()
    for visit in rows:
        visit.status = "NO_SHOW"
        visit.version = int(visit.version or 1) + 1
    return len(rows)


def after_close(db: Session, plant_id: str, now: Optional[datetime] = None) -> bool:
    return local_now(now).time() >= settings_for(db, plant_id).gate_close_time


def overstay_digest(db: Session, plant_id: str, now: Optional[datetime] = None) -> int:
    if not after_close(db, plant_id, now):
        return 0
    settings = settings_for(db, plant_id)
    inside = db.query(GateVisit).filter(GateVisit.plant_id == plant_id, GateVisit.status == "IN").all()
    late = [visit for visit in inside if is_overstay(visit, settings, now)]
    if not late or not _once(db, plant_id, "GATE_OVERSTAY_DIGEST", plant_today(now)):
        return 0
    names = ", ".join(f"{visit.visitor_name} ({_host_words(visit)})" for visit in late[:8]) + (f" and {len(late) - 8} more" if len(late) > 8 else "")
    notify(db, plant_id=plant_id, event_type="GATE_OVERSTAY_DIGEST",
           title=f"{len(late)} visitor{'s' if len(late) != 1 else ''} still inside after gate close",
           message=f"Still inside after {settings.gate_close_time.strftime('%H:%M')}: {names}. The watchman marks them Out when they leave.",
           href="/gate/history?status=IN&type=VISITOR", roles=["Owner"], entity_id=f"overstay:{plant_today(now).isoformat()}",
           action={"kind": "GATE_DIGEST", "id": plant_today(now).isoformat(), "buttons": [{"key": "open", "label": "Open list", "href": "/gate/history?status=IN&type=VISITOR"}]})
    return len(late)


def dispatch_not_out(db: Session, plant_id: str, now: Optional[datetime] = None) -> int:
    if not after_close(db, plant_id, now):
        return 0
    today = plant_today(now)
    pending = [row for row in leaving_today(db, plant_id, now=now) if not row["out"] and row["posted_day"] == today.isoformat()]
    if not pending or not _once(db, plant_id, "DISPATCH_NOT_OUT", today):
        return 0
    refs = ", ".join(row["dispatch_ref"] for row in pending[:10]) + (f" and {len(pending) - 10} more" if len(pending) > 10 else "")
    notify(db, plant_id=plant_id, event_type="DISPATCH_NOT_OUT",
           title=f"{len(pending)} challan{'s' if len(pending) != 1 else ''} posted today did not go out of the gate",
           message=(f"No gate photo is linked yet to: {refs}. If the truck left, the watchman takes the Tally bill and challan photos at the "
                    "gate (Gate › Goods out) and Stores links them on Dispatch register › Gone out at the gate."),
           href="/logistics/dispatch", roles=["Dispatch", "Store"], entity_id=f"not-out:{today.isoformat()}",
           action={"kind": "GATE_DIGEST", "id": today.isoformat(), "buttons": [{"key": "open", "label": "Open list", "href": "/logistics/dispatch"}]})
    return len(pending)


def goods_out_unlinked(db: Session, plant_id: str, now: Optional[datetime] = None) -> int:
    """After the gate close time, once a day: goods-out photos that Stores has not linked to a challan yet."""
    if not after_close(db, plant_id, now):
        return 0
    rows = (db.query(GateEntry).filter(GateEntry.plant_id == plant_id, GateEntry.kind == "GOODS_OUT", GateEntry.status == "WITH_STORES")
            .order_by(GateEntry.created_at.asc()).limit(200).all())
    today = plant_today(now)
    if not rows or not _once(db, plant_id, "GOODS_OUT_UNLINKED", today):
        return 0
    words = ", ".join(f"{entry.entry_no} ({entry.vehicle_no or 'no vehicle no.'}, {local_now(entry.created_at).strftime('%d %b %H:%M')})"
                      for entry in rows[:8]) + (f" and {len(rows) - 8} more" if len(rows) > 8 else "")
    stamp = local_now(now)
    for entry in rows:
        entry.reminded_at = stamp.astimezone(timezone.utc).replace(tzinfo=None)
    notify(db, plant_id=plant_id, event_type="GATE_GOODS_OUT_UNLINKED",
           title=f"{len(rows)} goods-out photo set{'s' if len(rows) != 1 else ''} not linked to a challan",
           message=f"Trucks went out but no challan is linked yet: {words}. Open Dispatch register › Gone out at the gate, pick the challan(s) and add the Tally bill no.",
           href="/logistics/dispatch", roles=["Store", "PlantManager"], entity_id=f"goods-out-unlinked:{today.isoformat()}",
           action={"kind": "GATE_DIGEST", "id": today.isoformat(), "buttons": [{"key": "open", "label": "Link now", "href": "/logistics/dispatch", "tone": "primary"}]})
    return len(rows)


def _purged_jpeg() -> bytes:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), (200, 200, 200)).save(buffer, "JPEG", quality=50)
    return buffer.getvalue()


def purge_visitor_photos(db: Session, plant_id: str, now: Optional[datetime] = None, *, limit: int = 200) -> int:
    """Visitor photos older than the plant's retention: every stored file of the photo is overwritten with a
    blank image, the document is voided (DV-RETENTION) and the visit keeps its log (name, times, host)
    with photo_purged_at. Nothing else is deleted."""
    from ..models_vault import DocumentPage
    from ..reasons import ReasonChoice
    from .doc_storage import StorageUnavailable, get_storage

    settings = settings_for(db, plant_id)
    cutoff = (now or datetime.utcnow()) - timedelta(days=settings.visitor_retention_days)
    visits = (db.query(GateVisit).filter(GateVisit.plant_id == plant_id, GateVisit.photo_doc_id.isnot(None), GateVisit.photo_purged_at.is_(None),
                                         GateVisit.arrived_at < cutoff).with_for_update(skip_locked=True).limit(limit).all())
    if not visits:
        return 0
    reason = ReasonChoice(category="DOC_VOID", code="DV-RETENTION", label="Retention period over",
                          note=f"Visitor photo kept {settings.visitor_retention_days} days")
    blank = _purged_jpeg()
    purged = 0
    for visit in visits:
        document = db.query(Document).filter(Document.id == visit.photo_doc_id, Document.plant_id == plant_id).first()
        if document:
            try:
                for page in db.query(DocumentPage).filter(DocumentPage.document_id == document.id).all():
                    storage = get_storage(page.storage_backend)
                    for key in (page.storage_key, page.thumb_key):
                        if key:
                            storage.put(key, blank, "image/jpeg")
                    page.bytes = len(blank)
            except StorageUnavailable:
                log.warning("gate: document storage unavailable while purging %s; the next sweep retries", document.doc_no)
                continue
            document.bytes = len(blank)
            vault.void_document(db, document, reason=reason, actor="system:gate-retention")
        visit.photo_purged_at = now or datetime.utcnow()
        purged += 1
    return purged


def sync_recent_links(db: Session, now: Optional[datetime] = None) -> int:
    since = (now or datetime.utcnow()) - timedelta(days=3)
    made = 0
    entries = db.query(GateEntry).filter(or_(and_(GateEntry.status == "LINKED", GateEntry.linked_at >= since),
                                             and_(GateEntry.kind == "GOODS_OUT", GateEntry.created_at >= since))).limit(1000).all()
    for entry in entries:
        made += sync_entry_links(db, entry, "system:gate-sync")
    made += adopt_desk_photos(db, None, since=since)
    return made


def adopt_desk_photos(db: Session, plant_id: Optional[str], *, since: Optional[datetime] = None) -> int:
    """A walk-in photo the watchman took goes up through the vault outbox linked VISIT → visit id; the visit
    takes the newest such photo as its own."""
    query = db.query(GateVisit).filter(GateVisit.photo_doc_id.is_(None), GateVisit.arrived_at >= (since or day_start_utc(plant_today())))
    if plant_id:
        query = query.filter(GateVisit.plant_id == str(plant_id))
    visits = query.limit(500).all()
    if not visits:
        return 0
    by_id = {str(visit.id): visit for visit in visits}
    rows = (db.query(Document.id, DocumentLink.entity_id, Document.plant_id).join(DocumentLink, DocumentLink.document_id == Document.id)
            .filter(DocumentLink.entity_type == "VISIT", DocumentLink.entity_id.in_(list(by_id)), Document.kind == "VISITOR_PHOTO",
                    Document.status == "ACTIVE").order_by(Document.uploaded_at.asc()).all())
    adopted = 0
    for document_id, entity_id, document_plant in rows:
        visit = by_id.get(str(entity_id))
        if visit and document_plant == visit.plant_id:
            visit.photo_doc_id = document_id
            adopted += 1
    return adopted


# ── Doc Vault link targets ─────────────────────────────────────────────────────────────────────
def _resolve_gate_entry(db: Session, plant_id: str, entity_id: str) -> Optional[vault.EntityRef]:
    try:
        key = uuid.UUID(str(entity_id))
    except (TypeError, ValueError):
        return None
    entry = db.query(GateEntry).filter(GateEntry.id == key, GateEntry.plant_id == str(plant_id)).first()
    if not entry or entry.status == "VOID":
        return None
    words = [entry.entry_no, entry.vehicle_no or "", entry.party_text or "", entry.dispatch_ref or "", entry.category_label or ""]
    return vault.EntityRef(label=f"Gate entry {entry.entry_no}", href=f"/gate?entry={entry.id}", search=[w for w in words if w])


def _resolve_visit(db: Session, plant_id: str, entity_id: str) -> Optional[vault.EntityRef]:
    try:
        key = uuid.UUID(str(entity_id))
    except (TypeError, ValueError):
        return None
    visit = db.query(GateVisit).filter(GateVisit.id == key, GateVisit.plant_id == str(plant_id)).first()
    if not visit:
        return None
    return vault.EntityRef(label=f"Visit {visit.visit_no}", href=f"/gate?visit={visit.id}", search=[visit.visit_no, visit.visitor_name])


vault.register_entity_resolver("GATE_ENTRY", _resolve_gate_entry)
vault.register_entity_resolver("VISIT", _resolve_visit)
