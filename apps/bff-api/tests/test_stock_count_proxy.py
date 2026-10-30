"""BFF proxies for counts, locations, moves, corrections and the stock book (client 2026-10-28)."""
import asyncio
import json
from collections import Counter
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response

from src.routes import inventory


def _request(method="POST", body=None):
    async def receive():
        return {"type": "http.request", "body": json.dumps(body or {}).encode(), "more_body": False}
    return Request({"type": "http", "method": method, "path": "/", "headers": [(b"x-plant-id", b"plant-a")], "query_string": b""}, receive)


def _keys():
    keys = []
    for route in inventory.router.routes:
        for method in getattr(route, "methods", None) or set():
            if method not in {"HEAD", "OPTIONS"}:
                keys.append((method, route.path))
    return keys


def test_every_stock_route_is_exposed_once():
    keys = _keys()
    assert not [key for key, count in Counter(keys).items() if count > 1]
    wanted = {
        ("GET", "/locations/overview"), ("GET", "/locations/unassigned"), ("POST", "/locations/put-away-all"),
        ("GET", "/locations/{location_id}"), ("PATCH", "/locations/{location_id}"), ("GET", "/locations/lots"),
        ("GET", "/stock-control/corrections/lookup"),
        ("POST", "/stock-moves"), ("POST", "/stock-moves/scan"), ("POST", "/stock-moves/scan/undo"),
        ("GET", "/stock-control/month-figures"), ("GET", "/stock-control/month-figures/{item_id}/sources"),
        ("GET", "/stock-control/corrections"), ("POST", "/stock-control/corrections"),
        ("POST", "/stock-control/corrections/{voucher_id}/approve"), ("POST", "/stock-control/corrections/{voucher_id}/cancel"),
        ("GET", "/counts"), ("POST", "/counts"), ("GET", "/counts/{count_id}"), ("GET", "/counts/{count_id}/racks/{rack_key}"),
        ("POST", "/counts/{count_id}/scan"), ("POST", "/counts/{count_id}/loose"), ("POST", "/counts/{count_id}/submit"),
        ("POST", "/counts/{count_id}/{action}"), ("POST", "/counts/{count_id}/racks/{rack_key}/{action}"),
        ("POST", "/counts/{count_id}/entries/{entry_id}/{action}"), ("PATCH", "/counts/{count_id}/entries/{entry_id}"),
    }
    assert wanted <= set(keys)
    # Fixed paths are declared before the {id} ones so FastAPI never reads "overview" as an id.
    paths = [path for _method, path in keys]
    assert paths.index("/locations/overview") < paths.index("/locations/{location_id}")
    assert paths.index("/locations/lots") < paths.index("/locations/{location_id}")
    assert paths.index("/counts/{count_id}/submit") < paths.index("/counts/{count_id}/{action}")


@pytest.mark.parametrize("call,path", [
    (lambda: inventory.scan_move_stock(_request(body={"code": "AT-1"}), "token"), "/inventory/stock-moves/scan"),
    (lambda: inventory.get_month_figures(_request("GET"), "token"), "/inventory/stock-control/month-figures"),
    (lambda: inventory.count_rack_action("c1", "unassigned", "done", _request(), "token"), "/inventory/counts/c1/racks/unassigned/done"),
    (lambda: inventory.count_entry_action("c1", "e1", "undo", _request(), "token"), "/inventory/counts/c1/entries/e1/undo"),
    (lambda: inventory.count_action("c1", "approve", _request(), "token"), "/inventory/counts/c1/approve"),
    (lambda: inventory.update_location("l1", _request("PATCH", {"name": "Rack"}), "token"), "/inventory/locations/l1"),
])
def test_proxies_forward_to_the_inventory_service(call, path):
    with patch("src.routes.inventory.proxy_to_service", new=AsyncMock(return_value=Response(status_code=200))) as proxy:
        asyncio.run(call())
    assert proxy.await_args.args[0] == inventory.INVENTORY_SERVICE_URL and proxy.await_args.args[1] == path


@pytest.mark.parametrize("call", [
    lambda: inventory.count_action("c1", "delete", _request(), "token"),
    lambda: inventory.count_rack_action("c1", "r1", "wipe", _request(), "token"),
    lambda: inventory.count_entry_action("c1", "e1", "post", _request(), "token"),
])
def test_unknown_count_actions_are_not_forwarded(call):
    with patch("src.routes.inventory.proxy_to_service", new=AsyncMock()) as proxy:
        with pytest.raises(HTTPException) as error:
            asyncio.run(call())
    assert error.value.status_code == 404
    proxy.assert_not_awaited()


def test_a_submitted_count_tells_the_owner():
    body = json.dumps({"count_no": "CNT-20261028-001", "kind_word": "Spot count", "submitted_by": "op@example.com", "plant_id": "plant-a"}).encode()
    with patch("src.routes.inventory.proxy_to_service", new=AsyncMock(return_value=Response(content=body, status_code=200, media_type="application/json"))), \
            patch("src.routes.inventory.emit_from_response", new=AsyncMock()) as emit:
        asyncio.run(inventory.submit_count("c1", _request(), "token"))
    kwargs = emit.await_args.kwargs
    assert kwargs["recipient_roles"] == ["Owner"] and kwargs["href"] == "/inventory/counts/c1"
    assert "CNT-20261028-001" in kwargs["title"]


def test_reservation_consume_clears_the_books_cache_for_its_plant():
    with patch("src.routes.inventory.proxy_to_service", new=AsyncMock(return_value=Response(status_code=200))), \
            patch("src.routes.inventory.invalidate_books_cache", new=AsyncMock()) as invalidate:
        asyncio.run(inventory.consume_reservation("r1", _request(), "token"))
    invalidate.assert_awaited_once_with("plant-a")


@pytest.mark.parametrize("body,word", [
    ({"entity_type": "BATCH", "entity_id": "b1", "stock_status": "DISPATCH_STAGING"}, "only the place"),
    ({"entity_type": "BATCH", "entity_id": "b1", "stock_status": "UNRESTRICTED", "external_ref": "QC-REL-1"}, "only the place"),
    ({"entity_type": "BATCH", "entity_id": "b1", "to_location_id": "l1", "external_ref": "qc-rel-9"}, "QC hold releases"),
])
def test_browser_moves_never_change_qc_status(body, word):
    with patch("src.routes.inventory.proxy_to_service", new=AsyncMock()) as proxy:
        with pytest.raises(HTTPException) as error:
            asyncio.run(inventory.create_stock_move(_request(body=body), "token"))
    assert error.value.status_code == 422 and word in error.value.detail
    proxy.assert_not_awaited()


def test_a_plain_move_is_forwarded_without_a_status():
    body = {"entity_type": "REEL", "entity_id": "r1", "to_location_id": "l1", "stock_status": None}
    with patch("src.routes.inventory.proxy_to_service", new=AsyncMock(return_value=Response(status_code=200))) as proxy:
        asyncio.run(inventory.create_stock_move(_request(body=body), "token"))
    assert proxy.await_args.args[1] == "/inventory/stock-moves"
    assert proxy.await_args.kwargs["json_body"] == {"entity_type": "REEL", "entity_id": "r1", "to_location_id": "l1"}
