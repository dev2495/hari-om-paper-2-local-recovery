from fastapi import HTTPException

from src.dependencies import require_capability


def _user(role, permissions=None):
    return {"roles": [role], "permissions": permissions or []}


def test_qc_is_denied_owner_pack_without_analytics_view():
    gate = require_capability("analytics:view")
    try:
        gate(_user("QC", ["qc:inspect", "reports:view"]))
        raise AssertionError("expected HTTPException")
    except HTTPException as exc:
        assert exc.status_code == 403


def test_qc_is_denied_sales_report_without_sales_capability():
    gate = require_capability("so:create", "so:approve")
    try:
        gate(_user("QC", ["qc:inspect", "reports:view"]))
        raise AssertionError("expected HTTPException")
    except HTTPException as exc:
        assert exc.status_code == 403


def test_owner_still_reaches_owner_pack():
    gate = require_capability("analytics:view")
    assert gate(_user("Owner"))["roles"] == ["Owner"]


def test_plants_are_isolated_for_non_owners():
    """Owner decision 3 Nov 2026: a non-owner reads only the plants assigned to them."""
    import pytest
    from fastapi import HTTPException
    from src.dependencies import get_plant_scope

    a, b, c = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", "33333333-3333-3333-3333-333333333333"
    planner = {"is_owner": False, "plant_id": a, "allowed_plants": [a, b]}
    assert get_plant_scope(planner, b, None, None)["selected_plant_id"] == b
    for wanted in (c, "ALL"):
        with pytest.raises(HTTPException) as error:
            get_plant_scope(planner, wanted, None, None)
        assert error.value.status_code == 403
    owner = {"is_owner": True, "plant_id": a, "allowed_plants": [a, b]}
    assert get_plant_scope(owner, "ALL", None, None)["scope_all"] is True
