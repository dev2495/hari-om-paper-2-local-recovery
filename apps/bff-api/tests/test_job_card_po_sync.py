"""Copying the order's customer PO onto its job cards: a refusal keeps its own status and plain words."""
import asyncio

import httpx
from fastapi import FastAPI
from src.routes import sales


def _app():
    app = FastAPI()
    app.include_router(sales.router, prefix='/api/sales')
    app.dependency_overrides[sales.get_token] = lambda: 'test-token'
    return app


def _run_retry(monkeypatch, status, body):
    async def fake_post(url, headers=None, **kwargs):
        assert url.endswith('/sales-orders/order-1/customer-po-sync')
        return httpx.Response(status, json=body, request=httpx.Request('POST', url))

    monkeypatch.setattr(sales.http_client, 'post', fake_post)

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_app()), base_url='http://test') as client:
            return await client.post('/api/sales/orders/order-1/job-card-po-sync', json={})

    return asyncio.run(run())


def test_role_refusal_is_a_403_with_plain_words_not_an_outage(monkeypatch):
    response = _run_retry(monkeypatch, 403, {'detail': 'Operation not permitted for your role'})
    assert response.status_code == 403
    assert 'Your role cannot update the job cards' in response.json()['detail']


def test_missing_order_is_a_404(monkeypatch):
    response = _run_retry(monkeypatch, 404, {'detail': 'Sales order not found'})
    assert response.status_code == 404


def test_server_error_is_still_a_502(monkeypatch):
    response = _run_retry(monkeypatch, 500, {'detail': 'boom'})
    assert response.status_code == 502
    assert response.json()['detail'] == 'The job cards could not be updated with the new PO.'


def test_success_returns_the_updated_cards(monkeypatch):
    response = _run_retry(monkeypatch, 200, {'job_cards': 2, 'updated': ['26/10/1']})
    assert response.status_code == 200
    assert response.json() == {'ok': True, 'job_cards': 2, 'updated': ['26/10/1']}
