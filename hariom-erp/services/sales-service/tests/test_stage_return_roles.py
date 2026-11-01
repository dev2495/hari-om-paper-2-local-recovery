"""Stage-return endpoints (verification issue #1, 1 Nov 2026): create is only for production's service identity
(ProductionEffects) or an Owner/Admin; reverse keeps working with the Owner/Admin token production's reopen sends."""
import pytest
from fastapi import HTTPException

from src.routers import release_returns as rr


def _checker_for(path: str):
    route = next(r for r in rr.router.routes if r.path == path and "POST" in r.methods)
    for dep in route.dependant.dependencies:
        if dep.name == "current_user":
            return dep.call
    raise AssertionError(f"no role check on {path}")


CREATE = "/sales-orders/release-lots/{release_lot_id}/stage-returns"
REVERSE = "/sales-orders/release-lots/{release_lot_id}/stage-returns/reverse"


@pytest.mark.parametrize("path", [CREATE, REVERSE])
@pytest.mark.parametrize("roles", [["Planner"], ["PlantManager"], ["Sales"], ["Planner", "PlantManager"]])
def test_floor_and_sales_tokens_cannot_call_stage_returns_directly(path, roles):
    with pytest.raises(HTTPException) as err:
        _checker_for(path)(current_user={"sub": "u", "roles": roles})
    assert err.value.status_code == 403


@pytest.mark.parametrize("path", [CREATE, REVERSE])
@pytest.mark.parametrize("roles", [["ProductionEffects"], ["Owner"], ["Admin"]])
def test_production_service_and_owner_admin_still_pass(path, roles):
    user = {"sub": "u", "roles": roles}
    assert _checker_for(path)(current_user=user) is user
