import uuid
from sqlalchemy import Column, String, Integer, Boolean, ForeignKey, DateTime, UniqueConstraint
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
