"""Pure-function unit tests for the production-shortfall close-loop.

These cover the new close-loop logic with NO live DB and NO network — every
function under test is a side-effect-free helper extracted into
``src.routers.operations`` so the contract math/predicates can be verified in
isolation:

  * carry-forward release-lot split (P1.10): original shrinks by gap, the new
    lot carries exactly the gap, total released qty is conserved.
  * short-close ``stage_type`` normalization/validation: the 7 allowed values
    are accepted (case-insensitive), junk is rejected with HTTP 422.
  * the P3.5 sales short-close retry predicate: retry on transient 5xx while
    attempts remain, never on 4xx.
  * the P2.14 reschedule-queue membership predicate: rows with affected job
    cards and an unresolved (NULL/PENDING) status are included; DONE/DISMISSED
    or no-affected-cards rows are excluded.
"""
import unittest

from fastapi import HTTPException

from src.routers.operations import (
    ALLOWED_SHORT_CLOSE_STAGE_TYPES,
    _SALES_SYNC_MAX_ATTEMPTS,
    carry_forward_lot_split,
    downtime_needs_reschedule,
    normalize_short_close_stage_type,
    should_retry_sales_status,
)


class CarryForwardLotSplitTests(unittest.TestCase):
    """P1.10 — splitting the original release lot for the carry-forward JC."""

    def test_original_shrinks_by_gap_and_new_lot_equals_gap(self):
        shrunk, new_lot = carry_forward_lot_split(100.0, 30.0)
        self.assertAlmostEqual(shrunk, 70.0, places=4)
        self.assertAlmostEqual(new_lot, 30.0, places=4)

    def test_total_released_qty_is_conserved(self):
        original = 250.0
        gap = 87.5
        shrunk, new_lot = carry_forward_lot_split(original, gap)
        self.assertAlmostEqual(shrunk + new_lot, original, places=4)

    def test_total_conserved_with_messy_floats(self):
        original = 12.3
        gap = 4.1
        shrunk, new_lot = carry_forward_lot_split(original, gap)
        # Both pieces sum back to the original within rounding tolerance.
        self.assertAlmostEqual(shrunk + new_lot, original, places=4)

    def test_original_never_goes_negative(self):
        # Gap larger than the original (defensive) — original floors at 0, the
        # new lot still carries the requested gap.
        shrunk, new_lot = carry_forward_lot_split(10.0, 40.0)
        self.assertEqual(shrunk, 0.0)
        self.assertAlmostEqual(new_lot, 40.0, places=4)

    def test_none_inputs_coerced_to_zero(self):
        shrunk, new_lot = carry_forward_lot_split(None, None)
        self.assertEqual(shrunk, 0.0)
        self.assertEqual(new_lot, 0.0)

    def test_full_gap_drains_original(self):
        shrunk, new_lot = carry_forward_lot_split(50.0, 50.0)
        self.assertEqual(shrunk, 0.0)
        self.assertAlmostEqual(new_lot, 50.0, places=4)


class StageTypeNormalizationTests(unittest.TestCase):
    """Process-level short-close stage_type validation."""

    def test_allowed_set_is_the_seven_contract_values(self):
        self.assertEqual(
            ALLOWED_SHORT_CLOSE_STAGE_TYPES,
            {"JOB_CARD", "WINDER", "OVEN", "PROCESS", "SLITTING", "PACKING", "QC"},
        )

    def test_each_allowed_value_is_accepted(self):
        for stage in ALLOWED_SHORT_CLOSE_STAGE_TYPES:
            self.assertEqual(normalize_short_close_stage_type(stage), stage)

    def test_lowercase_is_normalized_to_upper(self):
        self.assertEqual(normalize_short_close_stage_type("process"), "PROCESS")
        self.assertEqual(normalize_short_close_stage_type("  winder  "), "WINDER")

    def test_none_defaults_to_job_card(self):
        self.assertEqual(normalize_short_close_stage_type(None), "JOB_CARD")

    def test_empty_string_defaults_to_job_card(self):
        # A falsy value (None / "") falls back to the whole-card default.
        self.assertEqual(normalize_short_close_stage_type(""), "JOB_CARD")

    def test_whitespace_only_is_rejected(self):
        # A non-empty-but-blank token is junk once stripped — matches the
        # original inline behaviour of `(value or "JOB_CARD").strip().upper()`.
        with self.assertRaises(HTTPException) as ctx:
            normalize_short_close_stage_type("   ")
        self.assertEqual(ctx.exception.status_code, 422)

    def test_junk_is_rejected_with_422(self):
        for junk in ["DISPATCH", "BOGUS", "winder2", "job card"]:
            with self.assertRaises(HTTPException) as ctx:
                normalize_short_close_stage_type(junk)
            self.assertEqual(ctx.exception.status_code, 422)


class SalesRetryPredicateTests(unittest.TestCase):
    """P3.5 — retry transient sales short-close failures, never 4xx."""

    def test_retries_transient_5xx_while_attempts_remain(self):
        for status in (502, 503, 504):
            self.assertTrue(should_retry_sales_status(status, attempt=1))
            self.assertTrue(should_retry_sales_status(status, attempt=2))

    def test_does_not_retry_after_last_attempt(self):
        for status in (502, 503, 504):
            self.assertFalse(
                should_retry_sales_status(status, attempt=_SALES_SYNC_MAX_ATTEMPTS)
            )

    def test_never_retries_4xx(self):
        for status in (400, 401, 403, 404, 409, 422):
            self.assertFalse(should_retry_sales_status(status, attempt=1))

    def test_does_not_retry_2xx(self):
        self.assertFalse(should_retry_sales_status(200, attempt=1))

    def test_does_not_retry_non_transient_5xx(self):
        # 500 is treated as permanent (not in the transient set).
        self.assertFalse(should_retry_sales_status(500, attempt=1))


class RescheduleQueuePredicateTests(unittest.TestCase):
    """P2.14 — which downtime rows belong in the planner reschedule queue."""

    def test_pending_with_affected_ids_is_included(self):
        self.assertTrue(downtime_needs_reschedule(["jc-1"], "PENDING"))

    def test_null_status_with_affected_ids_is_included(self):
        self.assertTrue(downtime_needs_reschedule(["jc-1", "jc-2"], None))

    def test_pending_lowercase_is_included(self):
        self.assertTrue(downtime_needs_reschedule(["jc-1"], "pending"))

    def test_done_is_excluded(self):
        self.assertFalse(downtime_needs_reschedule(["jc-1"], "DONE"))

    def test_dismissed_is_excluded(self):
        self.assertFalse(downtime_needs_reschedule(["jc-1"], "DISMISSED"))

    def test_empty_affected_ids_is_excluded_even_when_pending(self):
        self.assertFalse(downtime_needs_reschedule([], "PENDING"))
        self.assertFalse(downtime_needs_reschedule([], None))

    def test_non_list_affected_ids_is_excluded(self):
        self.assertFalse(downtime_needs_reschedule(None, "PENDING"))
        self.assertFalse(downtime_needs_reschedule("jc-1", None))


if __name__ == "__main__":
    unittest.main()
