"""Audited settlement of excess FG without stock outward or Sales fulfillment."""
import hashlib
import json
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..card_lock import card_posting_lease
from ..database import get_db
from ..dispatch_quantities import dispatchable_quantity, shipping_allowance
from ..models import AuditEvent, Dispatch, JobCard, JobCardStage, PackingRecord
from ..reasons import ReasonChoice, reason_input, resolve_reason, token_of
from ..utils.auth import get_current_plant, require_role
from .dispatch import _active_hold_count, _plant_uuid
from .. import boxes as box_rules
from ..entry_models import CompletionEffect, FgBox

router = APIRouter(prefix="/dispatch", tags=["dispatch"])


class RetainSurplusInput(BaseModel):
    request_id: str = Field(min_length=3, max_length=120)
    expected_remaining_qty: int = Field(gt=0, strict=True)
    # SURPLUS_RETAIN code from Masters › Reason codes (owner decision 4); `reason` is the old free text,
    # no longer enough on its own (the UI sends "Label — note" in it).
    reason_code: Optional[str] = Field(default=None, max_length=40)
    reason_note: Optional[str] = Field(default=None, max_length=1000)
    reason: Optional[str] = Field(default=None, max_length=2000)


def _surplus_reason(payload: RetainSurplusInput, job, user) -> ReasonChoice:
    code, note = reason_input(payload)
    return resolve_reason(category="SURPLUS_RETAIN", code=code, note=note, plant_id=job.plant_id,
                          token=token_of(user), what="keeping the surplus")


def _reason_fields(choice: ReasonChoice) -> dict:
    return {"reason": choice.text, "reason_code": choice.code, "reason_label": choice.label, "reason_note": choice.note}


@router.post("/retain-surplus/{job_card_id}")
def retain_surplus(
    job_card_id: uuid.UUID,
    payload: RetainSurplusInput,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    user: dict = Depends(require_role(["Owner", "Admin", "Dispatch"])),
):
    with card_posting_lease(job_card_id):
        return _retain_surplus(job_card_id, payload, db, plant_id, user)


def _retain_surplus(job_card_id, payload, db, plant_id, user):
    job = db.query(JobCard).filter_by(id=job_card_id, plant_id=_plant_uuid(plant_id)).with_for_update().first()
    if not job:
        raise HTTPException(404, "Job card not found")
    if (job.spec_snapshot or {}).get("entry_model") != "V2":
        raise HTTPException(409, "Surplus settlement requires a continuous-entry job card")
    stages = {s.stage_type: s for s in db.query(JobCardStage).filter_by(job_card_id=job.id).with_for_update().all()}
    stage = stages.get("DISPATCH")
    if not stage:
        raise HTTPException(409, "Dispatch stage is missing")
    # exclude_none keeps the hash of a settlement made before reason codes the same on its replay.
    fingerprint = hashlib.sha256(json.dumps(payload.model_dump(exclude_none=True), sort_keys=True).encode()).hexdigest()
    prior = (stage.actuals_snapshot or {}).get("surplus_settlement")
    if prior:
        if prior.get("request_id") != payload.request_id or prior.get("request_hash") != fingerprint:
            raise HTTPException(409, "Surplus has already been settled with another command")
        return prior
    if job.status in {"COMPLETED", "CANCELLED"}:
        raise HTTPException(409, "This job card is already closed")
    if box_rules.box_mode(db, job):
        return _retain_boxes(db, job, stages, stage, payload, fingerprint, user)
    if any(not stages.get(name) or stages[name].status != "COMPLETED" for name in ("PACKING", "QC")):
        raise HTTPException(409, "Close Packing and final QC before retaining surplus")
    if _active_hold_count(db, job.id):
        raise HTTPException(409, "Resolve the QC hold before retaining surplus")
    packing = db.query(PackingRecord).filter_by(job_card_id=job.id).first()
    if not packing or not (packing.snapshot or {}).get("inventory_batch_id"):
        raise HTTPException(409, "Wait for finished-goods inventory posting")
    drafts = db.query(Dispatch).filter_by(job_card_id=job.id, status="DRAFT").all()
    if any((d.dispatch_snapshot or {}).get("orchestration_state") in {"PENDING", "FAILED"} for d in drafts):
        raise HTTPException(409, "Recover the unfinished shipment before retaining surplus")
    shipped = sum(float((d.dispatch_snapshot or {}).get("dispatch_qty") or (d.dispatch_snapshot or {}).get("qty") or 0)
                  for d in db.query(Dispatch).filter_by(job_card_id=job.id, status="SEALED").all())
    packed = float(packing.total_packed_qty or 0)
    accepted_fg = dispatchable_quantity(job,packing,stages.get("QC"))
    target = shipping_allowance(job,accepted_fg,stage)
    remaining = max(0, accepted_fg - shipped)
    if accepted_fg <= target or shipped + 0.0001 < target:
        raise HTTPException(409, "Ship the released quantity before retaining only the excess production")
    if abs(remaining - payload.expected_remaining_qty) > 0.0001:
        raise HTTPException(409, "The remaining quantity changed; refresh and review the surplus")
    choice = _surplus_reason(payload, job, user)
    result = {"request_id": payload.request_id, "request_hash": fingerprint,
              "retained_qty": payload.expected_remaining_qty, "packed_qty": packed,"accepted_fg_qty":accepted_fg,
              "shipped_qty": shipped, **_reason_fields(choice),
              "inventory_batch_id": str(packing.snapshot["inventory_batch_id"]),
              "actor": str(user.get("sub") or user.get("id") or "unknown"),
              "settled_at": datetime.utcnow().isoformat()}
    # Only unposted drafts can be discarded; preserve their contents in the audit.
    discarded = [{"id": str(d.id), "snapshot": d.dispatch_snapshot} for d in drafts]
    for draft in drafts:
        db.delete(draft)
    stage.actuals_snapshot = {**(stage.actuals_snapshot or {}), "retained_fg_qty": result["retained_qty"],
                             "surplus_settlement": result, "row_version": int((stage.actuals_snapshot or {}).get("row_version", 1)) + 1,
                             "closed_at": result["settled_at"]}
    stage.status = "COMPLETED"
    stage.actual_end = datetime.utcnow()
    # Output remains actual shipped quantity; retained FG is a separate balance.
    stage.input_qty = shipped
    stage.output_qty = shipped
    job.status = "COMPLETED"
    job.current_stage = "DONE"
    db.add(AuditEvent(plant_id=job.plant_id, entity_type="job_card", entity_id=job.id,
                      job_card_id=job.id, action="SURPLUS_FG_RETAINED", actor_id=result["actor"],
                      actor_role=",".join(user.get("roles") or []), request_id=payload.request_id,
                      payload={**result, "discarded_unposted_drafts": discarded}))
    db.commit()
    return result


def _retain_boxes(db, job, stages, stage, payload, fingerprint, user):
    """Box card: the boxes left over once nothing more fits in the released quantity stay in stock (surplus).

    The released quantity not shipped (a box cannot be split) goes back to the order line, so Sales can
    release it again or short-close it, and the qty chain stays whole."""
    process = stages.get("PROCESS")
    if process is not None and process.status != "COMPLETED":
        raise HTTPException(409, "Close Process before keeping surplus boxes")
    if _active_hold_count(db, job.id):
        raise HTTPException(409, "Release the hold on this card before keeping surplus boxes")
    drafts = db.query(Dispatch).filter_by(job_card_id=job.id, status="DRAFT").all()
    if any((d.dispatch_snapshot or {}).get("orchestration_state") in {"PENDING", "FAILED"} for d in drafts):
        raise HTTPException(409, "Recover the unfinished shipment before keeping surplus boxes")
    shipped = sum(float((d.dispatch_snapshot or {}).get("dispatch_qty") or (d.dispatch_snapshot or {}).get("qty") or 0)
                  for d in db.query(Dispatch).filter_by(job_card_id=job.id, status="SEALED").all())
    left = [b for b in box_rules.card_boxes(db, job.id) if b.status == "PACKED"]
    if not left:
        raise HTTPException(409, "No packed box is left on this card")
    allowance = shipping_allowance(job, float(box_rules.boxed_pcs(db, job.id)), stage)
    room = max(0.0, allowance - shipped)
    unposted = [b for b in left if b.fg_status != "POSTED"]
    if unposted:
        raise HTTPException(409, f"Box {unposted[0].box_code} is not in stock yet. Wait for its stock posting (or retry it on the card's Dispatch tab), then decide the surplus.")
    fits = [b for b in left if b.qty <= room + 0.0001]
    if fits:
        raise HTTPException(409, f"Box {fits[0].box_code} ({fits[0].qty} pcs) still fits in the {room:g} pcs of released quantity left: ship it first")
    remaining = sum(b.qty for b in left)
    if abs(remaining - payload.expected_remaining_qty) > 0.0001:
        raise HTTPException(409, "The boxes left changed; refresh and review the surplus")
    choice = _surplus_reason(payload, job, user)
    now = datetime.utcnow()
    returned = int(room)
    result = {"request_id": payload.request_id, "request_hash": fingerprint, "retained_qty": remaining, "retained_boxes": [b.box_code for b in left],
              "shipped_qty": shipped, "returned_to_order_qty": returned, **_reason_fields(choice),
              "actor": str(user.get("sub") or user.get("id") or "unknown"), "settled_at": now.isoformat()}
    for box in left:
        box.status = "RETAINED"; box.row_version = int(box.row_version or 1) + 1
    for draft in drafts:
        db.delete(draft)
    if returned > 0:
        from ..short_close import current_released
        released_now = current_released(job)
        job.returned_qty = round(float(job.returned_qty or 0.0) + returned, 4)
        job.released_qty = round(max(0.0, released_now - returned), 4)
        if job.release_lot_id:
            key = f"{job.id}:DISPATCH:retain:1"
            db.add(CompletionEffect(job_card_id=job.id, effect_key=f"{key}:sales_return", kind="sales_return",
                                    payload={"stage": "DISPATCH", "plant_id": str(job.plant_id), "release_lot_id": str(job.release_lot_id), "job_card_id": str(job.id),
                                             "return_key": key, "qty": returned, "reason": f"Boxes kept as surplus: {choice.text}",
                                             "reason_code": choice.code, "reason_label": choice.label, "reason_note": choice.note}))
    stage.actuals_snapshot = {**(stage.actuals_snapshot or {}), "retained_fg_qty": remaining, "surplus_settlement": result,
                              "returned_pcs": returned, "row_version": int((stage.actuals_snapshot or {}).get("row_version", 1)) + 1, "closed_at": result["settled_at"]}
    stage.status = "COMPLETED"; stage.actual_end = now; stage.input_qty = shipped; stage.output_qty = shipped
    job.status = "COMPLETED"; job.current_stage = "DONE"
    db.add(AuditEvent(plant_id=job.plant_id, entity_type="job_card", entity_id=job.id, job_card_id=job.id, action="SURPLUS_FG_RETAINED",
                      actor_id=result["actor"], actor_role=",".join(user.get("roles") or []), request_id=payload.request_id, payload=result))
    db.commit()
    if returned > 0 and job.release_lot_id:
        try:
            from ..completion_worker import deliver_keys
            deliver_keys([f"{job.id}:DISPATCH:retain:1:sales_return"])
        except Exception:
            pass
    return result
