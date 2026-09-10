import asyncio
import httpx
import pytest
from src.main import app
from src.routes import auth

@pytest.mark.parametrize('validation_status,expected',[(401,401),(403,401),(500,503),(200,404)])
def test_protected_routes_validate_current_access_even_without_plant_header(monkeypatch,validation_status,expected):
    called=[]
    async def validate(url,**kwargs):
        called.append(url)
        return httpx.Response(validation_status,json={})
    monkeypatch.setattr(auth.http_client,'get',validate)
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://localhost') as client:
            return await client.get('/api/nonexistent-protected-route',headers={'Authorization':'Bearer stale-or-current'})
    response=asyncio.run(run())
    assert response.status_code==expected
    assert called==[auth.AUTH_SERVICE_URL+'/auth/me']

def test_auth_outage_fails_closed(monkeypatch):
    async def unavailable(*args,**kwargs): raise httpx.ConnectError('offline')
    monkeypatch.setattr(auth.http_client,'get',unavailable)
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://localhost') as client:
            return await client.post('/api/inventory/dispatch',headers={'Authorization':'Bearer old'})
    assert asyncio.run(run()).status_code==503
