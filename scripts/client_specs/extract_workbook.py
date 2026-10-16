#!/usr/bin/env python3
"""Convert the client's "Specification sheet completed" workbook into import data.

Run locally (needs openpyxl). The JSON it writes is committed and is all the
importer needs, so the production host never parses Excel.

    python3 scripts/client_specs/extract_workbook.py <workbook.xlsx> data/client_specs/<name>.json

Nothing is guessed silently: every assumption (missing mandrel, missing C.S.,
pending recipe, duplicate product) is written to the row's "notes" and to the
summary, and the importer prints them again.
"""
from __future__ import annotations

import collections
import json
import re
import sys
from datetime import date
from pathlib import Path

import openpyxl
from openpyxl.utils import column_index_from_string

SHEET = "Specification sheet "
FIRST_ROW = 6

# Paper grade columns (row 4 header) in workbook order; values are ply counts.
PAPER_COLUMNS = {"U": "220", "V": "230", "W": "301", "X": "350", "Y": "355", "Z": "351", "AA": "352", "AB": "353", "AC": "354", "AD": "401"}
PARCHMENT_COLUMNS = {"L": "AMMA", "M": "SAGAR", "N": "SHANDONG", "O": "SWARAJ", "P": "TEXTONE"}
ADHESIVE_COLUMNS = {
    "Q": ("TL4LV", "TL4 LV / 21100 (top adhesive)"),
    "R": ("20100", "Vinsol / 20100 (synthetic)"),
    "S": ("30100", "Acosol / 30100 (china clay)"),
    "T": ("650", "650 (high strength)"),
}
NOTCH_COLUMNS = ["AG", "AH", "AI", "AJ", "AK", "AL", "AM"]
BLADE_COLUMNS = ["AN", "AO", "AP", "AQ", "AR", "AS", "AT", "AU"]
HOLDER_COLUMNS = ["AV", "AW", "AX", "AY", "AZ", "BA", "BB"]
VFLAT_COLUMNS = ["BC", "BD", "BE"]
PUNCH_COLUMNS = ["BF", "BG", "BH"]
DIRECTION_COLUMNS = ["BI", "BJ"]
WORKBOOK_QC = {
    "winding_length": ("BW", "BX", "BY"), "winding_weight": ("BZ", "CA", "CB"), "winding_id": ("CC", "CD", "CE"),
    "winding_od": ("CF", "CG", "CH"), "winding_cs": ("CI", "CJ", "CK"), "oven_weight": ("CL", "CM", "CN"),
    "oven_cs": ("CO", None, "CP"), "oven_length": ("CQ", "CR", "CS"), "process_id": ("CT", "CU", "CV"),
    "process_od": ("CW", "CX", "CY"), "process_cs": ("CZ", None, "DA"), "process_weight": ("DB", "DC", "DD"),
}
SIZE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*(.*)$", re.I)


def text(value) -> str:
    return re.sub(r"\s+", " ", str(value)).strip() if value is not None else ""


def number(value):
    """A cell number; "10.5MM" counts, "Pending", "-" and "#VALUE!" do not."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    match = re.fullmatch(r"(-?\d+(?:\.\d+)?)\s*(mm|g|kg)?", str(value).strip(), re.I)
    return float(match.group(1)) if match else None


def yes(value) -> bool:
    return text(value).lower() in {"yes", "y", "true", "1"}


def header_label(ws, column: str) -> str:
    return text(ws.cell(2, column_index_from_string(column)).value).strip(" ,")


def chosen(ws, row: int, columns: list[str], skip=("NA", "NONE")) -> str | None:
    labels = [header_label(ws, c) for c in columns if yes(ws.cell(row, column_index_from_string(c)).value)]
    labels = [label for label in labels if label.upper() not in skip]
    return ", ".join(labels) or None


def main(source: str, target: str) -> None:
    ws = openpyxl.load_workbook(source, data_only=True)[SHEET]
    cell = lambda r, c: ws.cell(r, column_index_from_string(c)).value  # noqa: E731
    rows = []
    client = None
    for r in range(FIRST_ROW, ws.max_row + 1):
        a = text(cell(r, "A"))
        variant_label = None
        if a:
            if a[0].isdigit():
                variant_label = a  # e.g. "95 FDY HCS", "7mm notch" sit under the client above
            else:
                client = a
        size_text = text(cell(r, "D"))
        if not size_text or not client:
            continue
        match = SIZE.match(size_text)
        notes: list[str] = []
        if not match:
            rows.append({"row": r, "client": client, "size_text": size_text, "skip": f"Tube size '{size_text}' is not I.D. x O.D. x length"})
            continue
        id_mm, od_mm, length_mm = (float(match.group(i)) for i in (1, 2, 3))
        variant = re.sub(r"\[\s*", "[", re.sub(r"\s*\]", "]", match.group(4))).strip()
        variant = " · ".join(part for part in (variant, variant_label) if part)
        weight = number(cell(r, "H"))
        cs = number(cell(r, "I"))
        if not weight or weight <= 0:
            rows.append({"row": r, "client": client, "size_text": size_text, "skip": "Tube weight is missing"})
            continue
        if not cs or cs <= 0:
            notes.append("Required C.S. missing in workbook — stage C.S. checks stay blocked until it is set")
            cs = 0.0
        mandrel = number(cell(r, "B"))
        if mandrel and abs(mandrel - id_mm) > 1.5:
            notes.append(f"Workbook mandrel {mandrel:g} does not fit I.D. {id_mm:g}; mandrel inferred instead")
            mandrel = None
        plies = []
        for column, grade in PAPER_COLUMNS.items():
            count = cell(r, column)
            if isinstance(count, (int, float)) and not isinstance(count, bool) and count > 0:
                plies.append({"grade": grade, "count": int(count)})
        adhesive = []
        for column, (code, name) in ADHESIVE_COLUMNS.items():
            share = cell(r, column)
            if isinstance(share, (int, float)) and not isinstance(share, bool) and share > 0:
                adhesive.append({"item_code": code, "name": name, "ratio_percent": round(float(share) * 100, 4), "base_percent": 12.5})
        if adhesive:
            drift = round(100 - sum(c["ratio_percent"] for c in adhesive), 4)
            adhesive[-1]["ratio_percent"] = round(adhesive[-1]["ratio_percent"] + drift, 4)
        if not plies:
            notes.append("Paper recipe pending in workbook")
        if not adhesive:
            notes.append("Adhesive split pending in workbook")
        families = [name for column, name in PARCHMENT_COLUMNS.items() if yes(cell(r, column))]
        qc = {}
        for key, (low, mid, high) in WORKBOOK_QC.items():
            qc[key] = [number(cell(r, low)), number(cell(r, mid)) if mid else None, number(cell(r, high))]
        rows.append({
            "row": r,
            "client": client,
            "size_text": size_text,
            "id_mm": id_mm, "od_mm": od_mm, "length_mm": length_mm,
            "variant": variant or None,
            "mandrel_mm": mandrel,
            "tube_weight_g": weight,
            "target_dry_g": number(cell(r, "G")) or weight,
            "required_cs": cs,
            "measured_dry_g": number(cell(r, "K")),
            "actual_height_mm": number(cell(r, "E")),
            "parchment_families": families,
            "plies": plies,
            "adhesive": adhesive,
            "white_kraft_liner": yes(cell(r, "AE")),
            "notch": {
                "type": chosen(ws, r, NOTCH_COLUMNS),
                "blade": chosen(ws, r, BLADE_COLUMNS),
                "holder": chosen(ws, r, HOLDER_COLUMNS),
                "v_flat": chosen(ws, r, VFLAT_COLUMNS),
                "punch": chosen(ws, r, PUNCH_COLUMNS),
                "direction": chosen(ws, r, DIRECTION_COLUMNS),
                "distance_mm": number(cell(r, "BK")),
                "depth_mm": number(cell(r, "BL")),
                "height_gauge": text(cell(r, "BM")) or None,
            },
            "packing": {
                "box": text(cell(r, "BO")) or None,
                "qty_per_box": number(cell(r, "BR")),
                "fadda": yes(cell(r, "BQ")),
                "fadda_per_box": number(cell(r, "BU")),
                "special_instructions": text(cell(r, "BV")) or None,
            },
            "workbook_qc": qc,
            "notes": notes,
        })
    # Rows with the same customer, size, variant, weight and C.S. are separate
    # products only if something else differs; tell them apart by tooling.
    groups = collections.defaultdict(list)
    for row in rows:
        if "skip" not in row:
            groups[(row["client"].lower(), row["id_mm"], row["od_mm"], row["length_mm"], (row["variant"] or "").lower(), row["tube_weight_g"], row["required_cs"])].append(row)
    for group in groups.values():
        if len(group) < 2:
            continue
        for row in group:
            signature = json.dumps({k: row[k] for k in ("plies", "adhesive", "notch", "packing", "parchment_families")}, sort_keys=True)
            row["_signature"] = signature
        seen = {}
        for row in group:
            if row["_signature"] in seen:
                row["skip"] = f"Duplicate of sheet row {seen[row['_signature']]} (identical product)"
            else:
                seen[row["_signature"]] = row["row"]
        distinct = [row for row in group if "skip" not in row]
        if len(distinct) > 1:
            def tooling(row):
                notch = row["notch"]
                tool = notch["type"] or notch["blade"] or notch["holder"]
                if not tool:
                    return None
                return f"notch {tool}" + (f" {notch['distance_mm']:g} mm" if notch["distance_mm"] else "")
            tags = [tooling(row) for row in distinct]
            for row, tag in zip(distinct, tags):
                if not tag or tags.count(tag) > 1:
                    tag = f"sheet row {row['row']}"
                row["variant"] = " · ".join(part for part in (row["variant"], tag) if part)
    # Missing (or impossible) mandrels: use the mandrel the client uses most for
    # that I.D.; only if the I.D. has none anywhere, assume I.D. + 0.5 mm.
    usage = collections.defaultdict(collections.Counter)
    for row in rows:
        if "skip" not in row and row["mandrel_mm"]:
            usage[row["id_mm"]][row["mandrel_mm"]] += 1
    for row in rows:
        if "skip" in row or row["mandrel_mm"]:
            continue
        if usage[row["id_mm"]]:
            row["mandrel_mm"] = usage[row["id_mm"]].most_common(1)[0][0]
            row["notes"].append(f"Mandrel not given; using {row['mandrel_mm']:g} mm, the client's usual mandrel for I.D. {row['id_mm']:g}")
        else:
            row["mandrel_mm"] = round(row["id_mm"] + 0.5, 2)
            row["notes"].append(f"Mandrel not given and none used for I.D. {row['id_mm']:g} elsewhere; assumed {row['mandrel_mm']:g} mm — confirm on the spec")
            row["mandrel_assumed"] = True
        for row in group:
            row.pop("_signature", None)
    importable = [row for row in rows if "skip" not in row]
    summary = {
        "source": Path(source).name,
        "extracted_on": date.today().isoformat(),
        "rows": len(rows),
        "importable": len(importable),
        "skipped": [{"row": row["row"], "client": row["client"], "size": row["size_text"], "reason": row["skip"]} for row in rows if "skip" in row],
        "recipe_pending": sum(1 for row in importable if not row["plies"]),
        "mandrel_inferred": sum(1 for row in importable if any(note.startswith("Mandrel not given") or note.startswith("Workbook mandrel") for note in row["notes"])),
        "mandrel_assumed": [row["row"] for row in importable if row.get("mandrel_assumed")],
        "cs_missing": [row["row"] for row in importable if not row["required_cs"]],
        "clients": len({row["client"] for row in importable}),
    }
    Path(target).parent.mkdir(parents=True, exist_ok=True)
    Path(target).write_text(json.dumps({"summary": summary, "rows": rows}, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
