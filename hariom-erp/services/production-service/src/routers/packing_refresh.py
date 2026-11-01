"""Push a spec's packing amendment into open job cards (Packing setup, owner decision 5, 1 Nov 2026).

Packing is frozen into ``job_cards.spec_snapshot`` at release. When the Owner/Admin fixes a live spec's
packing on the Packing setup page, open cards of that spec that have not packed any box yet take the new
box / qty per box / plastic / fadda, so their boxes, labels, challan and packing theory use it. Cards that
already packed a box keep what they packed with (changing it would split one card over two box sizes).
Each updated card gets an audit row that the card history shows ("Packing updated from spec").
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import inspect as sa_inspect, text
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AuditEvent, JobCard, JobCardStage, PackingRecord
from ..utils.auth import get_current_plant, require_role

router = APIRouter(tags=["packing refresh"])

CLOSED_CARD_STATUSES = ("COMPLETED", "CANCELLED")
# Raw spec values (as the spec stores them) that this endpoint copies into the snapshot.
PACKING_VALUE_KEYS = (
    "box_code",
    "box_size",
    "box_unit_weight_kg",
    "qty_per_box",
    "plastic_required",
    "plastic_sku",
    "plastic_size",
    "plastic_unit_weight_kg",
    "plastic_weight_per_box_kg",
    "plastic_per_box",
    "fadda_sku",
    "fadda_unit_weight_kg",
    "fadda_weight_per_box_kg",
    "fadda_per_box",
)
# Box tables that, when present, also count as "packed a box" (the per-box FG build adds fg_boxes).
BOX_TABLE_CANDIDATES = ("job_card_boxes", "fg_boxes", "packed_boxes", "production_boxes")


class PackingRefreshInput(BaseModel):
    spec_ids: list[uuid.UUID] = Field(min_length=1, max_length=200)
    values: dict[str, Any]
    source: dict[str, Any] = Field(default_factory=dict)
    dry_run: bool = False


def _display_bool(value: Any) -> str:
    text_value = str(value if value is not None else "").strip().lower()
    if text_value in {"true", "1", "yes", "y"}:
        return "Yes"
    if text_value in {"false", "0", "no", "n"}:
        return "No"
    return str(value or "")


def _clean(value: Any) -> Any:
    return None if value in (None, "") else value


def packing_snapshot_patch(values: dict[str, Any]) -> dict[str, Any]:
    """The flat snapshot keys a released card carries for packing (same names as release builds)."""
    patch = {key: _clean(values.get(key)) for key in PACKING_VALUE_KEYS}
    patch["box"] = patch["box_code"]
    patch["plastic_required"] = _display_bool(values.get("plastic_required"))
    return patch


def _packing_instructions(snapshot: dict[str, Any]) -> str:
    """Plain packing line for the card print, rebuilt from the patched snapshot."""
    parts: list[str] = []
    for key, label in (("bundle_type", "Bundle"), ("bundle_code", "Bundle Code"), ("packing_ply", "Packing Ply"), ("qty_per_box", "Qty/Box"), ("packing_pcs", "Packing Pcs")):
        if snapshot.get(key):
            parts.append(f"{label} {snapshot[key]}")
    if snapshot.get("box_code"):
        parts.append(f"Box {snapshot['box_code']}")
    if snapshot.get("box_size"):
        parts.append(f"Box Size {snapshot['box_size']}")
    if snapshot.get("plastic_required") == "Yes":
        parts.append(f"Plastic Yes ({snapshot.get('plastic_sku') or 'SKU pending'})")
    if snapshot.get("plastic_per_box") and snapshot.get("plastic_sku"):
        parts.append(f"Plastic/Box {snapshot['plastic_per_box']}")
    if snapshot.get("fadda_sku"):
        parts.append(f"Fadda {snapshot['fadda_sku']}")
        if snapshot.get("fadda_per_box"):
            parts.append(f"Fadda/Box {snapshot['fadda_per_box']}")
    if str(snapshot.get("bopp_required") or "") == "Yes":
        parts.append("BOPP Yes")
    if snapshot.get("special_instructions"):
        parts.append(str(snapshot["special_instructions"]))
    return " | ".join(parts)


def _packed_card_ids(db: Session, card_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    """Cards that already packed something, with the reason they keep their packing."""
    if not card_ids:
        return {}
    packed: dict[uuid.UUID, str] = {}
    for record in db.query(PackingRecord).filter(PackingRecord.job_card_id.in_(card_ids)).all():
        if float(record.total_packed_qty or 0) > 0 or int(record.bundle_count or 0) > 0:
            packed.setdefault(record.job_card_id, "already packed pieces")
    for stage in db.query(JobCardStage).filter(JobCardStage.job_card_id.in_(card_ids), JobCardStage.stage_type == "PACKING", JobCardStage.status == "COMPLETED").all():
        packed.setdefault(stage.job_card_id, "packing is closed")
    inspector = sa_inspect(db.get_bind())
    for table in BOX_TABLE_CANDIDATES:
        if not inspector.has_table(table):
            continue
        columns = {column["name"] for column in inspector.get_columns(table)}
        if "job_card_id" not in columns:
            continue
        live = " AND status <> 'VOID'" if "status" in columns else ""  # a voided box was never packed
        rows = db.execute(text(f"SELECT DISTINCT job_card_id FROM {table} WHERE job_card_id = ANY(:ids){live}"), {"ids": card_ids}).all()
        for (card_id,) in rows:
            packed.setdefault(card_id if isinstance(card_id, uuid.UUID) else uuid.UUID(str(card_id)), "boxes already packed")
    return packed


@router.post("/job-cards/packing-refresh")
def refresh_packing_in_open_cards(
    payload: PackingRefreshInput,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    user: dict = Depends(require_role(["Owner", "Admin"])),
):
    if not str(payload.values.get("box_code") or "").strip():
        raise HTTPException(422, "The packing to push has no box.")
    plant = uuid.UUID(str(plant_id))
    cards = (
        db.query(JobCard)
        .filter(JobCard.plant_id == plant, JobCard.spec_id.in_(payload.spec_ids), JobCard.status.notin_(CLOSED_CARD_STATUSES))
        .order_by(JobCard.created_at.asc())
        .with_for_update()
        .all()
    )
    packed = _packed_card_ids(db, [card.id for card in cards])
    patch = packing_snapshot_patch(payload.values)
    updated: list[dict[str, Any]] = []
    unchanged: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for card in cards:
        if card.id in packed:
            skipped.append({"id": str(card.id), "job_card_no": card.job_card_no, "reason": packed[card.id]})
            continue
        before_snapshot = dict(card.spec_snapshot or {})
        after_snapshot = {**before_snapshot, **patch}
        after_snapshot["packing_instructions"] = _packing_instructions(after_snapshot)
        before = {key: before_snapshot.get(key) for key in patch}
        after = {key: after_snapshot.get(key) for key in patch}
        if before == after:
            unchanged.append({"id": str(card.id), "job_card_no": card.job_card_no})
            continue
        updated.append({"id": str(card.id), "job_card_no": card.job_card_no})
        if payload.dry_run:
            continue
        after_snapshot["packing_amendment"] = {**payload.source, "applied_by": user.get("sub")}
        card.spec_snapshot = after_snapshot
        summary = payload.source.get("summary") or f"Box {patch['box_code']} × {patch['qty_per_box']} pcs"
        db.add(AuditEvent(
            plant_id=card.plant_id,
            entity_type="job_card",
            entity_id=card.id,
            job_card_id=card.id,
            action="packing_updated_from_spec",
            actor_id=user.get("sub"),
            actor_role=",".join(user.get("roles") or []),
            request_id=str(payload.source.get("amendment_id") or "")[:120] or None,
            payload={"reason": f"Packing set on the spec (Packing setup): {summary}", "before": before, "after": after, "source": payload.source},
        ))
    if payload.dry_run:
        db.rollback()
    else:
        db.commit()
    return {
        "updated": len(updated),
        "updated_cards": updated,
        "unchanged": len(unchanged),
        "skipped_packed": len(skipped),
        "skipped_cards": skipped,
        "open_cards": len(cards),
        "dry_run": payload.dry_run,
    }
