"""Read-only dated paper demand using the canonical approved-recipe BOM calculator."""
import asyncio
import hashlib
import json
import math
import os
from datetime import date
from decimal import Decimal, ROUND_CEILING

import httpx
from fastapi import HTTPException
from src.services.http_client import http_client

SALES_URL = os.getenv("SALES_SERVICE_URL", "http://127.0.0.1:18008")
SPEC_URL = os.getenv("SPEC_SERVICE_URL", "http://127.0.0.1:18003")
MASTER_URL = os.getenv("MASTER_SERVICE_URL", "http://127.0.0.1:18002")
PRODUCTION_URL = os.getenv("PRODUCTION_SERVICE_URL", "http://127.0.0.1:18004")
INVENTORY_URL = os.getenv("INVENTORY_SERVICE_URL", "http://127.0.0.1:18005")


def dated_new_build_buckets(line, quantity):
    """Keep remaining manufacture on saved call-off dates before the line fallback.

    Explicit release allocations are excluded. Unassigned coverage is applied
    to later commitments so early shortages are never hidden by an assumption.
    This is a conservative material forecast, not a new commercial allocation.
    """
    remaining = max(0, float(quantity))
    buckets = []
    schedules = sorted((row for row in line.get("delivery_schedules", [])
                        if row.get("status") not in {"cancelled", "delivered"} and row.get("delivery_date")),
                       key=lambda row: (row["delivery_date"], row.get("id", "")))
    for row in schedules:
        available = max(0, float(row.get("quantity", 0)) - sum(float(allocation.get("quantity", 0)) for allocation in row.get("allocations", [])))
        qty = min(remaining, available)
        if qty > 0:
            buckets.append({"due_date": row["delivery_date"], "quantity": qty, "delivery_schedule_id": row.get("id")})
            remaining = round(remaining - qty, 4)
    if remaining > 0:
        buckets.append({"due_date": line["due_date"], "quantity": remaining, "delivery_schedule_id": None})
    # A single manufacturing batch may satisfy several rows on the same date.
    merged = {}
    for bucket in buckets:
        key = bucket["due_date"]
        if key not in merged:
            merged[key] = {"due_date": key, "quantity": 0, "delivery_schedule_ids": []}
        merged[key]["quantity"] += bucket["quantity"]
        if bucket["delivery_schedule_id"]:
            merged[key]["delivery_schedule_ids"].append(bucket["delivery_schedule_id"])
    return list(merged.values())


def job_material_need_date(line, job):
    active = [row for row in line.get("delivery_schedules", []) if row.get("status") not in {"cancelled", "delivered"} and row.get("delivery_date")]
    allocated = [row["delivery_date"] for row in active if job.get("release_lot_id") and any(
        allocation.get("release_lot_id") == job["release_lot_id"] for allocation in row.get("allocations", []))]
    return min(allocated or [line["due_date"], *(row["delivery_date"] for row in active)])


def explode_paper_demand(order, line, spec, recipe, bom, item_by_id, item_by_code, paper_by_id, start, end):
    """Canonical requirement for explicitly supplied new-build quantities.

    Released jobs are calculated separately from their frozen BOM and net issues.
    """
    due = date.fromisoformat(line["due_date"])
    if due > end:
        return [], None
    remaining = max(Decimal(0), Decimal(str(line.get("release_remaining_qty", 0))))
    if not remaining:
        return [], None
    tubes_per_bamboo = Decimal(str(bom.get("expected_output", {}).get("tubes_per_bamboo", 0)))
    if tubes_per_bamboo <= 0:
        return [], "BOM has no valid tubes-per-bamboo yield"
    bamboos = (remaining / tubes_per_bamboo).to_integral_value(rounding=ROUND_CEILING)
    output = []
    for paper in bom.get("raw_materials", {}).get("papers", []):
        master_id = str(paper.get("paper_id", ""))
        code = paper_by_id.get(master_id, {}).get("code", "")
        item = item_by_id.get(master_id) or item_by_code.get(code)
        if not item or item.get("type") != "RAW_PAPER" or item.get("uom") != "KG":
            return [], f"Paper {code or master_id} has no exact inventory KG mapping"
        per_bamboo = Decimal(str(paper.get("weight_kg", 0)))
        if per_bamboo <= 0:
            return [], f"Paper {code or master_id} has no valid BOM weight"
        output.append({"date": max(start, due).isoformat(), "due_date": due.isoformat(), "overdue": due < start,
            "item_id": item["id"], "item_code": item["item_code"], "item_name": item["name"],
            "qty_kg": float((per_bamboo * bamboos).quantize(Decimal("0.001"), rounding=ROUND_CEILING)),
            "sales_order_id": order["id"], "order_no": order["order_no"], "line_id": line["id"],
            "open_units": float(remaining), "released_units": line.get("released_qty", 0),
            "spec_id": spec["id"], "spec_version": spec["version"], "recipe_id": recipe["id"], "recipe_version": recipe["version"],
            "bamboos": int(bamboos), "basis": "UNRELEASED_OPEN_SALES_BOM"})
    # A material can occur in several recipe layers. Aggregate before subtracting
    # its single job-level issue balance, otherwise the same issue is deducted twice.
    grouped = {}
    for row in output:
        if row["item_id"] not in grouped:
            grouped[row["item_id"]] = row
        else:
            grouped[row["item_id"]]["qty_kg"] = round(grouped[row["item_id"]]["qty_kg"] + row["qty_kg"], 3)
    return (list(grouped.values()), None) if grouped else ([], "Approved BOM contains no paper materials")


async def material_demand(token, plant_id, start, end):
    if not plant_id or plant_id.upper() == "ALL":
        raise HTTPException(400, "Select one plant to calculate material demand")
    if end < start or (end - start).days > 366:
        raise HTTPException(422, "Choose a planning horizon of at most 366 days")
    headers = {"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id}
    async def get(base, path, params=None):
        try:
            response = await http_client.get(f"{base}{path}", headers=headers, params=params)
        except httpx.RequestError as exc:
            raise HTTPException(502, "A demand source is unavailable; requirements were not calculated") from exc
        if response.status_code >= 400:
            raise HTTPException(response.status_code if response.status_code in (401, 403) else 502, f"Demand source could not load {path}")
        return response.json()
    orders = []
    for offset in range(0, 10000, 500):
        page = await get(SALES_URL, "/sales-orders", {"status_group": "open", "limit": 500, "offset": offset})
        orders.extend(page)
        if len(page) < 500:
            break
    else:
        raise HTTPException(422, "Order book exceeds 10,000 open orders; narrow the planning scope")
    sizes, papers, items = await asyncio.gather(get(MASTER_URL, "/master/tube-sizes/", {"include_inactive": True}), get(MASTER_URL, "/master/papers/", {"include_inactive": True}), get(INVENTORY_URL, "/items/"))
    size_by_id = {row["id"]: row for row in sizes}
    paper_by_id = {row["id"]: row for row in papers}
    item_by_id = {row["id"]: row for row in items}
    item_by_code = {row["item_code"]: row for row in items}
    snapshots, issues = await asyncio.gather(get(PRODUCTION_URL, "/material-demand-snapshots"),
        get(INVENTORY_URL, "/material-issues/by-job"))
    if snapshots.get("coverage") != "all_linked_jobs" or issues.get("coverage") != "all_attributed_job_issues":
        raise HTTPException(502, "Production snapshots or material issue coverage is incomplete")
    jobs_by_line = {}
    issue_jobs = {}
    for job in snapshots.get("jobs", []):
        jobs_by_line.setdefault(job["sales_order_line_id"], []).append(job)
        for issue_id in job.get("reel_issue_ids", []):
            issue_jobs.setdefault(issue_id, set()).add(job["id"])
    net_issues = {(row["job_id"], row["item_id"]): row["net_issued_qty"] for row in issues.get("items", [])}
    shared_issues = set()
    for issue in issues.get("section_issues", []):
        owners = issue_jobs.get(issue["id"], set())
        if len(owners) == 1:
            key = (next(iter(owners)), issue["item_id"])
            # Reel issues use their own physical ledger; bulk issues use transactions.
            net_issues[key] = net_issues.get(key, 0) + issue["qty_kg"]
        elif owners:
            shared_issues.update((job_id, issue["item_id"]) for job_id in owners)
    fg_by_line = {}
    for allocation in issues.get("accepted_fg_allocations", []):
        fg_by_line.setdefault(allocation["line_id"], []).append(allocation)
    cache = {}; requirements = []; blocked = []; excluded = []; seen = set()
    for order in orders:
        if order["status"] not in {"approved", "released", "partially_released", "partially_dispatched"}:
            excluded.append({"order_no": order["order_no"], "reason": "Sales order awaiting approval"})
            continue
        for line in order.get("lines", []):
            if line["id"] in seen:
                continue
            seen.add(line["id"])
            if min([line["due_date"], *(row["delivery_date"] for row in line.get("delivery_schedules", [])
                if row.get("status") not in {"cancelled", "delivered"} and row.get("delivery_date"))]) > end.isoformat():
                continue
            spec_id = line["approved_spec_id"]
            linked_jobs = jobs_by_line.get(line["id"], [])
            linked_qty = sum(float(job.get("planned_qty", 0)) for job in linked_jobs)
            if float(line.get("released_qty", 0)) > linked_qty + 0.001:
                blocked.append({"order_no": order["order_no"], "line_id": line["id"], "spec_id": spec_id,
                    "reason": "Released quantity has no complete production-job linkage; residual requirement is unknown"})
            for job in linked_jobs:
                if job["status"] == "COMPLETED":
                    continue
                snapshot = job.get("material_plan_snapshot") or {}
                frozen_bom = snapshot.get("bom_snapshot") or snapshot.get("theoretical_consumption") or {}
                frozen_recipe = snapshot.get("recipe_snapshot") or {}
                frozen_spec = job.get("spec_snapshot") or {}
                job_rows, job_problem = explode_paper_demand(order,
                    {**line, "due_date": job_material_need_date(line, job), "release_remaining_qty": job["planned_qty"]},
                    {"id": spec_id, "version": frozen_spec.get("version")},
                    {"id": frozen_recipe.get("recipe_id") or frozen_recipe.get("id"), "version": frozen_recipe.get("version")},
                    frozen_bom, item_by_id, item_by_code, paper_by_id, start, end)
                if job_problem:
                    blocked.append({"order_no": order["order_no"], "line_id": line["id"], "job_id": job["id"],
                        "reason": "Frozen production requirement: " + job_problem})
                for row in job_rows:
                    key = (job["id"], row["item_id"])
                    if key in shared_issues or (job.get("started") and key not in net_issues):
                        blocked.append({"order_no": order["order_no"], "line_id": line["id"], "job_id": job["id"],
                            "reason": f"{row['item_code']}: started work has no attributed net material issue; reconcile section consumption before net purchasing"})
                        continue
                    issued = max(0, float(net_issues.get(key, 0)))
                    gross = row["qty_kg"]
                    requirements.append({**row, "job_id": job["id"], "basis": "FROZEN_JOB_RESIDUAL",
                        "gross_qty_kg": gross, "already_issued_kg": issued,
                        "qty_kg": round(max(0, gross - issued), 3)})
            linked_ids = {job["id"] for job in linked_jobs}
            accepted_fg = sum(float(row["quantity_pcs"]) for row in fg_by_line.get(line["id"], [])
                if row.get("spec_id") == spec_id and not linked_ids.intersection(row.get("source_job_ids", [])))
            new_build = max(0, min(float(line.get("release_remaining_qty", 0)),
                float(line.get("remaining_qty", line.get("release_remaining_qty", 0)))) - accepted_fg)
            if new_build <= 0:
                continue
            if spec_id not in cache:
                spec, recipes = await asyncio.gather(get(SPEC_URL, f"/specs/{spec_id}"), get(SPEC_URL, f"/recipes/spec/{spec_id}", {"status": "approved"}))
                size = size_by_id.get(spec.get("tube_size_id"))
                if not size or len(recipes) != 1 or spec.get("status") != "approved":
                    cache[spec_id] = (None, "An approved specification, one approved recipe and tube dimensions are required")
                elif float(size["length_mm"]) != int(float(size["length_mm"])):
                    cache[spec_id] = (None, "BOM calculator requires whole-mm tube length; review specification")
                else:
                    recipe = recipes[0]
                    bom = await get(SPEC_URL, f"/calculate/bom/{recipe['id']}", {"tube_length_mm": int(float(size["length_mm"])), "tube_od_mm": int(math.ceil(float(size["outer_diameter_mm"])))})
                    cache[spec_id] = ((spec, recipe, bom), None)
            source, problem = cache[spec_id]
            if source:
                for bucket in dated_new_build_buckets(line, new_build):
                    rows, problem = explode_paper_demand(order, {**line, "due_date": bucket["due_date"], "release_remaining_qty": bucket["quantity"]}, *source, item_by_id, item_by_code, paper_by_id, start, end)
                    requirements.extend({**row, "gross_qty_kg": row["qty_kg"], "already_issued_kg": 0,
                        "delivery_schedule_ids": bucket["delivery_schedule_ids"], "accepted_external_fg_pcs": accepted_fg,
                        "timing_basis": "Saved call-offs, then unscheduled line balance; unassigned coverage retained against later dates"} for row in rows)
                    if problem:
                        break
            if problem:
                blocked.append({"order_no": order["order_no"], "line_id": line["id"], "spec_id": spec_id, "reason": problem})
    digest = hashlib.sha256(json.dumps({"requirements": requirements, "blocked": blocked}, sort_keys=True).encode()).hexdigest()
    return {"requirements": requirements, "blocked": blocked, "excluded": excluded, "source_version": f"SALES-BOM:{digest}",
            "basis": "Unreleased approved sales demand plus residual paper for active jobs, using frozen job BOMs and item-specific net issues. Accepted allocated finished goods from outside the linked jobs reduce new-build units before BOM conversion. Saved customer call-offs set need dates; unscheduled quantities use the line delivery date. Where release-to-call-off attribution is absent, material timing conservatively uses the earliest commitment. Started jobs without issue attribution are flagged as incomplete; whole-bamboo cutting loss is included.",
            "as_of_date": start.isoformat(), "horizon_end": end.isoformat(), "order_count": len(orders)}
