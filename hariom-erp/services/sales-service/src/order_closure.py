"""Cancel and short-close a sales order (client 2026-10-20: "cancel with reason code … cancel and close,
all rules perfect and easy to use").

One place decides what an order allows, so the screen and the server never disagree:

* **Cancel** — the whole order is withdrawn. Only while nothing has gone to production or the
  customer: no released job-card quantity and nothing dispatched. Final: the order stays on record
  as Cancelled with its reason code, and its delivery call-offs are cancelled.
* **Short close** — work has started (something released or dispatched) and the customer does not
  want the rest. The quantity not yet released is dropped from every line; job cards already
  released finish and are dispatched, and the order then closes by itself. A balance a force-closed
  job card later hands back is dropped too, instead of becoming releasable again.
* **Customer hold** (unchanged) is the reversible pause; cancel or short close also ends a hold.
* A lot saved in sales whose job card was never made (the planning sync failed) is not "released":
  cancel and short close drop it with the rest, so such an order is never stuck.

Both need a reason code from Masters › Reason codes (category "Order cancel / short close"); a code
whose name says OTHER also needs a note. The order keeps its stored status CLOSED for a cancel (so
every "open order" query already leaves it out) and reports itself as ``cancelled``.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any, Iterable, Optional

CANCELLED = "CANCELLED"
SHORT_CLOSED = "SHORT_CLOSED"
CLOSURE_ROLES = ["Admin", "Owner", "Sales", "PlantManager"]
_EPS = 1e-6
# A lot saved in sales gets its job card id when planning has made the card. A lot without one is
# still being made for this long (planning commits the card, then links it back); after that the
# sync failed and the lot is not on a job card.
PENDING_SYNC_GRACE = timedelta(minutes=10)


def _num(value: Any) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _status(order: Any) -> str:
    raw = getattr(order, "status", "")
    return str(getattr(raw, "value", raw) or "").lower()


def active_released(line: Any) -> float:
    """Quantity on job cards: release lots that are not cancelled."""
    return sum(_num(lot.released_qty) for lot in getattr(line, "release_lots", None) or [] if str(lot.status or "").lower() != "cancelled")


def lot_on_job_card(lot: Any, now: Optional[datetime] = None) -> bool:
    """Is this lot really on a job card? Cancelled: no. Linked to a job card: yes. Not linked: only
    while planning may still be making the card (a few minutes after the release)."""
    if str(lot.status or "").lower() == "cancelled":
        return False
    if getattr(lot, "job_card_id", None):
        return True
    created = getattr(lot, "created_at", None)
    return created is not None and (now or datetime.utcnow()) - created < PENDING_SYNC_GRACE


def stuck_lots(line: Any, now: Optional[datetime] = None) -> list[Any]:
    """Lots saved in sales whose job card was never made (the planning sync failed)."""
    return [
        lot for lot in getattr(line, "release_lots", None) or []
        if str(lot.status or "").lower() != "cancelled" and not lot_on_job_card(lot, now)
    ]


def cancel_stuck_lots(lines: Iterable[Any], reason: str) -> float:
    """Cancel the lots that never got a job card; returns their quantity."""
    total = 0.0
    for line in lines:
        for lot in stuck_lots(line):
            total += _num(lot.released_qty)
            lot.status = "cancelled"
            lot.returned_reason = reason[:200]
    return round(total, 4)


def on_job_cards(line: Any, now: Optional[datetime] = None) -> float:
    """Quantity really on job cards: what cancel and short close must leave alone."""
    return sum(_num(lot.released_qty) for lot in getattr(line, "release_lots", None) or [] if lot_on_job_card(lot, now))


def line_floor(line: Any) -> float:
    """What a line can never go below: what is on job cards or already dispatched."""
    return max(on_job_cards(line), _num(line.fulfilled_qty))


def droppable(line: Any) -> float:
    """Quantity not yet released (and not dispatched) that a short close drops."""
    return max(0.0, round(_num(line.qty) - line_floor(line), 4))


def is_cancelled(order: Any) -> bool:
    return str(getattr(order, "closure_kind", "") or "").upper() == CANCELLED


def display_status(order: Any) -> str:
    return "cancelled" if is_cancelled(order) else _status(order)


def _pcs(value: float) -> str:
    return f"{value:,.0f} pcs"


def closure_options(order: Any) -> dict[str, Any]:
    """What this order allows right now, with the reason in plain words when an action is not allowed."""
    lines = list(getattr(order, "lines", None) or [])
    status = _status(order)
    held = getattr(order, "held_at", None) is not None
    dispatched = sum(_num(line.fulfilled_qty) for line in lines)
    released = sum(on_job_cards(line) for line in lines)
    stuck = sum(_num(lot.released_qty) for line in lines for lot in stuck_lots(line))
    drop = round(sum(droppable(line) for line in lines), 4)
    finished = status == "closed" and not held and not getattr(order, "closure_kind", None)
    kind = str(getattr(order, "closure_kind", "") or "").upper()

    def blocked(text: str) -> dict[str, Any]:
        return {"allowed": False, "reason": text}

    if kind == CANCELLED:
        cancel = short = blocked("This order is already cancelled.")
    elif finished:
        cancel = short = blocked("This order is closed: everything was dispatched.")
    else:
        if dispatched > _EPS:
            cancel = blocked(f"{_pcs(dispatched)} are already dispatched. Use Short close to drop the balance instead.")
        elif released > _EPS:
            cancel = blocked(
                f"{_pcs(released)} are released to job cards. Use Short close (released job cards finish, the rest is dropped), "
                "or force-close those job cards in production first and then cancel."
            )
        else:
            cancel = {"allowed": True, "reason": None}
        if status in ("draft", "submitted"):
            short = blocked("The order is not approved yet, so nothing has started. Use Cancel order.")
        elif dispatched <= _EPS and released <= _EPS:
            short = blocked("Nothing has been released or dispatched yet. Use Cancel order.")
        elif drop <= _EPS:
            short = blocked(
                "Everything left is already on job cards; the order closes by itself once they are dispatched. "
                "To stop a job card, force-close it in production."
            )
        else:
            short = {"allowed": True, "reason": None}
    return {
        "cancel": cancel,
        "short_close": short,
        "dispatched_qty": round(dispatched, 4),
        "released_qty": round(released, 4),
        "drop_qty": drop,
        "stuck_qty": round(stuck, 4),
        "held": held,
    }


# OTHER / OTHERS as a whole word of the code (SO-OTHER, OTHER_REASON), not inside a word such as
# ANOTHER or MOTHER (SO-CUSTOMER-CHOSE-ANOTHER-SUPPLIER needs no note).
_OTHER_WORD = re.compile(r"(?<![A-Z0-9])OTHERS?(?![A-Z0-9])")


def reason_needs_note(reason_code: Optional[str]) -> bool:
    return bool(_OTHER_WORD.search((reason_code or "").strip().upper()))


def validate_reason(reason_code: Optional[str], note: Optional[str]) -> tuple[str, str]:
    """Reason code is required; a code meaning "other" also needs a short note."""
    code = (reason_code or "").strip().upper()
    text = (note or "").strip()
    if not code:
        raise ValueError("Choose a reason code.")
    if reason_needs_note(code) and len(text) < 5:
        raise ValueError("Write a short note for the reason 'Other'.")
    return code, text


def hold_reason_text(label: Optional[str], code: str, note: Optional[str]) -> str:
    """What a customer hold records as its reason: the reason's name, then the note if any."""
    text = (label or "").strip() or code
    extra = (note or "").strip()
    return f"{text} — {extra}" if extra else text


def trim_schedules(line: Any, keep_qty: float) -> list[Any]:
    """Shrink a line's customer call-offs so they total no more than ``keep_qty``.

    The latest undelivered rows without a release-lot link are reduced first (to zero = cancelled);
    delivered rows and rows tied to a release lot are kept. Returns the rows changed.
    """
    rows = [row for row in getattr(line, "delivery_schedules", None) or [] if str(row.status or "").lower() not in ("cancelled",)]
    excess = round(sum(_num(row.quantity) for row in rows) - keep_qty, 4)
    changed = []
    if excess <= _EPS:
        return changed
    movable = [
        row for row in rows
        if str(row.status or "").lower() != "delivered" and not (getattr(row, "allocations", None) or [])
    ]
    for row in sorted(movable, key=lambda item: (item.delivery_date, str(getattr(item, "id", ""))), reverse=True):
        if excess <= _EPS:
            break
        take = min(excess, _num(row.quantity))
        row.quantity = round(_num(row.quantity) - take, 4)
        if row.quantity <= _EPS:
            row.quantity = 0.0
            row.status = "cancelled"
        excess = round(excess - take, 4)
        changed.append(row)
    return changed


def shrink_colour_splits(line: Any, splits: list[Any], released_by_colour: dict[str, float]) -> Optional[list[Any]]:
    """After a short close a parchment line keeps only what was released in each colour.

    Returns the new split list, or None when the line needs no change.
    """
    total = sum(_num(split.qty) for split in splits)
    if total <= _num(line.qty) + _EPS:
        return None
    kept = []
    for split in splits:
        qty = round(min(_num(split.qty), released_by_colour.get(split.key, 0.0)), 4)
        if qty > _EPS:
            split.qty = qty
            kept.append(split)
    return kept


def lines_after_drop(lines: Iterable[Any]) -> list[tuple[Any, float]]:
    """(line, dropped qty) for each line whose unreleased balance is dropped."""
    out = []
    for line in lines:
        drop = droppable(line)
        if drop > _EPS:
            out.append((line, drop))
    return out
