import asyncio
from datetime import date
from decimal import Decimal
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch
from reportlab.platypus import SimpleDocTemplate
import uuid
import re

import pytest
from openpyxl import load_workbook

from src.routers.procurement import _csv_response, _xlsx_response
from src.services.procurement_documents import render_purchase_order_pdf

from src.services.procurement import (
    ProcurementRuleError,
    alert_severity,
    allocate_fixed_charge,
    calculate_landed_cost,
    compare_rates,
    mrp_suggestion,
    normalize_invoice_number,
    physical_form,
    po_number,
)


def test_two_document_series_are_exact_and_manual_prefixes_are_rejected():
    assert po_number("RP-PM", 1) == "RP-PM/01"
    assert po_number("OT", 12) == "OT/12"
    with pytest.raises(ProcurementRuleError):
        po_number("PO", 1)


def test_invoice_number_normalization_is_vendor_namespace_safe():
    assert normalize_invoice_number(" uppm / 34-26 ") == "UPPM3426"
    with pytest.raises(ProcurementRuleError):
        normalize_invoice_number(" -- ")


def test_rate_comparison_preserves_positive_and_favorable_signs():
    high = compare_rates(5000, 30, 31.25)
    assert high.delta_per_kg == Decimal("1.250000")
    assert high.signed_difference == Decimal("6250.00")
    assert high.claimable_amount == Decimal("6250.00")
    low = compare_rates(5000, 30, 29.5)
    assert low.signed_difference == Decimal("-2500.00")
    assert low.claimable_amount == Decimal("0.00")


def test_sample_six_line_purchase_total_uses_exact_decimal_arithmetic():
    rates = [Decimal(value) for value in ("28.25", "29.25", "31.75", "34.25", "36.75", "39.25")]
    quantities = [Decimal("50000")] * len(rates)
    assert sum((rate * quantity for rate, quantity in zip(rates, quantities)), Decimal("0")) == Decimal("9975000.00")


def test_four_physical_lots_sum_to_5000_kg_without_averaging():
    weights = [Decimal("1250"), Decimal("1180"), Decimal("1320"), Decimal("1250")]
    assert len(weights) == 4
    assert sum(weights) == Decimal("5000")


def test_fixed_freight_allocates_by_measured_net_weight_and_reconciles():
    allocated = allocate_fixed_charge(1000, [1250, 1180, 1320, 1250])
    assert allocated == [Decimal("250.00"), Decimal("236.00"), Decimal("264.00"), Decimal("250.00")]
    assert sum(allocated) == Decimal("1000.00")


def test_width_boundary_classifies_supplier_form_deterministically():
    assert physical_form(49.9) == "REEL"
    assert physical_form(50) == "COIL"
    assert physical_form(150) == "COIL"
    assert physical_form(150.1) == "REEL"


def test_owner_cost_sheet_fixture_and_fixed_lot_basis():
    total, components = calculate_landed_cost(30, [
        {"component_type": "FREIGHT", "calculation_mode": "FIXED_PER_LOT", "entered_value": 4000, "reference_qty_kg": 10000},
        {"component_type": "HANDLING", "calculation_mode": "PER_KG", "entered_value": 0.20},
        {"component_type": "DISCOUNT", "calculation_mode": "PERCENT_BASE", "entered_value": 1},
    ])
    assert total == Decimal("30.300000")
    assert [row["normalized_per_kg"] for row in components] == ["0.400000", "0.200000", "0.300000"]


def test_mrp_target_moq_and_multiple_are_explainable():
    result = mrp_suggestion(opening_stock_kg=10000, demand_kg=99000, committed_supply_kg=44000,
        target_stock_kg=10000, minimum_order_kg=10000, order_multiple_kg=5000)
    assert result["net_need_kg"] == Decimal("55000.000")
    assert result["suggested_order_kg"] == Decimal("55000.000")
    assert result["overage_kg"] == Decimal("0.000")


def test_alert_policy_severity_and_recovery_boundaries():
    assert alert_severity(500, safety_stock_kg=500, reorder_point_kg=1000) == "CRITICAL"
    assert alert_severity(750, safety_stock_kg=500, reorder_point_kg=1000) == "WARNING"
    assert alert_severity(1001, safety_stock_kg=500, reorder_point_kg=1000) is None


def test_non_finite_and_zero_divisor_values_are_rejected():
    with pytest.raises(ProcurementRuleError):
        compare_rates(float("nan"), 30, 31)
    with pytest.raises(ProcurementRuleError):
        calculate_landed_cost(30, [{"component_type": "FREIGHT", "calculation_mode": "FIXED_PER_LOT", "entered_value": 1000, "reference_qty_kg": 0}])


async def _response_bytes(response):
    return b"".join([chunk async for chunk in response.body_iterator])


def test_register_exports_preserve_types_and_block_spreadsheet_formulas():
    rows = [{"po_no": "RP-PM/01", "qty_kg": Decimal("1250.500"), "date": date(2026, 9, 14), "note": "=WEBSERVICE(\"bad\")"}]
    csv_bytes = asyncio.run(_response_bytes(_csv_response("register.csv", rows)))
    assert b"'=WEBSERVICE" in csv_bytes

    xlsx_bytes = asyncio.run(_response_bytes(_xlsx_response("register.xlsx", rows)))
    workbook = load_workbook(BytesIO(xlsx_bytes), data_only=False)
    sheet = workbook["Register"]
    assert sheet.freeze_panes == "A2"
    assert sheet["B2"].value == 1250.5
    assert sheet["C2"].value.date() == date(2026, 9, 14)
    assert sheet["D2"].data_type != "f" and sheet["D2"].value.startswith("'=")


def test_saved_purchase_pdf_paginates_large_revision_and_keeps_pdf_contract():
    logical_ids = [uuid.uuid4() for _ in range(42)]
    lines = [SimpleNamespace(
        logical_line_id=logical_id,
        item_id=uuid.uuid4(),
        item=SimpleNamespace(item_code=f"PAPER-{index:03d}", name=f"Kraft board grade {index}"),
        specification_json={"description": f"Kraft board line {index}", "width_mm": 102, "gsm": 350 + index, "plybond": "350+"},
        qty_ordered=Decimal("50000"),
        uom="KG" if index % 2 else "PCS",
        unit_rate=Decimal("28.25"),
        expected_unit_count=40,
        count_basis="ESTIMATED",
    ) for index, logical_id in enumerate(logical_ids, start=1)]
    order = SimpleNamespace(po_no="RP-PM/99", category="RM_PM", supplier_name_snapshot="UPPM Paper Mill", created_at=date(2026, 9, 15))
    revision = SimpleNamespace(
        revision_no=2,
        approval_state="APPROVED",
        approved_by="checker@example.com",
        approved_at=date(2026, 9, 15),
        created_by="buyer@example.com",
        snapshot_json={"supplier_name": "UPPM Paper Mill", "category": "RM_PM", "expected_date": "2026-09-30",
            "metadata": {"po_date": "2026-09-15", "freight_terms": "Included", "tax_terms": "GST extra", "payment_terms": "60 days"},
            "lines": [{"logical_line_id": str(value)} for value in logical_ids]},
        lines=lines,
    )
    # Inspect actual uncompressed PDF text so mixed quantities cannot be
    # relabelled as kg or summed into a physically meaningless total.
    with patch("src.services.procurement_documents.SimpleDocTemplate",
               side_effect=lambda *args, **kwargs: SimpleDocTemplate(*args, **kwargs, pageCompression=0)):
        pdf = render_purchase_order_pdf(order, revision, [{
            "delivery_date": date(2026, 9, 25), "item_code": "PAPER-001",
            "planned_qty": Decimal("50000"), "received_qty": Decimal("12500"),
            "open_qty": Decimal("37500"), "vendor_confirmation": "CONFIRMED",
        }])
    pdf_text = b" ".join(re.findall(rb"\(([^()]*)\)\s*Tj", pdf))
    assert b"50,000.000 KG" in pdf_text and b"50,000.000 PCS" in pdf_text
    assert b"1,050,000.000 KG" in pdf_text and b"1,050,000.000 PCS" in pdf_text
    assert b"2,100,000.000" not in pdf
    page_count = pdf.count(b"/Type /Page") - pdf.count(b"/Type /Pages")
    assert pdf.startswith(b"%PDF-")
    assert page_count >= 2


@pytest.mark.parametrize("role", ["Owner", "Admin"])
def test_actual_cost_administrators_allowed(role):
    from src.utils.auth import require_cost_administrator
    user = {"actual_roles": [role], "roles": [role], "role": role}
    assert require_cost_administrator(user) is user


def test_cost_role_switch_cannot_manufacture_authority():
    from src.utils.auth import require_cost_administrator
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as caught:
        require_cost_administrator({"actual_roles": ["Store"], "roles": ["Owner"], "role": "Owner"})
    assert caught.value.status_code == 403


def test_saved_lot_pdf_uses_four_by_two_inch_pages_and_requested_copies():
    import re
    from src.services.procurement_documents import build_lot_label_pdf
    labels = [{"amigo_no": "AT-QA-1", "item_code": "RM-1", "item_name": "Paper", "source_reel_no": "MILL-001", "physical_form": "COIL", "inward_qty": 350, "width_mm": 100, "inward_date": "2026-09-15", "po_no": "RP-PM/03", "qr_value": "HARIOM|REEL|plant|lot|AT-QA-1"}]
    pdf = build_lot_label_pdf(labels, copies=2)
    assert pdf.startswith(b"%PDF")
    assert re.search(rb"/MediaBox\s*\[\s*0\s+0\s+288\s+144\s*\]", pdf)
    assert re.search(rb"/Count\s+2\b", pdf)


@pytest.mark.parametrize("paper", ["A3", "A4"])
def test_full_register_pdf_handles_column_sections_and_long_saved_fields(paper):
    from src.services.procurement_documents import build_register_pdf
    row = {"po_no": "RP-PM/01", "item_code": "RM-1", **{f"field_{n}": n for n in range(20)}, "terms": "Saved delivery terms <&> " * 1000}
    pdf = build_register_pdf("Purchase register", [row], paper)
    assert pdf.startswith(b"%PDF-")
    assert pdf.count(b"/Type /Page") - pdf.count(b"/Type /Pages") >= 3
    assert build_register_pdf("Empty register", [], paper).startswith(b"%PDF-")
