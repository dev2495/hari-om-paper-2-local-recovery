"""A typed number on the issue desks (client 2026-10-30): case, spaces and separators never matter; a GRN can
mean several lots; a part of a number needs 3 letters / digits. Pure rules, no database."""
from src.services.lot_finder import PART, SAME_CHARS, SAME_GRN, SAME_TEXT, compact, match_level, spaced, typed_number


def test_spaced_and_compact_forms():
    assert spaced(" in/26/028 - b002 ") == "IN/26/028-B002"
    assert compact("in 26 028 b002") == compact("IN/26/028-B002") == "IN26028B002"
    assert compact(None) == "" and spaced("") == ""


def test_levels_best_first():
    keys = [("LOT_NO", "IN/26/028-B002"), ("GRN", "IN/26/028")]
    assert match_level("in/26/028-b002", keys)[:2] == (SAME_TEXT, "LOT_NO")
    assert match_level("IN 26 028 B002", keys)[:2] == (SAME_CHARS, "LOT_NO")
    assert match_level("in/26/028", keys)[:2] == (SAME_GRN, "GRN")
    assert match_level("028-b00", keys)[:2] == (PART, "LOT_NO")
    assert match_level("b0", keys) is None          # too short to be a part
    assert match_level("IN/26/029", keys) is None
    assert match_level("   ", keys) is None
    # A blank or missing number never matches anything.
    assert match_level("AT-1", [("AT_NO", None), ("VENDOR_REEL", "  ")]) is None


def test_the_number_inside_a_pasted_label_or_link():
    assert typed_number("HARIOM|BATCH|plant-a|8c47f19d-fc3a-442d-87d5-2f184562498a|IN/26/028-B002") == "IN/26/028-B002"
    assert typed_number("https://erp.example/scan?c=HARIOM%7CREEL%7Cp%7Cx%7CAT-261028-025") == "AT-261028-025"
    assert typed_number("  ck3ui-1 ") == "ck3ui-1"
