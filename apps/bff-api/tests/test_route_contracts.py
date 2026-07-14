from collections import defaultdict
import asyncio

import httpx
import pytest
from fastapi import FastAPI

from src.routes.auth import router as auth_router
from src.routes.inventory import _authoritative_tool_inward_body, _validate_tool_issue_job_card
from src.routes.inventory import router as inventory_router
from src.routes.production import router as production_router
from src.routes.spec import router as spec_router


def _route_keys(router):
    keys = []
    for route in router.routes:
        methods = getattr(route, "methods", None) or set()
        for method in methods:
            if method in {"HEAD", "OPTIONS"}:
                continue
            keys.append((method, route.path))
    return keys


def _duplicates(router):
    grouped = defaultdict(int)
    for key in _route_keys(router):
        grouped[key] += 1
    return {key: count for key, count in grouped.items() if count > 1}


def test_spec_bff_routes_do_not_register_duplicate_method_paths():
    assert _duplicates(spec_router) == {}


def test_production_bff_routes_do_not_register_duplicate_method_paths():
    assert _duplicates(production_router) == {}


def test_auth_and_inventory_bff_routes_do_not_register_duplicate_method_paths():
    assert _duplicates(auth_router) == {}
    assert _duplicates(inventory_router) == {}


class _AuthProxyClient:
    def __init__(self):
        self.calls = []

    async def _respond(self, method, url, *, headers=None, **kwargs):
        self.calls.append((method, url))
        token = str((headers or {}).get("Authorization") or "").removeprefix("Bearer ")
        request = httpx.Request(method, url)
        if url.endswith("/auth/me"):
            if token == "forged":
                return httpx.Response(401, json={"detail": "Invalid token"}, request=request)
            roles = ["Owner"] if token == "owner" else ["Sales"]
            return httpx.Response(200, json={"id": "user-1", "roles": roles}, request=request)
        return httpx.Response(200, json={"ok": True}, request=request)

    async def get(self, url, **kwargs):
        return await self._respond("GET", url, **kwargs)

    async def post(self, url, **kwargs):
        return await self._respond("POST", url, **kwargs)

    async def patch(self, url, **kwargs):
        return await self._respond("PATCH", url, **kwargs)

    async def delete(self, url, **kwargs):
        return await self._respond("DELETE", url, **kwargs)


async def _plant_request(method: str, path: str, token: str, monkeypatch):
    from src.routes import auth as auth_routes

    proxy = _AuthProxyClient()
    monkeypatch.setattr(auth_routes, "http_client", proxy)
    app = FastAPI()
    app.include_router(auth_router, prefix="/api/auth")
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.request(method, path, cookies={"token": token}, json={"code": "P2", "name": "Plant 2"})
    return response, proxy


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/auth/plants"),
        ("POST", "/api/auth/plants"),
        ("PATCH", "/api/auth/plants/plant-1"),
        ("DELETE", "/api/auth/plants/plant-1"),
    ],
)
def test_forged_token_cannot_reach_any_plant_operation(method, path, monkeypatch):
    response, proxy = asyncio.run(_plant_request(method, path, "forged", monkeypatch))
    assert response.status_code == 401
    assert proxy.calls == [("GET", "http://127.0.0.1:18001/auth/me")]


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/auth/plants"),
        ("PATCH", "/api/auth/plants/plant-1"),
        ("DELETE", "/api/auth/plants/plant-1"),
    ],
)
def test_non_admin_cannot_mutate_plants(method, path, monkeypatch):
    response, proxy = asyncio.run(_plant_request(method, path, "sales", monkeypatch))
    assert response.status_code == 403
    assert len(proxy.calls) == 1


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/auth/plants"),
        ("PATCH", "/api/auth/plants/plant-1"),
        ("DELETE", "/api/auth/plants/plant-1"),
    ],
)
def test_owner_can_mutate_plants_after_auth_validation(method, path, monkeypatch):
    response, proxy = asyncio.run(_plant_request(method, path, "owner", monkeypatch))
    assert response.status_code == 200
    assert [call[0] for call in proxy.calls] == ["GET", method]


def test_tool_inward_uses_active_master_definition_as_authority():
    incoming = {
        "tool_definition_id": "stale-id",
        "category": "DIE",
        "definition_name": "Browser supplied name",
        "attribute_snapshot": {"code": "legacy"},
        "quantity": 2,
    }
    master = {
        "id": "master-id",
        "category": "BLADE",
        "name": "Plain Blade - 0.9 mm - L 140/130/20",
        "attribute_values": {"type": "Plain", "thickness": "0.9 mm", "length": "140/130/20"},
        "status": "ACTIVE",
        "active": True,
    }

    body = _authoritative_tool_inward_body(incoming, master)

    assert body["tool_definition_id"] == "master-id"
    assert body["category"] == "BLADE"
    assert body["definition_name"] == master["name"]
    assert body["attribute_snapshot"] == master["attribute_values"]
    assert body["quantity"] == 2
    assert incoming["category"] == "DIE"


def test_tool_inward_rejects_discontinued_master():
    with pytest.raises(Exception) as caught:
        _authoritative_tool_inward_body(
            {"tool_definition_id": "master-id"},
            {"id": "master-id", "status": "DISCONTINUED", "active": True},
        )
    assert caught.value.status_code == 409


def test_tool_issue_stage_must_exist_on_selected_job_card():
    card = {"id": "job-1", "stages": [{"stage_type": "WINDER"}, {"stage_type": "PROCESS"}]}
    _validate_tool_issue_job_card(card, "PROCESS")
    with pytest.raises(Exception) as caught:
        _validate_tool_issue_job_card(card, "PACKING")
    assert caught.value.status_code == 409
