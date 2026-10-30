"""A finished stage tells planners to schedule the next machine, and tells operators only what is ready (30 Oct)."""
import asyncio
import json

from starlette.requests import Request
from starlette.responses import Response

from src.services import handoff_events


def _request():
    return Request({"type": "http", "method": "POST", "path": "/", "headers": [(b"x-plant-id", b"00000000-0000-0000-0000-0000000000a1")]})


def _sent(monkeypatch, body):
    sent = []

    async def fake_emit(token, **kwargs):
        sent.append(kwargs)

    async def fake_card(job_card_id, token, plant_hint):
        return {"job_card_no": "26/10/264", "product_code": "CHK-R5UI", "plant_id": plant_hint}

    monkeypatch.setattr(handoff_events, "_emit", fake_emit)
    monkeypatch.setattr(handoff_events, "job_card_context", fake_card)
    response = Response(content=json.dumps(body).encode(), media_type="application/json", status_code=200)

    async def run():
        handoff_events.notify_stage_output(response, _request(), "t", "card-1")
        await asyncio.gather(*list(handoff_events._background))

    asyncio.run(run())
    return sent


def test_stage_done_schedule_line_is_for_planners_and_floor_gets_a_plain_line(monkeypatch):
    sent = _sent(monkeypatch, {"stage": "OVEN", "stage_status": "COMPLETED", "current_stage": "PROCESS", "job_card_status": "IN_PROGRESS"})
    planner = [row for row in sent if "Planner" in row["recipient_roles"]]
    floor = [row for row in sent if "Operator" in row["recipient_roles"]]
    assert len(planner) == 1 and len(floor) == 1
    assert "Operator" not in planner[0]["recipient_roles"]
    assert "Schedule the next machine" in planner[0]["message"]
    assert floor[0]["recipient_roles"] == ["Operator"]
    assert "Schedule" not in floor[0]["message"] and "schedule" not in floor[0]["message"]
    assert floor[0]["title"] == "26/10/264 is ready for Process"
    assert floor[0]["payload"]["action"] != "schedule"
    assert floor[0]["event_id"] != planner[0]["event_id"]


def test_unfinished_stage_sends_nothing(monkeypatch):
    assert _sent(monkeypatch, {"stage": "OVEN", "stage_status": "IN_PROGRESS", "current_stage": "OVEN"}) == []
