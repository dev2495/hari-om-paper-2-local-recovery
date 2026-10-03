import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, DateTime, Date, Text, ForeignKey, UniqueConstraint, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from .database import Base


class StageEntry(Base):
    __tablename__ = "continuous_stage_entries"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    job_card_id = Column(UUID(as_uuid=True), ForeignKey("job_cards.id"), nullable=False, index=True)
    stage = Column(String(20), nullable=False)
    entry_no = Column(Integer, nullable=False)
    status = Column(String(12), nullable=False, default="DRAFT")
    kind = Column(String(12), nullable=False, default="PRODUCTION")
    business_date = Column(Date, nullable=True)
    shift_code = Column(String(20))
    operator_id = Column(UUID(as_uuid=True))
    operator_name = Column(String(200))
    operator_code = Column(String(40))
    produced = Column(Integer, nullable=False, default=0)
    accepted = Column(Integer, nullable=False, default=0)
    rejected = Column(Integer, nullable=False, default=0)
    input_quantity = Column(Integer, nullable=False, default=0)
    cutting_loss_pcs = Column(Integer, nullable=False, default=0)
    carry_in_pcs = Column(Integer, nullable=False, default=0)
    carry_out_pcs = Column(Integer, nullable=False, default=0)
    segment_id = Column(UUID(as_uuid=True))
    machine_id = Column(UUID(as_uuid=True))
    samples = Column(JSONB, nullable=False, default=list)
    evaluation = Column(JSONB, nullable=False, default=dict)
    details = Column(JSONB, nullable=False, default=dict)
    row_version = Column(Integer, nullable=False, default=1)
    created_by = Column(String(200), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    submitted_at = Column(DateTime)
    __table_args__ = (UniqueConstraint("job_card_id","stage","entry_no",name="uq_continuous_entry_no"),CheckConstraint("produced>=accepted AND accepted>=0 AND rejected=produced-accepted","ck_continuous_quantities"),CheckConstraint("input_quantity>=0 AND cutting_loss_pcs>=0","ck_continuous_input"))


class EntryRevision(Base):
    __tablename__ = "continuous_entry_revisions"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entry_id = Column(UUID(as_uuid=True), ForeignKey("continuous_stage_entries.id"), nullable=False,index=True)
    row_version = Column(Integer, nullable=False)
    payload = Column(JSONB, nullable=False)
    actor = Column(String(200), nullable=False)
    reason = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint("entry_id","row_version",name="uq_continuous_entry_revision"),)


class InputAllocation(Base):
    __tablename__ = "continuous_input_allocations"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_card_id = Column(UUID(as_uuid=True), ForeignKey("job_cards.id"), nullable=False,index=True)
    source_entry_id = Column(UUID(as_uuid=True), ForeignKey("continuous_stage_entries.id"), nullable=False,index=True)
    consumer_entry_id = Column(UUID(as_uuid=True), ForeignKey("continuous_stage_entries.id"), nullable=False,index=True)
    quantity = Column(Integer, nullable=False)
    __table_args__ = (UniqueConstraint("source_entry_id","consumer_entry_id",name="uq_continuous_allocation"),CheckConstraint("quantity>0","ck_continuous_allocation_positive"))


class EntryReceipt(Base):
    __tablename__ = "continuous_command_receipts"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_card_id = Column(UUID(as_uuid=True),ForeignKey("job_cards.id"),nullable=False,index=True)
    request_id = Column(String(120),nullable=False)
    fingerprint = Column(String(64),nullable=False)
    response = Column(JSONB,nullable=False)
    __table_args__ = (UniqueConstraint("job_card_id","request_id",name="uq_continuous_command_request"),)


class ResidualWip(Base):
    __tablename__ = "continuous_residual_wip"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_card_id = Column(UUID(as_uuid=True), ForeignKey("job_cards.id"), nullable=False,index=True)
    source_entry_id = Column(UUID(as_uuid=True), ForeignKey("continuous_stage_entries.id"), nullable=False,index=True)
    stage = Column(String(20),nullable=False)
    unit = Column(String(20),nullable=False)
    quantity = Column(Integer,nullable=False)
    disposition = Column(String(20),nullable=False)
    status = Column(String(20),nullable=False)
    reason = Column(Text,nullable=False)
    created_by = Column(String(200),nullable=False)
    created_at = Column(DateTime,default=datetime.utcnow)
    resolved_by = Column(String(200))
    resolved_at = Column(DateTime)
    row_version = Column(Integer,nullable=False,default=1)
    __table_args__ = (CheckConstraint("quantity>0","ck_residual_wip_positive"),UniqueConstraint("job_card_id","stage","source_entry_id",name="uq_residual_wip_source"))


class CompletionEffect(Base):
    __tablename__ = "continuous_completion_outbox"
    id = Column(UUID(as_uuid=True),primary_key=True,default=uuid.uuid4)
    job_card_id = Column(UUID(as_uuid=True),ForeignKey("job_cards.id"),nullable=False,index=True)
    effect_key = Column(String(180),nullable=False,unique=True)
    kind = Column(String(30),nullable=False)
    payload = Column(JSONB,nullable=False)
    status = Column(String(20),nullable=False,default="PENDING")
    attempts = Column(Integer,nullable=False,default=0)
    last_error = Column(Text)
    created_at = Column(DateTime,default=datetime.utcnow)
    delivered_at = Column(DateTime)
    next_attempt_at = Column(DateTime, default=datetime.utcnow, nullable=False)
