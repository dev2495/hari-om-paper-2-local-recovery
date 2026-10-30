"""BFF proxies for the store books lock (spec 5): GET locks, POST lock / unlock (client 2026-10-30)."""
import asyncio
import json
from unittest.mock import AsyncMock, patch

from starlette.requests import Request
from starlette.responses import Response

from src.routes import inventory


def _request(body=None):
    async def receive():
        return {"type": "http.request", "body": json.dumps(body or {}).encode(), "more_body": False}
    return Request({"type": "http", "method": "POST", "path": "/", "headers": [(b"x-plant-id", b"plant-a")], "query_string": b""}, receive)


def _keys():
    return {(method, route.path) for route in inventory.router.routes for method in (getattr(route, "methods", None) or set())}


def test_books_routes_are_exposed():
    assert {("GET", "/books/locks"), ("POST", "/books/lock"), ("POST", "/books/unlock")} <= _keys()


def test_lock_and_unlock_forward_to_inventory_and_drop_the_guard_cache():
    for action, handler in (("lock", inventory.lock_books_month), ("unlock", inventory.unlock_books_month)):
        with patch("src.routes.inventory.proxy_to_service", new=AsyncMock(return_value=Response(status_code=200))) as proxy, \
                patch("src.routes.inventory.invalidate_books_cache", new=AsyncMock()) as invalidate:
            asyncio.run(handler(_request({"month": "2026-09"}), "token"))
        assert proxy.await_args.args[1] == f"/inventory/books/{action}"
        invalidate.assert_awaited_once_with("plant-a")


def test_a_refused_lock_keeps_the_cache():
    with patch("src.routes.inventory.proxy_to_service", new=AsyncMock(return_value=Response(status_code=403))), \
            patch("src.routes.inventory.invalidate_books_cache", new=AsyncMock()) as invalidate:
        response = asyncio.run(inventory.lock_books_month(_request({"month": "2026-09"}), "token"))
    assert response.status_code == 403
    invalidate.assert_not_awaited()
