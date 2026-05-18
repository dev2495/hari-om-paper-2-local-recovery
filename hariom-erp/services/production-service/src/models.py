import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from .database import Base


PLANT_A_UUID = uuid.UUID("00000000-0000-0000-0000-0000000000a1")
PLANT_B_UUID = uuid.UUID("00000000-0000-0000-0000-0000000000b2")


class ProductionJob(Base):
    __tablename__ = "production_job"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_card_no = Column(String(50), unique=True, nullable=True)
    date = Column(Date, nullable=False)
    plant_id = Column(UUID(as_uuid=True), nullable=False, index=True, default=PLANT_A_UUID)
    shift = Column(String(20), nullable=False)
    sales_order_id = Column(UUID(as_uuid=True), nullable=True)
    sales_order_line_id = Column(UUID(as_uuid=True), nullable=True)
    spec_id = Column(UUID(as_uuid=True), nullable=False)
    recipe_id = Column(UUID(as_uuid=True), nullable=False)
    planned_tubes_qty = Column(Float, nullable=False, default=0.0)
    parchment_color = Column(String(100), nullable=True)
    operator_name = Column(String(100), nullable=False)
    supervisor_name = Column(String(100), nullable=True)
    mandrel_id = Column(UUID(as_uuid=True), nullable=False)
    total_reel_weight_issued = Column(Float, nullable=False)
    bamboo_produced_qty = Column(Integer, nullable=False, default=0)
    bamboo_scrap_qty = Column(Integer, nullable=False, default=0)
    bamboo_weight_total = Column(Float, nullable=False, default=0.0)
    oven_input_weight = Column(Float, nullable=False, default=0.0)
    oven_output_weight = Column(Float, nullable=False, default=0.0)
    tubes_produced_qty = Column(Integer, nullable=False, default=0)
    tube_scrap_qty = Column(Integer, nullable=False, default=0)
    finished_weight = Column(Float, nullable=False, default=0.0)
    actual_cs = Column(Float, nullable=True)
    notes = Column(Text, nullable=True)
    job_state = Column(String(20), nullable=False, default="draft")
    tube_length_mm = Column(Integer, nullable=False, default=150)
    expected_tubes_per_bamboo = Column(Float, nullable=True)
    expected_tube_weight = Column(Float, nullable=True)
    piece_variance_percent = Column(Float, nullable=True)
    weight_variance_percent = Column(Float, nullable=True)
    variance_severity = Column(String(20), nullable=True)
    fg_posted = Column(Boolean, nullable=False, default=False)
    fg_transaction_ref = Column(String(120), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    validated_at = Column(DateTime, nullable=True)
    validated_by = Column(String(200), nullable=True)
    closed_at = Column(DateTime, nullable=True)
    closed_by = Column(String(200), nullable=True)

    reel_issues = relationship("ReelIssue", back_populates="job", cascade="all, delete-orphan")


class ReelIssue(Base):
    __tablename__ = "reel_issues"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id = Column(UUID(as_uuid=True), ForeignKey("production_job.id"), nullable=False)
    plant_id = Column(UUID(as_uuid=True), nullable=False, index=True, default=PLANT_A_UUID)
    reel_barcode = Column(String(100), nullable=False)
    weight_used = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    job = relationship("ProductionJob", back_populates="reel_issues")


class SalesOrder(Base):
    __tablename__ = "sales_orders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(UUID(as_uuid=True), nullable=False, index=True, default=PLANT_A_UUID)
    customer_id = Column(UUID(as_uuid=True), nullable=False)
    spec_id = Column(UUID(as_uuid=True), nullable=False)
    order_qty = Column(Float, nullable=False)
    due_date = Column(Date, nullable=False)
    priority = Column(String(20), nullable=False, default="NORMAL")
    status = Column(String(20), nullable=False, default="OPEN")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    job_cards = relationship("JobCard", back_populates="sales_order", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("priority IN ('LOW','NORMAL','HIGH')", name="ck_sales_orders_priority"),
        CheckConstraint("status IN ('OPEN','PLANNED','COMPLETED','CANCELLED')", name="ck_sales_orders_status"),
        CheckConstraint("order_qty > 0", name="ck_sales_orders_qty_positive"),
    )


class JobCard(Base):
    __tablename__ = "job_cards"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(UUID(as_uuid=True), nullable=False, index=True, default=PLANT_A_UUID)
    sales_order_id = Column(UUID(as_uuid=True), ForeignKey("sales_orders.id"), nullable=False, index=True)
    sales_order_line_id = Column(UUID(as_uuid=True), nullable=True)
    release_lot_id = Column(UUID(as_uuid=True), nullable=True)
    spec_id = Column(UUID(as_uuid=True), nullable=False)
    spec_snapshot = Column(JSONB, nullable=False, default=dict)
    routing_snapshot = Column(JSONB, nullable=False, default=dict)
    material_plan_snapshot = Column(JSONB, nullable=False, default=dict)
    released_qty = Column(Float, nullable=False, default=0.0)
    assigned_winder_machine_id = Column(UUID(as_uuid=True), nullable=True)
    product_code = Column(String(120), nullable=True)
    planned_qty = Column(Float, nullable=False)
    status = Column(String(20), nullable=False, default="CREATED")
    current_stage = Column(String(20), nullable=False, default="WINDER")
    requires_slitting = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    sales_order = relationship("SalesOrder", back_populates="job_cards")
    stages = relationship("JobCardStage", back_populates="job_card", cascade="all, delete-orphan")
    queue_entries = relationship("StageQueueOrder", back_populates="job_card", cascade="all, delete-orphan")
    stage_segments = relationship("JobCardStageSegment", back_populates="job_card", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint(
            "status IN ('CREATED','PLANNED','IN_PROGRESS','COMPLETED','CANCELLED')",
            name="ck_job_cards_status",
        ),
        CheckConstraint(
            "current_stage IN ('WINDER','OVEN','PROCESS','PACKING','DONE')",
            name="ck_job_cards_current_stage",
        ),
        CheckConstraint("planned_qty > 0", name="ck_job_cards_qty_positive"),
    )


class JobCardStage(Base):
    __tablename__ = "job_card_stages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_card_id = Column(UUID(as_uuid=True), ForeignKey("job_cards.id"), nullable=False, index=True)
    stage_type = Column(String(20), nullable=False)
    machine_id = Column(UUID(as_uuid=True), nullable=True)
    planned_start = Column(DateTime, nullable=True)
    planned_end = Column(DateTime, nullable=True)
    actual_start = Column(DateTime, nullable=True)
    actual_end = Column(DateTime, nullable=True)
    input_qty = Column(Float, nullable=True)
    output_qty = Column(Float, nullable=True)
    scrap_qty = Column(Float, nullable=True)
    status = Column(String(20), nullable=False, default="PLANNED")
    reel_issue_ids = Column(JSONB, nullable=False, default=list)
    entry_snapshot = Column(JSONB, nullable=False, default=dict)
    actuals_snapshot = Column(JSONB, nullable=False, default=dict)
    quality_checks = Column(JSONB, nullable=False, default=dict)
    material_allocations = Column(JSONB, nullable=False, default=list)
    location_id = Column(UUID(as_uuid=True), nullable=True)
    plan_date = Column(Date, nullable=True)
    shift_code = Column(String(20), nullable=True)
    required_capacity = Column(Float, nullable=True)
    remarks = Column(Text, nullable=True)
    entered_by = Column(String(200), nullable=True)
    entered_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    job_card = relationship("JobCard", back_populates="stages")

    __table_args__ = (
        UniqueConstraint("job_card_id", "stage_type", name="uq_job_card_stage_type"),
        CheckConstraint(
            "stage_type IN ('WINDER','OVEN','PROCESS','PACKING')",
            name="ck_job_card_stages_type",
        ),
        CheckConstraint(
            "status IN ('PLANNED','QUEUED','ASSIGNED','RUNNING','COMPLETED')",
            name="ck_job_card_stages_status",
        ),
        CheckConstraint("COALESCE(input_qty, 0) >= 0", name="ck_job_card_stages_input_nonnegative"),
        CheckConstraint("COALESCE(output_qty, 0) >= 0", name="ck_job_card_stages_output_nonnegative"),
        CheckConstraint("COALESCE(scrap_qty, 0) >= 0", name="ck_job_card_stages_scrap_nonnegative"),
    )


class JobCardStageSegment(Base):
    __tablename__ = "job_card_stage_segments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(UUID(as_uuid=True), nullable=False, index=True, default=PLANT_A_UUID)
    job_card_id = Column(UUID(as_uuid=True), ForeignKey("job_cards.id"), nullable=False, index=True)
    stage_type = Column(String(20), nullable=False)
    segment_no = Column(Integer, nullable=False, default=1)
    machine_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    plan_date = Column(Date, nullable=True)
    shift_code = Column(String(20), nullable=True)
    planned_qty = Column(Float, nullable=False, default=0.0)
    input_qty = Column(Float, nullable=True)
    output_qty = Column(Float, nullable=True)
    scrap_qty = Column(Float, nullable=True)
    required_capacity = Column(Float, nullable=False, default=0.0)
    status = Column(String(20), nullable=False, default="QUEUED")
    split_source = Column(String(20), nullable=False, default="NONE")
    split_parent_segment_id = Column(UUID(as_uuid=True), nullable=True)
    sequence_no = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    job_card = relationship("JobCard", back_populates="stage_segments")

    __table_args__ = (
        CheckConstraint(
            "stage_type IN ('SLITTING','WINDER','OVEN','PROCESS','PACKING','QC','DISPATCH')",
            name="ck_job_card_stage_segments_type",
        ),
        CheckConstraint(
            "status IN ('PLANNED','QUEUED','ASSIGNED','RUNNING','COMPLETED','CANCELLED')",
            name="ck_job_card_stage_segments_status",
        ),
        CheckConstraint("segment_no > 0", name="ck_job_card_stage_segments_segment_positive"),
        CheckConstraint("sequence_no > 0", name="ck_job_card_stage_segments_sequence_positive"),
    )


class StageQueueOrder(Base):
    __tablename__ = "stage_queue_order"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(UUID(as_uuid=True), nullable=False, index=True, default=PLANT_A_UUID)
    stage_type = Column(String(20), nullable=False)
    machine_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    job_card_id = Column(UUID(as_uuid=True), ForeignKey("job_cards.id"), nullable=False, index=True)
    sequence_no = Column(Integer, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    plan_date = Column(Date, nullable=True)
    shift_code = Column(String(20), nullable=True)
    required_capacity = Column(Float, nullable=True)

    job_card = relationship("JobCard", back_populates="queue_entries")

    __table_args__ = (
        UniqueConstraint("job_card_id", "stage_type", name="uq_stage_queue_job_stage"),
        CheckConstraint(
            "stage_type IN ('WINDER','OVEN','PROCESS','PACKING')",
            name="ck_stage_queue_type",
        ),
        CheckConstraint("sequence_no > 0", name="ck_stage_queue_sequence_positive"),
    )


class MachineStageCapacityProfile(Base):
    __tablename__ = "machine_stage_capacity_profile"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(UUID(as_uuid=True), nullable=False, index=True, default=PLANT_A_UUID)
    machine_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    stage_type = Column(String(20), nullable=False)
    capacity_unit = Column(String(30), nullable=False)
    capacity_value = Column(Float, nullable=False)
    effective_date = Column(Date, nullable=True)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint(
            "plant_id",
            "machine_id",
            "stage_type",
            "capacity_unit",
            "effective_date",
            name="uq_machine_stage_capacity_profile",
        ),
        CheckConstraint(
            "stage_type IN ('WINDER','OVEN','PROCESS')",
            name="ck_machine_stage_capacity_stage_type",
        ),
        CheckConstraint(
            "capacity_unit IN ('BAMBOOS_PER_DAY','METERS_PER_DAY','BATCHES_PER_DAY','TUBES_PER_DAY')",
            name="ck_machine_stage_capacity_unit",
        ),
        CheckConstraint("capacity_value > 0", name="ck_machine_stage_capacity_positive"),
    )


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(UUID(as_uuid=True), nullable=False, index=True, default=PLANT_A_UUID)
    entity_type = Column(String(60), nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    action = Column(String(60), nullable=False)
    actor_id = Column(String(200), nullable=True)
    actor_role = Column(String(120), nullable=True)
    job_card_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    request_id = Column(String(120), nullable=True)
    before_hash = Column(String(128), nullable=True)
    after_hash = Column(String(128), nullable=True)
    payload = Column(JSONB, nullable=False, default=dict)
    event_ts = Column(DateTime, nullable=False, default=datetime.utcnow)


class QualityInspection(Base):
    __tablename__ = "quality_inspections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(UUID(as_uuid=True), nullable=False, index=True, default=PLANT_A_UUID)
    job_card_id = Column(UUID(as_uuid=True), ForeignKey("job_cards.id"), nullable=False, index=True)
    stage_type = Column(String(20), nullable=False)
    status = Column(String(20), nullable=False)
    readings = Column(JSONB, nullable=False, default=dict)
    failures = Column(JSONB, nullable=False, default=list)
    created_by = Column(String(200), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class QualityHold(Base):
    __tablename__ = "quality_holds"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(UUID(as_uuid=True), nullable=False, index=True, default=PLANT_A_UUID)
    job_card_id = Column(UUID(as_uuid=True), ForeignKey("job_cards.id"), nullable=False, index=True)
    stage_type = Column(String(20), nullable=False)
    batch_id = Column(UUID(as_uuid=True), nullable=True)
    reason = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default="HOLD")
    source_inspection_id = Column(UUID(as_uuid=True), nullable=True)
    created_by = Column(String(200), nullable=True)
    released_by = Column(String(200), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    released_at = Column(DateTime, nullable=True)


class PackingRecord(Base):
    __tablename__ = "packing_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(UUID(as_uuid=True), nullable=False, index=True, default=PLANT_A_UUID)
    job_card_id = Column(UUID(as_uuid=True), ForeignKey("job_cards.id"), nullable=False, index=True)
    fg_item_id = Column(UUID(as_uuid=True), nullable=True)
    fg_batch_no = Column(String(120), nullable=True)
    qty_per_bundle = Column(Float, nullable=False, default=0.0)
    bundle_count = Column(Integer, nullable=False, default=0)
    total_packed_qty = Column(Float, nullable=False, default=0.0)
    location_id = Column(UUID(as_uuid=True), nullable=True)
    stock_status = Column(String(40), nullable=True)
    snapshot = Column(JSONB, nullable=False, default=dict)
    created_by = Column(String(200), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class MonthlyMaterialProvisional(Base):
    __tablename__ = "monthly_material_provisionals"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(UUID(as_uuid=True), nullable=False, index=True, default=PLANT_A_UUID)
    month_start = Column(Date, nullable=False, index=True)
    job_card_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    sales_order_line_id = Column(UUID(as_uuid=True), nullable=True)
    item_code = Column(String(120), nullable=False)
    item_name = Column(String(255), nullable=True)
    provisional_theory_consumption_kg = Column(Float, nullable=False, default=0.0)
    advisory_allocated_order_qty = Column(Float, nullable=False, default=0.0)
    source_stage = Column(String(30), nullable=True)
    snapshot = Column(JSONB, nullable=False, default=dict)
    created_by = Column(String(200), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class MonthlyMaterialActual(Base):
    __tablename__ = "monthly_material_actuals"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(UUID(as_uuid=True), nullable=False, index=True, default=PLANT_A_UUID)
    month_start = Column(Date, nullable=False, index=True)
    item_code = Column(String(120), nullable=False)
    item_name = Column(String(255), nullable=True)
    actual_consumed_weight_kg = Column(Float, nullable=False, default=0.0)
    import_batch_id = Column(UUID(as_uuid=True), nullable=True)
    notes = Column(Text, nullable=True)
    created_by = Column(String(200), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    actual_cost = Column(Float, nullable=False, default=0.0)


class MonthlyMaterialClose(Base):
    __tablename__ = "monthly_material_close"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(UUID(as_uuid=True), nullable=False, index=True, default=PLANT_A_UUID)
    month_start = Column(Date, nullable=False, index=True)
    status = Column(String(30), nullable=False, default="OPEN")
    import_batch_id = Column(UUID(as_uuid=True), nullable=True)
    imported_rows_count = Column(Integer, nullable=False, default=0)
    approved_by = Column(String(200), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    locked_at = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class ShiftMaterialLedger(Base):
    __tablename__ = "shift_material_ledger"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(UUID(as_uuid=True), nullable=False, index=True, default=PLANT_A_UUID)
    stage_type = Column(String(20), nullable=False)
    work_date = Column(Date, nullable=False, index=True)
    shift_code = Column(String(20), nullable=False)
    machine_id = Column(UUID(as_uuid=True), nullable=True)
    reel_issue_ids = Column(JSONB, nullable=False, default=list)
    parent_reel_id = Column(String(120), nullable=True)
    child_reel_ids = Column(JSONB, nullable=False, default=list)
    issued_weight_kg = Column(Float, nullable=False, default=0.0)
    consumed_weight_kg = Column(Float, nullable=False, default=0.0)
    slit_output_weight_kg = Column(Float, nullable=False, default=0.0)
    wastage_weight_kg = Column(Float, nullable=False, default=0.0)
    remaining_weight_kg = Column(Float, nullable=False, default=0.0)
    actual_job_card_ids = Column(JSONB, nullable=False, default=list)
    notes = Column(Text, nullable=True)
    created_by = Column(String(200), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    issue_section = Column(String(60), nullable=True)
    transfer_snapshot = Column(JSONB, nullable=False, default=dict)


class Dispatch(Base):
    __tablename__ = "dispatch"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_card_id = Column(UUID(as_uuid=True), ForeignKey("job_cards.id"), nullable=False, unique=True, index=True)
    dispatch_snapshot = Column(JSONB, nullable=False, default=dict)
    status = Column(String(20), nullable=False, default="DRAFT")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    job_card = relationship("JobCard")

    __table_args__ = (
        CheckConstraint("status IN ('DRAFT', 'SEALED')", name="ck_dispatch_status"),
    )


class DispatchIdempotency(Base):
    __tablename__ = "dispatch_idempotency"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(UUID(as_uuid=True), nullable=False, index=True, default=PLANT_A_UUID)
    request_id = Column(String(120), nullable=False)
    job_card_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    request_hash = Column(String(128), nullable=False)
    status = Column(String(20), nullable=False, default="PENDING")
    response_snapshot = Column(JSONB, nullable=False, default=dict)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
