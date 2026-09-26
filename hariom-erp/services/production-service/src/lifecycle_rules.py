"""Job card lifecycle rules (pure functions, no DB) — shared by the lifecycle API and tests.

Lifecycle of one job card (= one color, one client batch/lot):

    QUEUED     released from the SO, waiting in a winder queue, not on the calendar yet
               → qty and color are editable (the SO release lot is amended in step)
    SCHEDULED  placed on a machine/date/shift → locked; change it by force-close + re-release
    RUNNING    floor has started recording output
    COMPLETED  all stages done
    FORCE_CLOSED  closed early at the qty actually made; the unmade balance went back to the SO
    CANCELLED  force-closed before anything was made (whole qty back to the SO)

Output tolerance: planning is exact, but a shift may produce up to +10% over its plan.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Iterable, Optional, Sequence

import math

OUTPUT_TOLERANCE = 0.10
# Winder and oven count bamboos; process onwards counts finished tubes (pcs).
BAMBOO_STAGES = {"WINDER", "OVEN"}
SHIFT_ORDER = ("SHIFT_A", "SHIFT_B")
OPEN = {"PLANNED", "QUEUED", "ASSIGNED", "RUNNING"}
LIVE_FLOW_STAGES = ("WINDER", "OVEN")


@dataclass
class SegmentView:
    id: str
    stage: str
    status: str
    planned_qty: float
    output_qty: float = 0.0
    machine_id: Optional[str] = None
    plan_date: Optional[date] = None
    shift_code: Optional[str] = None
    sequence_no: int = 1
    load: float = 0.0


def is_scheduled(segment: SegmentView) -> bool:
    return segment.status in {"ASSIGNED", "RUNNING", "COMPLETED"} or bool(segment.machine_id and segment.shift_code)


def made_qty(first_stage_segments: Iterable[SegmentView]) -> float:
    return round(sum(float(s.output_qty or 0.0) for s in first_stage_segments if s.status in {"RUNNING", "COMPLETED"}), 4)


def lifecycle_state(*, status: str, close_mode: Optional[str], segments: Sequence[SegmentView]) -> str:
    status = (status or "").upper()
    if close_mode == "FORCE":
        return "COMPLETED" if status == "COMPLETED" else "FORCE_CLOSED"
    if status == "CANCELLED" or close_mode == "CANCELLED":
        return "CANCELLED"
    if status == "COMPLETED":
        return "COMPLETED"
    if any(s.status in {"RUNNING", "COMPLETED"} or float(s.output_qty or 0) > 0 for s in segments):
        return "RUNNING"
    if any(is_scheduled(s) for s in segments):
        return "SCHEDULED"
    return "QUEUED"


def allowed_actions(state: str, *, has_release_lot: bool, open_first_stage_qty: float) -> dict[str, bool]:
    return {
        "edit": state == "QUEUED" and has_release_lot,
        "split": state in {"QUEUED", "SCHEDULED", "RUNNING"} and has_release_lot and open_first_stage_qty > 1,
        "force_close": state in {"QUEUED", "SCHEDULED", "RUNNING"} and has_release_lot,
        "emergency": state in {"QUEUED", "SCHEDULED"},
        # Force-closed cards still finish their made qty through the downstream stages.
        "running_entry": state in {"SCHEDULED", "RUNNING", "FORCE_CLOSED"},
    }


def stage_unit(stage: str) -> str:
    return "bamboo" if stage in BAMBOO_STAGES else "pcs"


def planned_in_stage_units(stage: str, planned_pcs: float, pcs_per_bamboo: Optional[int]) -> float:
    """A plan in pcs expressed in the unit the floor records for ``stage``."""
    if stage in BAMBOO_STAGES and pcs_per_bamboo and pcs_per_bamboo > 0:
        return float(math.ceil(float(planned_pcs or 0.0) / pcs_per_bamboo))
    return float(planned_pcs or 0.0)


def stage_units_to_pcs(stage: str, qty: float, pcs_per_bamboo: Optional[int]) -> float:
    if stage in BAMBOO_STAGES and pcs_per_bamboo and pcs_per_bamboo > 0:
        return float(qty or 0.0) * pcs_per_bamboo
    return float(qty or 0.0)


def within_output_tolerance(planned: float, produced_total: float, tolerance: float = OUTPUT_TOLERANCE) -> bool:
    return float(produced_total or 0.0) <= float(planned or 0.0) * (1.0 + tolerance) + 1e-6


def plan_split_take(open_segments: Sequence[SegmentView], qty: float) -> list[tuple[str, float]]:
    """Take ``qty`` from the not-yet-started segments, latest first.

    Returns ``[(segment_id, new_planned_qty)]``; a new qty of 0 means cancel the segment.
    Raises when the unstarted balance cannot cover ``qty``.
    """
    movable = [s for s in open_segments if s.status in {"PLANNED", "QUEUED", "ASSIGNED"}]
    available = sum(float(s.planned_qty or 0.0) for s in movable)
    if qty <= 0:
        raise ValueError("Split quantity must be positive")
    if qty > available + 1e-6:
        raise ValueError(f"Only {available:,.0f} pcs are not started yet — split at most that")
    remaining = float(qty)
    changes: list[tuple[str, float]] = []
    ordered = sorted(movable, key=lambda s: (s.plan_date or date.max, SHIFT_ORDER.index(s.shift_code) if s.shift_code in SHIFT_ORDER else 9, s.sequence_no), reverse=True)
    for segment in ordered:
        if remaining <= 1e-6:
            break
        take = min(float(segment.planned_qty or 0.0), remaining)
        changes.append((segment.id, round(float(segment.planned_qty or 0.0) - take, 4)))
        remaining -= take
    return changes


def next_slot(plan_date: date, shift_code: Optional[str], closed_dates: Iterable[date] = ()) -> tuple[date, str]:
    closed = set(closed_dates or ())
    index = SHIFT_ORDER.index(shift_code) if shift_code in SHIFT_ORDER else len(SHIFT_ORDER) - 1
    if index + 1 < len(SHIFT_ORDER):
        candidate_date, candidate_shift = plan_date, SHIFT_ORDER[index + 1]
    else:
        candidate_date, candidate_shift = plan_date + timedelta(days=1), SHIFT_ORDER[0]
    guard = 0
    while candidate_date in closed and guard < 60:
        candidate_date += timedelta(days=1)
        candidate_shift = SHIFT_ORDER[0]
        guard += 1
    return candidate_date, candidate_shift


def plan_bump(slot: Sequence[SegmentView], capacity: float, pinned_ids: Iterable[str] = ()) -> list[str]:
    """Which segments to push to the next slot so the slot fits ``capacity`` again.

    Pinned (the emergency card) and running segments never move; the lowest-priority
    (highest sequence) movable segments leave first.
    """
    if not capacity or capacity <= 0:
        return []
    pinned = set(pinned_ids or ())
    load = sum(float(s.load or 0.0) for s in slot)
    moved: list[str] = []
    for segment in sorted(slot, key=lambda s: s.sequence_no, reverse=True):
        if load <= capacity + 1e-6:
            break
        if segment.id in pinned or segment.status in {"RUNNING", "COMPLETED"}:
            continue
        moved.append(segment.id)
        load -= float(segment.load or 0.0)
    return moved
