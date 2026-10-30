"""Order close reasons: a duplicate code is a plain 422, never a 409/500 from masters (checker 30 Oct)."""
import asyncio

import httpx
from fastapi import FastAPI
from src.routes import sales


def _app():
    app = FastAPI()
    app.include_router(sales.router, prefix='/api/sales')
    app.dependency_overrides[sales.get_token] = lambda: 'test-token'
    return app


def _create(monkeypatch, existing, post_status=200):
    posted = []

    async def fake_request(method, url, headers=None, **kwargs):
        if method == 'GET':
            return httpx.Response(200, json=existing, request=httpx.Request(method, url))
        posted.append(kwargs.get('json'))
        body = {'detail': 'Reason code already exists in this plant'} if post_status == 409 else {'id': 'r1', **kwargs.get('json', {})}
        return httpx.Response(post_status, json=body, request=httpx.Request(method, url))

    monkeypatch.setattr(sales.http_client, 'request', fake_request)
    monkeypatch.setattr(sales, 'current_user_claims', lambda token: {'roles': ['Owner']})

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_app()), base_url='http://test') as client:
            return await client.post('/api/sales/order-close-reasons', json={'label': 'Balance not required', 'code': 'so-balance-not-req'})

    return asyncio.run(run()), posted


def test_a_code_already_used_by_any_reason_is_a_plain_422(monkeypatch):
    response, posted = _create(monkeypatch, [{'id': 'x', 'code': 'SO-BALANCE-NOT-REQ', 'category': 'DOWNTIME', 'is_active': False}])
    assert response.status_code == 422
    assert 'already used by another reason' in response.json()['detail']
    assert posted == []


def test_a_masters_409_race_is_also_a_plain_422(monkeypatch):
    response, _ = _create(monkeypatch, [], post_status=409)
    assert response.status_code == 422
    assert 'SO-BALANCE-NOT-REQ' in response.json()['detail']


def test_a_new_code_is_created_as_an_order_close_reason(monkeypatch):
    response, posted = _create(monkeypatch, [{'id': 'x', 'code': 'SO-OTHER', 'category': 'SO_CLOSE'}])
    assert response.status_code == 200
    assert posted[0]['code'] == 'SO-BALANCE-NOT-REQ' and posted[0]['category'] == sales.ORDER_CLOSE_CATEGORY
