"""Audited settlement of excess FG without stock outward or Sales fulfillment."""
import hashlib
import json
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..card_lock import card_posting_lease
from ..database import get_db
from ..dispatch_quantities import dispatchable_quantity, shipping_allowance
from ..models import AuditEvent, Dispatch, JobCard, JobCardStage, PackingRecord
from ..utils.auth import get_current_plant, require_role
from .dispatch import _active_hold_count, _plant_uuid, _require_final_qc

router = APIRouter(prefix="/dispatch", tags=["dispatch"])


class RetainSurplusInput(BaseModel):
    request_id: str = Field(min_length=3, max_length=120)
    expected_remaining_qty: int = Field(gt=0, strict=True)
    reason: str = Field(min_length=5, max_length=2000)


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
    fingerprint = hashlib.sha256(json.dumps(payload.model_dump(), sort_keys=True).encode()).hexdigest()
    prior = (stage.actuals_snapshot or {}).get("surplus_settlement")
    if prior:
        if prior.get("request_id") != payload.request_id or prior.get("request_hash") != fingerprint:
            raise HTTPException(409, "Surplus has already been settled with another command")
        return prior
    if job.status in {"COMPLETED", "CANCELLED"}:
        raise HTTPException(409, "This job card is already closed")
    if any(not stages.get(name) or stages[name].status != "COMPLETED" for name in ("PACKING", "QC")):
        raise HTTPException(409, "Close Packing and final QC before retaining surplus")
    if _active_hold_count(db, job.id):
        raise HTTPException(409, "Resolve the QC hold before retaining surplus")
    _require_final_qc(db, job.plant_id, job)
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
    reason = payload.reason.strip()
    if len(reason) < 5:
        raise HTTPException(422, "Enter a reason for retaining the surplus")
    result = {"request_id": payload.request_id, "request_hash": fingerprint,
              "retained_qty": payload.expected_remaining_qty, "packed_qty": packed,"accepted_fg_qty":accepted_fg,
              "shipped_qty": shipped, "reason": reason,
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
