"""In-process scheduler for analytics-service.

Uses APScheduler's BackgroundScheduler with a tiny `cron_jobs` table that
tracks last-run / next-run / status so the /system UI can surface a health
panel. Jobs are configured via env vars so the deployment owner controls
exactly what fires when:

    OWNER_PACK_CRON       06:30 daily (default)
    EXCEPTIONS_CRON       every 60 min (default)
    SCHEDULER_ENABLED     "true" (default)
    OWNER_PACK_IN_PROCESS "false" (default)  — see dedup note below

APScheduler is lazily imported so the rest of the service starts even if the
package isn't installed locally. When it's missing or fails to start, the
endpoints under /scheduler still respond — they just report "scheduler
disabled" in their status payloads.

Owner-pack dedup decision (P1.9)
--------------------------------
The owner-pack is also wired as a Render cron service (``render.yaml`` —
``hariom-owner-pack-daily``). Render cron is the **canonical** trigger because
it has platform-level de-duplication across the deploy and only fires once
per scheduled time regardless of how many web replicas are running.

To prevent customers from receiving the same digest twice per day, the
in-process scheduler only registers ``owner_pack_daily`` when the operator
explicitly opts in via ``OWNER_PACK_IN_PROCESS=true``. ``render.yaml`` sets
this to ``"false"`` on the web service so the in-process job is dormant in
production. Local dev and self-hosted installs without Render can flip
``OWNER_PACK_IN_PROCESS=true`` to use the in-process path instead.

The hourly ``exceptions_check_hourly`` heartbeat is *always* registered (when
``SCHEDULER_ENABLED=true``) because the ``/scheduler/status`` panel needs a
live job to report on — the heartbeat is a no-op ``/health`` ping with no
side effects, so duplication across replicas is harmless.
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
# P1.9 — Default false so the Render cron is the only owner-pack trigger.
# Set OWNER_PACK_IN_PROCESS=true on non-Render deploys.
OWNER_PACK_IN_PROCESS = os.getenv("OWNER_PACK_IN_PROCESS", "false").lower() in {"1", "true", "yes", "on"}
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
                "relying on external Render cron"
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
    return {
        "enabled": bool(_scheduler_instance is not None),
        "owner_pack_cron": OWNER_PACK_CRON,
        "exceptions_cron": EXCEPTIONS_CRON,
        "owner_pack_in_process": OWNER_PACK_IN_PROCESS,
        "next_runs": next_runs,
        "jobs": snapshot,
    }
