"""PO PDF signatories by name and "Rate needed" lines (checker r4, client 2026-10-30)."""
import re
import uuid
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from reportlab.platypus import SimpleDocTemplate

from src.services.procurement_documents import person_name, render_purchase_order_pdf

NAMES = {"owner2.e2e@hariom.com": "Owner Two E2E", "store@hariom.com": "Store Desk"}


def test_signatory_is_the_directory_name_never_the_login():
    assert person_name("owner2.e2e@hariom.com", NAMES) == "Owner Two E2E"
    assert person_name("OWNER2.E2E@hariom.com", NAMES) == "Owner Two E2E"
    assert person_name("owner2.e2e", NAMES) == "Owner Two E2E"
    # Not in the directory: the login's local part, title-cased; a name stays a name.
    assert person_name("store.maker@hariom.com", {}) == "Store Maker"
    assert person_name("Ramesh Patel", {}) == "Ramesh Patel"
    assert person_name(None, NAMES) == ""


def _pdf(rate, state="SUBMITTED", approved_by=None, buyer=None):
    logical_id = uuid.uuid4()
    line = SimpleNamespace(logical_line_id=logical_id, item_id=uuid.uuid4(), item=SimpleNamespace(item_code="R-150", name="Box R-150"),
                           specification_json={}, qty_ordered=Decimal("40"), uom="PCS", unit_rate=Decimal(str(rate)), expected_unit_count=None, count_basis=None)
    order = SimpleNamespace(po_no="RP-PM/29", category="RM_PM", supplier_name_snapshot="Box Mart", created_at=date(2026, 10, 29), current_revision_no=1)
    revision = SimpleNamespace(revision_no=1, approval_state=state, approved_by=approved_by, approved_at=date(2026, 10, 29),
                               created_by="owner2.e2e@hariom.com",
                               snapshot_json={"supplier_name": "Box Mart", "category": "RM_PM", "metadata": {"po_date": "2026-10-29"},
                                              "lines": [{"logical_line_id": str(logical_id)}]}, lines=[line])
    with patch("src.services.procurement_documents.SimpleDocTemplate",
               side_effect=lambda *args, **kwargs: SimpleDocTemplate(*args, **kwargs, pageCompression=0)):
        pdf = render_purchase_order_pdf(order, revision, names=NAMES, buyer=buyer)
    return b" ".join(re.findall(rb"\(([^()]*)\)\s*Tj", pdf))


def test_a_draft_line_without_a_rate_prints_rate_needed_not_zero():
    text = _pdf(0)
    assert b"Rate needed" in text
    # Every rate still to fill: the Total says so too, never a zero-value PO (checker r1).
    assert b"INR 0.00" not in text
    assert b"Materials and rates" in text and b"approved rates" not in text
    assert b"Owner Two E2E" in text and b"owner2.e2e@hariom.com" not in text


def test_an_approved_po_prints_the_approver_by_name():
    text = _pdf(42, state="APPROVED", approved_by="owner2.e2e@hariom.com")
    assert b"Approved by Owner Two E2E" in text and b"owner2.e2e@hariom.com" not in text
    assert b"INR 42.00" in text and b"Rate needed" not in text


def _pdf_lines(rates, schedules=()):
    lines, logical = [], []
    for index, rate in enumerate(rates):
        logical_id = uuid.uuid4()
        logical.append({"logical_line_id": str(logical_id)})
        lines.append(SimpleNamespace(logical_line_id=logical_id, item_id=uuid.uuid4(),
                                     item=SimpleNamespace(item_code=f"23{index}", name=f"Kraft 23{index} GSM"), specification_json={},
                                     qty_ordered=Decimal("10"), uom="KG", unit_rate=Decimal(str(rate)), expected_unit_count=None, count_basis=None))
    order = SimpleNamespace(po_no="RP-PM/31", category="RM_PM", supplier_name_snapshot="Shree Kraft", created_at=date(2026, 10, 29), current_revision_no=1)
    revision = SimpleNamespace(revision_no=1, approval_state="SUBMITTED", approved_by=None, approved_at=None, created_by="owner2.e2e@hariom.com",
                               snapshot_json={"supplier_name": "Shree Kraft", "metadata": {"po_date": "2026-10-29"}, "lines": logical}, lines=lines)
    with patch("src.services.procurement_documents.SimpleDocTemplate",
               side_effect=lambda *args, **kwargs: SimpleDocTemplate(*args, **kwargs, pageCompression=0)):
        pdf = render_purchase_order_pdf(order, revision, schedules, names=NAMES)
    return b" ".join(re.findall(rb"\(([^()]*)\)\s*Tj", pdf))


def test_a_part_priced_po_totals_the_priced_lines_and_counts_the_rest():
    text = _pdf_lines([42, 0, 0])
    assert b"INR 420.00" in text and b"plus 2 lines with rate needed" in text
    assert b"INR 0.00" not in text


def test_the_delivery_table_names_each_material_not_just_its_code():
    schedules = [{"delivery_date": date(2026, 11, 3), "item_code": "230", "item_name": "Kraft 230 GSM", "uom": "KG",
                  "planned_qty": Decimal("10"), "received_qty": Decimal("0"), "cancelled_qty": Decimal("0"),
                  "open_qty": Decimal("10"), "confirmation": "To confirm"}]
    text = _pdf_lines([42], schedules)
    assert text.count(b"Kraft 230 GSM") >= 2  # materials table and delivery table


def test_rate_prints_its_unit_and_the_buyer_block_comes_from_the_plant_master():
    """Checker 2026-10-30: 'INR 42.00 / pcs' like the web PO, the plant's address and GSTIN under the
    buyer name, and plain subtitle words instead of 'Saved approved commercial revision'."""
    plant = {"name": "Plant A", "legal_name": "Amigo Industries Unit-2", "address": "Plot 12, GIDC Vatva, Ahmedabad", "gstin": "24abcde1234f1z5"}
    text = _pdf(42, state="APPROVED", approved_by="owner2.e2e@hariom.com", buyer=plant)
    assert b"INR 42.00 / pcs" in text
    assert b"Plot 12, GIDC Vatva, Ahmedabad" in text and b"24ABCDE1234F1Z5" in text
    assert b"revision 1" in text and b"commercial revision" not in text
    # No plant master row: the PDF still prints, with no empty buyer lines.
    assert b"Bill to" not in _pdf(42)
