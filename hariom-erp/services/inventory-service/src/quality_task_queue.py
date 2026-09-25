"""Durable incoming-QC tasks (QCT-026).

A receipt writes one task per held lot into ``audit_outbox`` in the same
transaction as the restricted stock. The supervised audit relay delivers it as
an in-app notification to QC users of the plant and then records it in the audit
log; failures stay pending and retry, and the auth service dedupes by event id.
The outbox row (``delivered_at``) is the delivery state.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

EVENT_TYPE = "INCOMING_QC_TASK_DELIVERY"


def enqueue_incoming_qc_task(
    db: Session,
    *,
    plant_id: str,
    receipt_id: str,
    batch_id: Optional[str] = None,
    reel_id: Optional[str] = None,
    grn_no: str,
    po_no: Optional[str] = None,
    stock_status: str = "QC_HOLD",
) -> str:
    """Queue one incoming-QC task for one held lot: a bulk batch or a paper reel."""
    if bool(batch_id) == bool(reel_id):
        raise ValueError("an incoming QC task needs exactly one batch_id or reel_id")
    lot_ref = {"batch_id": str(batch_id)} if batch_id else {"reel_id": str(reel_id)}
    lot_kind = "Batch" if batch_id else "Paper reel"
    event_id = str(uuid.uuid4())
    occurred = datetime.utcnow()
    body = {
        "id": event_id,
        "occurred_at": occurred.isoformat(),
        "source_service": "inventory-service",
        "event_type": EVENT_TYPE,
        "entity_type": "purchase_receipt",
        "entity_id": str(receipt_id),
        "plant_id": str(plant_id),
        "summary": f"Incoming QC task for GRN {grn_no}",
        "payload": {
            "receipt_id": str(receipt_id),
            **lot_ref,
            "grn_no": grn_no,
            "po_no": po_no,
            "stock_status": stock_status,
        },
        # Fan-out request for the relay; stripped before the audit record is written.
        "notify": {
            "title": f"Incoming QC: GRN {grn_no}",
            "message": f"{lot_kind} received on GRN {grn_no}{f' (PO {po_no})' if po_no else ''} is held until incoming QC.",
            "href": "/quality/incoming",
            "recipient_roles": ["QC"],
            "role_context": "QC",
        },
    }
    db.execute(
        text(
            "INSERT INTO audit_outbox (id, occurred_at, body, delivered_at, attempts) "
            "VALUES (:id, :occurred_at, :body, NULL, 0)"
        ),
        {
            "id": event_id,
            "occurred_at": occurred,
            "body": json.dumps(body, default=str),
        },
    )
    return event_id
