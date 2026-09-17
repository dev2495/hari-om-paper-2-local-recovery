import enum
import uuid
from datetime import datetime
from sqlalchemy import Boolean, Column, String, Float, Integer, Date, DateTime, ForeignKey, Enum as SQLEnum, Index, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from .database import Base


class SalesOrderStatus(str, enum.Enum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    RELEASED = "released"
    PARTIALLY_RELEASED = "partially_released"
    PARTIALLY_DISPATCHED = "partially_dispatched"
    CLOSED = "closed"


class SalesOrderOrigin(str, enum.Enum):
    CUSTOMER_PO = "CUSTOMER_PO"
    INTERNAL = "INTERNAL"
    REVIEW = "REVIEW"


class SalesOrder(Base):
    __tablename__ = "sales_orders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_no = Column(String(50), unique=True, nullable=False)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    customer_id = Column(UUID(as_uuid=True), nullable=False)
    origin = Column(String(20), nullable=False, default=SalesOrderOrigin.CUSTOMER_PO.value)
    origin_review_required = Column(Boolean, nullable=False, default=False)
    po_number = Column(String(100), nullable=True)
    po_date = Column(Date, nullable=True)
    internal_order_date = Column(Date, nullable=True)
    notes = Column(Text, nullable=True)

    status = Column(SQLEnum(SalesOrderStatus), nullable=False, default=SalesOrderStatus.DRAFT)

    created_by = Column(String(200), nullable=False)
    approved_by = Column(String(200), nullable=True)
    released_by = Column(String(200), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    approved_at = Column(DateTime, nullable=True)
    released_at = Column(DateTime, nullable=True)
    schedule_revision = Column(Integer, nullable=False, default=0)

    lines = relationship("SalesOrderLine", back_populates="sales_order", cascade="all, delete-orphan")


class SalesOrderLine(Base):
    __tablename__ = "sales_order_lines"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sales_order_id = Column(UUID(as_uuid=True), ForeignKey("sales_orders.id"), nullable=False)

    line_no = Column(Float, nullable=False, default=1)
    approved_spec_id = Column(UUID(as_uuid=True), nullable=False)
    product_code = Column(String(120), nullable=True)
    parchment_required = Column(Boolean, nullable=False, default=False)
    parchment_color_id = Column(UUID(as_uuid=True), nullable=True)
    parchment_color = Column(String(100), nullable=True)
    rate_per_pc = Column(Float, nullable=True)
    qty = Column(Float, nullable=False)
    due_date = Column(Date, nullable=False)
    fulfilled_qty = Column(Float, nullable=False, default=0.0)

    sales_order = relationship("SalesOrder", back_populates="lines")
    dispatch_logs = relationship("SalesOrderDispatchLog", back_populates="line", cascade="all, delete-orphan")
    release_lots = relationship("SalesOrderReleaseLot", back_populates="line", cascade="all, delete-orphan")
    delivery_schedules = relationship("SalesOrderDeliverySchedule", back_populates="line", cascade="all, delete-orphan")


class SalesOrderReleaseLot(Base):
    __tablename__ = "sales_order_release_lots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sales_order_id = Column(UUID(as_uuid=True), ForeignKey("sales_orders.id"), nullable=False, index=True)
    sales_order_line_id = Column(UUID(as_uuid=True), ForeignKey("sales_order_lines.id"), nullable=False, index=True)
    product_code = Column(String(120), nullable=True)
    released_qty = Column(Float, nullable=False)
    winder_machine_id = Column(UUID(as_uuid=True), nullable=False)
    job_card_id = Column(UUID(as_uuid=True), nullable=True)
    status = Column(String(30), nullable=False, default="released")
    released_by = Column(String(200), nullable=True)
    released_by_identity = Column(String(200), nullable=True)
    released_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)

    line = relationship("SalesOrderLine", back_populates="release_lots")


class SalesOrderNumberCounter(Base):
    """Atomic per-day allocator for the ``SO-YYYYMMDD-NNNN`` order reference.

    The previous count-based allocator (``COUNT(*) + 1``) let two concurrent
    creates read the same count and mint duplicate references (audit finding S03).
    A single counter row per date key is bumped atomically with
    ``INSERT ... ON CONFLICT DO UPDATE ... RETURNING`` so each caller receives a
    distinct sequence value.
    """

    __tablename__ = "sales_order_number_counters"

    date_key = Column(String(8), primary_key=True)
    last_seq = Column(Integer, nullable=False, default=0)


class SalesOrderDispatchLog(Base):
    __tablename__ = "sales_order_dispatch_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    line_id = Column(UUID(as_uuid=True), ForeignKey("sales_order_lines.id"), nullable=False)
    dispatch_line_ref = Column(String(100), nullable=False, unique=True)
    qty = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    line = relationship("SalesOrderLine", back_populates="dispatch_logs")


class SalesOrderDeliverySchedule(Base):
    """Customer delivery / call-off row. Distinct from release lots and GRN."""

    __tablename__ = "sales_order_delivery_schedules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sales_order_id = Column(UUID(as_uuid=True), ForeignKey("sales_orders.id"), nullable=False, index=True)
    sales_order_line_id = Column(UUID(as_uuid=True), ForeignKey("sales_order_lines.id"), nullable=False, index=True)
    plant_id = Column(String(50), nullable=False, index=True)
    delivery_date = Column(Date, nullable=False, index=True)
    quantity = Column(Float, nullable=False)
    status = Column(String(30), nullable=False, default="committed")
    revision = Column(Integer, nullable=False, default=1)
    created_by = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    line = relationship("SalesOrderLine", back_populates="delivery_schedules")
    allocations = relationship(
        "SalesOrderScheduleAllocation",
        back_populates="delivery_schedule",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_delivery_schedules_line_date", "sales_order_line_id", "delivery_date"),
        Index("ix_delivery_schedules_plant_status", "plant_id", "status"),
    )


class SalesOrderScheduleAllocation(Base):
    """Optional link from a customer call-off to a release lot. Bounded by both parents."""

    __tablename__ = "sales_order_schedule_allocations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    delivery_schedule_id = Column(
        UUID(as_uuid=True), ForeignKey("sales_order_delivery_schedules.id"), nullable=False, index=True
    )
    release_lot_id = Column(UUID(as_uuid=True), ForeignKey("sales_order_release_lots.id"), nullable=False, index=True)
    quantity = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    delivery_schedule = relationship("SalesOrderDeliverySchedule", back_populates="allocations")

    __table_args__ = (
        UniqueConstraint("delivery_schedule_id", "release_lot_id", name="uq_schedule_release_alloc"),
    )
