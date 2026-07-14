from collections import defaultdict

import pytest

from src.routes.inventory import _authoritative_tool_inward_body, _validate_tool_issue_job_card
from src.routes.production import router as production_router
from src.routes.spec import router as spec_router


def _route_keys(router):
    keys = []
    for route in router.routes:
        methods = getattr(route, "methods", None) or set()
        for method in methods:
            if method in {"HEAD", "OPTIONS"}:
                continue
            keys.append((method, route.path))
    return keys


def _duplicates(router):
    grouped = defaultdict(int)
    for key in _route_keys(router):
        grouped[key] += 1
    return {key: count for key, count in grouped.items() if count > 1}


def test_spec_bff_routes_do_not_register_duplicate_method_paths():
    assert _duplicates(spec_router) == {}


def test_production_bff_routes_do_not_register_duplicate_method_paths():
    assert _duplicates(production_router) == {}


def test_tool_inward_uses_active_master_definition_as_authority():
    incoming = {
        "tool_definition_id": "stale-id",
        "category": "DIE",
        "definition_name": "Browser supplied name",
        "attribute_snapshot": {"code": "legacy"},
        "quantity": 2,
    }
    master = {
        "id": "master-id",
        "category": "BLADE",
        "name": "Plain Blade - 0.9 mm - L 140/130/20",
        "attribute_values": {"type": "Plain", "thickness": "0.9 mm", "length": "140/130/20"},
        "status": "ACTIVE",
        "active": True,
    }

    body = _authoritative_tool_inward_body(incoming, master)

    assert body["tool_definition_id"] == "master-id"
    assert body["category"] == "BLADE"
    assert body["definition_name"] == master["name"]
    assert body["attribute_snapshot"] == master["attribute_values"]
    assert body["quantity"] == 2
    assert incoming["category"] == "DIE"


def test_tool_inward_rejects_discontinued_master():
    with pytest.raises(Exception) as caught:
        _authoritative_tool_inward_body(
            {"tool_definition_id": "master-id"},
            {"id": "master-id", "status": "DISCONTINUED", "active": True},
        )
    assert caught.value.status_code == 409


def test_tool_issue_stage_must_exist_on_selected_job_card():
    card = {"id": "job-1", "stages": [{"stage_type": "WINDER"}, {"stage_type": "PROCESS"}]}
    _validate_tool_issue_job_card(card, "PROCESS")
    with pytest.raises(Exception) as caught:
        _validate_tool_issue_job_card(card, "PACKING")
    assert caught.value.status_code == 409
