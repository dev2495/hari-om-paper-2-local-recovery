from __future__ import annotations

import os
import urllib.parse
import uuid
from datetime import date
from typing import Any

from ..models import ItemMaster, PaperReel, StockBatch


def _enum_value(value: Any) -> str:
    return str(getattr(value, "value", value) or "")


def scan_url(qr_value: str | None) -> str | None:
    """Link printed in a lot or tool QR so the phone camera opens the app (client 2026-10-27).

    The app's /scan page reads the wrapped qr_value and sends the user to the right page for
    their role. qr_value itself stays the lot's identity; in-app scanners read both forms.
    None when PUBLIC_APP_ORIGIN is not set, so the label falls back to the plain qr_value.
    Worked out when a label is drawn, never kept in the lot payloads: those are saved as label
    snapshots at receipt, and a saved link would keep an old site address.
    """
    origin = os.getenv("PUBLIC_APP_ORIGIN", "").strip().rstrip("/")
    if not origin or not qr_value:
        return None
    return f"{origin}/scan?c={urllib.parse.quote(str(qr_value), safe='')}"


# Reel / coil label (client 2026-10-30): what a person reads on the label. GSM, BF and polybond come from the
# reel's incoming QC readings (the average of its samples) when QC has measured them, otherwise from the PO line
# or the material master, marked "(spec)". A value nobody gave stays blank, never 0. The QR is not touched.
LABEL_QC_KEYS = (("gsm", ("gsm",)), ("bf", ("bf",)), ("ply_bond", ("ply_bond", "plybond")))
FACT_ORDER = ("item", "gsm", "bf", "ply_bond", "width_mm", "weight_kg", "vendor", "received_date", "reel_no")
FACT_LABELS = {
    "item": "Item", "gsm": "GSM", "bf": "BF", "ply_bond": "Polybond", "width_mm": "Width mm", "weight_kg": "Weight kg",
    "vendor": "Vendor", "received_date": "Received", "reel_no": "Reel no",
}


def _positive(value: Any) -> float | None:
    """A usable measurement: a finite number above 0 (0 / blank / text mean "not given")."""
    if value in (None, "") or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")) or number <= 0:
        return None
    return number


def _number_text(value: float) -> str:
    rounded = round(float(value), 2)
    return f"{rounded:,.2f}".rstrip("0").rstrip(".") if rounded != int(rounded) else f"{int(rounded):,}"


def _readings_average(inspections: list[Any], keys: tuple[str, ...]) -> tuple[float | None, int]:
    """Mean of every numeric sample of one check across the reel's incoming inspections (a value may be one
    reading or a list of samples). Invalid inspections are left out."""
    samples: list[float] = []
    for inspection in inspections:
        if str(getattr(inspection, "status", "") or "").upper() == "INVALID":
            continue
        readings = getattr(inspection, "readings", None) or {}
        for key in keys:
            raw = readings.get(key)
            values = raw if isinstance(raw, (list, tuple)) else [raw]
            found = [number for number in (_positive(value) for value in values) if number is not None]
            if found:
                samples.extend(found)
                break
    return (sum(samples) / len(samples), len(samples)) if samples else (None, 0)


def _label_day(value: Any) -> str:
    if isinstance(value, date):
        return f"{value.day:02d} {value.strftime('%b %Y')}"
    raw = str(value or "").strip()
    try:
        parsed = date.fromisoformat(raw[:10])
    except ValueError:
        return raw
    return f"{parsed.day:02d} {parsed.strftime('%b %Y')}"


def reel_label_facts(db, reel: PaperReel, item: ItemMaster | None = None, *, vendor: str | None = None,
                     received: date | None = None) -> dict[str, Any]:
    """The human-readable lines of a reel / coil label, worked out when it is printed (new labels and reprints).

    Returns ``{"facts": {key: text}, "fact_sources": {key: "QC" | "SPEC" | None}, "fact_labels": {...},
    "fact_order": [...]}``. Texts are "" when unknown; spec values carry " (spec)".
    """
    from ..models import InventoryQualityInspection, PurchaseOrderLine

    resolved_item = item or getattr(reel, "paper", None)
    metadata = getattr(reel, "inward_metadata", None) or {}
    snapshot = metadata.get("paper_master_snapshot") or {}
    nominals = (getattr(resolved_item, "qc_nominals", None) or {}) if resolved_item is not None else {}
    line_spec: dict[str, Any] = {}
    line_id = metadata.get("po_line_id")
    if line_id and db is not None:
        try:
            line = db.get(PurchaseOrderLine, uuid.UUID(str(line_id)))
        except (TypeError, ValueError):
            line = None
        line_spec = dict(getattr(line, "metadata_json", None) or {}) if line is not None else {}

    inspections: list[Any] = []
    if db is not None:
        owners = [reel.id] + ([reel.parent_reel_id] if getattr(reel, "parent_reel_id", None) else [])
        for owner in owners:
            inspections = db.query(InventoryQualityInspection).filter(
                InventoryQualityInspection.entity_type == "REEL", InventoryQualityInspection.entity_id == owner,
                InventoryQualityInspection.source == "INWARD",
            ).order_by(InventoryQualityInspection.created_at.asc()).all()
            if inspections:
                break  # a concession child reel was measured as its parent

    facts: dict[str, str] = {}
    sources: dict[str, str | None] = {}
    for key, aliases in LABEL_QC_KEYS:
        measured, count = _readings_average(inspections, aliases)
        if measured is not None:
            facts[key], sources[key] = _number_text(measured), "QC"
            continue
        spec = None
        for source in (line_spec, snapshot, nominals):
            for alias in aliases:
                spec = _positive(source.get(alias))
                if spec is not None:
                    break
            if spec is not None:
                break
        if spec is None and key == "gsm":
            spec = _positive(getattr(reel, "gsm", None))
        if spec is None and key == "bf" and not line_id:
            # A PO-linked reel's bf column may hold the PO polybond (older receipts); only trust it off-PO.
            spec = _positive(getattr(reel, "bf", None))
        facts[key], sources[key] = (f"{_number_text(spec)} (spec)", "SPEC") if spec is not None else ("", None)

    width = _positive(getattr(reel, "width_mm", None))
    weight = _positive(getattr(reel, "inward_weight_kg", None)) or _positive(getattr(reel, "net_weight_kg", None))
    item_code = getattr(resolved_item, "item_code", None) or ""
    item_name = getattr(resolved_item, "name", None) or ""
    facts.update({
        "item": " · ".join(part for part in (item_code, item_name) if part),
        "width_mm": _number_text(width) if width is not None else "",
        "weight_kg": _number_text(weight) if weight is not None else "",
        "vendor": str(vendor or reel.supplier_name_snapshot or reel.supplier_name or metadata.get("vendor_name") or "").strip(),
        "received_date": _label_day(received or reel.inward_date) if (received or reel.inward_date) else "",
        "reel_no": str(getattr(reel, "source_reel_no", None) or metadata.get("source_reel_no") or "").strip(),
    })
    for key in ("item", "width_mm", "weight_kg", "vendor", "received_date", "reel_no"):
        sources[key] = "RECEIPT" if facts[key] else None
    return {"facts": facts, "fact_sources": sources, "fact_labels": dict(FACT_LABELS), "fact_order": list(FACT_ORDER)}


def with_reel_facts(db, label: dict[str, Any] | None, reel: PaperReel | None, item: ItemMaster | None = None, **kwargs: Any) -> dict[str, Any] | None:
    """A saved label snapshot with today's facts added (the snapshot itself, and its QR, stay as saved)."""
    if label is None or reel is None:
        return label
    return {**label, **reel_label_facts(db, reel, item, **kwargs)}


def batch_label_payload(batch: StockBatch, item: ItemMaster | None = None, *, inward_date: date | None = None) -> dict[str, Any]:
    resolved_item = item or getattr(batch, "item", None)
    item_code = getattr(resolved_item, "item_code", None) or ""
    item_name = getattr(resolved_item, "name", None) or ""
    uom = _enum_value(getattr(resolved_item, "uom", ""))
    metadata = getattr(batch, "inward_metadata", None) or {}
    amigo_no = str(metadata.get("amigo_no") or batch.batch_no or "").strip().upper()
    qr_value = f"HARIOM|BATCH|{batch.plant_id}|{batch.id}|{amigo_no}"
    if inward_date is None:
        # A reprint (GET /labels/batches/{id}) passes no date: use the one saved at receipt, or the go-live
        # date of an opening-stock lot, so the label never loses its inward date.
        saved = metadata.get("saved_label") if isinstance(metadata.get("saved_label"), dict) else {}
        known = saved.get("inward_date") or metadata.get("go_live_date")
        try:
            inward_date = date.fromisoformat(str(known)[:10]) if known else None
        except ValueError:
            inward_date = None
    return {
        "entity_type": "BATCH",
        "entity_id": str(batch.id),
        "code": amigo_no,
        "amigo_no": amigo_no,
        "batch_no": batch.batch_no,
        "human_label": amigo_no,
        "plant_id": str(batch.plant_id),
        "item_id": str(batch.item_id),
        "item_code": item_code,
        "item_name": item_name,
        "uom": uom,
        "qty": round(float(batch.received_qty or 0.0), 3),
        "stock_status": batch.stock_status,
        "supplier_name": batch.supplier_name_snapshot,
        "location_id": str(batch.location_id) if batch.location_id else None,
        "inward_date": inward_date.isoformat() if inward_date else None,
        "po_no": metadata.get("po_no"),
        "grn_no": metadata.get("grn_no"),
        "challan_no": metadata.get("challan_no"),
        "bill_no": metadata.get("bill_no"),
        "bill_date": metadata.get("bill_date"),
        "rate": metadata.get("rate"),
        "location_code": metadata.get("location_code"),
        "metadata": metadata,
        "qr_value": qr_value,
        "print_url": f"/inventory/labels/batch/{batch.id}",
    }


def reel_label_payload(reel: PaperReel, item: ItemMaster | None = None) -> dict[str, Any]:
    resolved_item = item or getattr(reel, "paper", None)
    item_code = getattr(resolved_item, "item_code", None) or ""
    item_name = getattr(resolved_item, "name", None) or ""
    metadata = getattr(reel, "inward_metadata", None) or {}
    quality_snapshot = metadata.get("paper_master_snapshot") or {}
    amigo_no = str(metadata.get("amigo_no") or reel.reel_code or "").strip().upper()
    qr_value = f"HARIOM|REEL|{reel.plant_id}|{reel.id}|{amigo_no}"
    return {
        "entity_type": "REEL",
        "entity_id": str(reel.id),
        "code": amigo_no,
        "amigo_no": amigo_no,
        "reel_code": reel.reel_code,
        "human_label": amigo_no,
        "plant_id": str(reel.plant_id),
        "item_id": str(reel.paper_id),
        "item_code": item_code,
        "item_name": item_name,
        "width_mm": getattr(reel, "width_mm", None),
        "physical_form": getattr(reel, "physical_form", None),
        "gsm": reel.gsm,
        "bf": reel.bf,
        "ply_bond": quality_snapshot.get("ply_bond") or metadata.get("plybond"),
        "bulk_factor": quality_snapshot.get("bulk_factor") or metadata.get("bulk_factor"),
        "variety": quality_snapshot.get("variety") or metadata.get("variety"),
        "qty": round(float(reel.current_weight_kg or 0.0), 3),
        "inward_qty": round(float(reel.inward_weight_kg or 0.0), 3),
        "uom": "KG",
        "stock_status": reel.stock_status,
        "supplier_name": reel.supplier_name_snapshot or reel.supplier_name,
        "location_id": str(reel.location_id) if reel.location_id else None,
        "inward_date": reel.inward_date.isoformat() if reel.inward_date else None,
        "po_no": metadata.get("po_no"),
        "grn_no": metadata.get("grn_no"),
        "challan_no": metadata.get("challan_no"),
        "bill_no": metadata.get("bill_no"),
        "bill_date": metadata.get("bill_date"),
        "rate": metadata.get("rate"),
        "source_reel_no": getattr(reel, "source_reel_no", None) or metadata.get("source_reel_no"),
        "location_code": metadata.get("location_code"),
        "metadata": metadata,
        "qr_value": qr_value,
        "print_url": f"/inventory/labels/reel/{reel.id}",
    }
