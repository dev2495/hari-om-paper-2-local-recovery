"""One closed-month refusal shape leaving the BFF (spec C4, checker 30 Oct): the BFF guard's own 409
and a service 409 passed through a proxy both read as data.code and data.detail.code."""
import asyncio
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI, HTTPException
from starlette.responses import Response

from src import main
from src.routes import auth
from src.services import books_guard

LOCKED = {"code": "BOOKS_LOCKED", "message": "March 2026 is closed. Ask the owner to re-open it.", "month": "2026-03"}


def _assert_one_shape(body):
    assert body["code"] == "BOOKS_LOCKED" and body["message"] == LOCKED["message"] and body["month"] == "2026-03"
    assert body["detail"]["code"] == "BOOKS_LOCKED" and body["detail"]["message"] == LOCKED["message"] and body["detail"]["month"] == "2026-03"
    assert "detail" not in body["detail"]


def test_books_locked_body_unifies_both_shapes_and_ignores_others():
    _assert_one_shape(books_guard.books_locked_body({"detail": dict(LOCKED)}))
    _assert_one_shape(books_guard.books_locked_body({**LOCKED, "candidate_date": "2026-03-10"}))
    assert books_guard.books_locked_body({"detail": "Only 0 kg left"}) is None
    assert books_guard.books_locked_body({"detail": {"code": "RACK_IN_OPEN_COUNT"}}) is None
    assert books_guard.books_locked_body(["x"]) is None


def _client_app():
    app = FastAPI()
    app.middleware("http")(main.one_books_locked_shape)
    app.add_exception_handler(HTTPException, main._unwrap_structured_guard_errors)

    @app.post("/guard")
    async def guard():
        with patch("src.services.books_guard.fetch_books_state", new=AsyncMock(return_value={"locked_months": ["2026-03"]})):
            await books_guard.assert_not_backdated("token", "plant-e", effective_date="2026-03-10")

    @app.post("/service")
    async def service():
        return Response(content=b'{"detail": {"code": "BOOKS_LOCKED", "message": "March 2026 is closed. Ask the owner to re-open it.", "month": "2026-03"}}', status_code=409, media_type="application/json")

    @app.post("/other")
    async def other():
        raise HTTPException(status_code=409, detail="Already posted")

    return app


def _post(app, path):
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost") as client:
            return await client.post(path)
    return asyncio.run(run())


def test_guard_and_service_refusals_leave_the_bff_in_one_shape():
    app = _client_app()
    for path in ("/guard", "/service"):
        response = _post(app, path)
        assert response.status_code == 409
        _assert_one_shape(response.json())
    other = _post(app, "/other")
    assert other.status_code == 409 and other.json() == {"detail": "Already posted"}


def test_the_real_app_reshapes_a_proxied_inventory_refusal(monkeypatch):
    async def validate(url, **kwargs):
        return httpx.Response(200, json={})
    monkeypatch.setattr(auth.http_client, "get", validate)
    upstream = Response(content=b'{"detail": {"code": "BOOKS_LOCKED", "message": "March 2026 is closed. Ask the owner to re-open it.", "month": "2026-03"}}', status_code=409, media_type="application/json")
    with patch("src.routes.inventory.proxy_to_service", new=AsyncMock(return_value=upstream)):
        async def run():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://localhost") as client:
                return await client.post("/api/inventory/books/lock", json={"month": "2026-03"}, headers={"Authorization": "Bearer t"})
        response = asyncio.run(run())
    assert response.status_code == 409
    _assert_one_shape(response.json())
