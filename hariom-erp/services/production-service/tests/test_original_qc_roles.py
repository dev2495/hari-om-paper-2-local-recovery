"""Original QC-01 role gate: planner and sales cannot record QC evidence."""
from fastapi import HTTPException

from src.utils.auth import require_role

QC_EVIDENCE_ROLES = ["Admin", "PlantManager", "QC", "SupervisorEntry", "Production"]


def _check(roles):
    return require_role(QC_EVIDENCE_ROLES)(current_user={"roles": list(roles), "sub": ",".join(roles)})


def test_qc01_qc_role_can_record_evidence_planner_and_sales_cannot():
    assert _check(["QC"])["roles"] == ["QC"]
    for role in ("Planner", "Sales"):
        try:
            _check([role])
            raise AssertionError(f"{role} must not record QC evidence")
        except HTTPException as exc:
            assert exc.status_code == 403


def test_qc01_owner_admin_bypass_is_not_a_planner_sales_path():
    assert _check(["Owner"])["roles"] == ["Owner"]
    assert _check(["Admin"])["roles"] == ["Admin"]
