import enum
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Float, Date, DateTime, ForeignKey, Enum as SQLEnum, Text, UniqueConstraint
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


class SalesOrder(Base):
    __tablename__ = "sales_orders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_no = Column(String(50), unique=True, nullable=False)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    customer_id = Column(UUID(as_uuid=True), nullable=False)
    po_number = Column(String(100), nullable=True)
    po_date = Column(Date, nullable=True)
    notes = Column(Text, nullable=True)

    status = Column(SQLEnum(SalesOrderStatus), nullable=False, default=SalesOrderStatus.DRAFT)

    created_by = Column(String(200), nullable=False)
    approved_by = Column(String(200), nullable=True)
    released_by = Column(String(200), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    approved_at = Column(DateTime, nullable=True)
    released_at = Column(DateTime, nullable=True)

    lines = relationship("SalesOrderLine", back_populates="sales_order", cascade="all, delete-orphan")


class SalesOrderLine(Base):
    __tablename__ = "sales_order_lines"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sales_order_id = Column(UUID(as_uuid=True), ForeignKey("sales_orders.id"), nullable=False)

    line_no = Column(Float, nullable=False, default=1)
    approved_spec_id = Column(UUID(as_uuid=True), nullable=False)
    product_code = Column(String(120), nullable=True)
    parchment_color = Column(String(100), nullable=True)
    rate_per_pc = Column(Float, nullable=True)
    qty = Column(Float, nullable=False)
    due_date = Column(Date, nullable=False)
    fulfilled_qty = Column(Float, nullable=False, default=0.0)

    sales_order = relationship("SalesOrder", back_populates="lines")
    dispatch_logs = relationship("SalesOrderDispatchLog", back_populates="line", cascade="all, delete-orphan")


class SalesOrderDispatchLog(Base):
    __tablename__ = "sales_order_dispatch_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    line_id = Column(UUID(as_uuid=True), ForeignKey("sales_order_lines.id"), nullable=False)
    dispatch_line_ref = Column(String(100), nullable=False, unique=True)
    qty = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    line = relationship("SalesOrderLine", back_populates="dispatch_logs")
