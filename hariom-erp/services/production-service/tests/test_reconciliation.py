import unittest

from src.routers.reconciliation import _calculate_reconciliation, _classify_loss_buckets


class ReconciliationTests(unittest.TestCase):
    def test_calculate_reconciliation_flags_alert_when_threshold_breached(self):
        result = _calculate_reconciliation(
            issued_weight=100.0,
            fg_weight=80.0,
            scrap_weight=5.0,
            alert_threshold_percent=5.0,
        )
        self.assertEqual(result["loss_weight"], 15.0)
        self.assertEqual(result["loss_percentage"], 15.0)
        self.assertTrue(result["alert_flag"])

    def test_calculate_reconciliation_handles_zero_issued(self):
        result = _calculate_reconciliation(
            issued_weight=0.0,
            fg_weight=0.0,
            scrap_weight=0.0,
            alert_threshold_percent=5.0,
        )
        self.assertEqual(result["loss_weight"], 0.0)
        self.assertEqual(result["loss_percentage"], 0.0)
        self.assertFalse(result["alert_flag"])

    def test_classify_loss_buckets_layered_non_negative(self):
        buckets = _classify_loss_buckets(
            consumed_weight=100.0,
            fg_weight=80.0,
            scrap_weight=5.0,
            shrink_ratio=0.1,
            quality_factor=0.05,
        )
        self.assertEqual(set(buckets.keys()), {
            "EXPECTED_SHRINKAGE",
            "PROCESS_LOSS",
            "OPERATOR_VARIANCE",
            "REEL_QUALITY_VARIANCE",
            "UNEXPLAINED",
        })
        self.assertTrue(all(value >= 0 for value in buckets.values()))
        self.assertAlmostEqual(sum(buckets.values()), 15.0, places=3)

    def test_classify_loss_buckets_handles_missing_shrink_ratio(self):
        buckets = _classify_loss_buckets(
            consumed_weight=50.0,
            fg_weight=45.0,
            scrap_weight=2.0,
            shrink_ratio=None,
            quality_factor=0.0,
        )
        self.assertEqual(buckets["EXPECTED_SHRINKAGE"], 0.0)
        self.assertAlmostEqual(sum(buckets.values()), 3.0, places=3)


if __name__ == "__main__":
    unittest.main()
