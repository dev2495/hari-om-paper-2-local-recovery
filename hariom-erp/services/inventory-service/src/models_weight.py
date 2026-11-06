"""Inward QC by bill and the bill weight check (6 Nov 2026).

Stock stays on the bill weight (owner decision, 6 Nov 2026). QC's scale weight is saved on the reel or lot
(``actual_qty``) and only drives the weight check of the bill: ``purchase_weight_variances`` holds one row per
bill (a GRN, or a supplier invoice that spans several GRNs). A shortage beyond the plant's limits becomes a
QUANTITY case in Purchase › Invoice differences and goes through the existing debit-note flow.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, CheckConstraint, Column, DateTime, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from .database import Base

VARIANCE_STATUSES = (
    "PROVISIONAL", "WITHIN", "INFO_SENT", "AWAITING_OWNER", "SKIPPED",
    "CLAIM_RAISED", "WAITING_INVOICE", "DN_DRAFTED", "CLOSED",
)
VARIANCE_BANDS = ("WITHIN", "EXCESS", "OWNER_DECIDES", "AUTO_DEBIT", "OWNER_INFO")


class PlantSetting(Base):
    """Per-plant operating limits the Owner sets (System › Plants). One row per plant; a missing row
    means the defaults. Later phases add their own columns here (gate close time, visitor retention)."""

    __tablename__ = "plant_settings"

    plant_id = Column(String(50), primary_key=True)
    # Weight check of a bill (kg): a shortage up to notify is recorded; above it up to auto the Owner
    # decides; above auto the debit note is drafted automatically.
    weight_short_notify_kg = Column(Numeric(14, 3), nullable=False, default=20, server_default="20")
    weight_short_auto_kg = Column(Numeric(14, 3), nullable=False, default=50, server_default="50")
    version = Column(Integer, nullable=False, default=1, server_default="1")
    updated_by = Column(String(200), nullable=True)
    updated_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        CheckConstraint("weight_short_notify_kg >= 0", name="ck_plant_settings_notify_nonnegative"),
        CheckConstraint("weight_short_auto_kg >= weight_short_notify_kg", name="ck_plant_settings_auto_gte_notify"),
    )


class PurchaseWeightVariance(Base):
    """The weight check of one bill: Σ bill qty − Σ actual qty over lots that are not rejected."""

    __tablename__ = "purchase_weight_variances"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    # "R:<receipt id>" for one GRN, "I:<supplier invoice id>" when one invoice spans several GRNs.
    bill_key = Column(String(120), nullable=False)
    receipt_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    supplier_invoice_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    receipt_ids = Column(JSON, nullable=False, default=list)
    supplier_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    supplier_name = Column(String(200), nullable=True)
    purchase_order_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    po_no = Column(String(80), nullable=True)
    # PurchaseOrder.created_by; for a GRN without a PO, the GRN maker. Assignee of the case, gets the follow-up.
    po_raiser = Column(String(200), nullable=True)
    uom = Column(String(12), nullable=False, default="KG")
    bill_total = Column(Numeric(14, 3), nullable=False, default=0)
    actual_total = Column(Numeric(14, 3), nullable=False, default=0)
    lots_total = Column(Integer, nullable=False, default=0)
    lots_weighed = Column(Integer, nullable=False, default=0)
    lots_excluded = Column(Integer, nullable=False, default=0)
    short_qty = Column(Numeric(14, 3), nullable=False, default=0)
    excess_qty = Column(Numeric(14, 3), nullable=False, default=0)
    # INVOICE (every claimed line at the invoice rate), PO (invoice pending: PO rate), MIXED, NONE.
    rate_basis = Column(String(20), nullable=True)
    claim_amount = Column(Numeric(18, 2), nullable=False, default=0)
    band = Column(String(20), nullable=True)
    status = Column(String(30), nullable=False, default="PROVISIONAL")
    is_final = Column(Boolean, nullable=False, default=False, server_default="false")
    # Limits in force when the bill was first checked; a later settings change never moves an old case.
    notify_kg = Column(Numeric(14, 3), nullable=False, default=20)
    auto_kg = Column(Numeric(14, 3), nullable=False, default=50)
    # MAKE_DEBIT_NOTE / SKIP by the Owner, or AUTO above the auto limit.
    decision = Column(String(20), nullable=True)
    decided_by = Column(String(200), nullable=True)
    decided_at = Column(DateTime, nullable=True)
    reason_code = Column(String(80), nullable=True)
    reason_label = Column(String(200), nullable=True)
    note = Column(Text, nullable=True)
    discrepancy_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    discrepancy_ids = Column(JSON, nullable=False, default=list)
    debit_note_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    # Per bill line: bill / actual / short, the rate used, kg already claimed by a GRN-time case, claim.
    lines_json = Column(JSON, nullable=False, default=list)
    # Per lot: bill and actual qty, who weighed it and when (the evidence on the case).
    lots_json = Column(JSON, nullable=False, default=list)
    final_at = Column(DateTime, nullable=True)
    notified_status = Column(String(30), nullable=True)
    notified_at = Column(DateTime, nullable=True)
    reminder_sent_at = Column(DateTime, nullable=True)
    claim_cycle = Column(Integer, nullable=False, default=0)
    last_error = Column(Text, nullable=True)
    history = Column(JSON, nullable=False, default=list)
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("plant_id", "bill_key", name="uq_purchase_weight_variance_bill"),
        CheckConstraint(
            "status IN ('PROVISIONAL','WITHIN','INFO_SENT','AWAITING_OWNER','SKIPPED','CLAIM_RAISED','WAITING_INVOICE','DN_DRAFTED','CLOSED')",
            name="ck_purchase_weight_variance_status",
        ),
        CheckConstraint(
            "band IS NULL OR band IN ('WITHIN','EXCESS','OWNER_DECIDES','AUTO_DEBIT','OWNER_INFO')",
            name="ck_purchase_weight_variance_band",
        ),
        Index("ix_purchase_weight_variances_plant_status", "plant_id", "status"),
    )


class IncomingQcEntryKey(Base):
    """Idempotency of one weigh-in row (or one re-weigh): the same key returns the saved result."""

    __tablename__ = "incoming_qc_entry_keys"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    idempotency_key = Column(String(120), nullable=False)
    kind = Column(String(20), nullable=False, default="ENTRY")
    entity_type = Column(String(20), nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    fingerprint = Column(String(64), nullable=False)
    result = Column(JSON, nullable=False, default=dict)
    created_by = Column(String(200), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("plant_id", "idempotency_key", name="uq_incoming_qc_entry_key"),)
