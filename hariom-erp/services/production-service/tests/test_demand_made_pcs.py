"""Good pieces made so far, for the RM inward calendar demand (spec 3, client 2026-10-28)."""
from types import SimpleNamespace

from src.routers.planning import _demand_made_pcs


def card(stages, entry_model="V2", pcs_per_bamboo=10):
    snapshot = {"selected_bamboo_length_mm": 1000, "pcs_per_bamboo": pcs_per_bamboo} if pcs_per_bamboo else {}
    if entry_model:
        snapshot["entry_model"] = entry_model
    return SimpleNamespace(spec_snapshot=snapshot, stages=[SimpleNamespace(stage_type=t, output_qty=q) for t, q in stages])


def test_v2_winder_bamboos_convert_to_pieces_and_the_furthest_good_count_wins():
    assert _demand_made_pcs(card([("SLITTING", 900), ("WINDER", 30), ("OVEN", 20), ("PROCESS", 150)])) == 300
    assert _demand_made_pcs(card([("WINDER", 0), ("PROCESS", 0)])) == 0


def test_cards_without_an_entry_model_still_count_the_winder_in_bamboos():
    # Checker 2026-10-29: 26/10/24 planned 800, wound 80 bamboos x 10 pcs = fully wound, no paper left to need.
    assert _demand_made_pcs(card([("WINDER", 80)], entry_model=None)) == 800
    assert _demand_made_pcs(card([("WINDER", 12), ("OVEN", 12)], entry_model=None, pcs_per_bamboo=13)) == 156


def test_cards_that_do_not_know_pcs_per_bamboo_read_stage_output_as_pieces():
    assert _demand_made_pcs(card([("WINDER", 420), ("PACKING", 400), ("DISPATCH", 999)], entry_model=None, pcs_per_bamboo=None)) == 420


def test_packing_is_done_once_packing_closes_or_process_closes_on_a_route_without_packing():
    # Client 2026-10-30: 26/10/155 had Process closed and Packing auto-closed, yet its boxes stayed in demand until dispatch.
    from src.routers.planning import _demand_packing

    def staged(rows):
        return SimpleNamespace(stages=[SimpleNamespace(stage_type=t, status=s, output_qty=q) for t, s, q in rows])

    assert _demand_packing(staged([("PROCESS", "COMPLETED", 120), ("PACKING", "COMPLETED", 120), ("DISPATCH", "PENDING", 0)])) == {"packing_closed": True, "packed_pcs": 120}
    assert _demand_packing(staged([("PROCESS", "IN_PROGRESS", 60), ("PACKING", "IN_PROGRESS", 40)])) == {"packing_closed": False, "packed_pcs": 40}
    assert _demand_packing(staged([("WINDER", "COMPLETED", 12), ("PROCESS", "COMPLETED", 120)])) == {"packing_closed": True, "packed_pcs": 0}
    assert _demand_packing(staged([("WINDER", "IN_PROGRESS", 3)])) == {"packing_closed": False, "packed_pcs": 0}


def test_winding_material_stops_once_the_winder_closes_even_short():
    # Checker 2026-10-30: 26/10/45 short-closed its Winder at 690 of 1,440 pcs (Oven running) and still
    # asked for 233 kg of paper; 26/10/10 had Process and Packing closed and still needed paper and glue.
    from src.routers.planning import _demand_winding_closed

    def staged(rows):
        return SimpleNamespace(stages=[SimpleNamespace(stage_type=t, status=s, output_qty=q) for t, s, q in rows])

    assert _demand_winding_closed(staged([("WINDER", "COMPLETED", 69), ("OVEN", "RUNNING", 40)])) is True
    assert _demand_winding_closed(staged([("WINDER", "IN_PROGRESS", 69), ("PROCESS", "COMPLETED", 450)])) is True
    assert _demand_winding_closed(staged([("PROCESS", "COMPLETED", 450), ("DISPATCH", "PENDING", 0)])) is True
    assert _demand_winding_closed(staged([("WINDER", "IN_PROGRESS", 30), ("OVEN", "COMPLETED", 30)])) is False
    assert _demand_winding_closed(staged([])) is False
