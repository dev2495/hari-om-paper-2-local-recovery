from __future__ import annotations

from datetime import date
from typing import Any

from ..models import ItemMaster, PaperReel, StockBatch


def _enum_value(value: Any) -> str:
    return str(getattr(value, "value", value) or "")


def batch_label_payload(batch: StockBatch, item: ItemMaster | None = None, *, inward_date: date | None = None) -> dict[str, Any]:
    resolved_item = item or getattr(batch, "item", None)
    item_code = getattr(resolved_item, "item_code", None) or ""
    item_name = getattr(resolved_item, "name", None) or ""
    uom = _enum_value(getattr(resolved_item, "uom", ""))
    qr_value = f"HARIOM|BATCH|{batch.plant_id}|{batch.id}|{batch.batch_no}"
    return {
        "entity_type": "BATCH",
        "entity_id": str(batch.id),
        "code": batch.batch_no,
        "batch_no": batch.batch_no,
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
        "qr_value": qr_value,
        "print_url": f"/inventory/labels/batch/{batch.id}",
    }


def reel_label_payload(reel: PaperReel, item: ItemMaster | None = None) -> dict[str, Any]:
    resolved_item = item or getattr(reel, "paper", None)
    item_code = getattr(resolved_item, "item_code", None) or ""
    item_name = getattr(resolved_item, "name", None) or ""
    qr_value = f"HARIOM|REEL|{reel.plant_id}|{reel.id}|{reel.reel_code}"
    return {
        "entity_type": "REEL",
        "entity_id": str(reel.id),
        "code": reel.reel_code,
        "reel_code": reel.reel_code,
        "plant_id": str(reel.plant_id),
        "item_id": str(reel.paper_id),
        "item_code": item_code,
        "item_name": item_name,
        "gsm": reel.gsm,
        "bf": reel.bf,
        "qty": round(float(reel.current_weight_kg or 0.0), 3),
        "inward_qty": round(float(reel.inward_weight_kg or 0.0), 3),
        "uom": "KG",
        "stock_status": reel.stock_status,
        "supplier_name": reel.supplier_name_snapshot or reel.supplier_name,
        "location_id": str(reel.location_id) if reel.location_id else None,
        "inward_date": reel.inward_date.isoformat() if reel.inward_date else None,
        "qr_value": qr_value,
        "print_url": f"/inventory/labels/reel/{reel.id}",
    }
