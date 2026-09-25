#!/usr/bin/env python3
"""Conservative Procurement V2 legacy audit and backfill.

Dry-run is the default.  ``--apply`` creates revision snapshots only from
stored PO facts, links legacy receipt lines to those exact source lines, and
advances document counters past recognizable historic numbers.  It never
creates stock, invoices, approvals, receipts, labels or claims.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re
import sys
import uuid


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "inventory-service"))

from src.database import SessionLocal  # noqa: E402
from src.models import (  # noqa: E402
    DocumentSeries,
    PurchaseOrder,
    PurchaseOrderRevision,
    PurchaseOrderRevisionLine,
    PurchaseReceiptLine,
)


SERIES_RE = re.compile(r"^(RP-PM|OT)/(\d+)$", re.IGNORECASE)


def _json_default(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, (Decimal, uuid.UUID)):
        return str(value)
    raise TypeError(type(value).__name__)


def _hash(payload: dict) -> str:
    body = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=_json_default)
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def _approval_state(order: PurchaseOrder) -> str:
    if order.status == "SUBMITTED":
        return "SUBMITTED"
    if order.status == "REJECTED":
        return "REJECTED"
    if order.status in {"APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "SHORT_CLOSED"}:
        return "APPROVED"
    if order.status == "CANCELLED" and (order.approved_by or order.receipts):
        return "APPROVED"
    return "DRAFT"


def _snapshot(order: PurchaseOrder) -> dict:
    return {
        "po_no": order.po_no,
        "category": order.category,
        "supplier_id": str(order.supplier_id),
        "supplier_name": order.supplier_name_snapshot,
        "expected_date": order.expected_date.isoformat() if order.expected_date else None,
        "notes": order.notes,
        "metadata": dict(order.metadata_json or {}),
        "migration_evidence": {
            "source": "LEGACY_PURCHASE_ORDER_STORED_FACTS",
            "approval_actor_available": bool(order.approved_by),
            "approval_time_available": bool(order.approved_at),
            "limitations": "No approval fact is inferred when the legacy record did not store it.",
        },
        "lines": [{
            "logical_line_id": str(line.logical_line_id),
            "source_order_line_id": str(line.id),
            "item_id": str(line.item_id),
            "qty_ordered": str(line.qty_ordered),
            "unit_rate": str(line.unit_cost),
            "uom": line.uom,
            "expected_unit_count": line.expected_unit_count,
            "count_basis": line.count_basis,
            "specification": dict(line.metadata_json or {}),
        } for line in order.lines or []],
    }


def run(*, apply: bool) -> dict:
    db = SessionLocal()
    report = {
        "mode": "apply" if apply else "dry-run",
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "orders_scanned": 0,
        "orders_already_versioned": 0,
        "revisions_to_create": 0,
        "revision_lines_to_create": 0,
        "receipt_lines_to_link": 0,
        "receipt_lines_already_linked": 0,
        "series": [],
        "warnings": [],
        "before": {},
        "after": {},
    }
    try:
        orders = db.query(PurchaseOrder).order_by(PurchaseOrder.plant_id, PurchaseOrder.po_no).all()
        report["orders_scanned"] = len(orders)
        report["before"] = {
            "ordered_qty": str(sum(Decimal(str(line.qty_ordered or 0)) for order in orders for line in order.lines or [])),
            "received_qty": str(sum(Decimal(str(line.qty_received or 0)) for order in orders for line in order.lines or [])),
            "receipt_line_qty": str(sum(Decimal(str(line.qty_received or 0)) for line in db.query(PurchaseReceiptLine).all())),
        }

        observed: dict[tuple[str, str], int] = defaultdict(int)
        for order in orders:
            match = SERIES_RE.match(str(order.po_no or "").strip())
            if match:
                prefix, number = match.groups()
                category = "RM_PM" if prefix.upper() == "RP-PM" else "OT"
                observed[(str(order.plant_id), category)] = max(observed[(str(order.plant_id), category)], int(number))
            elif order.po_no:
                report["warnings"].append({"po_id": str(order.id), "po_no": order.po_no, "issue": "legacy number does not match RP-PM/n or OT/n; retained unchanged"})

            existing = db.query(PurchaseOrderRevision).filter(
                PurchaseOrderRevision.purchase_order_id == order.id,
            ).first()
            if existing:
                report["orders_already_versioned"] += 1
                continue
            if not order.lines:
                report["warnings"].append({"po_id": str(order.id), "po_no": order.po_no, "issue": "no stored lines; revision not created"})
                continue

            report["revisions_to_create"] += 1
            report["revision_lines_to_create"] += len(order.lines)
            if not apply:
                report["receipt_lines_to_link"] += sum(len(receipt.lines or []) for receipt in order.receipts or [])
                continue

            snapshot = _snapshot(order)
            request_id = uuid.uuid5(uuid.NAMESPACE_URL, f"hariom:procurement-v2:{order.id}:revision:1")
            revision = PurchaseOrderRevision(
                purchase_order_id=order.id,
                revision_no=1,
                request_id=request_id,
                approval_state=_approval_state(order),
                content_hash=_hash(snapshot),
                snapshot_json=snapshot,
                change_reason="MIGRATED_FROM_LEGACY_STORED_FACTS",
                created_by=order.created_by or "LEGACY_SOURCE_UNCONFIRMED",
                submitted_by=order.submitted_by,
                submitted_at=order.submitted_at,
                approved_by=order.approved_by,
                approved_at=order.approved_at,
            )
            db.add(revision)
            db.flush()
            by_source = {}
            for line in order.lines:
                revision_line = PurchaseOrderRevisionLine(
                    revision_id=revision.id,
                    logical_line_id=line.logical_line_id,
                    source_order_line_id=line.id,
                    item_id=line.item_id,
                    qty_ordered=line.qty_ordered,
                    unit_rate=line.unit_cost,
                    uom=line.uom or "KG",
                    expected_unit_count=line.expected_unit_count,
                    count_basis=line.count_basis,
                    specification_json=dict(line.metadata_json or {}),
                    delivery_date=order.expected_date,
                )
                db.add(revision_line)
                db.flush()
                by_source[line.id] = revision_line
            order.current_revision_no = 1
            for receipt in order.receipts or []:
                for receipt_line in receipt.lines or []:
                    if receipt_line.approved_revision_line_id:
                        report["receipt_lines_already_linked"] += 1
                        continue
                    revision_line = by_source.get(receipt_line.purchase_order_line_id)
                    if not revision_line:
                        report["warnings"].append({"receipt_line_id": str(receipt_line.id), "issue": "receipt line has no exact source PO line; left unlinked"})
                        continue
                    receipt_line.approved_revision_line_id = revision_line.id
                    receipt_line.po_rate = receipt_line.po_rate if receipt_line.po_rate is not None else revision_line.unit_rate
                    receipt_line.tracking_mode = getattr(getattr(receipt_line.item, "tracking_mode", None), "value", None) or "BULK"
                    report["receipt_lines_to_link"] += 1

        for (plant_id, category), highest in sorted(observed.items()):
            prefix = "RP-PM" if category == "RM_PM" else "OT"
            required_next = highest + 1
            current = db.query(DocumentSeries).filter_by(
                plant_id=plant_id, document_type="PURCHASE_ORDER", category=category,
            ).with_for_update().first()
            current_next = int(current.next_value) if current else None
            report["series"].append({
                "plant_id": plant_id, "category": category, "prefix": prefix,
                "highest_observed": highest, "current_next": current_next, "required_next": required_next,
                "action": "advance" if current_next is None or current_next < required_next else "unchanged",
            })
            if apply:
                if not current:
                    db.add(DocumentSeries(plant_id=plant_id, document_type="PURCHASE_ORDER", category=category,
                                          prefix=prefix, next_value=required_next, active=True))
                elif current.next_value < required_next:
                    current.next_value = required_next
                    current.version += 1

        report["after"] = dict(report["before"])
        if apply:
            db.commit()
        else:
            db.rollback()
        return report
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit/backfill legacy POs for governed Procurement V2")
    parser.add_argument("--apply", action="store_true", help="persist the conservative revision and linkage backfill")
    parser.add_argument("--output", type=Path, help="write the JSON report to this path")
    args = parser.parse_args()
    report = run(apply=args.apply)
    rendered = json.dumps(report, indent=2, sort_keys=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)


if __name__ == "__main__":
    main()
