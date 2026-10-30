"""Held GRN stock goes to the people who clear it (client 2026-10-18: "approval ke liye kiske pass jayega")."""
import asyncio
import json

from starlette.requests import Request
from starlette.responses import Response

from src.services import quality_events


def _request():
    return Request({"type": "http", "method": "POST", "path": "/", "headers": [(b"x-plant-id", b"00000000-0000-0000-0000-0000000000a1")]})


def _sent(monkeypatch, path, body):
    sent = []

    async def fake_emit(token, **kwargs):
        sent.append(kwargs)

    monkeypatch.setattr(quality_events, "_emit", fake_emit)
    response = Response(content=json.dumps(body).encode(), media_type="application/json", status_code=200)
    asyncio.run(quality_events.notify_receipt(path, response, _request(), "t"))
    return {row["event_type"]: row for row in sent}


def test_invoice_difference_goes_to_plant_head_and_accounts(monkeypatch):
    sent = _sent(monkeypatch, "receipts", {"id": "r1", "grn_no": "GRN-1", "commercial_status": "RATE_REVIEW", "lots": [{"id": "l1"}]})
    assert set(sent["PURCHASE_INVOICE_DIFFERENCE"]["recipient_roles"]) >= {"PlantManager", "Accounts"}
    assert sent["PURCHASE_INVOICE_DIFFERENCE"]["href"] == "/purchase/discrepancies"
    assert "QC_LOTS_TO_INSPECT" in sent


def test_missing_invoice_goes_to_store(monkeypatch):
    sent = _sent(monkeypatch, "receipts", {"id": "r2", "grn_no": "GRN-2", "commercial_status": "INVOICE_PENDING", "lots": []})
    assert "Store" in sent["PURCHASE_INVOICE_PENDING"]["recipient_roles"] and sent["PURCHASE_INVOICE_PENDING"]["payload"]["action"] == "attach_invoice"


def test_manual_grn_goes_to_plant_head_and_accounts(monkeypatch):
    sent = _sent(monkeypatch, "manual-receipts", {"id": "r3", "grn_no": "MGRN-3", "commercial_status": "MANUAL_REVIEW", "lots": [{"id": "l3"}]})
    assert set(sent["PURCHASE_MANUAL_GRN_APPROVAL"]["recipient_roles"]) >= {"PlantManager", "Accounts"}
    assert "PURCHASE_INVOICE_DIFFERENCE" not in sent


def test_challan_rate_case_on_a_pending_invoice_grn_also_goes_to_plant_head(monkeypatch):
    # Client 2026-10-30: the rate typed from the challan opens the review case before the invoice comes.
    sent = _sent(monkeypatch, "receipts", {"id": "r4", "grn_no": "P/26/011", "commercial_status": "INVOICE_PENDING",
                                           "rate_review_cases": [{"item_code": "301", "po_rate": 43, "invoice_rate": 44.25}], "lots": []})
    assert set(sent["PURCHASE_INVOICE_DIFFERENCE"]["recipient_roles"]) >= {"PlantManager", "Accounts"}
    assert sent["PURCHASE_INVOICE_DIFFERENCE"]["event_id"] == "grn-difference:r4:CHALLAN_RATE"
    assert "Store" in sent["PURCHASE_INVOICE_PENDING"]["recipient_roles"]
    plain = _sent(monkeypatch, "receipts", {"id": "r5", "grn_no": "P/26/012", "commercial_status": "INVOICE_PENDING", "rate_review_cases": [], "lots": []})
    assert "PURCHASE_INVOICE_DIFFERENCE" not in plain
