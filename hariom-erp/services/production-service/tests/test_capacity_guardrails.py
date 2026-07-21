import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace

from src.routers.planning import (
    _capacity_allocation_to_qty,
    _execution_load_for_capacity,
    _extract_oven_cycle_hours,
    _parse_cycle_hours,
    _planned_load_for_capacity,
)


class CapacityGuardrailTests(unittest.TestCase):
    def test_parse_cycle_hours_accepts_hh_mm(self):
        self.assertAlmostEqual(_parse_cycle_hours("05:30"), 5.5, places=6)

    def test_parse_cycle_hours_treats_large_number_as_minutes(self):
        self.assertAlmostEqual(_parse_cycle_hours(360), 6.0, places=6)

    def test_extract_oven_cycle_prefers_planned_window(self):
        start = datetime(2026, 3, 3, 8, 0, 0)
        end = start + timedelta(hours=5, minutes=30)
        stage = SimpleNamespace(planned_start=start, planned_end=end)
        cycle = _extract_oven_cycle_hours(stage, {"cycle_time": "04:00"})
        self.assertAlmostEqual(cycle or 0.0, 5.5, places=6)

    def test_planned_load_converts_tubes_to_bamboo_capacity(self):
        load = _planned_load_for_capacity(
            stage="WINDER",
            capacity_unit="BAMBOOS_PER_DAY",
            planned_qty=450.0,
            spec_snapshot={
                "length_min_mm": 115.0,
                "length_max_mm": 115.0,
                "bamboo_max_length": 1560,
                "cut_loss_mm": 40,
            },
        )
        self.assertEqual(load, 35.0)

    def test_planned_load_converts_winder_tubes_to_meter_capacity(self):
        load = _planned_load_for_capacity(
            stage="WINDER",
            capacity_unit="METERS_PER_DAY",
            planned_qty=450.0,
            spec_snapshot={
                "length_min_mm": 115.0,
                "length_max_mm": 115.0,
                "bamboo_max_length": 1560,
                "cut_loss_mm": 40,
            },
        )
        self.assertAlmostEqual(load, 53.9, places=2)

    def test_meter_capacity_allocation_splits_on_full_bamboo_lengths(self):
        qty, required_capacity = _capacity_allocation_to_qty(
            "WINDER",
            "METERS_PER_DAY",
            {
                "length_min_mm": 115.0,
                "length_max_mm": 115.0,
                "bamboo_max_length": 1560,
                "cut_loss_mm": 40,
            },
            remaining_qty=450.0,
            available_capacity=30.0,
        )
        self.assertEqual(qty, 247.0)
        self.assertAlmostEqual(required_capacity, 29.26, places=2)

    def test_repeated_meter_capacity_splits_never_overfill_a_shift_and_conserve_quantity(self):
        snapshot = {
            "length_min_mm": 115.0,
            "length_max_mm": 115.0,
            "bamboo_max_length": 1560,
            "cut_loss_mm": 40,
        }
        remaining = 1000.0
        allocations = []
        for available_capacity in (30.0, 30.0, 30.0, 30.0, 30.0):
            qty, used_capacity = _capacity_allocation_to_qty(
                "WINDER",
                "METERS_PER_DAY",
                snapshot,
                remaining_qty=remaining,
                available_capacity=available_capacity,
            )
            allocations.append((qty, used_capacity))
            remaining = round(remaining - qty, 2)
            if remaining <= 0:
                break

        self.assertEqual(sum(qty for qty, _ in allocations), 1000.0)
        self.assertEqual(remaining, 0.0)
        self.assertTrue(all(used <= 30.0 for _, used in allocations))

    def test_execution_load_converts_winder_bamboo_output_to_meters(self):
        load = _execution_load_for_capacity(
            capacity_unit="METERS_PER_DAY",
            output_qty=35.0,
            spec_snapshot={
                "length_min_mm": 115.0,
                "length_max_mm": 115.0,
                "bamboo_max_length": 1560,
                "cut_loss_mm": 40,
            },
        )
        self.assertAlmostEqual(load, 53.9, places=2)

    def test_execution_load_for_oven_batch_capacity(self):
        self.assertEqual(_execution_load_for_capacity(capacity_unit="BATCHES_PER_DAY", output_qty=250.0), 1.0)


if __name__ == "__main__":
    unittest.main()
