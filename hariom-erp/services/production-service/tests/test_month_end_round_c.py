"""Month-end fixes after the first build's last check (part C, 30 Oct 2026): plain step words, the
minimum gap in each item's own unit, and a plain answer when the store refuses a plant."""
from datetime import date

import httpx
import pytest
from fastapi import HTTPException

from src.routers import reconciliation as reco


def test_a_month_with_no_count_says_which_count_has_not_started():
    step = reco._count_step(date(2026, 4, 1), False, True, None)
    assert step["detail"] == "The April month-end count has not started yet."
    assert step["action_label"] == "Count April stock"


@pytest.mark.parametrize(
    "material_type, units, hint",
    [
        ("ADHESIVE", ["kg", "litre"], "each item's own unit"),  # never "kg" for a litre item
        ("ADHESIVE", ["litre"], "litre"),
        ("ADHESIVE", [], "kg"),
        ("RAW_PAPER", ["kg"], "kg"),
        ("PACKAGING", ["pcs"], "pcs"),
        ("PACKAGING", [], "each item's own unit"),
    ],
)
def test_the_minimum_gap_unit_follows_the_items_in_use(material_type, units, hint):
    assert reco._limit_unit_hint(material_type, units) == hint


class _Answer:
    def __init__(self, status_code):
        self.status_code = status_code

    def json(self):
        return {"detail": "Cross-plant access is not permitted"}


class _Client:
    status_code = 200

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, *args, **kwargs):
        return _Answer(type(self).status_code)


@pytest.mark.parametrize("status_code, expected", [(403, 403), (500, 503)])
def test_a_refused_plant_is_not_called_a_passing_outage(monkeypatch, status_code, expected):
    _Client.status_code = status_code
    monkeypatch.setattr(httpx, "Client", _Client)
    with pytest.raises(HTTPException) as refused:
        reco._fetch_month_figures("t", "plant-e", date(2026, 3, 1))
    assert refused.value.status_code == expected
    if expected == 403:
        assert "minute" not in refused.value.detail and "plant" in refused.value.detail


def test_the_header_never_waits_on_the_store_probe(monkeypatch):
    """After a restart the chip's first read starts the probe in the background and answers at once with
    "not known"; once the probe has answered, the chip reads the store-only months."""
    import threading
    import uuid as _uuid

    plant = _uuid.uuid4()
    current = date(2026, 11, 1)
    started = threading.Event()
    release = threading.Event()

    def slow_probe(db, plant_id, token, month):
        started.set()
        release.wait(5)
        reco._store_activity_hint[str(plant_id)] = {date(2026, 8, 1)}
        reco._store_hint_meta[str(plant_id)] = (month, True, 0.0)

    class _Session:
        def close(self):
            pass

    import src.database as database
    monkeypatch.setattr(database, "SessionLocal", lambda: _Session())
    monkeypatch.setattr(reco, "_probe_store_hint", slow_probe)
    monkeypatch.setattr(reco, "_STORE_HINT_IN_BACKGROUND", True)
    reco._store_hint_meta.pop(str(plant), None)
    reco._store_activity_hint.pop(str(plant), None)

    assert reco._store_months_for_header(None, plant, "t", current) is None
    assert started.wait(2)
    assert reco._store_months_for_header(None, plant, "t", current) is None  # still warming: no second probe
    release.set()
    for _ in range(50):
        if str(plant) not in reco._store_hint_warming:
            break
        threading.Event().wait(0.02)
    assert reco._store_months_for_header(None, plant, "t", current) == {date(2026, 8, 1)}
