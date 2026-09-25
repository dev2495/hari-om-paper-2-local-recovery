"""Staged purchase-workbook preview/commit.

A SEP-style planning sheet is not stock. Preview must flag date/sheet
mismatch, blank pending (never coerced to zero), and unknown units.
Confirmed commit is idempotent on a stable fingerprint and never invents
GRN/stock from a planning worksheet.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import date, datetime
from typing import Any, Optional
import uuid

from sqlalchemy.orm import Session

from ..models import PurchaseWorkbookImport, StockTransaction


KNOWN_UNITS = {"KG", "PCS"}
SHEET_MONTHS = {
    "JAN": 1,
    "FEB": 2,
    "MAR": 3,
    "APR": 4,
    "MAY": 5,
    "JUN": 6,
    "JUL": 7,
    "AUG": 8,
    "SEP": 9,
    "SEPT": 9,
    "OCT": 10,
    "NOV": 11,
    "DEC": 12,
}
UNIT_ALIASES = {
    "KGS": "KG",
    "KILO": "KG",
    "KILOS": "KG",
    "PC": "PCS",
    "PCS": "PCS",
}


def _sheet_month(sheet_name: str) -> Optional[int]:
    token = str(sheet_name or "").strip().upper().replace(".", " ")
    first = token.split()[0] if token else ""
    return SHEET_MONTHS.get(first)


def _parse_date(value: Any) -> Optional[date]:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _normalize_unit(value: Any) -> tuple[Optional[str], str]:
    raw = str(value or "").strip()
    compact = re.sub(r"[.\s]", "", raw).upper()
    if not compact:
        return None, ""
    mapped = UNIT_ALIASES.get(compact, compact)
    if mapped in KNOWN_UNITS:
        return mapped, mapped
    return None, raw


def _pending_blank(row: dict[str, Any]) -> bool:
    if "pending" not in row:
        return True
    value = row.get("pending")
    return value in (None, "")


def _finite_qty(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def _jsonable(value: Any) -> Any:
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value


def _canonical_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    canonical: list[dict[str, Any]] = []
    for row in rows or []:
        item = dict(row or {})
        for key in ("item_id", "supplier_id"):
            if item.get(key) not in (None, ""):
                item[key] = str(item[key])
        if item.get("date") not in (None, ""):
            parsed = _parse_date(item.get("date"))
            item["date"] = parsed.isoformat() if parsed else str(item.get("date"))
        canonical.append(item)
    return canonical


def source_fingerprint(plant_id: str, source_name: str, rows: list[dict[str, Any]]) -> str:
    blob = json.dumps(
        {"plant_id": plant_id, "source_name": source_name, "rows": _canonical_rows(rows)},
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def preview_workbook(*, sheet_name: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    flags: list[dict[str, Any]] = []
    annotated: list[dict[str, Any]] = []
    expected_month = _sheet_month(sheet_name)
    for index, raw in enumerate(rows or []):
        row = dict(raw or {})
        parsed_date = _parse_date(row.get("date"))
        unit, unit_raw = _normalize_unit(row.get("unit"))
        record_type = str(row.get("record_type") or "PLANNING").strip().upper() or "PLANNING"
        pending_blank = _pending_blank(row)
        qty = _finite_qty(row.get("qty"))
        row_flags: list[str] = []
        if parsed_date is not None and expected_month is not None and parsed_date.month != expected_month:
            row_flags.append("DATE_SHEET_MISMATCH")
            flags.append(
                {
                    "code": "DATE_SHEET_MISMATCH",
                    "row": index,
                    "message": (
                        f"Row date {parsed_date.isoformat()} is not a {sheet_name} month; "
                        "the sheet name is not used as the posting month."
                    ),
                }
            )
        if pending_blank:
            row_flags.append("BLANK_PENDING")
            flags.append(
                {
                    "code": "BLANK_PENDING",
                    "row": index,
                    "message": "Blank pending is not a zero commitment and is not posted.",
                }
            )
        if unit is None:
            row_flags.append("UNKNOWN_UNIT")
            flags.append(
                {
                    "code": "UNKNOWN_UNIT",
                    "row": index,
                    "message": f"Unit {unit_raw or '(blank)'} is not a known KG/PCS unit and is not invented.",
                }
            )
        postable = (
            record_type == "PO_COMMITMENT"
            and unit in KNOWN_UNITS
            and qty is not None
            and qty > 0
            and row.get("item_id") not in (None, "")
            and row.get("supplier_id") not in (None, "")
            and "DATE_SHEET_MISMATCH" not in row_flags
            and "UNKNOWN_UNIT" not in row_flags
        )
        if record_type != "PO_COMMITMENT":
            postable = False
        annotated.append(
            {
                "row": index,
                "record_type": record_type,
                "date": parsed_date.isoformat() if parsed_date else row.get("date"),
                "vendor": row.get("vendor"),
                "item_code": row.get("item_code"),
                "item_id": str(row["item_id"]) if row.get("item_id") not in (None, "") else None,
                "supplier_id": str(row["supplier_id"]) if row.get("supplier_id") not in (None, "") else None,
                "qty": qty,
                "unit": unit,
                "unit_raw": unit_raw or None,
                "pending_blank": pending_blank,
                "pending_treated_as_zero": False,
                "pending_qty": None if pending_blank else _finite_qty(row.get("pending")),
                "would_post_stock": False,
                "would_create_po": postable,
                "flags": row_flags,
            }
        )
    return {
        "sheet_name": sheet_name,
        "flags": flags,
        "rows": annotated,
        "would_post_stock": False,
        "ledger": False,
        "flag_codes": sorted({str(flag["code"]) for flag in flags}),
    }


def commit_workbook(
    db: Session,
    *,
    plant_id: str,
    source_name: str,
    sheet_name: str,
    rows: list[dict[str, Any]],
    current_user: dict,
    create_purchase_order,
    purchase_order_create_cls,
    purchase_order_line_create_cls,
) -> dict[str, Any]:
    fingerprint = source_fingerprint(plant_id, source_name, rows)
    existing = (
        db.query(PurchaseWorkbookImport)
        .filter(
            PurchaseWorkbookImport.plant_id == plant_id,
            PurchaseWorkbookImport.fingerprint == fingerprint,
        )
        .first()
    )
    preview = preview_workbook(sheet_name=sheet_name, rows=rows)
    stock_before = (
        db.query(StockTransaction)
        .filter(StockTransaction.plant_id == plant_id)
        .count()
    )
    if existing is not None:
        commit_json = dict(existing.commit_json or {})
        return {
            **preview,
            "idempotent": True,
            "import_id": str(existing.id),
            "fingerprint": fingerprint,
            "posted_po_ids": list(existing.posted_po_ids or []),
            "created_po_count": 0,
            "stock_posted": False,
            "ledger": False,
            "stock_delta": 0,
            "replay": commit_json,
        }

    posted_po_ids: list[str] = []
    created: list[dict[str, Any]] = []
    for row_index, (annotated, raw) in enumerate(zip(preview["rows"], rows or [])):
        if not annotated.get("would_create_po"):
            continue
        unit_cost = _finite_qty(raw.get("unit_cost"))
        if unit_cost is None or unit_cost < 0:
            unit_cost = 0.0
        payload = purchase_order_create_cls(
            po_no=None,
            # Stable per source row: a retried import replays the same PO instead of duplicating it.
            request_id=uuid.uuid5(uuid.NAMESPACE_URL, f"purchase-workbook:{fingerprint}:{row_index}"),
            supplier_id=uuid.UUID(str(raw["supplier_id"])),
            supplier_name=str(raw.get("vendor") or "Workbook vendor").strip() or "Workbook vendor",
            notes=f"workbook:{source_name}",
            metadata_json={"workbook_source": source_name, "workbook_sheet": sheet_name},
            lines=[
                purchase_order_line_create_cls(
                    item_id=uuid.UUID(str(raw["item_id"])),
                    qty_ordered=float(annotated["qty"]),
                    unit_cost=float(unit_cost),
                    incoming_qc_required=True,
                    notes=str(raw.get("notes") or "") or None,
                )
            ],
        )
        created_order = create_purchase_order(
            payload,
            db=db,
            plant_id=plant_id,
            current_user=current_user,
        )
        po_id = str(created_order["id"] if isinstance(created_order, dict) else created_order.id)
        posted_po_ids.append(po_id)
        created.append(_jsonable(created_order if isinstance(created_order, dict) else {"id": po_id}))

    stock_after = (
        db.query(StockTransaction)
        .filter(StockTransaction.plant_id == plant_id)
        .count()
    )
    record = PurchaseWorkbookImport(
        plant_id=plant_id,
        source_name=source_name,
        sheet_name=sheet_name,
        fingerprint=fingerprint,
        preview_json=_jsonable(preview),
        commit_json=_jsonable({"posted_po_ids": posted_po_ids, "created": created}),
        posted_po_ids=posted_po_ids,
        ledger_posted=False,
        created_by=str(
            current_user.get("actor_identity")
            or current_user.get("actual_sub")
            or current_user.get("sub")
            or "system"
        ),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    if stock_after != stock_before:
        raise RuntimeError("Workbook commit must not post stock")
    return {
        **preview,
        "idempotent": False,
        "import_id": str(record.id),
        "fingerprint": fingerprint,
        "posted_po_ids": posted_po_ids,
        "created_po_count": len(posted_po_ids),
        "stock_posted": False,
        "ledger": False,
        "stock_delta": stock_after - stock_before,
    }


FORBIDDEN_DEFAULT_ISSUERS = {
    "hari om",
    "hari om paper",
    "hari om paper conversion",
    "hariom",
}


def resolve_po_issuer(metadata: Optional[dict[str, Any]]) -> dict[str, Any]:
    meta = dict(metadata or {})
    explicit = str(meta.get("legal_entity") or meta.get("legal_name") or "").strip()
    if explicit:
        return {
            "issuer_name": explicit,
            "issuer_status": "CONFIRMED",
            "print_blocked": False,
            "hardcoded_hari_om": False,
        }
    return {
        "issuer_name": None,
        "issuer_status": "UNRESOLVED",
        "print_blocked": True,
        "hardcoded_hari_om": False,
        "detail": "PO issuer is unresolved; Hari Om is not invented as letterhead.",
    }


def assert_issuer_not_fabricated(payload: dict[str, Any]) -> None:
    name = str(payload.get("issuer_name") or "").strip().lower()
    if payload.get("issuer_status") == "UNRESOLVED" and name in FORBIDDEN_DEFAULT_ISSUERS:
        raise AssertionError("Unresolved PO print must not invent Hari Om as issuer")
