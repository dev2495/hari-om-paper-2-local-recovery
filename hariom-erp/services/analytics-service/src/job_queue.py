from __future__ import annotations

import logging
import os
import socket
import traceback
from datetime import date, datetime, timedelta
from typing import Any, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from src.database import Base, SessionLocal, engine
from src.models import BackgroundJob

logger = logging.getLogger(__name__)

QUEUED = "QUEUED"
RUNNING = "RUNNING"
RETRY = "RETRY"
SUCCEEDED = "SUCCEEDED"
FAILED = "FAILED"
DEAD = "DEAD"

RUNNABLE = {QUEUED, RETRY}
TERMINAL = {SUCCEEDED, DEAD}


def ensure_job_schema() -> None:
    Base.metadata.create_all(bind=engine)


def _utcnow() -> datetime:
    return datetime.utcnow()


def _worker_id() -> str:
    return f"{socket.gethostname()}:{os.getpid()}"


def enqueue_job(
    kind: str,
    payload: Optional[dict[str, Any]] = None,
    *,
    idempotency_key: Optional[str] = None,
    run_at: Optional[datetime] = None,
    max_attempts: int = 3,
    db: Optional[Session] = None,
) -> tuple[BackgroundJob, bool]:
    owns_session = db is None
    session = db or SessionLocal()
    try:
        if idempotency_key:
            existing = (
                session.query(BackgroundJob)
                .filter(
                    BackgroundJob.kind == kind,
                    BackgroundJob.idempotency_key == idempotency_key,
                )
                .first()
            )
            if existing:
                return existing, False

        job = BackgroundJob(
            kind=kind,
            payload=payload or {},
            status=QUEUED,
            idempotency_key=idempotency_key,
            run_at=run_at or _utcnow(),
            max_attempts=max(1, int(max_attempts or 1)),
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        return job, True
    finally:
        if owns_session:
            session.close()


def queue_summary(db: Optional[Session] = None) -> dict[str, Any]:
    owns_session = db is None
    session = db or SessionLocal()
    try:
        rows = (
            session.query(BackgroundJob.status, func.count(BackgroundJob.id))
            .group_by(BackgroundJob.status)
            .all()
        )
        counts = {str(status): int(count or 0) for status, count in rows}
        oldest = (
            session.query(BackgroundJob)
            .filter(BackgroundJob.status.in_(list(RUNNABLE)))
            .order_by(BackgroundJob.run_at.asc())
            .first()
        )
        return {
            "counts": counts,
            "oldest_due_at": oldest.run_at.isoformat() if oldest else None,
            "has_dead_jobs": bool(counts.get(DEAD, 0)),
        }
    finally:
        if owns_session:
            session.close()


def recent_jobs(limit: int = 50, db: Optional[Session] = None) -> list[dict[str, Any]]:
    owns_session = db is None
    session = db or SessionLocal()
    try:
        rows = (
            session.query(BackgroundJob)
            .order_by(BackgroundJob.created_at.desc())
            .limit(max(1, min(200, int(limit or 50))))
            .all()
        )
        return [serialize_job(row) for row in rows]
    finally:
        if owns_session:
            session.close()


def serialize_job(job: BackgroundJob) -> dict[str, Any]:
    return {
        "id": job.id,
        "kind": job.kind,
        "status": job.status,
        "payload": job.payload or {},
        "result": job.result or {},
        "attempts": int(job.attempts or 0),
        "max_attempts": int(job.max_attempts or 0),
        "idempotency_key": job.idempotency_key,
        "run_at": job.run_at.isoformat() if job.run_at else None,
        "locked_at": job.locked_at.isoformat() if job.locked_at else None,
        "locked_by": job.locked_by,
        "last_error": job.last_error,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "updated_at": job.updated_at.isoformat() if job.updated_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
    }


def claim_due_job(session: Session, worker_id: str) -> Optional[BackgroundJob]:
    now = _utcnow()
    query = (
        session.query(BackgroundJob)
        .filter(
            BackgroundJob.status.in_(list(RUNNABLE)),
            BackgroundJob.run_at <= now,
        )
        .order_by(BackgroundJob.run_at.asc(), BackgroundJob.created_at.asc())
    )
    if session.bind and session.bind.dialect.name == "postgresql":
        query = query.with_for_update(skip_locked=True)
    job = query.first()
    if not job:
        return None
    job.status = RUNNING
    job.locked_at = now
    job.locked_by = worker_id
    job.attempts = int(job.attempts or 0) + 1
    job.updated_at = now
    session.commit()
    session.refresh(job)
    return job


def mark_succeeded(session: Session, job: BackgroundJob, result: dict[str, Any]) -> None:
    now = _utcnow()
    job.status = SUCCEEDED
    job.result = result
    job.last_error = None
    job.locked_at = None
    job.locked_by = None
    job.finished_at = now
    job.updated_at = now
    session.commit()


def mark_failed(session: Session, job: BackgroundJob, error: BaseException) -> None:
    now = _utcnow()
    attempts = int(job.attempts or 0)
    max_attempts = int(job.max_attempts or 1)
    job.status = DEAD if attempts >= max_attempts else RETRY
    job.last_error = "".join(traceback.format_exception_only(type(error), error)).strip()[:4000]
    job.locked_at = None
    job.locked_by = None
    job.updated_at = now
    if job.status == RETRY:
        delay = min(3600, 60 * (2 ** max(0, attempts - 1)))
        job.run_at = now + timedelta(seconds=delay)
    else:
        job.finished_at = now
    session.commit()


def perform_job(job: BackgroundJob) -> dict[str, Any]:
    payload = job.payload or {}
    if job.kind == "owner_pack_daily":
        from src.routers.reports import send_daily_owner_pack_now

        report_date = payload.get("report_date")
        return send_daily_owner_pack_now(report_date=date.fromisoformat(report_date) if report_date else None)
    if job.kind == "exceptions_check_hourly":
        from src.routers.reports import run_exceptions_check_now

        report_date = payload.get("report_date")
        return run_exceptions_check_now(report_date=date.fromisoformat(report_date) if report_date else None)
    raise RuntimeError(f"Unknown background job kind: {job.kind}")


def process_due_jobs(max_jobs: int = 5, worker_id: Optional[str] = None) -> dict[str, Any]:
    ensure_job_schema()
    worker = worker_id or _worker_id()
    processed = 0
    succeeded = 0
    failed = 0
    last_job_id: Optional[str] = None
    session = SessionLocal()
    try:
        for _ in range(max(1, int(max_jobs or 1))):
            job = claim_due_job(session, worker)
            if job is None:
                break
            processed += 1
            last_job_id = job.id
            try:
                result = perform_job(job)
                mark_succeeded(session, job, result)
                succeeded += 1
            except Exception as exc:
                logger.exception("background job failed: %s kind=%s", job.id, job.kind)
                mark_failed(session, job, exc)
                failed += 1
        return {
            "processed": processed,
            "succeeded": succeeded,
            "failed": failed,
            "last_job_id": last_job_id,
        }
    finally:
        session.close()
