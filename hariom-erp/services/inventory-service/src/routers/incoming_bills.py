"""Incoming QC by bill, the bill weight check and plant settings (6 Nov 2026).

Quality › Incoming inspection lists bills, not lots. Entry is QC, Inward QC, Owner or Admin; Store and the
plant head see the same screen read-only. The Owner decides a 20–50 kg shortage; above 50 kg the debit
note drafts itself through the existing debit-note rules. Stock never moves on a weight.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from ..database import get_db
from ..models_weight import PlantSetting, PurchaseWeightVariance
from ..services import incoming_bills as bills
from ..services import weight_variance as wv
from ..utils.auth import authorized_plant_ids, get_current_plant, get_current_plant_scope, get_current_user, require_role

quality_router = APIRouter(prefix="/inventory/quality", tags=["incoming-qc-by-bill"])
procurement_router = APIRouter(prefix="/inventory/procurement", tags=["weight-variances"])

VIEW_ROLES = ["Admin", "Owner", "PlantManager", "QC", "Store", "InwardQC"]
ENTRY_ROLES = ["QC", "InwardQC"]  # Owner and Admin pass require_role on their own


def _entry_user(current_user: dict = Depends(require_role(ENTRY_ROLES))) -> dict:
    return current_user


# ── Bills ──────────────────────────────────────────────────────────────────────────────────────

@quality_router.get("/incoming/bills")
def list_incoming_bills(
    tab: Optional[str] = Query(default=None, pattern="^(TO_WEIGH|PART_DONE|OWNER_DECISION|DONE_TODAY|HELD)$"),
    q: Optional[str] = Query(default=None, max_length=120),
    lot: Optional[str] = Query(default=None, max_length=80, description="REEL:<id> or BATCH:<id>: the bill of this lot"),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(VIEW_ROLES)),
):
    """Bill cards with lot counts and the weight check so far; ``counts`` per tab."""
    return bills.list_bills(db, authorized_plant_ids(plant_scope), tab=tab, q=q, lot=lot)


@quality_router.get("/incoming/bills/{bill_key}")
def get_incoming_bill(
    bill_key: str,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(VIEW_ROLES)),
):
    """One bill: header, tiles, every lot with bill qty, actual qty, last inspection, holds and its standard."""
    detail = bills.bill_detail(db, authorized_plant_ids(plant_scope), bill_key)
    db.commit()
    return detail


class BillEntryRow(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    entity_type: str = Field(pattern="^(REEL|BATCH)$")
    entity_id: uuid.UUID
    actual_qty: Optional[Decimal] = Field(default=None, gt=0, le=10_000_000)
    readings: dict[str, Any] = Field(default_factory=dict)
    # ACCEPT (by the readings; needs the actual weight), HOLD, REJECT, or NONE (weight only).
    decision: str = Field(default="ACCEPT", pattern="^(ACCEPT|HOLD|REJECT|NONE)$")
    reason_code: Optional[str] = Field(default=None, max_length=80)
    reason_note: Optional[str] = Field(default=None, max_length=1000)
    note: Optional[str] = Field(default=None, max_length=1000)
    close_holds: bool = False
    # The last inspection the desk saw ("" = none): another person's save in between is refused.
    base_inspection_id: Optional[str] = Field(default=None, max_length=40)
    # The 15 % typo guard was shown and confirmed.
    confirm_far: bool = False
    idempotency_key: str = Field(min_length=8, max_length=120)

    @field_validator("entity_type", mode="before")
    @classmethod
    def upper_type(cls, value: Any) -> Any:
        return str(value or "").strip().upper()


class BillEntries(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rows: list[BillEntryRow] = Field(min_length=1, max_length=200)


@quality_router.post("/incoming/bills/{bill_key}/entries")
def save_incoming_bill_entries(
    bill_key: str,
    payload: BillEntries,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(_entry_user),
):
    """Save weighed rows of one bill. Each row: the inspection path, then the actual qty, then the lot's
    stock status from QC, each in its own savepoint; then the bill's weight check. Result per row."""
    rows = [row.model_dump(mode="json") for row in payload.rows]
    seen: set[str] = set()
    for row in rows:
        if row["idempotency_key"] in seen:
            raise HTTPException(status_code=422, detail="Each row needs its own key")
        seen.add(row["idempotency_key"])
    return bills.save_entries(db, plant_id, bill_key, rows, current_user)


class ReweighRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    request_id: uuid.UUID
    actual_qty: Decimal = Field(gt=0, le=10_000_000)
    expected_actual_qty: Optional[Decimal] = Field(default=None, gt=0)
    reason_code: str = Field(min_length=1, max_length=80)
    reason_note: Optional[str] = Field(default=None, max_length=1000)
    confirm_far: bool = False


@quality_router.post("/lots/{entity_type}/{entity_id}/reweigh")
def reweigh_lot(
    entity_type: str,
    entity_id: uuid.UUID,
    payload: ReweighRequest,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(_entry_user),
):
    """Correct a saved actual weight (reason WEIGH_CORRECTION). Refused once the lot is issued or the
    bill's weight case is in a debit note that is submitted or later."""
    kind = str(entity_type or "").upper()
    if kind not in {"REEL", "BATCH"}:
        raise HTTPException(status_code=404, detail="Lot not found")
    return bills.reweigh(db, plant_id, kind, entity_id, payload.model_dump(mode="json"), current_user)


# ── Weight differences (Purchase › Invoice differences) ────────────────────────────────────────

@procurement_router.get("/weight-variances")
def list_weight_variances(
    status: Optional[str] = Query(default=None, max_length=30),
    band: Optional[str] = Query(default=None, max_length=20),
    supplier_id: Optional[uuid.UUID] = Query(default=None),
    po_raiser: Optional[str] = Query(default=None, max_length=200),
    month: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    include_within: bool = Query(default=False),
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    plants = authorized_plant_ids(plant_scope)
    query = db.query(PurchaseWeightVariance).filter(PurchaseWeightVariance.plant_id.in_(plants))
    if status:
        query = query.filter(PurchaseWeightVariance.status == status.strip().upper())
    elif not include_within:
        query = query.filter(PurchaseWeightVariance.status.notin_(["PROVISIONAL", "WITHIN"]))
    if band:
        query = query.filter(PurchaseWeightVariance.band == band.strip().upper())
    if supplier_id:
        query = query.filter(PurchaseWeightVariance.supplier_id == supplier_id)
    if po_raiser:
        query = query.filter(PurchaseWeightVariance.po_raiser.ilike(f"%{po_raiser.strip()}%"))
    if month:
        year, mon = (int(part) for part in month.split("-"))
        start = datetime(year, mon, 1)
        end = datetime(year + (mon == 12), 1 if mon == 12 else mon + 1, 1)
        query = query.filter(PurchaseWeightVariance.created_at >= start, PurchaseWeightVariance.created_at < end)
    rows = query.order_by(PurchaseWeightVariance.updated_at.desc()).limit(limit).all()
    changed = False
    for row in rows:
        changed = wv.sync_closed(db, row) or changed
    items = [wv.variance_payload(db, row) for row in rows]
    if changed:
        db.commit()
    open_states = {"AWAITING_OWNER", "CLAIM_RAISED", "WAITING_INVOICE", "DN_DRAFTED"}
    return {"items": items, "summary": {
        "awaiting_owner": sum(1 for row in items if row["status"] == "AWAITING_OWNER"),
        "open": sum(1 for row in items if row["status"] in open_states),
        "short_kg": round(sum(row["short_qty"] for row in items if row["uom"] == "KG"), 3),
        "claim_amount": round(sum(row["claim_amount"] for row in items if row["status"] not in {"SKIPPED", "WITHIN"}), 2),
    }}


@procurement_router.get("/weight-variances/{variance_id}")
def get_weight_variance(variance_id: uuid.UUID, db: Session = Depends(get_db), plant_scope: dict = Depends(get_current_plant_scope),
                        current_user: dict = Depends(get_current_user)):
    row = db.query(PurchaseWeightVariance).filter(PurchaseWeightVariance.id == variance_id,
                                                  PurchaseWeightVariance.plant_id.in_(authorized_plant_ids(plant_scope))).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Weight case not found")
    if wv.sync_closed(db, row):
        db.commit()
    return wv.variance_payload(db, row)


class VarianceDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: str = Field(pattern="^(MAKE_DEBIT_NOTE|SKIP)$")
    reason_code: Optional[str] = Field(default=None, max_length=80)
    reason_note: Optional[str] = Field(default=None, max_length=1000)
    expected_version: Optional[int] = Field(default=None, ge=1)


@procurement_router.post("/weight-variances/{variance_id}/decide")
def decide_weight_variance(
    variance_id: uuid.UUID,
    payload: VarianceDecision,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner"])),
):
    """Owner: Make debit note (QUANTITY case + DN draft through the existing rules) or Skip with a
    WEIGHT_SHORT_SKIP reason. Repeating the same decision returns the case unchanged."""
    row = db.query(PurchaseWeightVariance).filter(PurchaseWeightVariance.id == variance_id,
                                                  PurchaseWeightVariance.plant_id == plant_id).with_for_update().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Weight case not found in this plant (it may have been regrouped by invoice).")
    if payload.expected_version is not None and payload.expected_version != row.version:
        raise HTTPException(status_code=409, detail="The weight case changed; reload before deciding.")
    outcome = wv.decide(db, row, decision=payload.decision, reason_code=payload.reason_code, reason_note=payload.reason_note,
                        ctx=bills.ctx_of(current_user))
    db.commit()
    db.refresh(row)
    result = wv.variance_payload(db, row)
    result["idempotent"] = outcome.get("idempotent", False)
    result["outcome"] = (
        f"Skipped: {row.reason_label}" if row.status == "SKIPPED"
        else f"Debit note {result['debit_note_no']} drafted" if result.get("debit_note_no")
        else "Case raised; the debit note drafts when the invoice is attached" if row.status == "WAITING_INVOICE"
        else row.last_error or "Saved"
    )
    return result


# ── Plant settings (System › Plants) ──────────────────────────────────────────────────────────

def _settings_payload(plant_id: str, row: Optional[PlantSetting]) -> dict[str, Any]:
    notify, auto = (Decimal(str(row.weight_short_notify_kg)), Decimal(str(row.weight_short_auto_kg))) if row else (wv.DEFAULT_NOTIFY_KG, wv.DEFAULT_AUTO_KG)
    return {"plant_id": plant_id, "weight_short_notify_kg": float(notify), "weight_short_auto_kg": float(auto),
            "version": row.version if row else 0, "updated_by": row.updated_by if row else None,
            "updated_at": row.updated_at.isoformat() if row and row.updated_at else None, "is_default": row is None}


@procurement_router.get("/plant-settings")
def get_plant_settings(db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(get_current_user)):
    return _settings_payload(plant_id, db.get(PlantSetting, plant_id))


class PlantSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    weight_short_notify_kg: Decimal = Field(ge=0, le=100000)
    weight_short_auto_kg: Decimal = Field(ge=0, le=100000)
    expected_version: int = Field(ge=0)


@procurement_router.put("/plant-settings")
def update_plant_settings(payload: PlantSettingsUpdate, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
                          current_user: dict = Depends(require_role(["Owner"]))):
    """Owner sets the weight limits of the plant. New weight checks copy them; old ones keep theirs."""
    if payload.weight_short_auto_kg < payload.weight_short_notify_kg:
        raise HTTPException(status_code=422, detail="The auto debit-note limit cannot be below the Owner-decides limit.")
    row = db.query(PlantSetting).filter(PlantSetting.plant_id == plant_id).with_for_update().first()
    current = row.version if row else 0
    if payload.expected_version != current:
        raise HTTPException(status_code=409, detail="The limits changed; reload before saving.")
    if row is None:
        row = PlantSetting(plant_id=plant_id, version=0)
        db.add(row)
    row.weight_short_notify_kg = payload.weight_short_notify_kg
    row.weight_short_auto_kg = payload.weight_short_auto_kg
    row.version = current + 1
    row.updated_by = bills.actor_of(current_user)
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return _settings_payload(plant_id, row)
