import unittest
from datetime import date
from unittest.mock import patch

import httpx
from fastapi import HTTPException

from src.routers.reconciliation import (
    _calculate_reconciliation,
    _classify_loss_buckets,
    _fetch_inventory_item_catalog,
    _fetch_paper_catalog,
    _fetch_stock_certification_for_period,
)


class _FakeResponse:
    status_code = 200

    def json(self):
        return {
            "items": [
                {"id": "older", "period_end": "2026-05-31"},
                {"id": "current", "period_end": "2026-06-30"},
            ]
        }


class _FakeClient:
    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def get(self, *args, **kwargs):
        return _FakeResponse()


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

    def test_fetch_stock_certification_accepts_wrapped_items_payload(self):
        with patch("src.routers.reconciliation.httpx.Client", _FakeClient):
            cert = _fetch_stock_certification_for_period(
                token="token",
                plant_id="00000000-0000-0000-0000-0000000000a1",
                period_start=date(2026, 6, 1),
                period_end=date(2026, 6, 30),
            )

        self.assertIsNotNone(cert)
        self.assertEqual(cert["id"], "current")

    def test_catalog_lookups_fail_closed_when_peer_hostname_unresolved(self):
        class _FailingClient(_FakeClient):
            def get(self, *args, **kwargs):
                raise httpx.ConnectError("[Errno 8] nodename nor servname provided, or not known")

        with patch("src.routers.reconciliation.httpx.Client", _FailingClient):
            for lookup in (_fetch_paper_catalog, _fetch_inventory_item_catalog):
                with self.assertRaises(HTTPException) as error:
                    lookup("token", "00000000-0000-0000-0000-0000000000a1")
                self.assertEqual(error.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()


def test_reconciliation_converts_bom_mass_but_preserves_zero_counted_use():
    from src.services.consumption import compose_streams_for_period, summarize_streams
    rows = compose_streams_for_period(
        provisional_map={"GLUE": {"theoretical_consumption_kg": 12}},
        actual_map={"GLUE": {"actual_consumption_kg": 0, "notes": "No glue consumed"}},
        ledger_map={"GLUE": {"ledger_issued_kg": 10}},
        inventory_catalog={"GLUE": {"type": "ADHESIVE", "uom": "L", "density_kg_per_litre": 1.2, "unit_cost": 30}},
        paper_codes=set())
    assert rows[0].provisional_theory_kg == 10
    assert rows[0].actual_kg == 0 and rows[0].item_uom == "L"
    assert rows[0].notes == "No glue consumed"
    assert summarize_streams(rows)["total_theoretical_consumption_kg"] == 0
