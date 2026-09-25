import asyncio
import json
from unittest.mock import AsyncMock, patch
import pytest
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response
from src.routes.purchase import procurement_v2_proxy


def request(body):
    async def receive(): return {'type':'http.request','body':json.dumps(body).encode(),'more_body':False}
    return Request({'type':'http','method':'POST','path':'/','headers':[(b'x-plant-id',b'plant')],'query_string':b''},receive)


@pytest.mark.parametrize('path',['receipts','manual-receipts'])
def test_restored_receipts_cannot_bypass_closed_books(path):
    with patch('src.routes.purchase.assert_not_backdated',new=AsyncMock(side_effect=HTTPException(409,'Books closed'))) as guard, patch('src.routes.purchase.proxy_to_service',new=AsyncMock()) as proxy:
        with pytest.raises(HTTPException):asyncio.run(procurement_v2_proxy(path,request({'received_date':'2026-08-01'}),'token'))
        guard.assert_awaited_once_with('token','plant',effective_date='2026-08-01')
        proxy.assert_not_awaited()


def test_mrp_recomputes_rows_and_rejects_stale_or_unreconciled_demand():
    fresh={'source_version':'version-a','blocked':[],'requirements':[{'item_id':'paper','date':'2026-09-20','qty_kg':120}]}
    body={'as_of_date':'2026-09-01','horizon_end':'2026-09-30','demand_source_version':'version-a','items':[{'item_id':'paper','demand_kg':0}]}
    with patch('src.services.procurement_demand.material_demand',new=AsyncMock(return_value=fresh)),patch('src.routes.purchase.proxy_to_service',new=AsyncMock(return_value=Response())) as proxy:
        asyncio.run(procurement_v2_proxy('mrp-runs',request(body),'token'))
        assert proxy.call_args.kwargs['json_body']['items'][0]['demand_kg']==120
        body['demand_source_version']='old'
        with pytest.raises(HTTPException) as stale:asyncio.run(procurement_v2_proxy('mrp-runs',request(body),'token'))
        assert stale.value.status_code==409
        body['demand_source_version']='version-a';fresh['blocked']=[{'reason':'shared consumption'}]
        with pytest.raises(HTTPException):asyncio.run(procurement_v2_proxy('mrp-runs',request(body),'token'))
        assert proxy.await_count==1
