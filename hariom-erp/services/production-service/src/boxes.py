"""Boxes: the packed, labelled, dispatchable unit of finished tubes (client decision 2026-11-01).

Process good pcs (QC readings done; QC only flags) are packed into boxes of the spec's qty per box as
they are logged. Leftover pcs wait for the next run; at Process close the remainder becomes a part box.
Every box is posted to stock as its own FG batch (named by the box code) through the completion outbox,
carries its packing-material theory, and is shipped whole on a challan."""
from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Any, Callable, Iterable, Optional

from sqlalchemy import func

from .entry_models import CompletionEffect, FgBox, StageEntry
from .models import JobCard, PackingRecord

OPEN_BOX = "PACKED"


def _positive_int(value: Any) -> Optional[int]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or number <= 0:
        return None
    return int(round(number))


def _float(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return number if math.isfinite(number) and number > 0 else 0.0


def qty_per_box(job: JobCard) -> Optional[int]:
    return _positive_int((job.spec_snapshot or {}).get("qty_per_box"))


def card_token(job: JobCard) -> str:
    token = re.sub(r"[^A-Z0-9]", "", str(job.job_card_no or "").upper())
    return token or str(job.id).replace("-", "")[:8].upper()


def box_code_for(job: JobCard, seq: int) -> str:
    return f"B{card_token(job)}-{seq:03d}"


def card_boxes(db, job_id, *, statuses: Optional[Iterable[str]] = None) -> list[FgBox]:
    query = db.query(FgBox).filter(FgBox.job_card_id == job_id)
    if statuses:
        query = query.filter(FgBox.status.in_(list(statuses)))
    return query.order_by(FgBox.seq_no).all()


def legacy_fg_posted(db, job: JobCard) -> bool:
    """FG of this card was posted the old way (one card-level inward at Process / Packing close)."""
    delivered = db.query(CompletionEffect.id).filter(CompletionEffect.job_card_id == job.id, CompletionEffect.kind == "fg_inward", CompletionEffect.status == "DELIVERED").first()
    if delivered:
        return True
    packing = db.query(PackingRecord).filter(PackingRecord.job_card_id == job.id).first()
    return bool(packing and (packing.snapshot or {}).get("inventory_batch_id"))


def box_mode(db, job: JobCard) -> bool:
    """Batch-entry cards pack boxes; cards whose FG was already posted the old way keep that path."""
    if (getattr(job, "spec_snapshot", None) or {}).get("entry_model") != "V2":
        return False
    if db.query(FgBox.id).filter(FgBox.job_card_id == job.id).first():
        return True
    if legacy_fg_posted(db, job):
        return False
    # A card whose Process (or Packing / Final QC) closed before boxes existed finishes the old way (one FG inward).
    from .models import JobCardStage
    closed = db.query(JobCardStage.id).filter(JobCardStage.job_card_id == job.id, JobCardStage.stage_type.in_(["PROCESS", "PACKING", "QC"]), JobCardStage.status == "COMPLETED").first()
    return closed is None


def boxed_pcs(db, job_id) -> int:
    return int(db.query(func.coalesce(func.sum(FgBox.qty), 0)).filter(FgBox.job_card_id == job_id, FgBox.status != "VOID").scalar() or 0)


def allocated_by_entry(boxes: Iterable[FgBox]) -> dict[str, int]:
    out: dict[str, int] = {}
    for box in boxes:
        if box.status == "VOID":
            continue
        for row in box.allocations or []:
            key = str(row.get("entry_id"))
            out[key] = out.get(key, 0) + int(row.get("pcs") or 0)
    return out


def box_packaging(job: JobCard, masters: Optional[dict[str, dict[str, Any]]] = None) -> dict[str, Any]:
    """Theory packing material in ONE box, from the spec and the Packaging masters' weights.

    Never drops a line silently: a line that cannot be counted (no SKU, no weight for a kg item)
    is kept with a warning so month-end and the card can show it."""
    snap = job.spec_snapshot or {}
    masters = masters or {}
    warnings: list[str] = []
    box_code = str(snap.get("box_code") or snap.get("box") or "").strip()
    lines: list[dict[str, Any]] = []
    if box_code:
        weight = _float(snap.get("box_unit_weight_kg")) or _float((masters.get(box_code.upper()) or {}).get("weight_kg"))
        lines.append({"kind": "BOX", "code": box_code, "pcs": 1, "unit_weight_kg": weight or None})
    else:
        warnings.append("The spec has no box code, so no box is counted for this box.")
    for kind, label in (("plastic", "Plastic sheet"), ("fadda", "Fadda")):
        per_box = _float(snap.get(f"{kind}_per_box"))
        sku = str(snap.get(f"{kind}_sku") or "").strip()
        if per_box <= 0 and not sku:
            continue
        if not sku:
            warnings.append(f"{label}: {per_box:g} per box on the spec but no {label.lower()} picked from the Packaging master.")
            continue
        if per_box <= 0:
            warnings.append(f"{label} {sku}: no count per box on the spec.")
            continue
        weight = _float(snap.get(f"{kind}_unit_weight_kg")) or _float((masters.get(sku.upper()) or {}).get("weight_kg"))
        if not weight:
            warnings.append(f"{label} {sku}: no unit weight on the spec or the Packaging master, so kg cannot be worked out.")
        lines.append({"kind": kind.upper(), "code": sku, "pcs": per_box, "unit_weight_kg": weight or None,
                      "weight_kg": round(per_box * weight, 4) if weight else None})
    return {"lines": lines, "warnings": warnings, "qty_per_box": qty_per_box(job)}


def card_packaging_totals(boxes: Iterable[FgBox]) -> dict[str, Any]:
    """Packing material of all a card's live boxes, summed per code (for theory and the challan)."""
    totals: dict[str, dict[str, Any]] = {}
    warnings: list[str] = []
    count = 0
    for box in boxes:
        if box.status == "VOID":
            continue
        count += 1
        packaging = box.packaging or {}
        for line in packaging.get("lines") or []:
            code = str(line.get("code") or "").strip().upper()
            if not code:
                continue
            row = totals.setdefault(code, {"kind": line.get("kind"), "code": code, "pcs": 0.0, "unit_weight_kg": line.get("unit_weight_kg")})
            row["pcs"] = round(float(row["pcs"]) + float(line.get("pcs") or 0), 4)
            if not row.get("unit_weight_kg") and line.get("unit_weight_kg"):
                row["unit_weight_kg"] = line.get("unit_weight_kg")
        for warning in packaging.get("warnings") or []:
            if warning not in warnings:
                warnings.append(warning)
    return {"box_count": count, "lines": list(totals.values()), "warnings": warnings}


def pack_boxes(db, job: JobCard, user: dict, *, cleared_ids: set, flags_for: Callable[[StageEntry], list], final: bool = False,
               masters: Optional[dict[str, dict[str, Any]]] = None, force: bool = False) -> list[FgBox]:
    """Pack QC-cleared Process good pcs not yet in a box. ``final`` (Process close) packs the rest as a part box."""
    if not force and not box_mode(db, job):
        return []
    runs = db.query(StageEntry).filter(StageEntry.job_card_id == job.id, StageEntry.stage == "PROCESS", StageEntry.status == "SUBMITTED", StageEntry.kind != "QC_ONLY").order_by(StageEntry.entry_no).all()
    existing = card_boxes(db, job.id)
    used = allocated_by_entry(existing)
    pool = [[e, int(e.accepted or 0) - used.get(str(e.id), 0)] for e in runs if (final or e.id in cleared_ids)]
    pool = [row for row in pool if row[1] > 0]
    size = qty_per_box(job)
    seq = max((b.seq_no for b in existing), default=0)
    created: list[FgBox] = []
    packaging = box_packaging(job, masters)

    def take(qty: int, part: bool) -> None:
        nonlocal seq
        allocations = []
        need = qty
        last = None
        for row in pool:
            if need <= 0:
                break
            if row[1] <= 0:
                continue
            pcs = min(need, row[1])
            row[1] -= pcs
            need -= pcs
            last = row[0]
            allocations.append({"entry_id": str(row[0].id), "entry_no": row[0].entry_no, "pcs": pcs})
        seq += 1
        flags = []
        for alloc in allocations:
            entry = next((e for e in runs if str(e.id) == alloc["entry_id"]), None)
            for flag in (flags_for(entry) if entry is not None else []):
                flags.append({**flag, "entry_no": alloc["entry_no"]})
        box_packaging_row = dict(packaging)
        if part and not size:
            box_packaging_row = {**packaging, "warnings": list(packaging.get("warnings") or []) + ["The spec has no qty per box: all pcs went into one part box."]}
        box = FgBox(plant_id=job.plant_id, job_card_id=job.id, seq_no=seq, box_code=box_code_for(job, seq), qty=qty, qty_per_box=size,
                    is_part=part, box_master_code=str((job.spec_snapshot or {}).get("box_code") or "") or None, status=OPEN_BOX,
                    allocations=allocations, business_date=getattr(last, "business_date", None), shift_code=getattr(last, "shift_code", None),
                    operator_name=getattr(last, "operator_name", None), machine_id=getattr(last, "machine_id", None),
                    qc_flagged=bool(flags), qc_flags=flags, packaging=box_packaging_row, fg_status="PENDING",
                    packed_by=user.get("sub"), packed_at=datetime.utcnow())
        db.add(box)
        db.flush()
        created.append(box)
        for kind in ("fg_box", "box_theory"):
            key = f"{job.id}:BOX:{box.id}:{kind}"
            db.add(CompletionEffect(job_card_id=job.id, effect_key=key, kind=kind, payload={"stage": "PROCESS", "plant_id": str(job.plant_id), "box_id": str(box.id)}))

    if size:
        while sum(row[1] for row in pool) >= size:
            take(size, False)
    if final:
        rest = sum(row[1] for row in pool)
        if rest > 0:
            take(rest, True)
    if created:
        db.flush()
    return created


def refresh_box_flags(db, job: JobCard, flags_for: Callable[[StageEntry], list]) -> None:
    """QC readings added or corrected after packing: the box shows the runs' current flags."""
    boxes = card_boxes(db, job.id, statuses=[OPEN_BOX])
    if not boxes:
        return
    entries = {str(e.id): e for e in db.query(StageEntry).filter(StageEntry.job_card_id == job.id, StageEntry.stage == "PROCESS").all()}
    for box in boxes:
        flags = []
        for alloc in box.allocations or []:
            entry = entries.get(str(alloc.get("entry_id")))
            for flag in (flags_for(entry) if entry is not None else []):
                flags.append({**flag, "entry_no": alloc.get("entry_no")})
        if flags != (box.qc_flags or []):
            box.qc_flags = flags
            box.qc_flagged = bool(flags)


def box_dict(box: FgBox, job: Optional[JobCard] = None) -> dict[str, Any]:
    row = {
        "id": str(box.id), "job_card_id": str(box.job_card_id), "seq_no": box.seq_no, "box_code": box.box_code, "qty": box.qty,
        "qty_per_box": box.qty_per_box, "is_part": bool(box.is_part), "box_master_code": box.box_master_code, "status": box.status,
        "allocations": box.allocations or [], "business_date": box.business_date, "shift_code": box.shift_code,
        "operator_name": box.operator_name, "machine_id": str(box.machine_id) if box.machine_id else None,
        "qc_flagged": bool(box.qc_flagged), "qc_flags": box.qc_flags or [], "packaging": box.packaging or {},
        "fg_status": box.fg_status, "inventory_batch_id": str(box.inventory_batch_id) if box.inventory_batch_id else None,
        "dispatch_id": str(box.dispatch_id) if box.dispatch_id else None, "dispatched_at": box.dispatched_at,
        "label_prints": int(box.label_prints or 0), "last_printed_at": box.last_printed_at, "packed_at": box.packed_at, "packed_by": box.packed_by,
    }
    if job is not None:
        row.update(label_fields(job))
    return row


def _tube_size(snap: dict) -> Optional[str]:
    """"76.4 x 81 x 150 mm" from the frozen spec when the order line carries no size label."""
    parts = []
    for key in ("id_avg_mm", "od_avg_mm", "design_length_mm"):
        value = _float(snap.get(key))
        if not value:
            return None
        parts.append(f"{value:g}")
    return " x ".join(parts) + " mm"


def label_fields(job: JobCard) -> dict[str, Any]:
    snap = job.spec_snapshot or {}
    return {
        "job_card_no": job.job_card_no,
        "customer": snap.get("customer_name_snapshot") or snap.get("customer_name"),
        "product_code": snap.get("product_code") or snap.get("sales_order_line_product_code"),
        "spec_reference": snap.get("spec_reference"),
        "size_label": snap.get("sales_order_line_size_label") or _tube_size(snap),
        "colour": job.parchment_color or snap.get("sales_order_line_parchment_color") or snap.get("parchment_color"),
        "sales_order_no": snap.get("sales_order_order_no"),
        "customer_po": snap.get("sales_order_po_number"),
        "sales_order_id": str(job.sales_order_id) if job.sales_order_id else None,
        "plant_id": str(job.plant_id),
    }


def box_summary(db, job: JobCard) -> dict[str, Any]:
    boxes = card_boxes(db, job.id)
    live = [b for b in boxes if b.status != "VOID"]
    packed = [b for b in live if b.status == OPEN_BOX]
    return {
        "box_mode": box_mode(db, job),
        "qty_per_box": qty_per_box(job),
        "box_count": len(live),
        "boxed_pcs": sum(b.qty for b in live),
        "packed_boxes": len(packed),
        "packed_pcs": sum(b.qty for b in packed),
        "ready_boxes": sum(1 for b in packed if b.fg_status == "POSTED"),
        "ready_pcs": sum(b.qty for b in packed if b.fg_status == "POSTED"),
        "dispatched_boxes": sum(1 for b in live if b.status == "DISPATCHED"),
        "dispatched_pcs": sum(b.qty for b in live if b.status == "DISPATCHED"),
        "retained_boxes": sum(1 for b in live if b.status == "RETAINED"),
        "retained_pcs": sum(b.qty for b in live if b.status == "RETAINED"),
        "part_boxes": sum(1 for b in live if b.is_part),
        "flagged_boxes": sum(1 for b in live if b.qc_flagged),
        "fg_failed_boxes": sum(1 for b in live if b.fg_status == "FAILED"),
    }
