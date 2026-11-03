#!/usr/bin/env python3
"""Load the plant's paper reel register (closing stock till 31 Oct 2026) as go-live opening stock.

Data: data/client_import_2026-11-03/reel_stock.json (the 351 reels of "Reel stock.xlsx", sheet "Stock").
Every reel keeps the plant's own AIT number (client 2026-11-03) and goes in through the Opening stock API
(POST /api/inventory/stock-control/opening-loads), the same one the page uses: one batch dated the go-live
date, QC cleared and ready to issue, one QR label per reel (Opening stock › Labels). Reels marked HOLD go in
on QC hold (QH-OTHER, with a note). The next goods inward continues after the highest AIT number kept.

Mapping: paper item = the item whose code is the register's GSM column (351, 350, 352…); SLITTED = reel,
coil = coil; mill reel no. = old mark (ROLL NO. on the label); vendor code = mill name (and the vendor
master's name when exactly one vendor matches it); bill no. / date, PO, inward date, the mill's variety
(350CEDAR) and ply bond are kept on the reel; rate = cost per kg.

Preview (default) changes nothing: it runs the app's own check and lists every problem. --apply posts.
Safe to run again: reels whose AIT number is already in the plant are left out, and the batch has a fixed
request key, so a repeated post answers with the first one.

    python scripts/client_import/import_opening_reels.py --plant PLANT_A --report /tmp/reels.json [--apply]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import uuid
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, add_common_args, connect, norm, write_reports  # noqa: E402

DATA = ROOT / "data" / "client_import_2026-11-03" / "reel_stock.json"
GO_LIVE = "2026-11-01"
HOLD_CODE = "QH-OTHER"
HOLD_NOTE = "Marked HOLD in the plant's reel register (closing 31 Oct 2026)"
FORMS = {"SLITTED": "REEL", "REEL": "REEL", "COIL": "COIL"}


def kg(value: float) -> str:
    return f"{value:,.0f} kg"


def pick_vendor(code: str, suppliers: list[dict]) -> str | None:
    """The vendor master's name when exactly one active vendor's short name / code / name matches the code."""
    key = norm(code)
    hits = [s for s in suppliers if s.get("active", True) and key and (
        norm(s.get("short_name")) == key or norm(s.get("code")) == key or norm(s.get("name")).startswith(key))]
    return hits[0].get("name") if len(hits) == 1 else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_common_args(parser)
    parser.add_argument("--file", default=str(DATA))
    parser.add_argument("--go-live", default=GO_LIVE)
    args = parser.parse_args()
    data = json.loads(Path(args.file).read_text())
    reels = data["reels"]
    erp, plant, ApiError = connect(args)
    bff = args.bff_url

    items = [i for i in erp.call("GET", bff, "/api/inventory/items") if str(i.get("plant_id")) == args.plant]
    papers = {norm(i.get("item_code")): i for i in items if str(i.get("tracking_mode", "")).upper() == "REEL" and str(i.get("active", "true")).lower() == "true"}
    suppliers = erp.call("GET", bff, "/api/master/suppliers")
    suppliers = suppliers.get("items", suppliers) if isinstance(suppliers, dict) else suppliers
    holds = erp.call("GET", bff, "/api/master/reason-codes?category=QC_HOLD")
    holds = holds.get("items", holds) if isinstance(holds, dict) else holds
    hold_ok = any(str(r.get("code")).upper() == HOLD_CODE and r.get("active", True) for r in holds)
    overview = erp.call("GET", bff, "/api/inventory/stock-control/opening-stock")
    series = erp.call("GET", bff, "/api/inventory/reel-serial")

    problems: list[str] = []
    state = overview.get("opening") or {}
    if state.get("state") == "CLOSED":
        problems.append(f"Opening stock is closed on this plant: {state.get('closed_reason') or state.get('message')}")
    if state.get("go_live_date") and state["go_live_date"] != args.go_live:
        problems.append(f"This plant's go-live date is already {state['go_live_date']}, not {args.go_live}.")
    if any(r["hold"] for r in reels) and not hold_ok:
        problems.append(f"Reason code {HOLD_CODE} (QC_HOLD) is not active in Masters › Reason codes.")

    vendor_names = {code: pick_vendor(code, suppliers) for code in sorted({r["vendor_code"] for r in reels if r["vendor_code"]})}
    lines, skipped, unmapped = [], [], Counter()
    for r in reels:
        item = papers.get(norm(r["gsm"]))
        form = FORMS.get(str(r["form"] or "").upper())
        if item is None:
            unmapped[r["gsm"]] += 1
            skipped.append({"ait_no": r["ait_no"], "row": r["sheet_row"], "why": f"no active reel item with code {r['gsm']}"})
            continue
        if form is None:
            skipped.append({"ait_no": r["ait_no"], "row": r["sheet_row"], "why": f"form '{r['form']}' is not SLITTED or coil"})
            continue
        line = {
            "item_id": item["id"], "kind": "REEL", "qty": float(r["weight_kg"]), "physical_form": form,
            "serial": r["ait_no"], "old_mark": r["reel_no"],
            "vendor_name": vendor_names.get(r["vendor_code"]) or r["vendor_code"], "vendor_ref": r["bill_no"],
            "mill_name": r["vendor_code"], "invoice_no": r["bill_no"], "invoice_date": r["bill_date"], "po_ref": r["po_no"],
            "received_on": r["inward_date"], "mill_variety": r["variety"], "plybond": r["plybond"],
            "unit_cost": r["rate"],
            "notes": f"Reel register {r['sr_no']} (row {r['sheet_row']})",
        }
        if r["hold"]:
            line.update({"on_hold": True, "stock_status": "QC_HOLD", "hold_reason_code": HOLD_CODE, "hold_reason_note": HOLD_NOTE})
        lines.append((r, line))

    # Reels already in the plant with their AIT number (an earlier run): left out, never posted twice.
    check = erp.call("POST", bff, "/api/inventory/stock-control/opening-loads/preview",
                     {"effective_date": args.go_live, "lines": [line for _, line in lines]}) if lines else {"lines": []}
    already, to_post, row_errors = [], [], []
    for (r, line), checked in zip(lines, check.get("lines", [])):
        errors = checked.get("errors") or []
        if any(e.get("field") == "serial" and "already a reel" in e.get("message", "") for e in errors):
            already.append(r["ait_no"])
            continue
        if errors:
            row_errors.append({"ait_no": r["ait_no"], "row": r["sheet_row"], "errors": [e["message"] for e in errors]})
        to_post.append((r, line))
    if check.get("date") and not check["date"].get("ok"):
        problems.append(f"Go-live date: {check['date'].get('message')}")

    by_item: dict[str, dict] = defaultdict(lambda: {"reels": 0, "kg": 0.0, "held": 0, "value": 0.0})
    for r, line in to_post:
        entry = by_item[r["gsm"]]
        entry["reels"] += 1
        entry["kg"] += line["qty"]
        entry["held"] += 1 if r["hold"] else 0
        entry["value"] += line["qty"] * float(r["rate"] or 0)
    report = {
        "plant": plant.get("code"), "go_live": args.go_live, "mode": "apply" if args.apply else "preview",
        "register_reels": len(reels), "to_post": len(to_post), "already_in_plant": already, "skipped": skipped,
        "row_errors": row_errors, "problems": problems, "unmapped_gsm": dict(unmapped), "vendors": vendor_names,
        "by_item": {k: {**v, "kg": round(v["kg"], 1), "value": round(v["value"], 2)} for k, v in sorted(by_item.items())},
        "total_kg": round(sum(line["qty"] for _, line in to_post), 1),
        "total_value": round(sum(line["qty"] * float(r["rate"] or 0) for r, line in to_post), 2),
        "held": [r["ait_no"] for r, _ in to_post if r["hold"]],
        "ait_range": [min((r["ait_no"] for r, _ in to_post), default=None), max((r["ait_no"] for r, _ in to_post), default=None)],
        "warnings": sorted({w for c in check.get("lines", []) for w in (c.get("warnings") or [])})[:20],
    }
    highest_kept = max((int(r["ait_no"].split()[1]) for r, _ in to_post), default=0)
    counter_next = int(series.get("next_number") or 1)
    report["next_ait"] = {"set_now": series.get("next_serial"), "after_load": f"AIT {max(counter_next, highest_kept + 1):05d}"}

    blocked = bool(problems or skipped or row_errors)
    if args.apply and not blocked and to_post:
        digest = hashlib.sha256(json.dumps([line for _, line in to_post], sort_keys=True, default=str).encode()).hexdigest()
        payload = {
            "request_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"hariom-reel-register-{args.plant}-{digest}")),
            "effective_date": args.go_live,
            "notes": "Paper reel register: closing stock till 31 Oct 2026 (Reel stock.xlsx)",
            "lines": [line for _, line in to_post],
        }
        try:
            posted = erp.call("POST", bff, "/api/inventory/stock-control/opening-loads", payload)
        except ApiError as exc:
            report["post_error"] = {"status": exc.status, "detail": exc.detail}
            blocked = True
        else:
            report["posted"] = {"id": posted.get("id"), "document_no": posted.get("document_no"), "lines": len(posted.get("lines") or []),
                                "idempotent": posted.get("idempotent"), "labels_page": f"/inventory/opening-stock/labels?batch={posted.get('id')}"}
            first = (posted.get("lines") or [{}])[0].get("reel_code")
            report["posted"]["first_reel"] = first
        state_after = erp.call("GET", bff, "/api/inventory/stock-control/opening-stock")
        report["opening_after"] = state_after.get("totals")

    lines_out = [
        f"Reel register opening stock — plant {report['plant']}, go-live {args.go_live} ({report['mode']})",
        f"Register reels: {len(reels)}; to post: {len(to_post)} ({kg(report['total_kg'])}, ₹{report['total_value']:,.0f}); "
        f"already in the plant: {len(already)}; held: {', '.join(report['held']) or 'none'}",
        f"AIT numbers kept: {report['ait_range'][0]} … {report['ait_range'][1]}",
        "By paper item (register GSM code):",
        *[f"  {k}: {v['reels']} reels, {kg(v['kg'])}, ₹{v['value']:,.0f}" + (f", {v['held']} on hold" if v["held"] else "") for k, v in report["by_item"].items()],
        f"Next AIT no. for goods inward: now {report['next_ait']['set_now']}, after this load {report['next_ait']['after_load']}",
        "Vendors (code -> vendor name used): " + ", ".join(f"{k} -> {v or k + ' (no single vendor master)'}" for k, v in vendor_names.items()),
    ]
    for title, rows in (("PROBLEMS", problems), ("SKIPPED", [f"{s['ait_no']} row {s['row']}: {s['why']}" for s in skipped]),
                        ("ROW ERRORS", [f"{e['ait_no']} row {e['row']}: {'; '.join(e['errors'])}" for e in row_errors]),
                        ("WARNINGS", report["warnings"])):
        if rows:
            lines_out.append(f"{title} ({len(rows)}):")
            lines_out += [f"  {row}" for row in rows[:40]]
    if "posted" in report:
        p = report["posted"]
        lines_out.append(f"POSTED: batch {p['document_no']} with {p['lines']} reels{' (already posted before)' if p['idempotent'] else ''}; labels: {p['labels_page']}")
    elif "post_error" in report:
        lines_out.append(f"POST FAILED: HTTP {report['post_error']['status']}: {report['post_error']['detail']}")
    elif args.apply and blocked:
        lines_out.append("NOT POSTED: fix the problems above first (nothing was written).")
    elif args.apply:
        lines_out.append("Nothing to post: every reel is already in the plant.")
    else:
        lines_out.append("Preview only: nothing was written." + (" Fix the problems above before applying." if blocked else " Ready to apply."))
    text = "\n".join(lines_out)
    write_reports(args.report, report, text)
    return 1 if blocked else 0


if __name__ == "__main__":
    raise SystemExit(main())
