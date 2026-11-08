"""Gate module tables (6 Nov 2026): gates, bills in, visitors, goods out with the Tally bill number.

- ``gates``: one row per gate of a plant, with the random token printed in the visitor QR poster.
- ``gate_entries``: a bill or challan photographed at the gate (BILL_IN, GE-YYMM-NNN) or a dispatch
  leaving (GOODS_OUT). Bills route to Stores (material) or Accounts (expense bills); the photos are Doc Vault
  documents linked GATE_ENTRY → entry id.
- ``gate_visitors`` / ``gate_visits``: one visitor per mobile number and plant; one visit per arrival
  (V-YYMM-NNN) with its own pass token. The watchman lets in, the host is told and may reply.
- ``dispatch_gate_out``: one row per dispatch (challan) of a plant: the Tally bill number (typed by Store or
  the dispatch desk, never the watchman) and, once Store links the watchman's goods-out photos to it, the gate
  entry and when it left the gate. One goods-out entry may cover several challans (8 Nov 2026).
- ``gate_plant_settings``: gate close time and visitor photo retention per plant (Owner).
- ``gate_notice_log``: once-a-day notices (overstay digest, dispatch not out, unlinked-material reminders).

Imported by ``models.py`` so ``Base.metadata.create_all`` at startup creates the tables on live.
Alembic: ``015_gate``.
"""
from __future__ import annotations

import uuid
from datetime import datetime, time

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from .database import Base

GATE_DIRECTIONS = ("IN", "OUT", "BOTH")
ENTRY_KINDS = ("BILL_IN", "GOODS_OUT")
ENTRY_ROUTES = ("STORES", "ACCOUNTS", "DISPATCH")
ENTRY_STATUSES = ("AT_GATE", "WITH_STORES", "WITH_ACCOUNTS", "LINKED", "FILED", "OUT", "VOID")
VISIT_STATUSES = ("ARRIVED", "IN", "OUT", "DENIED", "NO_SHOW")
HOST_REPLIES = ("SEND_IN", "WAIT", "NOT_AVAILABLE")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN (" + ",".join(f"'{value}'" for value in values) + ")"


class Gate(Base):
    __tablename__ = "gates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    code = Column(String(20), nullable=False)
    name = Column(String(120), nullable=False)
    direction = Column(String(5), nullable=False, default="BOTH")
    active = Column(Boolean, nullable=False, default=True)
    # 128 random bits (secrets.token_urlsafe(16)); the public check-in link is /visit/<qr_token>.
    qr_token = Column(String(64), nullable=False, unique=True)
    token_rotated_at = Column(DateTime, nullable=True)
    token_rotated_by = Column(String(200), nullable=True)
    created_by = Column(String(200), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    version = Column(Integer, nullable=False, default=1)

    __table_args__ = (
        UniqueConstraint("plant_id", "code", name="uq_gates_plant_code"),
        CheckConstraint(_in("direction", GATE_DIRECTIONS), name="ck_gates_direction"),
    )


class GateEntry(Base):
    __tablename__ = "gate_entries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    entry_no = Column(String(30), nullable=False)
    request_id = Column(UUID(as_uuid=True), nullable=True)
    gate_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    direction = Column(String(5), nullable=False, default="IN")
    kind = Column(String(12), nullable=False, default="BILL_IN")
    # BILL_CATEGORY reason-master code (GB-MATERIAL routes to Stores) and its label when it was saved.
    category_code = Column(String(60), nullable=True)
    category_label = Column(String(200), nullable=True)
    route = Column(String(10), nullable=False, default="STORES")
    vehicle_no = Column(String(30), nullable=True)
    party_id = Column(String(64), nullable=True)
    party_text = Column(String(200), nullable=True)
    status = Column(String(15), nullable=False, default="AT_GATE")
    receipt_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    dispatch_ref = Column(String(100), nullable=True, index=True)
    # Filled by Accounts on an expense bill (no stock, no ledger: a register with the document).
    bill_no = Column(String(120), nullable=True)
    bill_date = Column(Date, nullable=True)
    bill_amount = Column(Numeric(18, 2), nullable=True)
    cost_head_code = Column(String(60), nullable=True)
    cost_head_label = Column(String(200), nullable=True)
    filed_by = Column(String(200), nullable=True)
    filed_at = Column(DateTime, nullable=True)
    linked_by = Column(String(200), nullable=True)
    linked_at = Column(DateTime, nullable=True)
    reminded_at = Column(DateTime, nullable=True)
    note = Column(Text, nullable=True)
    # [{at, by, action, from, to, detail}] — every route change, link and filing.
    history = Column(JSONB, nullable=False, default=list)
    created_by = Column(String(200), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    version = Column(Integer, nullable=False, default=1)

    __table_args__ = (
        UniqueConstraint("plant_id", "entry_no", name="uq_gate_entries_plant_no"),
        UniqueConstraint("plant_id", "request_id", name="uq_gate_entries_plant_request"),
        CheckConstraint(_in("kind", ENTRY_KINDS), name="ck_gate_entries_kind"),
        CheckConstraint(_in("route", ENTRY_ROUTES), name="ck_gate_entries_route"),
        CheckConstraint(_in("status", ENTRY_STATUSES), name="ck_gate_entries_status"),
        CheckConstraint("direction IN ('IN','OUT')", name="ck_gate_entries_direction"),
        Index("ix_gate_entries_plant_created", "plant_id", "created_at"),
        Index("ix_gate_entries_plant_status", "plant_id", "status"),
    )


class GateVisitor(Base):
    __tablename__ = "gate_visitors"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    mobile = Column(String(10), nullable=False)
    name = Column(String(120), nullable=False)
    company = Column(String(160), nullable=True)
    visits_count = Column(Integer, nullable=False, default=0)
    last_visit_at = Column(DateTime, nullable=True)
    blocked = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("plant_id", "mobile", name="uq_gate_visitors_plant_mobile"),
        CheckConstraint("mobile ~ '^[6-9][0-9]{9}$'", name="ck_gate_visitors_mobile"),
    )


class GateVisit(Base):
    __tablename__ = "gate_visits"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    visit_no = Column(String(30), nullable=False)
    request_id = Column(UUID(as_uuid=True), nullable=True)
    # 128 random bits; the visitor's pass page and its QR carry it (never the visit id).
    pass_token = Column(String(64), nullable=False, unique=True)
    gate_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    visitor_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    visitor_name = Column(String(120), nullable=False)
    company = Column(String(160), nullable=True)
    purpose_code = Column(String(60), nullable=False)
    purpose_label = Column(String(200), nullable=False)
    purpose_note = Column(Text, nullable=True)
    host_user_id = Column(String(64), nullable=True)
    host_name = Column(String(160), nullable=True)
    host_email = Column(String(200), nullable=True)
    host_department = Column(String(40), nullable=True)
    people = Column(Integer, nullable=False, default=1)
    vehicle_no = Column(String(30), nullable=True)
    photo_doc_id = Column(UUID(as_uuid=True), nullable=True)
    photo_purged_at = Column(DateTime, nullable=True)
    source = Column(String(10), nullable=False, default="SELF")  # SELF (gate QR) or DESK (watchman)
    status = Column(String(10), nullable=False, default="ARRIVED")
    arrived_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    in_at = Column(DateTime, nullable=True)
    in_by = Column(String(200), nullable=True)
    out_at = Column(DateTime, nullable=True)
    out_by = Column(String(200), nullable=True)
    denied_by = Column(String(200), nullable=True)
    deny_code = Column(String(60), nullable=True)
    deny_label = Column(String(200), nullable=True)
    deny_note = Column(Text, nullable=True)
    host_reply = Column(String(15), nullable=True)
    host_reply_by = Column(String(200), nullable=True)
    host_reply_at = Column(DateTime, nullable=True)
    created_by = Column(String(200), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    version = Column(Integer, nullable=False, default=1)

    __table_args__ = (
        UniqueConstraint("plant_id", "visit_no", name="uq_gate_visits_plant_no"),
        UniqueConstraint("plant_id", "request_id", name="uq_gate_visits_plant_request"),
        CheckConstraint(_in("status", VISIT_STATUSES), name="ck_gate_visits_status"),
        CheckConstraint("host_reply IS NULL OR " + _in("host_reply", HOST_REPLIES), name="ck_gate_visits_reply"),
        CheckConstraint("people BETWEEN 1 AND 50", name="ck_gate_visits_people"),
        CheckConstraint("source IN ('SELF','DESK')", name="ck_gate_visits_source"),
        Index("ix_gate_visits_plant_status", "plant_id", "status"),
        Index("ix_gate_visits_plant_arrived", "plant_id", "arrived_at"),
    )


class DispatchGateOut(Base):
    __tablename__ = "dispatch_gate_out"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    dispatch_ref = Column(String(100), nullable=False)
    tally_bill_no = Column(String(60), nullable=True)
    tally_bill_date = Column(Date, nullable=True)
    tally_by = Column(String(200), nullable=True)
    tally_at = Column(DateTime, nullable=True)
    vehicle_no = Column(String(30), nullable=True)
    gate_entry_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    # out_at / out_by come from the gate entry (when the watchman took the photos); linked_* is the Store user.
    out_at = Column(DateTime, nullable=True)
    out_by = Column(String(200), nullable=True)
    linked_by = Column(String(200), nullable=True)
    linked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    version = Column(Integer, nullable=False, default=1)

    __table_args__ = (
        UniqueConstraint("plant_id", "dispatch_ref", name="uq_dispatch_gate_out_plant_ref"),
        # No unique key on gate_entry_id since 8 Nov 2026: one truck's photos may cover several challans.
        CheckConstraint("out_at IS NULL OR (tally_bill_no IS NOT NULL AND gate_entry_id IS NOT NULL)", name="ck_dispatch_gate_out_complete"),
    )


class GatePlantSetting(Base):
    """Owner settings of the gate per plant (System › Plants). A missing row means the defaults."""
    __tablename__ = "gate_plant_settings"

    plant_id = Column(String(50), primary_key=True)
    gate_close_time = Column(Time, nullable=False, default=time(19, 0))
    visitor_retention_days = Column(Integer, nullable=False, default=365)
    updated_by = Column(String(200), nullable=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    version = Column(Integer, nullable=False, default=1)

    __table_args__ = (
        CheckConstraint("visitor_retention_days BETWEEN 30 AND 3650", name="ck_gate_settings_retention"),
    )


class GateNoticeLog(Base):
    """One row per once-a-day notice sent, so a restarted worker never sends it twice."""
    __tablename__ = "gate_notice_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False)
    kind = Column(String(30), nullable=False)
    day = Column(Date, nullable=False)
    key = Column(String(100), nullable=False, default="")
    sent_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("plant_id", "kind", "day", "key", name="uq_gate_notice_log"),
    )
