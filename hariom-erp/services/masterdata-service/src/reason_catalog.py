"""Every reason list in Hari Om TubeOS (owner decision 4, 1 Nov 2026: "reasons are master codes only").

Each action that asks "why" picks a code from one category of Masters › Reason codes. This module is
the single list of categories: their plain-English name, the screen group they belong to, where they
are used, and the standard codes every plant starts with. ``reason_seed.py`` inserts the standard
codes once per plant and category; ``routers/shop_floor.py`` serves the list and validates choices.

Rule shared by every service: a code whose code has OTHER / OTHERS as a whole word (SO-OTHER,
QH-OTHER) needs a note of at least 5 characters; ANOTHER or MOTHER inside a word does not count.
"""
from __future__ import annotations

import re
from typing import Any, Iterable, Optional

OTHER_NOTE_MIN = 5
_OTHER_WORD = re.compile(r"(?<![A-Z0-9])OTHERS?(?![A-Z0-9])")


def reason_needs_note(code: Optional[str]) -> bool:
    return bool(_OTHER_WORD.search(str(code or "").strip().upper()))


def _cat(key, label, group, used_in, seeds=(), owner_only=False, linked=True, added=()):
    """``added``: standard codes added to the list after plants were first seeded (they are in ``seeds``
    too). ``reason_seed`` inserts each one once into plants that already had the list, unless the plant
    already has that code."""
    return {
        "key": key,
        "label": label,
        "group": group,
        "used_in": list(used_in),
        "seeds": [tuple(item) for item in seeds],
        "owner_only": owner_only,
        "linked": linked,
        "added": [str(code).upper() for code in added],
    }


GROUPS = ("Sales", "Job cards and floor", "Quality", "Stores and stock", "Purchase", "Specifications", "Dispatch", "Gate", "Not linked yet")

CATEGORIES: list[dict[str, Any]] = [
    # ── Sales ──────────────────────────────────────────────────────────────
    _cat("SO_CLOSE", "Order cancel / short close", "Sales",
         ["Sales order › Cancel order", "Sales order › Short close", "Sales order › Customer hold & close"],
         [("SO-CUST-CANCEL", "Customer cancelled the order"), ("SO-QTY-REDUCED", "Customer reduced the quantity"),
          ("SO-BALANCE-NOT-REQ", "Customer does not need the balance"), ("SO-SPEC-CHANGE", "Customer changed the specification"),
          ("SO-PRICE", "Price or terms not agreed"), ("SO-PO-EXPIRED", "PO validity expired"),
          ("SO-DUPLICATE", "Duplicate order entry"), ("SO-ENTRY-ERROR", "Order entered by mistake"),
          ("SO-OTHER", "Other (write a note)")],
         owner_only=True),
    _cat("ORDER_RESUME", "Order hold lifted", "Sales",
         ["Sales order › Resume after a customer hold"],
         [("RS-CUST-CONFIRMED", "Customer confirmed to continue"), ("RS-PAYMENT", "Payment or credit cleared"),
          ("RS-SPEC-CLEARED", "Specification or artwork cleared"), ("RS-SCHEDULE", "New delivery schedule received"),
          ("RS-HOLD-ERROR", "Hold placed by mistake"), ("RS-OTHER", "Other (write a note)")]),
    _cat("CUSTOMER_COMPLAINT", "Customer complaints", "Quality",
         ["Quality › Complaints › Record a complaint"],
         [("CC-DAMAGE", "Crushed / damaged tubes"), ("CC-SIZE", "Size out of tolerance (I.D. / O.D. / length)"),
          ("CC-STRENGTH", "Low crushing strength"), ("CC-MOISTURE", "Moisture / soft tubes"),
          ("CC-QTY", "Short or wrong quantity"), ("CC-FINISH", "Finish, colour or print issue"),
          ("CC-PACKING", "Packing issue"), ("CC-OTHER", "Other (write a note)")]),
    # ── Job cards and floor ────────────────────────────────────────────────
    _cat("JOB_CARD_CLOSE", "Job card close early / cancel", "Job cards and floor",
         ["Job card manager › Close early", "Job card manager › Cancel card", "Job card manager › Close several cards"],
         [("JC-CUST-CANCEL", "Customer cancelled or reduced the order"), ("JC-RELEASED-TWICE", "Released twice by mistake"),
          ("JC-WRONG-SPEC", "Wrong spec or size released"), ("JC-MATERIAL-SHORT", "Paper or material short"),
          ("JC-MACHINE", "Machine breakdown / not available"), ("JC-QTY-DONE", "Enough made for the order"),
          ("JC-MERGED", "Merged into another job card"), ("JC-OTHER", "Other (write a note)")]),
    _cat("JOB_CARD_CHANGE", "Job card split / edit / insert", "Job cards and floor",
         ["Job card manager › Split card", "Job card manager › Edit qty or colour", "Job card manager › Emergency insert"],
         [("CH-CUST-REQUEST", "Customer asked for a change"), ("CH-URGENT", "Urgent order to run first"),
          ("CH-MACHINE-LOAD", "Balance the machine load"), ("CH-MATERIAL", "Material available for part only"),
          ("CH-COLOUR", "Colour changed by the customer"), ("CH-ENTRY-ERROR", "Entered wrongly"),
          ("CH-OTHER", "Other (write a note)")]),
    _cat("STAGE_SHORT_CLOSE", "Stage closed short", "Job cards and floor",
         ["Job card › Close stage with a shortfall"],
         [("SS-MATERIAL-SHORT", "Paper or input short"), ("SS-HIGH-REJECT", "High rejection at this stage"),
          ("SS-MACHINE", "Machine breakdown"), ("SS-CUST-QTY", "Customer needs less"),
          ("SS-TIME", "No time left before delivery"), ("SS-QUALITY", "Quality problem, run stopped"),
          ("SS-OTHER", "Other (write a note)")]),
    _cat("SHORT_CLOSE", "Job card short close (final QC shortage)", "Job cards and floor",
         ["Job card › Dispatch tab › Close job card short", "Operations control › Short close / carry forward"],
         [("SH-REJECT", "Rejected at final QC"), ("SH-MATERIAL", "Material short"), ("SH-MACHINE", "Machine breakdown"),
          ("SH-CUST-ACCEPT", "Customer accepts the short quantity"), ("SH-COUNT", "Count difference at packing"),
          ("SH-OTHER", "Other (write a note)")]),
    _cat("LEFTOVER_INPUT", "Leftover input at stage close", "Job cards and floor",
         ["Job card › Close stage › Leftover input held or scrapped"],
         [("LI-EXTRA-MADE", "Extra pieces from the previous stage"), ("LI-DAMAGED", "Damaged pieces"),
          ("LI-WRONG-SIZE", "Off-size pieces"), ("LI-NEXT-RUN", "Kept for the next run"),
          ("LI-QC-DOUBT", "Quality doubt, kept for checking"), ("LI-OTHER", "Other (write a note)")]),
    _cat("SCRAP", "Floor rejection", "Job cards and floor",
         ["Log output › Rejected pieces (every stage, phone and PC)"],
         [("WL", "Winding loose"), ("PG", "Pasting / glue"), ("ID", "I.D. out"), ("OD", "O.D. out"),
          ("LN", "Length out"), ("WT", "Weight out"), ("CS", "C.S. low"), ("DM", "Damage / dent"),
          ("MS", "Moisture"), ("NT", "Notch"), ("RJ-OTHER", "Other (write a note)")]),
    _cat("ENTRY_CORRECTION", "Entry correction / void / reopen", "Job cards and floor",
         ["Job card › Correct an entry", "Job card › Void an entry", "Job card › Reopen a stage"],
         [("EC-WRONG-QTY", "Wrong quantity entered"), ("EC-WRONG-OPERATOR", "Wrong operator or shift"),
          ("EC-WRONG-MACHINE", "Wrong machine"), ("EC-DUPLICATE", "Entered twice"),
          ("EC-WRONG-CARD", "Entered on the wrong job card"), ("EC-REOPEN-MORE", "More output to log after close"),
          ("EC-OTHER", "Other (write a note)")]),
    _cat("OVERRIDE", "Override (over-production, planner gate)", "Job cards and floor",
         ["Log output › More than 110% of target", "Log output › Carryover / cutting loss", "Log output › Run outside the plan"],
         [("OV-CUST-EXTRA", "Customer accepts extra"), ("OV-SETUP-LOSS", "Extra for setup or cutting loss"),
          ("OV-PLAN-CHANGE", "Plan changed on the floor"), ("OV-URGENT", "Urgent order run early"),
          ("OV-MACHINE-SWAP", "Run on another machine"), ("OV-OTHER", "Other (write a note)")]),
    _cat("DOWNTIME", "Machine downtime", "Job cards and floor",
         ["Operations control › Log downtime", "Operations control › Edit downtime"],
         [("DT-POWER", "Power cut"), ("DT-BREAKDOWN", "Machine breakdown"), ("DT-MAINT", "Planned maintenance"),
          ("DT-NO-PAPER", "Waiting for paper / reel"), ("DT-NO-ADHESIVE", "Waiting for adhesive"),
          ("DT-CHANGEOVER", "Size / mandrel changeover"), ("DT-NO-OPERATOR", "No operator"),
          ("DT-QUALITY", "Stopped for a quality problem"), ("DT-OTHER", "Other (write a note)")]),
    # ── Quality ────────────────────────────────────────────────────────────
    _cat("QC_HOLD", "QC hold placed", "Quality",
         ["Quality › Holds & inspections › Place hold", "Opening stock › Put on hold"],
         [("QH-SUSPECT", "Suspected quality problem"), ("QH-CUST-COMPLAINT", "Customer complaint on this lot"),
          ("QH-MOISTURE", "Moisture / drying doubt"), ("QH-SIZE", "Size out of tolerance"),
          ("QH-STRENGTH", "Strength doubt"), ("QH-LABEL", "Label or identity doubt"),
          ("QH-RETEST", "Waiting for a retest"), ("QH-OTHER", "Other (write a note)")]),
    _cat("QC_RELEASE", "QC hold release", "Quality",
         ["Quality › Holds & inspections › Release hold"],
         [("QR-RETEST-OK", "Retest passed"), ("QR-REWORKED", "Reworked and checked"),
          ("QR-SORTED", "Sorted, bad pieces removed"), ("QR-CUST-OK", "Customer accepted as is"),
          ("QR-MGMT-OK", "Plant head approved use"), ("QR-HOLD-ERROR", "Hold placed by mistake"),
          ("QR-OTHER", "Other (write a note)")]),
    _cat("RM_ISSUE", "Incoming material rejected / returned", "Quality",
         ["Quality › Incoming › Return rejected lot to supplier"],
         [("RM-GSM", "GSM out of range"), ("RM-MOISTURE", "Moisture high"), ("RM-DAMAGED", "Damaged in transit"),
          ("RM-WRONG-ITEM", "Wrong item or grade supplied"), ("RM-WEIGHT", "Weight short"),
          ("RM-STRENGTH", "Strength / burst low"), ("RM-NO-DOCS", "Test certificate or documents missing"),
          ("RM-OTHER", "Other (write a note)")]),
    _cat("CONCESSION", "Concession (use despite a fail)", "Quality",
         ["Quality › Incoming › Use under concession"],
         [("CN-MINOR", "Minor deviation, safe to use"), ("CN-URGENT", "Urgent need, no other stock"),
          ("CN-CUST-OK", "Customer approved"), ("CN-NON-CRITICAL", "Used for a non-critical product"),
          ("CN-SUPPLIER-CREDIT", "Supplier gives credit or a rate cut"), ("CN-OTHER", "Other (write a note)")]),
    _cat("INCOMING_QC", "Incoming QC out of band / hold / reject", "Quality",
         ["Quality › Incoming › Reading out of band", "Quality › Incoming › Hold or Reject a lot",
          "Quality › Incoming › Close an earlier hold after a re-check"],
         [("IQ-GSM", "GSM out of range"), ("IQ-MOISTURE", "Moisture high"), ("IQ-SIZE", "Width / size out of range"),
          ("IQ-STRENGTH", "Strength / burst low"), ("IQ-WEIGHT", "Weight short"), ("IQ-DAMAGED", "Damaged in transit"),
          ("IQ-WRONG-ITEM", "Wrong item or grade supplied"), ("IQ-NO-DOCS", "Test certificate or documents missing"),
          ("IQ-RECHECK-OK", "Re-check passed, earlier hold can close"), ("IQ-OTHER", "Other (write a note)")]),
    # Inward weigh-in (6 Nov 2026): fixing a typed actual weight after it was saved.
    _cat("WEIGH_CORRECTION", "Re-weigh / weight correction", "Quality",
         ["Quality › Incoming › Re-weigh a lot"],
         [("WC-TYPO", "Typing mistake"), ("WC-REWEIGHED", "Weighed again on the scale"),
          ("WC-WRONG-LOT", "Weight entered on the wrong reel or lot"), ("WC-SCALE", "Scale was not zeroed"),
          ("WC-OTHER", "Other (write a note)")]),
    _cat("QC_RULE_CHANGE", "QC rule / band change", "Quality",
         ["Quality › Stage QC rules › Save as new version", "Quality › Stage QC rules › Customer / spec override",
          "Masters › Inward QC › Band change", "Specification › Stage QC values"],
         [("QV-CUSTOMER", "Customer asked for a change"), ("QV-DRAWING", "Customer drawing or spec revised"),
          ("QV-SUPPLIER", "Agreed with the supplier"), ("QV-FLOOR", "Floor experience / trial results"),
          ("QV-SEASON", "Season change"), ("QV-CORRECTION", "Correct a wrong entry"),
          ("QV-FIRST-SETUP", "First setup"), ("QV-OTHER", "Other (write a note)")]),
    # ── Stores and stock ───────────────────────────────────────────────────
    _cat("STOCK_CORRECTION", "Stock correction", "Stores and stock",
         ["Stock counts & book › Corrections › Raise a correction"],
         [("COUNT_SHORT", "Count short"), ("COUNT_EXTRA", "Count extra"), ("DAMAGED_IN_STORE", "Damaged in store"),
          ("WRONG_GRN_WEIGHT", "Wrong GRN weight"), ("LABEL_LOST_FOUND", "Label lost / found"),
          ("STOCK-OTHER", "Other (write a note)")]),
    _cat("APPROVAL_REJECT", "Correction rejected / count sent back", "Stores and stock",
         ["Stock counts & book › Corrections › Reject", "Stock count › Send back for recount"],
         [("AR-RECOUNT", "Recount needed"), ("AR-NO-PROOF", "No proof or photo"), ("AR-WRONG-ITEM", "Wrong item or lot"),
          ("AR-WRONG-QTY", "Quantity looks wrong"), ("AR-OTHER", "Other (write a note)")]),
    _cat("MANUAL_FG", "Manual FG inward", "Stores and stock",
         ["Inventory › FG inward › Manual inward"],
         [("FG-REWORK", "Reworked pieces taken back"), ("FG-ADJUSTMENT", "Stock adjustment"),
          ("FG-OPENING", "Opening stock"), ("FG-OTHER", "Other (write a note)")]),
    _cat("MANUAL_RECEIPT", "Receipt without PO", "Stores and stock",
         ["Inward › Receive without a PO"],
         [("MR-URGENT", "Urgent buy, PO to follow"), ("MR-SAMPLE", "Free sample from the supplier"),
          ("MR-RETURNABLE", "Returnable / job-work material"), ("MR-CASH", "Cash purchase"),
          ("MR-CUST-SUPPLIED", "Customer-supplied material"), ("MR-OTHER", "Other (write a note)")]),
    _cat("BOOKS_UNLOCK", "Books unlock", "Stores and stock",
         ["Month end › Store books › Unlock a closed month"],
         [("BU-LATE-GRN", "Late GRN or bill to post"), ("BU-CORRECTION", "Correction to a closed month"),
          ("BU-AUDIT", "Auditor's adjustment"), ("BU-ERROR", "Closed by mistake"), ("BU-OTHER", "Other (write a note)")]),
    _cat("MONTH_END_VARIANCE", "Month-end variance", "Stores and stock",
         ["Month end › Variance outside tolerance (per item)"],
         [("MV-WASTAGE", "Higher wastage on the floor"), ("MV-WRONG-ISSUE", "Wrong issue entry"),
          ("MV-COUNT", "Physical count difference"), ("MV-MOISTURE", "Moisture / weight loss"),
          ("MV-SPEC", "Spec weight differs from actual"), ("MV-TRIAL", "Trial or sample runs"),
          ("MV-OTHER", "Other (write a note)")]),
    _cat("LABEL_REPRINT", "Label reprint", "Stores and stock",
         ["GRN / receipt › Print labels again"],
         [("LR-DAMAGED", "Label damaged or torn"), ("LR-LOST", "Label lost / fell off"), ("LR-PRINTER", "Printer jam or bad print"),
          ("LR-WRONG", "Wrong label stuck"), ("LR-EXTRA-COPY", "Extra copy needed"), ("LR-OTHER", "Other (write a note)")]),
    _cat("REEL_SERIAL", "Reel serial number set", "Stores and stock",
         ["Labels › AIT reel serial › Set the next number"],
         [("RN-PLANT-SERIES", "Carry on from the plant's printed series"), ("RN-SPOILED", "Printed labels spoiled or skipped"),
          ("RN-CORRECTION", "Correct a wrong number"), ("RN-OTHER", "Other (write a note)")]),
    _cat("STOCK_POLICY", "Stock alert policy change", "Stores and stock",
         ["Inventory › Stock alert policies › Draft policy"],
         [("SP-FIRST", "First policy for this material"), ("SP-USAGE", "Usage changed"), ("SP-LEAD-TIME", "Supplier lead time changed"),
          ("SP-MOQ", "Supplier minimum order changed"), ("SP-SEASON", "Season demand change"),
          ("SP-CORRECTION", "Correct a wrong entry"), ("SP-OTHER", "Other (write a note)")]),
    # Doc Vault (6 Nov 2026): a document is never deleted; Owner or Admin voids it with one of these.
    _cat("DOC_VOID", "Document void", "Stores and stock",
         ["Doc Vault › Void a document"],
         [("DV-DUPLICATE", "Uploaded twice"), ("DV-WRONG-FILE", "Wrong photo or file"),
          ("DV-UNREADABLE", "Photo not readable"), ("DV-NOT-OURS", "Not our document"),
          ("DV-RETENTION", "Retention period over (visitor photo)"),
          ("DV-OTHER", "Other (write a note)")],
         added=("DV-RETENTION",)),
    # ── Gate (6 Nov 2026) ──────────────────────────────────────────────────
    # Bill types the watchman taps. GB-MATERIAL goes to Stores (GRN); every other code goes to the
    # Accounts bills inbox. The plant may add more (Water, Rent, Transport …) in Masters › Reason codes.
    _cat("BILL_CATEGORY", "Gate bill type", "Gate",
         ["Gate › Bill in › Type of bill", "Gate › Bills inbox › Re-categorise", "Goods inward › At the gate › Re-categorise"],
         [("GB-MATERIAL", "Material (stores)"), ("GB-ELECTRICITY", "Electricity"),
          ("GB-MAINTENANCE", "Maintenance & service"), ("GB-COURIER", "Courier & post"), ("GB-OTHER", "Other (write a note)")],
         added=("GB-OTHER",)),
    _cat("COST_HEAD", "Expense cost head", "Gate",
         ["Gate › Bills inbox › File a bill"],
         [("CO-ELECTRICAL", "Electrical"), ("CO-MECHANICAL", "Mechanical"), ("CO-CIVIL", "Civil"),
          ("CO-HOUSEKEEPING", "Housekeeping"), ("CO-UTILITIES", "Utilities"), ("CO-ADMIN", "Office & admin"),
          ("CO-TRANSPORT", "Transport & courier"), ("CO-OTHER", "Other (write a note)")]),
    _cat("VISIT_PURPOSE", "Visit purpose", "Gate",
         ["Visitor check-in (gate QR)", "Gate › + Visitor"],
         [("VP-MEETING", "Meeting"), ("VP-VENDOR", "Vendor visit"), ("VP-SERVICE", "Service / repair"),
          ("VP-INTERVIEW", "Interview"), ("VP-DELIVERY", "Delivery"), ("VP-OTHER", "Other (write a note)")]),
    _cat("GATE_DENY", "Visitor not let in", "Gate",
         ["Gate › Waiting at gate › Deny"],
         [("GD-NO-ID", "No ID shown"), ("GD-HOST-NA", "Host not available"), ("GD-NO-APPOINTMENT", "No appointment"),
          ("GD-NOT-ALLOWED", "Not allowed in the plant"), ("GD-SAFETY", "Safety rule not met"),
          ("GD-OTHER", "Other (write a note)")]),
    # Goods out (8 Nov 2026): Store links the watchman's photos to the challans; the plant head may undo a
    # wrong link with one of these (logged on the gate entry).
    _cat("GATE_OUT_UNLINK", "Goods-out photo unlinked", "Gate",
         ["Dispatch register › Gone out at the gate › Unlink"],
         [("GU-WRONG-CHALLAN", "Linked to the wrong challan"), ("GU-WRONG-TRUCK", "Photos are of another truck"),
          ("GU-TALLY-WRONG", "Wrong Tally bill"), ("GU-OTHER", "Other (write a note)")]),
    # ── Purchase ───────────────────────────────────────────────────────────
    _cat("PURCHASE_REJECT", "Purchase approval rejected", "Purchase",
         ["Purchase › Approvals › Reject PO", "Requisitions › Reject", "Purchase plans › Reject"],
         [("PJ-RATE-HIGH", "Rate too high"), ("PJ-NOT-NEEDED", "Not needed now"), ("PJ-STOCK-OK", "Enough stock in hand"),
          ("PJ-WRONG-VENDOR", "Wrong supplier"), ("PJ-WRONG-ITEM", "Wrong item or quantity"),
          ("PJ-BUDGET", "Over budget"), ("PJ-OTHER", "Other (write a note)")]),
    _cat("PO_CLOSE", "PO cancel / short close", "Purchase",
         ["Purchase order › Cancel", "Purchase order › Short close"],
         [("PC-SUPPLIER-CANNOT", "Supplier cannot supply"), ("PC-NOT-NEEDED", "Balance not needed"),
          ("PC-RATE", "Rate changed or not agreed"), ("PC-DELAY", "Supplier delayed too long"),
          ("PC-QUALITY", "Quality problems with the supplier"), ("PC-DUPLICATE", "Duplicate PO"),
          ("PC-ENTRY-ERROR", "PO made by mistake"), ("PC-OTHER", "Other (write a note)")]),
    _cat("PO_REVISION", "PO revision", "Purchase",
         ["Purchase order › Edit (new revision)"],
         [("PV-RATE", "Rate changed"), ("PV-QTY", "Quantity changed"), ("PV-DATE", "Delivery date changed"),
          ("PV-TERMS", "Payment or freight terms changed"), ("PV-ITEM", "Item or spec corrected"),
          ("PV-OTHER", "Other (write a note)")]),
    _cat("OVER_RECEIPT", "Receiving more than the PO", "Purchase",
         ["GRN › Receive more than ordered"],
         [("OR-ROLL-WEIGHT", "Full reel weighs more"), ("OR-MIN-LOT", "Supplier minimum lot"),
          ("OR-NEEDED", "Extra needed for production"), ("OR-TOLERANCE", "Within agreed tolerance"),
          ("OR-OTHER", "Other (write a note)")]),
    _cat("INVOICE_DIFF", "Invoice difference", "Purchase",
         ["Purchase › Invoice differences › Accept variance / Reject invoice / Release stock"],
         [("ID-RATE", "Rate difference agreed"), ("ID-FREIGHT", "Freight or loading charges"),
          ("ID-TAX", "Tax rounding / GST difference"), ("ID-QTY", "Quantity difference"),
          ("ID-WRONG-INVOICE", "Wrong invoice from the supplier"), ("ID-OTHER", "Other (write a note)")]),
    _cat("DEBIT_NOTE", "Debit note", "Purchase",
         ["Purchase › Debit notes › Raise", "Purchase › Debit notes › Void"],
         [("DN-SHORT", "Short supply"), ("DN-REJECT", "Material rejected / returned"), ("DN-RATE", "Rate difference"),
          ("DN-QUALITY", "Quality deduction"), ("DN-DAMAGE", "Transit damage"), ("DN-VOID-ERROR", "Made by mistake (void)"),
          ("DN-WEIGHT-SHORT", "Weighed short at QC"), ("DN-OTHER", "Other (write a note)")],
         added=("DN-WEIGHT-SHORT",)),
    # Weight check of a bill (6 Nov 2026): the Owner skips a debit note for a 20–50 kg shortage.
    _cat("WEIGHT_SHORT_SKIP", "Weight short · no debit note", "Purchase",
         ["Purchase › Weight differences › Skip", "Inbox › Weight short › Skip"],
         [("WS-VENDOR-CREDIT", "Vendor credit agreed"), ("WS-SCALE-DOUBT", "Scale doubt"),
          ("WS-TOLERANCE", "Within contract tolerance"), ("WS-OTHER", "Other (write a note)")],
         owner_only=True),
    _cat("SUPPLIER_SCHEDULE", "Supplier schedule change", "Purchase",
         ["Supplier schedules › Change a delivery", "RM calendar › Cancel a delivery"],
         [("SCH-SUPPLIER-DELAY", "Supplier asked to delay"), ("SCH-PLAN-CHANGE", "Production plan changed"),
          ("SCH-STOCK-OK", "Enough stock in hand"), ("SCH-TRANSPORT", "Transport problem"),
          ("SCH-RATE", "Rate or terms under discussion"), ("SCH-OTHER", "Other (write a note)")]),
    _cat("RM_COST_CHANGE", "RM cost change", "Purchase",
         ["Inventory › RM costing › Save audited draft"],
         [("RC-SUPPLIER-RATE", "Supplier rate changed"), ("RC-FREIGHT", "Freight or unloading changed"),
          ("RC-DISCOUNT", "Discount changed"), ("RC-NEW-ITEM", "First cost for a new material"),
          ("RC-CORRECTION", "Correct a wrong entry"), ("RC-OTHER", "Other (write a note)")]),
    _cat("PURCHASE_NEED", "Purchase requisition need", "Purchase",
         ["Purchase › Requisitions › Raise a requisition"],
         [("PN-REORDER", "Stock below reorder level"), ("PN-ORDER", "Needed for a sales order"),
          ("PN-NEW-PRODUCT", "New product or trial"), ("PN-MAINT", "Maintenance or consumables"),
          ("PN-SEASON", "Season stock build-up"), ("PN-OTHER", "Other (write a note)")]),
    # ── Specifications and season ──────────────────────────────────────────
    _cat("SPEC_REVISION", "Seasonal recipe revision", "Specifications",
         ["Specification › Revise a season's recipe"],
         [("RV-PAPER-CHANGE", "Paper changed or not available"), ("RV-STRENGTH", "Strength or C.S. improvement"),
          ("RV-CUSTOMER", "Customer asked for a change"), ("RV-COST", "Cost reduction"),
          ("RV-SEASON", "Season change"), ("RV-CORRECTION", "Correct a wrong entry"), ("RV-OTHER", "Other (write a note)")]),
    _cat("SEASON_SWITCH", "Production season switch", "Specifications",
         ["Settings › Production season › Switch season"],
         [("SW-MONSOON-START", "Monsoon started"), ("SW-MONSOON-END", "Monsoon ended"),
          ("SW-WEATHER", "Weather / humidity changed early or late"), ("SW-CORRECTION", "Switched by mistake, switching back"),
          ("SW-OTHER", "Other (write a note)")]),
    # ── Dispatch ───────────────────────────────────────────────────────────
    _cat("SURPLUS_RETAIN", "Surplus kept", "Dispatch",
         ["Dispatch › Surplus › Keep in stock"],
         [("SR-NEXT-ORDER", "Kept for the next order"), ("SR-CUST-LATER", "Customer will take it later"),
          ("SR-SAMPLE", "Kept as a sample"), ("SR-OTHER", "Other (write a note)")]),
    # ── Older lists no action reads (kept so existing rows stay valid) ──────
    _cat("QC_REJECT", "QC reject (not linked)", "Not linked yet", [], linked=False),
    _cat("RETURN", "Customer return (not linked)", "Not linked yet", [], linked=False),
    _cat("OTHER", "Other (general, not linked)", "Not linked yet", [], linked=False),
]

CATEGORY_BY_KEY = {row["key"]: row for row in CATEGORIES}
REASON_CATEGORIES = set(CATEGORY_BY_KEY)
OWNER_ONLY_REASON_CATEGORIES = {row["key"] for row in CATEGORIES if row["owner_only"]}


def category_label(key: Optional[str]) -> str:
    row = CATEGORY_BY_KEY.get(str(key or "").strip().upper())
    return row["label"] if row else str(key or "")


def public_catalog() -> list[dict[str, Any]]:
    """The category list the Masters page and the reason picker show (no seeds)."""
    return [
        {"key": row["key"], "label": row["label"], "group": row["group"], "used_in": row["used_in"],
         "owner_only": row["owner_only"], "linked": row["linked"], "standard_codes": [code for code, _ in row["seeds"]]}
        for row in CATEGORIES
    ]


class ReasonChoiceError(ValueError):
    """A reason choice the rules refuse; the message is shown to the user as is."""


def check_reason_choice(rows: Iterable[Any], category: Optional[str], code: Optional[str], note: Optional[str]) -> dict[str, Any]:
    """Pick the chosen code from ``rows`` (reason_code rows of the record's plant) and apply the rules.

    Returns {code, label, category, note, text, severity}. ``text`` is "Label — note", the legacy
    free-text form older screens and records read.
    """
    cat = str(category or "").strip().upper()
    wanted = str(code or "").strip().upper()
    extra = str(note or "").strip()
    if cat not in REASON_CATEGORIES:
        raise ReasonChoiceError(f"Unknown reason list {cat or '(none)'}.")
    if not wanted:
        raise ReasonChoiceError(f"Choose a reason from the list ({category_label(cat)}).")
    match = None
    for row in rows:
        get = row.get if isinstance(row, dict) else (lambda key, _row=row: getattr(_row, key, None))
        if str(get("code") or "").strip().upper() == wanted:
            match = {"code": wanted, "label": str(get("label") or wanted), "category": str(get("category") or "").upper(),
                     "active": bool(get("active") if get("active") is not None else True), "severity": get("severity")}
            break
    if match is None:
        raise ReasonChoiceError(
            f"{wanted} is not a reason in this plant's list '{category_label(cat)}'. Pick one from the list, "
            "or ask a Plant Manager, Admin or the Owner to add it in Masters › Reason codes."
        )
    if match["category"] != cat:
        raise ReasonChoiceError(f"{wanted} belongs to the list '{category_label(match['category'])}', not '{category_label(cat)}'. Pick a reason from the right list.")
    if not match["active"]:
        raise ReasonChoiceError(f"{wanted} ({match['label']}) is switched off in Masters › Reason codes. Pick an active reason.")
    if reason_needs_note(wanted) and len(extra) < OTHER_NOTE_MIN:
        raise ReasonChoiceError(f"Write a short note (at least {OTHER_NOTE_MIN} characters) for the reason '{match['label']}'.")
    text = f"{match['label']} — {extra}" if extra else match["label"]
    return {"code": wanted, "label": match["label"], "category": cat, "note": extra or None, "text": text, "severity": match["severity"]}
