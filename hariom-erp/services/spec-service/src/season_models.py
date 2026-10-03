"""Seasonal configuration, immutable revisions and command receipts."""
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, Boolean, DateTime, Text, JSON, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from .database import Base


class SeasonState(Base):
    __tablename__ = "production_season_state"
    id = Column(String(50), primary_key=True, default="ORGANIZATION")
    active_season = Column(String(12), nullable=False, default="ROY")
    epoch = Column(Integer, nullable=False, default=1)
    switched_by = Column(String(200))
    switched_at = Column(DateTime)


class RuleVersion(Base):
    __tablename__ = "season_qc_rule_versions"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    scope_id = Column(String(50), nullable=False, default="ORGANIZATION")
    season = Column(String(12), nullable=False)
    version = Column(Integer, nullable=False)
    status = Column(String(20), nullable=False, default="DRAFT")
    rules = Column(JSON, nullable=False)
    fingerprint = Column(String(64), nullable=False)
    row_version = Column(Integer, nullable=False, default=1)
    change_note = Column(Text, nullable=False)
    created_by = Column(String(200))
    created_at = Column(DateTime, default=datetime.utcnow)
    published_by = Column(String(200))
    published_at = Column(DateTime)
    __table_args__ = (UniqueConstraint("scope_id", "season", "version", name="uq_season_qc_version"),)


class OverlayVersion(Base):
    __tablename__ = "season_qc_overlay_versions"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    target_type = Column(String(12), nullable=False)
    target_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    season = Column(String(12), nullable=False)
    version = Column(Integer, nullable=False)
    status = Column(String(20), nullable=False, default="DRAFT")
    rules = Column(JSON, nullable=False)
    fingerprint = Column(String(64), nullable=False)
    row_version = Column(Integer, nullable=False, default=1)
    reason = Column(Text, nullable=False)
    loosens = Column(Boolean, nullable=False, default=False)
    parent_fingerprint = Column(String(64))
    created_by = Column(String(200))
    created_at = Column(DateTime, default=datetime.utcnow)
    published_by = Column(String(200))
    published_at = Column(DateTime)
    __table_args__ = (UniqueConstraint("plant_id", "target_type", "target_id", "season", "version", name="uq_season_overlay_version"),)


class RecipeBinding(Base):
    __tablename__ = "spec_season_recipe_bindings"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    spec_id = Column(UUID(as_uuid=True), ForeignKey("specification_sheet.id"), nullable=False, index=True)
    season = Column(String(12), nullable=False)
    recipe_id = Column(UUID(as_uuid=True), ForeignKey("recipe_header.id"), nullable=False)
    draft_recipe_id = Column(UUID(as_uuid=True), nullable=True)
    confirmed_hash = Column(String(64))
    confirmed_by = Column(String(200))
    confirmed_at = Column(DateTime)
    approved = Column(Boolean, nullable=False, default=False)
    approved_context = Column(String(64))
    __table_args__ = (UniqueConstraint("spec_id", "season", name="uq_spec_season_binding"),)


class SeasonEvent(Base):
    __tablename__ = "production_season_events"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    scope_id = Column(String(50), nullable=False, default="ORGANIZATION")
    action = Column(String(50), nullable=False)
    actor = Column(String(200), nullable=False)
    note = Column(Text, nullable=False)
    payload = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class SeasonReceipt(Base):
    __tablename__ = "season_command_receipts"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    operation_key = Column(String(200), nullable=False, unique=True)
    fingerprint = Column(String(64), nullable=False)
    response = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class ReleaseAuthorization(Base):
    __tablename__ = "season_release_authorizations"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False)
    operation_key = Column(String(120), nullable=False)
    request_hash = Column(String(64), nullable=False)
    spec_id = Column(UUID(as_uuid=True), nullable=False)
    season = Column(String(12), nullable=False)
    epoch = Column(Integer, nullable=False)
    bundle = Column(JSON, nullable=False)
    bundle_hash = Column(String(64), nullable=False)
    authorized_by = Column(String(200), nullable=False)
    authorized_at = Column(DateTime, default=datetime.utcnow)
    status = Column(String(20), nullable=False, default="AUTHORIZED")
    job_card_id = Column(UUID(as_uuid=True))
    acknowledged_at = Column(DateTime)
    __table_args__ = (UniqueConstraint("plant_id", "operation_key", name="uq_season_release_operation"),)


class SpecReadiness(Base):
    __tablename__ = "season_spec_readiness"
    spec_id = Column(UUID(as_uuid=True), ForeignKey("specification_sheet.id"), primary_key=True)
    season = Column(String(12), primary_key=True)
    ready = Column(Boolean, nullable=False, default=False, index=True)
    details = Column(JSON, nullable=False, default=dict)
    updated_at = Column(DateTime, default=datetime.utcnow)
