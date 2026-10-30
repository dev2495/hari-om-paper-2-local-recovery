"""BFF: the issue history (client 2026-10-30) is one GET passed to the inventory service with its filters."""
import asyncio
from unittest.mock import AsyncMock, patch

from starlette.requests import Request
from starlette.responses import Response

from src.routes import inventory


def _get(query: bytes = b""):
    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}
    return Request({"type": "http", "method": "GET", "path": "/", "headers": [(b"x-plant-id", b"plant-a")], "query_string": query}, receive)


def test_issue_history_is_exposed_once_and_forwarded():
    keys = [(method, route.path) for route in inventory.router.routes for method in (getattr(route, "methods", None) or set())]
    assert keys.count(("GET", "/issue-history")) == 1
    request = _get(b"date_from=2026-10-01&date_to=2026-10-30&shift=B&person=store")
    with patch("src.routes.inventory.proxy_to_service", new=AsyncMock(return_value=Response(status_code=200))) as proxy:
        asyncio.run(inventory.issue_history(request, "token"))
    args = proxy.await_args.args
    assert args[0] == inventory.INVENTORY_SERVICE_URL and args[1] == "/inventory/issue-history" and args[2] is request
