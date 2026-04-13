import uuid
from sqlalchemy import Column, String, Integer, Boolean, ForeignKey, DateTime, UniqueConstraint, Float, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base

class PaperMaster(Base):
    __tablename__ = "paper_master"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    gsm = Column(Integer, nullable=False, index=True)
    strength_type = Column(String(5), nullable=False)
    strength_value = Column(Integer, nullable=False)
    category = Column(String(50), default="KRAFT")
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class AdhesiveMaster(Base):
    __tablename__ = "adhesive_master"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False, unique=True)
    internal_code = Column(String(50), nullable=False, unique=True)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class ParchmentVendor(Base):
    __tablename__ = "parchment_vendor"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False, unique=True)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    colors = relationship("ParchmentColor", back_populates="vendor", cascade="all, delete-orphan")

class ParchmentColor(Base):
    __tablename__ = "parchment_color"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey('parchment_vendor.id'), nullable=False)
    color_name = Column(String(100), nullable=False)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    vendor = relationship("ParchmentVendor", back_populates="colors")
    
    __table_args__ = (UniqueConstraint('vendor_id', 'color_name', name='_vendor_color_uc'),)

class TubeSize(Base):
    __tablename__ = "tube_size"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    inner_diameter_mm = Column(Integer, nullable=False)
    outer_diameter_mm = Column(Integer, nullable=False)
    length_mm = Column(Integer, nullable=False)
    description = Column(String(200))
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class Mandrel(Base):
    __tablename__ = "mandrel"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    mandrel_code = Column(String(50), nullable=False, unique=True, index=True)
    outer_diameter_mm = Column(Integer, nullable=False)
    length_mm = Column(Integer, nullable=False)
    material = Column(String(100))
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class Machine(Base):
    __tablename__ = "machine"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False, unique=True)
    department = Column(String(100), nullable=False)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Customer(Base):
    __tablename__ = "customer"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_code = Column(String(50), nullable=False, unique=True, index=True)
    name = Column(String(200), nullable=False, unique=True)
    contact_email = Column(String(200), nullable=True)
    contact_phone = Column(String(50), nullable=True)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT-1")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


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
