"""BFF gate (6 Nov 2026): public check-in rate limits, nothing private leaks, host filled from the auth list,
and a watchman-only login reaches the gate desk only."""
import asyncio
import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import HTTPException
from starlette.requests import Request

from src import main
from src.routes import gate

TOKEN = "krbdvG7bgj-yB4KgGaU3rA"
HOSTS = {"items": [{"id": "u1", "name": "Harish", "email": "harish@example.com", "department_key": "STORES", "department": "Stores"}],
         "departments": [{"key": "STORES", "label": "Stores"}, {"key": "SALES", "label": "Sales"}]}


def _request(method="GET", body: bytes = b"", ip="10.0.0.7", headers=None):
    sent = {"done": False}

    async def receive():
        if sent["done"]:
            return {"type": "http.disconnect"}
        sent["done"] = True
        return {"type": "http.request", "body": body, "more_body": False}
    raw = [(b"x-erp-client-ip", ip.encode()), (b"content-type", b"application/json")] + (headers or [])
    return Request({"type": "http", "method": method, "path": "/", "headers": raw, "query_string": b"", "client": ("127.0.0.1", 1)}, receive)


def _response(data, status=200):
    return httpx.Response(status, json=data, request=httpx.Request("GET", "http://x"))


@pytest.fixture(autouse=True)
def fresh_limits():
    gate.WRITE_LIMIT.reset()
    gate.READ_LIMIT.reset()
    yield


def test_sliding_window_allows_ten_a_minute_per_ip():
    window = gate.SlidingWindow(10, 60.0)
    assert all(asyncio.run(window.allow("a", now=float(i))) for i in range(10))
    assert asyncio.run(window.allow("a", now=10.0)) is False
    assert asyncio.run(window.allow("b", now=10.0)) is True  # another phone is not affected
    assert asyncio.run(window.allow("a", now=61.0)) is True  # a minute later the first try has expired


def test_public_lookup_never_reveals_a_visitor_and_is_rate_limited():
    upstream = AsyncMock(return_value=_response({"known": True, "name": "Suresh", "company": "Sample"}))
    with patch.object(gate, "_call", new=upstream):
        for _ in range(10):
            result = asyncio.run(gate.public_lookup(TOKEN, _request("POST", json.dumps({"mobile": "9876543210"}).encode())))
            assert result == {"known": False}  # even a known mobile reveals nothing logged-out
        with pytest.raises(HTTPException) as limited:
            asyncio.run(gate.public_lookup(TOKEN, _request("POST", json.dumps({"mobile": "9876543210"}).encode())))
        assert limited.value.status_code == 429
        upstream.assert_not_called()
        # Another IP still gets through.
        asyncio.run(gate.public_lookup(TOKEN, _request("POST", json.dumps({"mobile": "9876543210"}).encode(), ip="10.0.0.8")))


def test_public_hosts_show_name_and_department_only():
    async def fake(method, url, **kwargs):
        if "/public/gates/" in url:
            return _response({"gate_name": "Main gate", "plant_id": "plant-a"})
        return _response(HOSTS)
    with patch.object(gate, "_call", new=AsyncMock(side_effect=fake)):
        result = asyncio.run(gate.public_hosts(TOKEN, _request(), q="har"))
    assert result["items"] == [{"id": "u1", "name": "Harish", "department": "Stores", "department_key": "STORES"}]
    assert "harish@example.com" not in json.dumps(result)
    assert result["departments"] == [{"key": "STORES", "label": "Stores"}]  # only departments with people


def test_check_in_fills_the_host_from_auth_and_refuses_unknown_purposes():
    sent = {}

    async def fake(method, url, **kwargs):
        if url.endswith(f"/public/gates/{TOKEN}"):
            return _response({"gate_name": "Main gate", "plant_id": "plant-a"})
        if "public-list" in url:
            return _response([{"code": "VP-MEETING", "label": "Meeting"}])
        if "gate-hosts" in url:
            return _response(HOSTS)
        sent.update(kwargs.get("json") or {})
        return _response({"created": True, "pass_token": "p" * 22, "pass": {"visit_no": "V-2611-001"}})
    body = {"request_id": "6f1b6f5e-1111-4a4a-9b9b-222222222222", "mobile": "9876543210", "name": "Suresh", "purpose_code": "VP-MEETING",
            "host_user_id": "u1", "host_email": "attacker@example.com", "host_name": "Fake", "people": 1}
    with patch.object(gate, "_call", new=AsyncMock(side_effect=fake)):
        result = asyncio.run(gate.public_check_in(TOKEN, _request("POST", json.dumps(body).encode())))
        assert result["pass"]["visit_no"] == "V-2611-001"
        assert sent["host_email"] == "harish@example.com" and sent["host_name"] == "Harish" and sent["purpose_label"] == "Meeting"
        with pytest.raises(HTTPException) as bad:
            asyncio.run(gate.public_check_in(TOKEN, _request("POST", json.dumps({**body, "purpose_code": "VP-NOPE"}).encode())))
        assert bad.value.status_code == 422
        with pytest.raises(HTTPException) as stranger:
            asyncio.run(gate.public_check_in(TOKEN, _request("POST", json.dumps({**body, "host_user_id": "u9"}).encode())))
        assert stranger.value.status_code == 422


def test_bad_token_shape_is_not_found():
    with pytest.raises(HTTPException) as bad:
        asyncio.run(gate.public_form("../etc", _request()))
    assert bad.value.status_code == 404


class _Me:
    def __init__(self, roles):
        self.roles = roles

    def json(self):
        return {"roles": self.roles, "role": self.roles[0]}


def test_watchman_only_login_reaches_the_gate_desk_only():
    watchman = _Me(["Watchman"])
    for path in ("/api/gate/desk", "/api/gate/entries", "/api/documents", "/api/auth/me", "/api/auth/notifications/summary", "/api/master/reason-codes"):
        assert main.watchman_may_open(path, watchman), path
    for path in ("/api/purchase/v2/receipts", "/api/inventory/items", "/api/master/vendors", "/api/auth/users/", "/api/dispatch/ready-jobs", "/api/production/job-cards"):
        assert not main.watchman_may_open(path, watchman), path
    # Anyone with another role is not limited by this rule.
    assert main.watchman_may_open("/api/purchase/v2/receipts", _Me(["Watchman", "Store"]))
    assert main.watchman_may_open("/api/purchase/v2/receipts", _Me(["Store"]))
