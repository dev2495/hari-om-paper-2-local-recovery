"""Plan against the floor log (client 2026-10-26).

Planning is only the plan: slots, splits, machine, shift, date and quantity are the planner's work and
never stop the floor. The job card log is the truth. Each floor run is matched to the card's planned
slot for the same stage, date and shift (same machine preferred); a slot's result comes from what was
logged in it. Pure functions; unit-tested in tests/test_plan_match.py.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Iterable, Optional

SHIFT_START = {"SHIFT_A": time(8, 0), "SHIFT_B": time(20, 0)}
SHIFT_HOURS = 12
SHIFT_RANK = {"SHIFT_A": 0, "SHIFT_B": 1}
# A slot counts as done once 95 % of its plan was logged in it (the last bamboo of a batch is often short).
DONE_SHARE = 0.95

RESULT_LABEL = {
    "UPCOMING": "Upcoming",
    "IN_PROGRESS": "Running now",
    "DONE": "Done in slot",
    "PARTLY": "Partly done",
    "MOVED": "Ran on another day or shift",
    "NOT_RUN": "Not run",
    "NOT_NEEDED": "Not needed (stage finished earlier)",
}
MATCH_LABEL = {
    "ON_PLAN": "As planned",
    "OTHER_MACHINE": "Planned shift, other machine",
    "OTHER_SHIFT": "Same day, other shift",
    "EARLY": "Earlier than plan",
    "LATE": "Later than plan",
    "UNPLANNED": "Run before planning",
}


@dataclass
class Slot:
    key: str
    card: str
    stage: str
    day: date
    shift: Optional[str]
    machine: Optional[str]
    planned: float
    status: str = "ASSIGNED"
    made: float = 0.0
    good: float = 0.0
    runs: int = 0
    made_elsewhere: float = 0.0


@dataclass
class Run:
    key: str
    card: str
    stage: str
    day: date
    shift: Optional[str]
    machine: Optional[str]
    made: float
    good: float
    unscheduled: bool = False


@dataclass
class Match:
    run: Run
    slot: Optional[Slot]
    kind: str
    days_off: int = 0
    extra: dict = field(default_factory=dict)


def slot_window(day: date, shift: Optional[str]) -> tuple[datetime, datetime]:
    start = datetime.combine(day, SHIFT_START.get(shift or "", time(8, 0)))
    return start, start + timedelta(hours=SHIFT_HOURS)


def _order(day: date, shift: Optional[str]) -> int:
    return day.toordinal() * 2 + SHIFT_RANK.get(shift or "", 0)


def match_runs(slots: Iterable[Slot], runs: Iterable[Run]) -> list[Match]:
    """Attach every run to the slot it belongs to and add its pieces to that slot."""
    by_card: dict[tuple[str, str], list[Slot]] = {}
    for slot in slots:
        by_card.setdefault((slot.card, slot.stage), []).append(slot)
    out: list[Match] = []
    for run in sorted(runs, key=lambda r: (r.day, SHIFT_RANK.get(r.shift or "", 0), r.key)):
        candidates = by_card.get((run.card, run.stage), [])
        if run.unscheduled or not candidates:
            out.append(Match(run, None, "UNPLANNED"))
            continue
        exact = [s for s in candidates if s.day == run.day and (s.shift or None) == (run.shift or None)]
        if exact:
            same_machine = [s for s in exact if not s.machine or not run.machine or s.machine == run.machine]
            pool = same_machine or exact
            # Several slots on one shift (a plan split across machines): fill the emptiest first.
            slot = max(pool, key=lambda s: (s.planned - s.made, -_order(s.day, s.shift)))
            slot.made += run.made
            slot.good += run.good
            slot.runs += 1
            out.append(Match(run, slot, "ON_PLAN" if pool is same_machine else "OTHER_MACHINE"))
            continue
        nearest = min(candidates, key=lambda s: (abs(_order(s.day, s.shift) - _order(run.day, run.shift)), s.day, s.key))
        nearest.made_elsewhere += run.made
        days_off = (run.day - nearest.day).days
        kind = "OTHER_SHIFT" if days_off == 0 else ("LATE" if days_off > 0 else "EARLY")
        out.append(Match(run, nearest, kind, days_off=days_off))
    return out


def slot_result(slot: Slot, now: datetime) -> str:
    start, end = slot_window(slot.day, slot.shift)
    if slot.made >= slot.planned * DONE_SHARE and slot.made > 0:
        return "DONE"
    if start <= now < end:
        return "IN_PROGRESS"
    if now < start:
        # Already covered before the slot came (ran early): nothing left for this slot.
        if slot.status == "COMPLETED" and slot.made == 0:
            return "NOT_NEEDED" if slot.made_elsewhere == 0 else "MOVED"
        return "UPCOMING"
    if slot.made > 0:
        return "PARTLY"
    if slot.made_elsewhere > 0:
        return "MOVED"
    if slot.status == "COMPLETED":
        return "NOT_NEEDED"
    return "NOT_RUN"


def adherence(results: Iterable[str]) -> Optional[float]:
    """Share of finished slots that were done in their own slot (upcoming / running / not needed excluded)."""
    counted = [r for r in results if r in {"DONE", "PARTLY", "MOVED", "NOT_RUN"}]
    if not counted:
        return None
    return round(sum(1 for r in counted if r == "DONE") * 100.0 / len(counted), 1)
