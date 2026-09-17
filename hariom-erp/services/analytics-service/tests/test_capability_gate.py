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
