"""Client round 2026-10-26 rules that need no database: inward number series, challan key,
PO open-quantity check, parchment kg plan and issue units."""
from decimal import Decimal
import re
import uuid
from datetime import date
from types import SimpleNamespace as NS
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from reportlab.platypus import SimpleDocTemplate

from src.routers.issue import check_issue_quantity
from src.routers.procurement import GovernedReceiptCreate
from src.routers.reel_issues import plan_weight_issue
from src.services.procurement import (
    ProcurementRuleError, financial_year, grn_number, grn_series_for, normalize_challan_number, over_receipt,
)
from src.services.procurement_documents import render_purchase_order_pdf


def test_inward_series_is_decided_by_every_line():
    assert grn_series_for(["RAW_PAPER", "RAW_PAPER"]) == "PAPER"
    assert grn_series_for([NS(value="ADHESIVE")]) == "ADHESIVE"
    # Parchment, plastic, box and any mix use the general series.
    assert grn_series_for(["PARCHMENT"]) == "GENERAL"
    assert grn_series_for(["PACKAGING"]) == "GENERAL"
    assert grn_series_for(["RAW_PAPER", "ADHESIVE"]) == "GENERAL"
    assert grn_series_for([]) == "GENERAL"


def test_inward_year_is_the_financial_year_from_april():
    assert financial_year(date(2026, 10, 27)) == 2026
    assert financial_year(date(2027, 3, 31)) == 2026
    assert financial_year(date(2027, 4, 1)) == 2027
    assert financial_year(date(2026, 1, 15)) == 2025


def test_inward_number_format_is_prefix_two_digit_year_and_three_digit_counter():
    assert grn_number("PAPER", 2026, 1) == "P/26/001"
    assert grn_number("ADHESIVE", 2026, 12) == "A/26/012"
    assert grn_number("GENERAL", 2027, 7) == "IN/27/007"
    assert grn_number("PAPER", 2026, 1000) == "P/26/1000"
    with pytest.raises(ProcurementRuleError):
        grn_number("PAPER", 2026, 0)
    with pytest.raises(ProcurementRuleError):
        grn_number("GRN", 2026, 1)


def test_challan_key_ignores_spaces_case_and_punctuation():
    assert normalize_challan_number(" ch / 12-a ") == "CH12A" == normalize_challan_number("CH12A")
    with pytest.raises(ProcurementRuleError):
        normalize_challan_number(" -- ")


def _receipt(**extra):
    body = {"request_id": uuid.uuid4(), "purchase_order_id": uuid.uuid4(), "received_date": date(2026, 10, 26),
            "invoice_pending": True, "lines": [{"po_line_id": uuid.uuid4(), "quantity": 10}]}
    return GovernedReceiptCreate(**{**body, **extra})


def test_inward_needs_the_supplier_challan_number():
    with pytest.raises(ValidationError):
        _receipt()
    with pytest.raises(ValidationError):
        _receipt(supplier_challan_no="  /  ")
    assert _receipt(supplier_challan_no="  DC   441 ").supplier_challan_no == "DC 441"
    # A blank over-receipt reason is no reason.
    assert _receipt(supplier_challan_no="DC-1", over_receipt_reason="   ").over_receipt_reason is None


def test_over_receipt_is_measured_against_the_po_open_quantity():
    assert over_receipt(40, 60) == 0
    assert over_receipt(60, 60) == 0
    assert over_receipt(75, 60) == Decimal("15")
    # Nothing left open: everything received is extra.
    assert over_receipt(5, -2) == Decimal("5")


def test_parchment_kg_issue_uses_the_oldest_coils_first():
    coils = [("old", 30.0), ("mid", 25.0), ("new", 50.0)]
    assert plan_weight_issue(coils, 45.5) == [("old", 30.0), ("mid", 15.5)]
    assert plan_weight_issue(coils, 30) == [("old", 30.0)]
    with pytest.raises(ValueError, match="Only 105 kg"):
        plan_weight_issue(coils, 105.5)


def test_issue_units_follow_the_item_master_and_stock_on_hand():
    check_issue_quantity(12, "PCS", 40, "Box R-150")
    check_issue_quantity(2.5, "KG", 40, "Plastic sheet")
    with pytest.raises(HTTPException) as fraction:
        check_issue_quantity(2.5, "PCS", 40, "Box R-150")
    assert fraction.value.status_code == 422 and "whole number" in fraction.value.detail
    with pytest.raises(HTTPException) as over:
        check_issue_quantity(41, "KG", 40, "PVA adhesive")
    assert over.value.status_code == 400
    assert over.value.detail == "Only 40 kg of PVA adhesive is in stock and cleared for issue. You asked for 41 kg."


def test_po_pdf_prints_only_the_ordered_quantity():
    line = NS(item_id=uuid.uuid4(), item=NS(item_code="KRAFT-230", name="Kraft 230"), logical_line_id=uuid.uuid4(),
              qty_ordered=Decimal("5000"), unit_rate=Decimal("30"), uom="KG", expected_unit_count=8, count_basis="ESTIMATED",
              specification_json={"width_mm": 900, "gsm": 230, "plybond": 180, "bulk": 1.4, "cobb": "COBB 30"})
    revision = NS(snapshot_json={"lines": [{"logical_line_id": str(line.logical_line_id)}], "metadata": {}}, revision_no=1,
                  approval_state="APPROVED", lines=[line], created_by="maker", approved_by="owner", approved_at="2026-10-26")
    order = NS(po_no="RP-PM/09", supplier_name_snapshot="Mill", category="RM_PM", created_at="2026-10-26")
    with patch("src.services.procurement_documents.SimpleDocTemplate",
               side_effect=lambda *args, **kwargs: SimpleDocTemplate(*args, **kwargs, pageCompression=0)):
        pdf = render_purchase_order_pdf(order, revision)
    text = b" ".join(re.findall(rb"\(([^()]*)\)\s*Tj", pdf))
    # Plain words on the vendor's copy too: "5,000 kg" (spec 0.6).
    assert b"Ordered quantity" in text and b"5,000 kg" in text
    for gone in (b"GSM 230", b"Width 900", b"PB 180", b"estimated", b"Units"):
        assert gone not in text
