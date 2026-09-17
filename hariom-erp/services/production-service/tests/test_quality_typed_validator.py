import unittest

from src.quality_eval import evaluate_stage_quality
from src.routers import quality


def _bounds():
    return {
        "id_min_mm": 50,
        "id_max_mm": 55,
        "od_min_mm": 100,
        "od_max_mm": 110,
        "length_min_mm": 145,
        "length_max_mm": 155,
        "weight_min_g": 300,
        "weight_max_g": 340,
        "cs_min_n": 450,
        "cs_max_n": 550,
    }


def _full_readings():
    return {"id": 52, "od": 105, "length": 150, "weight": 320, "cs": 500}


class TypedValidatorTests(unittest.TestCase):
    def test_all_in_range_is_pass(self):
        result = evaluate_stage_quality("WINDER", _bounds(), _full_readings())
        self.assertEqual(result.status, "PASS")
        self.assertEqual(result.failures, [])

    def test_out_of_range_is_fail(self):
        result = evaluate_stage_quality("WINDER", _bounds(), {**_full_readings(), "od": 130})
        self.assertEqual(result.status, "FAIL")
        self.assertEqual([f["label"] for f in result.failures], ["OD"])

    def test_blank_reading_is_not_pass(self):
        readings = {**_full_readings(), "weight": ""}
        result = evaluate_stage_quality("WINDER", _bounds(), readings)
        self.assertNotEqual(result.status, "PASS")
        self.assertEqual(result.status, "INCOMPLETE")
        self.assertEqual([i["label"] for i in result.incomplete], ["Weight"])

    def test_non_numeric_reading_is_invalid_not_pass(self):
        readings = {**_full_readings(), "cs": "abc"}
        result = evaluate_stage_quality("WINDER", _bounds(), readings)
        self.assertEqual(result.status, "INVALID")
        self.assertEqual([i["label"] for i in result.invalid], ["CS"])

    def test_non_finite_reading_is_invalid(self):
        for bad in (float("nan"), float("inf"), "NaN", "Infinity"):
            result = evaluate_stage_quality("WINDER", _bounds(), {**_full_readings(), "id": bad})
            self.assertEqual(result.status, "INVALID", msg=f"value {bad!r} should be INVALID")

    def test_incomplete_bounds_with_reading_is_not_pass(self):
        bounds = _bounds()
        bounds.pop("weight_max_g")
        result = evaluate_stage_quality("WINDER", bounds, _full_readings())
        self.assertEqual(result.status, "INCOMPLETE")
        self.assertTrue(any(i["label"] == "Weight" for i in result.incomplete))

    def test_missing_reading_for_bounded_field_is_incomplete(self):
        readings = {"id": 52, "od": 105, "length": 150, "cs": 500}  # weight missing entirely
        result = evaluate_stage_quality("WINDER", _bounds(), readings)
        self.assertEqual(result.status, "INCOMPLETE")

    def test_fail_takes_precedence_over_incomplete(self):
        readings = {**_full_readings(), "od": 130, "weight": ""}
        result = evaluate_stage_quality("WINDER", _bounds(), readings)
        self.assertEqual(result.status, "FAIL")

    def test_boolean_reading_is_invalid(self):
        result = evaluate_stage_quality("WINDER", _bounds(), {**_full_readings(), "id": True})
        self.assertEqual(result.status, "INVALID")

    def test_check_failures_wrapper_matches_shared_evaluator(self):
        failures = quality._check_failures("QC", _bounds(), {**_full_readings(), "od": 130})
        self.assertEqual([f["label"] for f in failures], ["OD"])


if __name__ == "__main__":
    unittest.main()
