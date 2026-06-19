from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, JSON, String, Text, UniqueConstraint

from src.database import Base


class BackgroundJob(Base):
    __tablename__ = "background_jobs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    kind = Column(String(80), nullable=False, index=True)
    status = Column(String(24), nullable=False, index=True, default="QUEUED")
    payload = Column(JSON, nullable=False, default=dict)
    result = Column(JSON, nullable=True)
    attempts = Column(Integer, nullable=False, default=0)
    max_attempts = Column(Integer, nullable=False, default=3)
    idempotency_key = Column(String(180), nullable=True)
    run_at = Column(DateTime, nullable=False, index=True, default=datetime.utcnow)
    locked_at = Column(DateTime, nullable=True)
    locked_by = Column(String(120), nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    finished_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("kind", "idempotency_key", name="uq_background_jobs_kind_idempotency"),
    )
