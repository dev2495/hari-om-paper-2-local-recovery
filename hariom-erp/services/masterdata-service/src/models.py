import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
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
    id_min_mm = Column(Float, nullable=False, default=0.0)
    id_max_mm = Column(Float, nullable=False, default=0.0)
    od_min_mm = Column(Float, nullable=False, default=0.0)
    od_max_mm = Column(Float, nullable=False, default=0.0)
    length_min_mm = Column(Float, nullable=False, default=0.0)
    length_max_mm = Column(Float, nullable=False, default=0.0)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
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
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    customer = relationship("Customer", back_populates="contacts")


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
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("plant_id", "category", "name", name="uq_tool_plant_category_name"),
        UniqueConstraint("plant_id", "code", name="uq_tool_plant_code"),
    )
