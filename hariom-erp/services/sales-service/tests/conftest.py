"""Test-wide stand-in for Masters › Reason codes (owner decision 4, 1 Nov 2026), as in inventory-service.

``src/reasons.py`` posts to ``/master/reason-codes/validate``. No master runs under pytest, so that call
answers here: any code is active with its code in words as label ("SO-CUSTOMER-CANCELLED" -> "So customer
cancelled"); a code starting with BAD is refused like an unknown code. Only the helper's own ``httpx`` is
swapped, so every other HTTP call (and tests that stub ``httpx.post``) is untouched. Tests that need
something else patch ``resolve_reason`` in the router module (or ``reasons.httpx.post``) themselves.
"""
import httpx
import pytest

from src import reasons


def fake_label(code: str) -> str:
    return code.replace("-", " ").replace("_", " ").capitalize()


class _ReasonMasterHttpx:
    def __getattr__(self, name):
        return getattr(httpx, name)

    @staticmethod
    def post(url, *args, **kwargs):
        if not str(url).endswith("/master/reason-codes/validate"):
            return httpx.post(url, *args, **kwargs)
        body = kwargs.get("json") or {}
        code = str(body.get("reason_code") or "").upper()
        request = httpx.Request("POST", str(url))
        if code.startswith("BAD"):
            return httpx.Response(422, json={"detail": f"{code} is not in the {body.get('category')} list."}, request=request)
        return httpx.Response(200, json={"code": code, "label": fake_label(code), "note": body.get("reason_note"),
                                         "category": body.get("category")}, request=request)


@pytest.fixture(autouse=True)
def fake_reason_master(monkeypatch):
    monkeypatch.setattr(reasons, "httpx", _ReasonMasterHttpx())
    yield
