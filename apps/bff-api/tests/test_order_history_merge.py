"""The order page shows one history: the order's own events and its job cards' events, newest first."""
import asyncio

import httpx
from fastapi import FastAPI
from src.routes import sales


def _app():
    app = FastAPI()
    app.include_router(sales.router, prefix='/api/sales')
    app.dependency_overrides[sales.get_token] = lambda: 'test-token'
    return app


def _response(status, body):
    return httpx.Response(status, json=body, request=httpx.Request('GET', 'http://service'))


def test_order_history_merges_sales_and_card_events(monkeypatch):
    calls = []

    async def fake_get(url, headers=None, params=None):
        calls.append((url, headers.get('X-Plant-ID'), params))
        if url.endswith('/timeline'):
            return _response(200, {'order_no': 'SO/26/10/54', 'status': 'released', 'warnings': [], 'events': [
                {'id': 1, 'created_at': '2026-10-27T03:40:00', 'actor': 'sales', 'event_type': 'SALES_ORDER_CREATED', 'title': 'Order created'},
                {'id': 2, 'created_at': '2026-10-27T03:46:00', 'actor': 'sales', 'event_type': 'SALES_ORDER_RELEASED', 'title': 'Released'},
            ]})
        return _response(200, {'job_cards': [{'id': 'jc-1', 'job_card_no': '26/10/42'}], 'events': [
            {'id': 'p:9', 'at': '2026-10-27T10:13:00', 'kind': 'QC_FLAG', 'title': 'Flagged reading', 'flag': True, 'job_card_no': '26/10/42'},
        ]})

    monkeypatch.setattr(sales.http_client, 'get', fake_get)

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_app()), base_url='http://test') as client:
            return await client.get('/api/sales/orders/order-1/history', headers={'X-Plant-ID': 'plant-1'})

    response = asyncio.run(run())
    assert response.status_code == 200
    body = response.json()
    assert [row['kind'] for row in body['events']] == ['QC_FLAG', 'RELEASE', 'ORDER']
    assert [row['source'] for row in body['events']] == ['PRODUCTION', 'SALES', 'SALES']
    assert body['summary'] == {'events': 3, 'flags': 1}
    assert body['job_cards'][0]['job_card_no'] == '26/10/42'
    assert body['order_no'] == 'SO/26/10/54' and body['warnings'] == []
    assert all(plant == 'plant-1' for _, plant, _ in calls)
    assert any(params == {'depth': 'full'} for url, _, params in calls if url.endswith('/timeline'))


def test_order_history_keeps_order_events_when_production_is_down(monkeypatch):
    async def fake_get(url, headers=None, params=None):
        if url.endswith('/timeline'):
            return _response(200, {'order_no': 'SO/26/10/54', 'events': [
                {'id': 1, 'created_at': '2026-10-27T03:40:00', 'event_type': 'SALES_ORDER_CREATED', 'title': 'Order created'},
            ]})
        raise httpx.ConnectError('production down')

    monkeypatch.setattr(sales.http_client, 'get', fake_get)

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_app()), base_url='http://test') as client:
            return await client.get('/api/sales/orders/order-1/history')

    body = asyncio.run(run()).json()
    assert [row['kind'] for row in body['events']] == ['ORDER']
    assert body['warnings'] and 'Job card events could not be loaded' in body['warnings'][0]


def test_order_history_passes_sales_refusal_through(monkeypatch):
    async def fake_get(url, headers=None, params=None):
        if url.endswith('/timeline'):
            return _response(404, {'detail': 'Sales order not found'})
        return _response(200, {'events': []})

    monkeypatch.setattr(sales.http_client, 'get', fake_get)

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_app()), base_url='http://test') as client:
            return await client.get('/api/sales/orders/missing/history')

    response = asyncio.run(run())
    assert response.status_code == 404 and response.json()['detail'] == 'Sales order not found'
