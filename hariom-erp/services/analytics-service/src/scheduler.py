"""In-process scheduler for analytics-service.

Uses APScheduler's BackgroundScheduler to enqueue durable background jobs and
record last-run / next-run / status so the /system UI can surface a health
panel. Jobs are configured via env vars so the deployment owner controls
exactly what fires when:

    OWNER_PACK_CRON       06:30 daily (default)
    EXCEPTIONS_CRON       every 60 min (default)
    SCHEDULER_ENABLED     "true" (default)
    OWNER_PACK_IN_PROCESS true on Railway, false elsewhere unless overridden

APScheduler is lazily imported, but the production requirements include it so
scheduled owner packs and exception checks are available after deploy. The
scheduler only enqueues idempotent jobs; `src.job_worker` performs the long
work with database locking/retry/dead-letter visibility.
"""
from __future__ import annotations

import logging
import os
import threading
from datetime import datetime, date
from typing import Any, Optional

from src.job_queue import ensure_job_schema, enqueue_job, process_due_jobs, queue_summary

logger = logging.getLogger(__name__)

OWNER_PACK_CRON = os.getenv("OWNER_PACK_CRON", "30 6 * * *")  # 06:30 daily
EXCEPTIONS_CRON = os.getenv("EXCEPTIONS_CRON", "0 * * * *")    # hourly on the hour
SCHEDULER_ENABLED = os.getenv("SCHEDULER_ENABLED", "true").lower() in {"1", "true", "yes", "on"}
# Railway does not have the Render cron defined in render.yaml. Default the
# in-process trigger on for Railway and off elsewhere unless explicitly set.
_OWNER_PACK_DEFAULT = "true" if os.getenv("RAILWAY_ENVIRONMENT") or os.getenv("RAILWAY_SERVICE_ID") else "false"
OWNER_PACK_IN_PROCESS = os.getenv("OWNER_PACK_IN_PROCESS", _OWNER_PACK_DEFAULT).lower() in {"1", "true", "yes", "on"}
ANALYTICS_INTERNAL_URL = os.getenv("ANALYTICS_INTERNAL_URL", "http://127.0.0.1:18007")
INTERNAL_EVENT_TOKEN = os.getenv("INTERNAL_EVENT_TOKEN", "hariom-internal-events")
JOB_WORKER_POLL_SECONDS = int(os.getenv("ANALYTICS_JOB_WORKER_POLL_SECONDS", "60"))
JOB_WORKER_MAX_PER_TICK = int(os.getenv("ANALYTICS_JOB_WORKER_MAX_PER_TICK", "3"))


# In-memory job status table. Persistent across requests within one process.
# The /scheduler/status endpoint surfaces this.
_job_status: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()
_scheduler_instance: Any = None


def _record(job_id: str, **kwargs: Any) -> None:
    with _lock:
        prev = _job_status.get(job_id) or {}
        prev.update(kwargs)
        _job_status[job_id] = prev


def _run_owner_pack() -> None:
    job_id = "owner_pack_daily"
    started = datetime.utcnow()
    _record(job_id, last_started_at=started.isoformat(), status="RUNNING")
    try:
        report_date = date.today().isoformat()
        job, created = enqueue_job(
            "owner_pack_daily",
            {"report_date": report_date},
            idempotency_key=f"owner_pack_daily:{report_date}",
            max_attempts=3,
        )
        _record(
            job_id,
            last_finished_at=datetime.utcnow().isoformat(),
            status="QUEUED" if created else "DUPLICATE",
            queue_job_id=job.id,
            last_error=None,
        )
    except Exception as exc:
        logger.warning("owner_pack_daily enqueue failed: %s", exc)
        _record(
            job_id,
            last_finished_at=datetime.utcnow().isoformat(),
            status="FAIL",
            last_error=str(exc)[:200],
        )


def _run_exceptions_check() -> None:
    """Hourly durable exception-report job."""
    job_id = "exceptions_check_hourly"
    started = datetime.utcnow()
    _record(job_id, last_started_at=started.isoformat(), status="RUNNING")
    try:
        now = datetime.utcnow()
        job, created = enqueue_job(
            "exceptions_check_hourly",
            {"report_date": date.today().isoformat()},
            idempotency_key=f"exceptions_check_hourly:{now.strftime('%Y-%m-%dT%H')}",
            max_attempts=3,
        )
        _record(
            job_id,
            last_finished_at=datetime.utcnow().isoformat(),
            status="QUEUED" if created else "DUPLICATE",
            queue_job_id=job.id,
            last_error=None,
        )
    except Exception as exc:
        logger.warning("exceptions_check_hourly enqueue failed: %s", exc)
        _record(
            job_id,
            last_finished_at=datetime.utcnow().isoformat(),
            status="FAIL",
            last_error=str(exc)[:200],
        )


def _run_job_worker_tick() -> None:
    job_id = "background_job_worker"
    started = datetime.utcnow()
    _record(job_id, last_started_at=started.isoformat(), status="RUNNING")
    try:
        result = process_due_jobs(max_jobs=JOB_WORKER_MAX_PER_TICK)
        _record(
            job_id,
            last_finished_at=datetime.utcnow().isoformat(),
            status="OK",
            result=result,
            last_error=None,
        )
    except Exception as exc:
        logger.warning("background job worker tick failed: %s", exc)
        _record(
            job_id,
            last_finished_at=datetime.utcnow().isoformat(),
            status="FAIL",
            last_error=str(exc)[:200],
        )


def start_scheduler() -> Optional[Any]:
    """Start APScheduler in the background. Idempotent + best-effort."""
    global _scheduler_instance
    if not SCHEDULER_ENABLED:
        logger.info("Scheduler disabled by SCHEDULER_ENABLED=false")
        return None
    if _scheduler_instance is not None:
        return _scheduler_instance
    try:
        from apscheduler.schedulers.background import BackgroundScheduler  # type: ignore
        from apscheduler.triggers.cron import CronTrigger  # type: ignore
        from apscheduler.triggers.interval import IntervalTrigger  # type: ignore
    except Exception as exc:  # pragma: no cover - import guard
        logger.warning("apscheduler not installed; scheduler disabled: %s", exc)
        return None

    try:
        ensure_job_schema()
        sched = BackgroundScheduler(timezone=os.getenv("PLANT_TIMEZONE", "Asia/Kolkata"))
        # P1.9 — owner_pack_daily is opt-in to avoid duplicate emails. The
        # Render cron service is the canonical trigger in production; the
        # in-process variant only registers when OWNER_PACK_IN_PROCESS=true.
        seeded_jobs: list[str] = []
        if OWNER_PACK_IN_PROCESS:
            sched.add_job(
                _run_owner_pack,
                CronTrigger.from_crontab(OWNER_PACK_CRON),
                id="owner_pack_daily",
                replace_existing=True,
            )
            seeded_jobs.append("owner_pack_daily")
        else:
            logger.info(
                "owner_pack_daily skipped in-process (OWNER_PACK_IN_PROCESS=false); "
                "relying on an external platform cron or manual trigger"
            )
        # Heartbeat is always registered when the scheduler is enabled so the
        # /scheduler/status panel has a live job to surface.
        sched.add_job(
            _run_exceptions_check,
            CronTrigger.from_crontab(EXCEPTIONS_CRON),
            id="exceptions_check_hourly",
            replace_existing=True,
        )
        seeded_jobs.append("exceptions_check_hourly")
        sched.add_job(
            _run_job_worker_tick,
            IntervalTrigger(seconds=max(10, JOB_WORKER_POLL_SECONDS)),
            id="background_job_worker",
            replace_existing=True,
            max_instances=1,
        )
        seeded_jobs.append("background_job_worker")
        sched.start()
        _scheduler_instance = sched
        # Seed initial status rows so the UI doesn't show blanks until first run.
        for job_id in seeded_jobs:
            _record(job_id, status="SCHEDULED", last_error=None)
        logger.info(
            "Scheduler started: jobs=%s owner_pack_cron=%s exceptions_cron=%s in_process_owner_pack=%s",
            seeded_jobs,
            OWNER_PACK_CRON,
            EXCEPTIONS_CRON,
            OWNER_PACK_IN_PROCESS,
        )
        return sched
    except Exception as exc:
        logger.warning("Scheduler failed to start: %s", exc)
        return None


def get_status() -> dict[str, Any]:
    """Snapshot of all known scheduler jobs + next-run for the UI panel."""
    with _lock:
        snapshot = {k: dict(v) for k, v in _job_status.items()}
    next_runs: dict[str, Optional[str]] = {}
    if _scheduler_instance is not None:
        try:
            for job in _scheduler_instance.get_jobs():
                next_runs[job.id] = job.next_run_time.isoformat() if job.next_run_time else None
        except Exception:
            pass
    try:
        queue = queue_summary()
    except Exception as exc:
        queue = {"available": False, "error": str(exc)[:160]}
    return {
        "enabled": bool(_scheduler_instance is not None),
        "owner_pack_cron": OWNER_PACK_CRON,
        "exceptions_cron": EXCEPTIONS_CRON,
        "owner_pack_in_process": OWNER_PACK_IN_PROCESS,
        "next_runs": next_runs,
        "jobs": snapshot,
        "queue": queue,
    }
