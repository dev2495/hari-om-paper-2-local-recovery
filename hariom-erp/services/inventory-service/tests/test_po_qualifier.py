"""QCT-021 qualifier parser: retain plus, never guess inclusive/exclusive."""
from src.services.po_qualifier import parse_po_qualifier, qualifier_conflicts_item


def test_qct021_pb_plus_retains_raw_and_does_not_guess_inclusive():
    parsed = parse_po_qualifier("PB 18+")
    assert parsed["raw"] == "PB 18+"
    assert parsed["plus_retained"] is True
    assert parsed["value"] == 18
    assert parsed["inclusive_min"] is None
    assert parsed["inclusive_max"] is None
    assert parsed["inclusive_guessed"] is False
    assert parsed["comparator_status"] == "UNCONFIRMED"
    assert parsed["mapping_flagged"] is True
    assert parsed["profile_code"] == "ply_bond"


def test_qct022_weaker_supplier_bound_requires_review_and_does_not_change_item():
    item = {
        "status": "approved",
        "parameters": [{"code": "ply_bond", "min": 20, "max": 40}],
    }
    conflict = qualifier_conflicts_item(parse_po_qualifier("PB 18+"), item)
    assert conflict["code"] == "QUALIFIER_WEAKER_THAN_ITEM"
    assert item["parameters"][0]["min"] == 20


def test_qct022_mismatched_basis_is_review_not_silent_map():
    item = {
        "status": "approved",
        "parameters": [{"code": "gsm", "min": 180, "max": 200}],
    }
    conflict = qualifier_conflicts_item(parse_po_qualifier("COBB 30"), item)
    assert conflict["code"] == "MISMATCHED_BASIS"
