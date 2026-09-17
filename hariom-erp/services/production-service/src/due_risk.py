"""One plant-local 3-day priority predicate used by tiles, lists, reports, and exports.

Priority delivery covers three calendar dates in Asia/Kolkata: today, today+1, and
today+2. Overdue (due_date < today) is a separate bucket and is never mixed into
priority. Jobs without a due date are unclassified.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

PLANT_TIMEZONE_NAME = "Asia/Kolkata"
PLANT_TIMEZONE = ZoneInfo(PLANT_TIMEZONE_NAME)
PRIORITY_WINDOW_DAYS = 3
DUE_RISK_PRIORITY = "PRIORITY"
DUE_RISK_OVERDUE = "OVERDUE"
OPEN_JOB_STATUSES_EXCLUDED = {"COMPLETED", "CANCELLED"}


def plant_today(now: Optional[datetime] = None) -> date:
    current = now or datetime.now(PLANT_TIMEZONE)
    if current.tzinfo is None:
        current = current.replace(tzinfo=ZoneInfo("UTC")).astimezone(PLANT_TIMEZONE)
    else:
        current = current.astimezone(PLANT_TIMEZONE)
    return current.date()


def priority_window(today: Optional[date] = None) -> tuple[date, date]:
    start = today or plant_today()
    return start, start + timedelta(days=PRIORITY_WINDOW_DAYS - 1)


def classify_due_risk(due_date: Optional[date], today: Optional[date] = None) -> Optional[str]:
    if due_date is None:
        return None
    current = today or plant_today()
    if due_date < current:
        return DUE_RISK_OVERDUE
    _start, window_end = priority_window(current)
    if due_date <= window_end:
        return DUE_RISK_PRIORITY
    return None


def is_open_job_status(status: Optional[str]) -> bool:
    return str(status or "").strip().upper() not in OPEN_JOB_STATUSES_EXCLUDED


def due_risk_label(today: Optional[date] = None) -> str:
    start, window_end = priority_window(today)
    return (
        f"Priority delivery — next 3 plant days "
        f"({start.strftime('%d %b')}–{window_end.strftime('%d %b')}, {PLANT_TIMEZONE_NAME})"
    )


def overdue_label() -> str:
    return "Overdue (due before today, plant calendar)"
