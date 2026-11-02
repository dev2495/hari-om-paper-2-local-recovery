#!/usr/bin/env python3
"""Convert the client's 2 Nov 2026 workbooks into the JSON the importers use.

Run locally (needs openpyxl); treat the workbooks as untrusted data (python3 -I):

    python3 -I scripts/client_import/extract_workbooks.py "<SPECS SHEET.xlsx>" "<Sales Orders.xlsx>" data/client_import_2026-11-02

Writes spec_packing.json (packing columns of sheet "SPECS") and sales_orders.json
(outstanding lines of the Tally "Sales Orders (Due Only)" export). The production host
never parses Excel. Every skipped row is listed with its reason.

The "SPECS" sheet layout differs from the earlier "Specification sheet" workbook that
scripts/client_specs/extract_workbook.py reads (columns moved, weights in kg): only the
packing columns are taken from it here.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

import openpyxl
from openpyxl.utils import column_index_from_string

SPEC_SHEET = "SPECS"
SPEC_FIRST_ROW = 6
# Packing block, row 3 headers of sheet "SPECS".
PACKING_HEADERS = {
    "BK": "BOX MASTER", "BL": "PLASTIC SKU", "BM": "FADA SKU", "BN": "QTY PER BOX",
    "BO": "BOPP REQUIRED", "BP": "PLASTIC PCS PER BOX", "BQ": "FADA PCS PER BPX",
}
SIZE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s*(?:mm?)?\s*(.*)$", re.I)
# Column A holds client names, but also legend marks: "ok", "yash ok", single letters.
LEGEND = re.compile(r"^((yash\s+)?ok|[A-Z]\d?)$", re.I)

SO_SHEET = "Sales Orders(Due Only)"
SO_HEADER_ROW = 8


def text(value) -> str:
    return re.sub(r"\s+", " ", str(value)).strip() if value is not None else ""


def number(value):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    match = re.fullmatch(r"(-?\d+(?:\.\d+)?)\s*(mm|g|kg|pcs?)?", str(value).strip(), re.I)
    return float(match.group(1)) if match else None


def box_code(raw: str) -> str:
    """R.125 = R-125, HBD 3 PLY = HBD-3 PLY, N.225 = N-225; JP-93.75 keeps its decimal."""
    value = re.sub(r"\s+", " ", raw.strip().upper())
    match = re.fullmatch(r"([A-Z]+)\s*[.\-\s]\s*(\d.*)", value)
    return f"{match.group(1)}-{match.group(2)}" if match else value


def variant_of(rest: str, label: str | None) -> str | None:
    rest = re.sub(r"\[\s*", "[", re.sub(r"\s*\]", "]", rest)).strip()
    return " · ".join(part for part in (rest, label) if part) or None


def extract_packing(path: str) -> dict:
    ws = openpyxl.load_workbook(path, data_only=True)[SPEC_SHEET]
    cell = lambda r, c: ws.cell(r, column_index_from_string(c)).value  # noqa: E731
    for column, header in PACKING_HEADERS.items():
        found = text(cell(3, column)).upper()
        if found != header:
            raise SystemExit(f"Sheet {SPEC_SHEET} column {column} row 3 is '{found}', expected '{header}'; the layout changed")
    rows, client = [], None
    last = max(r for r in range(SPEC_FIRST_ROW, min(ws.max_row, 5000) + 1) if any(cell(r, c) not in (None, "") for c in ("A", "D", "BK", "BN")))
    for r in range(SPEC_FIRST_ROW, last + 1):
        a = text(cell(r, "A"))
        label = None
        if a:
            if a[0].isdigit():
                label = a  # "95 FDY HCS", "7mm notch" sit under the client above
            elif not LEGEND.match(a):
                client = a
        size_text = text(cell(r, "D"))
        raw_box = text(cell(r, "BK"))
        if not size_text and not raw_box:
            continue
        row = {"row": r, "client": client, "size_text": size_text}
        match = SIZE.match(size_text)
        if not client:
            row["skip"] = "No client above this row"
        elif not match:
            row["skip"] = f"Tube size '{size_text}' is not I.D. x O.D. x length"
        if match:
            row.update(id_mm=float(match.group(1)), od_mm=float(match.group(2)), length_mm=float(match.group(3)), variant=variant_of(match.group(4), label))
        weight = number(cell(r, "F"))
        if weight is not None:
            row["tube_weight_g"] = round(weight * 1000, 3) if weight < 20 else weight  # the sheet gives kg
        qty = number(cell(r, "BN"))
        fadda_raw = text(cell(r, "BM"))
        row["packing"] = {
            "box_raw": raw_box or None,
            "box_code": box_code(raw_box) if raw_box else None,
            "qty_per_box": qty,
            "plastic_raw": text(cell(r, "BL")) or None,
            "plastic_per_box": number(cell(r, "BP")),
            "fadda_raw": fadda_raw or None,
            "fadda": bool(fadda_raw) and fadda_raw.upper() not in {"NO", "N", "NA", "0"},
            "fadda_per_box": number(cell(r, "BQ")),
            "bopp_raw": text(cell(r, "BO")) or None,
            "special_instructions": text(cell(r, "BR")) or None,
        }
        if "skip" not in row and not raw_box:
            row["skip"] = "No box in the sheet"
        elif "skip" not in row and (qty is None or qty <= 0 or qty != int(qty)):
            row["skip"] = f"Qty per box '{cell(r, 'BN')}' is not a whole number"
        rows.append(row)
    usable = [row for row in rows if "skip" not in row]
    return {
        "summary": {
            "source": Path(path).name, "sheet": SPEC_SHEET, "extracted_on": date.today().isoformat(),
            "rows": len(rows), "with_packing": len(usable),
            "box_codes": sorted({row["packing"]["box_code"] for row in usable}),
            "box_code_spellings": sorted({f"{row['packing']['box_raw']} -> {row['packing']['box_code']}" for row in usable if row["packing"]["box_raw"] != row["packing"]["box_code"]}),
            "sheet_defaults": "Plastic SKU blank everywhere (header: all default yes, 1 pc per box); fadda only where FADA SKU says YES (count from FADA PCS PER BOX); BOPP blank everywhere (header: all default yes).",
            "skipped": [{"row": row["row"], "client": row["client"], "size": row["size_text"], "reason": row["skip"]} for row in rows if "skip" in row],
        },
        "rows": rows,
    }


def as_date(value):
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return None


def extract_orders(path: str) -> dict:
    ws = openpyxl.load_workbook(path, data_only=True)[SO_SHEET]
    header = [text(ws.cell(SO_HEADER_ROW, c).value) for c in range(1, 12)]
    expected = ["Date", "Order", "Party's Name", "Name of Item", "Ordered", "Balance", "Rate", "Discount", "Value", "Due on", "OverDue"]
    if header != expected:
        raise SystemExit(f"Header row {SO_HEADER_ROW} is {header}, expected {expected}")
    lines, section, skipped = [], None, []
    period = text(ws.cell(7, 1).value)
    for r in range(SO_HEADER_ROW + 1, ws.max_row + 1):
        values = [ws.cell(r, c).value for c in range(1, 12)]
        a = text(values[0])
        if a.lower().startswith("sales orders outstanding"):
            section = "outstanding"
            continue
        if a.lower().startswith("goods delivered but orders not"):
            section = "delivered_not_ordered"
            continue
        if section != "outstanding":
            continue
        if not isinstance(values[0], (datetime, date)):
            if any(v not in (None, "") for v in values):
                skipped.append({"row": r, "reason": "total row" if values[1] is not None and not values[2] else "not an order line"})
            continue
        balance = number(values[5])
        line = {
            "row": r, "date": as_date(values[0]), "order_no": text(values[1]), "party": text(values[2]), "item": text(values[3]),
            "ordered_qty": number(values[4]), "balance_qty": balance, "rate": number(values[6]), "discount": number(values[7]),
            "value": number(values[8]), "due_on": as_date(values[9]), "overdue": text(values[10]) or None,
        }
        if not line["order_no"] or not line["party"] or not line["item"]:
            line["skip"] = "Order number, party or item missing"
        elif balance is None or balance <= 0:
            line["skip"] = "No outstanding balance"
        lines.append(line)
    orders = {}
    for line in lines:
        if "skip" in line:
            continue
        orders.setdefault((line["order_no"], line["party"]), []).append(line["row"])
    return {
        "summary": {
            "source": Path(path).name, "sheet": SO_SHEET, "period": period, "extracted_on": date.today().isoformat(),
            "outstanding_lines": len([l for l in lines if "skip" not in l]), "orders": len(orders),
            "balance_total": sum(l["balance_qty"] for l in lines if "skip" not in l),
            "skipped": skipped + [{"row": l["row"], "reason": l["skip"]} for l in lines if "skip" in l],
            "ignored_block": "Goods delivered but Orders not Recd. (negative balances) is not imported",
        },
        "lines": lines,
    }


def main(specs_path: str, orders_path: str, target: str) -> None:
    out = Path(target)
    out.mkdir(parents=True, exist_ok=True)
    packing = extract_packing(specs_path)
    orders = extract_orders(orders_path)
    (out / "spec_packing.json").write_text(json.dumps(packing, indent=1, ensure_ascii=False) + "\n")
    (out / "sales_orders.json").write_text(json.dumps(orders, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps({"spec_packing": {k: v for k, v in packing["summary"].items() if k != "skipped"}, "sales_orders": {k: v for k, v in orders["summary"].items() if k != "skipped"}}, indent=1))


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    main(*sys.argv[1:])
