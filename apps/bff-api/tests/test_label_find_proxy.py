"""BFF: finding a lot / reel by its typed number (issue desks, 2026-10-30) is one read-only GET passed on as is."""
import asyncio
from unittest.mock import AsyncMock, patch

from starlette.requests import Request
from starlette.responses import Response

from src.routes import inventory


def _get(query: bytes = b""):
    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}
    return Request({"type": "http", "method": "GET", "path": "/", "headers": [(b"x-plant-id", b"plant-a")], "query_string": query}, receive)


def test_label_find_is_exposed_once_as_a_get_and_forwarded_with_its_query():
    keys = [(method, route.path) for route in inventory.router.routes for method in (getattr(route, "methods", None) or set())]
    assert keys.count(("GET", "/labels/find")) == 1
    assert not any(path == "/labels/find" and method != "GET" for method, path in keys)
    # Declared before the label-by-id routes, so "find" is never read as a batch or reel id.
    paths = [route.path for route in inventory.router.routes]
    assert paths.index("/labels/find") < paths.index("/labels/batches/{batch_id}")
    request = _get(b"code=in%2F26%2F028-b002&kind=ALL")
    with patch("src.routes.inventory.proxy_to_service", new=AsyncMock(return_value=Response(status_code=200))) as proxy:
        asyncio.run(inventory.find_label_by_number(request, "token"))
    args = proxy.await_args.args
    assert args[0] == inventory.INVENTORY_SERVICE_URL and args[1] == "/inventory/labels/find" and args[2] is request and args[3] == "token"
    assert dict(request.query_params) == {"code": "in/26/028-b002", "kind": "ALL"}
