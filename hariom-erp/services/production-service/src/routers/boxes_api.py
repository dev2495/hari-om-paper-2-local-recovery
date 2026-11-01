"""Box pages, box labels and the card's boxes (owner decision 2, 2026-11-01)."""
import re
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import boxes as box_rules
from ..database import get_db
from ..entry_models import FgBox
from ..models import Dispatch, JobCard
from ..utils.auth import get_current_plant, get_current_user
from . import planning

router = APIRouter(tags=["boxes"])


def _card(db: Session, card_id, plant: str) -> JobCard:
    job = db.query(JobCard).filter_by(id=card_id, plant_id=planning._to_uuid(plant)).first()
    if not job:
        raise HTTPException(404, "Job card not found")
    return job


def _challan(db: Session, box: FgBox) -> dict:
    if not box.dispatch_id:
        return {}
    row = db.get(Dispatch, box.dispatch_id)
    snap = (row.dispatch_snapshot or {}) if row else {}
    return {"challan_no": snap.get("challan_no") or snap.get("dispatch_ref"), "challan_date": snap.get("date"), "dispatch_id": str(box.dispatch_id)}


@router.get("/job-cards/{card_id}/boxes")
def list_card_boxes(card_id: uuid.UUID, db: Session = Depends(get_db), plant: str = Depends(get_current_plant), user: dict = Depends(get_current_user)):
    job = _card(db, card_id, plant)
    rows = box_rules.card_boxes(db, job.id)
    totals = box_rules.card_packaging_totals(rows)
    return {"summary": box_rules.box_summary(db, job), "packaging": totals, "boxes": [{**box_rules.box_dict(b), **_challan(db, b)} for b in rows], **box_rules.label_fields(job),
            "spec_packing": {k: (job.spec_snapshot or {}).get(k) for k in ("box_code", "box_size", "qty_per_box", "plastic_sku", "plastic_per_box", "fadda_sku", "fadda_per_box")}}


def find_box(db: Session, box_code: str, plant: str):
    """The box with this code in the plant. A code typed loosely (any case, spaces, no dash: ``b261102007``)
    finds the box when exactly one box of the plant has those letters and digits (issue #10)."""
    typed = str(box_code or "").strip().upper()
    plant_id = planning._to_uuid(plant)
    box = db.query(FgBox).filter(FgBox.box_code == typed, FgBox.plant_id == plant_id).first()
    if box is not None:
        return box
    compact = re.sub(r"[^A-Z0-9]", "", typed)
    if len(compact) < 5 or not compact.startswith("B"):
        return None
    rows = db.query(FgBox).filter(FgBox.plant_id == plant_id, func.regexp_replace(FgBox.box_code, "[^A-Z0-9]", "", "g") == compact).limit(2).all()
    return rows[0] if len(rows) == 1 else None


@router.get("/boxes/by-code/{box_code}")
def box_page(box_code: str, db: Session = Depends(get_db), plant: str = Depends(get_current_plant), user: dict = Depends(get_current_user)):
    box = find_box(db, box_code, plant)
    if not box:
        raise HTTPException(404, f"No box {box_code} in this plant")
    job = db.get(JobCard, box.job_card_id)
    return {**box_rules.box_dict(box, job), **_challan(db, box), "card_summary": box_rules.box_summary(db, job)}


@router.get("/boxes/labels")
def box_labels(job_card_id: uuid.UUID | None = None, codes: str | None = Query(None, max_length=4000), db: Session = Depends(get_db),
               plant: str = Depends(get_current_plant), user: dict = Depends(get_current_user)):
    """Boxes to print: a card's boxes, or the boxes named in ``codes`` (comma separated)."""
    query = db.query(FgBox).filter(FgBox.plant_id == planning._to_uuid(plant), FgBox.status != "VOID")
    if job_card_id:
        query = query.filter(FgBox.job_card_id == job_card_id)
    elif codes:
        wanted = [c.strip().upper() for c in codes.split(",") if c.strip()]
        query = query.filter(FgBox.box_code.in_(wanted))
    else:
        raise HTTPException(422, "Choose a job card or box codes to print")
    rows = query.order_by(FgBox.job_card_id, FgBox.seq_no).limit(500).all()
    cards = {j.id: j for j in db.query(JobCard).filter(JobCard.id.in_({b.job_card_id for b in rows})).all()} if rows else {}
    return [box_rules.box_dict(b, cards.get(b.job_card_id)) for b in rows]


class LabelsPrinted(BaseModel):
    model_config = ConfigDict(extra="forbid")
    box_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


@router.post("/boxes/labels/printed")
def labels_printed(payload: LabelsPrinted, db: Session = Depends(get_db), plant: str = Depends(get_current_plant), user: dict = Depends(get_current_user)):
    """Count a label print or reprint on each box (audit only: a reprint never creates stock)."""
    rows = db.query(FgBox).filter(FgBox.id.in_(payload.box_ids), FgBox.plant_id == planning._to_uuid(plant)).all()
    now = datetime.utcnow()
    by_card: dict = {}
    for box in rows:
        box.label_prints = int(box.label_prints or 0) + 1
        box.last_printed_at = now
        by_card.setdefault(box.job_card_id, []).append({"box_code": box.box_code, "print_no": box.label_prints})
    for card_id, printed in by_card.items():
        planning._record_audit_event(db=db, plant_id=planning._to_uuid(plant), entity_type="job_card", entity_id=card_id, action="box_labels_printed",
                                     actor_id=user.get("sub"), actor_role=",".join(user.get("roles", [])), job_card_id=card_id,
                                     payload={"boxes": printed, "reprint": any(p["print_no"] > 1 for p in printed)})
    db.commit()
    return {"printed": len(rows)}
