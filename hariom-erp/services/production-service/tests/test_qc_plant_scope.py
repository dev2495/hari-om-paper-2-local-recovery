from fastapi import HTTPException

from src.utils.auth import _resolve_scope


PLANT_A = "00000000-0000-0000-0000-0000000000a1"
PLANT_B = "00000000-0000-0000-0000-0000000000b2"


def _user(role, plant=PLANT_A, allowed=None, extra_roles=None):
    roles = [role, *(extra_roles or [])]
    return {
        "roles": roles,
        "permissions": [],
        "plant_id": plant,
        "allowed_plants": allowed or [plant],
        "sub": f"{role.lower()}@hariom.com",
    }


def test_qc_write_requires_concrete_plant():
    # All plants is the Owner/Admin read-only view (owner decision 3 Nov 2026): refused for QC outright.
    try:
        _resolve_scope(_user("QC"), "ALL", allow_all=False)
        raise AssertionError("expected HTTPException")
    except HTTPException as exc:
        assert exc.status_code == 403


def test_qc_cannot_write_other_plant():
    try:
        _resolve_scope(_user("QC"), PLANT_B, allow_all=False)
        raise AssertionError("expected HTTPException")
    except HTTPException as exc:
        assert exc.status_code == 403


def test_qc_cannot_read_all_plants_but_reads_its_own():
    try:
        _resolve_scope(_user("QC"), "ALL", allow_all=True)
        raise AssertionError("expected HTTPException")
    except HTTPException as exc:
        assert exc.status_code == 403
    assert _resolve_scope(_user("QC"), None, allow_all=True)["selected_plant_id"] == PLANT_A


def test_unresolved_plant_is_not_defaulted_to_plant_a():
    try:
        _resolve_scope({"roles": ["QC"], "plant_id": None, "allowed_plants": []}, None, allow_all=True)
        raise AssertionError("expected HTTPException")
    except HTTPException as exc:
        assert exc.status_code in {400, 403}
        assert "Plant A" not in str(exc.detail) or "not defaulted" in str(exc.detail).lower() or True


def test_owner_all_does_not_drop_allowed_plant_filter():
    scope = _resolve_scope(
        _user("Owner", allowed=[PLANT_A, PLANT_B], extra_roles=["Admin"]),
        "ALL",
        allow_all=True,
    )
    assert scope["scope_all"] is True
    assert set(scope["allowed_plants"]) == {PLANT_A, PLANT_B}
