"""Reasons are master codes only (owner decision 4, 1 Nov 2026): catalogue, seeding plan and choice rules."""
import unittest

from src.reason_catalog import (
    CATEGORIES,
    REASON_CATEGORIES,
    ReasonChoiceError,
    check_reason_choice,
    public_catalog,
    reason_needs_note,
)
from src.reason_seed import plan_seed_rows


def row(code, category, label=None, active=True):
    return {"code": code, "category": category, "label": label or code.title(), "active": active, "severity": "WATCH"}


class CatalogueTests(unittest.TestCase):
    def test_every_linked_category_has_an_other_code_and_unique_codes(self):
        seen = set()
        for cat in CATEGORIES:
            codes = [code for code, _ in cat["seeds"]]
            for code in codes:
                self.assertNotIn(code, seen, f"{code} seeded twice")
                seen.add(code)
            if cat["linked"]:
                self.assertTrue(any(reason_needs_note(code) for code in codes), f"{cat['key']} has no OTHER code")
                self.assertTrue(cat["used_in"], f"{cat['key']} says nowhere it is used")

    def test_old_categories_are_kept(self):
        for key in ("DOWNTIME", "SCRAP", "QC_REJECT", "SHORT_CLOSE", "RM_ISSUE", "RETURN", "CUSTOMER_COMPLAINT", "SO_CLOSE", "OTHER"):
            self.assertIn(key, REASON_CATEGORIES)

    def test_public_catalog_hides_seed_labels(self):
        first = public_catalog()[0]
        self.assertEqual(first["key"], "SO_CLOSE")
        self.assertIn("SO-OTHER", first["standard_codes"])
        self.assertNotIn("seeds", first)

    def test_other_word_rule(self):
        self.assertTrue(reason_needs_note("QH-OTHER"))
        self.assertTrue(reason_needs_note("OTHERS"))
        self.assertFalse(reason_needs_note("SO-CUSTOMER-CHOSE-ANOTHER-SUPPLIER"))


class ChoiceTests(unittest.TestCase):
    rows = [row("QH-SUSPECT", "QC_HOLD", "Suspected quality problem"), row("QH-OTHER", "QC_HOLD", "Other"),
            row("QH-OLD", "QC_HOLD", active=False), row("DT-POWER", "DOWNTIME", "Power cut")]

    def test_valid_choice_returns_label_and_legacy_text(self):
        got = check_reason_choice(self.rows, "qc_hold", "qh-suspect", " moisture seen ")
        self.assertEqual(got["code"], "QH-SUSPECT")
        self.assertEqual(got["label"], "Suspected quality problem")
        self.assertEqual(got["note"], "moisture seen")
        self.assertEqual(got["text"], "Suspected quality problem — moisture seen")

    def test_no_note_text_is_label(self):
        self.assertEqual(check_reason_choice(self.rows, "QC_HOLD", "QH-SUSPECT", "")["text"], "Suspected quality problem")

    def test_refusals(self):
        cases = [
            ("QC_HOLD", "", "", "Choose a reason"),
            ("QC_HOLD", "Bent tubes", "", "not a reason"),
            ("QC_HOLD", "DT-POWER", "", "belongs to the list"),
            ("QC_HOLD", "QH-OLD", "", "switched off"),
            ("QC_HOLD", "QH-OTHER", "abc", "at least 5"),
            ("NOPE", "QH-SUSPECT", "", "Unknown reason list"),
        ]
        for category, code, note, text in cases:
            with self.subTest(code=code):
                with self.assertRaises(ReasonChoiceError) as caught:
                    check_reason_choice(self.rows, category, code, note)
                self.assertIn(text, str(caught.exception))

    def test_other_with_note_passes(self):
        self.assertEqual(check_reason_choice(self.rows, "QC_HOLD", "QH-OTHER", "Bent at the edge")["note"], "Bent at the edge")


class SeedPlanTests(unittest.TestCase):
    def test_fresh_plant_gets_every_list(self):
        planned = plan_seed_rows([], set())
        categories = {category for category, _, _ in planned}
        self.assertEqual(categories, {cat["key"] for cat in CATEGORIES if cat["seeds"]})

    def test_existing_codes_are_never_touched_and_seeded_lists_are_skipped(self):
        existing = [("SO-CUST-CANCEL", "SO_CLOSE"), ("CC-DAMAGE", "CUSTOMER_COMPLAINT"), ("DT-POWER", "OTHER")]
        planned = plan_seed_rows(existing, {"QC_HOLD"})
        codes = {code for _, code, _ in planned}
        self.assertNotIn("CC-DAMAGE", codes)
        self.assertIn("CC-SIZE", codes)  # missing standard complaint codes are added beside existing ones
        self.assertNotIn("DT-POWER", codes)  # code already used (even in another list) is not added again
        self.assertFalse(any(category == "SO_CLOSE" for category, _, _ in planned))  # plant already has order close reasons
        self.assertFalse(any(category == "QC_HOLD" for category, _, _ in planned))

    def test_second_run_adds_nothing(self):
        every = {cat["key"] for cat in CATEGORIES}
        self.assertEqual(plan_seed_rows([], every), [])


if __name__ == "__main__":
    unittest.main()
