import uuid
from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey, DateTime, Text, UniqueConstraint, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base

class SpecificationSheet(Base):
    __tablename__ = "specification_sheet"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_name = Column(String(200), nullable=False)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT_A")
    customer_id = Column(UUID(as_uuid=True), nullable=True)
    customer_name_snapshot = Column(String(200), nullable=True)
    
    # Foreign Keys to masterdata (stored as UUIDs, no actual FK constraint)
    tube_size_id = Column(UUID(as_uuid=True), nullable=False)
    mandrel_id = Column(UUID(as_uuid=True), nullable=False)
    target_tube_weight = Column(Float, nullable=False, default=0.0)
    id_min_mm = Column(Float, nullable=True)
    id_max_mm = Column(Float, nullable=True)
    od_min_mm = Column(Float, nullable=True)
    od_max_mm = Column(Float, nullable=True)
    length_min_mm = Column(Float, nullable=True)
    length_max_mm = Column(Float, nullable=True)
    weight_min_g = Column(Float, nullable=True)
    weight_max_g = Column(Float, nullable=True)
    cs_min_n = Column(Float, nullable=True)
    cs_max_n = Column(Float, nullable=True)
    moisture_min_pct = Column(Float, nullable=True)
    moisture_max_pct = Column(Float, nullable=True)
    
    # Crush Strength
    required_cs = Column(Float, nullable=False)
    approved_cs = Column(Float, nullable=True)
    
    # Parchment (1.5% weight addition only)
    parchment_percent = Column(Float, default=1.5)
    parchment_color = Column(String(100), nullable=True)
    parchment_allowed = Column(Boolean, default=True)

    # Global adhesive & moisture (overridable per spec)
    adhesive_percent = Column(Float, default=15.0)
    moisture_loss_percent = Column(Float, default=9.0)

    # Adhesives (ratio split, not weight-based)
    adhesive_20100_percent = Column(Float, nullable=True)
    adhesive_30100_percent = Column(Float, nullable=True)

    # Manufacturing parameters
    shrink_percent = Column(Float, default=10)
    bamboo_max_length = Column(Integer, default=1560)
    cut_loss_mm = Column(Integer, default=40)
    
    # Version control
    status = Column(String(20), default="draft")
    version = Column(Integer, default=1)
    active = Column(Boolean, default=True)
    created_by = Column(String(200), nullable=True)
    approved_by = Column(String(200), nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    recipes = relationship("RecipeHeader", back_populates="specification", cascade="all, delete-orphan")
    dynamic_values = relationship("SpecDynamicFieldValue", back_populates="specification", cascade="all, delete-orphan")

class RecipeHeader(Base):
    __tablename__ = "recipe_header"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    spec_id = Column(UUID(as_uuid=True), ForeignKey('specification_sheet.id'), nullable=False)
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT_A")
    version = Column(Integer, nullable=False)
    status = Column(String(20), default="trial")
    notes = Column(Text, nullable=True)
    created_by = Column(String(200), nullable=True)
    approved_by = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    specification = relationship("SpecificationSheet", back_populates="recipes")
    layers = relationship("RecipeLayer", back_populates="recipe", cascade="all, delete-orphan")
    trials = relationship("TrialResult", back_populates="recipe", cascade="all, delete-orphan")
    
    __table_args__ = (
        UniqueConstraint('spec_id', 'version', name='_spec_version_uc'),
    )

class RecipeLayer(Base):
    __tablename__ = "recipe_layers"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recipe_id = Column(UUID(as_uuid=True), ForeignKey('recipe_header.id'), nullable=False)
    ply_no = Column(Integer, nullable=False)
    
    # Foreign key to masterdata (stored as UUID)
    paper_id = Column(UUID(as_uuid=True), nullable=False)
    
    # SNAPSHOT values (critical for historical accuracy)
    gsm_snapshot = Column(Float, nullable=False)
    bf_snapshot = Column(Float, nullable=False)
    bulk_snapshot = Column(Float, nullable=True)
    
    # Relationships
    recipe = relationship("RecipeHeader", back_populates="layers")
    
    __table_args__ = (
        UniqueConstraint('recipe_id', 'ply_no', name='_recipe_ply_uc'),
    )

class TrialResult(Base):
    __tablename__ = "trial_results"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recipe_id = Column(UUID(as_uuid=True), ForeignKey('recipe_header.id'), nullable=False)
    
    # Actual measured values
    actual_cs = Column(Float, nullable=True)
    actual_weight = Column(Float, nullable=True)
    actual_shrink = Column(Float, nullable=True)
    
    remarks = Column(Text, nullable=True)
    approved = Column(Boolean, default=False)
    tested_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    recipe = relationship("RecipeHeader", back_populates="trials")


class SpecDynamicField(Base):
    __tablename__ = "spec_dynamic_fields"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key = Column(String(100), nullable=False, index=True) # Removed global unique constraint
    plant_id = Column(String(50), nullable=False, index=True, default="PLANT_A")
    label = Column(String(200), nullable=False)
    field_type = Column(String(50), nullable=False)  # text, number, boolean, select
    required = Column(Boolean, default=False)
    options = Column(JSON, nullable=True)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    values = relationship("SpecDynamicFieldValue", back_populates="field", cascade="all, delete-orphan")


class GlobalSpecDefaults(Base):
    __tablename__ = "global_spec_defaults"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True, unique=True, default="PLANT_A")
    adhesive_percent = Column(Float, nullable=False, default=15.0)
    parchment_percent = Column(Float, nullable=False, default=1.5)
    moisture_loss_percent = Column(Float, nullable=False, default=9.0)
    updated_at = Column(DateTime, default=datetime.utcnow)


class SpecDynamicFieldValue(Base):
    __tablename__ = "spec_dynamic_field_values"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    spec_id = Column(UUID(as_uuid=True), ForeignKey("specification_sheet.id"), nullable=False)
    field_id = Column(UUID(as_uuid=True), ForeignKey("spec_dynamic_fields.id"), nullable=False)
    value = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    specification = relationship("SpecificationSheet", back_populates="dynamic_values")
    field = relationship("SpecDynamicField", back_populates="values")

    __table_args__ = (
        UniqueConstraint("spec_id", "field_id", name="_spec_field_uc"),
    )
