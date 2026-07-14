from pathlib import Path

from PIL import Image
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image as ReportImage,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "TOOLING_DROPDOWN_USER_GUIDE.pdf"
SCREENSHOT = ROOT / "reports" / "tooling-dropdown-manager-browser.png"
CROP = ROOT / "output" / "pdf" / "tooling-dropdown-manager-guide.png"

TEAL = colors.HexColor("#087F8C")
NAVY = colors.HexColor("#14213D")
INK = colors.HexColor("#202938")
MUTED = colors.HexColor("#5F6B7A")
PALE = colors.HexColor("#EDF7F8")
LINE = colors.HexColor("#D9E2E8")
AMBER = colors.HexColor("#FFF4D6")


def crop_screenshot() -> None:
    source = Image.open(SCREENSHOT)
    width, height = source.size
    crop = source.crop((max(0, int(width * 0.27)), 0, min(width, int(width * 0.73)), min(height, 920)))
    crop.save(CROP, quality=92)


def numbered_steps(styles, steps, widths=(11 * mm, 158 * mm)):
    rows = []
    for number, step in enumerate(steps, 1):
        badge = Paragraph(f"<b>{number}</b>", styles["Badge"])
        rows.append([badge, Paragraph(step, styles["BodyTextCustom"])])
    table = Table(rows, colWidths=list(widths), hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (0, -1), 4),
            ]
        )
    )
    return table


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.line(20 * mm, 15 * mm, 190 * mm, 15 * mm)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(20 * mm, 10 * mm, "Hari Om ERP | Tooling Dropdown User Guide")
    canvas.drawRightString(190 * mm, 10 * mm, f"Page {doc.page}")
    canvas.restoreState()


def build_pdf() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    crop_screenshot()

    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            "TitleCustom",
            parent=styles["Title"],
            fontName="Helvetica-Bold",
            fontSize=25,
            leading=29,
            textColor=NAVY,
            alignment=TA_CENTER,
            spaceAfter=6,
        )
    )
    styles.add(
        ParagraphStyle(
            "Subtitle",
            parent=styles["Normal"],
            fontSize=11,
            leading=16,
            textColor=MUTED,
            alignment=TA_CENTER,
        )
    )
    styles.add(
        ParagraphStyle(
            "HeadingCustom",
            parent=styles["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=15,
            leading=19,
            textColor=NAVY,
            spaceBefore=8,
            spaceAfter=7,
        )
    )
    styles.add(
        ParagraphStyle(
            "BodyTextCustom",
            parent=styles["BodyText"],
            fontSize=10,
            leading=15,
            textColor=INK,
        )
    )
    styles.add(
        ParagraphStyle(
            "Small",
            parent=styles["BodyText"],
            fontSize=8.5,
            leading=12,
            textColor=MUTED,
        )
    )
    styles.add(
        ParagraphStyle(
            "Badge",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=10,
            leading=16,
            alignment=TA_CENTER,
            textColor=colors.white,
            backColor=TEAL,
            borderRadius=8,
        )
    )

    document = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        rightMargin=20 * mm,
        leftMargin=20 * mm,
        topMargin=18 * mm,
        bottomMargin=22 * mm,
        title="Tooling Dropdown List - User Guide",
        author="Hari Om ERP",
    )

    story = [
        Spacer(1, 8 * mm),
        Paragraph("TOOLING MASTER", styles["Small"]),
        Spacer(1, 3 * mm),
        Paragraph("Dropdown List User Guide", styles["TitleCustom"]),
        Paragraph("Add, rename, discontinue, and restore tool attributes without technical support.", styles["Subtitle"]),
        Spacer(1, 10 * mm),
    ]

    access = Table(
        [
            [Paragraph("LIVE SYSTEM", styles["Small"]), Paragraph("WHO CAN EDIT", styles["Small"])],
            [
                Paragraph("35-154-224-14.sslip.io/masters/tools", styles["BodyTextCustom"]),
                Paragraph("Admin, Owner, Plant Manager", styles["BodyTextCustom"]),
            ],
        ],
        colWidths=[92 * mm, 72 * mm],
    )
    access.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), PALE),
                ("BOX", (0, 0), (-1, -1), 0.8, TEAL),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.extend(
        [
            access,
            Spacer(1, 8 * mm),
            Paragraph("Before You Start", styles["HeadingCustom"]),
            numbered_steps(
                styles,
                [
                    "Sign in with an <b>Admin, Owner, or Plant Manager</b> account.",
                    "Select a <b>specific plant</b> in the top bar. Do not use All plants while editing masters.",
                    "Open <b>Masters &gt; Tools</b>, then choose Add Tool or Edit.",
                ],
            ),
            Spacer(1, 7 * mm),
            Table(
                [[Paragraph("Five fixed categories", styles["Small"])], [Paragraph("Notch &nbsp;&nbsp; Blade &nbsp;&nbsp; Holder &nbsp;&nbsp; V + Flat &nbsp;&nbsp; Punch", styles["BodyTextCustom"])]],
                colWidths=[164 * mm],
                style=TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, -1), AMBER),
                        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#E8C96A")),
                        ("LEFTPADDING", (0, 0), (-1, -1), 10),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                        ("TOPPADDING", (0, 0), (-1, -1), 7),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                    ]
                ),
            ),
            Spacer(1, 5 * mm),
            Paragraph("Categories are fixed. Users can add any number of tool definitions and physical assets under them.", styles["Small"]),
            PageBreak(),
            Paragraph("Edit a List Inside the Tool Form", styles["HeadingCustom"]),
        ]
    )

    image = ReportImage(str(CROP), width=88 * mm, height=162 * mm)
    steps = numbered_steps(
        styles,
        [
            "Choose the required tool category.",
            "Find Type, Design, Degree, Blade Type, or Punch and select <b>Manage list</b>.",
            "Enter a new value and select <b>Add</b>. The new value is selected automatically.",
            "Use the pencil icon to rename an existing value.",
            "Select <b>Discontinue</b> to hide a value from new selections while preserving history.",
            "Open the same list and select <b>Reactivate</b> when the value is needed again.",
        ],
        widths=(9 * mm, 67 * mm),
    )
    story.extend(
        [
            Table([[image, steps]], colWidths=[92 * mm, 76 * mm], style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 4)])),
            Spacer(1, 5 * mm),
            Paragraph("Example: Add Degree 65", styles["HeadingCustom"]),
            Paragraph("Add or edit a Notch tool, open Manage list beside Degree, enter <b>65</b>, and select Add. Complete the tool details and Save.", styles["BodyTextCustom"]),
            PageBreak(),
            Paragraph("Direction, Distance, and Depth", styles["HeadingCustom"]),
        ]
    )

    mapping = Table(
        [
            [Paragraph("FIELD", styles["Small"]), Paragraph("HOW IT IS MAINTAINED", styles["Small"])],
            [Paragraph("Notch Direction", styles["BodyTextCustom"]), Paragraph("Editable Dropdown Registry: Category Notch, field notch_direction.", styles["BodyTextCustom"])],
            [Paragraph("Notch Distance", styles["BodyTextCustom"]), Paragraph("Direct numeric input in the specification sheet.", styles["BodyTextCustom"])],
            [Paragraph("Notch Depth", styles["BodyTextCustom"]), Paragraph("Direct numeric input in the specification sheet.", styles["BodyTextCustom"])],
        ],
        colWidths=[47 * mm, 117 * mm],
    )
    mapping.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.5, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.extend(
        [
            mapping,
            Spacer(1, 8 * mm),
            Paragraph("Why Discontinue Instead of Delete?", styles["HeadingCustom"]),
            Paragraph("Discontinue removes the value from future selections but keeps old specifications, production records, and traceability intact. Reactivate restores it for future use.", styles["BodyTextCustom"]),
            Spacer(1, 7 * mm),
            Paragraph("Troubleshooting", styles["HeadingCustom"]),
            numbered_steps(
                styles,
                [
                    "If Manage list is missing or disabled, select a specific plant and verify the user role.",
                    "If a duplicate warning appears, use or rename the existing value.",
                    "If a discontinued value is missing, reactivate it from Manage list or the registry.",
                    "If a change is not visible, close and reopen the form and confirm the selected plant.",
                ],
            ),
            Spacer(1, 8 * mm),
            KeepTogether(
                Table(
                    [[Paragraph("PRODUCTION CHECK", styles["Small"])], [Paragraph("AWS production accepted an Owner-role dropdown update. List changes are plant-scoped and feed the corresponding tool and specification-sheet dropdowns.", styles["BodyTextCustom"])]],
                    colWidths=[164 * mm],
                    style=TableStyle(
                        [
                            ("BACKGROUND", (0, 0), (-1, -1), PALE),
                            ("BOX", (0, 0), (-1, -1), 0.8, TEAL),
                            ("LEFTPADDING", (0, 0), (-1, -1), 10),
                            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                            ("TOPPADDING", (0, 0), (-1, -1), 7),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                        ]
                    ),
                )
            ),
        ]
    )

    document.build(story, onFirstPage=footer, onLaterPages=footer)


if __name__ == "__main__":
    build_pdf()
    print(OUTPUT)
