"""Month theory follows the order: a card ordered without parchment expects no parchment."""
from types import SimpleNamespace

from src.routers.planning import _build_provisional_material_rows_for_job_card


def _card(line_required):
    bom = {"raw_materials": {
        "papers": [],
        "adhesives": {"components": [{"name": "Vinsol", "item_code": "20100", "weight_kg": 0.06}]},
        "parchment": {"color": None, "weight_kg": 0.02, "addition_percent": 1.5},
    }}
    snapshot = {} if line_required is None else {"sales_order_line_parchment_required": line_required}
    return SimpleNamespace(
        material_plan_snapshot={"bom_snapshot": bom, "planned_output_qty": 100, "target_bamboo_count": 10},
        spec_snapshot=snapshot, planned_qty=100, packing_record=SimpleNamespace(total_packed_qty=100), stages=[],
    )


def codes(card):
    return {row["item_code"] for row in _build_provisional_material_rows_for_job_card(job_card=card, paper_catalog={}, inventory_items=[])}


def test_parchment_theory_only_when_order_wants_parchment():
    assert "PARCHMENT" not in codes(_card(False))
    assert "PARCHMENT" in codes(_card(True))
    # Older cards without the order flag keep the recipe's parchment.
    assert "PARCHMENT" in codes(_card(None))
    # Paper and adhesive theory are unchanged.
    assert codes(_card(False)) == codes(_card(True)) - {"PARCHMENT"}
