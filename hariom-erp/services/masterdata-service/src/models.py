import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from .database import Base


class PaperMaster(Base):
    __tablename__ = "paper_master"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(50), nullable=True, index=True)
    variety = Column(String(120), nullable=True)
    gsm = Column(Float, nullable=False, index=True)
    bf = Column(Float, nullable=True)
    thickness_mm = Column(Float, nullable=True)
    ply_bond = Column(Float, nullable=True)
    strength_type = Column(String(5), nullable=False)
    strength_value = Column(Integer, nullable=False)
    category = Column(String(50), default="KRAFT")
    price = Column(Float, nullable=True)
    bulk_factor = Column(Float, nullable=True)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("plant_id", "code", name="uq_paper_plant_code"),
    )


class AdhesiveMaster(Base):
    __tablename__ = "adhesive_master"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    variety = Column(String(100), nullable=True)
    internal_code = Column(String(50), nullable=False)
    solid_content_percent = Column(Float, nullable=True)
    viscosity = Column(Float, nullable=True)
    ph = Column(Float, nullable=True)
    color = Column(String(50), nullable=True)
    recipe_text = Column(Text, nullable=True)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("plant_id", "name", name="uq_adhesive_plant_name"),
        UniqueConstraint("plant_id", "internal_code", name="uq_adhesive_plant_code"),
    )


class ParchmentVendor(Base):
    __tablename__ = "parchment_vendor"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    colors = relationship("ParchmentColor", back_populates="vendor", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("plant_id", "name", name="uq_parchment_vendor_plant_name"),)


class ParchmentColor(Base):
    __tablename__ = "parchment_color"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("parchment_vendor.id"), nullable=False)
    color_name = Column(String(100), nullable=False)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    vendor = relationship("ParchmentVendor", back_populates="colors")

    __table_args__ = (UniqueConstraint("vendor_id", "color_name", name="_vendor_color_uc"),)


class TubeSize(Base):
    __tablename__ = "tube_size"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    inner_diameter_mm = Column(Float, nullable=False)
    outer_diameter_mm = Column(Float, nullable=False)
    length_mm = Column(Float, nullable=False)
    description = Column(String(200))
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Mandrel(Base):
    __tablename__ = "mandrel"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    mandrel_code = Column(String(50), nullable=False, index=True)
    outer_diameter_mm = Column(Float, nullable=False)
    od_tolerance_mm = Column(Float, nullable=False, default=0.1)
    length_mm = Column(Float, nullable=False)
    material = Column(String(100))
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    machine_links = relationship("MachineSupportedMandrel", back_populates="mandrel", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("plant_id", "mandrel_code", name="uq_mandrel_plant_code"),
    )


class Machine(Base):
    __tablename__ = "machine"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(50), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    department = Column(String(100), nullable=False)
    capacity_type = Column(String(40), nullable=False, default="TUBES_PER_DAY")
    capacity_value = Column(Float, nullable=False, default=0.0)
    batch_bamboo_capacity = Column(Float, nullable=True)
    cycle_time_hours = Column(Float, nullable=True)
    id_min_mm = Column(Float, nullable=False, default=0.0)
    id_max_mm = Column(Float, nullable=False, default=0.0)
    od_min_mm = Column(Float, nullable=False, default=0.0)
    od_max_mm = Column(Float, nullable=False, default=0.0)
    length_min_mm = Column(Float, nullable=False, default=0.0)
    length_max_mm = Column(Float, nullable=False, default=0.0)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    status = Column(String(20), nullable=False, default="UP")
    is_active = Column(Boolean, nullable=False, default=True)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    supported_mandrels = relationship("MachineSupportedMandrel", back_populates="machine", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("plant_id", "code", name="uq_machine_plant_code"),
        UniqueConstraint("plant_id", "name", name="uq_machine_plant_name"),
    )


class MachineSupportedMandrel(Base):
    __tablename__ = "machine_supported_mandrel"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    machine_id = Column(UUID(as_uuid=True), ForeignKey("machine.id", ondelete="CASCADE"), nullable=False, index=True)
    mandrel_id = Column(UUID(as_uuid=True), ForeignKey("mandrel.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    machine = relationship("Machine", back_populates="supported_mandrels")
    mandrel = relationship("Mandrel", back_populates="machine_links")

    __table_args__ = (
        UniqueConstraint("machine_id", "mandrel_id", name="uq_machine_supported_mandrel_pair"),
    )


class Customer(Base):
    __tablename__ = "customer"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_code = Column(String(50), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    address = Column(String(500), nullable=True)
    pan_no = Column(String(50), nullable=True)
    gst_no = Column(String(50), nullable=True)
    primary_contact_name = Column(String(200), nullable=True)
    primary_contact_phone = Column(String(50), nullable=True)
    primary_contact_email = Column(String(200), nullable=True)
    contact_email = Column(String(200), nullable=True)
    contact_phone = Column(String(50), nullable=True)
    billing_address = Column(String(500), nullable=True)
    shipping_address = Column(String(500), nullable=True)
    tax_id = Column(String(100), nullable=True)
    dispatch_contact_name = Column(String(200), nullable=True)
    dispatch_contact_phone = Column(String(50), nullable=True)
    # Master redesign — added so the cockpit UI can persist relationship metadata.
    category = Column(String(80), nullable=True)
    credit_limit = Column(Float, nullable=True)
    payment_terms = Column(String(120), nullable=True)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    contacts = relationship("CustomerContact", back_populates="customer", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("plant_id", "customer_code", name="uq_customer_plant_code"),
        UniqueConstraint("plant_id", "name", name="uq_customer_plant_name"),
    )


class CustomerContact(Base):
    __tablename__ = "customer_contact"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_id = Column(UUID(as_uuid=True), ForeignKey("customer.id"), nullable=False, index=True)
    department = Column(String(100), nullable=False)
    contact_name = Column(String(200), nullable=False)
    contact_phone = Column(String(50), nullable=True)
    contact_email = Column(String(200), nullable=True)
    notes = Column(Text, nullable=True)
    is_primary = Column(Boolean, default=False, nullable=False)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    customer = relationship("Customer", back_populates="contacts")


class Supplier(Base):
    __tablename__ = "supplier"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    supplier_code = Column(String(50), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    category = Column(String(80), nullable=False, default="RAW_MATERIAL")
    # Free-text category label used by the new master cockpit (the enum-style
    # `category` above is preserved for backwards compatibility with existing
    # screens that key off it).
    category_label = Column(String(120), nullable=True)
    contact_name = Column(String(200), nullable=True)
    contact_phone = Column(String(50), nullable=True)
    contact_email = Column(String(200), nullable=True)
    gst_no = Column(String(50), nullable=True)
    pan_no = Column(String(50), nullable=True)
    address = Column(String(500), nullable=True)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    contacts = relationship("SupplierContact", back_populates="supplier", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("plant_id", "supplier_code", name="uq_supplier_plant_code"),
        UniqueConstraint("plant_id", "name", name="uq_supplier_plant_name"),
    )


class SupplierContact(Base):
    __tablename__ = "supplier_contact"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    supplier_id = Column(UUID(as_uuid=True), ForeignKey("supplier.id"), nullable=False, index=True)
    department = Column(String(100), nullable=False, default="General")
    contact_name = Column(String(200), nullable=False)
    contact_phone = Column(String(50), nullable=True)
    contact_email = Column(String(200), nullable=True)
    notes = Column(Text, nullable=True)
    is_primary = Column(Boolean, default=False, nullable=False)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    supplier = relationship("Supplier", back_populates="contacts")


class PackagingBox(Base):
    __tablename__ = "packaging_box"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(50), nullable=False)
    length_mm = Column(Float, nullable=False)
    width_mm = Column(Float, nullable=False)
    height_mm = Column(Float, nullable=False)
    size_label = Column(String(120), nullable=False)
    weight_kg = Column(Float, nullable=True)
    rate_per_piece = Column(Float, nullable=True)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("plant_id", "code", name="uq_packaging_box_plant_code"),)


class PackagingPlasticSheet(Base):
    __tablename__ = "packaging_plastic_sheet"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sku = Column(String(50), nullable=False)
    size_label = Column(String(120), nullable=False)
    weight_kg = Column(Float, nullable=True)
    rate_per_kg = Column(Float, nullable=True)
    rate_per_piece = Column(Float, nullable=True)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("plant_id", "sku", name="uq_packaging_plastic_plant_sku"),)


class PackagingFadda(Base):
    __tablename__ = "packaging_fadda"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sku = Column(String(50), nullable=False)
    weight_kg = Column(Float, nullable=True)
    rate_per_kg = Column(Float, nullable=True)
    rate_per_piece = Column(Float, nullable=True)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("plant_id", "sku", name="uq_packaging_fadda_plant_sku"),)


class ToolMaster(Base):
    __tablename__ = "tool_master"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    category = Column(String(50), nullable=False, index=True)
    subcategory = Column(String(100), nullable=True)
    name = Column(String(150), nullable=False)
    code = Column(String(50), nullable=True)
    spec_text = Column(String(500), nullable=True)
    department = Column(String(20), nullable=False)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    status = Column(String(20), nullable=False, default="ACTIVE", index=True)
    location = Column(String(120), nullable=True)
    condition_notes = Column(Text, nullable=True)
    last_maintenance_at = Column(DateTime, nullable=True)
    next_maintenance_due = Column(DateTime, nullable=True)
    scrapped_at = Column(DateTime, nullable=True)
    usage_count = Column(Integer, nullable=False, default=0)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    usage_logs = relationship("ToolUsageLog", back_populates="tool")

    __table_args__ = (
        UniqueConstraint("plant_id", "category", "name", name="uq_tool_plant_category_name"),
        UniqueConstraint("plant_id", "code", name="uq_tool_plant_code"),
    )


class ToolUsageLog(Base):
    __tablename__ = "tool_usage_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tool_id = Column(UUID(as_uuid=True), ForeignKey("tool_master.id"), nullable=True, index=True)
    category = Column(String(50), nullable=False, index=True)
    tool_name = Column(String(150), nullable=False)
    event_type = Column(String(40), nullable=False, index=True)
    source_type = Column(String(40), nullable=False, index=True)
    source_id = Column(String(80), nullable=True, index=True)
    source_ref = Column(String(120), nullable=True)
    production_qty = Column(Float, nullable=True)
    actor = Column(String(150), nullable=True)
    notes = Column(Text, nullable=True)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    tool = relationship("ToolMaster", back_populates="usage_logs")


# ──────────────────────────────────────────────────────────────────────────
# Shop-floor masters
# ──────────────────────────────────────────────────────────────────────────


class Employee(Base):
    """People who work the shop floor: operators, supervisors, packers, QC, dispatch."""

    __tablename__ = "employee"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    employee_code = Column(String(40), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    role = Column(String(60), nullable=True)  # operator, supervisor, packer, qc, dispatch, etc.
    department = Column(String(80), nullable=True)  # WINDER / OVEN / PROCESS / PACKING / QC / DISPATCH / GENERAL
    phone = Column(String(50), nullable=True)
    email = Column(String(200), nullable=True)
    skills = Column(Text, nullable=True)  # CSV of stage types they can operate
    default_shift = Column(String(40), nullable=True)  # shift code from ShiftDefinition
    joining_date = Column(DateTime, nullable=True)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("plant_id", "employee_code", name="uq_employee_plant_code"),
    )


class ShiftDefinition(Base):
    """Named shift patterns per plant — e.g. Day A 06:00–14:00, Night C 22:00–06:00."""

    __tablename__ = "shift_definition"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(20), nullable=False, index=True)  # A / B / C / DAY / NIGHT
    name = Column(String(120), nullable=False)
    start_time = Column(String(5), nullable=False)  # "HH:MM" 24h
    end_time = Column(String(5), nullable=False)
    hours = Column(Float, nullable=False, default=8.0)
    is_night = Column(Boolean, default=False, nullable=False)
    break_minutes = Column(Integer, nullable=False, default=30)
    night_premium_percent = Column(Float, nullable=False, default=0.0)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("plant_id", "code", name="uq_shift_plant_code"),
    )


class PlantHoliday(Base):
    """Non-working days per plant — public holidays, plant shutdowns, planned maintenance."""

    __tablename__ = "plant_holiday"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    holiday_date = Column(DateTime, nullable=False, index=True)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    holiday_type = Column(String(40), nullable=False, default="PUBLIC_HOLIDAY")
    # PUBLIC_HOLIDAY | PLANT_HOLIDAY | MAINTENANCE_DAY | STRIKE | POWER_CUT | OTHER
    description = Column(String(300), nullable=True)
    impact_shifts = Column(String(100), nullable=True)  # CSV of shift codes affected, empty = all
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("plant_id", "holiday_date", "holiday_type", name="uq_holiday_plant_date_type"),
    )


class ReasonCode(Base):
    """Normalized reason taxonomy for downtime / scrap / QC reject / short-close / RM issue / return."""

    __tablename__ = "reason_code"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(40), nullable=False, index=True)  # e.g. DT-POWER, SCR-MOISTURE, SHORT-RM
    label = Column(String(200), nullable=False)
    category = Column(String(40), nullable=False, index=True)
    # DOWNTIME | SCRAP | QC_REJECT | SHORT_CLOSE | RM_ISSUE | RETURN | OTHER
    severity = Column(String(20), nullable=False, default="WATCH")  # OK | WATCH | CRITICAL
    description = Column(String(500), nullable=True)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("plant_id", "code", name="uq_reason_plant_code"),
    )
