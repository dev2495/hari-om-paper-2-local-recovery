from __future__ import annotations

import logging
import os
import signal
import time

from src.job_queue import ensure_job_schema, process_due_jobs


logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper())
logger = logging.getLogger(__name__)

POLL_SECONDS = int(os.getenv("ANALYTICS_JOB_WORKER_POLL_SECONDS", "30"))
MAX_JOBS_PER_TICK = int(os.getenv("ANALYTICS_JOB_WORKER_MAX_PER_TICK", "5"))

_shutdown_requested = False


def _handle_shutdown(signum: int, _frame) -> None:
    global _shutdown_requested
    _shutdown_requested = True
    logger.info("analytics job worker received signal %s", signum)


def main() -> int:
    signal.signal(signal.SIGTERM, _handle_shutdown)
    signal.signal(signal.SIGINT, _handle_shutdown)

    ensure_job_schema()
    logger.info(
        "analytics job worker started poll_seconds=%s max_jobs_per_tick=%s",
        POLL_SECONDS,
        MAX_JOBS_PER_TICK,
    )

    while not _shutdown_requested:
        try:
            result = process_due_jobs(max_jobs=MAX_JOBS_PER_TICK)
            if result["processed"]:
                logger.info("processed analytics jobs: %s", result)
        except Exception:
            logger.exception("analytics job worker tick failed")
        time.sleep(max(5, POLL_SECONDS))

    logger.info("analytics job worker stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
