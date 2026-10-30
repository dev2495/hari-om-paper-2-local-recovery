"""Month-end close maths (spec 2.1 / 2.2, client 2026-10-28): the store identity, expected use with the
normal wastage, floor / store / total gap, the allowed gap, statuses, units and IST dating."""
from datetime import date, datetime

import pytest

from src.services.consumption import (
    financial_year_label,
    financial_year_start,
    floor_split_by_unit,
    ist_day,
    month_end_item_row,
    month_end_unit_totals,
    normalize_uom,
    parse_financial_year,
    store_identity_ok,
    unit_label,
    with_floor_split,
    year_floor_split,
)
from src.services.usage_limits import DEFAULT_USAGE_LIMITS

PAPER = {**DEFAULT_USAGE_LIMITS["RAW_PAPER"]}
ADHESIVE = {**DEFAULT_USAGE_LIMITS["ADHESIVE"]}
PACKING = {**DEFAULT_USAGE_LIMITS["PACKAGING"]}

# Opening 100 + received 50 (10 of it an opening load) − sent back 5 − issued 120 + corrections −3 = 22.
PAPER_FIGURES = {"opening": 100, "received": 50, "opening_loads": 10, "sent_back": 5, "issued": 120, "corrections": -3,
                 "count_variance": -3, "closing": 22}


def test_identity_and_actual_used_hold_to_three_decimals():
    assert store_identity_ok(PAPER_FIGURES)
    assert not store_identity_ok({**PAPER_FIGURES, "closing": 22.002})
    row = month_end_item_row(figures=PAPER_FIGURES, spec_qty=100, limits=PAPER, actual_known=True)
    # Actual used = opening + received − sent back − closing = issued − corrections.
    assert row["actual_used"] == 123.0 == PAPER_FIGURES["issued"] - PAPER_FIGURES["corrections"]
    assert row["identity_ok"] is True


def test_expected_gaps_and_allowed_gap_for_paper():
    row = month_end_item_row(figures=PAPER_FIGURES, spec_qty=100, limits=PAPER, actual_known=True)
    assert row["expected"] == 107.0 and row["wastage_allowance"] == 7.0
    assert row["floor_gap"] == 13.0                  # issued 120 − expected 107
    assert row["store_gap"] == 3.0                   # actual 123 − issued 120 = −corrections
    assert row["total_gap"] == 16.0 == row["floor_gap"] + row["store_gap"]
    assert row["allowed_gap"] == 7.49                # max(7% × 107, 5 kg)
    assert row["status"] == "OVER" and row["has_use"] is True


@pytest.mark.parametrize("issued,corrections,status", [(99.0, 0.0, "UNDER"), (99.6, 0.0, "OK"), (110.0, 0.0, "OK"), (107.0, -7.49, "OK"), (107.0, -7.5, "OVER")])
def test_status_bands(issued, corrections, status):
    closing = 200 - issued + corrections
    figures = {"opening": 200, "received": 0, "sent_back": 0, "issued": issued, "corrections": corrections, "closing": closing}
    assert month_end_item_row(figures=figures, spec_qty=100, limits=PAPER, actual_known=True)["status"] == status


def test_minimum_gap_stops_tiny_quantities_flagging():
    figures = {"opening": 5, "received": 0, "sent_back": 0, "issued": 2.4, "corrections": 0, "closing": 2.6}
    row = month_end_item_row(figures=figures, spec_qty=2, limits=ADHESIVE, actual_known=True)
    assert row["expected"] == 2.0 and row["allowed_gap"] == 0.5   # 7% of 2 kg is 0.14, the minimum 0.5 kg wins
    assert row["total_gap"] == 0.4 and row["status"] == "OK"


def test_not_known_until_the_count_but_floor_gap_so_far_is_shown():
    row = month_end_item_row(figures=PAPER_FIGURES, spec_qty=100, limits=PAPER, actual_known=False)
    assert row["status"] == "NOT_KNOWN"
    assert row["actual_used"] is None and row["store_gap"] is None and row["total_gap"] is None
    assert row["floor_gap"] == 13.0 and row["floor_status"] == "OVER"
    assert row["book_used"] == 123.0


def test_no_store_figures_means_spec_only():
    row = month_end_item_row(figures=None, spec_qty=10, limits=PAPER, actual_known=True)
    assert row["issued"] == 0 and row["expected"] == 10.7 and row["floor_gap"] == -10.7
    assert row["actual_used"] == 0 and row["status"] == "UNDER"


def test_units_are_never_mixed_in_totals():
    kraft = {**month_end_item_row(figures=PAPER_FIGURES, spec_qty=100, limits=PAPER, actual_known=True), "uom": "KG"}
    box_figures = {"opening": 500, "received": 0, "sent_back": 0, "issued": 40, "corrections": 0, "closing": 460}
    box = {**month_end_item_row(figures=box_figures, spec_qty=40, limits=PACKING, actual_known=True), "uom": "Nos"}
    glue = {**month_end_item_row(figures={"opening": 3, "issued": 1, "closing": 2}, spec_qty=1, limits=ADHESIVE, actual_known=True), "uom": "kgs"}
    totals = month_end_unit_totals([kraft, box, glue], actual_known=True)
    assert [unit["uom"] for unit in totals] == ["KG", "PCS"]
    kg, pcs = totals
    assert kg["issued"] == 121.0 and kg["items"] == 2 and kg["unit_label"] == "kg"
    assert pcs["issued"] == 40.0 and pcs["spec"] == 40.0 and pcs["unit_label"] == "pcs"
    assert kg["status_counts"]["OVER"] == 1
    running = month_end_unit_totals([kraft], actual_known=False)
    assert running[0]["actual_used"] is None and running[0]["total_gap"] is None


def test_unit_words():
    assert (normalize_uom(None), normalize_uom("kgs"), normalize_uom("NOS"), normalize_uom("Litre")) == ("KG", "KG", "PCS", "L")
    assert (unit_label("KG"), unit_label("PCS"), unit_label("L")) == ("kg", "pcs", "litre")


def test_ist_day_of_naive_utc_timestamps():
    # 31 Oct 19:00 UTC is 1 Nov 00:30 IST: a Process close then belongs to November.
    assert ist_day(datetime(2026, 10, 31, 19, 0)) == date(2026, 11, 1)
    assert ist_day(datetime(2026, 10, 31, 18, 29)) == date(2026, 10, 31)
    assert ist_day(date(2026, 10, 31)) == date(2026, 10, 31)


def test_financial_year_runs_april_to_march():
    assert financial_year_label(date(2027, 3, 1)) == "2026-27" == financial_year_label(date(2026, 4, 1))
    assert financial_year_start(date(2027, 1, 1)) == date(2026, 4, 1)
    assert parse_financial_year("2026-27") == date(2026, 4, 1)
    with pytest.raises(ValueError):
        parse_financial_year("2026-28")


def test_unit_floor_split_never_nets_out_items_over_and_under():
    over = month_end_item_row(figures={"issued": 200, "closing": 0}, spec_qty=0, limits=PACKING, actual_known=False)
    under = month_end_item_row(figures={"issued": 2400, "closing": 0}, spec_qty=2600, limits=PACKING, actual_known=False)
    inside = month_end_item_row(figures={"issued": 105, "closing": 0}, spec_qty=100, limits=PACKING, actual_known=False)
    for row in (over, under, inside):
        row["uom"] = "PCS"
    (unit,) = month_end_unit_totals([over, under, inside], actual_known=False)
    assert unit["floor_gap"] == 5.0  # the signed total nets the two out
    assert (unit["floor_over_items"], unit["floor_over"], unit["floor_under_items"], unit["floor_under"]) == (1, 200.0, 1, 200.0)
    assert floor_split_by_unit([inside])["PCS"]["floor_over_items"] == 0
    # A snapshot unit without the split gets it from its items.
    (old,) = with_floor_split([{"uom": "PCS", "floor_gap": 5.0}], [over, under])
    assert old["floor_over_items"] == 1 and old["floor_under"] == 200.0


def test_year_floor_split_adds_each_item_over_the_months():
    # Over by 30 in one month and under by 30 in the next: within the limit for the year.
    month_a = [{"item_code": "B", "uom": "PCS", "issued": 130, "expected": 100, "allowed_gap_pct": 7, "min_gap": 10}]
    month_b = [{"item_code": "B", "uom": "PCS", "issued": 70, "expected": 100, "allowed_gap_pct": 7, "min_gap": 10}]
    assert year_floor_split([month_a, month_b])["PCS"]["floor_over_items"] == 0
    split = year_floor_split([month_a, month_a])
    assert split["PCS"]["floor_over_items"] == 1 and split["PCS"]["floor_over"] == 60.0
