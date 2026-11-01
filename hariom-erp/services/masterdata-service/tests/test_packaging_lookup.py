"""Packaging master lookups used by the spec sheet, Packing setup and packing consumption (owner decision 5)."""
from src.routers import packaging


ROWS = [
    {"kind": "BOX", "code": "R-150", "size_label": "400x300x200", "weight_kg": 0.45, "stock_unit": "PCS", "active": True},
    {"kind": "BOX", "code": "R.125", "size_label": "350x300x200", "weight_kg": None, "stock_unit": "PCS", "active": True},
    {"kind": "PLASTIC", "code": "PS-150", "size_label": "1x1 m", "weight_kg": 0.05, "stock_unit": "KG", "active": True},
    {"kind": "FADDA", "code": "FD-3", "size_label": None, "weight_kg": 0.02, "stock_unit": "PCS", "active": True},
]


def test_unit_weights_by_code_are_case_insensitive_and_list_missing(monkeypatch):
    monkeypatch.setattr(packaging, "_packaging_rows", lambda db, scope, inactive: list(ROWS))
    result = packaging.get_packaging_unit_weights(codes="r-150, ps-150,N-225", include_inactive=False, db=None, plant_scope={})
    assert [row["code"] for row in result["items"]] == ["R-150", "PS-150"]
    assert result["by_code"]["R-150"]["weight_kg"] == 0.45
    assert result["by_code"]["PS-150"]["stock_unit"] == "KG"
    assert result["missing"] == ["N-225"]


def test_unit_weights_keep_blank_weight_rows_for_a_warning(monkeypatch):
    monkeypatch.setattr(packaging, "_packaging_rows", lambda db, scope, inactive: list(ROWS))
    result = packaging.get_packaging_unit_weights(codes=None, include_inactive=False, db=None, plant_scope={})
    assert len(result["items"]) == 4 and result["missing"] == []
    assert result["by_code"]["R.125"]["weight_kg"] is None


def test_default_plastic_and_fadda_only_when_exactly_one_active(monkeypatch):
    monkeypatch.setattr(packaging, "_packaging_rows", lambda db, scope, inactive: list(ROWS))
    assert packaging.get_packaging_defaults(db=None, plant_scope={}) == {
        "plastic_sku": "PS-150",
        "fadda_sku": "FD-3",
        "active_counts": {"BOX": 2, "PLASTIC": 1, "FADDA": 1},
    }
    two_plastics = ROWS + [{**ROWS[2], "code": "PS-200"}]
    monkeypatch.setattr(packaging, "_packaging_rows", lambda db, scope, inactive: two_plastics)
    defaults = packaging.get_packaging_defaults(db=None, plant_scope={})
    assert defaults["plastic_sku"] is None and defaults["fadda_sku"] == "FD-3"
