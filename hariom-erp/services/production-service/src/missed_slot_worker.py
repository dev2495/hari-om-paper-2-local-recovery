"""Runs the 36-hour missed-slot rule on a timer (client 2026-10-26).

Before, the rule ran only when someone opened the planner board or the job card list, so a slot nobody
looked at stayed planned. Every 10 minutes this sends overdue silent slots of every plant back to the
queue, exactly as the board would.
"""
from __future__ import annotations

import logging
import os
import threading
from datetime import datetime, timedelta

from .database import SessionLocal
from .lifecycle_rules import MISSED_SLOT_HOURS
from .models import JobCard, JobCardStageSegment

log = logging.getLogger(__name__)
INTERVAL_SECONDS = int(os.getenv("MISSED_SLOT_SWEEP_SECONDS", "600"))
_stop = threading.Event()


def sweep_all_plants(now_local: datetime | None = None) -> int:
    from .routers.missed_slots import sweep_missed_slots
    from .routers.planning import PLANT_TIMEZONE

    now_local = now_local or datetime.now(PLANT_TIMEZONE).replace(tzinfo=None)
    horizon = (now_local - timedelta(hours=MISSED_SLOT_HOURS)).date()
    db = SessionLocal()
    requeued = 0
    try:
        plants = [
            row[0]
            for row in db.query(JobCard.plant_id)
            .join(JobCardStageSegment, JobCardStageSegment.job_card_id == JobCard.id)
            .filter(JobCardStageSegment.status == "ASSIGNED", JobCardStageSegment.plan_date <= horizon)
            .distinct()
            .all()
        ]
        for plant in plants:
            try:
                requeued += len(sweep_missed_slots(db, plant, now_local=now_local))
            except Exception:
                db.rollback()
                log.exception("missed-slot sweep failed for plant %s", plant)
    finally:
        db.close()
    return requeued


def run() -> None:
    while not _stop.wait(INTERVAL_SECONDS):
        if os.getenv("ERP_MAINTENANCE", "0") == "1":
            continue
        try:
            count = sweep_all_plants()
            if count:
                log.info("missed-slot sweep sent %s slot(s) back to the queue", count)
        except Exception:
            log.exception("missed-slot sweep failed")


def start() -> None:
    if os.getenv("MISSED_SLOT_WORKER_ENABLED", "1") == "1":
        _stop.clear()
        threading.Thread(target=run, daemon=True, name="missed-slot-sweep").start()


def stop() -> None:
    _stop.set()
