"""Who can be named on a continuous entry: any active employee runs a machine; a supervisor or manager closes a stage."""
import uuid

import pytest
from fastapi import HTTPException

from src.routers import entries as api


def _employee(monkeypatch, row):
    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return row

    monkeypatch.setattr(api.httpx, "get", lambda *args, **kwargs: Response())


@pytest.mark.parametrize("role", ["Operator", "Helper", "Packer", "Supervisor", None])
def test_any_active_employee_can_be_the_operator(monkeypatch, role):
    _employee(monkeypatch, {"name": "Ramesh", "employee_code": "E7", "role": role, "active": True})
    assert api.employee(uuid.uuid4(), {"token": "t"}, "PLANT_A", "operator")["name"] == "Ramesh"


def test_inactive_employee_is_refused(monkeypatch):
    _employee(monkeypatch, {"name": "Left", "role": "Operator", "active": False})
    with pytest.raises(HTTPException) as err:
        api.employee(uuid.uuid4(), {"token": "t"}, "PLANT_A", "operator")
    assert err.value.status_code == 422


@pytest.mark.parametrize("role,allowed", [("Supervisor", True), ("Manager", True), ("manager ", True), ("Operator", False), (None, False)])
def test_stage_close_needs_a_supervisor_or_manager(monkeypatch, role, allowed):
    _employee(monkeypatch, {"name": "Suresh", "role": role, "active": True})
    if allowed:
        assert api.employee(uuid.uuid4(), {"token": "t"}, "PLANT_A", "supervisor")["name"] == "Suresh"
    else:
        with pytest.raises(HTTPException) as err:
            api.employee(uuid.uuid4(), {"token": "t"}, "PLANT_A", "supervisor")
        assert err.value.status_code == 422 and "Supervisor or Manager" in err.value.detail


def test_missing_employee_is_required():
    with pytest.raises(HTTPException) as err:
        api.employee(None, {"token": "t"}, "PLANT_A", "operator")
    assert err.value.status_code == 422
