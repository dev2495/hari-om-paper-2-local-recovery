"""The Process count says the numbers (client 2026-10-26); since 2026-10-28 it is a flag, never a refusal."""
from types import SimpleNamespace as NS

from src.routers.entries import process_balance_message


def run(**values):
    return NS(**{"input_quantity": 9, "carry_in_pcs": 0, "produced": 90, "cutting_loss_pcs": 0, "carry_out_pcs": 0, **values})


def test_short_output_names_the_missing_pieces():
    text = process_balance_message(run(), 12, 108, 90)
    assert text.startswith("9 bamboo × 12 pcs = 108 pcs, but this run counts 90 pcs (90 made + 0 cutting loss + 0 held).")
    assert "18 pcs short." in text and "Saved and flagged" in text


def test_too_many_pieces_points_to_the_bamboo_count():
    text = process_balance_message(run(carry_in_pcs=7, produced=120), 12, 115, 120)
    assert text.startswith("9 bamboo × 12 pcs + 7 held = 115 pcs")
    assert "5 pcs more than the bamboo can give." in text and "nothing has to be written" in text


def test_client_case_4167_bamboo_counts_50000():
    text = process_balance_message(run(input_quantity=4167, produced=50000), 12, 50004, 50000)
    assert text.startswith("4167 bamboo × 12 pcs = 50004 pcs, but this run counts 50000 pcs (50000 made + 0 cutting loss + 0 held). 4 pcs short.")
