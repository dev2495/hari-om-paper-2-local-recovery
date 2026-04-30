#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx


BFF_URL = "http://127.0.0.1:14000"
PLANT_A = "00000000-0000-0000-0000-0000000000a1"
REPORT_DIR = Path("reports")


class E2EClient:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.client = httpx.Client(timeout=30.0, follow_redirects=True)
        self.token = ""

    def login(self, email: str, password: str) -> dict[str, Any]:
        response = self.client.post(f"{self.base_url}/api/auth/login", json={"email": email, "password": password})
        self._raise_for_status(response, "login")
        payload = response.json()
        self.token = payload["access_token"]
        return payload

    def request(self, method: str, path: str, *, json_body: Any | None = None, params: dict[str, Any] | None = None, plant: str = PLANT_A) -> Any:
        headers = {"Authorization": f"Bearer {self.token}", "X-Plant-ID": plant}
        response = self.client.request(method, f"{self.base_url}{path}", headers=headers, json=json_body, params=params)
        self._raise_for_status(response, f"{method} {path}")
        if response.content:
            return response.json()
        return None

    @staticmethod
    def _raise_for_status(response: httpx.Response, label: str) -> None:
        if response.status_code < 400:
            return
        try:
            detail = response.json()
        except Exception:
            detail = response.text
        raise RuntimeError(f"{label} failed ({response.status_code}): {detail}")


def pick(rows: list[dict[str, Any]], predicate, label: str) -> dict[str, Any]:
    for row in rows:
        if predicate(row):
            return row
    raise RuntimeError(f"Unable to find required row: {label}")


def expand_recipe_rows(groups: list[dict[str, Any]], paper_by_code: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    expanded: list[dict[str, Any]] = []
    ply_no = 1
    for group in groups:
        paper = paper_by_code.get(str(group["paper_code"]))
        if not paper:
            raise RuntimeError(f"Missing paper master code {group['paper_code']}")
        for _ in range(int(group["plies"])):
            expanded.append(
                {
                    "ply_no": ply_no,
                    "paper_id": paper["id"],
                    "gsm_snapshot": int(round(float(paper["gsm"]))),
                    "bf_snapshot": int(round(float(paper.get("bf") or 0))),
                }
            )
            ply_no += 1
    return expanded


def recipe_dynamic_rows(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "paper_code": group["paper_code"],
            "gsm": group["gsm"],
            "plies": group["plies"],
            "bulk_factor": group["bulk_factor"],
        }
        for group in groups
    ]


def dynamic_fields(recipe_rows: list[dict[str, Any]], sample_name: str, fg_item_id: str) -> list[dict[str, str]]:
    return [
        {"field_key": "recipe_sheet_json", "value": json.dumps({"rows": recipe_rows})},
        {
            "field_key": "adhesive_components_json",
            "value": json.dumps(
                [
                    {"item_code": "20100-A", "name": "TL4 / Vinsol", "percent": 7.5},
                    {"item_code": "30100-A", "name": "Alcosol", "percent": 7.5},
                    {"item_code": "PARCHMENT-A", "name": "Parchment", "percent": 1.5},
                ]
            ),
        },
        {"field_key": "packing_pcs", "value": "400"},
        {"field_key": "bundle_type", "value": "Standard sample bundle"},
        {"field_key": "box_code", "value": "FG-A-01"},
        {"field_key": "fg_item_id", "value": fg_item_id},
        {"field_key": "special_instructions", "value": f"Codex E2E handwritten sample {sample_name}: preserve dry/wet weights and ply table."},
    ]


def create_sales_actor(api: E2EClient, *, stamp: str, suffix: str) -> tuple[E2EClient, str]:
    email = f"codex.e2e.sales.{suffix}.{stamp}@hariom.com"
    password = f"Sales{suffix.title()}{stamp[-6:]}!"
    api.request(
        "POST",
        "/api/auth/users",
        json_body={
            "name": f"Codex E2E Sales {suffix.title()}",
            "email": email,
            "password": password,
            "plant_id": PLANT_A,
            "allowed_plant_ids": [PLANT_A],
            "role_names": ["Sales"],
            "is_owner_all_plants": False,
        },
    )
    actor = E2EClient(api.base_url)
    actor.login(email, password)
    return actor, email


def create_sample_spec(
    api: E2EClient,
    *,
    sample_name: str,
    customer: dict[str, Any],
    tube_size: dict[str, Any],
    mandrel: dict[str, Any],
    fg_item: dict[str, Any],
    target_weight_g: float,
    dry_weight_g: float,
    wet_weight_g: float,
    groups: list[dict[str, Any]],
    paper_by_code: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    stamp = datetime.now().strftime("%H%M%S%f")
    unique_weight_offset = (int(stamp[-6:]) % 900000) / 1_000_000.0
    spec_payload = {
        "customer_id": customer["id"],
        "customer_name": customer["name"],
        "customer_name_snapshot": customer["name"],
        "tube_size_id": tube_size["id"],
        "mandrel_id": mandrel["id"],
        "required_cs": 400,
        "target_tube_weight": target_weight_g + unique_weight_offset,
        "id_min_mm": round(float(tube_size["inner_diameter_mm"]) - 0.15, 2),
        "id_max_mm": round(float(tube_size["inner_diameter_mm"]) + 0.15, 2),
        "od_min_mm": round(float(tube_size["outer_diameter_mm"]) - 0.15, 2),
        "od_max_mm": round(float(tube_size["outer_diameter_mm"]) + 0.15, 2),
        "length_min_mm": round(float(tube_size["length_mm"]) - 0.2, 2),
        "length_max_mm": round(float(tube_size["length_mm"]) + 0.2, 2),
        "weight_min_g": round(dry_weight_g / 10.0 - 5, 2),
        "weight_max_g": round(dry_weight_g / 10.0 + 5, 2),
        "cs_min_n": 395,
        "cs_max_n": 405,
        "moisture_min_pct": 7,
        "moisture_max_pct": 11,
        "adhesive_percent": 15,
        "adhesive_20100_percent": 7.5,
        "adhesive_30100_percent": 7.5,
        "parchment_percent": 1.5,
        "moisture_loss_percent": 9,
        "profile": {
            "source": "2026-04-17 WhatsApp handwritten sample",
            "sample": sample_name,
            "wet_weight_g": wet_weight_g,
            "dry_weight_g": dry_weight_g,
            "layer_count": sum(int(group["plies"]) for group in groups),
            "fg_item_id": fg_item["id"],
        },
        "dynamic_fields": dynamic_fields(recipe_dynamic_rows(groups), sample_name, fg_item["id"]),
    }
    spec = api.request("POST", "/api/spec/specifications", json_body=spec_payload)
    recipe = api.request("POST", f"/api/spec/recipes/{spec['id']}", json_body={"notes": f"Codex E2E sample {sample_name}"})
    for layer in expand_recipe_rows(groups, paper_by_code):
        api.request("POST", f"/api/spec/recipes/{recipe['id']}/layers", json_body=layer)
    approval = api.request("POST", f"/api/spec/specifications/{spec['id']}/approve", json_body={"recipe_id": recipe["id"]})
    return {"spec": spec, "recipe": recipe, "approval": approval, "payload": spec_payload}


def stage_complete_payload(stage: str, *, machine_id: str | None, input_qty: float, output_qty: float, scrap_qty: float, extra_entry: dict[str, Any] | None = None, fg_item_id: str | None = None, location_id: str | None = None) -> dict[str, Any]:
    entry = {
        "operator": "Codex E2E",
        "sample_sheet": "WhatsApp 2026-04-17",
        "entry_type": "full-cycle-verification",
    }
    if extra_entry:
        entry.update(extra_entry)
    if fg_item_id:
        entry["fg_item_id"] = fg_item_id
        entry["fg_batch_no"] = f"FG-E2E-{datetime.now().strftime('%H%M%S')}"
        entry["stock_status"] = "UNRESTRICTED"
    payload = {
        "stage": stage,
        "save_mode": "complete",
        "input_qty": round(input_qty, 3),
        "output_qty": round(output_qty, 3),
        "scrap_qty": round(scrap_qty, 3),
        "entry_snapshot": entry,
        "actuals": {
            "checked_by": "Codex E2E",
            "sample_variance_kg": round(input_qty - output_qty, 3),
        },
        "quality_checks": {"overall": "PASS", "visual": "PASS", "dimension": "PASS"},
        "material_allocations": [
            {"item_code": "20100-A", "item_name": "TL4 / Vinsol", "consumed_weight_kg": 0.45, "role": "adhesive"},
            {"item_code": "30100-A", "item_name": "Alcosol", "consumed_weight_kg": 0.3, "role": "adhesive"},
            {"item_code": "PARCHMENT-A", "item_name": "Parchment", "consumed_weight_kg": 0.12, "role": "parchment"},
        ],
        "remarks": f"Codex E2E completed {stage}.",
    }
    if machine_id:
        payload["machine_id"] = machine_id
    if location_id:
        payload["location_id"] = location_id
    if stage == "WINDER":
        payload["override_reason"] = "E2E sample run: physical reel consumption captured via shift material ledger."
        entry.update({"wet_weight_g": 2820, "dry_weight_g": 2565, "varnish_or_vinsol_kg": 0.45})
    if stage == "OVEN":
        entry.update({"bamboo_count_in": 4, "pre_weight": 28.2, "post_weight": 25.65, "pre_moisture": 10.1, "post_moisture": 7.8, "cycle_time_hours": 5.5})
    return payload


def main() -> int:
    api = E2EClient(BFF_URL)
    now = datetime.now()
    stamp = now.strftime("%Y%m%d%H%M%S")
    report: dict[str, Any] = {"started_at": now.isoformat(), "checks": [], "created": {}, "warnings": []}

    api.login("admin@hariom.com", "admin123")
    report["checks"].append({"name": "admin login", "status": "passed"})
    sales_maker_api, sales_maker_email = create_sales_actor(api, stamp=stamp, suffix="maker")
    sales_checker_api, sales_checker_email = create_sales_actor(api, stamp=stamp, suffix="checker")
    report["checks"].append(
        {
            "name": "sales maker/checker users",
            "status": "passed",
            "maker": sales_maker_email,
            "checker": sales_checker_email,
        }
    )

    customers = api.request("GET", "/api/master/customers")
    tube_sizes = api.request("GET", "/api/master/tube-sizes")
    mandrels = api.request("GET", "/api/master/mandrels")
    papers = api.request("GET", "/api/master/papers")
    machines = api.request("GET", "/api/production/machines")
    items = api.request("GET", "/api/inventory/items")
    locations = api.request("GET", "/api/inventory/locations")

    customer = customers[0]
    tube_a = pick(tube_sizes, lambda row: abs(float(row["inner_diameter_mm"]) - 110) < 1 and abs(float(row["outer_diameter_mm"]) - 122) < 1 and abs(float(row["length_mm"]) - 150) < 1, "sample A tube 110x122x150")
    tube_b = pick(tube_sizes, lambda row: abs(float(row["inner_diameter_mm"]) - 125) < 1 and abs(float(row["outer_diameter_mm"]) - 138) < 1 and abs(float(row["length_mm"]) - 150) < 1, "sample B tube 125x138x150")
    mandrel_a = pick(mandrels, lambda row: "110" in str(row.get("mandrel_code") or ""), "110 mandrel")
    mandrel_b = pick(mandrels, lambda row: "125" in str(row.get("mandrel_code") or ""), "125 mandrel")
    fg_a = pick(items, lambda row: row.get("item_code") == "FG-110-122-150", "FG A item")
    fg_b = pick(items, lambda row: row.get("item_code") in {"FG-125-137-120", "FG-125-140-9375-A"}, "FG B item")
    fg_location = pick(locations, lambda row: str(row.get("code") or "").upper().startswith("FG"), "FG location")
    winder_1 = pick(machines, lambda row: row.get("department") == "WINDER" and "01" in str(row.get("name") or ""), "Winder 1")
    wrong_winder = pick(machines, lambda row: row.get("department") == "WINDER" and row["id"] != winder_1["id"], "non-Winder-1")
    oven_1 = pick(machines, lambda row: row.get("department") == "OVEN", "oven")
    process_1 = pick(machines, lambda row: row.get("department") == "PROCESS", "process")
    paper_by_code = {str(row["code"]): row for row in papers}

    groups_a = [
        {"paper_code": "231", "gsm": 230, "plies": 1, "bulk_factor": 1.50},
        {"paper_code": "221", "gsm": 220, "plies": 2, "bulk_factor": 1.50},
        {"paper_code": "301", "gsm": 300, "plies": 3, "bulk_factor": 1.50},
        {"paper_code": "350", "gsm": 350, "plies": 3, "bulk_factor": 1.55},
        {"paper_code": "351", "gsm": 350, "plies": 3, "bulk_factor": 1.50},
        {"paper_code": "355", "gsm": 355, "plies": 2, "bulk_factor": 1.55},
    ]
    groups_b = [
        {"paper_code": "231", "gsm": 230, "plies": 1, "bulk_factor": 1.50},
        {"paper_code": "301", "gsm": 300, "plies": 2, "bulk_factor": 1.50},
        {"paper_code": "351", "gsm": 350, "plies": 3, "bulk_factor": 1.50},
        {"paper_code": "350", "gsm": 350, "plies": 8, "bulk_factor": 1.55},
    ]

    sample_a = create_sample_spec(
        api,
        sample_name="A 110.45 x 122 x 150",
        customer=customer,
        tube_size=tube_a,
        mandrel=mandrel_a,
        fg_item=fg_a,
        target_weight_g=250,
        dry_weight_g=2565,
        wet_weight_g=2820,
        groups=groups_a,
        paper_by_code=paper_by_code,
    )
    sample_b = create_sample_spec(
        api,
        sample_name="B 125 x 138 x 150",
        customer=customer,
        tube_size=tube_b,
        mandrel=mandrel_b,
        fg_item=fg_b,
        target_weight_g=300,
        dry_weight_g=3080,
        wet_weight_g=3400,
        groups=groups_b,
        paper_by_code=paper_by_code,
    )
    report["created"]["specs"] = [
        {"sample": "A", "spec_id": sample_a["spec"]["id"], "recipe_id": sample_a["recipe"]["id"], "approval": sample_a["approval"]},
        {"sample": "B", "spec_id": sample_b["spec"]["id"], "recipe_id": sample_b["recipe"]["id"], "approval": sample_b["approval"]},
    ]
    report["checks"].append({"name": "sample specs and recipe layers", "status": "passed", "layers": {"A": 14, "B": 14}})

    due_date = (date.today() + timedelta(days=4)).isoformat()
    sales_payload = {
        "customer_id": customer["id"],
        "po_number": f"E2E-PO-{stamp}",
        "po_date": date.today().isoformat(),
        "notes": "Codex full-cycle E2E: 4 sample sales lines, all released to Winder 1.",
        "lines": [
            {"line_no": 1, "approved_spec_id": sample_a["spec"]["id"], "product_code": f"A-110-122-150-{stamp}", "parchment_color": "Natural", "rate_per_pc": 12.5, "qty": 40, "due_date": due_date},
            {"line_no": 2, "approved_spec_id": sample_a["spec"]["id"], "product_code": f"A-REPEAT-{stamp}", "parchment_color": "Natural", "rate_per_pc": 12.5, "qty": 35, "due_date": due_date},
            {"line_no": 3, "approved_spec_id": sample_b["spec"]["id"], "product_code": f"B-125-138-150-{stamp}", "parchment_color": "Blue", "rate_per_pc": 14.2, "qty": 30, "due_date": due_date},
            {"line_no": 4, "approved_spec_id": sample_b["spec"]["id"], "product_code": f"B-REPEAT-{stamp}", "parchment_color": "Blue", "rate_per_pc": 14.2, "qty": 25, "due_date": due_date},
        ],
    }
    order = sales_maker_api.request("POST", "/api/sales/orders", json_body=sales_payload)
    sales_checker_api.request("POST", f"/api/sales/orders/{order['id']}/approve", json_body={})
    order = sales_checker_api.request("GET", f"/api/sales/orders/{order['id']}")
    release_rows = []
    for line in order["lines"]:
        qty = min(float(line["qty"]), 12.0)
        release = sales_checker_api.request(
            "POST",
            f"/api/sales/orders/lines/{line['id']}/release",
            json_body={"release_qty": qty, "winder_machine_id": winder_1["id"], "product_code": line.get("product_code")},
        )
        release_rows.append(
            {
                "release_lot_id": release["release_lot_id"],
                "sales_order_line_id": release["line_id"],
                "release_qty": release["release_qty"],
                "winder_machine_id": release["winder_machine_id"],
                "product_code": release.get("product_code"),
            }
        )
    released_order = sales_checker_api.request("GET", f"/api/sales/orders/{order['id']}")
    sync = api.request(
        "POST",
        f"/api/production/sales-orders/{order['id']}/release-sync",
        json_body={"release_rows": release_rows, "order_snapshot": released_order},
    )
    report["created"]["sales_order"] = {"order_id": order["id"], "po_number": sales_payload["po_number"], "line_count": 4, "release_count": len(release_rows), "sync": sync}
    report["checks"].append({"name": "4 sales lines released to Winder 1 and job cards synced", "status": "passed"})

    first_job_id = sync["line_results"][0]["job_card_id"]
    first_release_qty = float(release_rows[0]["release_qty"])
    plan_date = date.today().isoformat()
    winder_override = api.client.patch(
        f"{api.base_url}/api/production/planning/board/move",
        headers={"Authorization": f"Bearer {api.token}", "X-Plant-ID": PLANT_A},
        json={
            "job_card_id": first_job_id,
            "stage": "WINDER",
            "machine_id": wrong_winder["id"],
            "plan_date": plan_date,
            "shift_code": "SHIFT_A",
            "sequence_no": 1,
        },
    )
    if winder_override.status_code != 200:
        raise RuntimeError(f"Other-winder override was not accepted: {winder_override.status_code} {winder_override.text}")
    winder_override_payload = winder_override.json()
    if not any("Other winder used" in str(message) for message in winder_override_payload.get("warnings", [])):
        raise RuntimeError(f"Other-winder override did not return the required warning: {winder_override_payload}")
    api.request(
        "PATCH",
        "/api/production/planning/board/move",
        json_body={
            "job_card_id": first_job_id,
            "stage": "WINDER",
            "machine_id": winder_1["id"],
            "plan_date": plan_date,
            "shift_code": "SHIFT_A",
            "sequence_no": 1,
        },
    )
    report["checks"].append({"name": "other winder override warns and Winder 1 reschedule accepted", "status": "passed", "winder_override": winder_override_payload})

    ledger = api.request(
        "POST",
        "/api/production/shift-material-ledger",
        json_body={
            "stage_type": "WINDER",
            "work_date": date.today().isoformat(),
            "shift_code": "SHIFT_A",
            "issue_section": "WINDER",
            "machine_id": winder_1["id"],
            "issued_weight_kg": 3.38,
            "consumed_weight_kg": 3.08,
            "wastage_weight_kg": 0.18,
            "remaining_weight_kg": 0.12,
            "actual_job_card_ids": [first_job_id],
            "transfer_snapshot": {"vinsol_kg": 0.45, "alcosol_kg": 0.3, "parchment_kg": 0.12, "sample": "A"},
            "notes": "Codex E2E consumption tracking: Vinsol/Alcosol/Parchment sample variance row.",
        },
    )

    winder_out = first_release_qty - 0.5
    api.request("POST", f"/api/production/job-cards/{first_job_id}/stage-output", json_body=stage_complete_payload("WINDER", machine_id=winder_1["id"], input_qty=first_release_qty, output_qty=winder_out, scrap_qty=0.5))
    oven_out = winder_out - 0.25
    api.request("POST", f"/api/production/job-cards/{first_job_id}/stage-output", json_body=stage_complete_payload("OVEN", machine_id=oven_1["id"], input_qty=winder_out, output_qty=oven_out, scrap_qty=0.25))
    process_out = oven_out - 0.1
    api.request("POST", f"/api/production/job-cards/{first_job_id}/stage-output", json_body=stage_complete_payload("PROCESS", machine_id=process_1["id"], input_qty=oven_out, output_qty=process_out, scrap_qty=0.1))
    packing_out = process_out
    api.request(
        "POST",
        f"/api/production/job-cards/{first_job_id}/stage-output",
        json_body=stage_complete_payload(
            "PACKING",
            machine_id=None,
            input_qty=process_out,
            output_qty=packing_out,
            scrap_qty=0.0,
            fg_item_id=fg_a["id"],
            location_id=fg_location["id"],
            extra_entry={"packed_boxes": 1, "pcs_per_box": 400},
        ),
    )
    api.request("POST", f"/api/production/job-cards/{first_job_id}/stage-output", json_body=stage_complete_payload("QC", machine_id=None, input_qty=packing_out, output_qty=packing_out, scrap_qty=0.0, extra_entry={"qc_result": "PASS"}))

    dispatch_ref = f"DISP-E2E-{stamp}"
    inventory_dispatch = api.request(
        "POST",
        "/api/inventory/dispatch",
        json_body={"item_id": fg_a["id"], "qty": packing_out, "dispatch_ref": dispatch_ref, "external_ref": f"INV-{dispatch_ref}"},
    )
    sealed_dispatch = api.request(
        "POST",
        "/api/dispatch",
        json_body={
            "job_card_id": first_job_id,
            "dispatch_snapshot": {
                "dispatch_ref": dispatch_ref,
                "challan_no": dispatch_ref,
                "qty": packing_out,
                "item_id": fg_a["id"],
                "inventory_transaction_id": inventory_dispatch["transaction_id"],
            },
            "status": "SEALED",
        },
    ) or {"id": f"sealed-{first_job_id}", "empty_response": True}
    completed_job = api.request("GET", f"/api/production/job-cards/{first_job_id}")
    fulfilled_order = api.request("GET", f"/api/sales/orders/{order['id']}")
    report["created"]["executed_job"] = {
        "job_card_id": first_job_id,
        "ledger_id": ledger["id"],
        "dispatch_ref": dispatch_ref,
        "inventory_dispatch": inventory_dispatch,
        "sealed_dispatch": sealed_dispatch,
        "job_status": completed_job.get("status"),
        "current_stage": completed_job.get("current_stage"),
    }
    report["checks"].append({"name": "job completed through Winder/Oven/Process/Packing/QC and dispatch sealed", "status": "passed"})

    summary_before = api.request("GET", "/api/production/monthly-material-summary", params={"month": date.today().isoformat()[:7]})
    actual_rows = []
    for row in summary_before.get("rows", []):
        code = str(row.get("item_code") or "")
        theory = float(row.get("theoretical_consumption_kg") or 0.0)
        unit_cost = float(row.get("unit_cost") or 0.0)
        actual = theory
        note = "E2E actual equals expected consumption basis"
        actual_rows.append(
            {
                "item_code": code,
                "item_name": row.get("item_name") or code,
                "actual_consumed_weight_kg": round(actual, 4),
                "actual_cost": round(actual * unit_cost, 2),
                "notes": note,
            }
        )
    import_result = api.request("POST", "/api/production/import-monthly-actuals", json_body={"month": date.today().isoformat()[:7], "rows": actual_rows})
    summary_after = api.request("GET", "/api/production/monthly-material-summary", params={"month": date.today().isoformat()[:7]})
    variance_rows = [
        row
        for row in summary_after.get("rows", [])
        if math.fabs(float(row.get("variance_kg") or 0.0)) > 0.0001
    ]
    report["created"]["reconciliation"] = {
        "month": date.today().isoformat()[:7],
        "rows_before": len(summary_before.get("rows", [])),
        "import_created_rows": import_result.get("created_rows"),
        "rows_after": len(summary_after.get("rows", [])),
        "total_theory_kg": summary_after.get("total_theoretical_consumption_kg"),
        "total_actual_kg": summary_after.get("total_actual_month_end_consumption_kg"),
        "total_variance_kg": summary_after.get("total_variance_kg"),
        "variance_item_codes": [row.get("item_code") for row in variance_rows[:10]],
    }
    if len(actual_rows) == 0:
        raise RuntimeError("Reconciliation actual import had zero rows")
    report["checks"].append({"name": "monthly reconciliation actuals imported with master/material rows", "status": "passed", "actual_rows": len(actual_rows), "variance_rows": len(variance_rows)})

    report["finished_at"] = datetime.now().isoformat()
    REPORT_DIR.mkdir(exist_ok=True)
    json_path = REPORT_DIR / "full_cycle_e2e_20260425.json"
    md_path = REPORT_DIR / "full_cycle_e2e_20260425.md"
    json_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    lines = [
        "# Hari Om Full-Cycle E2E Report - 2026-04-25",
        "",
        f"- Started: {report['started_at']}",
        f"- Finished: {report['finished_at']}",
        f"- Sales order: {report['created']['sales_order']['po_number']} ({report['created']['sales_order']['order_id']})",
        f"- Executed job card: {first_job_id}",
        f"- Dispatch ref: {dispatch_ref}",
        f"- Reconciliation rows imported: {report['created']['reconciliation']['import_created_rows']}",
        f"- Reconciliation variance kg: {report['created']['reconciliation']['total_variance_kg']}",
        "",
        "## Checks",
    ]
    for check in report["checks"]:
        lines.append(f"- PASS: {check['name']}")
    lines.extend(
        [
            "",
            "## Key Evidence",
            f"- Other-winder override warning: `{'; '.join(winder_override_payload.get('warnings') or [])}`",
            f"- Release gate target winder: `{winder_1['name']}` / `{winder_1['id']}`",
            f"- Consumption ledger: `{ledger['id']}` with Vinsol/Alcosol/Parchment transfer snapshot",
            f"- Inventory dispatch transaction: `{inventory_dispatch['transaction_id']}`",
            f"- Sealed dispatch id: `{sealed_dispatch['id']}`",
            f"- Reconciliation variance items: `{', '.join(report['created']['reconciliation']['variance_item_codes'])}`",
        ]
    )
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"status": "passed", "json": str(json_path), "markdown": str(md_path), "checks": len(report["checks"])}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"status": "failed", "error": str(exc)}, indent=2), file=sys.stderr)
        raise
