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
    Integer,
    Numeric,
    String,
    Enum as SQLEnum,
    Text,
    UniqueConstraint,
    JSON,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship, synonym
from .database import Base


STOCK_STATUS_VALUES = (
    "UNRESTRICTED",
    "WIP",
    "QC_HOLD",
    "BLOCKED",
    "DISPATCH_STAGING",
    "SCRAP",
    "CONCESSION",
)
STOCK_STATUS_CHECK = (
    "stock_status IN ('UNRESTRICTED','WIP','QC_HOLD','BLOCKED','DISPATCH_STAGING','SCRAP','CONCESSION')"
)


class ItemType(str, enum.Enum):
    RAW_PAPER = "RAW_PAPER"
    ADHESIVE = "ADHESIVE"
    PARCHMENT = "PARCHMENT"
    FINISHED_GOOD = "FINISHED_GOOD"
    PACKAGING = "PACKAGING"
    TOOL = "TOOL"
    OTHER = "OTHER"


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


class ToolReceipt(Base):
    """GRN-style inward header for physical tooling units."""

    __tablename__ = "tool_receipts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    receipt_no = Column(String(80), nullable=False)
    receipt_date = Column(Date, nullable=False)
    supplier_name = Column(String(200), nullable=True)
    po_reference = Column(String(120), nullable=True)
    invoice_reference = Column(String(120), nullable=True)
    location_id = Column(UUID(as_uuid=True), ForeignKey("inventory_locations.id"), nullable=False)
    notes = Column(Text, nullable=True)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT_A")
    created_by = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    location = relationship("InventoryLocation")
    assets = relationship("ToolAsset", back_populates="receipt")

    __table_args__ = (
        UniqueConstraint("plant_id", "receipt_no", name="uq_tool_receipt_plant_no"),
    )


class ToolAsset(Base):
    """A physical tool unit created by inward/opening, identified by QR."""

    __tablename__ = "tool_assets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_no = Column(String(80), nullable=False)
    qr_value = Column(String(160), nullable=False)
    tool_definition_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    category = Column(String(50), nullable=False, index=True)
    definition_name = Column(String(200), nullable=False)
    attribute_snapshot = Column(JSON, nullable=False, default=dict)
    status = Column(String(30), nullable=False, default="AVAILABLE", index=True)
    location_id = Column(UUID(as_uuid=True), ForeignKey("inventory_locations.id"), nullable=False)
    receipt_id = Column(UUID(as_uuid=True), ForeignKey("tool_receipts.id"), nullable=True, index=True)
    grind_version = Column(Integer, nullable=False, default=0)
    usage_count = Column(Integer, nullable=False, default=0)
    produced_qty = Column(Float, nullable=False, default=0.0)
    scrap_qty = Column(Float, nullable=False, default=0.0)
    current_job_card_id = Column(String(80), nullable=True, index=True)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT_A")
    received_at = Column(DateTime, default=datetime.utcnow)
    retired_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    location = relationship("InventoryLocation")
    receipt = relationship("ToolReceipt", back_populates="assets")
    events = relationship("ToolAssetEvent", back_populates="asset", cascade="all, delete-orphan")
    assignments = relationship("ToolAssetAssignment", back_populates="asset", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("plant_id", "asset_no", name="uq_tool_asset_plant_no"),
        UniqueConstraint("plant_id", "qr_value", name="uq_tool_asset_plant_qr"),
    )


class ToolAssetEvent(Base):
    __tablename__ = "tool_asset_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id = Column(UUID(as_uuid=True), ForeignKey("tool_assets.id"), nullable=False, index=True)
    event_type = Column(String(40), nullable=False, index=True)
    from_status = Column(String(30), nullable=True)
    to_status = Column(String(30), nullable=True)
    source_type = Column(String(40), nullable=False, default="TOOLING")
    source_id = Column(String(100), nullable=True, index=True)
    job_card_id = Column(String(80), nullable=True, index=True)
    stage_type = Column(String(40), nullable=True)
    good_qty = Column(Float, nullable=True)
    scrap_qty = Column(Float, nullable=True)
    grind_version = Column(Integer, nullable=True)
    metadata_json = Column(JSON, nullable=True)
    actor = Column(String(200), nullable=True)
    event_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)

    asset = relationship("ToolAsset", back_populates="events")


class ToolAssetAssignment(Base):
    __tablename__ = "tool_asset_assignments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id = Column(UUID(as_uuid=True), ForeignKey("tool_assets.id"), nullable=False, index=True)
    job_card_id = Column(String(80), nullable=False, index=True)
    stage_type = Column(String(40), nullable=False)
    issued_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    returned_at = Column(DateTime, nullable=True)
    status = Column(String(20), nullable=False, default="OPEN")
    good_qty = Column(Float, nullable=False, default=0.0)
    scrap_qty = Column(Float, nullable=False, default=0.0)
    usage_key = Column(String(160), nullable=True, unique=True)
    notes = Column(Text, nullable=True)

    asset = relationship("ToolAsset", back_populates="assignments")


class ItemMaster(Base):
    __tablename__ = "item_master"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    item_code = Column(String(50), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    type = Column(SQLEnum(ItemType), nullable=False)
    tracking_mode = Column(SQLEnum(TrackingMode), nullable=False, default=TrackingMode.BULK)
    uom = Column(SQLEnum(UOM), nullable=False)
    unit_cost = Column(Float, nullable=True)
    cost_source = Column(String(20), nullable=True)
    reorder_level = Column(Float, nullable=False, default=0.0)
    safety_stock = Column(Float, nullable=False, default=0.0)
    lead_time_days = Column(Float, nullable=False, default=0.0)
    quality_profile = Column(JSON, nullable=True)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT_A")
    active = Column(SQLEnum("true", "false", name="boolean_enum"), default="true")
    created_at = Column(DateTime, default=datetime.utcnow)

    batches = relationship("StockBatch", back_populates="item")
    transactions = relationship("StockTransaction", back_populates="item")
    reservations = relationship("Reservation", back_populates="item")
    reels = relationship("PaperReel", back_populates="paper")

    __table_args__ = (
        UniqueConstraint("plant_id", "item_code", name="uq_item_master_plant_code"),
    )


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
    inward_metadata = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    item = relationship("ItemMaster", back_populates="batches")
    transactions = relationship("StockTransaction", back_populates="batch")
    reservations = relationship("Reservation", back_populates="batch")
    inventory_location = relationship("InventoryLocation")

    __table_args__ = (
        CheckConstraint(
            STOCK_STATUS_CHECK,
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
            STOCK_STATUS_CHECK,
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
    reasons = Column(JSON, nullable=False, default=dict)
    evaluation = Column(JSON, nullable=False, default=dict)
    created_by = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    eligibility_status = Column(String(40), nullable=True)
    concession_reason = Column(Text, nullable=True)
    concession_approved_by = Column(String(200), nullable=True)
    concession_approved_at = Column(DateTime, nullable=True)

    __table_args__ = (
        CheckConstraint("entity_type IN ('BATCH','REEL','CUSTOMER_REJECTION')", name="ck_inventory_qc_entity_type"),
        CheckConstraint("source IN ('INWARD','CUSTOMER_REJECTION','PROCESS_STAGE')", name="ck_inventory_qc_source"),
        CheckConstraint("status IN ('PENDING','PASS','FAIL','SKIPPED','INCOMPLETE','INVALID','NOT_REQUIRED')", name="ck_inventory_qc_status"),
    )


class InventoryQualityConcession(Base):
    __tablename__ = "inventory_quality_concessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    inspection_id = Column(UUID(as_uuid=True), ForeignKey("inventory_quality_inspections.id"), nullable=False, index=True)
    entity_type = Column(String(40), nullable=False, index=True)
    entity_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    measured_status = Column(String(20), nullable=False, default="FAIL")
    eligibility_status = Column(String(40), nullable=False, default="RELEASED_BY_CONCESSION")
    disposition = Column(String(40), nullable=True)
    stock_status_before = Column(String(40), nullable=True)
    stock_status_after = Column(String(40), nullable=True)
    hold_released = Column(Boolean, nullable=False, default=False)
    reason = Column(Text, nullable=False)
    quantity = Column(Float, nullable=True)
    inspector_id = Column(String(200), nullable=True)
    approved_by = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    released_entity_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    residual_entity_id = Column(UUID(as_uuid=True), nullable=True)
    operation_id = Column(String(120), nullable=True, index=True)
    permitted_customer_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    permitted_sales_order_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    expires_at = Column(DateTime, nullable=True, index=True)


class InventoryQualityHold(Base):
    __tablename__ = "inventory_quality_holds"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    entity_type = Column(String(40), nullable=False, index=True)
    entity_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    source_inspection_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    quantity = Column(Float, nullable=False, default=0.0)
    reason = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default="HOLD")
    hold_kind = Column(String(40), nullable=False, default="INSPECTION")
    created_by = Column(String(200), nullable=True)
    released_by = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    released_at = Column(DateTime, nullable=True)


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
    purchase_receipt_line_id = Column(UUID(as_uuid=True), ForeignKey("purchase_receipt_lines.id"), nullable=True, index=True)
    paper_id = Column(UUID(as_uuid=True), ForeignKey("item_master.id"), nullable=False)
    gsm = Column(Float, nullable=True)
    bf = Column(Float, nullable=True)
    supplier_name = Column(String(200), nullable=True)
    supplier_id = Column(UUID(as_uuid=True), nullable=True)
    supplier_name_snapshot = Column(String(200), nullable=True)
    inward_weight_kg = Column(Float, nullable=False)
    gross_weight_kg = Column(Float, nullable=True)
    tare_weight_kg = Column(Float, nullable=True)
    net_weight_kg = Column(Float, nullable=True)
    current_weight_kg = Column(Float, nullable=False)
    physical_form = Column(String(20), nullable=False, default="REEL")
    source_reel_no = Column(String(120), nullable=True)
    vendor_batch_no = Column(String(120), nullable=True)
    width_mm = Column(Float, nullable=True)
    commercial_status = Column(String(30), nullable=False, default="CLEAR")
    unit_cost = Column(Float, nullable=True)
    cost_source = Column(SQLEnum(CostSource), nullable=True)
    status = Column(SQLEnum(ReelStatus), nullable=False, default=ReelStatus.IN_STOCK)
    stock_status = Column(String(20), nullable=False, default="UNRESTRICTED")
    location_id = Column(UUID(as_uuid=True), ForeignKey("inventory_locations.id"), nullable=True)
    parent_reel_id = Column(UUID(as_uuid=True), ForeignKey("paper_reels.id"), nullable=True)
    genealogy_metadata = Column(JSON, nullable=True)
    inward_metadata = Column(JSON, nullable=True)
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
            STOCK_STATUS_CHECK,
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
    request_id = Column(UUID(as_uuid=True), nullable=True)
    request_fingerprint = Column(String(64), nullable=True)
    category = Column(String(20), nullable=False, default="RM_PM")
    current_revision_no = Column(Integer, nullable=False, default=1)
    version = Column(Integer, nullable=False, default=1)
    supplier_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    supplier_name_snapshot = Column(String(200), nullable=False)
    expected_date = Column(Date, nullable=True)
    status = Column(String(30), nullable=False, default="DRAFT")
    notes = Column(String(500), nullable=True)
    metadata_json = Column(JSON, nullable=True)
    created_by = Column(String(200), nullable=False)
    approved_by = Column(String(200), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    submitted_by = Column(String(200), nullable=True)
    submitted_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)

    lines = relationship("PurchaseOrderLine", back_populates="order", cascade="all, delete-orphan")
    receipts = relationship("PurchaseReceipt", back_populates="order", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("plant_id", "po_no", name="uq_purchase_orders_plant_po"),
        UniqueConstraint("plant_id", "request_id", name="uq_purchase_orders_plant_request"),
        CheckConstraint(
            "status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','REVISION_REQUIRED','PARTIALLY_RECEIVED','RECEIVED','SHORT_CLOSED','CANCELLED')",
            name="ck_purchase_orders_status",
        ),
    )


class PurchaseOrderLine(Base):
    __tablename__ = "purchase_order_lines"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    purchase_order_id = Column(UUID(as_uuid=True), ForeignKey("purchase_orders.id"), nullable=False, index=True)
    item_id = Column(UUID(as_uuid=True), ForeignKey("item_master.id"), nullable=False, index=True)
    logical_line_id = Column(UUID(as_uuid=True), nullable=False, default=uuid.uuid4, index=True)
    uom = Column(String(12), nullable=False, default="KG")
    expected_unit_count = Column(Integer, nullable=True)
    received_unit_count = Column(Integer, nullable=True)
    count_basis = Column(String(20), nullable=True)
    qty_ordered = Column(Float, nullable=False)
    qty_received = Column(Float, nullable=False, default=0.0)
    qty_rejected = Column(Float, nullable=False, default=0.0)
    qty_short_closed = Column(Float, nullable=False, default=0.0)
    unit_cost = Column(Float, nullable=False)
    incoming_qc_required = Column(Boolean, nullable=False, default=True)
    line_status = Column(String(20), nullable=False, default="OPEN")
    notes = Column(String(500), nullable=True)
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    order = relationship("PurchaseOrder", back_populates="lines")
    item = relationship("ItemMaster")
    schedules = relationship("PurchaseLineSchedule", back_populates="order_line")

    __table_args__ = (
        CheckConstraint("qty_ordered > 0", name="ck_purchase_order_lines_qty_ordered_positive"),
        CheckConstraint("qty_received >= 0", name="ck_purchase_order_lines_qty_received_nonnegative"),
        CheckConstraint("qty_rejected >= 0", name="ck_purchase_order_lines_qty_rejected_nonnegative"),
        CheckConstraint("unit_cost >= 0", name="ck_purchase_order_lines_unit_cost_nonnegative"),
        CheckConstraint("line_status IN ('OPEN','PARTIAL','CLOSED','REJECTED')", name="ck_purchase_order_lines_status"),
    )


class PurchaseReceipt(Base):
    __tablename__ = "purchase_receipts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT_A")
    purchase_order_id = Column(UUID(as_uuid=True), ForeignKey("purchase_orders.id"), nullable=True, index=True)
    supplier_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    supplier_name_snapshot = Column(String(200), nullable=True)
    receipt_kind = Column(String(20), nullable=False, default="PO_LINKED", server_default="PO_LINKED")
    manual_reason = Column(Text, nullable=True)
    approval_history = Column(JSONB, nullable=False, default=list, server_default="[]")
    request_id = Column(UUID(as_uuid=True), nullable=True)
    request_fingerprint = Column(String(64), nullable=True)
    supplier_invoice_id = Column(UUID(as_uuid=True), ForeignKey("supplier_invoices.id"), nullable=True, index=True)
    invoice_pending = Column(Boolean, nullable=False, default=False)
    commercial_status = Column(String(30), nullable=False, default="CLEAR")
    posting_version = Column(Integer, nullable=False, default=1)
    grn_no = Column(String(80), nullable=False)
    received_date = Column(Date, nullable=False)
    status = Column(String(20), nullable=False, default="POSTED")
    created_by = Column(String(200), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    order = relationship("PurchaseOrder", back_populates="receipts")
    lines = relationship("PurchaseReceiptLine", back_populates="receipt", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("plant_id", "grn_no", name="uq_purchase_receipts_plant_grn"),
        UniqueConstraint("plant_id", "request_id", name="uq_purchase_receipts_plant_request"),
    )


class PurchaseReceiptLine(Base):
    __tablename__ = "purchase_receipt_lines"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    receipt_id = Column(UUID(as_uuid=True), ForeignKey("purchase_receipts.id"), nullable=False, index=True)
    purchase_order_line_id = Column(UUID(as_uuid=True), ForeignKey("purchase_order_lines.id"), nullable=True, index=True)
    approved_revision_line_id = Column(UUID(as_uuid=True), ForeignKey("purchase_order_revision_lines.id"), nullable=True, index=True)
    item_id = Column(UUID(as_uuid=True), ForeignKey("item_master.id"), nullable=False, index=True)
    batch_id = Column(UUID(as_uuid=True), ForeignKey("stock_batch.id"), nullable=True)
    qty_received = Column(Float, nullable=False)
    unit_cost = Column(Float, nullable=False)
    po_rate = Column(Numeric(18, 6), nullable=True)
    invoice_rate = Column(Numeric(18, 6), nullable=True)
    tracking_mode = Column(String(20), nullable=False, default="BULK")
    commercial_status = Column(String(30), nullable=False, default="CLEAR")
    qc_status = Column(String(20), nullable=False, default="PENDING")
    created_at = Column(DateTime, default=datetime.utcnow)

    receipt = relationship("PurchaseReceipt", back_populates="lines")
    order_line = relationship("PurchaseOrderLine")
    item = relationship("ItemMaster")
    batch = relationship("StockBatch")
    schedule_allocations = relationship("ReceiptScheduleAllocation", back_populates="receipt_line")

    __table_args__ = (
        CheckConstraint("qty_received > 0", name="ck_purchase_receipt_lines_qty_positive"),
        CheckConstraint("qc_status IN ('PENDING','PASS','HOLD','NOT_REQUIRED')", name="ck_purchase_receipt_lines_qc_status"),
    )


class PurchaseLineSchedule(Base):
    __tablename__ = "purchase_line_schedules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    purchase_order_line_id = Column(UUID(as_uuid=True), ForeignKey("purchase_order_lines.id"), nullable=False, index=True)
    scheduled_qty = Column(Float, nullable=False)
    promised_date = Column(Date, nullable=False)
    current_date = Column("current_expected_date", Date, nullable=False)
    confirmation_status = Column(String(20), nullable=False, default="TENTATIVE")
    notes = Column(String(500), nullable=True)
    created_by = Column(String(200), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    cancelled_at = Column(DateTime, nullable=True)

    revision_line_id = Column(UUID(as_uuid=True), ForeignKey("purchase_order_revision_lines.id"), nullable=True, index=True)
    source_plan_entry_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    cancelled_qty = Column(Float, nullable=False, default=0)
    version = Column(Integer, nullable=False, default=1)
    change_history = Column(JSONB, nullable=False, default=list)
    delivery_date = synonym("current_date")
    planned_qty = synonym("scheduled_qty")

    @property
    def received_qty(self):
        return sum(float(row.allocated_qty or 0) for row in self.allocations or [])

    order_line = relationship("PurchaseOrderLine", back_populates="schedules")
    allocations = relationship("ReceiptScheduleAllocation", back_populates="schedule")

    __table_args__ = (
        CheckConstraint("scheduled_qty > 0", name="ck_purchase_line_schedules_qty_positive"),
        CheckConstraint(
            "confirmation_status IN ('TENTATIVE','CONFIRMED','CANCELLED')",
            name="ck_purchase_line_schedules_confirmation",
        ),
    )


class ReceiptScheduleAllocation(Base):
    __tablename__ = "receipt_schedule_allocations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    receipt_line_id = Column(UUID(as_uuid=True), ForeignKey("purchase_receipt_lines.id"), nullable=False, index=True)
    schedule_id = Column(UUID(as_uuid=True), ForeignKey("purchase_line_schedules.id"), nullable=False, index=True)
    allocated_qty = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    receipt_line = relationship("PurchaseReceiptLine", back_populates="schedule_allocations")
    schedule = relationship("PurchaseLineSchedule", back_populates="allocations")

    __table_args__ = (
        UniqueConstraint("receipt_line_id", "schedule_id", name="uq_receipt_schedule_alloc_pair"),
        CheckConstraint("allocated_qty > 0", name="ck_receipt_schedule_alloc_qty_positive"),
    )


class PurchaseWorkbookImport(Base):
    __tablename__ = "purchase_workbook_imports"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    source_name = Column(String(120), nullable=False)
    sheet_name = Column(String(120), nullable=False)
    fingerprint = Column(String(64), nullable=False)
    preview_json = Column(JSON, nullable=False, default=dict)
    commit_json = Column(JSON, nullable=True)
    posted_po_ids = Column(JSON, nullable=True)
    ledger_posted = Column(Boolean, nullable=False, default=False)
    created_by = Column(String(200), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("plant_id", "fingerprint", name="uq_purchase_workbook_plant_fingerprint"),
    )


# Procurement V2 keeps commercial revisions, physical receipt identity, planning,
# alert policy and standard-cost history as typed records.  JSON below is used
# only for immutable display/source snapshots and heterogeneous specifications.
class DocumentSeries(Base):
    __tablename__ = "document_series"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    document_type = Column(String(30), nullable=False)
    category = Column(String(20), nullable=False)
    prefix = Column(String(30), nullable=False)
    next_value = Column(Integer, nullable=False, default=1)
    version = Column(Integer, nullable=False, default=1)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("plant_id", "document_type", "category", name="uq_document_series_scope"),
        CheckConstraint("next_value > 0", name="ck_document_series_next_positive"),
    )


class PurchaseOrderRevision(Base):
    __tablename__ = "purchase_order_revisions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    purchase_order_id = Column(UUID(as_uuid=True), ForeignKey("purchase_orders.id"), nullable=False, index=True)
    revision_no = Column(Integer, nullable=False)
    request_id = Column(UUID(as_uuid=True), nullable=False)
    approval_state = Column(String(30), nullable=False, default="DRAFT")
    content_hash = Column(String(64), nullable=False)
    snapshot_json = Column(JSON, nullable=False, default=dict)
    change_reason = Column(Text, nullable=True)
    version = Column(Integer, nullable=False, default=1)
    created_by = Column(String(200), nullable=False)
    submitted_by = Column(String(200), nullable=True)
    submitted_at = Column(DateTime, nullable=True)
    approved_by = Column(String(200), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    rejected_by = Column(String(200), nullable=True)
    rejected_at = Column(DateTime, nullable=True)
    rejection_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    lines = relationship("PurchaseOrderRevisionLine", back_populates="revision", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("purchase_order_id", "revision_no", name="uq_purchase_order_revision_no"),
        UniqueConstraint("purchase_order_id", "request_id", name="uq_purchase_order_revision_request"),
        CheckConstraint(
            "approval_state IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','WITHDRAWN')",
            name="ck_purchase_order_revision_state",
        ),
    )


class PurchaseOrderRevisionLine(Base):
    __tablename__ = "purchase_order_revision_lines"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    revision_id = Column(UUID(as_uuid=True), ForeignKey("purchase_order_revisions.id"), nullable=False, index=True)
    logical_line_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    source_order_line_id = Column(UUID(as_uuid=True), ForeignKey("purchase_order_lines.id"), nullable=True, index=True)
    item_id = Column(UUID(as_uuid=True), ForeignKey("item_master.id"), nullable=False, index=True)
    qty_ordered = Column(Numeric(18, 3), nullable=False)
    unit_rate = Column(Numeric(18, 6), nullable=False)
    uom = Column(String(12), nullable=False, default="KG")
    expected_unit_count = Column(Integer, nullable=True)
    count_basis = Column(String(20), nullable=True)
    specification_json = Column(JSON, nullable=False, default=dict)
    delivery_date = Column(Date, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    revision = relationship("PurchaseOrderRevision", back_populates="lines")
    item = relationship("ItemMaster")

    __table_args__ = (
        UniqueConstraint("revision_id", "logical_line_id", name="uq_purchase_revision_logical_line"),
        CheckConstraint("qty_ordered > 0", name="ck_purchase_revision_line_qty_positive"),
        CheckConstraint("unit_rate >= 0", name="ck_purchase_revision_line_rate_nonnegative"),
        CheckConstraint("expected_unit_count IS NULL OR expected_unit_count > 0", name="ck_purchase_revision_expected_count"),
        CheckConstraint("count_basis IS NULL OR count_basis IN ('ESTIMATED','CONTRACTUAL')", name="ck_purchase_revision_count_basis"),
    )


class PurchaseApprovalDecision(Base):
    __tablename__ = "purchase_approval_decisions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    revision_id = Column(UUID(as_uuid=True), ForeignKey("purchase_order_revisions.id"), nullable=False, index=True)
    decision = Column(String(20), nullable=False)
    reason = Column(Text, nullable=True)
    content_hash = Column(String(64), nullable=False)
    actor = Column(String(200), nullable=False)
    actor_role = Column(String(80), nullable=True)
    decided_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        CheckConstraint("decision IN ('SUBMITTED','APPROVED','REJECTED','WITHDRAWN')", name="ck_purchase_approval_decision"),
    )


# Compatibility name for the original procurement UI. One supplier calendar owns all commitments.
PurchaseDeliverySchedule = PurchaseLineSchedule


class SupplierInvoice(Base):
    __tablename__ = "supplier_invoices"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    supplier_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    invoice_no = Column(String(120), nullable=False)
    normalized_invoice_no = Column(String(120), nullable=False)
    invoice_date = Column(Date, nullable=False)
    currency = Column(String(3), nullable=False, default="INR")
    status = Column(String(30), nullable=False, default="RECORDED")
    document_ref = Column(String(500), nullable=True)
    version = Column(Integer, nullable=False, default=1)
    created_by = Column(String(200), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    lines = relationship("SupplierInvoiceLine", back_populates="invoice", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("plant_id", "supplier_id", "normalized_invoice_no", name="uq_supplier_invoice_namespace"),
    )


class SupplierInvoiceLine(Base):
    __tablename__ = "supplier_invoice_lines"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    invoice_id = Column(UUID(as_uuid=True), ForeignKey("supplier_invoices.id"), nullable=False, index=True)
    item_id = Column(UUID(as_uuid=True), ForeignKey("item_master.id"), nullable=False, index=True)
    qty = Column(Numeric(18, 3), nullable=False)
    rate = Column(Numeric(18, 6), nullable=False)
    uom = Column(String(12), nullable=False, default="KG")
    tax_amount = Column(Numeric(18, 2), nullable=False, default=0)
    charge_amount = Column(Numeric(18, 2), nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    invoice = relationship("SupplierInvoice", back_populates="lines")

    __table_args__ = (
        CheckConstraint("qty > 0", name="ck_supplier_invoice_line_qty_positive"),
        CheckConstraint("rate >= 0", name="ck_supplier_invoice_line_rate_nonnegative"),
    )


class ReceiptInvoiceAllocation(Base):
    __tablename__ = "receipt_invoice_allocations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    receipt_line_id = Column(UUID(as_uuid=True), ForeignKey("purchase_receipt_lines.id"), nullable=False, index=True)
    invoice_line_id = Column(UUID(as_uuid=True), ForeignKey("supplier_invoice_lines.id"), nullable=False, index=True)
    revision_line_id = Column(UUID(as_uuid=True), ForeignKey("purchase_order_revision_lines.id"), nullable=True, index=True)
    allocated_qty = Column(Numeric(18, 3), nullable=False)
    po_rate = Column(Numeric(18, 6), nullable=False)
    invoice_rate = Column(Numeric(18, 6), nullable=False)
    rate_delta = Column(Numeric(18, 6), nullable=False)
    claimable_amount = Column(Numeric(18, 2), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("receipt_line_id", "invoice_line_id", name="uq_receipt_invoice_allocation"),
        CheckConstraint("allocated_qty > 0", name="ck_receipt_invoice_allocation_qty"),
    )


class ReceiptStockAllocation(Base):
    __tablename__ = "receipt_stock_allocations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    receipt_line_id = Column(UUID(as_uuid=True), ForeignKey("purchase_receipt_lines.id"), nullable=False, index=True)
    reel_id = Column(UUID(as_uuid=True), ForeignKey("paper_reels.id"), nullable=True, index=True)
    batch_id = Column(UUID(as_uuid=True), ForeignKey("stock_batch.id"), nullable=True, index=True)
    allocated_qty = Column(Numeric(18, 3), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        CheckConstraint("(reel_id IS NOT NULL) <> (batch_id IS NOT NULL)", name="ck_receipt_stock_exactly_one_target"),
        CheckConstraint("allocated_qty > 0", name="ck_receipt_stock_allocation_qty"),
    )


class PurchaseDiscrepancy(Base):
    __tablename__ = "purchase_discrepancies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    allocation_id = Column(UUID(as_uuid=True), ForeignKey("receipt_invoice_allocations.id"), nullable=False, index=True)
    discrepancy_type = Column(String(30), nullable=False, default="RATE")
    quantity = Column(Numeric(18, 3), nullable=False)
    po_rate = Column(Numeric(18, 6), nullable=False)
    invoice_rate = Column(Numeric(18, 6), nullable=False)
    delta = Column(Numeric(18, 6), nullable=False)
    claimable_amount = Column(Numeric(18, 2), nullable=False)
    evidence_json = Column(JSON, nullable=False, default=dict)
    status = Column(String(30), nullable=False, default="OPEN")
    assignee = Column(String(200), nullable=True)
    resolution_reason = Column(Text, nullable=True)
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("allocation_id", "discrepancy_type", name="uq_purchase_discrepancy_allocation_type"),
        CheckConstraint("status IN ('OPEN','UNDER_REVIEW','ACCEPTED','CLAIM_DRAFTED','CLAIMED','RESOLVED','REJECTED')", name="ck_purchase_discrepancy_status"),
    )


class PurchaseDebitNote(Base):
    __tablename__ = "purchase_debit_notes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    debit_note_no = Column(String(80), nullable=False)
    request_id = Column(UUID(as_uuid=True), nullable=False)
    request_fingerprint = Column(String(64), nullable=False)
    supplier_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    supplier_name_snapshot = Column(String(200), nullable=False)
    note_date = Column(Date, nullable=False)
    reason = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default="DRAFT")
    total_amount = Column(Numeric(18, 2), nullable=False, default=0)
    settled_amount = Column(Numeric(18, 2), nullable=False, default=0)
    version = Column(Integer, nullable=False, default=1)
    created_by = Column(String(200), nullable=False)
    approved_by = Column(String(200), nullable=True)
    issued_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    lines = relationship("PurchaseDebitNoteLine", back_populates="debit_note", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("plant_id", "debit_note_no", name="uq_purchase_debit_note_no"),
        UniqueConstraint("plant_id", "request_id", name="uq_purchase_debit_note_request"),
        CheckConstraint("status IN ('DRAFT','SUBMITTED','APPROVED','ISSUED','PARTIALLY_SETTLED','SETTLED','VOID')", name="ck_purchase_debit_note_status"),
    )


class PurchaseDebitNoteLine(Base):
    __tablename__ = "purchase_debit_note_lines"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    debit_note_id = Column(UUID(as_uuid=True), ForeignKey("purchase_debit_notes.id"), nullable=False, index=True)
    discrepancy_id = Column(UUID(as_uuid=True), ForeignKey("purchase_discrepancies.id"), nullable=False, index=True)
    claimed_amount = Column(Numeric(18, 2), nullable=False)
    tax_adjustment = Column(Numeric(18, 2), nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    debit_note = relationship("PurchaseDebitNote", back_populates="lines")

    __table_args__ = (
        UniqueConstraint("discrepancy_id", name="uq_purchase_debit_note_discrepancy"),
        CheckConstraint("claimed_amount > 0", name="ck_purchase_debit_note_claim_positive"),
    )


class PurchaseDebitNoteSettlement(Base):
    __tablename__ = "purchase_debit_note_settlements"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    debit_note_id = Column(UUID(as_uuid=True), ForeignKey("purchase_debit_notes.id"), nullable=False, index=True)
    amount = Column(Numeric(18, 2), nullable=False)
    settlement_date = Column(Date, nullable=False)
    reference = Column(String(160), nullable=False)
    created_by = Column(String(200), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (CheckConstraint("amount > 0", name="ck_purchase_debit_note_settlement_positive"),)


class LotLabelRecord(Base):
    __tablename__ = "lot_label_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    reel_id = Column(UUID(as_uuid=True), ForeignKey("paper_reels.id"), nullable=False, unique=True, index=True)
    label_code = Column(String(100), nullable=False)
    content_snapshot = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("plant_id", "label_code", name="uq_lot_label_code"),)


class LabelPrintJob(Base):
    __tablename__ = "label_print_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    request_id = Column(UUID(as_uuid=True), nullable=False)
    request_fingerprint = Column(String(64), nullable=False)
    profile = Column(String(40), nullable=False, default="PAPER_LOT_4X2")
    lot_ids = Column(JSON, nullable=False, default=list)
    copies = Column(Integer, nullable=False, default=1)
    status = Column(String(30), nullable=False, default="GENERATED")
    reprint_reason = Column(Text, nullable=True)
    created_by = Column(String(200), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("plant_id", "request_id", name="uq_label_print_job_request"),
        CheckConstraint("copies > 0", name="ck_label_print_job_copies"),
    )


class ProcurementPlan(Base):
    __tablename__ = "procurement_plans"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    month = Column(Date, nullable=False, index=True)
    request_id = Column(UUID(as_uuid=True), nullable=False)
    request_fingerprint = Column(String(64), nullable=False)
    name = Column(String(160), nullable=False)
    status = Column(String(20), nullable=False, default="DRAFT")
    target_mode = Column(String(30), nullable=False, default="ARRIVAL")
    source_hash = Column(String(64), nullable=True)
    working_calendar = Column(JSON, nullable=False, default=dict)
    version = Column(Integer, nullable=False, default=1)
    created_by = Column(String(200), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    entries = relationship("ProcurementPlanEntry", back_populates="plan", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("plant_id", "month", "name", name="uq_procurement_plan_month_name"),
        UniqueConstraint("plant_id", "request_id", name="uq_procurement_plan_request"),
    )


class ProcurementPlanEntry(Base):
    __tablename__ = "procurement_plan_entries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("procurement_plans.id"), nullable=False, index=True)
    entry_date = Column(Date, nullable=False, index=True)
    item_id = Column(UUID(as_uuid=True), ForeignKey("item_master.id"), nullable=False, index=True)
    supplier_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    supplier_name_snapshot = Column(String(200), nullable=True)
    material_form = Column(String(20), nullable=False, default="REEL")
    qty_kg = Column(Numeric(18, 3), nullable=False)
    expected_unit_count = Column(Integer, nullable=True)
    status = Column(String(20), nullable=False, default="PLANNED")
    notes = Column(Text, nullable=True)
    converted_qty_kg = Column(Numeric(18, 3), nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    plan = relationship("ProcurementPlan", back_populates="entries")
    item = relationship("ItemMaster")

    __table_args__ = (
        CheckConstraint("qty_kg >= 0", name="ck_procurement_plan_entry_qty"),
        CheckConstraint("expected_unit_count IS NULL OR expected_unit_count > 0", name="ck_procurement_plan_entry_count"),
    )


class PlanConversion(Base):
    __tablename__ = "procurement_plan_conversions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    request_id = Column(UUID(as_uuid=True), nullable=False)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("procurement_plans.id"), nullable=False, index=True)
    entry_ids = Column(JSON, nullable=False, default=list)
    purchase_order_ids = Column(JSON, nullable=False, default=list)
    payload_hash = Column(String(64), nullable=False)
    created_by = Column(String(200), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("plant_id", "request_id", name="uq_plan_conversion_request"),)


class MrpRun(Base):
    __tablename__ = "mrp_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    as_of_date = Column(Date, nullable=False)
    horizon_end = Column(Date, nullable=False)
    status = Column(String(20), nullable=False, default="COMPLETED")
    source_versions = Column(JSON, nullable=False, default=dict)
    results_json = Column(JSON, nullable=False, default=list)
    created_by = Column(String(200), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class StockAlertPolicy(Base):
    __tablename__ = "stock_alert_policies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    item_id = Column(UUID(as_uuid=True), ForeignKey("item_master.id"), nullable=True, index=True)
    request_id = Column(UUID(as_uuid=True), nullable=False)
    request_fingerprint = Column(String(64), nullable=False)
    scope_type = Column(String(20), nullable=False, default="ITEM")
    status = Column(String(20), nullable=False, default="DRAFT")
    stock_basis = Column(String(30), nullable=False, default="FREE_STOCK")
    safety_stock_kg = Column(Numeric(18, 3), nullable=False, default=0)
    reorder_point_kg = Column(Numeric(18, 3), nullable=False, default=0)
    target_stock_kg = Column(Numeric(18, 3), nullable=False, default=0)
    recovery_margin_kg = Column(Numeric(18, 3), nullable=False, default=0)
    lead_time_days = Column(Integer, nullable=False, default=0)
    minimum_order_kg = Column(Numeric(18, 3), nullable=False, default=0)
    order_multiple_kg = Column(Numeric(18, 3), nullable=False, default=0)
    recipients = Column(JSON, nullable=False, default=list)
    cooldown_hours = Column(Integer, nullable=False, default=24)
    change_reason = Column(Text, nullable=False)
    activation_reason = Column(Text, nullable=True)
    version = Column(Integer, nullable=False, default=1)
    created_by = Column(String(200), nullable=False)
    activated_by = Column(String(200), nullable=True)
    activated_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    item = relationship("ItemMaster")

    __table_args__ = (
        UniqueConstraint("plant_id", "item_id", "version", name="uq_stock_alert_policy_version"),
        UniqueConstraint("plant_id", "request_id", name="uq_stock_alert_policy_request"),
        CheckConstraint("safety_stock_kg >= 0 AND reorder_point_kg >= 0 AND target_stock_kg >= 0", name="ck_stock_alert_policy_thresholds"),
        CheckConstraint("target_stock_kg >= reorder_point_kg AND reorder_point_kg >= safety_stock_kg", name="ck_stock_alert_policy_order"),
    )


class StockAlertEpisode(Base):
    __tablename__ = "stock_alert_episodes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    policy_id = Column(UUID(as_uuid=True), ForeignKey("stock_alert_policies.id"), nullable=False, index=True)
    item_id = Column(UUID(as_uuid=True), ForeignKey("item_master.id"), nullable=False, index=True)
    status = Column(String(20), nullable=False, default="OPEN")
    severity = Column(String(20), nullable=False)
    stock_qty_kg = Column(Numeric(18, 3), nullable=False)
    threshold_qty_kg = Column(Numeric(18, 3), nullable=False)
    assignee = Column(String(200), nullable=True)
    acknowledged_by = Column(String(200), nullable=True)
    acknowledged_at = Column(DateTime, nullable=True)
    snoozed_until = Column(DateTime, nullable=True)
    breached_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    recovered_at = Column(DateTime, nullable=True)

    __table_args__ = (CheckConstraint("status IN ('OPEN','ACKNOWLEDGED','SNOOZED','RECOVERED')", name="ck_stock_alert_episode_status"),)


class RmCostSheet(Base):
    __tablename__ = "rm_cost_sheets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    item_id = Column(UUID(as_uuid=True), ForeignKey("item_master.id"), nullable=False, index=True)
    currency = Column(String(3), nullable=False, default="INR")
    base_uom = Column(String(12), nullable=False, default="KG")
    current_version_id = Column(UUID(as_uuid=True), nullable=True)
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    versions = relationship("RmCostVersion", back_populates="sheet", foreign_keys="RmCostVersion.sheet_id", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("plant_id", "item_id", "currency", name="uq_rm_cost_sheet_scope"),)


class RmCostVersion(Base):
    __tablename__ = "rm_cost_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sheet_id = Column(UUID(as_uuid=True), ForeignKey("rm_cost_sheets.id"), nullable=False, index=True)
    version_no = Column(Integer, nullable=False)
    request_id = Column(UUID(as_uuid=True), nullable=False)
    request_fingerprint = Column(String(64), nullable=False)
    status = Column(String(20), nullable=False, default="DRAFT")
    base_cost = Column(Numeric(18, 6), nullable=False)
    landed_cost = Column(Numeric(18, 6), nullable=False)
    effective_from = Column(Date, nullable=False)
    effective_to = Column(Date, nullable=True)
    change_reason = Column(Text, nullable=False)
    activation_reason = Column(Text, nullable=True)
    source = Column(String(80), nullable=True)
    content_hash = Column(String(64), nullable=False)
    created_by = Column(String(200), nullable=False)
    activated_by = Column(String(200), nullable=True)
    activated_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    sheet = relationship("RmCostSheet", back_populates="versions", foreign_keys=[sheet_id])
    components = relationship("RmCostComponent", back_populates="version", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("sheet_id", "version_no", name="uq_rm_cost_version_no"),
        UniqueConstraint("sheet_id", "request_id", name="uq_rm_cost_version_request"),
        CheckConstraint("base_cost >= 0 AND landed_cost >= 0", name="ck_rm_cost_nonnegative"),
        CheckConstraint("status IN ('DRAFT','SCHEDULED','ACTIVE','SUPERSEDED','CANCELLED')", name="ck_rm_cost_version_status"),
    )


class RmCostComponent(Base):
    __tablename__ = "rm_cost_components"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    version_id = Column(UUID(as_uuid=True), ForeignKey("rm_cost_versions.id"), nullable=False, index=True)
    component_type = Column(String(30), nullable=False)
    label = Column(String(120), nullable=False)
    calculation_mode = Column(String(20), nullable=False, default="PER_KG")
    entered_value = Column(Numeric(18, 6), nullable=False)
    normalized_per_kg = Column(Numeric(18, 6), nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
    metadata_json = Column(JSON, nullable=False, default=dict)

    version = relationship("RmCostVersion", back_populates="components")

    __table_args__ = (CheckConstraint("normalized_per_kg >= 0", name="ck_rm_cost_component_nonnegative"),)
