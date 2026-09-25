"""Saved-record PDF documents for the governed procurement workflow."""
from __future__ import annotations

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


def _header(styles: dict[str, ParagraphStyle], *, company: str, title: str, reference: str, subtitle: str) -> list[Any]:
    left = [Paragraph(_text(company).upper(), styles["eyebrow"]), Paragraph(_text(title), styles["title"]),
            Paragraph(_text(subtitle), styles["small"])]
    right = Paragraph(f"<b>{_text(reference)}</b>", styles["small_right"])
    table = Table([[left, right]], colWidths=[128 * mm, 50 * mm])
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5 * mm),
        ("LINEBELOW", (0, 0), (-1, -1), 0.8, TEAL),
    ]))
    return [table, Spacer(1, 4 * mm)]


def render_purchase_order_pdf(order: Any, revision: Any, delivery_schedules: Iterable[dict[str, Any]] = ()) -> bytes:
    """Render one immutable PO revision as an A4, multi-page PDF."""
    snapshot = dict(revision.snapshot_json or {})
    metadata = dict(snapshot.get("metadata") or {})
    reference = f"{order.po_no} | Revision {revision.revision_no}"
    buffer, document, styles = _document(reference, f"Purchase Order {reference}")
    company = metadata.get("legal_entity_name") or "Amigo Industries Unit-2"
    story: list[Any] = _header(
        styles,
        company=company,
        title="Purchase Order",
        reference=reference,
        subtitle="Saved approved commercial revision" if revision.approval_state == "APPROVED" else f"{revision.approval_state.title()} revision",
    )
    po_date = metadata.get("po_date") or getattr(order, "created_at", "")
    details = Table([
        [Paragraph("<b>Supplier</b>", styles["small"]), Paragraph(_text(snapshot.get("supplier_name") or order.supplier_name_snapshot), styles["body"]),
         Paragraph("<b>PO date</b>", styles["small"]), Paragraph(_text(po_date), styles["body"])],
        [Paragraph("<b>Supplier GST</b>", styles["small"]), Paragraph(_text(metadata.get("supplier_gst_no")), styles["body"]),
         Paragraph("<b>Expected</b>", styles["small"]), Paragraph(_text(snapshot.get("expected_date")), styles["body"])],
        [Paragraph("<b>Contact / address</b>", styles["small"]), Paragraph(_text(" | ".join(filter(None, [metadata.get("supplier_contact"), metadata.get("supplier_address")]))), styles["body"]),
         Paragraph("<b>Category</b>", styles["small"]), Paragraph(_text(snapshot.get("category", order.category)).replace("_", "/"), styles["body"])],
    ], colWidths=[25 * mm, 78 * mm, 22 * mm, 53 * mm])
    details.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.35, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (0, -1), PALE), ("BACKGROUND", (2, 0), (2, -1), PALE),
        ("LEFTPADDING", (0, 0), (-1, -1), 2 * mm), ("RIGHTPADDING", (0, 0), (-1, -1), 2 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
    ]))
    story.extend([details, Spacer(1, 4 * mm), Paragraph("Materials and approved rates", styles["section"])])

    line_rows: list[list[Any]] = [[
        Paragraph("#", styles["table_head"]), Paragraph("Material / specification", styles["table_head"]),
        Paragraph("Quantity", styles["table_head_right"]), Paragraph("Units", styles["table_head_right"]),
        Paragraph("Rate / unit", styles["table_head_right"]), Paragraph("Amount", styles["table_head_right"]),
    ]]
    total_qty_by_uom: dict[str, Decimal] = {}
    total_amount = Decimal("0")
    snapshot_order = {str(row.get("logical_line_id")): index for index, row in enumerate(snapshot.get("lines") or [])}
    ordered_lines = sorted(revision.lines or [], key=lambda value: snapshot_order.get(str(value.logical_line_id), 10**9))
    for index, line in enumerate(ordered_lines, start=1):
        spec = dict(line.specification_json or {})
        item_code = getattr(getattr(line, "item", None), "item_code", None)
        item_name = getattr(getattr(line, "item", None), "name", None)
        description = spec.get("description") or item_name or str(line.item_id)
        specification = " | ".join(filter(None, [
            f"Width {spec.get('width_mm')} mm" if spec.get("width_mm") not in (None, "") else None,
            f"Tolerance +/- {spec.get('width_tolerance_mm')} mm" if spec.get("width_tolerance_mm") not in (None, "") else None,
            f"GSM {spec.get('gsm')}" if spec.get("gsm") not in (None, "") else None,
            f"PB {spec.get('plybond')}" if spec.get("plybond") not in (None, "") else None,
            f"Bulk {spec.get('bulk')}" if spec.get("bulk") not in (None, "") else None,
            str(spec.get("cobb")) if spec.get("cobb") else None,
        ]))
        material = f"<b>{_text(item_code)}</b> - {_text(description)}"
        if specification:
            material += f"<br/><font color='#607381' size='6.5'>{_text(specification)}</font>"
        qty = Decimal(line.qty_ordered)
        rate = Decimal(line.unit_rate)
        amount = (qty * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        uom = str(getattr(line, "uom", None) or "KG")
        total_qty_by_uom[uom] = total_qty_by_uom.get(uom, Decimal("0")) + qty
        total_amount += amount
        units = f"{line.expected_unit_count} {_text(line.count_basis).lower()}" if line.expected_unit_count else "-"
        line_rows.append([
            Paragraph(str(index), styles["body"]), Paragraph(material, styles["body"]),
            Paragraph(f"{_qty(qty)} {_text(uom)}", styles["small_right"]), Paragraph(units, styles["small_right"]),
            Paragraph(_money(rate), styles["small_right"]), Paragraph(_money(amount), styles["small_right"]),
        ])
    line_rows.append([
        "", Paragraph("<b>Total</b>", styles["body"]), Paragraph("<br/>".join(f"<b>{_qty(qty)} {_text(unit)}</b>" for unit, qty in total_qty_by_uom.items()), styles["small_right"]),
        "", "", Paragraph(f"<b>{_money(total_amount)}</b>", styles["small_right"]),
    ])
    lines = Table(line_rows, repeatRows=1, colWidths=[8 * mm, 79 * mm, 25 * mm, 20 * mm, 24 * mm, 28 * mm])
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
        schedule_data: list[list[Any]] = [[Paragraph(value, styles["table_head"]) for value in
            ("Delivery date", "Material", "Planned kg", "Received kg", "Cancelled kg", "Open kg", "Vendor")]]
        for row in schedule_rows:
            schedule_data.append([
                Paragraph(_text(row.get("delivery_date")), styles["body"]),
                Paragraph(_text(row.get("item_code")), styles["body"]),
                Paragraph(_qty(row.get("planned_qty")), styles["small_right"]),
                Paragraph(_qty(row.get("received_qty")), styles["small_right"]),
                Paragraph(_qty(row.get("cancelled_qty")), styles["small_right"]),
                Paragraph(_qty(row.get("open_qty")), styles["small_right"]),
                Paragraph(_text(row.get("vendor_confirmation")), styles["body"]),
            ])
        schedule_table = Table(schedule_data, repeatRows=1,
            colWidths=[24 * mm, 38 * mm, 24 * mm, 24 * mm, 24 * mm, 22 * mm, 28 * mm])
        schedule_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), TEAL), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.3, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 1.5 * mm), ("RIGHTPADDING", (0, 0), (-1, -1), 1.5 * mm),
            ("TOPPADDING", (0, 0), (-1, -1), 1.8 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.8 * mm),
        ]))
        story.extend([Paragraph("Delivery schedule annexure", styles["section"]), schedule_table])

    terms = [
        ("Freight", metadata.get("freight_terms")), ("Tax", metadata.get("tax_terms")),
        ("Payment", metadata.get("payment_terms")), ("Delivery", metadata.get("delivery_terms")),
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
    approval = f"Approved by {_text(revision.approved_by)} on {_text(revision.approved_at)}" if revision.approved_by else "Approval pending"
    signatures = Table([
        [Paragraph("Prepared / checked by", styles["small"]), Paragraph(f"For {_text(company)}", styles["small_right"])],
        [Paragraph(_text(revision.created_by), styles["body"]), Paragraph(approval, styles["small_right"])],
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
    """Render one saved QR per physical lot at an explicit printer paper size."""
    from reportlab.pdfgen import canvas
    from reportlab.graphics import renderPDF
    from reportlab.graphics.shapes import Drawing
    from reportlab.graphics.barcode.qr import QrCodeWidget
    output = BytesIO()
    thermal = profile == "PAPER_LOT_4X2"
    page_size = (101.6 * mm, 50.8 * mm) if thermal else A4
    pdf = canvas.Canvas(output, pagesize=page_size)
    pdf.setTitle("Paper reel and coil labels")
    width, height = page_size
    for label in labels:
        for _ in range(copies):
            left = 4 * mm; top = height - 5 * mm
            def text(value, x, y, size=8, bold=False):
                pdf.setFont("Helvetica-Bold" if bold else "Helvetica", size)
                pdf.drawString(x, y, str(value or "-"))
            text("AMIGO | MATERIAL LOT", left, top, 8, True)
            text(label.get("amigo_no") or label.get("code"), left, top - 5*mm, 11, True)
            # Bounded wrapping reserves a separate QR column.
            for index, line in enumerate(__import__('textwrap').wrap(str(label.get("item_code") or "") + " | " + str(label.get("item_name") or ""), width=39)[:2]):
                text(line, left, top - (10 + index*3.5)*mm, 7)
            source = label.get("source_reel_no") or (label.get("metadata") or {}).get("source_reel_no") or "-"
            text(f"Vendor lot: {source}", left, top - 21*mm, 8)
            text(f"{label.get('physical_form') or 'REEL'} | {label.get('inward_qty', label.get('qty', 0))} kg | {label.get('width_mm') or '-'} mm", left, top - 26*mm, 9, True)
            text(f"PO: {label.get('po_no') or 'Manual GRN'}", left, top - 31*mm, 8)
            text(f"Inward: {label.get('inward_date') or '-'}", left, top - 36*mm, 8)
            qr = QrCodeWidget(label["qr_value"])
            bounds = qr.getBounds(); qr_width = bounds[2] - bounds[0]; qr_height = bounds[3] - bounds[1]
            size = 26 * mm
            drawing = Drawing(size, size, transform=[size/qr_width,0,0,size/qr_height,0,0]); drawing.add(qr)
            renderPDF.draw(drawing, pdf, width - size - 4*mm, height - size - 4*mm)
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
