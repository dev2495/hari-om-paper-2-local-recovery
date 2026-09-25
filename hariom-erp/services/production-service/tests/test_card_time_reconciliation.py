import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from fastapi import HTTPException
from pydantic import ValidationError

from src.routers.planning import (
    _canonicalize_entry_snapshot,
    _parse_execution_timestamp,
    _reconcile_card_times,
    _today_utc_window,
    _validate_stage_completion_payload,
)
from src.schemas.planning import StageOutputPayload

NOW = datetime(2026, 9, 25, 12, 0, 0)  # naive UTC == 17:30 IST


class CardTimeParsingTests(unittest.TestCase):
    def test_naive_card_time_is_plant_local(self):
        # 08:30 written on the card in the plant (IST) is 03:00 UTC.
        self.assertEqual(
            _parse_execution_timestamp(datetime(2026, 9, 25, 8, 30)),
            datetime(2026, 9, 25, 3, 0),
        )

    def test_offset_card_time_is_normalised_to_utc(self):
        ist = timezone(timedelta(hours=5, minutes=30))
        self.assertEqual(
            _parse_execution_timestamp(datetime(2026, 9, 25, 8, 30, tzinfo=ist)),
            datetime(2026, 9, 25, 3, 0),
        )


class ReconcileCardTimesTests(unittest.TestCase):
    def _reconcile(self, **overrides):
        kwargs = dict(
            stage="WINDER",
            save_mode="complete",
            card_start=NOW - timedelta(hours=30),
            card_end=NOW - timedelta(hours=26),
            now=NOW,
            job_card_created_at=NOW - timedelta(days=2),
            override_reason=None,
        )
        kwargs.update(overrides)
        return _reconcile_card_times(**kwargs)

    def test_late_entry_keeps_card_times_and_flags_lag(self):
        record, warnings = self._reconcile()
        self.assertEqual(record["time_source"], "CARD")
        self.assertEqual(record["cycle_time_minutes"], 240.0)
        self.assertEqual(record["entry_lag_minutes"], 26 * 60.0)
        self.assertTrue(record["late_entry"])
        self.assertTrue(any("time reconciliation" in w for w in warnings))

    def test_prompt_entry_is_not_late(self):
        record, warnings = self._reconcile(card_start=NOW - timedelta(hours=3), card_end=NOW - timedelta(minutes=20))
        self.assertFalse(record["late_entry"])
        self.assertEqual(warnings, [])

    def test_end_before_start_is_rejected(self):
        with self.assertRaises(HTTPException) as ctx:
            self._reconcile(card_start=NOW - timedelta(hours=1), card_end=NOW - timedelta(hours=2))
        self.assertEqual(ctx.exception.status_code, 400)

    def test_future_time_is_rejected(self):
        with self.assertRaises(HTTPException):
            self._reconcile(card_end=NOW + timedelta(hours=1))

    def test_completion_without_card_times_needs_override(self):
        with self.assertRaises(HTTPException):
            self._reconcile(card_start=None, card_end=None)
        record, warnings = self._reconcile(card_start=None, card_end=None, override_reason="card lost")
        self.assertEqual(record["time_source"], "SYSTEM_ENTRY")
        self.assertTrue(warnings)

    def test_packing_does_not_require_card_times(self):
        record, _ = self._reconcile(stage="PACKING", card_start=None, card_end=None)
        self.assertEqual(record["time_source"], "SYSTEM_ENTRY")

    def test_draft_does_not_require_card_times(self):
        record, _ = self._reconcile(save_mode="draft", card_start=None, card_end=None)
        self.assertIsNone(record["entry_lag_minutes"])


class CapacityWindowTests(unittest.TestCase):
    def test_capacity_bucket_follows_card_day_not_entry_day(self):
        card_end = datetime(2026, 9, 24, 10, 0)  # yesterday, 15:30 IST
        start, end = _today_utc_window(card_end)
        self.assertLessEqual(start, card_end)
        self.assertLess(card_end, end)
        self.assertLessEqual(end, NOW)


class OvenAliasTests(unittest.TestCase):
    def test_supervisor_ui_oven_keys_satisfy_completion(self):
        payload = StageOutputPayload(
            stage="OVEN",
            output_qty=95.0,
            entry_snapshot={
                "bamboo_count_in": 100,
                "pre_oven_weight_kg": "52",
                "post_oven_weight_kg": "48",
                "moisture_before": "12",
                "moisture_after": "7",
            },
        )
        stage = SimpleNamespace(entry_snapshot={}, actuals_snapshot={})
        _validate_stage_completion_payload(selected_stage="OVEN", payload=payload, stage=stage)

    def test_aliases_are_mirrored_both_ways(self):
        snapshot = _canonicalize_entry_snapshot("OVEN", {"pre_weight": 5, "moisture_after": 7})
        self.assertEqual(snapshot["pre_oven_weight_kg"], 5)
        self.assertEqual(snapshot["post_moisture"], 7)


class StageOutputPayloadTests(unittest.TestCase):
    def test_card_shift_code_is_accepted(self):
        payload = StageOutputPayload(stage="WINDER", shift_code="shift_a")
        self.assertEqual(payload.shift_code, "SHIFT_A")

    def test_unknown_shift_is_rejected(self):
        with self.assertRaises(ValidationError):
            StageOutputPayload(stage="WINDER", shift_code="NIGHT")


if __name__ == "__main__":
    unittest.main()
