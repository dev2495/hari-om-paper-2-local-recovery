from pathlib import Path

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    Image,
    KeepTogether,
    PageTemplate,
    PageBreak,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "TOOLING_LIFECYCLE_CLIENT_REPORT.pdf"
SCREENSHOTS = ROOT / "reports"
TMP = ROOT / "tmp" / "pdfs"


class FlowDiagram(Flowable):
    def __init__(self):
        super().__init__()
        self.width = 175 * mm
        self.height = 74 * mm

    def draw(self):
        canvas = self.canv
        boxes = [
            (8, 45, 50, 20, "Tool definition", "5 fixed categories"),
            (63, 45, 50, 20, "Physical inward", "asset + QR + location"),
            (118, 45, 50, 20, "Job card", "issue + production"),
            (63, 8, 50, 20, "Blade grinding", "same asset, V1/V2"),
        ]
        for x, y, w, h, title, detail in boxes:
            canvas.setFillColor(colors.HexColor("#F8FAFC"))
            canvas.setStrokeColor(colors.HexColor("#B7C9D6"))
            canvas.roundRect(x * mm, y * mm, w * mm, h * mm, 4 * mm, fill=1, stroke=1)
            canvas.setFillColor(colors.HexColor("#0F172A"))
            canvas.setFont("Helvetica-Bold", 9)
            canvas.drawCentredString((x + w / 2) * mm, (y + 13) * mm, title)
            canvas.setFont("Helvetica", 7)
            canvas.setFillColor(colors.HexColor("#475569"))
            canvas.drawCentredString((x + w / 2) * mm, (y + 7) * mm, detail)
        canvas.setStrokeColor(colors.HexColor("#0F9AA8"))
        canvas.setLineWidth(1.4)
        for x1, x2 in [(58, 63), (113, 118)]:
            canvas.line(x1 * mm, 55 * mm, x2 * mm, 55 * mm)
            canvas.line((x2 - 2) * mm, 56 * mm, x2 * mm, 55 * mm)
            canvas.line((x2 - 2) * mm, 54 * mm, x2 * mm, 55 * mm)
        canvas.line(88 * mm, 45 * mm, 88 * mm, 28 * mm)
        canvas.line(86 * mm, 30 * mm, 88 * mm, 28 * mm)
        canvas.line(90 * mm, 30 * mm, 88 * mm, 28 * mm)


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="CoverTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=27,
    leading=32, textColor=colors.HexColor("#0F172A"), spaceAfter=10,
))
styles.add(ParagraphStyle(
    name="CoverSub", parent=styles["Normal"], fontName="Helvetica", fontSize=12,
    leading=19, textColor=colors.HexColor("#475569"), spaceAfter=8,
))
styles.add(ParagraphStyle(
    name="H1Custom", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=18,
    leading=23, textColor=colors.HexColor("#0F172A"), spaceBefore=5, spaceAfter=9,
))
styles.add(ParagraphStyle(
    name="H2Custom", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=12,
    leading=16, textColor=colors.HexColor("#0F6D78"), spaceBefore=8, spaceAfter=5,
))
styles.add(ParagraphStyle(
    name="BodyCustom", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.4,
    leading=14, textColor=colors.HexColor("#334155"), spaceAfter=6,
))
styles.add(ParagraphStyle(
    name="Small", parent=styles["BodyText"], fontName="Helvetica", fontSize=8,
    leading=11, textColor=colors.HexColor("#475569"), spaceAfter=3,
))
styles.add(ParagraphStyle(
    name="Callout", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=10,
    leading=15, textColor=colors.HexColor("#0F172A"), backColor=colors.HexColor("#E6F7F8"),
    borderColor=colors.HexColor("#9DDDE1"), borderWidth=0.7, borderPadding=9,
    spaceBefore=6, spaceAfter=9,
))


def P(text, style="BodyCustom"):
    return Paragraph(text, styles[style])


def bullet(text):
    return P("&bull; " + text, "BodyCustom")


def table(data, widths, header=True):
    converted = []
    for row in data:
        converted.append([cell if isinstance(cell, Flowable) else P(str(cell), "Small") for cell in row])
    result = Table(converted, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    commands = [
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#CBD5E1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    if header:
        commands += [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ]
    result.setStyle(TableStyle(commands))
    return result


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#D6E2E8"))
    canvas.line(18 * mm, 14 * mm, 192 * mm, 14 * mm)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawString(18 * mm, 9 * mm, "Hari Om Paper ERP | Tooling lifecycle guide")
    canvas.drawRightString(192 * mm, 9 * mm, f"Page {doc.page}")
    canvas.restoreState()


def add_screenshot_slices(story, image_path, count, title):
    if not image_path.exists():
        return
    TMP.mkdir(parents=True, exist_ok=True)
    with PILImage.open(image_path) as source:
        source_width, source_height = source.size
        slice_height = (source_height + count - 1) // count
        for index in range(count):
            top = index * slice_height
            bottom = min(source_height, top + slice_height)
            if top >= bottom:
                continue
            crop_path = TMP / f"{image_path.stem}-{index + 1}.png"
            source.crop((0, top, source_width, bottom)).save(crop_path)
            if index:
                story.append(PageBreak())
            story.append(P(f"{title} ({index + 1} of {count})", "Small"))
            display_height = 174 * mm * (bottom - top) / source_width
            story.append(Image(str(crop_path), width=174 * mm, height=display_height))


class ClientReport(BaseDocTemplate):
    def __init__(self, filename):
        super().__init__(filename, pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm, topMargin=17 * mm, bottomMargin=20 * mm)
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="normal")
        self.addPageTemplates([PageTemplate(id="client", frames=frame, onPage=header_footer)])


def build():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = ClientReport(str(OUTPUT))
    story = []

    story += [Spacer(1, 22 * mm), P("Hari Om Paper ERP", "Small"), P("Tooling Lifecycle", "CoverTitle"), P("Client operating report and user guide", "CoverSub")]
    story += [Spacer(1, 7 * mm), P("From approved tooling master to physical QR asset, production issue, blade grinding, and trace reporting.", "CoverSub")]
    story += [Spacer(1, 12 * mm), FlowDiagram(), Spacer(1, 8 * mm)]
    story += [P("Release scope", "H2Custom"), P("This report explains the tooling and specification-sheet flows now available in the ERP. It is written for the client, store, production, quality, and supervisory teams. Technical implementation details are intentionally kept out of the operating instructions.", "BodyCustom")]
    story += [P("At a glance", "Callout")]
    story += [table([["Control", "What the user gets"], ["Five fixed categories", "Notch, Blade, Holder, V + Flat, Punch"], ["Physical identity", "One asset number and QR value for every inwarded unit"], ["Trace", "Issue, return, maintenance, grinding, job-card output"], ["Spec sheet", "Approved values only, with mandrel-linked tube selection"], ["Suggestions", "Removed from the page and calculation flow"]], [42 * mm, 132 * mm])]
    story += [PageBreak()]

    story += [P("1. Tooling master", "H1Custom"), P("Open Masters > Tools. The five categories are fixed. The plant team can create multiple tool definitions under every category, but cannot create a sixth category.", "BodyCustom")]
    story += [table([["Category", "Fields maintained"], ["Notch", "Type, thickness, design, degree"], ["Blade", "Type, thickness, height, length"], ["Holder", "Thickness, height, length"], ["V + Flat", "Length, thickness"], ["Punch", "Punch option"]], [42 * mm, 132 * mm])]
    story += [P("Adding a definition", "H2Custom")]
    for item in ["Select Add Tool.", "Choose one of the five fixed categories.", "Enter the category points and status.", "Save. The definition becomes available to the specification sheet while active."]:
        story.append(bullet(item))
    story += [P("Editing approved dropdown values", "H2Custom")]
    story += [P("Use the Editable dropdown registry to maintain the values used by the master and the notch process. Direction, distance, and depth are process option values, not extra tool categories. Only active values appear for selection.", "BodyCustom")]
    story += [P("Important", "H2Custom"), P("Master definition and physical asset are separate records. Updating a definition does not erase the saved snapshot or history of a tool that was already inwarded.", "Callout")]

    story += [P("2. Physical inward and QR identity", "H1Custom"), P("Use Inward beside the tool definition. Enter receipt date, quantity, and a Location Master position. The system expands the quantity into individual physical assets.", "BodyCustom")]
    story += [table([["Generated information", "Example"], ["Asset number", "TA-260714-001"], ["QR value", "hariom://tool/TA-260714-001"], ["Starting status", "Available"], ["Grinding version", "V0"], ["Location", "Tool Rack A"]], [52 * mm, 122 * mm])]
    story += [P("Example: two plain blades received on 14-Jul-2026 create two separate assets. They share the same definition but each has its own location, status, issue history, usage count, and production output.", "BodyCustom")]
    story += [PageBreak()]

    story += [P("3. Physical lifecycle", "H1Custom"), P("The ledger shows only the actions valid for the current physical status.", "BodyCustom")]
    story += [table([["Status", "Use"], ["Available", "Ready to issue, maintain, grind (blade), or scrap"], ["Issued", "Assigned to a job card and stage; return after use"], ["Maintenance", "Temporarily with maintenance; complete when usable"], ["Grinding out", "Blade sent for sharpening; grinding return completes the cycle"], ["Scrap", "Permanently removed from use; history retained"]], [38 * mm, 136 * mm])]
    story += [P("Issue to production", "H2Custom")]
    for item in ["Search or scan the QR/asset number.", "Select Issue.", "Enter the job card ID and production stage.", "Save. The asset becomes Issued and the job card stores the exact asset ID."]:
        story.append(bullet(item))
    story += [P("Blade grinding", "H2Custom"), P("Return the blade if it is issued, select Grinding out, send it for sharpening, then select Grinding return. The same asset number remains in use and the version increments from V0 to V1, then V2, and so on.", "BodyCustom")]
    story += [P("A non-blade tool cannot use the blade grinding action.", "Callout")]

    story += [P("4. Production output and trace", "H1Custom"), P("At job-card completion, actual completed output is recorded against the physical asset IDs assigned to the stage. A retry cannot double-count the same completion.", "BodyCustom")]
    story += [table([["Trace point", "Example"], ["Job card", "JC-2026-014"], ["Stage", "Notching"], ["Physical asset", "TA-260714-001"], ["Good output", "1,200 tubes"], ["Scrap output", "15 tubes"], ["Next lifecycle", "Returned, then grinding V1"]], [50 * mm, 124 * mm])]
    story += [P("This answers how much each blade produced, how much scrap was associated with it, which job cards used it, and how many grinding cycles it completed.", "BodyCustom")]
    story += [PageBreak()]

    story += [P("5. Specification sheet", "H1Custom"), P("Open Specifications > New Specification. The sheet uses active tool definitions and active process option values. Discontinued records are not shown.", "BodyCustom")]
    story += [P("The notch section contains exactly eight process fields", "H2Custom")]
    for item in ["Notch type", "Notching blade", "Notching holder", "V + Flat", "Punch", "Notch direction", "Notch distance", "Notch depth"]:
        story.append(bullet(item))
    story += [P("The first five are tool selections. Direction, distance, and depth are editable process options. Tool points are displayed from the master and are not retyped in the specification sheet.", "BodyCustom")]
    story += [P("Mandrel and tube rule", "H2Custom"), P("Select a mandrel first. The tube-size picker then becomes active and shows only tube IDs within plus or minus 1 mm of the selected mandrel. This keeps the sheet aligned with the physical mandrel choice.", "BodyCustom")]
    story += [P("Suggestions are removed", "H2Custom"), P("The specification sheet no longer shows suggestion cards or runs the removed suggestion calculation route. The user builds and saves the approved recipe directly from the masters and entered production values.", "Callout")]

    spec_img = SCREENSHOTS / "spec-sheet-browser.png"
    add_screenshot_slices(story, spec_img, 3, "Browser evidence - searchable mandrel, filtered tube control, and no suggestion card")
    story += [PageBreak()]

    story += [P("6. Reports and rejection trace", "H1Custom"), P("Open Reports > Tooling. Use the report for current physical status and output by asset.", "BodyCustom")]
    for item in ["Total assets and counts by status.", "Category-level physical stock.", "Searchable physical ledger with location and QR value.", "Usage count and produced quantity per asset.", "Scrap quantity, grinding version, and current job assignment.", "Lifecycle history for inward, issue, return, maintenance, grinding, and scrap."]:
        story.append(bullet(item))
    story += [P("Customer rejection investigation", "H2Custom")]
    for item in ["Start with the order, finished-good lot, or job card.", "Read the physical tool asset IDs on the completed job-card stage.", "Open each asset from the tooling ledger.", "Review inward, location, issue/return, maintenance, grinding versions, and production output.", "Compare the asset output with the job-card and QC records."]:
        story.append(bullet(item))
    story += [P("The result is a forward and backward trace from customer rejection to job card, physical tool, inward record, and maintenance/grinding history.", "Callout")]
    story += [P("7. Daily checklist", "H1Custom")]
    for item in ["Maintain definitions and approved dropdown values before use.", "Inward every physical unit and assign its Location Master position.", "Apply the QR label.", "Issue and return the exact asset on every job card.", "Use grinding only for blades.", "Complete the job card so output is recorded.", "Review the tooling report at shift or month end.", "Discontinue or scrap records instead of deleting history."]:
        story.append(bullet(item))

    tool_img = SCREENSHOTS / "tooling-master-browser.png"
    if tool_img.exists():
        story += [PageBreak(), P("Browser evidence - tooling master, option registry, and QR ledger", "H1Custom")]
        add_screenshot_slices(story, tool_img, 5, "Tooling master and physical ledger")

    story += [PageBreak(), P("Release verification", "H1Custom"), P("The implementation was checked locally with service, unit, build, static, and focused browser verification. The application is ready for client data onboarding; the final plant acceptance steps are listed below.", "BodyCustom")]
    story += [P("Deployment status", "H2Custom"), P("The tooling changes are committed and pushed to GitHub. The linked Railway service remains online on its previous deployment. Railway refused the new upload because the account trial has expired; after selecting a Railway plan, redeploy the latest pushed commit and run the authenticated production smoke test.", "Callout")]
    story += [table([["Verification", "Result"], ["Service compilation", "Passed"], ["Master tooling contract", "5 passed"], ["BFF inward-authority contract", "4 passed"], ["Physical lifecycle tests", "31 passed"], ["Web unit/static checks", "Passed"], ["TypeScript and production build", "Passed"], ["Dependency audit", "0 vulnerabilities"], ["Focused browser tooling/spec suite", "2 passed"], ["BFF health and service startup", "Healthy / ready"]], [70 * mm, 104 * mm])]
    story += [P("Client onboarding acceptance", "H2Custom")]
    for item in ["Confirm Location Master positions.", "Load approved tool definitions and option values.", "Inward opening physical tool stock.", "Print and apply QR labels.", "Run one supervised issue/return cycle.", "Run one supervised blade grinding cycle.", "Complete one supervised job card and verify the tooling report."]:
        story.append(bullet(item))
    story += [Spacer(1, 8 * mm), P("Prepared for client operating use", "CoverSub")]

    doc.build(story)
    print(OUTPUT)


if __name__ == "__main__":
    build()
