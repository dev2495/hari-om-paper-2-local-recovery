import unittest
from types import SimpleNamespace

from src.quality_eval import evaluate_incoming_quality


def _raw_paper_template():
    return [
        SimpleNamespace(parameter_key="gsm", label="GSM", input_type="number", options=[], required=True),
        SimpleNamespace(parameter_key="moisture_pct", label="Moisture %", input_type="number", options=[], required=True),
        SimpleNamespace(
            parameter_key="clear_for_slitting",
            label="Clear For Slitting",
            input_type="select",
            options=["YES", "NO", "HOLD"],
            required=True,
        ),
        SimpleNamespace(parameter_key="bf", label="BF", input_type="number", options=[], required=True),
    ]


class IncomingQualityVerdictTests(unittest.TestCase):
    def test_complete_valid_readings_pass(self):
        readings = {"gsm": 120, "moisture_pct": 6.5, "clear_for_slitting": "YES", "bf": 18}
        result = evaluate_incoming_quality(_raw_paper_template(), readings)
        self.assertEqual(result.status, "PASS")
        self.assertEqual(result.failures, [])

    def test_missing_required_reading_is_not_pass(self):
        readings = {"gsm": 120, "clear_for_slitting": "YES", "bf": 18}  # moisture missing
        result = evaluate_incoming_quality(_raw_paper_template(), readings)
        self.assertEqual(result.status, "FAIL")
        self.assertTrue(any(f["reason"] == "MISSING" and f["parameter"] == "moisture_pct" for f in result.failures))

    def test_non_numeric_reading_is_invalid_not_pass(self):
        readings = {"gsm": "not-a-number", "moisture_pct": 6.5, "clear_for_slitting": "YES", "bf": 18}
        result = evaluate_incoming_quality(_raw_paper_template(), readings)
        self.assertEqual(result.status, "FAIL")
        self.assertTrue(any(f["reason"] == "INVALID" and f["parameter"] == "gsm" for f in result.failures))

    def test_failing_select_value_is_fail(self):
        readings = {"gsm": 120, "moisture_pct": 6.5, "clear_for_slitting": "HOLD", "bf": 18}
        result = evaluate_incoming_quality(_raw_paper_template(), readings)
        self.assertEqual(result.status, "FAIL")
        self.assertTrue(any(f["reason"] == "FAIL" and f["parameter"] == "clear_for_slitting" for f in result.failures))

    def test_out_of_option_select_is_invalid(self):
        readings = {"gsm": 120, "moisture_pct": 6.5, "clear_for_slitting": "MAYBE", "bf": 18}
        result = evaluate_incoming_quality(_raw_paper_template(), readings)
        self.assertEqual(result.status, "FAIL")
        self.assertTrue(any(f["reason"] == "INVALID" and f["parameter"] == "clear_for_slitting" for f in result.failures))

    def test_blank_string_counts_as_missing(self):
        readings = {"gsm": "  ", "moisture_pct": 6.5, "clear_for_slitting": "YES", "bf": 18}
        result = evaluate_incoming_quality(_raw_paper_template(), readings)
        self.assertEqual(result.status, "FAIL")
        self.assertTrue(any(f["reason"] == "MISSING" and f["parameter"] == "gsm" for f in result.failures))


if __name__ == "__main__":
    unittest.main()
