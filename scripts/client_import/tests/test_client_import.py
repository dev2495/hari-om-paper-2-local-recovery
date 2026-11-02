"""Pure-logic tests for the 2 Nov 2026 client imports (no database, no running app)."""
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import common  # noqa: E402

spec = importlib.util.spec_from_file_location("import_sales_orders", HERE / "import_sales_orders.py")
orders = importlib.util.module_from_spec(spec)
spec.loader.exec_module(orders)


def test_box_codes_are_normalised_like_the_masters():
    assert common.box_code("R.125") == "R-125"
    assert common.box_code("HBD 3 PLY") == "HBD-3 PLY"
    assert common.box_code("N.225") == "N-225"
    assert common.box_code("JP-93.75") == "JP-93.75"
    assert common.box_code("PLASTIC BUNDLE") == "PLASTIC BUNDLE"


def test_customer_resolver_uses_names_then_aliases_and_never_guesses(tmp_path):
    aliases = tmp_path / "aliases.json"
    aliases.write_text(json.dumps({"aliases": [
        {"source": "Reliance Industries Ltd. [Patalganga]", "customer": "Relience (Patal Ganga )", "why": "owner"},
        {"source": "Dodhia Industries Limited", "customer": "Dodhia Synthetics Ltd", "why": "items", "confirm": True},
    ]}))
    customers = [{"id": "1", "name": "Garden Silk Mills Ltd.", "active": True}, {"id": "2", "name": "Relience (Patal Ganga )", "active": True},
                 {"id": "3", "name": "Dodhia Synthetics Ltd", "active": True}, {"id": "4", "name": "Old Co", "active": False}]
    resolver = common.CustomerResolver(customers, aliases)
    assert resolver.resolve("Garden Silk Mills Pvt. Ltd.")[0]["id"] == "1"
    assert resolver.resolve("Reliance Industries Ltd. [Patalganga]") == (customers[1], "alias")
    assert resolver.resolve("Dodhia Industries Limited")[1].startswith("alias (confirm")
    assert resolver.resolve("Old Co")[0] is None
    assert resolver.resolve("Gujarat Polyfilms Private Limited")[0] is None
    strict = common.CustomerResolver(customers, aliases, use_confirm_aliases=False)
    assert strict.resolve("Dodhia Industries Limited")[0] is None


def _spec(spec_id, tube_id, weight, **dynamic):
    return {"id": spec_id, "tube_size_id": tube_id, "target_tube_weight": weight,
            "dynamic_fields": [{"field_key": k, "value": v} for k, v in dynamic.items()]}


TUBES = {
    "t1": {"inner_diameter_mm": 110, "outer_diameter_mm": 124, "length_mm": 150, "description": "[POY 7] · 7mm notch"},
    "t2": {"inner_diameter_mm": 110, "outer_diameter_mm": 124, "length_mm": 150, "description": "[POY 7] · 7mm notch HCS"},
    "t3": {"inner_diameter_mm": 110, "outer_diameter_mm": 122, "length_mm": 149.9, "description": ""},
    "t4": {"inner_diameter_mm": 120, "outer_diameter_mm": 131, "length_mm": 187.5, "description": "[V]"},
    "t5": {"inner_diameter_mm": 120, "outer_diameter_mm": 131, "length_mm": 187.5, "description": ""},
}


def test_hcs_and_v_must_match_the_spec_variant_both_ways():
    specs = [_spec("plain", "t1", 295), _spec("hcs", "t2", 310), _spec("v", "t4", 315), _spec("nov", "t5", 315)]
    assert orders.match_line(orders.parse_item("110x124x150mm [SMD]"), specs, TUBES)[0]["id"] == "plain"
    assert orders.match_line(orders.parse_item("110x124x150mm (HCS) [SMD]"), specs, TUBES)[0]["id"] == "hcs"
    assert orders.match_line(orders.parse_item("120x131x187.50mm [CEL] (V)"), specs, TUBES)[0]["id"] == "v"
    assert orders.match_line(orders.parse_item("120x131x187.50mm [CEL]"), specs, TUBES)[0]["id"] == "nov"
    only_hcs = [_spec("hcs", "t2", 310)]
    assert orders.match_line(orders.parse_item("110x124x150mm [SMD]"), only_hcs, TUBES)[0] is None


def test_weight_mark_picks_one_of_two_specs_and_sizes_must_be_exact():
    specs = [_spec("w245", "t3", 245), _spec("w250", "t3", 250)]
    assert orders.match_line(orders.parse_item("110x122x149.9mm [Alok] 245gsm"), specs, TUBES)[0]["id"] == "w245"
    spec, why, candidates = orders.match_line(orders.parse_item("110x122x149.9mm [Alok]"), specs, TUBES)
    assert spec is None and len(candidates) == 2
    spec, why, _ = orders.match_line(orders.parse_item("110x122x150mm [Alok]"), specs, TUBES)
    assert spec is None and "close sizes" in why


def test_reset_classification_has_no_table_in_both_lists_and_keeps_specs():
    path = HERE.parents[0] / "season" / "reset_testing_data.py"
    reset_spec = importlib.util.spec_from_file_location("reset_testing_data", path)
    reset = importlib.util.module_from_spec(reset_spec)
    reset_spec.loader.exec_module(reset)
    assert {"specification_sheet", "recipe_header", "spec_packing_amendments", "spec_season_recipe_bindings"} <= reset.KEEP["specdb"]
    assert {"fg_boxes", "monthly_close_events"} <= reset.CLEAR["productiondb"]
    assert "sales_order_release_lot_returns" in reset.CLEAR["salesdb"]
    assert "reel_serial_settings" in reset.KEEP["inventorydb"] and "reason_seed_log" in reset.KEEP["masterdb"]
    for name in reset.KEEP:
        assert not ((reset.KEEP[name] or set()) & reset.CLEAR[name])
