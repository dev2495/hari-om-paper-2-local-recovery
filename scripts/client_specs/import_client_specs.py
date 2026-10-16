#!/usr/bin/env python3
"""Load the client's specification list (from extract_workbook.py) as approved specs.

Idempotent: customers, mandrels, tube sizes and papers are matched before
anything is created, and each sheet row is imported under a stable key, so a
second run changes nothing. Every spec goes through the spec service's
import command (same validation as the spec sheet); nothing is written to the
database directly.

On the AWS host (inside the app container, services on their usual ports):

    docker compose --env-file deploy/aws-ec2/.env --project-directory deploy/aws-ec2 \
      exec -T erp-app python scripts/client_specs/import_client_specs.py \
      --data data/client_specs/specification_sheet_completed.json --plant PLANT_A

Credentials: ERP_IMPORT_EMAIL / ERP_IMPORT_PASSWORD, else the container's
BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD (an Owner/Admin account).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import uuid
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

import httpx

# Client grade table (workbook row 4; values as in scripts/seed_rm_master.py).
# Only used when a grade has no paper master yet.
GRADES = {
    "220": {"gsm": 220, "bf": 20, "bulk_factor": 1.50, "ply_bond": 400.0},
    "230": {"gsm": 230, "bf": 28, "bulk_factor": 1.50, "ply_bond": 400.0},
    "301": {"gsm": 300, "bf": 20, "bulk_factor": 1.50, "ply_bond": 400.0},
    "350": {"gsm": 350, "bf": 16, "bulk_factor": 1.55, "ply_bond": 300.0},
    "355": {"gsm": 350, "bf": 18, "bulk_factor": 1.55, "ply_bond": 350.0},
    "351": {"gsm": 350, "bf": 20, "bulk_factor": 1.50, "ply_bond": 400.0},
    "352": {"gsm": 350, "bf": 24, "bulk_factor": 1.45, "ply_bond": 500.0},
    "353": {"gsm": 350, "bf": 28, "bulk_factor": 1.40, "ply_bond": 600.0},
    "354": {"gsm": 350, "bf": 32, "bulk_factor": 1.40, "ply_bond": 700.0},
    "401": {"gsm": 400, "bf": 20, "bulk_factor": 1.50, "ply_bond": 400.0, "assumed": True},
}
# Codes the earlier workbook-parity seed used for the same grades.
SEED_CODES = {"220": ["221"], "230": ["231"]}


def norm(value) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())


def name_key(value) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


class Erp:
    def __init__(self, args):
        self.args = args
        self.client = httpx.Client(timeout=60)
        self.token = None
        self.login()

    def login(self):
        email = os.environ.get("ERP_IMPORT_EMAIL") or os.environ.get("BOOTSTRAP_ADMIN_EMAIL")
        password = os.environ.get("ERP_IMPORT_PASSWORD") or os.environ.get("BOOTSTRAP_ADMIN_PASSWORD")
        if not email or not password:
            raise SystemExit("Set ERP_IMPORT_EMAIL and ERP_IMPORT_PASSWORD (an Owner/Admin login).")
        response = self.client.post(f"{self.args.auth_url}/auth/login", data={"username": email, "password": password})
        if response.status_code != 200:
            raise SystemExit(f"Login failed for {email} ({response.status_code}). Set ERP_IMPORT_EMAIL / ERP_IMPORT_PASSWORD to an Owner or Admin account.")
        self.token = response.json()["access_token"]

    def call(self, method, base, path, body=None, ok=(200, 201)):
        for attempt in range(3):
            response = self.client.request(method, base + path, json=body, headers={"Authorization": f"Bearer {self.token}", "X-Plant-ID": self.args.plant})
            if response.status_code == 401 and attempt < 2:
                self.login()
                continue
            if response.status_code in (502, 503, 504) and attempt < 2:
                time.sleep(2 + attempt * 3)
                continue
            if response.status_code not in ok:
                raise ApiError(response.status_code, safe_json(response))
            return safe_json(response)
        raise ApiError(response.status_code, safe_json(response))


class ApiError(Exception):
    def __init__(self, status, detail):
        super().__init__(f"HTTP {status}: {detail}")
        self.status = status
        self.detail = detail.get("detail", detail) if isinstance(detail, dict) else detail


def safe_json(response):
    try:
        return response.json()
    except ValueError:
        return {"detail": response.text[:300]}


def customer_code(name: str, taken: set[str]) -> str:
    words = [w for w in re.findall(r"[A-Za-z0-9]+", name) if w.lower() not in {"ltd", "limited", "pvt", "private", "the"}]
    base = ("".join(w[0] for w in words[:4]) + (words[0][1:4] if words else "")).upper() or "CUST"
    code = f"WB-{base}"[:20]
    n = 2
    while norm(code) in taken:
        code = f"WB-{base}{n}"[:20]
        n += 1
    taken.add(norm(code))
    return code


def pick_paper(grade: str, papers: list[dict], overrides: dict[str, str]):
    if grade in overrides:
        wanted = norm(overrides[grade])
        match = [p for p in papers if norm(p.get("code")) == wanted]
        return (match[0], None) if match else (None, f"--paper-map {grade}={overrides[grade]} matches no active paper")
    exact = [p for p in papers if norm(p.get("code")) == grade or norm(p.get("code")) in SEED_CODES.get(grade, [])]
    if len(exact) == 1:
        return exact[0], None
    if len(exact) > 1:
        exact.sort(key=lambda p: norm(p.get("code")))
        return exact[0], f"grade {grade}: several papers coded {grade}; used {exact[0]['code']}"
    suffixed = [p for p in papers if re.fullmatch(rf"[A-Z]{{1,4}}{grade}", norm(p.get("code")))]
    if len(suffixed) == 1:
        return suffixed[0], None
    if suffixed:
        suffixed.sort(key=lambda p: norm(p.get("code")))
        return suffixed[0], f"grade {grade}: {', '.join(p['code'] for p in suffixed)} all match; used {suffixed[0]['code']} (override with --paper-map {grade}=CODE)"
    return None, None


def spec_payload(row, customer, mandrel, tube, today):
    ident, od, length = row["id_mm"], row["od_mm"], row["length_mm"]
    weight, cs = row["tube_weight_g"], row["required_cs"]
    limits = {
        "id_min_mm": ident, "id_max_mm": round(ident + 0.5, 3),
        "od_min_mm": round(od - 0.2, 3), "od_max_mm": round(od + 0.2, 3),
        "length_min_mm": round(length - 0.2, 3), "length_max_mm": round(length + 0.2, 3),
        "weight_min_g": round(max(weight - 5, 0), 3), "weight_max_g": round(weight + 5, 3),
        "cs_min_n": cs, "cs_max_n": round(cs + 50, 3) if cs else 50.0,
        "moisture_min_pct": 8.0, "moisture_max_pct": 10.0,
    }
    adhesive = row["adhesive"]
    packing = row["packing"]
    notch = dict(row["notch"])
    instructions = [packing.get("special_instructions")]
    # A tooling field holds one tool; extra marks in the sheet (e.g. "CENTER, double") go to the instructions.
    for key in ("type", "blade", "holder", "v_flat", "punch"):
        parts = [p.strip() for p in str(notch.get(key) or "").split(",") if p.strip()]
        notch[key] = parts[0] if parts else None
        if len(parts) > 1:
            instructions.append(f"{key.replace('_', ' ').title()}: also {', '.join(parts[1:])}")
    if notch.get("height_gauge"):
        instructions.append(f"Height gauge {notch['height_gauge']}")
    if row.get("white_kraft_liner"):
        instructions.append("White kraft liner: yes")
    instructions.append(f"Imported from client specification workbook, sheet row {row['row']} ({row['size_text']})")
    dynamic = {
        "valid_upto": (today + timedelta(days=365)).isoformat(),
        "prepared_by": "Client specification workbook",
        "prepared_date": today.isoformat(),
        "sign_off_note": f"Approved by client in the specification workbook (row {row['row']}); imported {today.isoformat()}",
        "glue_base_percent": "12.5",
        "allowed_parchment_groups_json": json.dumps(row["parchment_families"]),
        "notch_type": notch.get("type") or "",
        "notching_blade": notch.get("blade") or "",
        "notching_holder": notch.get("holder") or "",
        "v_flat": notch.get("v_flat") or "",
        "punch": notch.get("punch") or "",
        "notch_direction": notch.get("direction") or "",
        "notch_distance_mm": f"{notch['distance_mm']:g}" if notch.get("distance_mm") else "",
        "notch_depth_mm": f"{notch['depth_mm']:g}" if notch.get("depth_mm") else "",
        "box_code": packing.get("box") or "",
        "qty_per_box": f"{packing['qty_per_box']:g}" if packing.get("qty_per_box") else "",
        "plastic_required": "true",
        "plastic_per_box": "1",
        "bopp_required": "true",
        "fadda_per_box": f"{packing['fadda_per_box']:g}" if packing.get("fadda_per_box") else "0",
        "special_instructions": " · ".join(i for i in instructions if i),
        "measured_finished_dry_g": f"{row['measured_dry_g']:g}" if row.get("measured_dry_g") else "",
        "actual_tube_height_mm": f"{row['actual_height_mm']:g}" if row.get("actual_height_mm") else "",
        # The editor's ± bands (used only if the spec is edited later); the saved limits above are the client's.
        "tolerance_bands_json": json.dumps({"id": 0.5, "od": 0.2, "length": 0.2, "weightG": 5, "csPct": 10, "moisture": 1}),
        "workbook_source_json": json.dumps({"row": row["row"], "size_text": row["size_text"], "notes": row["notes"], "in_process_qc": row["workbook_qc"]}),
    }
    if adhesive:
        dynamic["adhesive_components_json"] = json.dumps(adhesive)
    profile = {
        "dimensions": {
            "id_mm": {"avg": ident, "min": limits["id_min_mm"], "max": limits["id_max_mm"]},
            "od_mm": {"avg": od, "min": limits["od_min_mm"], "max": limits["od_max_mm"]},
            "length_mm": {"avg": length, "min": limits["length_min_mm"], "max": limits["length_max_mm"]},
        },
        "quality_targets": {
            "tube_weight_g": {"avg": weight, "min": limits["weight_min_g"], "max": limits["weight_max_g"]},
            "cs_n": {"avg": cs, "min": limits["cs_min_n"], "max": limits["cs_max_n"]},
            "moisture_pct": {"avg": 9.0, "min": 8.0, "max": 10.0},
        },
        "recipe": {"parchment_percent": 1.5, "parchment_groups": row["parchment_families"], "adhesive_components": adhesive},
        "notch_tooling": {k: notch.get(k) for k in ("type", "blade", "holder", "v_flat", "punch", "direction", "distance_mm", "depth_mm")},
        "packing_rules": {"box_code": packing.get("box"), "qty_per_box": packing.get("qty_per_box"), "fadda_per_box": packing.get("fadda_per_box"), "instructions": packing.get("special_instructions")},
        "source": {"kind": "client_workbook", "row": row["row"]},
    }
    tl4 = sum(c["ratio_percent"] for c in adhesive if c["item_code"] in ("20100",))
    vinsol = sum(c["ratio_percent"] for c in adhesive if c["item_code"] in ("30100",))
    return {
        "customer_id": customer["id"],
        "customer_name": customer["name"],
        "customer_name_snapshot": customer["name"],
        "tube_size_id": tube["id"],
        "mandrel_id": mandrel["id"],
        "required_cs": cs,
        "target_tube_weight": weight,
        **limits,
        "parchment_percent": 1.5,
        "parchment_allowed": bool(row["parchment_families"]),
        "adhesive_percent": 12.5,
        "moisture_loss_percent": 9.0,
        "shrink_percent": 9.0,
        "adhesive_20100_percent": tl4 or None,
        "adhesive_30100_percent": vinsol or None,
        "profile": profile,
        "dynamic_fields": [{"field_key": k, "value": v} for k, v in dynamic.items()],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", required=True)
    parser.add_argument("--plant", default="PLANT_A", help="Plant to load into (PLANT_A / PLANT_B or its id)")
    parser.add_argument("--auth-url", default=os.environ.get("ERP_AUTH_URL", "http://127.0.0.1:18001"))
    parser.add_argument("--master-url", default=os.environ.get("ERP_MASTER_URL", "http://127.0.0.1:18002"))
    parser.add_argument("--spec-url", default=os.environ.get("ERP_SPEC_URL", "http://127.0.0.1:18003"))
    parser.add_argument("--rows", help="Only these sheet rows, e.g. 6,8,10")
    parser.add_argument("--paper-map", action="append", default=[], help="grade=PAPERCODE, e.g. 351=VP351 (repeatable)")
    parser.add_argument("--mandrel-length", type=float, default=1600.0, help="Length for mandrel masters that have to be created")
    parser.add_argument("--dry-run", action="store_true", help="Match masters and report; create nothing")
    parser.add_argument("--report", help="Write the result as JSON here")
    args = parser.parse_args()

    data = json.loads(Path(args.data).read_text())
    rows = [r for r in data["rows"] if "skip" not in r]
    if args.rows:
        wanted = {int(x) for x in args.rows.split(",")}
        rows = [r for r in rows if r["row"] in wanted]
    overrides = dict(item.split("=", 1) for item in args.paper_map)
    source_key = "client-workbook:" + Path(args.data).stem
    # Dates come from the data file so a re-run sends identical content.
    today = date.fromisoformat(data["summary"]["extracted_on"])
    erp = Erp(args)
    # Store records under the plant's canonical id (what the app and production send), never an alias.
    plants = erp.call("GET", args.auth_url, "/plants")
    plant = next((p for p in plants if norm(p.get("code")) == norm(args.plant) or str(p.get("id")).lower() == args.plant.lower()), None)
    if plant is None:
        raise SystemExit(f"Plant {args.plant} not found; choose one of: {', '.join(str(p.get('code')) for p in plants)}")
    args.plant = str(plant["id"])
    print(f"Importing into plant {plant.get('code')} ({args.plant})", flush=True)
    report = {"plant": args.plant, "data": args.data, "dry_run": args.dry_run, "created": Counter(), "warnings": [], "rows": []}

    # Specs and their QC need the seasonal rules; this also activates them.
    if not args.dry_run:
        erp.call("POST", args.spec_url, "/season/bootstrap", {"request_id": f"import-bootstrap-{uuid.uuid4()}"})

    customers = erp.call("GET", args.master_url, "/master/customers/")
    mandrels = erp.call("GET", args.master_url, "/master/mandrels/")
    tubes = erp.call("GET", args.master_url, "/master/tube-sizes/")
    papers = [p for p in erp.call("GET", args.master_url, "/master/papers/") if p.get("active", True)]
    codes = {norm(c.get("customer_code")) for c in customers}

    paper_for = {}
    for grade in sorted({p["grade"] for r in rows for p in r["plies"]}):
        paper, note = pick_paper(grade, papers, overrides)
        if note:
            report["warnings"].append(note)
        if paper is None:
            spec = GRADES.get(grade)
            if not spec:
                report["warnings"].append(f"grade {grade}: no paper master and no grade data; rows using it import with recipe pending")
                continue
            if spec.get("assumed"):
                report["warnings"].append(f"grade {grade}: created paper master with assumed {spec['gsm']} GSM / {spec['bf']} BF — confirm in Masters › Papers")
            body = {"code": grade, "variety": "Kraft", "gsm": spec["gsm"], "bf": spec["bf"], "bulk_factor": spec["bulk_factor"], "ply_bond": spec["ply_bond"]}
            if args.dry_run:
                paper = {"id": f"dry-{grade}", **body}
            else:
                paper = erp.call("POST", args.master_url, "/master/papers/", body)
                papers.append(paper)
            report["created"]["papers"] += 1
        paper_for[grade] = paper

    for row in rows:
        result = {"row": row["row"], "client": row["client"], "size": row["size_text"], "variant": row.get("variant"), "notes": list(row["notes"])}
        try:
            customer = next((c for c in customers if name_key(c.get("name")) == name_key(row["client"])), None)
            if customer is None:
                body = {"customer_code": customer_code(row["client"], codes), "name": row["client"]}
                customer = {"id": f"dry-{body['customer_code']}", **body} if args.dry_run else erp.call("POST", args.master_url, "/master/customers/", body)
                customers.append(customer)
                report["created"]["customers"] += 1
            mandrel = next((m for m in mandrels if abs(float(m.get("outer_diameter_mm") or 0) - row["mandrel_mm"]) < 0.005 and m.get("active", True)), None)
            if mandrel is None:
                body = {"outer_diameter_mm": row["mandrel_mm"], "od_tolerance_mm": 0.1, "length_mm": args.mandrel_length, "material": "Steel"}
                if args.dry_run:
                    mandrel = {"id": f"dry-m{row['mandrel_mm']}", **body}
                else:
                    try:
                        mandrel = erp.call("POST", args.master_url, "/master/mandrels/", body)
                    except ApiError as exc:
                        if exc.status != 409:
                            raise
                        plant_tag = norm(args.plant)[-2:] or "X"
                        mandrel = erp.call("POST", args.master_url, "/master/mandrels/", {**body, "mandrel_code": f"OD{row['mandrel_mm']:g}-{plant_tag}".replace(".", "P")})
                mandrels.append(mandrel)
                report["created"]["mandrels"] += 1
            variant = row.get("variant") or ""
            same = [t for t in tubes if t.get("active", True) and abs(float(t["inner_diameter_mm"]) - row["id_mm"]) < 0.005 and abs(float(t["outer_diameter_mm"]) - row["od_mm"]) < 0.005 and abs(float(t["length_mm"]) - row["length_mm"]) < 0.005]
            if variant:
                tube = next((t for t in same if (t.get("description") or "").strip() == variant), None)
            else:
                tube = next((t for t in same if not (t.get("description") or "").strip()), None) or next((t for t in same if not str(t.get("description") or "").startswith(("[", "notch ", "sheet row "))), None)
            if tube is None:
                body = {"inner_diameter_mm": row["id_mm"], "outer_diameter_mm": row["od_mm"], "length_mm": row["length_mm"], "description": variant or None}
                tube = {"id": f"dry-t{row['row']}", **body} if args.dry_run else erp.call("POST", args.master_url, "/master/tube-sizes/", body)
                tubes.append(tube)
                report["created"]["tube_sizes"] += 1
            layers, missing = [], []
            for ply in row["plies"]:
                paper = paper_for.get(ply["grade"])
                if paper is None:
                    missing.append(ply["grade"])
                    continue
                for _ in range(ply["count"]):
                    layers.append({"ply_no": len(layers) + 1, "paper_id": str(paper["id"]), "gsm_snapshot": float(paper["gsm"]), "bf_snapshot": float(paper.get("bf") or GRADES.get(ply["grade"], {}).get("bf") or 20), "bulk_snapshot": float(paper.get("bulk_factor") or 1)})
            if missing:
                layers = []
                result["notes"].append(f"No paper master for grade(s) {', '.join(missing)}; recipe left pending")
            spec = spec_payload(row, customer, mandrel, tube, today)
            recipes = {"ROY": {"layers": layers, "notes": f"Client workbook row {row['row']}"}} if layers else {}
            if args.dry_run:
                result.update(status="ready", recipe="supplied" if layers else "pending")
            else:
                import_key = f"{source_key}:{row['row']}"
                body = {"request_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"{args.plant}:{import_key}")), "import_key": import_key, "spec": spec, "recipes": recipes, "note": f"Client specification workbook row {row['row']}"}
                try:
                    out = erp.call("POST", args.spec_url, "/specs/import-approved", body)
                    replayed = bool(out.get("replayed"))
                    result.update(status="already approved" if replayed else "approved", spec_id=out["spec_id"], recipe="pending" if out.get("recipe_pending") else "approved (both seasons)", warnings=out.get("warnings") or [])
                    report["created"]["already_present" if replayed else "approved_specs"] += 1
                except ApiError as exc:
                    detail = exc.detail
                    if exc.status == 409 and isinstance(detail, dict) and detail.get("code") in ("DUPLICATE_SPEC", "ALREADY_IMPORTED"):
                        result.update(status="already approved", spec_id=detail.get("spec_id"), note=detail.get("message"))
                        report["created"]["already_present"] += 1
                    else:
                        raise
        except ApiError as exc:
            result.update(status="failed", error=f"HTTP {exc.status}: {exc.detail}")
            report["created"]["failed"] += 1
        report["rows"].append(result)
        mark = {"approved": "✓", "already approved": "=", "ready": "·"}.get(result["status"], "✗")
        print(f"{mark} row {row['row']:>3} {row['client'][:34]:<34} {row['size_text'][:28]:<28} {result['status']}{' · recipe ' + result['recipe'] if result.get('recipe') else ''}{' · ' + result['error'] if result.get('error') else ''}", flush=True)

    report["created"] = dict(report["created"])
    statuses = Counter(r["status"] for r in report["rows"])
    print("\nSummary:", json.dumps({"rows": len(report["rows"]), **statuses, "created": report["created"]}))
    print("Recipe pending (approved for orders; production release waits for a recipe):", sum(1 for r in report["rows"] if r.get("recipe") == "pending"))
    for warning in report["warnings"]:
        print("WARNING:", warning)
    if args.report:
        Path(args.report).write_text(json.dumps(report, indent=1, default=str))
    sys.exit(1 if statuses.get("failed") else 0)


if __name__ == "__main__":
    main()
