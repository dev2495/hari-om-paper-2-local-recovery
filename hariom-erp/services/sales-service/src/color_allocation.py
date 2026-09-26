"""Parchment color breakup rules for a sales-order line.

Placement is flexible: a 10,000 pc line can be 2,000 blue + 3,000 red and 5,000
"not decided yet". Release is strict: every release lot of a parchment line is one
color (one job card = one color), and a color can never be released beyond its
allocation. Releasing more of a color than allocated draws the extra from the
unassigned balance, so the invariants always hold:

    sum(color allocations) <= line qty
    released(color)       <= allocation(color)
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, Iterable, Optional

EPS = 1e-6


class ColorAllocationError(ValueError):
    pass


def color_key(color_id: Any, color: Optional[str]) -> str:
    """Stable identity of a color: master variant id when present, else its name."""
    if color_id not in (None, ""):
        return f"id:{str(color_id).lower()}"
    return f"name:{(color or '').strip().lower()}"


@dataclass
class ColorSplit:
    color: str
    qty: float
    color_id: Optional[uuid.UUID] = None

    @property
    def key(self) -> str:
        return color_key(self.color_id, self.color)


def normalize_color_splits(raw: Iterable[Any] | None, *, line_qty: float, line_no: Optional[int] = None) -> list[ColorSplit]:
    """Validate and merge a client breakup. Duplicate colors are summed; zero rows dropped."""
    prefix = f"Line {line_no}: " if line_no else ""
    merged: dict[str, ColorSplit] = {}
    for row in raw or []:
        data = row if isinstance(row, dict) else (row.model_dump() if hasattr(row, "model_dump") else dict(row))
        color = str(data.get("color") or "").strip()
        color_id_raw = data.get("color_id")
        color_id: Optional[uuid.UUID] = None
        if color_id_raw not in (None, ""):
            try:
                color_id = uuid.UUID(str(color_id_raw))
            except ValueError as exc:
                raise ColorAllocationError(f"{prefix}color selection is not a valid master variant") from exc
        qty = float(data.get("qty") or 0.0)
        if qty < 0:
            raise ColorAllocationError(f"{prefix}color quantity cannot be negative")
        if qty <= EPS:
            continue
        if not color:
            raise ColorAllocationError(f"{prefix}every color row needs a color")
        split = ColorSplit(color=color, qty=qty, color_id=color_id)
        if split.key in merged:
            merged[split.key].qty += qty
        else:
            merged[split.key] = split
    total = sum(split.qty for split in merged.values())
    if total > float(line_qty or 0.0) + EPS:
        raise ColorAllocationError(
            f"{prefix}color breakup ({total:,.0f} pcs) is more than the line quantity ({float(line_qty or 0.0):,.0f} pcs)"
        )
    return list(merged.values())


def released_by_color(lots: Iterable[Any]) -> dict[str, float]:
    """Net released qty per color over non-cancelled lots."""
    totals: dict[str, float] = {}
    for lot in lots or []:
        if str(getattr(lot, "status", "") or "").lower() == "cancelled":
            continue
        key = color_key(getattr(lot, "parchment_color_id", None), getattr(lot, "parchment_color", None))
        totals[key] = totals.get(key, 0.0) + float(getattr(lot, "released_qty", 0.0) or 0.0)
    return totals


def validate_splits_cover_releases(splits: list[ColorSplit], released: dict[str, float], *, line_no: Optional[int] = None) -> None:
    """An edited breakup may not drop a color below what is already released in it."""
    prefix = f"Line {line_no}: " if line_no else ""
    by_key = {split.key: split for split in splits}
    for key, qty in released.items():
        if key == color_key(None, None) or qty <= EPS:
            continue
        allocated = by_key[key].qty if key in by_key else 0.0
        if allocated + EPS < qty:
            name = by_key[key].color if key in by_key else key.split(":", 1)[-1]
            raise ColorAllocationError(
                f"{prefix}{name} already has {qty:,.0f} pcs released; its allocation cannot go below that"
            )


def plan_color_release(
    *,
    line_qty: float,
    splits: list[ColorSplit],
    released: dict[str, float],
    color: str,
    color_id: Optional[uuid.UUID],
    release_qty: float,
    line_no: Optional[int] = None,
) -> float:
    """Return how much must be moved from unassigned into ``color`` for this release.

    Raises when the color (plus unassigned balance) cannot cover ``release_qty``.
    """
    prefix = f"Line {line_no}: " if line_no else ""
    key = color_key(color_id, color)
    allocated = next((split.qty for split in splits if split.key == key), 0.0)
    free_in_color = max(0.0, allocated - float(released.get(key, 0.0)))
    if release_qty <= free_in_color + EPS:
        return 0.0
    extra = release_qty - free_in_color
    unassigned = max(0.0, float(line_qty or 0.0) - sum(split.qty for split in splits))
    if extra > unassigned + EPS:
        raise ColorAllocationError(
            f"{prefix}only {free_in_color:,.0f} pcs of {color} are open"
            f" and {unassigned:,.0f} pcs are unassigned — cannot release {release_qty:,.0f} pcs"
        )
    return round(extra, 4)


def color_summary(line_qty: float, splits: list[ColorSplit], released: dict[str, float]) -> dict[str, Any]:
    rows = []
    for split in splits:
        done = float(released.get(split.key, 0.0))
        rows.append(
            {
                "color": split.color,
                "color_id": str(split.color_id) if split.color_id else None,
                "qty": round(split.qty, 2),
                "released_qty": round(done, 2),
                "open_qty": round(max(0.0, split.qty - done), 2),
            }
        )
    assigned = sum(split.qty for split in splits)
    return {"color_splits": rows, "unassigned_color_qty": round(max(0.0, float(line_qty or 0.0) - assigned), 2)}
