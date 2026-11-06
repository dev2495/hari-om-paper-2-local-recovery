"""Debit-note creation from purchase cases: the logic behind ``POST /inventory/procurement/debit-notes``.

Extracted (6 Nov 2026) so the weight check of a bill drafts its debit note through the very same rules as
a person does on Purchase › Invoice differences: open cases with a positive claim only, the supplier
invoice must be attached, one vendor per note, a DEBIT_NOTE reason code, idempotent by request id.
"""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import Optional, Sequence

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models import PurchaseDebitNote, PurchaseDebitNoteLine, PurchaseDiscrepancy
from ..reasons import ReasonChoice, resolve_reason


def create_debit_note(
    db: Session,
    *,
    plant_id: str,
    request_id: uuid.UUID,
    request_fingerprint: str,
    note_date: date,
    discrepancy_ids: Sequence[uuid.UUID],
    reason_code: Optional[str],
    reason_note: Optional[str],
    actor: str,
    token: Optional[str],
    choice: Optional[ReasonChoice] = None,
) -> tuple[PurchaseDebitNote, bool]:
    """Create a DRAFT debit note from open cases; returns (note, created). Flushes, never commits.

    A repeated ``request_id`` with the same fingerprint returns the saved note (created=False); with other
    details it is refused. ``choice`` skips the reason lookup when the caller already resolved it."""
    from ..routers.procurement import _discrepancy_payload  # the case view the route also uses
    from ..routers.purchase import _next_doc_no

    existing = db.query(PurchaseDebitNote).filter(PurchaseDebitNote.plant_id == plant_id, PurchaseDebitNote.request_id == request_id).first()
    if existing:
        if existing.request_fingerprint != request_fingerprint:
            raise HTTPException(status_code=409, detail="This debit-note request key already exists with different details")
        return existing, False
    if choice is None:
        choice = resolve_reason(category="DEBIT_NOTE", code=reason_code, note=reason_note, plant_id=plant_id,
                                token=token, what="the debit note")
    rows = db.query(PurchaseDiscrepancy).filter(PurchaseDiscrepancy.plant_id == plant_id, PurchaseDiscrepancy.id.in_(list(discrepancy_ids))).with_for_update().all()
    if len(rows) != len(set(discrepancy_ids)):
        raise HTTPException(status_code=404, detail="One or more discrepancies were not found")
    if any(row.claimable_amount <= 0 or row.status not in {"OPEN", "UNDER_REVIEW"} for row in rows):
        raise HTTPException(status_code=409, detail="Only open positive claim amounts can create a debit note")
    source = [_discrepancy_payload(row, db) for row in rows]
    if any(row["invoice_pending"] for row in source):
        raise HTTPException(status_code=409, detail="A debit note needs the supplier invoice. Attach the invoice to the GRN first; the rate case stays open.")
    supplier_ids = {row["supplier_id"] for row in source}
    if len(supplier_ids) != 1:
        raise HTTPException(status_code=422, detail="A debit note cannot mix vendors")
    note = PurchaseDebitNote(plant_id=plant_id, request_id=request_id, request_fingerprint=request_fingerprint,
        debit_note_no=_next_doc_no(db, PurchaseDebitNote, plant_id, "debit_note_no", "DN"),
        supplier_id=uuid.UUID(next(iter(supplier_ids))), supplier_name_snapshot=source[0]["supplier_name"],
        note_date=note_date, reason=choice.text, status="DRAFT",
        reason_code=choice.code, reason_label=choice.label, reason_note=choice.note,
        total_amount=sum((row.claimable_amount for row in rows), Decimal("0")), created_by=actor)
    db.add(note)
    db.flush()
    for row in rows:
        db.add(PurchaseDebitNoteLine(debit_note_id=note.id, discrepancy_id=row.id, claimed_amount=row.claimable_amount))
        row.status = "CLAIM_DRAFTED"
        row.version += 1
    db.flush()
    return note, True
