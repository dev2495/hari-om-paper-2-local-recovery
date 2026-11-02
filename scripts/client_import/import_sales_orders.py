#!/usr/bin/env python3
"""Load the outstanding lines of the client's Tally "Sales Orders (Due Only)" export.

Data: data/client_import_2026-11-02/sales_orders.json (from extract_workbooks.py).
One Tally order number + party = one sales order (origin Customer PO, PO number = the
Tally order number, PO date = Date). Line qty = the outstanding Balance; the original
Ordered qty, the Tally due date and the item text go into the order notes (lines have no
note field). Rate per pc = Rate. Due date = Due on when it is after the PO date (the app
requires that); otherwise the line has no date and the Tally date is in the notes.

Only lines whose item matches exactly ONE approved spec of the mapped customer are
imported: same I.D. x O.D. x length, and the (HCS) / (V) / (Bar) / "245gsm" marks must
match the spec's own variant (HCS and V both ways). Party names map to customer masters
by name or by data/client_import_2026-11-02/customer_aliases.json; customers are never
created. Orders are created through the app's API and approved as the import account (an
Owner or Admin may approve an order they entered: maker-checker rule of 30 Oct 2026).

Preview (default) changes nothing. --apply writes. Idempotent: an order whose customer +
PO number already exists is not created again (a draft left by an interrupted run is
approved).

    python scripts/client_import/import_sales_orders.py --plant PLANT_A --report /tmp/orders.json [--apply]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, OrderedDict
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CustomerResolver, add_common_args, base_variant, connect, dims_equal, near, tokens, write_reports  # noqa: E402

IMPORT_MARK = "Imported from Tally 'Sales Orders (Due Only)'"
ITEM = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*(.*)$", re.I)
VALIDITY_DAYS = 45


def fmt(value) -> str:
    value = float(value)
    return str(int(value)) if value == int(value) else f"{value:g}"


def parse_item(text: str) -> dict | None:
    match = ITEM.match(text)
    if not match:
        return None
    rest = match.group(4)
    mods = {m.strip().upper() for m in re.findall(r"\(([^)]*)\)", rest)}
    weight = re.search(r"(\d+(?:\.\d+)?)\s*(?:gsm|grm|gram|g)\b", rest, re.I)
    return {
        "id_mm": float(match.group(1)), "od_mm": float(match.group(2)), "length_mm": float(match.group(3)),
        "tags": re.findall(r"\[([^\]]*)\]", rest), "hcs": "HCS" in mods, "v": "V" in mods, "bar": "BAR" in mods,
        "weight_g": float(weight.group(1)) if weight else None,
        "unknown": sorted(m for m in mods if m not in {"HCS", "V", "BAR"}),
    }


def dynamic(spec: dict, key: str) -> str:
    return next((str(f.get("value") or "") for f in spec.get("dynamic_fields") or [] if f.get("field_key") == key), "")


def spec_marks(spec: dict, tube: dict) -> dict:
    variant = base_variant(tube.get("description"))
    words = tokens(variant)
    tooling = " ".join(dynamic(spec, k) for k in ("notch_type", "notching_blade", "notching_holder")) + " " + str(tube.get("description") or "")
    return {"variant": variant, "hcs": "HCS" in words, "v": "V" in words, "bar": "BAR" in tokens(tooling)}


def size_text(tube: dict) -> str:
    return f"{fmt(tube['inner_diameter_mm'])} x {fmt(tube['outer_diameter_mm'])} x {fmt(tube['length_mm'])}"


def match_line(item: dict, specs: list[dict], tubes: dict) -> tuple[dict | None, str, list[str]]:
    same = []
    for spec in specs:
        tube = tubes.get(str(spec.get("tube_size_id")))
        if tube and dims_equal(tube["inner_diameter_mm"], item["id_mm"]) and dims_equal(tube["outer_diameter_mm"], item["od_mm"]) and dims_equal(tube["length_mm"], item["length_mm"]):
            same.append((spec, tube, spec_marks(spec, tube)))
    label = lambda s, t, m: f"{size_text(t)} {m['variant']} wt {fmt(s.get('target_tube_weight') or 0)} g".replace("  ", " ")  # noqa: E731
    if not same:
        hints = [f"{size_text(t)} {base_variant(t.get('description'))}".strip() for s in specs if (t := tubes.get(str(s.get("tube_size_id"))))
                 and near(t["inner_diameter_mm"], item["id_mm"], 0.6) and near(t["outer_diameter_mm"], item["od_mm"], 0.6) and near(t["length_mm"], item["length_mm"], 0.6)]
        return None, "no approved spec of this customer has this size" + (f" (close sizes: {'; '.join(sorted(set(hints)))})" if hints else ""), []
    if item["unknown"]:
        return None, f"item mark(s) {', '.join(item['unknown'])} not understood", [label(*x) for x in same]
    left = [x for x in same if x[2]["hcs"] == item["hcs"] and x[2]["v"] == item["v"]]
    if not left:
        want = " ".join(w for w, on in (("HCS", item["hcs"]), ("V", item["v"])) if on) or "plain (no HCS / V)"
        return None, f"no spec of this size with the same variant ({want})", [label(*x) for x in same]
    if item["bar"]:
        left = [x for x in left if x[2]["bar"]]
        if not left:
            return None, "item is (Bar) but no spec of this size is marked BAR", [label(*x) for x in same]
    if item["weight_g"] is not None:
        left = [x for x in left if x[0].get("target_tube_weight") is not None and abs(float(x[0]["target_tube_weight"]) - item["weight_g"]) < 0.51]
        if not left:
            return None, f"no spec of this size weighs {fmt(item['weight_g'])} g", [label(*x) for x in same]
    if len(left) > 1:
        return None, f"{len(left)} specs fit (they differ only by variant / tooling the Tally item does not name)", [label(*x) for x in left]
    spec, tube, marks = left[0]
    return spec, label(spec, tube, marks), []


def product_code(spec: dict, tube: dict) -> str:
    """Same rule as the order screen: the spec's own code, else FG-<I.D.>-<O.D.>-<length>."""
    explicit = str(spec.get("product_code") or spec.get("spec_reference") or "").strip()
    if explicit:
        return explicit.upper()
    dims = [round((float(spec[f"{k}_min_mm"]) + float(spec[f"{k}_max_mm"])) / 2) for k in ("id", "od", "length") if spec.get(f"{k}_min_mm") is not None and spec.get(f"{k}_max_mm") is not None]
    return f"FG-{'-'.join(str(d) for d in dims)}" if len(dims) == 3 else f"SPEC-{str(spec['id'])[:8].upper()}"


def tally_date(value: str) -> str:
    return date.fromisoformat(value).strftime("%d-%b-%y")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_common_args(parser)
    parser.add_argument("--no-confirm-aliases", action="store_true", help="Do not use the party aliases marked 'confirm' in customer_aliases.json")
    args = parser.parse_args()
    data_dir = Path(args.data_dir)
    data = json.loads((data_dir / "sales_orders.json").read_text())
    erp, plant, ApiError = connect(args)
    bff = args.bff_url.rstrip("/")
    extracted = date.fromisoformat(data["summary"]["extracted_on"])
    print(f"Tally sales orders from {data['summary']['source']} into plant {plant.get('code')} ({'APPLY' if args.apply else 'preview'})", flush=True)

    specs = [s for s in erp.call("GET", bff, "/api/spec/specifications?status=approved") if s.get("active", True) and str(s.get("plant_id")) == args.plant]
    tubes = {str(t["id"]): t for t in erp.call("GET", bff, "/api/master/tube-sizes?include_inactive=true")}
    resolver = CustomerResolver(erp.call("GET", bff, "/api/master/customers"), data_dir / "customer_aliases.json", use_confirm_aliases=not args.no_confirm_aliases)

    groups: "OrderedDict[tuple[str, str], list[dict]]" = OrderedDict()
    for line in data["lines"]:
        if "skip" not in line:
            groups.setdefault((line["order_no"], line["party"]), []).append(line)

    report = {"plant": plant.get("code"), "apply": args.apply, "source": data["summary"]["source"], "period": data["summary"]["period"],
              "orders": [], "unmatched_lines": [], "customer_mapping": {}, "skipped_rows": data["summary"]["skipped"]}
    statuses = Counter()
    for (order_no, party), lines in groups.items():
        customer, how = resolver.resolve(party)
        report["customer_mapping"][party] = {"customer": customer["name"] if customer else None, "how": how}
        own = [s for s in specs if customer and str(s.get("customer_id") or "") == str(customer["id"])]
        matched = []
        for line in lines:
            item = parse_item(line["item"])
            base = {"tally_row": line["row"], "order_no": order_no, "party": party, "customer": customer["name"] if customer else None,
                    "item": line["item"], "ordered": line["ordered_qty"], "balance": line["balance_qty"], "rate": line["rate"], "date": line["date"], "due_on": line["due_on"]}
            if customer is None:
                report["unmatched_lines"].append({**base, "reason": f"party not mapped: {how}"})
                continue
            if item is None:
                report["unmatched_lines"].append({**base, "reason": "item text is not I.D. x O.D. x length"})
                continue
            spec, why, candidates = match_line(item, own, tubes)
            if spec is None:
                report["unmatched_lines"].append({**base, "reason": why, "candidates": candidates})
                continue
            matched.append((line, spec, why))
        entry = {"order_no": order_no, "party": party, "customer": customer["name"] if customer else None, "customer_match": how,
                 "po_date": lines[0]["date"], "lines_in_tally": len(lines), "lines_matched": len(matched),
                 "balance_matched": sum(l["balance_qty"] for l, _, _ in matched), "lines": []}
        if not matched:
            entry["status"] = "not imported (no line matches a spec)"
            statuses["not imported"] += 1
            report["orders"].append(entry)
            continue
        po_date = date.fromisoformat(lines[0]["date"])
        notes = [f"{IMPORT_MARK} export ({data['summary']['period']}), extracted {data['summary']['extracted_on']}; Tally order {order_no}, party {party}."]
        body_lines = []
        for index, (line, spec, why) in enumerate(matched, start=1):
            tube = tubes[str(spec["tube_size_id"])]
            due = date.fromisoformat(line["due_on"]) if line.get("due_on") else None
            due_ok = due if due and due > po_date else None
            notes.append(f"Line {index}: {line['item']} - ordered {fmt(line['ordered_qty'] or 0)}, balance {fmt(line['balance_qty'])} imported as the line qty; Tally due on {tally_date(line['due_on']) if line.get('due_on') else '-'}" + ("" if due_ok or not due else " (on/before the PO date, so the line has no due date)") + ".")
            body_lines.append({
                "approved_spec_id": spec["id"], "line_no": index, "product_code": product_code(spec, tube), "size_label": size_text(tube),
                "parchment_required": bool(spec.get("parchment_allowed")), "parchment_color_id": None, "parchment_color": None, "color_splits": [],
                "rate_per_pc": line["rate"], "qty": line["balance_qty"], "due_date": due_ok.isoformat() if due_ok else None,
            })
            entry["lines"].append({"tally_row": line["row"], "item": line["item"], "spec": why, "spec_id": spec["id"], "qty": line["balance_qty"], "ordered": line["ordered_qty"], "rate": line["rate"], "due_date": due_ok.isoformat() if due_ok else None})
        unmatched_here = len(lines) - len(matched)
        if unmatched_here:
            notes.append(f"{unmatched_here} more Tally line(s) of this order have no matching spec yet; add them when their specs exist.")
        payload = {
            "origin": "CUSTOMER_PO", "customer_id": customer["id"], "po_number": order_no, "po_date": po_date.isoformat(),
            "internal_order_date": None, "expiry_date": (max(po_date, extracted) + timedelta(days=VALIDITY_DAYS)).isoformat(),
            "notes": "\n".join(notes), "lines": body_lines,
        }
        entry["expiry_date"] = payload["expiry_date"]
        existing = [o for o in list_orders(erp, bff, customer["id"]) if str(o.get("po_number") or "").strip().lower() == order_no.strip().lower() and o.get("closure_kind") != "CANCELLED"]
        if existing:
            order = existing[0]
            entry.update(order_id=order.get("id"), order_no_erp=order.get("order_no"))
            if IMPORT_MARK not in str(order.get("notes") or ""):
                entry["status"] = f"skipped: PO {order_no} already exists for this customer ({order.get('order_no')}, entered in the ERP)"
            elif str(order.get("status")).lower() in ("draft", "submitted") and args.apply:
                approve(erp, bff, order["id"], entry, ApiError)
            else:
                entry["status"] = f"already imported ({order.get('order_no')}, {order.get('status')})"
            statuses[entry["status"].split(" (")[0].split(":")[0]] += 1
            report["orders"].append(entry)
            continue
        if not args.apply:
            entry["status"] = "would create + approve"
        else:
            try:
                created = erp.call("POST", bff, "/api/sales/orders", payload)
                entry.update(order_id=created.get("id"), order_no_erp=created.get("order_no"))
                approve(erp, bff, created["id"], entry, ApiError)
            except ApiError as exc:
                entry["status"] = f"failed: HTTP {exc.status} {exc.detail}"
        statuses[entry["status"].split(" (")[0].split(":")[0]] += 1
        report["orders"].append(entry)

    report["summary"] = {
        "tally_orders": len(groups), "tally_lines": sum(len(v) for v in groups.values()),
        "orders_with_a_match": sum(1 for o in report["orders"] if o["lines_matched"]),
        "lines_matched": sum(o["lines_matched"] for o in report["orders"]),
        "qty_matched": sum(o["balance_matched"] for o in report["orders"]),
        "lines_unmatched": len(report["unmatched_lines"]), "qty_unmatched": sum(l["balance"] for l in report["unmatched_lines"]),
        **dict(statuses),
    }
    write_reports(args.report, report, text_report(report))
    sys.exit(1 if statuses.get("failed") else 0)


def list_orders(erp, bff, customer_id):
    rows, offset = [], 0
    while True:
        page = erp.call("GET", bff, f"/api/sales/orders?customer_id={customer_id}&limit=500&offset={offset}")
        rows += page
        if len(page) < 500:
            return rows
        offset += 500


def approve(erp, bff, order_id, entry, ApiError):
    try:
        erp.call("POST", bff, f"/api/sales/orders/{order_id}/approve", {})
        entry["status"] = f"created + approved ({entry.get('order_no_erp')})"
    except ApiError as exc:
        entry["status"] = f"failed: created {entry.get('order_no_erp')} but approval refused: HTTP {exc.status} {exc.detail}"


def text_report(r) -> str:
    s = r["summary"]
    out = [f"TALLY SALES ORDERS ({'APPLIED' if r['apply'] else 'PREVIEW'}) · plant {r['plant']} · {r['source']} ({r['period']})", json.dumps(s), ""]
    out.append("Party -> customer master:")
    out += [f"  - {party} -> {m['customer'] or 'NOT MAPPED'} ({m['how']})" for party, m in r["customer_mapping"].items()]
    out.append("")
    out.append("Orders:")
    for o in r["orders"]:
        out.append(f"  - [{o['status']}] PO {o['order_no']} dated {o['po_date']} · {o['customer'] or o['party']} · {o['lines_matched']}/{o['lines_in_tally']} line(s), {fmt(o['balance_matched'])} pcs")
        out += [f"      line: {l['item']} -> spec {l['spec']} · qty {fmt(l['qty'])} (ordered {fmt(l['ordered'] or 0)}) @ {l['rate']}" for l in o["lines"]]
    out.append("")
    out.append(f"Lines NOT imported ({len(r['unmatched_lines'])}, {fmt(s['qty_unmatched'])} pcs) - create the spec, then enter the line:")
    out.append("  customer | item | balance | rate | PO | reason")
    for l in r["unmatched_lines"]:
        out.append(f"  - {l['customer'] or l['party']} | {l['item']} | {fmt(l['balance'])} | {l['rate']} | {l['order_no']} ({l['date']}) | {l['reason']}" + (f" | candidates: {'; '.join(l['candidates'])}" if l.get("candidates") else ""))
    return "\n".join(out) + "\n"


if __name__ == "__main__":
    main()
