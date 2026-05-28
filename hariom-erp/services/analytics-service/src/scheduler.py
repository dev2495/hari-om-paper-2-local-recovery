"""In-process scheduler for analytics-service.

Uses APScheduler's BackgroundScheduler with a tiny `cron_jobs` table that
tracks last-run / next-run / status so the /system UI can surface a health
panel. Jobs are configured via env vars so the deployment owner controls
exactly what fires when:

    OWNER_PACK_CRON       06:30 daily (default)
    EXCEPTIONS_CRON       every 60 min (default)
    SCHEDULER_ENABLED     "true" (default)

APScheduler is lazily imported so the rest of the service starts even if the
package isn't installed locally. When it's missing or fails to start, the
endpoints under /scheduler still respond — they just report "scheduler
disabled" in their status payloads.
"""
from __future__ import annotations

import logging
import os
import threading
from datetime import datetime
from typing import Any, Optional

import requests

logger = logging.getLogger(__name__)

OWNER_PACK_CRON = os.getenv("OWNER_PACK_CRON", "30 6 * * *")  # 06:30 daily
EXCEPTIONS_CRON = os.getenv("EXCEPTIONS_CRON", "0 * * * *")    # hourly on the hour
SCHEDULER_ENABLED = os.getenv("SCHEDULER_ENABLED", "true").lower() in {"1", "true", "yes", "on"}
ANALYTICS_INTERNAL_URL = os.getenv("ANALYTICS_INTERNAL_URL", "http://127.0.0.1:18007")
INTERNAL_EVENT_TOKEN = os.getenv("INTERNAL_EVENT_TOKEN", "hariom-internal-events")


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
        r = requests.post(
            f"{ANALYTICS_INTERNAL_URL}/reports/owner-pack/send-daily",
            headers={"X-Internal-Token": INTERNAL_EVENT_TOKEN},
            timeout=120,
        )
        ok = r.status_code < 300
        _record(
            job_id,
            last_finished_at=datetime.utcnow().isoformat(),
            status="OK" if ok else "FAIL",
            last_http=r.status_code,
            last_error=None if ok else r.text[:200],
        )
    except Exception as exc:
        logger.warning("owner_pack_daily run failed: %s", exc)
        _record(
            job_id,
            last_finished_at=datetime.utcnow().isoformat(),
            status="FAIL",
            last_error=str(exc)[:200],
        )


def _run_exceptions_check() -> None:
    """Hourly heartbeat that confirms the cron is firing.

    We hit our own /health endpoint (no JWT required) so the job stays green
    even without service-account credentials. The job's purpose is to prove
    the scheduler is alive — actual exception alerts live in a separate
    notifier that's not yet wired (documented as a roadmap item).
    """
    job_id = "exceptions_check_hourly"
    started = datetime.utcnow()
    _record(job_id, last_started_at=started.isoformat(), status="RUNNING")
    try:
        r = requests.get(
            f"{ANALYTICS_INTERNAL_URL}/health",
            timeout=5,
        )
        _record(
            job_id,
            last_finished_at=datetime.utcnow().isoformat(),
            status="OK" if r.status_code < 300 else "FAIL",
            last_http=r.status_code,
            last_error=None if r.status_code < 300 else r.text[:200],
        )
    except Exception as exc:
        logger.warning("exceptions_check_hourly failed: %s", exc)
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
    except Exception as exc:  # pragma: no cover - import guard
        logger.warning("apscheduler not installed; scheduler disabled: %s", exc)
        return None

    try:
        sched = BackgroundScheduler(timezone=os.getenv("PLANT_TIMEZONE", "Asia/Kolkata"))
        sched.add_job(
            _run_owner_pack,
            CronTrigger.from_crontab(OWNER_PACK_CRON),
            id="owner_pack_daily",
            replace_existing=True,
        )
        sched.add_job(
            _run_exceptions_check,
            CronTrigger.from_crontab(EXCEPTIONS_CRON),
            id="exceptions_check_hourly",
            replace_existing=True,
        )
        sched.start()
        _scheduler_instance = sched
        # Seed initial status rows
        for job_id in ("owner_pack_daily", "exceptions_check_hourly"):
            _record(job_id, status="SCHEDULED", last_error=None)
        logger.info("Scheduler started: owner_pack_daily=%s, exceptions_check_hourly=%s", OWNER_PACK_CRON, EXCEPTIONS_CRON)
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
    return {
        "enabled": bool(_scheduler_instance is not None),
        "owner_pack_cron": OWNER_PACK_CRON,
        "exceptions_cron": EXCEPTIONS_CRON,
        "next_runs": next_runs,
        "jobs": snapshot,
    }
