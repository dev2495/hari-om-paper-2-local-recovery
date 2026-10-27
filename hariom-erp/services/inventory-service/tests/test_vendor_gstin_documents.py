"""Vendor master GSTIN and basic details on the saved PO (client 2026-10-27).

The PO revision snapshots the vendor's GSTIN, PAN, state and contact; the PDF supplier block
prints them from the snapshot (never a live lookup), and the GRN payload carries the PO's GSTIN.
"""
import re
import uuid
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from reportlab.platypus import SimpleDocTemplate

from src.services.procurement_documents import render_purchase_order_pdf, supplier_block_lines


def _metadata(**extra):
    return {"po_date": "2026-10-27", "supplier_gst_no": "24ABCDE1234F1Z5", "supplier_pan_no": "ABCDE1234F",
            "supplier_state": "Gujarat", "supplier_state_code": "24", "supplier_address": "Plot 12, GIDC Estate, Vatva, Gujarat - 382445",
            "supplier_contact": "Ramesh Patel · +91 98250 12345", "supplier_phone": "+91 98250 12345", "supplier_email": "sales@shreekraft.in",
            "supplier_legal_name": "Shree Kraft Mills Private Limited", "supplier_msme_no": "UDYAM-GJ-01-0012345", **extra}


def test_supplier_block_prints_gstin_pan_state_and_contact_once():
    order = SimpleNamespace(supplier_name_snapshot="Shree Kraft Mills", category="RM_PM", current_revision_no=1)
    lines = supplier_block_lines({"supplier_name": "Shree Kraft Mills"}, _metadata(), order)
    assert lines["tax"] == "GSTIN 24ABCDE1234F1Z5 | PAN ABCDE1234F | MSME UDYAM-GJ-01-0012345"
    assert lines["name"] == "Shree Kraft Mills<br/>Shree Kraft Mills Private Limited"
    # The state is already in the address line, so it is not repeated; the phone is already in the contact.
    assert lines["address"] == "Plot 12, GIDC Estate, Vatva, Gujarat - 382445"
    assert lines["contact"] == "Ramesh Patel · +91 98250 12345 | sales@shreekraft.in"


def test_supplier_block_without_details_still_renders_and_escapes_text():
    order = SimpleNamespace(supplier_name_snapshot="A & B <Papers>", category="RM_PM", current_revision_no=1)
    lines = supplier_block_lines({}, {"supplier_address": "Unit <2> & 3"}, order)
    assert lines["name"] == "A &amp; B &lt;Papers&gt;"
    assert lines["tax"] == "GSTIN -"
    assert lines["address"] == "Unit &lt;2&gt; &amp; 3"
    assert lines["contact"] == "-"
    state_only = supplier_block_lines({}, {"supplier_state": "Maharashtra", "supplier_state_code": "27"}, order)
    assert state_only["address"] == "Maharashtra (27)"


def test_saved_po_pdf_carries_the_vendor_gstin():
    logical_id = uuid.uuid4()
    line = SimpleNamespace(logical_line_id=logical_id, item_id=uuid.uuid4(), item=SimpleNamespace(item_code="KRAFT-120", name="Kraft 120 GSM"),
                           specification_json={}, qty_ordered=Decimal("1000"), uom="KG", unit_rate=Decimal("42"), expected_unit_count=None, count_basis=None)
    order = SimpleNamespace(po_no="RP-PM/2627/0099", category="RM_PM", supplier_name_snapshot="Shree Kraft Mills", created_at=date(2026, 10, 27), current_revision_no=1)
    revision = SimpleNamespace(revision_no=1, approval_state="APPROVED", approved_by="owner@example.com", approved_at=date(2026, 10, 27), created_by="store@example.com",
                               snapshot_json={"supplier_name": "Shree Kraft Mills", "category": "RM_PM", "expected_date": "2026-11-05",
                                              "metadata": _metadata(), "lines": [{"logical_line_id": str(logical_id)}]},
                               lines=[line])
    with patch("src.services.procurement_documents.SimpleDocTemplate",
               side_effect=lambda *args, **kwargs: SimpleDocTemplate(*args, **kwargs, pageCompression=0)):
        pdf = render_purchase_order_pdf(order, revision)
    text = b" ".join(re.findall(rb"\(([^()]*)\)\s*Tj", pdf))
    assert b"24ABCDE1234F1Z5" in text
    assert b"ABCDE1234F" in text
    assert b"GSTIN / PAN" in text
