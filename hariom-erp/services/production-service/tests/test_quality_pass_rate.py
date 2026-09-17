import unittest

from src.quality_metrics import quality_pass_rate, quality_pass_rate_or_zero


class QualityPassRateTests(unittest.TestCase):
    def test_empty_set_is_null_never_one_hundred(self):
        self.assertIsNone(quality_pass_rate(0, 0))
        self.assertEqual(quality_pass_rate_or_zero(0, 0), 0.0)

    def test_zero_percent_from_failures_is_not_empty(self):
        self.assertEqual(quality_pass_rate(0, 4), 0.0)

    def test_mixed_inspections(self):
        self.assertEqual(quality_pass_rate(3, 4), 75.0)
