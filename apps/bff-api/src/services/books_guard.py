"""Books-locked guard.

Caches /reconciliation/books-state per plant for 60s and rejects mutations
whose effective_date / date falls inside the locked period.

Used by inventory + sales BFF mutation routes to enforce the "no backdated
writes after monthly-close approval" rule.
"""

from __future__ import annotations

import os
import time
from datetime import date as DateT
from typing import Any, Optional

import httpx
from fastapi import HTTPException

PRODUCTION_SERVICE_URL = os.getenv("PRODUCTION_SERVICE_URL", "http://localhost:8004")

# Cache: { plant_id: (expires_at_epoch_sec, books_state_dict) }
_books_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_TTL_SEC = 60.0
_TIMEOUT_SEC = 5.0


async def fetch_books_state(token: str, plant_id: str) -> Optional[dict[str, Any]]:
    """Fetch books-state for the plant, with 60-second per-plant cache."""
    now = time.time()
    cached = _books_cache.get(plant_id)
    if cached and cached[0] > now:
        return cached[1]
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SEC) as client:
            response = await client.get(
                f"{PRODUCTION_SERVICE_URL}/reconciliation/books-state",
                headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
            )
        if response.status_code != 200:
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "BOOKS_STATE_UNAVAILABLE",
                    "message": "Could not verify monthly-close lock state before posting this dated transaction.",
                    "upstream_status": response.status_code,
                },
            )
        data = response.json() or {}
        _books_cache[plant_id] = (now + _CACHE_TTL_SEC, data)
        return data
    except httpx.HTTPError:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "BOOKS_STATE_UNAVAILABLE",
                "message": "Production service is unavailable; cannot verify books lock state.",
            },
        )


def _parse_iso_date(value: Any) -> Optional[DateT]:
    if not value:
        return None
    if isinstance(value, DateT):
        return value
    s = str(value)
    # Strip time component if present
    s = s.split("T", 1)[0].split(" ", 1)[0]
    try:
        return DateT.fromisoformat(s)
    except (TypeError, ValueError):
        return None


async def assert_not_backdated(
    token: str,
    plant_id: str,
    *,
    effective_date: Any = None,
    date_field: Any = None,
) -> None:
    """Reject the request with HTTP 422 if effective_date (or date) falls in
    a period that has been monthly-close APPROVED.

    Args:
        token: Bearer JWT.
        plant_id: X-Plant-ID header value.
        effective_date: typed date or ISO string from the request payload.
        date_field: alternative date field name (transactions sometimes use 'date').
    """
    candidate = effective_date or date_field
    if candidate is None:
        # Real-time write — uses now() server-side. Always allowed.
        return
    candidate_date = _parse_iso_date(candidate)
    if candidate_date is None:
        return
    if not plant_id or plant_id.upper() == "ALL":
        raise HTTPException(
            status_code=422,
            detail={
                "code": "PLANT_REQUIRED_FOR_DATED_WRITE",
                "message": "Select one plant before posting a dated inventory transaction.",
            },
        )

    state = await fetch_books_state(token, plant_id)
    if not state:
        return
    locked_through_raw = state.get("locked_through")
    locked_through = _parse_iso_date(locked_through_raw)
    if not locked_through:
        return

    if candidate_date <= locked_through:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "BOOKS_LOCKED",
                "message": (
                    f"Cannot write with effective_date {candidate_date.isoformat()} — "
                    f"books are locked through {locked_through.isoformat()}."
                ),
                "locked_through": locked_through.isoformat(),
                "candidate_date": candidate_date.isoformat(),
                "locked_by": state.get("locked_by"),
                "locked_at": state.get("locked_at"),
            },
        )


def invalidate_books_cache(plant_id: Optional[str] = None) -> None:
    """Force-refresh the cache. Call after approve_monthly_close."""
    if plant_id:
        _books_cache.pop(plant_id, None)
    else:
        _books_cache.clear()
