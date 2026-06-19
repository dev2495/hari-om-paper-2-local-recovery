from collections import defaultdict

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
