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
