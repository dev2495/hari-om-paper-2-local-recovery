"""BFF: copying the common masters into a new plant (owner decision 3 Nov 2026). A check (dry run) is passed on
as is; a real copy then makes the new plant's stock items from the copied materials."""
import asyncio
import json
from unittest.mock import AsyncMock, patch

from starlette.requests import Request
from starlette.responses import Response

from src.routes import master


def _post(body: dict):
    async def receive():
        return {"type": "http.request", "body": json.dumps(body).encode(), "more_body": False}
    return Request({"type": "http", "method": "POST", "path": "/", "headers": [(b"content-type", b"application/json")], "query_string": b""}, receive)


def _upstream(body: dict, status: int = 200):
    return Response(content=json.dumps(body), status_code=status, media_type="application/json")


def test_check_is_forwarded_and_never_syncs_stock_items():
    keys = [(method, route.path) for route in master.router.routes for method in (getattr(route, "methods", None) or set())]
    assert keys.count(("POST", "/copy-common")) == 1
    request = _post({"source_plant_id": "a", "target_plant_id": "b", "dry_run": True})
    with patch("src.routes.master.proxy_to_service", new=AsyncMock(return_value=_upstream({"dry_run": True, "types": []}))) as proxy, \
            patch("src.services.master_items.sync_master_items", new=AsyncMock()) as sync:
        response = asyncio.run(master.copy_common_masters(request, "token"))
    assert proxy.await_args.args[1] == "/master/copy-common"
    assert response.status_code == 200
    sync.assert_not_called()


def test_copy_syncs_stock_items_for_the_target_plant():
    request = _post({"source_plant_id": "a", "target_plant_id": "b", "dry_run": False})
    upstream = _upstream({"dry_run": False, "target_plant_id": "plant-b", "copied": 3, "types": []})
    with patch("src.routes.master.proxy_to_service", new=AsyncMock(return_value=upstream)), \
            patch("src.services.master_items.sync_master_items", new=AsyncMock(return_value={"created": [{"item_code": "351"}], "conflicts": []})) as sync:
        response = asyncio.run(master.copy_common_masters(request, "token"))
    sync.assert_awaited_once_with("token", "plant-b")
    assert json.loads(response.body)["stock_items"] == {"created": 1, "conflicts": 0}


def test_refused_copy_is_passed_on_without_a_sync():
    request = _post({"source_plant_id": "a", "target_plant_id": "a", "dry_run": False})
    with patch("src.routes.master.proxy_to_service", new=AsyncMock(return_value=_upstream({"detail": "Source and target must be different plants"}, 400))), \
            patch("src.services.master_items.sync_master_items", new=AsyncMock()) as sync:
        response = asyncio.run(master.copy_common_masters(request, "token"))
    assert response.status_code == 400
    sync.assert_not_called()
