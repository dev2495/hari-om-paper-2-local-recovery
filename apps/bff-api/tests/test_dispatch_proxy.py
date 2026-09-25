"""Browser canonical URLs must reach dispatch without a slash redirect loop."""
import asyncio
import json

import httpx
import pytest
from fastapi import FastAPI, Response
from src.routes import dispatch


@pytest.mark.parametrize('path', ['/api/dispatch', '/api/dispatch/'])
def test_dispatch_post_accepts_both_paths_without_redirect(monkeypatch, path):
    app = FastAPI()
    app.include_router(dispatch.router, prefix='/api/dispatch')
    app.dependency_overrides[dispatch.get_token] = lambda: 'test-token'
    forwarded = []

    async def proxy(base_url, service_path, request, token):
        forwarded.append((service_path, await request.json(), token))
        return Response(json.dumps({'id': 'dispatch-1'}), media_type='application/json')

    async def emit(*args, **kwargs):
        pass

    monkeypatch.setattr(dispatch, 'proxy_to_service', proxy)
    monkeypatch.setattr(dispatch, 'emit_from_response', emit)

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test', follow_redirects=False) as client:
            response = await client.post(path, json={'job_card_id': 'job-1', 'status': 'SEALED'})
            assert response.status_code == 200
            assert 'location' not in response.headers
            assert response.json()['id'] == 'dispatch-1'

    asyncio.run(run())
    assert forwarded == [('/dispatch/', {'job_card_id': 'job-1', 'status': 'SEALED'}, 'test-token')]
