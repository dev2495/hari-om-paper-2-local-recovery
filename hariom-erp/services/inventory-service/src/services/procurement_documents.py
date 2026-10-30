"""Saved-record PDF documents for the governed procurement workflow."""
from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from html import escape
from io import BytesIO
from typing import Any, Iterable

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from .labels import scan_url


INK = colors.HexColor("#10212B")
MUTED = colors.HexColor("#607381")
TEAL = colors.HexColor("#0E6A77")
PALE = colors.HexColor("#EFF8F8")
LINE = colors.HexColor("#D8E2E7")
AMBER = colors.HexColor("#B75C10")


def _money(value: Any) -> str:
    amount = Decimal(str(value or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return f"INR {amount:,.2f}"


def _qty(value: Any, places: str = "0.001") -> str:
    quantity = Decimal(str(value or 0)).quantize(Decimal(places), rounding=ROUND_HALF_UP)
    return f"{quantity:,.3f}"


def _text(value: Any, fallback: str = "-") -> str:
    cleaned = str(value or "").strip()
    return escape(cleaned or fallback)


UNIT_WORDS = {"KG": "kg", "PCS": "pcs", "L": "litre", "MT": "t", "NOS": "nos"}


def _unit(uom: Any) -> str:
    raw = str(uom or "").strip()
    return UNIT_WORDS.get(raw.upper(), raw.lower())


def _qty_unit(value: Any, uom: Any) -> str:
    """Quantity in the line's own unit, en-IN grouping: "1,250.5 kg", "80 pcs" (pieces never get decimals)."""
    quantity = Decimal(str(value or 0))
    if str(uom or "").upper() == "PCS":
        text_value = f"{quantity.quantize(Decimal('1'), rounding=ROUND_HALF_UP):,}"
    else:
        text_value = f"{quantity.quantize(Decimal('0.001'), rounding=ROUND_HALF_UP):,.3f}".rstrip("0").rstrip(".")
    unit = _unit(uom)
    return escape(f"{text_value} {unit}".strip())


def _indian_date(value: Any) -> str:
    """"8 Nov 2026" for a date, a datetime (naive UTC from the server, shown as its IST day) or an
    ISO string; anything else as it is."""
    if isinstance(value, datetime):
        from zoneinfo import ZoneInfo
        stamp = value if value.tzinfo else value.replace(tzinfo=ZoneInfo("UTC"))
        value = stamp.astimezone(ZoneInfo("Asia/Kolkata")).date()
    if not isinstance(value, date):
        try:
            value = date.fromisoformat(str(value or "").strip()[:10])
        except ValueError:
            return str(value or "").strip()
    return f"{value.day} {value.strftime('%b %Y')}"


def _label_date(value: Any) -> str:
    """Indian date on a printed label (27 Oct 2026); saved label snapshots hold ISO dates."""
    if isinstance(value, (date, datetime)):
        return value.strftime("%d %b %Y")
    raw = str(value or "").strip()
    try:
        return date.fromisoformat(raw[:10]).strftime("%d %b %Y")
    except ValueError:
        return raw


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("ProcTitle", parent=base["Title"], fontName="Helvetica-Bold", fontSize=21,
            leading=24, textColor=INK, spaceAfter=2 * mm, alignment=TA_LEFT),
        "eyebrow": ParagraphStyle("ProcEyebrow", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=7.5,
            leading=9, textColor=TEAL, spaceAfter=1.5 * mm),
        "body": ParagraphStyle("ProcBody", parent=base["BodyText"], fontName="Helvetica", fontSize=8.2,
            leading=11, textColor=INK),
        "small": ParagraphStyle("ProcSmall", parent=base["BodyText"], fontName="Helvetica", fontSize=7,
            leading=9, textColor=MUTED),
        "small_right": ParagraphStyle("ProcSmallRight", parent=base["BodyText"], fontName="Helvetica", fontSize=7.2,
            leading=9, textColor=INK, alignment=TA_RIGHT),
        "table_head": ParagraphStyle("ProcTableHead", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=6.8,
            leading=8, textColor=colors.white),
        "table_head_right": ParagraphStyle("ProcTableHeadRight", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=6.8,
            leading=8, textColor=colors.white, alignment=TA_RIGHT),
        "section": ParagraphStyle("ProcSection", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=9,
            leading=11, textColor=INK, spaceBefore=3 * mm, spaceAfter=2 * mm),
    }


def _page_footer(canvas, doc, reference: str) -> None:
    canvas.saveState()
    width, _ = A4
    canvas.setStrokeColor(LINE)
    canvas.line(14 * mm, 12 * mm, width - 14 * mm, 12 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 6.8)
    canvas.drawString(14 * mm, 8 * mm, f"Saved procurement record - {reference}")
    canvas.drawRightString(width - 14 * mm, 8 * mm, f"Page {doc.page}")
    canvas.restoreState()


def _document(reference: str, title: str) -> tuple[BytesIO, SimpleDocTemplate, dict[str, ParagraphStyle]]:
    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=14 * mm,
        leftMargin=14 * mm,
        topMargin=14 * mm,
        bottomMargin=18 * mm,
        title=title,
        author="Hari Om Paper / Amigo Industries",
        subject=reference,
    )
    return buffer, document, _styles()


def _header(styles: dict[str, ParagraphStyle], *, company: str, title: str, reference: str, subtitle: str,
            buyer_lines: Iterable[str] = ()) -> list[Any]:
    left = [Paragraph(_text(company).upper(), styles["eyebrow"])]
    left.extend(Paragraph(line, styles["small"]) for line in buyer_lines if line)
    left.extend([Paragraph(_text(title), styles["title"]), Paragraph(_text(subtitle), styles["small"])])
    right = Paragraph(f"<b>{_text(reference)}</b>", styles["small_right"])
    table = Table([[left, right]], colWidths=[128 * mm, 50 * mm])
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5 * mm),
        ("LINEBELOW", (0, 0), (-1, -1), 0.8, TEAL),
    ]))
    return [table, Spacer(1, 4 * mm)]


def supplier_block_lines(snapshot: dict[str, Any], metadata: dict[str, Any], order: Any) -> dict[str, str]:
    """Supplier block text from what the revision saved (vendor master details snapshotted with the
    GSTIN, client 2026-10-27). Missing parts are left out; nothing is looked up live."""
    name = _text(snapshot.get("supplier_name") or getattr(order, "supplier_name_snapshot", None))
    legal = (metadata.get("supplier_legal_name") or "").strip()
    state = (metadata.get("supplier_state") or "").strip()
    code = (metadata.get("supplier_state_code") or "").strip()
    state_text = f"{state} ({code})" if state and code else state or (f"State code {code}" if code else "")
    tax = " | ".join(filter(None, [
        f"GSTIN {metadata['supplier_gst_no']}" if metadata.get("supplier_gst_no") else "GSTIN -",
        f"PAN {metadata['supplier_pan_no']}" if metadata.get("supplier_pan_no") else None,
        f"MSME {metadata['supplier_msme_no']}" if metadata.get("supplier_msme_no") else None,
    ]))
    address = ", ".join(filter(None, [(metadata.get("supplier_address") or "").strip(), state_text if state and state not in (metadata.get("supplier_address") or "") else ""]))
    if not address and state_text:
        address = state_text
    contact = " | ".join(filter(None, [metadata.get("supplier_contact"), metadata.get("supplier_phone") if metadata.get("supplier_phone") and str(metadata.get("supplier_phone")).split(" / ")[0] not in str(metadata.get("supplier_contact") or "") else None, metadata.get("supplier_email")]))
    return {
        "name": f"{name}<br/>{escape(legal)}" if legal and escape(legal) != name else name,
        "tax": escape(tax),
        "address": escape(address or "-"),
        "contact": escape(contact or "-"),
    }


def supplier_block_rows(snapshot: dict[str, Any], metadata: dict[str, Any], order: Any, styles: dict[str, ParagraphStyle], po_date: Any, revision_no: Any = None) -> list[list[Any]]:
    lines = supplier_block_lines(snapshot, metadata, order)
    return [
        [Paragraph("<b>Supplier</b>", styles["small"]), Paragraph(lines["name"], styles["body"]),
         Paragraph("<b>PO date</b>", styles["small"]), Paragraph(_text(_indian_date(po_date)), styles["body"])],
        [Paragraph("<b>GSTIN / PAN</b>", styles["small"]), Paragraph(lines["tax"], styles["body"]),
         Paragraph("<b>Expected</b>", styles["small"]), Paragraph(_text(_indian_date(snapshot.get("expected_date")) if snapshot.get("expected_date") else "As agreed"), styles["body"])],
        [Paragraph("<b>Address</b>", styles["small"]), Paragraph(lines["address"], styles["body"]),
         Paragraph("<b>Category</b>", styles["small"]), Paragraph(_text(snapshot.get("category", order.category)).replace("_", "/"), styles["body"])],
        [Paragraph("<b>Contact</b>", styles["small"]), Paragraph(lines["contact"], styles["body"]),
         Paragraph("<b>Revision</b>", styles["small"]), Paragraph(_text(revision_no or getattr(order, "current_revision_no", None)), styles["body"])],
    ]


def _delivery_terms(value: Any) -> Any:
    """Scheduled drafts made before 28 Oct 2026 say "the dated schedule below", but the delivery
    dates print above the terms; say where they really are."""
    if isinstance(value, str) and "dated schedule below" in value:
        return "Delivery on the dates in the delivery schedule above."
    return value


def person_name(actor: Any, names: dict[str, str] | None = None) -> str:
    """A signatory by name, never by login (checker r4: "owner2.e2e@hariom.com" printed on the PO).

    ``names`` is the people directory (login -> display name). An unknown login prints its part
    before the @, title-cased ("store.maker" -> "Store Maker"); a value that is already a name stays."""
    text = str(actor or "").strip()
    if not text:
        return ""
    lookup = {str(key).strip().lower(): value for key, value in (names or {}).items() if value}
    key = text.lower()
    known = lookup.get(key) or (lookup.get(key.split("@")[0]) if "@" in key else None)
    if not known and "@" not in key:
        locals_ = {login.split("@")[0]: value for login, value in lookup.items()}
        known = locals_.get(key)
    if known:
        return str(known).strip()
    if "@" not in text and text != text.lower():
        return text
    local = text.split("@")[0]
    return " ".join(part[:1].upper() + part[1:] for part in local.replace("_", ".").replace("-", ".").split(".") if part) or text


def _total_amount_text(total: Decimal, priced_lines: int, missing_lines: int) -> str:
    """The Total cell never reads INR 0.00 on a PO whose rates are still to fill (checker r1):
    no priced line prints "Rate needed"; some print their sum plus how many lines still need one."""
    if not missing_lines:
        return f"<b>{_money(total)}</b>"
    if not priced_lines:
        return "<b>Rate needed</b>"
    word = "line" if missing_lines == 1 else "lines"
    return f"<b>{_money(total)}</b><br/>plus {missing_lines} {word} with rate needed"


def _schedule_material(row: dict[str, Any]) -> str:
    """"230 - Kraft 230 GSM" in the delivery table, as in the materials table (never a bare code)."""
    code, name = row.get("item_code"), row.get("item_name")
    if name and str(name).strip() and str(name).strip() != str(code or "").strip():
        return f"<b>{_text(code)}</b> - {_text(name)}" if code else _text(name)
    return _text(code)


def buyer_block_lines(plant: dict[str, Any] | None) -> list[str]:
    """Bill-to / ship-to lines under the buyer's name, from the plant master (address, GSTIN), so the
    vendor has what to invoice against (checker 2026-10-30). Missing parts are left out."""
    plant = dict(plant or {})
    address = str(plant.get("address") or "").strip()
    gstin = re.sub(r"\s+", "", str(plant.get("gstin") or "")).upper()
    lines: list[str] = []
    if address:
        lines.append(f"<b>Bill to and ship to:</b> {_text(address)}")
    if gstin:
        lines.append(f"<b>GSTIN</b> {_text(gstin)}")
    return lines


def render_purchase_order_pdf(order: Any, revision: Any, delivery_schedules: Iterable[dict[str, Any]] = (),
                              names: dict[str, str] | None = None, buyer: dict[str, Any] | None = None) -> bytes:
    """Render one immutable PO revision as an A4, multi-page PDF.

    A line with no rate yet (a scheduled draft, "rate needed") prints "Rate needed", never INR 0.00."""
    snapshot = dict(revision.snapshot_json or {})
    metadata = dict(snapshot.get("metadata") or {})
    reference = f"{order.po_no} | Revision {revision.revision_no}"
    buffer, document, styles = _document(reference, f"Purchase Order {reference}")
    plant = dict(buyer or {})
    company = metadata.get("legal_entity_name") or plant.get("legal_name") or plant.get("name") or "Amigo Industries Unit-2"
    story: list[Any] = _header(
        styles,
        company=company,
        title="Purchase Order",
        reference=reference,
        subtitle=f"{'Approved' if revision.approval_state == 'APPROVED' else str(revision.approval_state or '').title()} · revision {revision.revision_no}",
        buyer_lines=buyer_block_lines(plant),
    )
    po_date = metadata.get("po_date") or getattr(order, "created_at", "")
    details = Table(supplier_block_rows(snapshot, metadata, order, styles, po_date, revision.revision_no), colWidths=[25 * mm, 78 * mm, 22 * mm, 53 * mm])
    details.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.35, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (0, -1), PALE), ("BACKGROUND", (2, 0), (2, -1), PALE),
        ("LEFTPADDING", (0, 0), (-1, -1), 2 * mm), ("RIGHTPADDING", (0, 0), (-1, -1), 2 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
    ]))
    approved = revision.approval_state == "APPROVED"
    story.extend([details, Spacer(1, 4 * mm), Paragraph("Materials and approved rates" if approved else "Materials and rates", styles["section"])])

    line_rows: list[list[Any]] = [[
        Paragraph("#", styles["table_head"]), Paragraph("Material", styles["table_head"]),
        Paragraph("Ordered quantity", styles["table_head_right"]),
        Paragraph("Rate / unit", styles["table_head_right"]), Paragraph("Amount", styles["table_head_right"]),
    ]]
    total_qty_by_uom: dict[str, Decimal] = {}
    total_amount = Decimal("0")
    priced_lines = missing_lines = 0
    snapshot_order = {str(row.get("logical_line_id")): index for index, row in enumerate(snapshot.get("lines") or [])}
    ordered_lines = sorted(revision.lines or [], key=lambda value: snapshot_order.get(str(value.logical_line_id), 10**9))
    for index, line in enumerate(ordered_lines, start=1):
        spec = dict(line.specification_json or {})
        item_code = getattr(getattr(line, "item", None), "item_code", None)
        item_name = getattr(getattr(line, "item", None), "name", None)
        description = spec.get("description") or item_name or str(line.item_id)
        # Only the ordered quantity is printed (client 2026-10-26): no expected reel count and no
        # quality specification; incoming QC checks the material standard at inward.
        material = f"<b>{_text(item_code)}</b> - {_text(description)}"
        qty = Decimal(line.qty_ordered)
        rate = Decimal(line.unit_rate)
        amount = (qty * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        uom = str(getattr(line, "uom", None) or "KG")
        total_qty_by_uom[uom] = total_qty_by_uom.get(uom, Decimal("0")) + qty
        total_amount += amount
        needed = rate <= 0
        missing_lines += 1 if needed else 0
        priced_lines += 0 if needed else 1
        line_rows.append([
            Paragraph(str(index), styles["body"]), Paragraph(material, styles["body"]),
            Paragraph(_qty_unit(qty, uom), styles["small_right"]),
            Paragraph("<b>Rate needed</b>" if needed else f"{_money(rate)} / {escape(_unit(uom) or 'unit')}", styles["small_right"]),
            Paragraph("-" if needed else _money(amount), styles["small_right"]),
        ])
    line_rows.append([
        "", Paragraph("<b>Total</b>", styles["body"]), Paragraph("<br/>".join(f"<b>{_qty_unit(qty, unit)}</b>" for unit, qty in total_qty_by_uom.items()), styles["small_right"]),
        "", Paragraph(_total_amount_text(total_amount, priced_lines, missing_lines), styles["small_right"]),
    ])
    lines = Table(line_rows, repeatRows=1, colWidths=[8 * mm, 99 * mm, 25 * mm, 24 * mm, 28 * mm])
    lines.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TEAL), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -2), 0.3, LINE), ("LINEABOVE", (0, -1), (-1, -1), 0.8, TEAL),
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 1.5 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 1.5 * mm), ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
    ]))
    story.append(lines)

    schedule_rows = list(delivery_schedules)
    if schedule_rows:
        # Quantities are in each line's own unit (kg, pcs, litre); dates print Indian style.
        schedule_data: list[list[Any]] = [[Paragraph(value, styles["table_head"]) for value in
            ("Delivery date", "Material", "Quantity", "Received", "Cancelled", "Still to come", "Confirmation")]]
        for row in schedule_rows:
            unit = row.get("uom")
            schedule_data.append([
                Paragraph(_text(_indian_date(row.get("delivery_date"))), styles["body"]),
                Paragraph(_schedule_material(row), styles["body"]),
                Paragraph(_qty_unit(row.get("planned_qty"), unit), styles["small_right"]),
                Paragraph(_qty_unit(row.get("received_qty"), unit), styles["small_right"]),
                Paragraph(_qty_unit(row.get("cancelled_qty"), unit), styles["small_right"]),
                Paragraph(_qty_unit(row.get("open_qty"), unit), styles["small_right"]),
                Paragraph(_text(row.get("confirmation") or row.get("vendor_confirmation")), styles["body"]),
            ])
        schedule_table = Table(schedule_data, repeatRows=1,
            colWidths=[22 * mm, 50 * mm, 22 * mm, 22 * mm, 20 * mm, 22 * mm, 26 * mm])
        schedule_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), TEAL), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.3, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 1.5 * mm), ("RIGHTPADDING", (0, 0), (-1, -1), 1.5 * mm),
            ("TOPPADDING", (0, 0), (-1, -1), 1.8 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.8 * mm),
        ]))
        story.extend([Paragraph("Delivery dates", styles["section"]), schedule_table])

    terms = [
        ("Freight", metadata.get("freight_terms")), ("Tax", metadata.get("tax_terms")),
        ("Payment", metadata.get("payment_terms")), ("Delivery", _delivery_terms(metadata.get("delivery_terms"))),
        ("Test report", metadata.get("test_report_terms")), ("Special instruction", metadata.get("special_instruction")),
    ]
    term_rows = [[Paragraph(f"<b>{_text(label)}</b>", styles["small"]), Paragraph(_text(value), styles["body"])] for label, value in terms]
    terms_table = Table(term_rows, colWidths=[30 * mm, 148 * mm])
    terms_table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.3, LINE), ("BACKGROUND", (0, 0), (0, -1), PALE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 2 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2 * mm), ("TOPPADDING", (0, 0), (-1, -1), 1.7 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.7 * mm),
    ]))
    approval = (f"Approved by {_text(person_name(revision.approved_by, names))} on {_text(_indian_date(revision.approved_at))}"
                if revision.approved_by else "Approval pending")
    signatures = Table([
        [Paragraph("Prepared / checked by", styles["small"]), Paragraph(f"For {_text(company)}", styles["small_right"])],
        [Paragraph(_text(person_name(revision.created_by, names)), styles["body"]), Paragraph(approval, styles["small_right"])],
    ], colWidths=[89 * mm, 89 * mm])
    signatures.setStyle(TableStyle([
        ("LINEABOVE", (0, 0), (-1, 0), 0.6, MUTED), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 2 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 1 * mm),
    ]))
    story.extend([Paragraph("Commercial terms", styles["section"]), terms_table, Spacer(1, 11 * mm), KeepTogether([signatures])])
    document.build(story, onFirstPage=lambda canvas, doc: _page_footer(canvas, doc, reference),
                   onLaterPages=lambda canvas, doc: _page_footer(canvas, doc, reference))
    return buffer.getvalue()


def render_debit_note_pdf(note: Any, discrepancy_rows: Iterable[dict[str, Any]]) -> bytes:
    """Render a saved commercial claim. Issued/settled records remain immutable."""
    reference = note.debit_note_no
    buffer, document, styles = _document(reference, f"Purchase Debit Note {reference}")
    story: list[Any] = _header(
        styles,
        company="Amigo Industries Unit-2",
        title="Commercial Purchase Debit Note",
        reference=reference,
        subtitle=f"{note.status} purchase invoice difference claim",
    )
    meta = Table([
        [Paragraph("<b>Supplier</b>", styles["small"]), Paragraph(_text(note.supplier_name_snapshot), styles["body"]),
         Paragraph("<b>Date</b>", styles["small"]), Paragraph(_text(note.note_date), styles["body"])],
        [Paragraph("<b>Status</b>", styles["small"]), Paragraph(_text(note.status), styles["body"]),
         Paragraph("<b>Prepared by</b>", styles["small"]), Paragraph(_text(note.created_by), styles["body"])],
        [Paragraph("<b>Reason</b>", styles["small"]), Paragraph(_text(note.reason), styles["body"]),
         Paragraph("<b>Approved by</b>", styles["small"]), Paragraph(_text(note.approved_by), styles["body"])],
    ], colWidths=[22 * mm, 80 * mm, 24 * mm, 52 * mm])
    meta.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.35, LINE), ("BACKGROUND", (0, 0), (0, -1), PALE),
        ("BACKGROUND", (2, 0), (2, -1), PALE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2 * mm), ("RIGHTPADDING", (0, 0), (-1, -1), 2 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
    ]))
    story.extend([meta, Spacer(1, 4 * mm), Paragraph("Claim lines", styles["section"])])
    rows: list[list[Any]] = [[Paragraph(value, styles["table_head"]) for value in
        ("Invoice / PO", "Material", "Qty kg", "PO rate", "Invoice rate", "Claim")]]
    for row in discrepancy_rows:
        rows.append([
            Paragraph(f"<b>{_text(row.get('invoice_no'))}</b><br/>{_text(row.get('po_no'))} R{_text(row.get('revision_no'))}<br/>{_text(row.get('grn_no'))}", styles["body"]),
            Paragraph(f"<b>{_text(row.get('item_code'))}</b><br/>{_text(row.get('item_name'))}", styles["body"]),
            Paragraph(_qty(row.get("quantity_kg")), styles["small_right"]),
            Paragraph(_money(row.get("po_rate")), styles["small_right"]),
            Paragraph(_money(row.get("invoice_rate")), styles["small_right"]),
            Paragraph(_money(row.get("claimable_amount")), styles["small_right"]),
        ])
    rows.append(["", Paragraph("<b>Total claim</b>", styles["body"]), "", "", "",
                 Paragraph(f"<b>{_money(note.total_amount)}</b>", styles["small_right"])])
    claim_table = Table(rows, repeatRows=1, colWidths=[42 * mm, 50 * mm, 21 * mm, 23 * mm, 23 * mm, 25 * mm])
    claim_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), AMBER), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -2), 0.3, LINE), ("LINEABOVE", (0, -1), (-1, -1), 0.8, AMBER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 1.5 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 1.5 * mm), ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
    ]))
    story.extend([claim_table, Spacer(1, 6 * mm), Paragraph(
        f"Settled: <b>{_money(note.settled_amount)}</b> &nbsp;&nbsp; Open: <b>{_money(Decimal(note.total_amount) - Decimal(note.settled_amount))}</b>",
        styles["body"],
    ), Spacer(1, 15 * mm)])
    signatures = Table([[Paragraph("Prepared by", styles["small"]), Paragraph("Authorized signatory", styles["small_right"])],
                        [Paragraph(_text(note.created_by), styles["body"]), Paragraph(_text(note.approved_by), styles["small_right"])]],
                       colWidths=[89 * mm, 89 * mm])
    signatures.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, 0), 0.6, MUTED), ("TOPPADDING", (0, 0), (-1, -1), 2 * mm)]))
    story.append(signatures)
    document.build(story, onFirstPage=lambda canvas, doc: _page_footer(canvas, doc, reference),
                   onLaterPages=lambda canvas, doc: _page_footer(canvas, doc, reference))
    return buffer.getvalue()


def build_lot_label_pdf(labels: list[dict[str, Any]], copies: int = 1, profile: str = "PAPER_LOT_4X2") -> bytes:
    """Saved physical identities on thermal stock or the client's 2 x 4 A4 sheet."""
    from reportlab.pdfgen import canvas
    from reportlab.pdfbase.pdfmetrics import stringWidth
    from reportlab.graphics import renderPDF
    from reportlab.graphics.shapes import Drawing
    from reportlab.graphics.barcode.qr import QrCodeWidget
    output = BytesIO()
    thermal = profile == "PAPER_LOT_4X2"
    page_size = (101.6 * mm, 50.8 * mm) if thermal else A4
    pdf = canvas.Canvas(output, pagesize=page_size)
    pdf.setTitle("Material reel and coil labels")
    all_labels = [label for label in labels for _ in range(copies)]
    per_page = 1 if thermal else 8
    for index, label in enumerate(all_labels):
        slot = index % per_page
        w, h = (101.6 * mm, 50.8 * mm) if thermal else (94 * mm, 65 * mm)
        x = 0 if thermal else (10 + (slot % 2) * 98) * mm
        y = 0 if thermal else page_size[1] - (13 + (slot // 2 + 1) * 65 + (slot // 2) * 3) * mm
        pdf.saveState(); pdf.translate(x, y)
        pdf.setLineWidth(.6); pdf.rect(1 * mm, 1 * mm, w - 2 * mm, h - 2 * mm)
        def text(value, xx, yy, max_width, size=9, bold=False):
            value = str(value if value is not None and value != "" else "-")
            font = "Helvetica-Bold" if bold else "Helvetica"
            length = stringWidth(value, font, size)
            actual = min(size, size * max_width / length) if length else size
            pdf.setFont(font, actual); pdf.drawString(xx, yy, value)
        meta = label.get("metadata") or {}
        is_batch = label.get("entity_type") == "BATCH"
        left, top = 3 * mm, h - 5 * mm
        text(meta.get("legal_entity") or "AMIGO INDUSTRIES", left, top, w - 6 * mm, 10, True)
        text(label.get("supplier_name"), left, top - 5 * mm, w * .56, 8)
        text(_label_date(label.get("inward_date")), w * .64, top - 5 * mm, w * .32, 8)
        grn = label.get("grn_no") or meta.get("grn_no")
        text(f"Bill: {label.get('bill_no') or meta.get('invoice_no') or '-'}" + (f"   GRN: {grn}" if grn else ""), left, top - 9 * mm, w - 6 * mm, 8)
        text((label.get("item_name") or label.get("item_code")) if is_batch else f"PLYBOND {label.get('ply_bond') or '-'}   VARIETY {label.get('variety') or label.get('item_code') or '-'}   GSM {label.get('gsm') or '-'}", left, top - 14 * mm, w - 6 * mm, 8, True)
        text(f"BATCH {label.get('batch_no') or '-'}" if is_batch else f"ROLL NO. {label.get('source_reel_no') or '-'}", left, top - 19 * mm, w - 6 * mm, 9, True)
        text(label.get("amigo_no") or label.get("code"), left, top - 28 * mm, w - 25 * mm, 23, True)
        text(f"{label.get('inward_qty', label.get('qty', 0))} {label.get('uom') or 'KG'}", left, top - 37 * mm, w - 26 * mm, 22, True)
        text("BATCH | " + str(label.get("item_code") or "") if is_batch else f"{label.get('physical_form') or 'REEL'} | {label.get('width_mm') or '-'} mm", left, 3 * mm, w - 6 * mm, 8)
        if not thermal:
            text(f"PO {label.get('po_no') or 'Manual inward'}" + (f"   GRN {label.get('grn_no')}" if label.get("grn_no") else ""), left, 8 * mm, w - 26 * mm, 8)
            # No stock status on paper: the saved one is from receipt and goes stale once QC acts.
            # The QR opens the lot's live state (client 2026-10-27).
            text("QC status: scan the QR", left, 13 * mm, w - 26 * mm, 8)
        # Worked out at print time (never from a saved snapshot), so reprints of old lots get the link too.
        qr = QrCodeWidget(scan_url(label["qr_value"]) or label["qr_value"])
        bounds = qr.getBounds(); size = 22 * mm
        drawing = Drawing(size, size, transform=[size/(bounds[2]-bounds[0]),0,0,size/(bounds[3]-bounds[1]),0,0]); drawing.add(qr)
        renderPDF.draw(drawing, pdf, w - size - 2 * mm, 7 * mm)
        pdf.restoreState()
        if slot == per_page - 1 or index == len(all_labels) - 1:
            pdf.showPage()
    pdf.save()
    return output.getvalue()


def build_register_pdf(title: str, rows: list[dict[str, Any]], paper: str = "A3") -> bytes:
    """Print every field in readable column sections, repeating document identity."""
    import json
    from reportlab.lib.pagesizes import A3, landscape
    from reportlab.platypus import PageBreak
    output = BytesIO(); size = landscape(A3 if paper == "A3" else A4)
    document = SimpleDocTemplate(output, pagesize=size, rightMargin=8*mm, leftMargin=8*mm, topMargin=10*mm, bottomMargin=10*mm, title=title)
    columns = list(dict.fromkeys(key for row in rows for key in row))
    identities = [key for key in ("po_no", "grn_no", "at_no", "debit_note_no", "plan", "item_code", "id") if key in columns][:2]
    other = [key for key in columns if key not in identities]
    step = 7 if paper == "A3" else 5
    groups = [identities + other[index:index+step] for index in range(0, len(other), step)] or [identities]
    styles = getSampleStyleSheet(); cell_style = ParagraphStyle("RegisterCell", fontName="Helvetica", fontSize=7, leading=9, wordWrap="CJK")
    story = []
    for index, group in enumerate(groups):
        if index: story.append(PageBreak())
        story.extend([Paragraph(_text(title), styles["Heading1"]), Paragraph(f"{len(rows)} source rows | Columns {index + 1} of {len(groups)} | Document identities repeat across sections", styles["Normal"]), Spacer(1, 5*mm)])
        if not rows:
            story.append(Paragraph("No saved rows in this plant.", styles["Normal"])); continue
        def value(raw):
            text = json.dumps(raw, ensure_ascii=False, default=str) if isinstance(raw, (dict, list)) else str(raw) if raw is not None else "-"
            return Paragraph(escape(text), cell_style)
        data = [[value(column.replace("_", " ").upper()) for column in group]] + [[value(row.get(column)) for column in group] for row in rows]
        table = Table(data, colWidths=[(size[0]-16*mm)/len(group)]*len(group), repeatRows=1, splitByRow=1, splitInRow=1)
        table.setStyle(TableStyle([("BACKGROUND", (0,0), (-1,0), PALE), ("GRID", (0,0), (-1,-1), .3, LINE), ("VALIGN", (0,0), (-1,-1), "TOP"), ("LEFTPADDING", (0,0), (-1,-1), 5), ("RIGHTPADDING", (0,0), (-1,-1), 5), ("TOPPADDING", (0,0), (-1,-1), 5), ("BOTTOMPADDING", (0,0), (-1,-1), 5)]))
        story.append(table)
    def footer(pdf, doc):
        pdf.setFont("Helvetica", 7); pdf.drawRightString(size[0]-8*mm, 5*mm, f"{title} | Page {doc.page}")
    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return output.getvalue()
