"""Shared test setup for production-service.

Sealing a challan reads the plant and customer masters from auth-service and masterdata-service
(client 2026-10-28). Those services do not run under pytest, so seal tests get the challan blocks
as they were sent. A test module that checks the master read itself sets ``CHALLAN_MASTERS_LIVE = True``.
"""
import sys

import pytest


@pytest.fixture(autouse=True)
def _challan_masters_offline(request, monkeypatch):
    if getattr(request.module, "CHALLAN_MASTERS_LIVE", False):
        return
    module = sys.modules.get("src.routers.dispatch")
    if module is not None and hasattr(module, "_require_challan_document"):
        monkeypatch.setattr(module, "_require_challan_document", lambda **kwargs: kwargs["snapshot"])


# Masters › Reason codes stand-in (owner decision 4, 1 Nov 2026), as in inventory-service's conftest:
# ``src/reasons.py`` posts to ``/master/reason-codes/validate``; no master runs under pytest, so that call
# answers here — any code is active with its code in words as label ("JC-MATERIAL-SHORT" -> "Jc material
# short"), a code starting with BAD is refused like an unknown code. Only the helper's own ``httpx`` is
# swapped, so tests that stub ``httpx.post`` for sales / inventory calls keep working. Tests that need
# something else patch ``resolve_reason`` in the router module (or ``reasons.httpx.post``) themselves.
def fake_reason_label(code: str) -> str:
    return code.replace("-", " ").replace("_", " ").capitalize()


class _ReasonMasterHttpx:
    def __getattr__(self, name):
        import httpx
        return getattr(httpx, name)

    @staticmethod
    def post(url, *args, **kwargs):
        import httpx
        if not str(url).endswith("/master/reason-codes/validate"):
            return httpx.post(url, *args, **kwargs)
        body = kwargs.get("json") or {}
        code = str(body.get("reason_code") or "").upper()
        request = httpx.Request("POST", str(url))
        if code.startswith("BAD"):
            return httpx.Response(422, json={"detail": f"{code} is not in the {body.get('category')} list."}, request=request)
        return httpx.Response(200, json={"code": code, "label": fake_reason_label(code), "note": body.get("reason_note"),
                                         "category": body.get("category")}, request=request)


@pytest.fixture(autouse=True)
def _reason_master_offline(monkeypatch):
    from src import reasons
    monkeypatch.setattr(reasons, "httpx", _ReasonMasterHttpx())
