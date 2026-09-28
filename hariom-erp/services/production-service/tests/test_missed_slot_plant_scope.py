import uuid

import pytest

from src.routers import missed_slots, planning


def test_all_plants_read_never_sweeps(monkeypatch):
    calls = []
    monkeypatch.setattr(missed_slots, "sweep_missed_slots", lambda db, plant, **kw: calls.append(plant))
    for scope in (None, "", "ALL", "all", "not-a-plant"):
        planning._sweep_missed_slots_safely(object(), scope)
    assert calls == []
    plant = uuid.uuid4()
    planning._sweep_missed_slots_safely(object(), str(plant))
    assert calls == [plant]


def test_sweep_refuses_to_run_without_a_plant():
    with pytest.raises(ValueError):
        missed_slots.sweep_missed_slots(object(), None)
