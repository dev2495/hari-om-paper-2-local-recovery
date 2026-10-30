"""The plant's shift rule for anything the store registers on the floor (client 2026-10-30).

Shift A runs 08:00-20:00 IST and Shift B 20:00-08:00 IST (production ``lifecycle_rules.SHIFT_START``).
The business date is the day the shift started, so 01:30 IST on 31 Oct is Shift B of 30 Oct. Issue desks
never ask for a shift or a date: the server takes the moment the issue is registered and derives both.

Server timestamps are naive UTC; a naive ``datetime`` given here is read as UTC.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
SHIFT_A_START = time(8, 0)
SHIFT_B_START = time(20, 0)
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


@dataclass(frozen=True)
class FloorShift:
    shift: str  # "A" / "B", as issues store it
    business_date: date
    at_utc: datetime  # naive UTC: what the row stores as its registration time
    at_ist: datetime

    @property
    def code(self) -> str:
        return f"SHIFT_{self.shift}"

    @property
    def label(self) -> str:
        """"Shift B · 30 Oct" — how desks and messages name it."""
        return f"Shift {self.shift} · {self.business_date.day} {MONTHS[self.business_date.month - 1]}"


def _utc_now() -> datetime:
    """The registration clock (naive UTC). Tests freeze it here."""
    return datetime.utcnow()


def shift_at(at: datetime | None = None) -> FloorShift:
    """Shift and business date of an instant (None = now)."""
    stamp = at if at is not None else _utc_now()
    aware = stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)
    local = aware.astimezone(IST)
    clock = local.time()
    if SHIFT_A_START <= clock < SHIFT_B_START:
        shift, day = "A", local.date()
    elif clock >= SHIFT_B_START:
        shift, day = "B", local.date()
    else:  # 00:00-08:00 is the tail of the shift that started at 20:00 the day before
        shift, day = "B", local.date() - timedelta(days=1)
    return FloorShift(shift=shift, business_date=day, at_utc=aware.astimezone(timezone.utc).replace(tzinfo=None), at_ist=local)


def floor_shift_now() -> FloorShift:
    return shift_at(None)
