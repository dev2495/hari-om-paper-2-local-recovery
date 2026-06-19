"""Books-locked guard.

Caches /reconciliation/books-state per plant for 60s and rejects mutations
whose effective_date / date falls inside the locked period.

The cache layer is Redis-first with a graceful in-process fallback, so the
guard remains correct even if Redis is unavailable (single-replica deploys
keep working, multi-replica deploys stay coherent when Redis is up).

Used by inventory + sales BFF mutation routes to enforce the "no backdated
writes after monthly-close approval" rule.
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import date as DateT, timedelta
from typing import Any, Optional

import httpx
from fastapi import HTTPException

logger = logging.getLogger(__name__)

PRODUCTION_SERVICE_URL = os.getenv("PRODUCTION_SERVICE_URL", "http://localhost:8004")
REDIS_URL = os.getenv("BFF_BOOKS_GUARD_REDIS_URL") or os.getenv("REDIS_URL") or ""
REQUIRE_SHARED_CACHE = os.getenv("BFF_BOOKS_GUARD_REQUIRE_SHARED_CACHE", "false").lower() in {
    "1",
    "true",
    "yes",
    "on",
}

_CACHE_TTL_SEC = 60
_TIMEOUT_SEC = 5.0
_REDIS_KEY_PREFIX = "bff:books_guard:"


# ---------------------------------------------------------------------------
# Cache backends
# ---------------------------------------------------------------------------

# In-process fallback (used if REDIS_URL is not set, or Redis is unreachable).
_inprocess_cache: dict[str, tuple[float, dict[str, Any]]] = {}


class _RedisCache:
    """Thin async wrapper over redis.asyncio.

    Lazily connects and self-disables on the first connection failure so a
    Redis outage cannot wedge writes. Marks itself "down" for 30s then retries.
    """

    def __init__(self, url: str) -> None:
        self._url = url
        self._client: Any = None
        self._down_until: float = 0.0
        self._last_error: Optional[str] = None

    async def _get_client(self) -> Optional[Any]:
        if not self._url:
            self._last_error = "REDIS_URL is not configured"
            return None
        if time.time() < self._down_until:
            return None
        if self._client is not None:
            return self._client
        try:
            # Imported lazily so the module loads even if `redis` isn't installed.
            import redis.asyncio as redis_async  # type: ignore
        except Exception as exc:  # pragma: no cover - import-time guard
            logger.warning("redis package not available: %s", exc)
            self._last_error = str(exc)[:300]
            self._down_until = time.time() + 300.0
            return None
        try:
            self._client = redis_async.from_url(self._url, decode_responses=True)
            # Verify on first use so we fail fast rather than on the first .get
            await self._client.ping()
            self._last_error = None
        except Exception as exc:
            logger.warning("Redis not reachable, falling back to in-process cache: %s", exc)
            self._last_error = str(exc)[:300]
            self._client = None
            self._down_until = time.time() + 30.0
            return None
        return self._client

    async def get(self, plant_id: str) -> Optional[dict[str, Any]]:
        client = await self._get_client()
        if client is None:
            return None
        try:
            raw = await client.get(f"{_REDIS_KEY_PREFIX}{plant_id}")
        except Exception as exc:
            logger.warning("Redis GET failed, dropping cache layer: %s", exc)
            self._last_error = str(exc)[:300]
            self._client = None
            self._down_until = time.time() + 30.0
            return None
        if not raw:
            return None
        try:
            return json.loads(raw)
        except (TypeError, ValueError):
            return None

    async def set(self, plant_id: str, payload: dict[str, Any]) -> None:
        client = await self._get_client()
        if client is None:
            return
        try:
            await client.setex(
                f"{_REDIS_KEY_PREFIX}{plant_id}",
                _CACHE_TTL_SEC,
                json.dumps(payload),
            )
        except Exception as exc:
            logger.warning("Redis SETEX failed, ignoring: %s", exc)
            self._last_error = str(exc)[:300]
            self._client = None
            self._down_until = time.time() + 30.0

    async def invalidate(self, plant_id: Optional[str]) -> None:
        client = await self._get_client()
        if client is None:
            return
        try:
            if plant_id:
                await client.delete(f"{_REDIS_KEY_PREFIX}{plant_id}")
            else:
                # SCAN+DEL across our prefix. Cheap because the keyspace is tiny.
                cursor = 0
                while True:
                    cursor, keys = await client.scan(cursor=cursor, match=f"{_REDIS_KEY_PREFIX}*", count=100)
                    if keys:
                        await client.delete(*keys)
                    if cursor == 0:
                        break
        except Exception as exc:
            logger.warning("Redis invalidate failed: %s", exc)
            self._last_error = str(exc)[:300]
            self._client = None
            self._down_until = time.time() + 30.0

    def status(self) -> dict[str, Any]:
        if not self._url:
            state = "not_configured"
        elif self._client is not None:
            state = "connected"
        elif time.time() < self._down_until:
            state = "temporarily_down"
        else:
            state = "not_connected"
        return {
            "configured": bool(self._url),
            "state": state,
            "down_until": self._down_until if self._down_until else None,
            "last_error": self._last_error,
        }


_redis_cache = _RedisCache(REDIS_URL)


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------


async def fetch_books_state(token: str, plant_id: str) -> Optional[dict[str, Any]]:
    """Fetch books-state for the plant, with 60s Redis cache (in-proc fallback)."""
    now = time.time()

    # Redis lookup first (no-op when Redis is disabled)
    cached = await _redis_cache.get(plant_id)
    if cached is not None:
        return cached

    if REQUIRE_SHARED_CACHE:
        redis_status = _redis_cache.status()
        if redis_status["state"] != "connected":
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "BOOKS_GUARD_SHARED_CACHE_REQUIRED",
                    "message": "Shared books-lock cache is required but Redis is not available.",
                    "redis": redis_status,
                },
            )

    # In-process fallback (covers Redis-down and single-instance deploys)
    inprocess = _inprocess_cache.get(plant_id)
    if inprocess and inprocess[0] > now:
        return inprocess[1]

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
        # Populate both caches so each layer is independently warm.
        _inprocess_cache[plant_id] = (now + _CACHE_TTL_SEC, data)
        await _redis_cache.set(plant_id, data)
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

    # P2.6 — Reject future-dated entries (more than 1 day ahead of today).
    # The 1-day cushion preserves overnight / cross-timezone leeway while
    # blocking "post a stage 2 weeks in the future" mistakes.
    today = DateT.today()
    if candidate_date > today + timedelta(days=1):
        raise HTTPException(
            status_code=422,
            detail={
                "code": "FUTURE_DATE_NOT_ALLOWED",
                "message": "Cannot post a transaction more than 1 day in the future",
                "candidate_date": candidate_date.isoformat(),
            },
        )

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


async def invalidate_books_cache(plant_id: Optional[str] = None) -> None:
    """Force-refresh the cache. Call after approve_monthly_close.

    Drops both the Redis row(s) and the in-process row(s) so any worker that
    reads next will pull a fresh state from production-service.
    """
    if plant_id:
        _inprocess_cache.pop(plant_id, None)
    else:
        _inprocess_cache.clear()
    await _redis_cache.invalidate(plant_id)


# Backwards-compatible synchronous alias used by older call-sites. New code
# should await the async variant above.
def invalidate_books_cache_sync(plant_id: Optional[str] = None) -> None:
    """Synchronous in-process-only invalidation (kept for legacy callers).

    Synchronous code paths cannot reach Redis without an event loop, so this
    only clears the in-process cache. Async paths should call
    :func:`invalidate_books_cache` for full coherence.
    """
    if plant_id:
        _inprocess_cache.pop(plant_id, None)
    else:
        _inprocess_cache.clear()


def books_guard_status() -> dict[str, Any]:
    """Expose cache mode for readiness/ops checks."""
    redis_status = _redis_cache.status()
    if REQUIRE_SHARED_CACHE:
        mode = "shared_required"
    elif redis_status["configured"]:
        mode = "redis_with_inprocess_fallback"
    else:
        mode = "inprocess_only"
    return {
        "ttl_seconds": _CACHE_TTL_SEC,
        "mode": mode,
        "require_shared_cache": REQUIRE_SHARED_CACHE,
        "redis": redis_status,
        "inprocess_keys": len(_inprocess_cache),
    }
