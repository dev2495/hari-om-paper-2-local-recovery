"""Band types from the client's QC sheet (2026-10-18): at least / at most the line's master value."""
from types import SimpleNamespace

from src.quality_standards import CLIENT_PAPER_RULES, _RULE_WORDS, band_from_row


def row(mode, **kw):
    return SimpleNamespace(mode=mode, min_value=kw.get("min"), max_value=kw.get("max"), tolerance_value=kw.get("tol"))


def test_at_least_and_at_most_follow_the_master_value():
    assert band_from_row(row("AT_LEAST", tol=0), 350.0) == (350.0, None)
    assert band_from_row(row("AT_LEAST", tol=5), 350.0) == (345.0, None)
    assert band_from_row(row("AT_MOST", tol=None), 9.0) == (None, 9.0)
    assert band_from_row(row("AT_LEAST", tol=0), None) is None  # no master value: the band above applies


def test_plus_minus_and_range_are_unchanged():
    assert band_from_row(row("PLUS_MINUS", tol=0.025), 0.525) == (0.5, 0.55)
    assert band_from_row(row("RANGE", min=6, max=9), None) == (6.0, 9.0)


def test_client_rules_and_rule_text_detection():
    assert CLIENT_PAPER_RULES["gsm"]["mode"] == "AT_LEAST" and CLIENT_PAPER_RULES["moisture_pct"]["min_value"] == 6.0
    assert _RULE_WORDS.search("IF_GREATER_THAN_REQUIRED_PASS") and _RULE_WORDS.search("+/-_0.025_MM_FROM_THE_REFERANCE_GSM_VALUE")
    assert not _RULE_WORDS.search("NOT_OK") and not _RULE_WORDS.search("OK")
