"""Job card numbers: ``YY/MM/NN`` with a monthly series, children ``ROOT-A``, ``ROOT-B`` …

* A job card released from a sales order gets the next number of the month it was
  created in (series restarts at 01 every month; grows to 3 digits past 99).
* A split, carry-forward (top-up) or rework card keeps its family's root number and
  takes the next free letter, so ``25/09/01`` → ``25/09/01-A``, ``25/09/01-B``.
"""

from __future__ import annotations

import string
from datetime import datetime
from typing import Iterable, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.orm import Session

PLANT_TIMEZONE = ZoneInfo("Asia/Kolkata")
SUFFIXES = list(string.ascii_uppercase)


def month_key(moment: Optional[datetime] = None) -> str:
    local = (moment or datetime.now(PLANT_TIMEZONE))
    if local.tzinfo is None:
        local = local.replace(tzinfo=ZoneInfo("UTC")).astimezone(PLANT_TIMEZONE)
    return local.strftime("%y%m")


def format_job_card_no(key: str, seq: int) -> str:
    return f"{key[:2]}/{key[2:]}/{seq:02d}"


def root_number(job_card_no: Optional[str]) -> Optional[str]:
    if not job_card_no:
        return None
    return str(job_card_no).split("-", 1)[0]


def next_suffix(existing_numbers: Iterable[Optional[str]], root: str) -> str:
    """Next free letter after the highest used one for ``root`` (A, B, … Z, then AA, AB …)."""
    used: set[str] = set()
    for number in existing_numbers:
        if number and str(number).startswith(f"{root}-"):
            used.add(str(number)[len(root) + 1 :])
    for letter in SUFFIXES:
        if letter not in used:
            return letter
    for first in SUFFIXES:
        for second in SUFFIXES:
            if f"{first}{second}" not in used:
                return f"{first}{second}"
    raise ValueError("No job card suffix left for this family")


def allocate_job_card_no(db: Session, moment: Optional[datetime] = None) -> str:
    """Atomically reserve the next monthly number (safe under concurrent releases)."""
    key = month_key(moment)
    seq = db.execute(
        text(
            "INSERT INTO job_card_number_counters (month_key, last_seq) VALUES (:key, 1) "
            "ON CONFLICT (month_key) DO UPDATE SET last_seq = job_card_number_counters.last_seq + 1 "
            "RETURNING last_seq"
        ),
        {"key": key},
    ).scalar_one()
    return format_job_card_no(key, int(seq))


def allocate_child_job_card_no(db: Session, parent_no: Optional[str]) -> Optional[str]:
    root = root_number(parent_no)
    if not root:
        return None
    rows = db.execute(
        text("SELECT job_card_no FROM job_cards WHERE job_card_no LIKE :pattern FOR UPDATE"),
        {"pattern": f"{root}-%"},
    ).scalars().all()
    return f"{root}-{next_suffix(rows, root)}"
