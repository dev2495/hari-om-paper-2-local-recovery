import pytest
from fastapi import HTTPException

from src.routers import deep_cuts
from src import utils


def test_customer_360_uses_dispatch_logs_for_period_value_and_qty(monkeypatch):
    def fake_service_get(url, token, **kwargs):
        if "/master/customers/" in url:
            return [{"id": "customer-1", "name": "Acme"}]
        return [
            {
                "customer_id": "customer-1",
                "status": "PARTIALLY_DISPATCHED",
                "created_at": "2026-05-01T00:00:00",
                "lines": [
                    {
                        "qty": 100,
                        "rate_per_pc": 12.5,
                        "fulfilled_qty": 40,
                        "due_date": "2026-07-31",
                        "dispatch_logs": [
                            {"qty": 10, "created_at": "2026-06-30T10:00:00"},
                            {"qty": 30, "created_at": "2026-07-10T10:00:00"},
                        ],
                    }
                ],
            }
        ]

    monkeypatch.setattr(deep_cuts, "service_get", fake_service_get)
    result = deep_cuts.customer_360(
        start_date="2026-07-01",
        end_date="2026-07-31",
        token="token",
        plant_scope={"scope_all": False, "selected_plant_id": "plant-1"},
    )

    row = result["rows"][0]
    assert row["customer_name"] == "Acme"
    assert row["orders_open"] == 1
    assert row["dispatched_qty"] == 30.0
    assert row["dispatched_value"] == 375.0
    assert row["open_value"] == 750.0
    assert result["summary"]["total_dispatched_value"] == 375.0


class _BadResponse:
    status_code = 404
    text = "not found"


def test_required_upstream_contract_failure_is_not_reported_as_empty(monkeypatch):
    monkeypatch.setattr(utils.requests, "get", lambda *args, **kwargs: _BadResponse())
    with pytest.raises(HTTPException) as caught:
        utils.service_get("http://sales/sales-orders", "token", required=True)
    assert caught.value.status_code == 502
    assert "404" in caught.value.detail
