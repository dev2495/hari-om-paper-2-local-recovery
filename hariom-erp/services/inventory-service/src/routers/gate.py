"""Gate API (6 Nov 2026). BFF: /api/gate/* → here (/inventory/gate/*); the visitor's public pages go
through BFF /api/public/visit/* → /inventory/gate/public/* with the internal token (no user login).

Masters (Owner/Admin)        GET/POST /gates · PATCH /gates/{id} · POST /gates/{id}/rotate-token
Settings                     GET /settings · PUT /settings (Owner)
Watchman desk                GET /desk?gate_id= · GET /leaving-today
Bills in                     POST /entries · GET /entries · GET /entries/{id} · POST /entries/{id}/category
Stores                       GET /at-the-gate · POST /entries/{id}/link-receipt · GET /receipt-entries?receipt_ids=
Accounts                     GET /bills · POST /entries/{id}/file
Visitors                     POST /visits (walk-in) · POST /visits/{id}/in|out|deny|reply|photo · POST /visits/scan-out
                             GET /visits/{id}/photo · GET /hosts (BFF fills from auth)
Goods out (watchman)         POST /goods-out (photos + vehicle no. only; never a challan or a Tally no.)
Goods out (Store links)      GET /gone-out · GET /gone-out/challans?entry_id=&q= · POST /gone-out/{id}/link
                             POST /gone-out/{id}/unlink (plant head, reason) · GET /dispatch-status?refs= · PUT /dispatch/tally
History                      GET /history[.csv]
Public (internal token)      GET /public/gates/{token} · POST /public/gates/{token}/lookup · POST /public/gates/{token}/visits
                             GET /public/visits/{pass} · POST /public/visits/{pass}/photo
"""
from __future__ import annotations

import hmac
import os
import re
import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import PurchaseReceipt
from ..models_gate import Gate, GateEntry, GateVisit, GateVisitor
from ..reasons import resolve_reason, token_of
from ..services import doc_vault as vault
from ..services import gate as svc
from ..utils.auth import get_current_plant, get_current_user, require_owner, require_role

router = APIRouter(prefix="/inventory/gate", tags=["gate"])
public_router = APIRouter(prefix="/inventory/gate/public", tags=["gate-public"])

desk_user = require_role(svc.DESK_ROLES)
gate_reader = require_role(svc.GATE_READ_ROLES)
store_user = require_role(svc.STORE_LINK_ROLES)
accounts_user = require_role(svc.ACCOUNTS_ROLES)
recategorise_user = require_role(svc.RECATEGORISE_ROLES)
history_user = require_role(svc.HISTORY_ROLES)
dispatch_user = require_role(svc.DISPATCH_DESK_ROLES)
goods_out_linker = require_role(svc.GOODS_OUT_LINK_ROLES)
tally_user = require_role(svc.TALLY_ROLES)
goods_out_unlinker = require_role(svc.GOODS_OUT_UNLINK_ROLES)
admin_user = require_role([])  # Owner and Admin only (require_role lets them through)
MAX_PUBLIC_PHOTO_BYTES = 6 * 1024 * 1024


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def _uuid(value: Optional[str], what: str) -> Optional[uuid.UUID]:
    if not value:
        return None
    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{what} is not a valid key.") from exc


def _words(choice) -> str:
    """"Other · Water tanker" for a code with a note; the plain label otherwise (no "(write a note)")."""
    label = re.sub(r"\s*\(write a note\)", "", choice.label or choice.code, flags=re.I).strip()
    return f"{label} · {choice.note}" if choice.note else label


def _reason(category: str, code: Optional[str], note: Optional[str], plant_id: str, current_user: dict, what: str):
    return resolve_reason(category=category, code=code, note=note, plant_id=plant_id, token=token_of(current_user), what=what)


# ── Masters ────────────────────────────────────────────────────────────────────────────────────
class GateCreate(Strict):
    code: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=120)
    direction: str = Field(default="BOTH", pattern="^(IN|OUT|BOTH)$")


class GateUpdate(Strict):
    expected_version: int = Field(ge=1)
    name: Optional[str] = Field(default=None, max_length=120)
    direction: Optional[str] = Field(default=None, pattern="^(IN|OUT|BOTH)$")
    active: Optional[bool] = None


class VersionOnly(Strict):
    expected_version: int = Field(ge=1)


def _is_admin(current_user: dict) -> bool:
    return bool(svc.roles_of(current_user) & {"Owner", "Admin"})


@router.get("/gates")
def list_gates(include_inactive: bool = False, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
               current_user: dict = Depends(gate_reader)):
    query = db.query(Gate).filter(Gate.plant_id == str(plant_id))
    if not include_inactive:
        query = query.filter(Gate.active.is_(True))
    admin = _is_admin(current_user)
    return {"items": [svc.gate_payload(gate, with_token=admin) for gate in query.order_by(Gate.code).all()]}


@router.post("/gates")
def create_gate(payload: GateCreate, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
                current_user: dict = Depends(admin_user)):
    gate = svc.create_gate(db, plant_id, code=payload.code, name=payload.name, direction=payload.direction, actor=svc.actor_of(current_user))
    db.commit()
    return svc.gate_payload(gate, with_token=True)


@router.patch("/gates/{gate_id}")
def update_gate(gate_id: str, payload: GateUpdate, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
                current_user: dict = Depends(admin_user)):
    gate = svc.get_gate(db, plant_id, gate_id, for_update=True)
    svc.update_gate(db, gate, changes=payload.model_dump(exclude={"expected_version"}), expected_version=payload.expected_version)
    db.commit()
    return svc.gate_payload(gate, with_token=True)


@router.post("/gates/{gate_id}/rotate-token")
def rotate_gate_token(gate_id: str, payload: VersionOnly, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
                      current_user: dict = Depends(admin_user)):
    """A new QR for the poster; the old printed QR stops working at once."""
    gate = svc.get_gate(db, plant_id, gate_id, for_update=True)
    svc.rotate_token(db, gate, actor=svc.actor_of(current_user), expected_version=payload.expected_version)
    db.commit()
    return svc.gate_payload(gate, with_token=True)


# ── Settings ───────────────────────────────────────────────────────────────────────────────────
class SettingsUpdate(Strict):
    gate_close_time: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    visitor_retention_days: int = Field(ge=30, le=3650)
    expected_version: int = Field(ge=0)


@router.get("/settings")
def get_settings(db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(get_current_user)):
    return svc.settings_payload(svc.settings_for(db, plant_id))


@router.put("/settings")
def put_settings(payload: SettingsUpdate, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
                 current_user: dict = Depends(require_owner)):
    hours, minutes = payload.gate_close_time.split(":")
    settings = svc.update_settings(db, plant_id, gate_close_time=time(int(hours), int(minutes)), visitor_retention_days=payload.visitor_retention_days,
                                   expected_version=payload.expected_version, actor=svc.actor_of(current_user))
    db.commit()
    return svc.settings_payload(settings)


# ── Desk ───────────────────────────────────────────────────────────────────────────────────────
@router.get("/desk")
def get_desk(gate_id: str, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(desk_user)):
    gate = svc.get_gate(db, plant_id, gate_id)
    payload = svc.desk(db, plant_id, gate, current_user)
    db.commit()  # a walk-in photo that arrived through the outbox is adopted by its visit
    return payload


@router.get("/leaving-today")
def get_leaving_today(db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(goods_out_linker)):
    """Challans of the last days with no linked gate-out photo (Store / Dispatch; the watchman picks no challan)."""
    return {"items": svc.leaving_today(db, plant_id)}


@router.get("/vendors")
def gate_vendors(q: Optional[str] = Query(default=None, max_length=80), db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
                 current_user: dict = Depends(desk_user)):
    """Vendor names for a bill at the gate, the most recent first (from this plant's POs and GRNs): names
    only, so the gate desk needs no access to the vendor master's contacts."""
    from sqlalchemy import func as _func, union_all, select, literal_column
    from ..models import PurchaseOrder
    po = select(PurchaseOrder.supplier_id.label("id"), PurchaseOrder.supplier_name_snapshot.label("name"), PurchaseOrder.created_at.label("at")).where(
        PurchaseOrder.plant_id == str(plant_id))
    grn = select(PurchaseReceipt.supplier_id.label("id"), PurchaseReceipt.supplier_name_snapshot.label("name"), PurchaseReceipt.created_at.label("at")).where(
        PurchaseReceipt.plant_id == str(plant_id), PurchaseReceipt.supplier_id.isnot(None))
    both = union_all(po, grn).subquery()
    query = db.query(both.c.id, _func.max(both.c.name), _func.max(both.c.at).label("last")).group_by(both.c.id)
    if q and q.strip():
        query = query.having(_func.max(both.c.name).ilike(f"%{q.strip()}%"))
    rows = query.order_by(literal_column("last").desc()).limit(30).all()
    return {"items": [{"id": str(row[0]), "name": row[1]} for row in rows if row[0] and row[1]]}


# ── Bills in ───────────────────────────────────────────────────────────────────────────────────
class BillIn(Strict):
    request_id: uuid.UUID
    gate_id: uuid.UUID
    category_code: str = Field(min_length=1, max_length=60)
    vendor_id: Optional[str] = Field(default=None, max_length=64)
    vendor_name: Optional[str] = Field(default=None, max_length=200)
    vehicle_no: Optional[str] = Field(default=None, max_length=30)
    # The words the watchman writes for an "Other" bill (OTHER codes need a note).
    note: Optional[str] = Field(default=None, max_length=500)


@router.post("/entries")
def create_bill_in(payload: BillIn, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(desk_user)):
    """Bill or challan photographed at the gate. The photos follow through the Doc Vault outbox, each linked
    GATE_ENTRY → the returned id."""
    existing = db.query(GateEntry).filter(GateEntry.plant_id == str(plant_id), GateEntry.request_id == payload.request_id).first()
    if existing:
        return {"created": False, "entry": svc.entry_payload(db, existing, access=vault.access_for(current_user))}
    gate = svc.get_gate(db, plant_id, payload.gate_id, active_only=True)
    category = _reason("BILL_CATEGORY", payload.category_code, payload.note, plant_id, current_user, "the bill type")
    entry, created = svc.create_bill_entry(db, plant_id=plant_id, gate=gate, category_code=category.code, category_label=_words(category),
                                           actor=svc.actor_of(current_user), request_id=payload.request_id, vendor_id=payload.vendor_id,
                                           vendor_name=payload.vendor_name, vehicle_no=payload.vehicle_no, note=payload.note)
    db.commit()
    return {"created": created, "entry": svc.entry_payload(db, entry, access=vault.access_for(current_user)),
            "document_kind": svc.doc_kind_for(entry.route)}


@router.get("/entries")
def list_entries(kind: Optional[str] = Query(default=None, pattern="^(BILL_IN|GOODS_OUT)$"), status: Optional[str] = None,
                 route: Optional[str] = Query(default=None, pattern="^(STORES|ACCOUNTS|DISPATCH)$"), limit: int = Query(default=100, ge=1, le=300),
                 db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(gate_reader)):
    query = db.query(GateEntry).filter(GateEntry.plant_id == str(plant_id))
    if svc.is_watchman_only(current_user):
        query = query.filter(GateEntry.created_by == svc.actor_of(current_user), GateEntry.created_at >= svc.day_start_utc(svc.plant_today()))
    if kind:
        query = query.filter(GateEntry.kind == kind)
    if route:
        query = query.filter(GateEntry.route == route)
    if status:
        query = query.filter(GateEntry.status.in_([value.strip().upper() for value in status.split(",") if value.strip()]))
    entries = query.order_by(GateEntry.created_at.desc()).limit(limit).all()
    return {"items": svc.entries_payload(db, entries, vault.access_for(current_user))}


@router.get("/entries/{entry_id}")
def get_entry(entry_id: str, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(gate_reader)):
    entry = svc.get_entry(db, plant_id, entry_id)
    if svc.is_watchman_only(current_user) and entry.created_by != svc.actor_of(current_user):
        raise HTTPException(status_code=403, detail="A watchman sees only the entries they made.")
    if entry.status in svc.LINKED_STATES and svc.sync_entry_links(db, entry, "system:gate-sync"):
        db.commit()
    return svc.entry_payload(db, entry, access=vault.access_for(current_user))


class Recategorise(Strict):
    category_code: str = Field(min_length=1, max_length=60)
    category_note: Optional[str] = Field(default=None, max_length=300)
    expected_version: int = Field(ge=1)


@router.post("/entries/{entry_id}/category")
def recategorise_entry(entry_id: str, payload: Recategorise, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
                       current_user: dict = Depends(recategorise_user)):
    """Wrong category tapped at the gate: Store, Accounts or the plant head moves it to the other queue (logged)."""
    category = _reason("BILL_CATEGORY", payload.category_code, payload.category_note, plant_id, current_user, "the bill type")
    entry = svc.get_entry(db, plant_id, entry_id, for_update=True)
    svc.recategorise(db, entry, category_code=category.code, category_label=_words(category), actor=svc.actor_of(current_user),
                     expected_version=payload.expected_version)
    db.commit()
    return svc.entry_payload(db, entry, access=vault.access_for(current_user))


# ── Stores ─────────────────────────────────────────────────────────────────────────────────────
@router.get("/at-the-gate")
def get_at_the_gate(db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(store_user)):
    """Material bills photographed at the gate and not yet on a GRN (Purchase › Goods inward strip)."""
    return {"items": svc.entries_payload(db, svc.at_the_gate(db, plant_id), vault.access_for(current_user))}


class LinkReceipt(Strict):
    receipt_id: uuid.UUID
    expected_version: Optional[int] = Field(default=None, ge=1)


@router.post("/entries/{entry_id}/link-receipt")
def link_entry_to_receipt(entry_id: str, payload: LinkReceipt, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
                          current_user: dict = Depends(store_user)):
    """Link a gate entry to a GRN already posted: its photos go to the GRN and every reel and lot of it."""
    receipt = db.query(PurchaseReceipt).filter(PurchaseReceipt.id == payload.receipt_id, PurchaseReceipt.plant_id == str(plant_id)).first()
    if not receipt:
        raise HTTPException(status_code=404, detail="That GRN is not in this plant.")
    entry = svc.get_entry(db, plant_id, entry_id, for_update=True)
    svc.link_receipt(db, entry, receipt, actor=svc.actor_of(current_user), expected_version=payload.expected_version)
    db.commit()
    return svc.entry_payload(db, entry, access=vault.access_for(current_user))


@router.get("/receipt-entries")
def get_receipt_entries(receipt_ids: str = Query(min_length=1, max_length=8000), db: Session = Depends(get_db),
                        plant_id: str = Depends(get_current_plant), current_user: dict = Depends(get_current_user)):
    """Gate entries of GRNs (for the "No gate photo" chip). Any role that may read the GRN register."""
    if svc.is_watchman_only(current_user):
        raise HTTPException(status_code=403, detail="Not open to the gate desk.")
    return {"items": svc.receipt_gate_entries(db, plant_id, receipt_ids.split(",")[:300])}


# ── Accounts bills inbox ───────────────────────────────────────────────────────────────────────
@router.get("/bills")
def list_bills(tab: str = Query(default="TO_FILE", pattern="^(TO_FILE|FILED|ALL)$"), q: Optional[str] = Query(default=None, max_length=120),
               limit: int = Query(default=100, ge=1, le=300), db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
               current_user: dict = Depends(accounts_user)):
    query = db.query(GateEntry).filter(GateEntry.plant_id == str(plant_id), GateEntry.kind == "BILL_IN", GateEntry.route == "ACCOUNTS")
    base = query
    if tab == "TO_FILE":
        query = query.filter(GateEntry.status.in_(["AT_GATE", "WITH_ACCOUNTS"]))
    elif tab == "FILED":
        query = query.filter(GateEntry.status == "FILED")
    if q and q.strip():
        term = f"%{q.strip()}%"
        from sqlalchemy import or_
        query = query.filter(or_(GateEntry.entry_no.ilike(term), GateEntry.party_text.ilike(term), GateEntry.bill_no.ilike(term),
                                 GateEntry.vehicle_no.ilike(term), GateEntry.category_label.ilike(term)))
    entries = query.order_by(GateEntry.created_at.asc() if tab == "TO_FILE" else GateEntry.created_at.desc()).limit(limit).all()
    counts = {"TO_FILE": base.filter(GateEntry.status.in_(["AT_GATE", "WITH_ACCOUNTS"])).count(), "FILED": base.filter(GateEntry.status == "FILED").count()}
    return {"items": svc.entries_payload(db, entries, vault.access_for(current_user)), "counts": counts}


class FileBill(Strict):
    expected_version: int = Field(ge=1)
    party_name: str = Field(min_length=1, max_length=200)
    party_id: Optional[str] = Field(default=None, max_length=64)
    bill_no: str = Field(min_length=1, max_length=120)
    bill_date: date
    amount: Decimal = Field(ge=0, le=Decimal("999999999999"))
    cost_head_code: str = Field(min_length=1, max_length=60)
    cost_head_note: Optional[str] = Field(default=None, max_length=300)


@router.post("/entries/{entry_id}/file")
def file_entry(entry_id: str, payload: FileBill, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
               current_user: dict = Depends(accounts_user)):
    """Accounts files an expense bill: a register entry with its photos; no stock and no ledger."""
    head = _reason("COST_HEAD", payload.cost_head_code, payload.cost_head_note, plant_id, current_user, "the cost head")
    entry = svc.get_entry(db, plant_id, entry_id, for_update=True)
    svc.file_bill(db, entry, party_name=payload.party_name, party_id=payload.party_id, bill_no=payload.bill_no, bill_date=payload.bill_date,
                  amount=payload.amount, cost_head_code=head.code, cost_head_label=_words(head), actor=svc.actor_of(current_user),
                  expected_version=payload.expected_version)
    db.commit()
    return svc.entry_payload(db, entry, access=vault.access_for(current_user))


# ── Visitors ───────────────────────────────────────────────────────────────────────────────────
class HostIn(Strict):
    """The BFF fills name / email / department from the auth user list; the browser sends only the id."""
    host_user_id: Optional[str] = Field(default=None, max_length=64)
    host_name: Optional[str] = Field(default=None, max_length=160)
    host_email: Optional[str] = Field(default=None, max_length=200)
    host_department_key: Optional[str] = Field(default=None, max_length=20)


class VisitIn(HostIn):
    request_id: uuid.UUID
    mobile: str = Field(min_length=10, max_length=16)
    name: str = Field(min_length=2, max_length=120)
    company: Optional[str] = Field(default=None, max_length=160)
    purpose_code: str = Field(min_length=1, max_length=60)
    purpose_note: Optional[str] = Field(default=None, max_length=300)
    people: int = Field(default=1, ge=1, le=50)
    vehicle_no: Optional[str] = Field(default=None, max_length=30)


class DeskVisitIn(VisitIn):
    gate_id: uuid.UUID
    let_in: bool = False


def _host(payload: HostIn) -> svc.HostChoice:
    return svc.HostChoice(user_id=payload.host_user_id, name=payload.host_name, email=payload.host_email,
                          department_key=(payload.host_department_key or "").upper() or None)


def _visit_out(db: Session, visit: GateVisit, current_user: dict) -> dict[str, Any]:
    return svc.visits_payload(db, [visit], private=svc.sees_private(current_user), settings=svc.settings_for(db, visit.plant_id))[0]


@router.post("/visits")
def create_walk_in(payload: DeskVisitIn, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(desk_user)):
    """A visitor without a smartphone: the watchman fills the same form (and may let them in at once)."""
    gate = svc.get_gate(db, plant_id, payload.gate_id, active_only=True)
    existing = db.query(GateVisit).filter(GateVisit.plant_id == str(plant_id), GateVisit.request_id == payload.request_id).first()
    if existing:
        return {"created": False, "visit": _visit_out(db, existing, current_user)}
    purpose = _reason("VISIT_PURPOSE", payload.purpose_code, payload.purpose_note, plant_id, current_user, "the purpose of the visit")
    actor = svc.actor_of(current_user)
    visit, created = svc.create_visit(db, plant_id=plant_id, gate=gate, mobile=payload.mobile, name=payload.name, company=payload.company,
                                      purpose_code=purpose.code, purpose_label=purpose.label, purpose_note=purpose.note, host=_host(payload),
                                      people=payload.people, vehicle_no=payload.vehicle_no, source="DESK", actor=actor, request_id=payload.request_id)
    if payload.let_in:
        svc.let_in(db, visit, actor=actor)
    db.commit()
    return {"created": created, "visit": _visit_out(db, visit, current_user), "pass_code": f"HARIOM|VISIT|{visit.pass_token}"}


class VisitAction(Strict):
    expected_version: Optional[int] = Field(default=None, ge=1)


class DenyIn(VisitAction):
    reason_code: str = Field(min_length=1, max_length=60)
    reason_note: Optional[str] = Field(default=None, max_length=300)


@router.post("/visits/{visit_id}/in")
def let_in(visit_id: str, payload: VisitAction, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
           current_user: dict = Depends(desk_user)):
    visit = svc.get_visit(db, plant_id, visit_id, for_update=True)
    svc.let_in(db, visit, actor=svc.actor_of(current_user), expected_version=payload.expected_version)
    db.commit()
    return _visit_out(db, visit, current_user)


@router.post("/visits/{visit_id}/deny")
def deny_visit(visit_id: str, payload: DenyIn, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
               current_user: dict = Depends(desk_user)):
    reason = _reason("GATE_DENY", payload.reason_code, payload.reason_note, plant_id, current_user, "denying entry")
    visit = svc.get_visit(db, plant_id, visit_id, for_update=True)
    svc.deny(db, visit, reason_code=reason.code, reason_label=reason.label, reason_note=reason.note, actor=svc.actor_of(current_user),
             expected_version=payload.expected_version)
    db.commit()
    return _visit_out(db, visit, current_user)


@router.post("/visits/{visit_id}/out")
def visit_out(visit_id: str, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(desk_user)):
    visit = svc.get_visit(db, plant_id, visit_id, for_update=True)
    svc.mark_out(db, visit, actor=svc.actor_of(current_user))
    db.commit()
    return _visit_out(db, visit, current_user)


class ScanOut(Strict):
    code: str = Field(min_length=8, max_length=400)


@router.post("/visits/scan-out")
def scan_out(payload: ScanOut, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(desk_user)):
    """The visitor shows the pass QR on the way out (or the watchman scans it to find the visit)."""
    visit = svc.visit_by_pass(db, svc.pass_token_from_scan(payload.code), for_update=True)
    if visit.plant_id != str(plant_id):
        raise HTTPException(status_code=404, detail="This pass is for another plant.")
    if visit.status == "ARRIVED":
        db.rollback()
        return {"action": "WAITING", "visit": _visit_out(db, visit, current_user)}
    svc.mark_out(db, visit, actor=svc.actor_of(current_user))
    db.commit()
    return {"action": "OUT", "visit": _visit_out(db, visit, current_user)}


class ReplyIn(Strict):
    reply: str = Field(pattern="^(SEND_IN|WAIT|NOT_AVAILABLE)$")


@router.post("/visits/{visit_id}/reply")
def reply_to_visit(visit_id: str, payload: ReplyIn, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
                   current_user: dict = Depends(get_current_user)):
    """The host's answer from the notification (Send in / Ask to wait / Not available); shows on the watchman's row."""
    visit = svc.get_visit(db, plant_id, visit_id, for_update=True)
    svc.host_reply(db, visit, reply=payload.reply, current_user=current_user)
    db.commit()
    return {"ok": True, "message": f"Told the gate: {svc.REPLY_WORDS[payload.reply]}", "visit_no": visit.visit_no, "status": visit.status}


class DeskPhoto(Strict):
    document_id: uuid.UUID


@router.post("/visits/{visit_id}/photo")
def set_desk_photo(visit_id: str, payload: DeskPhoto, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
                   current_user: dict = Depends(desk_user)):
    visit = svc.get_visit(db, plant_id, visit_id, for_update=True)
    svc.attach_desk_photo(db, visit, payload.document_id, svc.actor_of(current_user))
    db.commit()
    return _visit_out(db, visit, current_user)


@router.get("/visits/{visit_id}/photo")
def get_visit_photo(visit_id: str, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
                    current_user: dict = Depends(get_current_user)):
    """Visitor photo: Watchman, plant head, Owner and Admin only (privacy rule)."""
    if not svc.sees_private(current_user):
        raise HTTPException(status_code=403, detail="Visitor photos are for the gate, the plant head, the Owner and the Admin.")
    visit = svc.get_visit(db, plant_id, visit_id)
    if not visit.photo_doc_id or visit.photo_purged_at:
        raise HTTPException(status_code=404, detail="No photo for this visit.")
    document = vault.get_document(db, visit.photo_doc_id, [plant_id])
    page = vault.page_of(db, document, 1)
    data = vault.read_page_bytes(page)
    return Response(content=data, media_type=page.mime, headers={"Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff"})


# ── Goods out ──────────────────────────────────────────────────────────────────────────────────
NOT_AT_THE_GATE = "The gate only takes photos. Stores links the challan and adds the Tally bill no. on the dispatch register."


class GoodsOut(BaseModel):
    """The watchman's "+ Goods out": the vehicle no.; the Tally bill and our challan photos follow through the
    vault outbox linked GATE_ENTRY → the returned id. ``dispatch_ref`` / ``tally_bill_no`` are accepted only
    to refuse them (phones still on the 7 Nov screen): linking is Store's job."""
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    request_id: uuid.UUID
    gate_id: uuid.UUID
    vehicle_no: Optional[str] = Field(default=None, max_length=30)
    dispatch_ref: Optional[str] = Field(default=None, max_length=100)
    tally_bill_no: Optional[str] = Field(default=None, max_length=60)
    tally_bill_date: Optional[date] = None


@router.post("/goods-out")
def post_goods_out(payload: GoodsOut, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(desk_user)):
    """Truck leaving: photos and the vehicle no. only. The entry waits WITH_STORES; Store is told."""
    if payload.dispatch_ref or payload.tally_bill_no or payload.tally_bill_date:
        raise HTTPException(status_code=403, detail=NOT_AT_THE_GATE)
    existing = db.query(GateEntry).filter(GateEntry.plant_id == str(plant_id), GateEntry.request_id == payload.request_id).first()
    if existing and existing.kind == "GOODS_OUT":
        return {"created": False, "entry": svc.entry_payload(db, existing, access=vault.access_for(current_user)), "document_kinds": ["TALLY_BILL", "OUR_CHALLAN"]}
    gate = svc.get_gate(db, plant_id, payload.gate_id, active_only=True)
    entry, created = svc.create_goods_out(db, plant_id=plant_id, gate=gate, vehicle_no=payload.vehicle_no, actor=svc.actor_of(current_user),
                                          request_id=payload.request_id)
    db.commit()
    return {"created": created, "entry": svc.entry_payload(db, entry, access=vault.access_for(current_user)), "document_kinds": ["TALLY_BILL", "OUR_CHALLAN"]}


@router.get("/gone-out")
def get_gone_out(db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(goods_out_linker)):
    """Goods-out photos not yet linked to a challan (Dispatch register › "Gone out at the gate")."""
    return {"items": svc.entries_payload(db, svc.gone_out_to_link(db, plant_id), vault.access_for(current_user))}


@router.get("/gone-out/challans")
def get_challans_to_link(entry_id: Optional[str] = Query(default=None, max_length=40), q: Optional[str] = Query(default=None, max_length=80),
                         db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(goods_out_linker)):
    """Challans of the last 30 days with no gate-out photo linked; the entry's own day first."""
    day = svc._entry_day(svc.get_entry(db, plant_id, entry_id)) if entry_id else svc.plant_today()
    return {"items": svc.challans_to_link(db, plant_id, q=q, day=day), "day": day.isoformat()}


class ChallanLinkIn(Strict):
    dispatch_ref: str = Field(min_length=1, max_length=100)
    tally_bill_no: str = Field(min_length=1, max_length=60)
    tally_bill_date: Optional[date] = None


class GoneOutLink(Strict):
    expected_version: Optional[int] = Field(default=None, ge=1)
    links: list[ChallanLinkIn] = Field(min_length=1, max_length=20)


@router.post("/gone-out/{entry_id}/link")
def link_gone_out(entry_id: str, payload: GoneOutLink, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
                  current_user: dict = Depends(goods_out_linker)):
    """Store links the gate photos to the challan(s) that went out on that truck, each with its Tally bill no."""
    entry = svc.get_entry(db, plant_id, entry_id, for_update=True)
    links = [svc.ChallanLink(row.dispatch_ref, row.tally_bill_no, row.tally_bill_date) for row in payload.links]
    svc.link_goods_out(db, entry, links=links, actor=svc.actor_of(current_user), expected_version=payload.expected_version)
    db.commit()
    return svc.entry_payload(db, entry, access=vault.access_for(current_user))


class GoneOutUnlink(Strict):
    expected_version: int = Field(ge=1)
    reason_code: str = Field(min_length=1, max_length=60)
    reason_note: Optional[str] = Field(default=None, max_length=300)
    dispatch_ref: Optional[str] = Field(default=None, max_length=100)


@router.post("/gone-out/{entry_id}/unlink")
def unlink_gone_out(entry_id: str, payload: GoneOutUnlink, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
                    current_user: dict = Depends(goods_out_unlinker)):
    """Plant head (Owner / Admin) undoes a wrong link with a GATE_OUT_UNLINK reason; logged on the entry."""
    reason = _reason("GATE_OUT_UNLINK", payload.reason_code, payload.reason_note, plant_id, current_user, "why the link is undone")
    entry = svc.get_entry(db, plant_id, entry_id, for_update=True)
    svc.unlink_goods_out(db, entry, reason_code=reason.code, reason_label=_words(reason), actor=svc.actor_of(current_user),
                         expected_version=payload.expected_version, dispatch_ref=payload.dispatch_ref)
    db.commit()
    return svc.entry_payload(db, entry, access=vault.access_for(current_user))


@router.get("/dispatch-status")
def get_dispatch_status(refs: str = Query(min_length=1, max_length=12000), db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
                        current_user: dict = Depends(require_role(["Dispatch", "PlantManager", "Sales", "Store"]))):
    return {"items": svc.dispatch_status(db, plant_id, refs.split(","))}


class TallyIn(Strict):
    dispatch_ref: str = Field(min_length=1, max_length=100)
    tally_bill_no: str = Field(min_length=1, max_length=60)
    tally_bill_date: Optional[date] = None
    expected_version: Optional[int] = Field(default=None, ge=1)


@router.put("/dispatch/tally")
def put_tally(payload: TallyIn, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(tally_user)):
    """Store or the dispatch desk types the Tally bill no. on a challan (it prefills Store's link screen)."""
    svc.set_tally(db, plant_id, payload.dispatch_ref, tally_bill_no=payload.tally_bill_no, tally_bill_date=payload.tally_bill_date,
                  actor=svc.actor_of(current_user), expected_version=payload.expected_version)
    db.commit()
    return svc.dispatch_status(db, plant_id, [payload.dispatch_ref.strip()]).get(payload.dispatch_ref.strip())


# ── History ────────────────────────────────────────────────────────────────────────────────────
def _history_args(date_from: Optional[date], date_to: Optional[date]) -> tuple[date, date]:
    today = svc.plant_today()
    end = date_to or today
    start = date_from or (end - timedelta(days=6))
    if start > end:
        raise HTTPException(status_code=422, detail="The From date is after the To date.")
    if (end - start).days > 366:
        raise HTTPException(status_code=422, detail="Pick at most one year at a time.")
    return start, end


@router.get("/history")
def get_history(date_from: Optional[date] = None, date_to: Optional[date] = None, gate_id: Optional[str] = None,
                type: Optional[str] = Query(default=None, pattern="^(VISITOR|BILL_IN|GOODS_OUT)$"), status: Optional[str] = Query(default=None, max_length=20),
                q: Optional[str] = Query(default=None, max_length=120), limit: int = Query(default=100, ge=1, le=500), offset: int = Query(default=0, ge=0),
                db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(history_user)):
    start, end = _history_args(date_from, date_to)
    result = svc.history(db, plant_id, date_from=start, date_to=end, gate_id=gate_id, kind=type, status=status, q=q,
                         private=svc.sees_private(current_user), limit=limit, offset=offset)
    result.update({"date_from": start.isoformat(), "date_to": end.isoformat()})
    return result


@router.get("/history/export.csv")
def export_history(date_from: Optional[date] = None, date_to: Optional[date] = None, gate_id: Optional[str] = None,
                   type: Optional[str] = Query(default=None, pattern="^(VISITOR|BILL_IN|GOODS_OUT)$"), status: Optional[str] = Query(default=None, max_length=20),
                   q: Optional[str] = Query(default=None, max_length=120), db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
                   current_user: dict = Depends(history_user)):
    start, end = _history_args(date_from, date_to)
    result = svc.history(db, plant_id, date_from=start, date_to=end, gate_id=gate_id, kind=type, status=status, q=q,
                         private=svc.sees_private(current_user), limit=5000, offset=0)
    body = "﻿" + svc.history_csv(result["items"])
    filename = f"gate-register-{start.isoformat()}-to-{end.isoformat()}.csv"
    return StreamingResponse(iter([body.encode("utf-8")]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})


# ── Public (BFF only, internal token) ──────────────────────────────────────────────────────────
def require_internal(x_internal_token: Optional[str] = Header(default=None, alias="X-Internal-Token")) -> None:
    expected = os.getenv("INTERNAL_EVENT_TOKEN", "hariom-internal-events")
    if not x_internal_token or not hmac.compare_digest(str(x_internal_token), expected):
        raise HTTPException(status_code=403, detail="Forbidden")


@public_router.get("/gates/{token}", dependencies=[Depends(require_internal)])
def public_gate(token: str, db: Session = Depends(get_db)):
    gate = svc.gate_by_token(db, token)
    return {"gate_name": gate.name, "gate_code": gate.code, "plant_id": gate.plant_id, "direction": gate.direction}


class Lookup(Strict):
    mobile: str = Field(min_length=10, max_length=16)


@public_router.post("/gates/{token}/lookup", dependencies=[Depends(require_internal)])
def public_lookup(token: str, payload: Lookup, db: Session = Depends(get_db)):
    """A known mobile prefills name and company only (never earlier visits or hosts)."""
    gate = svc.gate_by_token(db, token)
    visitor = svc.known_visitor(db, gate.plant_id, svc.clean_mobile(payload.mobile))
    if not visitor:
        return {"known": False}
    return {"known": True, "name": visitor.name, "company": visitor.company}


class PublicVisitIn(VisitIn):
    purpose_label: str = Field(min_length=1, max_length=200)


@public_router.post("/gates/{token}/visits", dependencies=[Depends(require_internal)])
def public_check_in(token: str, payload: PublicVisitIn, db: Session = Depends(get_db)):
    """Self check-in from the gate QR. The BFF checked the purpose code against the plant's VISIT_PURPOSE
    list and filled the host from the auth user list."""
    gate = svc.gate_by_token(db, token)
    from ..reasons import reason_needs_note, OTHER_NOTE_MIN
    if reason_needs_note(payload.purpose_code) and len((payload.purpose_note or "").strip()) < OTHER_NOTE_MIN:
        raise HTTPException(status_code=422, detail="Write a few words about the purpose of your visit.")
    visit, created = svc.create_visit(db, plant_id=gate.plant_id, gate=gate, mobile=payload.mobile, name=payload.name, company=payload.company,
                                      purpose_code=payload.purpose_code, purpose_label=payload.purpose_label, purpose_note=payload.purpose_note,
                                      host=_host(payload), people=payload.people, vehicle_no=payload.vehicle_no, source="SELF",
                                      actor="visitor:self", request_id=payload.request_id)
    db.commit()
    return {"created": created, "pass_token": visit.pass_token, "pass": svc.public_pass_payload(db, visit)}


@public_router.get("/visits/{pass_token}", dependencies=[Depends(require_internal)])
def public_pass(pass_token: str, db: Session = Depends(get_db)):
    return svc.public_pass_payload(db, svc.visit_by_pass(db, pass_token))


@public_router.post("/visits/{pass_token}/photo", dependencies=[Depends(require_internal)])
def public_photo(pass_token: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    data = file.file.read(MAX_PUBLIC_PHOTO_BYTES + 1)
    if len(data) > MAX_PUBLIC_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="The photo is too large. Take it again; it is made smaller on your phone.")
    visit = svc.visit_by_pass(db, pass_token, for_update=True)
    svc.attach_public_photo(db, visit, data=data, filename=file.filename)
    db.commit()
    return svc.public_pass_payload(db, visit)
