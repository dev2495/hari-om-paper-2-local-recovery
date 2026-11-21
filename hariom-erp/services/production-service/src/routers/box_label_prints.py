"""Box labels before packing (client 2026-11-21).

Store, Planner and the plant supervisor print a job card's box stickers before the card is packed:
one label per box the release needs (released pcs / the spec's qty per box, rounded up) plus 5 spare,
numbered 1..N in series. Every label carries the box code packing will give that box
(``B<card>-<seq>``, see ``boxes.box_code_for``) in its QR, so a sticker scanned after packing opens
the real box. The lot number on a label is the job card number.

Every print is kept in ``box_label_prints`` (who, when, which serials). Printing a serial a second time
is a reprint: it needs a reason from the Reason codes master (LABEL_REPRINT) and is marked as such.
Printing never makes boxes or stock; it also counts the print on boxes already packed."""
from __future__ import annotations

import math
import os
import re
import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import boxes as box_rules
from ..database import get_db
from ..entry_models import BoxLabelPrint, FgBox
from ..models import JobCard
from ..reasons import resolve_reason
from ..utils.auth import get_current_plant, require_role
from . import planning

router = APIRouter(tags=["box-labels"])

SPARE_LABELS = 5
MAX_LABELS = 400
# Default rights (client 2026-11-21): Store, Planner and the plant supervisor; Owner and Admin always.
PRINT_ROLES = ["Store", "Planner", "PlantManager"]
CLOSED_STATUSES = ("COMPLETED", "CLOSED", "CANCELLED", "SHORT_CLOSED", "FORCE_CLOSED")
LABEL_SIZES = ("100x100", "a4-6")


def clean_colour(value: Any) -> str:
    """The colour without the supplier after " / " ("BLACK ZIG ZAG / SAGAR POLYFILMS" → "BLACK ZIG ZAG")."""
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text.split(" / ")[0].strip() if " / " in text else text


def _int(value: Any) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    return int(round(number)) if math.isfinite(number) and number > 0 else 0


def _card(db: Session, card_id: uuid.UUID, plant: str) -> JobCard:
    job = db.query(JobCard).filter_by(id=card_id, plant_id=planning._to_uuid(plant)).first()
    if not job:
        raise HTTPException(404, "Job card not found in this plant")
    return job


def _plan_numbers(job: JobCard, boxes: list[FgBox]) -> dict[str, Any]:
    released = _int(job.released_qty) or _int(job.planned_qty)
    per_box = box_rules.qty_per_box(job)
    planned = math.ceil(released / per_box) if per_box and released else 0
    packed_max = max((b.seq_no for b in boxes), default=0)
    total = min(MAX_LABELS, max(planned + SPARE_LABELS if planned else 0, packed_max))
    return {"released_qty": released, "qty_per_box": per_box, "planned_boxes": planned, "spare_labels": SPARE_LABELS if planned else 0,
            "labels_total": total}


def _printed_counts(prints: list[BoxLabelPrint]) -> dict[int, int]:
    counts: dict[int, int] = {}
    for row in prints:
        for seq in range(row.from_seq, row.to_seq + 1):
            counts[seq] = counts.get(seq, 0) + 1
    return counts


def _print_dict(row: BoxLabelPrint) -> dict[str, Any]:
    return {"id": str(row.id), "from_seq": row.from_seq, "to_seq": row.to_seq, "label_count": row.label_count, "is_reprint": bool(row.is_reprint),
            "reason_code": row.reason_code, "reason_note": row.reason_note, "label_size": row.label_size, "printed_by": row.printed_by,
            "printed_by_name": row.printed_by_name, "printed_at": row.printed_at, "planned_boxes": row.planned_boxes, "qty_per_box": row.qty_per_box}


def _card_header(job: JobCard) -> dict[str, Any]:
    fields = box_rules.label_fields(job)
    snap = job.spec_snapshot or {}
    return {**fields, "job_card_id": str(job.id), "lot_no": job.job_card_no, "colour": clean_colour(fields.get("colour")), "status": job.status,
            "current_stage": job.current_stage, "public_origin": os.getenv("PUBLIC_APP_ORIGIN", "").strip().rstrip("/"), "box_master_code": snap.get("box_code") or snap.get("box"), "denier": snap.get("denier") or ""}


def card_plan(db: Session, job: JobCard) -> dict[str, Any]:
    boxes = [b for b in box_rules.card_boxes(db, job.id) if b.status != "VOID"]
    by_seq = {b.seq_no: b for b in boxes}
    prints = db.query(BoxLabelPrint).filter(BoxLabelPrint.job_card_id == job.id).order_by(BoxLabelPrint.printed_at.desc()).all()
    counts = _printed_counts(prints)
    numbers = _plan_numbers(job, boxes)
    per_box, planned, released = numbers["qty_per_box"], numbers["planned_boxes"], numbers["released_qty"]
    labels = []
    for seq in range(1, numbers["labels_total"] + 1):
        box = by_seq.get(seq)
        if box is not None:
            qty, kind = box.qty, "PART" if box.is_part else "PACKED"
        elif seq < planned:
            qty, kind = per_box, "FULL"
        elif seq == planned:
            last = released - (planned - 1) * (per_box or 0)
            qty, kind = last, ("PART" if per_box and last < per_box else "FULL")
        else:
            qty, kind = None, "SPARE"
        labels.append({"seq": seq, "box_code": box_rules.box_code_for(job, seq), "qty": qty, "kind": kind, "printed": counts.get(seq, 0),
                       "box_status": box.status if box is not None else None})
    printed_serials = sum(1 for seq in range(1, numbers["labels_total"] + 1) if counts.get(seq))
    return {**_card_header(job), **numbers, "labels": labels, "printed_serials": printed_serials, "prints": [_print_dict(p) for p in prints],
            "boxes_packed": len(boxes), "missing_qty_per_box": not per_box}


@router.get("/box-labels/queue")
def label_queue(db: Session = Depends(get_db), plant: str = Depends(get_current_plant),
                user: dict = Depends(require_role(PRINT_ROLES))):
    """Every open job card of the plant with its label plan and print record, newest card first."""
    plant_id = planning._to_uuid(plant)
    cards = (db.query(JobCard).filter(JobCard.plant_id == plant_id, JobCard.status.notin_(CLOSED_STATUSES))
             .order_by(JobCard.created_at.desc()).limit(500).all())
    ids = [c.id for c in cards]
    prints: dict[Any, list[BoxLabelPrint]] = {}
    packed: dict[Any, tuple[int, int]] = {}
    if ids:
        for row in db.query(BoxLabelPrint).filter(BoxLabelPrint.job_card_id.in_(ids)).order_by(BoxLabelPrint.printed_at.desc()).all():
            prints.setdefault(row.job_card_id, []).append(row)
        for card_id, count, top in (db.query(FgBox.job_card_id, func.count(FgBox.id), func.max(FgBox.seq_no))
                                    .filter(FgBox.job_card_id.in_(ids), FgBox.status != "VOID").group_by(FgBox.job_card_id).all()):
            packed[card_id] = (int(count), int(top or 0))
    out = []
    for job in cards:
        rows = prints.get(job.id, [])
        count, top = packed.get(job.id, (0, 0))
        released = _int(job.released_qty) or _int(job.planned_qty)
        per_box = box_rules.qty_per_box(job)
        planned = math.ceil(released / per_box) if per_box and released else 0
        total = min(MAX_LABELS, max(planned + SPARE_LABELS if planned else 0, top))
        counts = _printed_counts(rows)
        last = rows[0] if rows else None
        out.append({**_card_header(job), "released_qty": released, "qty_per_box": per_box, "planned_boxes": planned,
                    "spare_labels": SPARE_LABELS if planned else 0, "labels_total": total, "missing_qty_per_box": not per_box,
                    "printed_serials": sum(1 for seq in range(1, total + 1) if counts.get(seq)), "print_count": len(rows),
                    "reprint_count": sum(1 for r in rows if r.is_reprint), "boxes_packed": count, "created_at": job.created_at,
                    "last_printed_at": last.printed_at if last else None, "last_printed_by": last.printed_by if last else None})
    return out


@router.get("/box-labels/cards/{card_id}")
def label_card(card_id: uuid.UUID, db: Session = Depends(get_db), plant: str = Depends(get_current_plant),
               user: dict = Depends(require_role(PRINT_ROLES))):
    return card_plan(db, _card(db, card_id, plant))


class LabelPrintIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    from_seq: int = Field(ge=1, le=MAX_LABELS)
    to_seq: int = Field(ge=1, le=MAX_LABELS)
    label_size: str = Field(default="100x100", max_length=20)
    reason_code: Optional[str] = Field(default=None, max_length=40)
    reason_note: Optional[str] = Field(default=None, max_length=300)


@router.post("/box-labels/cards/{card_id}/prints")
def record_print(card_id: uuid.UUID, payload: LabelPrintIn, db: Session = Depends(get_db), plant: str = Depends(get_current_plant),
                 user: dict = Depends(require_role(PRINT_ROLES))):
    """Record a print before the browser prints it. A serial printed before needs a reprint reason."""
    job = db.query(JobCard).filter_by(id=card_id, plant_id=planning._to_uuid(plant)).with_for_update().first()
    if not job:
        raise HTTPException(404, "Job card not found in this plant")
    if job.status in CLOSED_STATUSES:
        raise HTTPException(409, f"Job card {job.job_card_no or ''} is {str(job.status).lower().replace('_', ' ')}; its labels cannot be printed.")
    if payload.label_size not in LABEL_SIZES:
        raise HTTPException(422, "Choose the label size: 100 x 100 mm sticker or A4 sheet of 6.")
    plan = card_plan(db, job)
    if plan["missing_qty_per_box"]:
        raise HTTPException(409, "The spec has no qty per box, so the box count is not known. Fill the spec's packing (Specifications › Packing setup) first.")
    if payload.to_seq < payload.from_seq:
        raise HTTPException(422, "The last label number must not be smaller than the first.")
    if payload.to_seq > plan["labels_total"]:
        raise HTTPException(422, f"This card has {plan['labels_total']} labels ({plan['planned_boxes']} boxes + {plan['spare_labels']} spare). Choose numbers up to {plan['labels_total']}.")
    already = [row["seq"] for row in plan["labels"] if payload.from_seq <= row["seq"] <= payload.to_seq and row["printed"]]
    choice = None
    if already:
        choice = resolve_reason(category="LABEL_REPRINT", code=payload.reason_code, note=payload.reason_note, plant_id=plant,
                                token=user.get("token", ""), what=f"printing label{'s' if len(already) > 1 else ''} {_ranges(already)} again")
    now = datetime.utcnow()
    record = BoxLabelPrint(
        plant_id=job.plant_id, job_card_id=job.id, job_card_no=job.job_card_no, from_seq=payload.from_seq, to_seq=payload.to_seq,
        label_count=payload.to_seq - payload.from_seq + 1, planned_boxes=plan["planned_boxes"], spare_labels=plan["spare_labels"],
        qty_per_box=plan["qty_per_box"], released_qty=plan["released_qty"], is_reprint=bool(already),
        reason_code=choice.code if choice else None, reason_note=choice.note if choice else None, label_size=payload.label_size,
        printed_by=str(user.get("sub") or ""), printed_by_name=str(user.get("name") or user.get("full_name") or user.get("email") or user.get("sub") or ""),
        printed_by_roles=",".join(user.get("roles", [])), printed_at=now,
    )
    db.add(record)
    for box in db.query(FgBox).filter(FgBox.job_card_id == job.id, FgBox.seq_no >= payload.from_seq, FgBox.seq_no <= payload.to_seq,
                                      FgBox.status != "VOID").all():
        box.label_prints = int(box.label_prints or 0) + 1
        box.last_printed_at = now
    db.flush()
    planning._record_audit_event(
        db=db, plant_id=job.plant_id, entity_type="job_card", entity_id=job.id, action="box_labels_reprinted" if already else "box_labels_printed",
        actor_id=user.get("sub"), actor_role=",".join(user.get("roles", [])), job_card_id=job.id,
        payload={"from_seq": payload.from_seq, "to_seq": payload.to_seq, "labels": record.label_count, "reprinted": already,
                 "reason_code": record.reason_code, "reason_note": record.reason_note, "label_size": payload.label_size,
                 "print_id": str(record.id)},
    )
    db.commit()
    return {"print": _print_dict(record), "plan": card_plan(db, job)}


class DenierIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    denier: str = Field(default="", max_length=40)


@router.put("/job-cards/{card_id}/denier")
def set_denier(card_id: uuid.UUID, payload: DenierIn, db: Session = Depends(get_db), plant: str = Depends(get_current_plant),
               user: dict = Depends(require_role(["Planner", "PlantManager"]))):
    """Set or clear the card's denier after release (typed at release normally; optional)."""
    job = _card(db, card_id, plant)
    text = planning._clean_denier(payload.denier)
    snapshot = dict(job.spec_snapshot or {})
    before = str(snapshot.get("denier") or "")
    if text == before:
        return {"job_card_id": str(job.id), "denier": text, "changed": False}
    if text:
        snapshot["denier"] = text
    else:
        snapshot.pop("denier", None)
    job.spec_snapshot = snapshot
    planning._record_audit_event(
        db=db, plant_id=job.plant_id, entity_type="job_card", entity_id=job.id, action="denier_set", actor_id=user.get("sub"),
        actor_role=",".join(user.get("roles", [])), job_card_id=job.id, payload={"denier": text or None, "source": "card"},
        before_payload={"denier": before or None},
    )
    db.commit()
    return {"job_card_id": str(job.id), "denier": text, "changed": True}


def _ranges(seqs: list[int]) -> str:
    """[1, 2, 3, 7] → "1–3, 7"."""
    parts: list[str] = []
    start = prev = None
    for seq in sorted(seqs):
        if start is None:
            start = prev = seq
        elif seq == prev + 1:
            prev = seq
        else:
            parts.append(f"{start}–{prev}" if start != prev else str(start))
            start = prev = seq
    if start is not None:
        parts.append(f"{start}–{prev}" if start != prev else str(start))
    return ", ".join(parts)
