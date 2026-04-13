import json
import hashlib
from typing import Any, Dict, Optional, Callable
from fastapi import Response
from src.config import get_redis_client, ANALYTICS_CACHE_TTL_SECONDS

def _scope_cache_fragment(plant_scope: dict) -> str:
    if plant_scope.get("scope_all"):
        allowed = ",".join(sorted(plant_scope.get("allowed_plants") or []))
        return f"ALL:{allowed}"
    return f"SINGLE:{plant_scope.get('selected_plant_id')}"

def _build_cache_key(endpoint_key: str, plant_scope: dict, params: Dict[str, Any]) -> str:
    payload = json.dumps({"scope": _scope_cache_fragment(plant_scope), "params": params}, sort_keys=True, default=str)
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return f"analytics:{endpoint_key}:{digest}"

def _cache_get_json(cache_key: str) -> Optional[Any]:
    client = get_redis_client()
    if client is None:
        return None
    raw = client.get(cache_key)
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None

def _cache_set_json(cache_key: str, payload: Any) -> None:
    client = get_redis_client()
    if client is None:
        return
    try:
        client.setex(cache_key, ANALYTICS_CACHE_TTL_SECONDS, json.dumps(payload, default=str))
    except Exception:
        return

def cached_compute(
    *,
    endpoint_key: str,
    params: Dict[str, Any],
    plant_scope: dict,
    response: Optional[Response],
    producer: Callable[[], Any],
) -> Any:
    cache_key = _build_cache_key(endpoint_key, plant_scope, params)
    cached = _cache_get_json(cache_key)
    if cached is not None:
        if response is not None:
            response.headers["X-Cache"] = "HIT"
        return cached

    payload = producer()
    _cache_set_json(cache_key, payload)
    if response is not None:
        response.headers["X-Cache"] = "MISS"
    return payload
