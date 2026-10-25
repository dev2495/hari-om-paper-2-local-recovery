"""Adhesive theory posts to the adhesive's own stock item, so issue, theory and stock count meet
(client 2026-10-25: "reconcile with issue n stock count")."""
from types import SimpleNamespace

from src.routers.planning import _build_provisional_material_rows_for_job_card


def card(components):
    bom = {"raw_materials": {"papers": [], "adhesives": {"components": components}, "parchment": {}}}
    return SimpleNamespace(
        material_plan_snapshot={"bom_snapshot": bom, "planned_output_qty": 100, "target_bamboo_count": 10},
        spec_snapshot={}, planned_qty=100, packing_record=SimpleNamespace(total_packed_qty=100), stages=[],
    )


ITEMS = [{"item_code": "TL4-21100", "name": "TL4 LV 21100 top adhesive", "type": "ADHESIVE"},
         {"item_code": "VINSOL-20100", "name": "Vinsol 20100", "type": "ADHESIVE"}]


def rows(components, catalog=None):
    return {row["item_code"]: row for row in _build_provisional_material_rows_for_job_card(job_card=card(components), paper_catalog={}, inventory_items=ITEMS, adhesive_catalog=catalog or {})}


def test_component_master_maps_to_the_adhesive_stock_item():
    out = rows([{"name": "TL4 LV/21100 (TOP ADHEIVE)", "adhesive_id": "a1", "weight_kg": 0.007},
                {"name": "VINSOL/20100 (SYNTHETIC)", "adhesive_id": "a2", "weight_kg": 0.033}],
               {"a1": {"internal_code": "tl4-21100"}, "a2": {"internal_code": "VINSOL-20100"}})
    assert set(out) == {"TL4-21100", "VINSOL-20100"}
    assert out["TL4-21100"]["item_name"] == "TL4 LV 21100 top adhesive"
    assert round(out["VINSOL-20100"]["provisional_theory_consumption_kg"], 4) == 0.33


def test_component_item_code_wins_when_it_is_a_stock_item():
    assert set(rows([{"name": "Vinsol", "item_code": "VINSOL-20100", "weight_kg": 0.06}])) == {"VINSOL-20100"}


def test_unknown_component_keeps_the_older_code():
    assert set(rows([{"name": "Vinsol 20100", "weight_kg": 0.06}])) == {"20100"}
