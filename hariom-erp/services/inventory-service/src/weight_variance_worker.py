"""48-hour reminder for weight cases the Owner has not decided (6 Nov 2026).

Every 15 minutes, an OWNER_DECIDES bill that became final more than 48 hours ago and is still undecided
gets one reminder notification (with the same Make debit note / Skip… buttons). The list screens also
show "Reminder due" computed on read, so nothing depends on this thread being up.
"""
from __future__ import annotations

import logging
import os
import threading

from .database import SessionLocal

log = logging.getLogger(__name__)
INTERVAL_SECONDS = int(os.getenv("WEIGHT_REMINDER_SWEEP_SECONDS", "900"))
_stop = threading.Event()


def sweep_once() -> int:
    from .services.weight_variance import send_due_reminders

    db = SessionLocal()
    try:
        count = send_due_reminders(db)
        db.commit()
        return count
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def run() -> None:
    while not _stop.wait(INTERVAL_SECONDS):
        if os.getenv("ERP_MAINTENANCE", "0") == "1":
            continue
        try:
            count = sweep_once()
            if count:
                log.info("weight check: %s Owner reminder(s) sent", count)
        except Exception:
            log.exception("weight check reminder sweep failed")


def start() -> None:
    if os.getenv("WEIGHT_REMINDER_WORKER_ENABLED", "1") == "1":
        _stop.clear()
        threading.Thread(target=run, daemon=True, name="weight-reminder-sweep").start()


def stop() -> None:
    _stop.set()
