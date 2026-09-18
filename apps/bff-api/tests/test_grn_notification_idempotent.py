"""QCT-025/026: GRN replay must not duplicate the purchase notification."""
import asyncio
import json

from starlette.responses import Response

from src.services import workspace


def test_qct025_idempotent_grn_replay_does_not_emit_second_notification(monkeypatch):
    emitted = []

    async def fake_emit(**kwargs):
        emitted.append(kwargs)

    monkeypatch.setattr(workspace, "emit_notification_event", fake_emit)

    def _response(payload: dict) -> Response:
        body = json.dumps(payload).encode("utf-8")
        return Response(content=body, media_type="application/json", status_code=200)

    async def _run():
        await workspace.emit_from_response(
            _response({"id": "grn-1", "grn_no": "GRN-1", "idempotent": False}),
            token="t",
            event_type="PURCHASE_GRN_POSTED",
            title="GRN posted",
            message="posted",
        )
        await workspace.emit_from_response(
            _response({"id": "grn-1", "grn_no": "GRN-1", "idempotent": True}),
            token="t",
            event_type="PURCHASE_GRN_POSTED",
            title="GRN posted",
            message="posted",
        )

    asyncio.run(_run())
    assert len(emitted) == 1
