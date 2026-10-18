"""Notifications are never dropped for want of a plant (client round 2026-10-18).

A service response that does not name a plant (e.g. a customer complaint) is delivered in
the plant the request works in. A master-level change marked scope GLOBAL is not pinned to
the caller's plant, so every plant's role holders get it.
"""
import asyncio

from src.services import workspace

PLANT_A = "00000000-0000-0000-0000-0000000000a1"


class _Recorder:
    def __init__(self):
        self.sent = []

    async def post(self, url, headers=None, json=None):
        self.sent.append(json)


def _emit(monkeypatch, payload, plant=PLANT_A):
    recorder = _Recorder()
    monkeypatch.setattr(workspace, "workspace_http_client", recorder)

    async def run():
        marker = workspace.REQUEST_PLANT.set(plant)
        try:
            await workspace.emit_notification_event(token=None, event_type="T", title="t", message="m", recipient_roles=["QC"], payload=payload)
        finally:
            workspace.REQUEST_PLANT.reset(marker)

    asyncio.run(run())
    return recorder.sent[0]


def test_event_without_plant_uses_the_request_plant(monkeypatch):
    sent = _emit(monkeypatch, {"customer_rejection_id": "x"})
    assert sent["plant_id"] == PLANT_A and sent["payload"]["plant_id"] == PLANT_A


def test_plant_named_by_the_event_wins(monkeypatch):
    other = "00000000-0000-0000-0000-0000000000b2"
    sent = _emit(monkeypatch, {"plant_id": other})
    assert sent["plant_id"] == other


def test_global_master_change_is_not_pinned_to_the_callers_plant(monkeypatch):
    sent = _emit(monkeypatch, {"scope": "GLOBAL"})
    assert sent["plant_id"] is None and sent["payload"]["scope"] == "GLOBAL"


def test_all_plants_header_is_not_a_plant(monkeypatch):
    sent = _emit(monkeypatch, {}, plant=None)
    assert sent["plant_id"] is None
