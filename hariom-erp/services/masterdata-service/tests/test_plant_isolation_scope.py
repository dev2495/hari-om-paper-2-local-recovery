"""Plants are isolated (owner decision 3 Nov 2026): a user works only in the plants assigned to them; All
plants is the Owner/Admin read-only view; a write always needs one concrete plant."""
import pytest
from fastapi import HTTPException

from src.utils.auth import _resolve_scope

A, B, C = "PLANT_A", "PLANT_B", "PLANT_C"


def user(*roles, plant=A, allowed=None):
    return {"roles": list(roles), "plant_id": plant, "allowed_plants": allowed if allowed is not None else [plant]}


def refused(code, *args, **kwargs):
    with pytest.raises(HTTPException) as error:
        _resolve_scope(*args, **kwargs)
    assert error.value.status_code == code


def test_a_user_reaches_every_assigned_plant_and_no_other():
    planner = user("Planner", plant=A, allowed=[A, B])
    assert _resolve_scope(planner, B, allow_all=False)["selected_plant_id"] == B
    assert _resolve_scope(planner, None, allow_all=False)["selected_plant_id"] == A
    refused(403, planner, C, allow_all=False)
    refused(403, user("Store"), B, allow_all=True)


def test_all_plants_is_owner_admin_read_only():
    refused(403, user("Sales"), "ALL", allow_all=True)
    owner = user("Owner", allowed=[A, B])
    assert _resolve_scope(owner, "ALL", allow_all=True)["scope_all"] is True
    refused(400, owner, "ALL", allow_all=False)
    assert _resolve_scope(owner, B, allow_all=False)["selected_plant_id"] == B
