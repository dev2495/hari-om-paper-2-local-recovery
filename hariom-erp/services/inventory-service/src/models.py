import enum
import uuid
from datetime import datetime
from sqlalchemy import (
    Column,
    String,
    Float,
    DateTime,
    ForeignKey,
    Enum as SQLEnum,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from .database import Base


class ItemType(str, enum.Enum):
    RAW_PAPER = "RAW_PAPER"
    ADHESIVE = "ADHESIVE"
    PARCHMENT = "PARCHMENT"
    FINISHED_GOOD = "FINISHED_GOOD"


class UOM(str, enum.Enum):
    KG = "KG"
    PCS = "PCS"


class TransactionType(str, enum.Enum):
    INWARD = "INWARD"
    ISSUE_PRODUCTION = "ISSUE_PRODUCTION"
    PRODUCTION_RETURN = "PRODUCTION_RETURN"
    FG_INWARD = "FG_INWARD"
    DISPATCH = "DISPATCH"


class ReferenceType(str, enum.Enum):
    PURCHASE = "PURCHASE"
    PRODUCTION_JOB = "PRODUCTION_JOB"
    DISPATCH = "DISPATCH"
    SALES_ORDER = "SALES_ORDER"


class ReservationStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    RELEASED = "RELEASED"
    CONSUMED = "CONSUMED"


class ItemMaster(Base):
    __tablename__ = "item_master"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    item_code = Column(String(50), unique=True, nullable=False)
    name = Column(String(200), nullable=False)
    type = Column(SQLEnum(ItemType), nullable=False)
    uom = Column(SQLEnum(UOM), nullable=False)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT_A")
    active = Column(SQLEnum("true", "false", name="boolean_enum"), default="true")
    created_at = Column(DateTime, default=datetime.utcnow)

    batches = relationship("StockBatch", back_populates="item")
    transactions = relationship("StockTransaction", back_populates="item")
    reservations = relationship("Reservation", back_populates="item")


class StockBatch(Base):
    __tablename__ = "stock_batch"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    item_id = Column(UUID(as_uuid=True), ForeignKey("item_master.id"), nullable=False)
    batch_no = Column(String(100), nullable=False)
    received_qty = Column(Float, nullable=False)
    location = Column(String(100), nullable=True)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT_A")
    spec_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    item = relationship("ItemMaster", back_populates="batches")
    transactions = relationship("StockTransaction", back_populates="batch")
    reservations = relationship("Reservation", back_populates="batch")


class StockTransaction(Base):
    __tablename__ = "stock_transaction"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    item_id = Column(UUID(as_uuid=True), ForeignKey("item_master.id"), nullable=False)
    batch_id = Column(UUID(as_uuid=True), ForeignKey("stock_batch.id"), nullable=True)

    transaction_type = Column(SQLEnum(TransactionType), nullable=False)
    qty_change = Column(Float, nullable=False)

    reference_type = Column(SQLEnum(ReferenceType), nullable=False)
    reference_id = Column(UUID(as_uuid=True), nullable=False)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT_A")
    external_ref = Column(String(120), unique=True, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    item = relationship("ItemMaster", back_populates="transactions")
    batch = relationship("StockBatch", back_populates="transactions")


class Reservation(Base):
    __tablename__ = "reservations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sales_order_id = Column(UUID(as_uuid=True), nullable=False)
    sales_order_line_id = Column(UUID(as_uuid=True), nullable=False)
    item_id = Column(UUID(as_uuid=True), ForeignKey("item_master.id"), nullable=False)
    batch_id = Column(UUID(as_uuid=True), ForeignKey("stock_batch.id"), nullable=True)
    spec_id = Column(UUID(as_uuid=True), nullable=True)

    reserved_qty = Column(Float, nullable=False)
    consumed_qty = Column(Float, nullable=False, default=0.0)
    status = Column(SQLEnum(ReservationStatus), nullable=False, default=ReservationStatus.ACTIVE)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT_A")
    created_by = Column(String(200), nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    released_at = Column(DateTime, nullable=True)

    item = relationship("ItemMaster", back_populates="reservations")
    batch = relationship("StockBatch", back_populates="reservations")
