#!/usr/bin/env python3
"""Apply the packing columns of the client's SPECS sheet to the existing specs.

Data: data/client_import_2026-11-02/spec_packing.json (from extract_workbooks.py).
Each sheet row is matched to existing active specs of the plant by customer + tube size
(I.D. x O.D. x length, then the variant text, then the tube weight when several specs
share a size). A spec gets the packing only when every sheet row that matches it says the
same thing. Packing is saved through the app's own packing amendment
(PUT /api/spec/specifications/{id}/packing: audited, no re-approval, pushed into open job
cards). Box masters the sheet names but the plant does not have yet are created first
(codes normalised: R.125 = R-125, HBD 3 PLY = HBD-3 PLY) with blank size and weight, and
listed for the plant to fill. Plastic and fadda default to the single active master
(owner decision 5 of 1 Nov 2026); the sheet leaves the plastic SKU blank ("all default
yes", 1 per box) and marks fadda YES with its count per box.

Preview (default) changes nothing. --apply writes. Idempotent: an unchanged spec is
skipped and a repeated save is replayed by the spec service.

    python scripts/client_import/apply_spec_packing.py --plant PLANT_A --report /tmp/packing.json [--apply]
"""
from __future__ import annotations

import argparse
import re
import hashlib
import json
import sys
import uuid
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (  # noqa: E402
    CustomerResolver, add_common_args, loose_key, base_variant, box_code, connect, dims_equal, name_key, near, variant_key, write_reports,
)

NAMESPACE = "client-import-2026-11-02:spec-packing"


def fmt(value) -> str:
    if value in (None, ""):
        return ""
    value = float(value)
    return str(int(value)) if value == int(value) else f"{value:g}"


def size_of(tube) -> str:
    return f"{fmt(tube['inner_diameter_mm'])} x {fmt(tube['outer_diameter_mm'])} x {fmt(tube['length_mm'])}"


def box_key(code) -> str:
    """Box code without punctuation, spaces or case: 'R-150_3PLY' -> 'R1503PLY', 'HBD 5 PLY' -> 'HBD5PLY'."""
    return re.sub(r"[^A-Z0-9]", "", str(code or "").upper())


def resolve_box(sheet_code, current_code, masters):
    """Map the sheet's box code onto an EXISTING active box master (owner rule 2 Nov 2026: never make look-alike
    duplicates of masters the plant already uses). Returns (code, note); code None means 'decide by hand'."""
    boxes = {code: row for code, row in masters.items() if row.get("kind") == "BOX" and row.get("active", True)}
    want = box_key(sheet_code)
    current = (current_code or "").upper()
    exact = [code for code in boxes if box_key(code) == want]
    if exact:
        return (current if current in exact else exact[0]), None
    family = [code for code in boxes if box_key(code).startswith(want)]
    if current in boxes and (current in family or box_key(current).startswith(want)):
        return current, None
    if len(family) == 1:
        return family[0], f"sheet box {sheet_code} is master {family[0]}"
    if len(family) > 1:
        return None, f"sheet box {sheet_code} fits several masters ({', '.join(sorted(family))}); pick one on Packing setup"
    return sheet_code, None


def wanted_packing(row, masters, defaults, problems, current=None):
    current = current or {}
    sheet = row["packing"]
    plastic_raw = (sheet.get("plastic_raw") or "").strip()
    plastic = plastic_raw.upper() if plastic_raw and plastic_raw.upper() not in {"YES", "Y"} else (defaults.get("plastic_sku") or "")
    if plastic_raw.upper() in {"NO", "N", "NA"}:
        plastic = ""
    if not plastic_raw and current.get("plastic_sku"):
        plastic = current["plastic_sku"]
    if not plastic:
        problems.append("no single active plastic master to default to; plastic left blank")
    fadda = ""
    fadda_count = None
    if sheet.get("fadda"):
        raw = (sheet.get("fadda_raw") or "").strip().upper()
        fadda = raw if raw in masters and masters[raw].get("kind") == "FADDA" else (defaults.get("fadda_sku") or "")
        fadda_count = sheet.get("fadda_per_box")
        if not fadda:
            problems.append("fadda YES but no single active fadda master; fadda left blank")
        elif not fadda_count:
            problems.append("fadda YES but no fadda pcs per box; fadda left blank")
            fadda = ""
    if not sheet.get("fadda") and current.get("fadda_sku") and current.get("fadda_per_box"):
        # The sheet is silent on fadda: keep what the spec already has.
        fadda, fadda_count = current["fadda_sku"], current["fadda_per_box"]
    return {
        "box_code": sheet["box_code"],
        "qty_per_box": int(sheet["qty_per_box"]),
        "plastic_sku": plastic or None,
        "plastic_per_box": (sheet.get("plastic_per_box") or current.get("plastic_per_box") or 1) if plastic else None,
        "fadda_sku": fadda or None,
        "fadda_per_box": fadda_count if fadda else None,
    }


def same_packing(current, wanted) -> bool:
    def num(value):
        return float(value) if value not in (None, "") else 0.0
    return (
        (current.get("box_code") or "").upper() == wanted["box_code"].upper()
        and num(current.get("qty_per_box")) == num(wanted["qty_per_box"])
        and (current.get("plastic_sku") or "").upper() == (wanted["plastic_sku"] or "").upper()
        and (num(current.get("plastic_per_box")) if current.get("plastic_sku") else 0.0) == num(wanted["plastic_per_box"])
        and (current.get("fadda_sku") or "").upper() == (wanted["fadda_sku"] or "").upper()
        and (num(current.get("fadda_per_box")) if current.get("fadda_sku") else 0.0) == num(wanted["fadda_per_box"])
    )


def describe(p) -> str:
    if not p:
        return "none"
    text = f"{p.get('box_code') or '-'} x {fmt(p.get('qty_per_box')) or '-'}"
    text += f", plastic {p['plastic_sku']} x {fmt(p.get('plastic_per_box'))}" if p.get("plastic_sku") else ", no plastic"
    text += f", fadda {p['fadda_sku']} x {fmt(p.get('fadda_per_box'))}" if p.get("fadda_sku") else ", no fadda"
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_common_args(parser)
    args = parser.parse_args()
    data_dir = Path(args.data_dir)
    data = json.loads((data_dir / "spec_packing.json").read_text())
    erp, plant, ApiError = connect(args)
    bff = args.bff_url.rstrip("/")
    print(f"Spec packing from {data['summary']['source']} into plant {plant.get('code')} ({'APPLY' if args.apply else 'preview'})", flush=True)

    setup = erp.call("GET", bff, "/api/spec/specifications/packing-setup")
    specs = [s for s in setup["items"] if str(s.get("plant_id")) == args.plant]
    tubes = {str(t["id"]): t for t in erp.call("GET", bff, "/api/master/tube-sizes?include_inactive=true")}
    resolver = CustomerResolver(erp.call("GET", bff, "/api/master/customers"), data_dir / "customer_aliases.json")
    weights = erp.call("GET", bff, "/api/master/packaging/unit-weights?include_inactive=true")
    masters = {code.upper(): row for code, row in (weights.get("by_code") or {}).items()}
    defaults = erp.call("GET", bff, "/api/master/packaging/defaults")

    report = {"plant": plant.get("code"), "apply": args.apply, "source": data["summary"]["source"], "defaults": defaults,
              "sheet_rows": [], "specs": [], "boxes_created": [], "boxes_inactive": [], "sheet_rows_without_spec": [],
              "specs_not_in_sheet": [], "conflicts": [], "sheet_skipped": data["summary"]["skipped"], "notes": []}
    matches: dict[str, list[dict]] = defaultdict(list)
    for row in data["rows"]:
        if "skip" in row:
            continue
        customer, how = resolver.resolve(row["client"])
        entry = {"row": row["row"], "client": row["client"], "size": row["size_text"], "variant": row.get("variant"), "box": row["packing"]["box_raw"], "customer_match": how}
        # Specs carry their own customer name from the spec import; match on it as well as on the customer master.
        own = [s for s in specs if loose_key(s.get("customer_name")) == loose_key(row["client"])
               or (customer is not None and (str(s.get("customer_id") or "") == str(customer["id"]) or loose_key(s.get("customer_name")) == loose_key(customer["name"])))]
        if customer is None and not own:
            entry["result"] = f"customer not found: {how}"
            report["sheet_rows_without_spec"].append(entry)
            report["sheet_rows"].append(entry)
            continue
        entry["customer"] = customer["name"] if customer is not None else row["client"]
        same_size = [s for s in own if (t := tubes.get(str(s.get("tube_size_id")))) and dims_equal(t["inner_diameter_mm"], row["id_mm"]) and dims_equal(t["outer_diameter_mm"], row["od_mm"]) and dims_equal(t["length_mm"], row["length_mm"])]
        candidates = same_size
        if len(candidates) > 1:
            by_variant = [s for s in candidates if variant_key(base_variant(tubes[str(s["tube_size_id"])].get("description"))) == variant_key(row.get("variant"))]
            candidates = by_variant or candidates
        if len(candidates) > 1 and row.get("tube_weight_g"):
            by_weight = [s for s in candidates if s.get("target_tube_weight") is not None and abs(float(s["target_tube_weight"]) - row["tube_weight_g"]) < 0.51]
            candidates = by_weight or candidates
        if not candidates:
            hints = [f"{size_of(tubes[str(s['tube_size_id'])])} {base_variant(tubes[str(s['tube_size_id'])].get('description'))}".strip()
                     for s in own if (t := tubes.get(str(s.get("tube_size_id")))) and near(t["inner_diameter_mm"], row["id_mm"], 0.6) and near(t["outer_diameter_mm"], row["od_mm"], 0.6) and near(t["length_mm"], row["length_mm"], 0.6)]
            entry["result"] = "no spec with this customer and size" + (f" (near: {'; '.join(hints)})" if hints else "")
            report["sheet_rows_without_spec"].append(entry)
        else:
            problems: list[str] = []
            entry.update(result=f"matches {len(candidates)} spec(s)", spec_ids=[s["id"] for s in candidates], problems=problems)
            for spec in candidates:
                current = spec.get("packing") or {}
                wanted = wanted_packing(row, masters, defaults, problems, current)
                code, note = resolve_box(wanted["box_code"], current.get("box_code"), masters)
                if code is None:
                    report["conflicts"].append({"spec_id": spec["id"], "spec": spec.get("customer_name"), "rows": [row["row"]], "packings": [note]})
                    continue
                wanted["box_code"] = code
                if note:
                    problems.append(note)
                entry["wanted"] = wanted
                matches[spec["id"]].append({"row": row["row"], "wanted": wanted})
        report["sheet_rows"].append(entry)

    # A spec takes the packing only if every sheet row that matched it agrees.
    plan = []
    by_id = {s["id"]: s for s in specs}
    for spec_id, rows in matches.items():
        spec = by_id[spec_id]
        tube = tubes.get(str(spec.get("tube_size_id"))) or {}
        label = f"{spec.get('customer_name')} {size_of(tube)} {base_variant(tube.get('description'))}".strip()
        distinct = {json.dumps(r["wanted"], sort_keys=True) for r in rows}
        how = None
        if len(distinct) > 1:
            # Look-alike specs (same customer, size, variant and weight): keep the sheet row whose box and
            # qty per box the spec already carries from the earlier import, if exactly one does.
            current = spec.get("packing") or {}
            same = [r for r in rows if box_code(current.get("box_code")) == r["wanted"]["box_code"] and float(current.get("qty_per_box") or 0) == r["wanted"]["qty_per_box"]]
            if len({json.dumps(r["wanted"], sort_keys=True) for r in same}) != 1:
                report["conflicts"].append({"spec_id": spec_id, "spec": label, "rows": [r["row"] for r in rows], "packings": [describe(r["wanted"]) for r in rows]})
                continue
            rows, how = same, "several sheet rows fit; kept the one with the spec's current box and qty per box"
        plan.append({"spec": spec, "label": label, "customer": spec.get("customer_name"), "rows": sorted(r["row"] for r in rows), "wanted": rows[0]["wanted"], "how": how})
    for spec in specs:
        if spec["id"] not in matches:
            tube = tubes.get(str(spec.get("tube_size_id"))) or {}
            report["specs_not_in_sheet"].append({"spec_id": spec["id"], "spec": f"{spec.get('customer_name')} {size_of(tube)} {base_variant(tube.get('description'))}".strip(), "current": describe(spec.get("packing")), "complete": spec.get("complete")})

    # Box masters the plan needs.
    needed = sorted({p["wanted"]["box_code"] for p in plan})
    for code in needed:
        row = masters.get(code)
        if row and row.get("kind") == "BOX" and row.get("active", True):
            continue
        if row:
            report["boxes_inactive"].append({"code": code, "kind": row.get("kind"), "active": row.get("active")})
            continue
        users = sorted({str(p["customer"]) for p in plan if p["wanted"]["box_code"] == code})
        entry = {"code": code, "specs": sum(1 for p in plan if p["wanted"]["box_code"] == code), "status": "would create" if not args.apply else "created"}
        if args.apply:
            try:
                created = erp.call("POST", bff, "/api/master/packaging/boxes", {"code": code, "length_mm": 0, "width_mm": 0, "height_mm": 0, "size_label": "", "weight_kg": None})
                entry["id"] = created.get("id")
                masters[code] = {"kind": "BOX", "code": code, "active": True}
            except ApiError as exc:
                if exc.status == 409:
                    entry["status"] = "already there"
                    masters[code] = {"kind": "BOX", "code": code, "active": True}
                else:
                    entry["status"] = f"failed: HTTP {exc.status} {exc.detail}"
        entry["used_by_customers"] = users
        report["boxes_created"].append(entry)
    blocked_boxes = {b["code"] for b in report["boxes_inactive"]} | {b["code"] for b in report["boxes_created"] if b["status"].startswith("failed")}

    statuses = Counter()
    for item in plan:
        spec, wanted = item["spec"], item["wanted"]
        result = {"spec_id": spec["id"], "spec": item["label"], "sheet_rows": item["rows"], "before": describe(spec.get("packing")), "after": describe(wanted), "how": item.get("how")}
        if wanted["box_code"] in blocked_boxes:
            result["status"] = f"skipped: box {wanted['box_code']} master is inactive or could not be created"
        elif same_packing(spec.get("packing") or {}, wanted):
            result["status"] = "unchanged"
        elif not args.apply:
            result["status"] = "would update"
        else:
            body = {
                "request_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"{NAMESPACE}:{args.plant}:{spec['id']}:{hashlib.sha256(json.dumps(wanted, sort_keys=True).encode()).hexdigest()[:16]}")),
                "expected_version": spec.get("write_revision"),
                "box_code": wanted["box_code"], "qty_per_box": wanted["qty_per_box"],
                "plastic_sku": wanted["plastic_sku"], "plastic_per_box": wanted["plastic_per_box"],
                "fadda_sku": wanted["fadda_sku"], "fadda_per_box": wanted["fadda_per_box"],
                "note": f"Client SPECS sheet 2 Nov 2026 ({data['summary']['source']}), sheet row(s) {', '.join(map(str, item['rows']))}",
            }
            try:
                out = erp.call("PUT", bff, f"/api/spec/specifications/{spec['id']}/packing", body)
                result["status"] = "replayed" if out.get("replayed") else ("updated" if out.get("amended") else "unchanged")
                result["job_cards"] = (out.get("job_cards") or {}).get("updated")
            except ApiError as exc:
                result["status"] = f"failed: HTTP {exc.status} {exc.detail}"
        statuses[result["status"].split(":")[0]] += 1
        report["specs"].append(result)

    report["summary"] = {
        "sheet_rows_with_packing": data["summary"]["with_packing"], "active_specs": len(specs),
        "specs_matched": len(plan), **dict(statuses), "conflicts": len(report["conflicts"]),
        "sheet_rows_without_spec": len(report["sheet_rows_without_spec"]), "specs_not_in_sheet": len(report["specs_not_in_sheet"]),
        "boxes_to_create": len(report["boxes_created"]),
    }
    report["notes"].append("BOPP REQUIRED is blank in the sheet (header: all default yes). BOPP is not part of the packing amendment, so the specs keep their BOPP setting (the earlier import set it to yes).")
    report["notes"].append("Specs that are in the new sheet but not in the ERP are listed, not created: the sheet's layout differs from the workbook the spec importer reads (columns moved, weights in kg), so they need a reviewed mapping or entry in the spec sheet screen.")
    write_reports(args.report, report, text_report(report))
    sys.exit(1 if statuses.get("failed") else 0)


def text_report(r) -> str:
    s = r["summary"]
    out = [f"SPEC PACKING ({'APPLIED' if r['apply'] else 'PREVIEW'}) · plant {r['plant']} · {r['source']}", json.dumps(s), "",
           f"Defaults: plastic {r['defaults'].get('plastic_sku') or 'none'}, fadda {r['defaults'].get('fadda_sku') or 'none'} (single active masters)", ""]
    out.append(f"Box masters to create ({len(r['boxes_created'])}; size and weight left blank for the plant to fill in Masters > Packaging):")
    out += [f"  - {b['code']} ({b['specs']} spec(s)) {b['status']}" for b in r["boxes_created"]] or ["  (none)"]
    if r["boxes_inactive"]:
        out.append("Box codes that exist but are inactive or not a box (specs skipped):")
        out += [f"  - {b['code']} {b}" for b in r["boxes_inactive"]]
    out.append("")
    out.append("Specs:")
    out += [f"  - [{x['status']}] {x['spec']} (sheet row {', '.join(map(str, x['sheet_rows']))}): {x['before']} -> {x['after']}" + (f" ({x['how']})" if x.get("how") else "") for x in r["specs"]]
    out.append("")
    out.append(f"Conflicts (several sheet rows match one spec with different packing; set by hand on Packing setup) ({len(r['conflicts'])}):")
    out += [f"  - {c['spec']}: rows {c['rows']} say {' | '.join(c['packings'])}" for c in r["conflicts"]] or ["  (none)"]
    out.append("")
    out.append(f"Sheet rows with packing but no matching spec in the ERP ({len(r['sheet_rows_without_spec'])}):")
    out += [f"  - row {x['row']} {x['client']} {x['size']}: {x['result']}" for x in r["sheet_rows_without_spec"]] or ["  (none)"]
    out.append("")
    out.append(f"Active specs not covered by the sheet's packing ({len(r['specs_not_in_sheet'])}; packing unchanged):")
    out += [f"  - {x['spec']}: {x['current']}" for x in r["specs_not_in_sheet"]] or ["  (none)"]
    out.append("")
    out.append(f"Sheet rows without usable packing ({len(r['sheet_skipped'])}): " + ", ".join(f"{x['row']}" for x in r["sheet_skipped"]))
    out += [f"Note: {n}" for n in r["notes"]]
    return "\n".join(out) + "\n"


if __name__ == "__main__":
    main()
