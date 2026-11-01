"""BFF: the AIT reel serial setting (owner decision 6) and the employee performance report (owner decision 7)
are passed on as they are, with their query and plant header."""
import asyncio
from unittest.mock import AsyncMock, patch

from starlette.requests import Request
from starlette.responses import Response

from src.routes import inventory, production


def _request(method: str, query: bytes = b""):
    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}
    return Request({"type": "http", "method": method, "path": "/", "headers": [(b"x-plant-id", b"plant-a")], "query_string": query}, receive)


def _routes(router):
    return [(method, route.path) for route in router.routes for method in (getattr(route, "methods", None) or set())]


def test_reel_serial_setting_is_a_get_and_a_put_to_inventory():
    keys = _routes(inventory.router)
    assert ("GET", "/reel-serial") in keys and ("PUT", "/reel-serial") in keys
    for method in ("GET", "PUT"):
        request = _request(method)
        with patch("src.routes.inventory.proxy_to_service", new=AsyncMock(return_value=Response(status_code=200))) as proxy:
            asyncio.run(inventory.reel_serial_setting(request, "token"))
        assert proxy.await_args.args[:4] == (inventory.INVENTORY_SERVICE_URL, "/inventory/reel-serial", request, "token")


def test_employee_report_is_one_get_to_production_with_its_filters():
    assert _routes(production.router).count(("GET", "/reports/employees")) == 1
    request = _request("GET", b"date_from=2026-10-01&date_to=2026-10-31&stage=WINDER&department=WINDER&shift=SHIFT_A")
    with patch("src.routes.production.proxy_to_service", new=AsyncMock(return_value=Response(status_code=200))) as proxy:
        asyncio.run(production.employee_performance(request, "token"))
    assert proxy.await_args.args[:4] == (production.PRODUCTION_SERVICE_URL, "/reports/employees", request, "token")
    assert dict(request.query_params)["department"] == "WINDER"
