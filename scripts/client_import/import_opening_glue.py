#!/usr/bin/env python3
"""Load the plant's glue (adhesive) tank register (closing stock till 31 Oct 2026) as go-live opening stock.

Data: data/client_import_2026-11-03/glue_stock.json (29 tanks of 1000 kg from "Glue stock.xlsx").
Every tank keeps its own AIT tank number as its lot number (the glue tank series, separate from reels;
the next new tank at goods inward continues after the highest kept number) and goes in through the
Opening stock API on the go-live date: QC cleared and ready to issue, vendor and inward date kept on the
lot, one QR label per tank (Opening stock › Labels).

Products map to Adhesive masters by code or name (spaces and punctuation ignored); a product with no
master gets one created (owner 2026-11-03), which also makes its stock item. Rate = the master's rate,
else ₹0 until a rate is set.

Preview (default) changes nothing and creates nothing; it lists the mapping and every problem. --apply
creates any missing adhesive master, syncs stock items and posts. Safe to run again: tanks whose number
is already a glue lot in the plant are left out, and the batch has a fixed request key.

    python scripts/client_import/import_opening_glue.py --plant PLANT_A --report /tmp/glue.json [--apply]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import uuid
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, add_common_args, connect, norm, write_reports  # noqa: E402

DATA = ROOT / "data" / "client_import_2026-11-03" / "glue_stock.json"
GO_LIVE = "2026-11-01"


def key(value) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())


def new_code(product: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "-", product.upper()).strip("-")[:40]


def match_master(product: str, masters: list[dict]) -> dict | None:
    """Exact code / name match first; else the one master whose code or name contains the product (or the reverse)."""
    want = key(product)
    exact = [m for m in masters if want in {key(m.get("internal_code")), key(m.get("name")), key(m.get("variety"))}]
    if len(exact) == 1:
        return exact[0]
    loose = [m for m in masters if any(k and (k in want or want in k) and len(k) >= 4 for k in (key(m.get("internal_code")), key(m.get("name"))))]
    return loose[0] if len(loose) == 1 else None


def pick_vendor(name: str, suppliers: list[dict]) -> str:
    want = key(name)
    hits = [s for s in suppliers if s.get("active", True) and want and (key(s.get("name")).startswith(want) or key(s.get("short_name")) == want or key(s.get("code")) == want)]
    return hits[0].get("name") if len(hits) == 1 else name


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_common_args(parser)
    parser.add_argument("--file", default=str(DATA))
    parser.add_argument("--go-live", default=GO_LIVE)
    args = parser.parse_args()
    tanks = json.loads(Path(args.file).read_text())["tanks"]
    erp, plant, ApiError = connect(args)
    bff = args.bff_url

    masters = erp.call("GET", bff, "/api/master/adhesives")
    masters = masters.get("items", masters) if isinstance(masters, dict) else masters
    masters = [m for m in masters if m.get("active", True) is not False]
    suppliers = erp.call("GET", bff, "/api/master/suppliers")
    suppliers = suppliers.get("items", suppliers) if isinstance(suppliers, dict) else suppliers
    overview = erp.call("GET", bff, "/api/inventory/stock-control/opening-stock")

    problems: list[str] = []
    state = overview.get("opening") or {}
    if state.get("state") == "CLOSED":
        problems.append(f"Opening stock is closed on this plant: {state.get('closed_reason') or state.get('message')}")
    if state.get("go_live_date") and state["go_live_date"] != args.go_live:
        problems.append(f"This plant's go-live date is {state['go_live_date']}, not {args.go_live}.")

    products = sorted({t["item"] for t in tanks})
    mapping = {p: match_master(p, masters) for p in products}
    to_create = [p for p, m in mapping.items() if m is None]
    created: list[str] = []
    if args.apply and not problems and to_create:
        for product in to_create:
            body = {"internal_code": new_code(product), "name": product}
            mapping[product] = erp.call("POST", bff, "/api/master/adhesives", body)
            created.append(f"{product} -> {body['internal_code']}")
        erp.call("POST", bff, "/api/inventory/items/sync-masters", {})

    items = [i for i in erp.call("GET", bff, "/api/inventory/items") if str(i.get("plant_id")) == args.plant and str(i.get("type", "")).upper() == "ADHESIVE"]
    item_for: dict[str, dict | None] = {}
    for product, master in mapping.items():
        code = key((master or {}).get("internal_code"))
        hit = [i for i in items if code and key(i.get("item_code")) == code and str(i.get("active", "true")).lower() == "true"]
        item_for[product] = hit[0] if len(hit) == 1 else None

    lines, missing = [], []
    for t in tanks:
        item = item_for.get(t["item"])
        if item is None:
            missing.append(t["ait_no"])
            continue
        lines.append((t, {
            "item_id": item["id"], "kind": "BULK", "qty": t["weight_kg"], "serial": t["ait_no"],
            "vendor_name": pick_vendor(t["vendor"], suppliers), "received_on": t["inward_date"],
            "notes": f"Glue register {t['register_no']} (row {t['sheet_row']})",
        }))
    if missing and (args.apply or not to_create):
        problems.append(f"{len(missing)} tanks have no stock item yet ({', '.join(sorted({t['item'] for t in tanks if t['ait_no'] in missing}))}).")

    check = erp.call("POST", bff, "/api/inventory/stock-control/opening-loads/preview",
                     {"effective_date": args.go_live, "lines": [line for _, line in lines]}) if lines else {"lines": []}
    already, to_post, row_errors = [], [], []
    for (t, line), checked in zip(lines, check.get("lines", [])):
        errors = checked.get("errors") or []
        if any(e.get("field") == "serial" and "already" in e.get("message", "") for e in errors):
            already.append(t["ait_no"])
            continue
        if errors:
            row_errors.append({"ait_no": t["ait_no"], "row": t["sheet_row"], "errors": [e["message"] for e in errors]})
        to_post.append((t, line))
    if check.get("date") and not check["date"].get("ok"):
        problems.append(f"Go-live date: {check['date'].get('message')}")

    by_item: dict[str, dict] = defaultdict(lambda: {"tanks": 0, "kg": 0.0})
    # Before the masters exist (preview) the tanks still show what apply will post.
    counted = [(t, t["weight_kg"]) for t, _ in to_post] or ([(t, t["weight_kg"]) for t in tanks if t["ait_no"] in missing] if to_create and not args.apply else [])
    for t, kg in counted:
        by_item[t["item"]]["tanks"] += 1
        by_item[t["item"]]["kg"] += kg
    report = {
        "plant": plant.get("code"), "go_live": args.go_live, "mode": "apply" if args.apply else "preview",
        "register_tanks": len(tanks), "to_post": len(to_post), "already_in_plant": already, "row_errors": row_errors, "problems": problems,
        "mapping": {p: (f"{m.get('internal_code')} · {m.get('name')}" if m else "NEW master will be created") for p, m in mapping.items()},
        "created_masters": created, "by_item": dict(by_item), "total_kg": sum(line["qty"] for _, line in to_post),
        "tank_range": [min((t["ait_no"] for t, _ in to_post), default=None), max((t["ait_no"] for t, _ in to_post), default=None)],
        "warnings": sorted({w for c in check.get("lines", []) for w in (c.get("warnings") or [])})[:20],
    }
    blocked = bool(problems or row_errors)
    if args.apply and not blocked and to_post:
        digest = hashlib.sha256(json.dumps([line for _, line in to_post], sort_keys=True, default=str).encode()).hexdigest()
        payload = {"request_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"hariom-glue-register-{args.plant}-{digest}")), "effective_date": args.go_live,
                   "notes": "Glue tank register: closing stock till 31 Oct 2026 (Glue stock.xlsx)", "lines": [line for _, line in to_post]}
        try:
            posted = erp.call("POST", bff, "/api/inventory/stock-control/opening-loads", payload)
        except ApiError as exc:
            report["post_error"] = {"status": exc.status, "detail": exc.detail}
            blocked = True
        else:
            report["posted"] = {"id": posted.get("id"), "document_no": posted.get("document_no"), "lines": posted.get("line_count") or len(posted.get("lines") or []),
                                "idempotent": posted.get("idempotent"), "labels_page": f"/inventory/opening-stock/labels?batch={posted.get('id')}"}

    out = [
        f"Glue tank opening stock — plant {report['plant']}, go-live {args.go_live} ({report['mode']})",
        f"Register tanks: {len(tanks)}; to post: {len(to_post)} ({report['total_kg']:,.0f} kg); already in the plant: {len(already)}",
        f"Tank numbers kept: {report['tank_range'][0]} … {report['tank_range'][1]}",
        "Products -> adhesive master: " + "; ".join(f"{p} -> {m}" for p, m in report["mapping"].items()),
        *([f"Created masters: {', '.join(created)}"] if created else []),
        "By product: " + "; ".join(f"{k}: {v['tanks']} tanks, {v['kg']:,.0f} kg" for k, v in sorted(by_item.items())),
    ]
    for title, rows in (("PROBLEMS", problems), ("ROW ERRORS", [f"{e['ait_no']} row {e['row']}: {'; '.join(e['errors'])}" for e in row_errors]), ("WARNINGS", report["warnings"])):
        if rows:
            out.append(f"{title} ({len(rows)}):")
            out += [f"  {row}" for row in rows[:40]]
    if "posted" in report:
        p = report["posted"]
        out.append(f"POSTED: batch {p['document_no']}{' (already posted before)' if p['idempotent'] else ''}; labels: {p['labels_page']}")
    elif "post_error" in report:
        out.append(f"POST FAILED: HTTP {report['post_error']['status']}: {report['post_error']['detail']}")
    elif args.apply and blocked:
        out.append("NOT POSTED: fix the problems above first (nothing was written).")
    elif args.apply:
        out.append("Nothing to post: every tank is already in the plant.")
    else:
        out.append("Preview only: nothing was written." + (" Fix the problems above before applying." if blocked else
                   (f" Apply will first create {len(to_create)} adhesive master(s)." if to_create else " Ready to apply.")))
    write_reports(args.report, report, "\n".join(out))
    return 1 if blocked else 0


if __name__ == "__main__":
    raise SystemExit(main())
