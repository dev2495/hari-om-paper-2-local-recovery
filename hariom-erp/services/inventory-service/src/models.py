import enum
import uuid
from datetime import datetime
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    String,
    Enum as SQLEnum,
    Text,
    UniqueConstraint,
    JSON,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from .database import Base


STOCK_STATUS_VALUES = (
    "UNRESTRICTED",
    "WIP",
    "QC_HOLD",
    "BLOCKED",
    "DISPATCH_STAGING",
    "SCRAP",
)


class ItemType(str, enum.Enum):
    RAW_PAPER = "RAW_PAPER"
    ADHESIVE = "ADHESIVE"
    PARCHMENT = "PARCHMENT"
    FINISHED_GOOD = "FINISHED_GOOD"


class TrackingMode(str, enum.Enum):
    REEL = "REEL"
    BULK = "BULK"


class UOM(str, enum.Enum):
    KG = "KG"
    PCS = "PCS"


class TransactionType(str, enum.Enum):
    INWARD = "INWARD"
    ISSUE_PRODUCTION = "ISSUE_PRODUCTION"
    PRODUCTION_RETURN = "PRODUCTION_RETURN"
    FG_INWARD = "FG_INWARD"
    DISPATCH = "DISPATCH"
    MOVE = "MOVE"
    OPENING = "OPENING"
    ADJUSTMENT = "ADJUSTMENT"


class ReferenceType(str, enum.Enum):
    PURCHASE = "PURCHASE"
    PRODUCTION_JOB = "PRODUCTION_JOB"
    DISPATCH = "DISPATCH"
    SALES_ORDER = "SALES_ORDER"
    INTERNAL = "INTERNAL"
    ADJUSTMENT = "ADJUSTMENT"


class ReservationStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    RELEASED = "RELEASED"
    CONSUMED = "CONSUMED"


class ReelStatus(str, enum.Enum):
    IN_STOCK = "IN_STOCK"
    ISSUED = "ISSUED"
    CONSUMED = "CONSUMED"
    SCRAP = "SCRAP"


class ReelIssueStatus(str, enum.Enum):
    OPEN = "OPEN"
    CLOSED = "CLOSED"


class CostSource(str, enum.Enum):
    MANUAL = "MANUAL"
    SUPPLIER = "SUPPLIER"
    AVG_BATCH = "AVG_BATCH"


class ReelScanEventType(str, enum.Enum):
    INWARD_SCAN = "INWARD_SCAN"
    ISSUE_SCAN = "ISSUE_SCAN"
    CLOSE_SCAN = "CLOSE_SCAN"
    MOVE_SCAN = "MOVE_SCAN"
    SLIT_SCAN = "SLIT_SCAN"


class ReelScanSource(str, enum.Enum):
    INVENTORY = "INVENTORY"
    PRODUCTION = "PRODUCTION"


class InventoryLocation(Base):
    __tablename__ = "inventory_locations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT_A")
    code = Column(String(80), nullable=False)
    warehouse = Column(String(120), nullable=False)
    zone = Column(String(120), nullable=True)
    bin = Column(String(120), nullable=True)
    purpose = Column(String(120), nullable=True)
    active = Column(SQLEnum("true", "false", name="boolean_enum"), default="true")
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("plant_id", "code", name="uq_inventory_locations_plant_code"),
    )


class ItemMaster(Base):
    __tablename__ = "item_master"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    item_code = Column(String(50), unique=True, nullable=False)
    name = Column(String(200), nullable=False)
    type = Column(SQLEnum(ItemType), nullable=False)
    tracking_mode = Column(SQLEnum(TrackingMode), nullable=False, default=TrackingMode.BULK)
    uom = Column(SQLEnum(UOM), nullable=False)
    unit_cost = Column(Float, nullable=True)
    cost_source = Column(String(20), nullable=True)
    reorder_level = Column(Float, nullable=False, default=0.0)
    safety_stock = Column(Float, nullable=False, default=0.0)
    lead_time_days = Column(Float, nullable=False, default=0.0)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT_A")
    active = Column(SQLEnum("true", "false", name="boolean_enum"), default="true")
    created_at = Column(DateTime, default=datetime.utcnow)

    batches = relationship("StockBatch", back_populates="item")
    transactions = relationship("StockTransaction", back_populates="item")
    reservations = relationship("Reservation", back_populates="item")
    reels = relationship("PaperReel", back_populates="paper")


class StockBatch(Base):
    __tablename__ = "stock_batch"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    item_id = Column(UUID(as_uuid=True), ForeignKey("item_master.id"), nullable=False)
    batch_no = Column(String(100), nullable=False)
    received_qty = Column(Float, nullable=False)
    location = Column(String(100), nullable=True)
    location_id = Column(UUID(as_uuid=True), ForeignKey("inventory_locations.id"), nullable=True)
    stock_status = Column(String(20), nullable=False, default="UNRESTRICTED")
    unit_cost = Column(Float, nullable=True)
    cost_source = Column(String(20), nullable=True)
    supplier_id = Column(UUID(as_uuid=True), nullable=True)
    supplier_name_snapshot = Column(String(200), nullable=True)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT_A")
    spec_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    item = relationship("ItemMaster", back_populates="batches")
    transactions = relationship("StockTransaction", back_populates="batch")
    reservations = relationship("Reservation", back_populates="batch")
    inventory_location = relationship("InventoryLocation")

    __table_args__ = (
        CheckConstraint(
            "stock_status IN ('UNRESTRICTED','WIP','QC_HOLD','BLOCKED','DISPATCH_STAGING','SCRAP')",
            name="ck_stock_batch_stock_status",
        ),
    )


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
    location_id = Column(UUID(as_uuid=True), ForeignKey("inventory_locations.id"), nullable=True)
    stock_status = Column(String(20), nullable=False, default="UNRESTRICTED")
    movement_metadata = Column(JSON, nullable=True)

    effective_date = Column(Date, nullable=True, index=True)
    effective_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    item = relationship("ItemMaster", back_populates="transactions")
    batch = relationship("StockBatch", back_populates="transactions")
    inventory_location = relationship("InventoryLocation")

    __table_args__ = (
        CheckConstraint(
            "stock_status IN ('UNRESTRICTED','WIP','QC_HOLD','BLOCKED','DISPATCH_STAGING','SCRAP')",
            name="ck_stock_transaction_stock_status",
        ),
    )


class InventoryQualityTemplate(Base):
    __tablename__ = "inventory_quality_templates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True, default="GLOBAL")
    material_type = Column(String(40), nullable=False, index=True)
    parameter_key = Column(String(80), nullable=False)
    label = Column(String(160), nullable=False)
    input_type = Column(String(30), nullable=False, default="number")
    options = Column(JSON, nullable=False, default=list)
    required = Column(Boolean, nullable=False, default=False)
    sort_order = Column(Float, nullable=False, default=0.0)
    active = Column(SQLEnum("true", "false", name="boolean_enum"), default="true")
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("plant_id", "material_type", "parameter_key", name="uq_inventory_qc_template_key"),
    )


class InventoryQualityInspection(Base):
    __tablename__ = "inventory_quality_inspections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT_A")
    entity_type = Column(String(40), nullable=False, index=True)
    entity_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    material_type = Column(String(40), nullable=False, index=True)
    source = Column(String(40), nullable=False, default="INWARD")
    stage_type = Column(String(40), nullable=True)
    status = Column(String(20), nullable=False, default="PENDING")
    readings = Column(JSON, nullable=False, default=dict)
    failures = Column(JSON, nullable=False, default=list)
    disposition = Column(String(40), nullable=True)
    notes = Column(Text, nullable=True)
    created_by = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        CheckConstraint("entity_type IN ('BATCH','REEL','CUSTOMER_REJECTION')", name="ck_inventory_qc_entity_type"),
        CheckConstraint("source IN ('INWARD','CUSTOMER_REJECTION','PROCESS_STAGE')", name="ck_inventory_qc_source"),
        CheckConstraint("status IN ('PENDING','PASS','FAIL','SKIPPED')", name="ck_inventory_qc_status"),
    )


class CustomerRejection(Base):
    __tablename__ = "customer_rejections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT_A")
    customer_id = Column(UUID(as_uuid=True), nullable=True)
    customer_name = Column(String(200), nullable=False)
    item_id = Column(UUID(as_uuid=True), ForeignKey("item_master.id"), nullable=False)
    batch_id = Column(UUID(as_uuid=True), ForeignKey("stock_batch.id"), nullable=True, index=True)
    rejected_qty = Column(Float, nullable=False)
    invoice_ref = Column(String(120), nullable=True)
    dispatch_ref = Column(String(120), nullable=True)
    reason_code = Column(String(80), nullable=False)
    reason_notes = Column(Text, nullable=True)
    effective_date = Column(Date, nullable=True, index=True)
    source_job_card_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    source_dispatch_id = Column(UUID(as_uuid=True), nullable=True)
    source_spec_id = Column(UUID(as_uuid=True), nullable=True)
    status = Column(String(30), nullable=False, default="QC_HOLD")
    disposition = Column(String(40), nullable=True)
    qc_inspection_id = Column(UUID(as_uuid=True), nullable=True)
    trace_snapshot = Column(JSON, nullable=False, default=dict)
    root_cause_department = Column(String(80), nullable=True)
    owner_department = Column(String(80), nullable=True)
    corrective_action = Column(Text, nullable=True)
    closure_due_date = Column(Date, nullable=True)
    closure_status = Column(String(30), nullable=False, default="OPEN")
    rework_cost = Column(Float, nullable=False, default=0.0)
    scrap_cost = Column(Float, nullable=False, default=0.0)
    cost_impact = Column(Float, nullable=False, default=0.0)
    attachment_refs = Column(JSON, nullable=False, default=list)
    created_by = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    closed_at = Column(DateTime, nullable=True)

    item = relationship("ItemMaster")
    batch = relationship("StockBatch")

    __table_args__ = (
        CheckConstraint("rejected_qty > 0", name="ck_customer_rejections_qty_positive"),
        CheckConstraint(
            "status IN ('QC_HOLD','WIP','UNRESTRICTED','SCRAP','BLOCKED','CLOSED')",
            name="ck_customer_rejections_status",
        ),
    )


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


class PaperReel(Base):
    __tablename__ = "paper_reels"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(
        UUID(as_uuid=True),
        nullable=False,
        index=True,
        default=uuid.UUID("00000000-0000-0000-0000-0000000000a1"),
    )
    reel_code = Column(String(100), nullable=False)
    paper_id = Column(UUID(as_uuid=True), ForeignKey("item_master.id"), nullable=False)
    gsm = Column(Float, nullable=True)
    bf = Column(Float, nullable=True)
    supplier_name = Column(String(200), nullable=True)
    supplier_id = Column(UUID(as_uuid=True), nullable=True)
    supplier_name_snapshot = Column(String(200), nullable=True)
    inward_weight_kg = Column(Float, nullable=False)
    current_weight_kg = Column(Float, nullable=False)
    unit_cost = Column(Float, nullable=True)
    cost_source = Column(SQLEnum(CostSource), nullable=True)
    status = Column(SQLEnum(ReelStatus), nullable=False, default=ReelStatus.IN_STOCK)
    stock_status = Column(String(20), nullable=False, default="UNRESTRICTED")
    location_id = Column(UUID(as_uuid=True), ForeignKey("inventory_locations.id"), nullable=True)
    parent_reel_id = Column(UUID(as_uuid=True), ForeignKey("paper_reels.id"), nullable=True)
    genealogy_metadata = Column(JSON, nullable=True)
    inward_date = Column(Date, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    paper = relationship("ItemMaster", back_populates="reels")
    issues = relationship("ReelIssue", back_populates="reel")
    scan_events = relationship("ReelScanEvent", back_populates="reel")
    inventory_location = relationship("InventoryLocation")
    parent = relationship("PaperReel", remote_side=[id], backref="children")

    __table_args__ = (
        UniqueConstraint("plant_id", "reel_code", name="uq_paper_reels_plant_code"),
        CheckConstraint("inward_weight_kg >= 0", name="ck_paper_reels_inward_nonnegative"),
        CheckConstraint("current_weight_kg >= 0", name="ck_paper_reels_current_nonnegative"),
        CheckConstraint("current_weight_kg <= inward_weight_kg", name="ck_paper_reels_current_lte_inward"),
        CheckConstraint(
            "stock_status IN ('UNRESTRICTED','WIP','QC_HOLD','BLOCKED','DISPATCH_STAGING','SCRAP')",
            name="ck_paper_reels_stock_status",
        ),
    )


class ReelIssue(Base):
    __tablename__ = "reel_issues"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(
        UUID(as_uuid=True),
        nullable=False,
        index=True,
        default=uuid.UUID("00000000-0000-0000-0000-0000000000a1"),
    )
    reel_id = Column(UUID(as_uuid=True), ForeignKey("paper_reels.id"), nullable=False, index=True)
    issue_section = Column(String(40), nullable=False, default="WINDER_SECTION", index=True)
    winder_machine_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    shift = Column(String(20), nullable=False)
    issue_date = Column(Date, nullable=False)
    issued_weight_kg = Column(Float, nullable=False)
    consumed_weight_kg = Column(Float, nullable=False, default=0.0)
    remaining_weight_kg = Column(Float, nullable=False)
    status = Column(SQLEnum(ReelIssueStatus), nullable=False, default=ReelIssueStatus.OPEN)
    closed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    reel = relationship("PaperReel", back_populates="issues")

    __table_args__ = (
        CheckConstraint("issued_weight_kg > 0", name="ck_reel_issues_issued_positive"),
        CheckConstraint("consumed_weight_kg >= 0", name="ck_reel_issues_consumed_nonnegative"),
        CheckConstraint("consumed_weight_kg <= issued_weight_kg", name="ck_reel_issues_consumed_lte_issued"),
        CheckConstraint("remaining_weight_kg >= 0", name="ck_reel_issues_remaining_nonnegative"),
        CheckConstraint("remaining_weight_kg <= issued_weight_kg", name="ck_reel_issues_remaining_lte_issued"),
    )


class ReelScanEvent(Base):
    __tablename__ = "reel_scan_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    reel_id = Column(UUID(as_uuid=True), ForeignKey("paper_reels.id"), nullable=False, index=True)
    event_type = Column(SQLEnum(ReelScanEventType), nullable=False)
    source = Column(SQLEnum(ReelScanSource), nullable=False)
    operator_id = Column(UUID(as_uuid=True), nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
    event_metadata = Column(JSON, nullable=True)

    reel = relationship("PaperReel", back_populates="scan_events")


class InventoryOpeningLoad(Base):
    __tablename__ = "inventory_opening_loads"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT_A")
    document_no = Column(String(80), nullable=False)
    effective_date = Column(Date, nullable=False)
    status = Column(String(20), nullable=False, default="POSTED")
    notes = Column(String(500), nullable=True)
    created_by = Column(String(200), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    lines = relationship("InventoryOpeningLoadLine", back_populates="header", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("plant_id", "document_no", name="uq_inventory_opening_load_doc"),
    )


class InventoryOpeningLoadLine(Base):
    __tablename__ = "inventory_opening_load_lines"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    opening_load_id = Column(UUID(as_uuid=True), ForeignKey("inventory_opening_loads.id"), nullable=False, index=True)
    item_id = Column(UUID(as_uuid=True), ForeignKey("item_master.id"), nullable=False)
    batch_id = Column(UUID(as_uuid=True), ForeignKey("stock_batch.id"), nullable=True)
    reel_id = Column(UUID(as_uuid=True), ForeignKey("paper_reels.id"), nullable=True)
    batch_no = Column(String(100), nullable=True)
    reel_code = Column(String(100), nullable=True)
    qty = Column(Float, nullable=False)
    location_id = Column(UUID(as_uuid=True), ForeignKey("inventory_locations.id"), nullable=True)
    stock_status = Column(String(20), nullable=False, default="UNRESTRICTED")
    unit_cost = Column(Float, nullable=True)
    notes = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    header = relationship("InventoryOpeningLoad", back_populates="lines")
    item = relationship("ItemMaster")
    batch = relationship("StockBatch")
    reel = relationship("PaperReel")
    inventory_location = relationship("InventoryLocation")

    __table_args__ = (
        CheckConstraint("qty > 0", name="ck_inventory_opening_load_lines_qty_positive"),
        CheckConstraint(
            "stock_status IN ('UNRESTRICTED','WIP','QC_HOLD','BLOCKED','DISPATCH_STAGING','SCRAP')",
            name="ck_inventory_opening_load_lines_status",
        ),
    )


class InventoryCertification(Base):
    __tablename__ = "inventory_certifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT_A")
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    fiscal_year_label = Column(String(30), nullable=True)
    status = Column(String(30), nullable=False, default="DRAFT")
    count_session_no = Column(String(80), nullable=True)
    count_location_scope = Column(String(200), nullable=True)
    count_state = Column(String(30), nullable=False, default="DRAFT")
    notes = Column(String(500), nullable=True)
    attachment_refs = Column(JSON, nullable=False, default=list)
    created_by = Column(String(200), nullable=False)
    counted_by = Column(String(200), nullable=True)
    checked_by = Column(String(200), nullable=True)
    certified_by = Column(String(200), nullable=True)
    stock_as_of_at = Column(DateTime, nullable=True)
    count_taken_at = Column(DateTime, nullable=True)
    counted_at = Column(DateTime, nullable=True)
    checked_at = Column(DateTime, nullable=True)
    certified_at = Column(DateTime, nullable=True)
    carried_forward_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    lines = relationship("InventoryCertificationLine", back_populates="header", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("plant_id", "period_start", "period_end", name="uq_inventory_certifications_period"),
    )


class InventoryCertificationLine(Base):
    __tablename__ = "inventory_certification_lines"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    certification_id = Column(UUID(as_uuid=True), ForeignKey("inventory_certifications.id"), nullable=False, index=True)
    item_id = Column(UUID(as_uuid=True), ForeignKey("item_master.id"), nullable=False, index=True)
    item_code = Column(String(80), nullable=False)
    item_name = Column(String(200), nullable=False)
    item_type = Column(String(40), nullable=False)
    tracking_mode = Column(String(20), nullable=False)
    uom = Column(String(20), nullable=False)
    batch_id = Column(UUID(as_uuid=True), ForeignKey("stock_batch.id"), nullable=True)
    reel_id = Column(UUID(as_uuid=True), ForeignKey("paper_reels.id"), nullable=True)
    stock_status = Column(String(20), nullable=False, default="UNRESTRICTED")
    location_id = Column(UUID(as_uuid=True), ForeignKey("inventory_locations.id"), nullable=True)
    bin_code = Column(String(120), nullable=True)
    opening_qty = Column(Float, nullable=False, default=0.0)
    inward_qty = Column(Float, nullable=False, default=0.0)
    outward_qty = Column(Float, nullable=False, default=0.0)
    adjustment_qty = Column(Float, nullable=False, default=0.0)
    closing_qty = Column(Float, nullable=False, default=0.0)
    physical_qty = Column(Float, nullable=True)
    variance_qty = Column(Float, nullable=False, default=0.0)
    unit_cost = Column(Float, nullable=False, default=0.0)
    closing_value = Column(Float, nullable=False, default=0.0)
    variance_value = Column(Float, nullable=False, default=0.0)
    reorder_level = Column(Float, nullable=False, default=0.0)
    safety_stock = Column(Float, nullable=False, default=0.0)
    lead_time_days = Column(Float, nullable=False, default=0.0)
    count_state = Column(String(30), nullable=False, default="DRAFT")
    counted_by = Column(String(200), nullable=True)
    checked_by = Column(String(200), nullable=True)
    counted_at = Column(DateTime, nullable=True)
    checked_at = Column(DateTime, nullable=True)
    recount_required = Column(Boolean, nullable=False, default=False)
    recount_qty = Column(Float, nullable=True)
    recount_notes = Column(String(500), nullable=True)
    attachment_refs = Column(JSON, nullable=False, default=list)
    notes = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    header = relationship("InventoryCertification", back_populates="lines")
    item = relationship("ItemMaster")
    batch = relationship("StockBatch")
    reel = relationship("PaperReel")
    inventory_location = relationship("InventoryLocation")


class InventoryCarryForward(Base):
    __tablename__ = "inventory_carry_forwards"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    certification_id = Column(UUID(as_uuid=True), ForeignKey("inventory_certifications.id"), nullable=False, index=True)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT_A")
    opening_date = Column(Date, nullable=False)
    fiscal_year_label = Column(String(30), nullable=True)
    document_no = Column(String(80), nullable=False)
    status = Column(String(20), nullable=False, default="GENERATED")
    notes = Column(String(500), nullable=True)
    created_by = Column(String(200), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    certification = relationship("InventoryCertification")
    lines = relationship("InventoryCarryForwardLine", back_populates="header", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("plant_id", "document_no", name="uq_inventory_carry_forward_doc"),
    )


class InventoryCarryForwardLine(Base):
    __tablename__ = "inventory_carry_forward_lines"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    carry_forward_id = Column(UUID(as_uuid=True), ForeignKey("inventory_carry_forwards.id"), nullable=False, index=True)
    item_id = Column(UUID(as_uuid=True), ForeignKey("item_master.id"), nullable=False, index=True)
    item_code = Column(String(80), nullable=False)
    item_name = Column(String(200), nullable=False)
    item_type = Column(String(40), nullable=False)
    tracking_mode = Column(String(20), nullable=False)
    uom = Column(String(20), nullable=False)
    opening_qty = Column(Float, nullable=False, default=0.0)
    unit_cost = Column(Float, nullable=False, default=0.0)
    opening_value = Column(Float, nullable=False, default=0.0)
    source_variance_qty = Column(Float, nullable=False, default=0.0)
    notes = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    header = relationship("InventoryCarryForward", back_populates="lines")
    item = relationship("ItemMaster")


class StockAdjustmentVoucher(Base):
    __tablename__ = "stock_adjustment_vouchers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT_A")
    voucher_no = Column(String(80), nullable=False)
    effective_date = Column(Date, nullable=False)
    effective_at = Column(DateTime, nullable=True)
    reason_code = Column(String(80), nullable=False)
    reason_notes = Column(String(500), nullable=True)
    source_type = Column(String(60), nullable=False, default="MANUAL")
    source_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    attachment_refs = Column(JSON, nullable=False, default=list)
    status = Column(String(30), nullable=False, default="DRAFT")
    created_by = Column(String(200), nullable=False)
    approved_by = Column(String(200), nullable=True)
    posted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    lines = relationship("StockAdjustmentLine", back_populates="header", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("plant_id", "voucher_no", name="uq_stock_adjustment_vouchers_doc"),
        CheckConstraint(
            "status IN ('DRAFT','POSTED','CANCELLED')",
            name="ck_stock_adjustment_vouchers_status",
        ),
    )


class StockAdjustmentLine(Base):
    __tablename__ = "stock_adjustment_lines"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    adjustment_id = Column(UUID(as_uuid=True), ForeignKey("stock_adjustment_vouchers.id"), nullable=False, index=True)
    item_id = Column(UUID(as_uuid=True), ForeignKey("item_master.id"), nullable=False, index=True)
    batch_id = Column(UUID(as_uuid=True), ForeignKey("stock_batch.id"), nullable=True, index=True)
    reel_id = Column(UUID(as_uuid=True), ForeignKey("paper_reels.id"), nullable=True, index=True)
    qty_delta = Column(Float, nullable=False)
    unit_cost = Column(Float, nullable=True)
    location_id = Column(UUID(as_uuid=True), ForeignKey("inventory_locations.id"), nullable=True)
    stock_status = Column(String(20), nullable=False, default="UNRESTRICTED")
    reason_code = Column(String(80), nullable=True)
    notes = Column(String(500), nullable=True)
    transaction_id = Column(UUID(as_uuid=True), ForeignKey("stock_transaction.id"), nullable=True)
    created_reel_id = Column(UUID(as_uuid=True), ForeignKey("paper_reels.id"), nullable=True)
    created_batch_id = Column(UUID(as_uuid=True), ForeignKey("stock_batch.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    header = relationship("StockAdjustmentVoucher", back_populates="lines")
    item = relationship("ItemMaster")
    batch = relationship("StockBatch", foreign_keys=[batch_id])
    reel = relationship("PaperReel", foreign_keys=[reel_id])
    transaction = relationship("StockTransaction", foreign_keys=[transaction_id])
    created_reel = relationship("PaperReel", foreign_keys=[created_reel_id])
    created_batch = relationship("StockBatch", foreign_keys=[created_batch_id])
    inventory_location = relationship("InventoryLocation")

    __table_args__ = (
        CheckConstraint("qty_delta <> 0", name="ck_stock_adjustment_lines_qty_nonzero"),
        CheckConstraint(
            "stock_status IN ('UNRESTRICTED','WIP','QC_HOLD','BLOCKED','DISPATCH_STAGING','SCRAP')",
            name="ck_stock_adjustment_lines_status",
        ),
    )


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT_A")
    po_no = Column(String(80), nullable=False)
    supplier_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    supplier_name_snapshot = Column(String(200), nullable=False)
    expected_date = Column(Date, nullable=True)
    status = Column(String(30), nullable=False, default="DRAFT")
    notes = Column(String(500), nullable=True)
    created_by = Column(String(200), nullable=False)
    approved_by = Column(String(200), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    lines = relationship("PurchaseOrderLine", back_populates="order", cascade="all, delete-orphan")
    receipts = relationship("PurchaseReceipt", back_populates="order", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("plant_id", "po_no", name="uq_purchase_orders_plant_po"),
        CheckConstraint(
            "status IN ('DRAFT','APPROVED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')",
            name="ck_purchase_orders_status",
        ),
    )


class PurchaseOrderLine(Base):
    __tablename__ = "purchase_order_lines"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    purchase_order_id = Column(UUID(as_uuid=True), ForeignKey("purchase_orders.id"), nullable=False, index=True)
    item_id = Column(UUID(as_uuid=True), ForeignKey("item_master.id"), nullable=False, index=True)
    qty_ordered = Column(Float, nullable=False)
    qty_received = Column(Float, nullable=False, default=0.0)
    unit_cost = Column(Float, nullable=False)
    incoming_qc_required = Column(Boolean, nullable=False, default=True)
    line_status = Column(String(20), nullable=False, default="OPEN")
    notes = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    order = relationship("PurchaseOrder", back_populates="lines")
    item = relationship("ItemMaster")

    __table_args__ = (
        CheckConstraint("qty_ordered > 0", name="ck_purchase_order_lines_qty_ordered_positive"),
        CheckConstraint("qty_received >= 0", name="ck_purchase_order_lines_qty_received_nonnegative"),
        CheckConstraint("unit_cost >= 0", name="ck_purchase_order_lines_unit_cost_nonnegative"),
        CheckConstraint("line_status IN ('OPEN','PARTIAL','CLOSED')", name="ck_purchase_order_lines_status"),
    )


class PurchaseReceipt(Base):
    __tablename__ = "purchase_receipts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT_A")
    purchase_order_id = Column(UUID(as_uuid=True), ForeignKey("purchase_orders.id"), nullable=False, index=True)
    grn_no = Column(String(80), nullable=False)
    received_date = Column(Date, nullable=False)
    status = Column(String(20), nullable=False, default="POSTED")
    created_by = Column(String(200), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    order = relationship("PurchaseOrder", back_populates="receipts")
    lines = relationship("PurchaseReceiptLine", back_populates="receipt", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("plant_id", "grn_no", name="uq_purchase_receipts_plant_grn"),
    )


class PurchaseReceiptLine(Base):
    __tablename__ = "purchase_receipt_lines"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    receipt_id = Column(UUID(as_uuid=True), ForeignKey("purchase_receipts.id"), nullable=False, index=True)
    purchase_order_line_id = Column(UUID(as_uuid=True), ForeignKey("purchase_order_lines.id"), nullable=False, index=True)
    item_id = Column(UUID(as_uuid=True), ForeignKey("item_master.id"), nullable=False, index=True)
    batch_id = Column(UUID(as_uuid=True), ForeignKey("stock_batch.id"), nullable=True)
    qty_received = Column(Float, nullable=False)
    unit_cost = Column(Float, nullable=False)
    qc_status = Column(String(20), nullable=False, default="PENDING")
    created_at = Column(DateTime, default=datetime.utcnow)

    receipt = relationship("PurchaseReceipt", back_populates="lines")
    order_line = relationship("PurchaseOrderLine")
    item = relationship("ItemMaster")
    batch = relationship("StockBatch")

    __table_args__ = (
        CheckConstraint("qty_received > 0", name="ck_purchase_receipt_lines_qty_positive"),
        CheckConstraint("qc_status IN ('PENDING','PASS','HOLD')", name="ck_purchase_receipt_lines_qc_status"),
    )
