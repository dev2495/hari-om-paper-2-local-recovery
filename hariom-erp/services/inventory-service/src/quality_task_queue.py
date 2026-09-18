"""Durable incoming-QC task delivery queue (QCT-026).

GRN commit writes the task intent into ``audit_outbox`` in the same
transaction as the restricted receipt. Delivery can fail after commit; retry
replays undelivered rows once per event id.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any, Callable, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

EVENT_TYPE = "INCOMING_QC_TASK_DELIVERY"


def enqueue_incoming_qc_task(
    db: Session,
    *,
    plant_id: str,
    receipt_id: str,
    batch_id: str,
    grn_no: str,
    po_no: str,
) -> str:
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
            "batch_id": str(batch_id),
            "grn_no": grn_no,
            "po_no": po_no,
            "stock_status": "QC_HOLD",
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


def list_pending_incoming_qc_tasks(db: Session) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            "SELECT id, body, attempts FROM audit_outbox "
            "WHERE delivered_at IS NULL AND body LIKE :needle "
            "ORDER BY occurred_at ASC"
        ),
        {"needle": f"%{EVENT_TYPE}%"},
    ).mappings().all()
    pending = []
    for row in rows:
        try:
            body = json.loads(row["body"])
        except (TypeError, ValueError):
            continue
        if body.get("event_type") != EVENT_TYPE:
            continue
        pending.append({"id": row["id"], "body": body, "attempts": int(row["attempts"] or 0)})
    return pending


def retry_incoming_qc_task_deliveries(
    db: Session,
    *,
    deliver: Callable[[dict[str, Any]], None],
    limit: int = 50,
) -> dict[str, Any]:
    """Deliver undelivered incoming-QC tasks. Failures stay pending and increment attempts."""
    pending = list_pending_incoming_qc_tasks(db)[: max(1, int(limit))]
    delivered_ids: list[str] = []
    failed_ids: list[str] = []
    for item in pending:
        event_id = item["id"]
        try:
            deliver(item["body"])
        except Exception:
            db.execute(
                text("UPDATE audit_outbox SET attempts = attempts + 1 WHERE id = :id AND delivered_at IS NULL"),
                {"id": event_id},
            )
            failed_ids.append(event_id)
            continue
        updated = db.execute(
            text(
                "UPDATE audit_outbox SET delivered_at = :now, attempts = attempts + 1 "
                "WHERE id = :id AND delivered_at IS NULL"
            ),
            {"id": event_id, "now": datetime.utcnow()},
        )
        if getattr(updated, "rowcount", 1):
            delivered_ids.append(event_id)
    return {
        "pending_before": len(pending),
        "delivered_ids": delivered_ids,
        "failed_ids": failed_ids,
        "delivered": len(delivered_ids),
        "failed": len(failed_ids),
    }
