"""Read-only dated material demand (paper, adhesive, parchment, packing) from the canonical approved-recipe BOM."""
import asyncio
import hashlib
import json
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


def normalize_code(value):
    return "".join(ch for ch in str(value or "").upper() if ch.isalnum())


def _is_paper_item(item):
    return bool(item) and item.get("type") == "RAW_PAPER" and item.get("uom") == "KG"


def resolve_paper_item(master_id, paper, item_by_id, item_by_code):
    """Spec BOM paper -> a RAW_PAPER KG stock item: same id, same code, or same code ignoring spaces/dashes.

    An item of another type or unit that happens to share the code is never a match.
    """
    code = paper.get("code", "")
    for item in (item_by_id.get(master_id), item_by_code.get(code)):
        if _is_paper_item(item):
            return item
    wanted = normalize_code(code)
    if not wanted:
        return None
    for candidate in item_by_code.values():
        if _is_paper_item(candidate) and normalize_code(candidate.get("item_code")) == wanted:
            return candidate
    return None


def explode_paper_demand(order, line, spec, recipe, bom, item_by_id, item_by_code, paper_by_id, start, end):
    """Canonical requirement for explicitly supplied new-build quantities.

    Released jobs are calculated separately from their frozen BOM and net issues.
    A paper with no stock item still yields its kg requirement (keyed by paper code) and a
    warning, so one unmapped paper never zeroes the whole plan.
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
    problems = []
    for paper in bom.get("raw_materials", {}).get("papers", []):
        master_id = str(paper.get("paper_id", ""))
        master = paper_by_id.get(master_id, {})
        code = master.get("code", "") or paper.get("code", "")
        item = resolve_paper_item(master_id, master, item_by_id, item_by_code)
        mapped = bool(item and item.get("type") == "RAW_PAPER" and item.get("uom") == "KG")
        if not mapped:
            problems.append(f"Paper {code or master_id} has no stock item yet")
        per_bamboo = Decimal(str(paper.get("weight_kg", 0)))
        if per_bamboo <= 0:
            problems.append(f"Paper {code or master_id} has no valid BOM weight")
            continue
        output.append({"date": max(start, due).isoformat(), "due_date": due.isoformat(), "overdue": due < start,
            "item_id": item["id"] if mapped else f"paper:{master_id or code}",
            "item_code": item["item_code"] if mapped else code,
            "item_name": item["name"] if mapped else f"{master.get('variety') or code} {master.get('gsm') or ''} GSM (no stock item)".strip(),
            "mapped": mapped, "paper_id": master_id or None, "paper_code": code,
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
    if not grouped:
        return [], "Approved BOM contains no paper materials"
    return list(grouped.values()), ("; ".join(dict.fromkeys(problems)) or None)


MATERIAL_ITEM_TYPES = {"ADHESIVE": {"ADHESIVE", "OTHER"}, "PARCHMENT": {"PARCHMENT"}, "PACKING": {"PACKAGING"}}
MATERIAL_ITEM_UOM = {"ADHESIVE": "KG", "PARCHMENT": "KG", "PACKING": "PCS"}


def resolve_material_item(material_class, code, name, items):
    """Spec BOM component -> stock item of the right class by code (ignoring spaces/dashes), then by name."""
    types = MATERIAL_ITEM_TYPES[material_class]
    pool = [row for row in items if row.get("type") in types and (row.get("uom") == MATERIAL_ITEM_UOM[material_class] or (material_class == "ADHESIVE" and row.get("uom") == "L" and float(row.get("density_kg_per_litre") or 0) > 0))]
    for wanted in filter(None, (normalize_code(code), normalize_code(name))):
        match = [row for row in pool if normalize_code(row.get("item_code")) == wanted or normalize_code(row.get("name")) == wanted]
        if len(match) == 1:
            return match[0]
    return None


def resolve_parchment_item(color, items):
    """Parchment is bought per colour: the one PARCHMENT item whose code or name carries the colour."""
    wanted = normalize_code(color)
    if not wanted:
        return None
    pool = [row for row in items if row.get("type") == "PARCHMENT" and row.get("uom") == "KG"]
    exact = [row for row in pool if normalize_code(row.get("item_code")) == wanted or normalize_code(row.get("name")) == wanted]
    match = exact or [row for row in pool if wanted in normalize_code(row.get("item_code")) or wanted in normalize_code(row.get("name"))]
    return match[0] if len(match) == 1 else None


def parchment_color_shares(line, spec_color=None):
    """Split a line's parchment by its colour breakup (open qty per colour; undecided qty stays 'UNASSIGNED')."""
    splits = [row for row in line.get("color_splits") or [] if float(row.get("open_qty", row.get("qty", 0)) or 0) > 0]
    if not splits:
        return [(line.get("parchment_color") or spec_color or "UNASSIGNED", Decimal(1))]
    open_by_color = [(row.get("color") or "UNASSIGNED", Decimal(str(row.get("open_qty", row.get("qty", 0))))) for row in splits]
    unassigned = Decimal(str(line.get("unassigned_color_qty") or 0))
    if unassigned > 0:
        open_by_color.append((line.get("parchment_color") or "UNASSIGNED", unassigned))
    total = sum(qty for _, qty in open_by_color)
    return [(color, qty / total) for color, qty in open_by_color] if total > 0 else [("UNASSIGNED", Decimal(1))]


def explode_other_demand(order, line, spec, bom, items, start, end):
    """Adhesive, parchment and packing need for a quantity, from the same spec BOM as paper.

    Adhesive and parchment are kg per whole bamboo (same bamboo count as paper). Packing is
    per box: boxes = ceil(pcs / pcs per box); plastic and fadda follow the box count.
    Unmapped components still yield their quantity (keyed by class and code) plus a warning.
    """
    due = date.fromisoformat(line["due_date"])
    if due > end:
        return [], None
    remaining = max(Decimal(0), Decimal(str(line.get("release_remaining_qty", 0))))
    if not remaining:
        return [], None
    tubes_per_bamboo = Decimal(str(bom.get("expected_output", {}).get("tubes_per_bamboo", 0)))
    bamboos = (remaining / tubes_per_bamboo).to_integral_value(rounding=ROUND_CEILING) if tubes_per_bamboo > 0 else Decimal(0)
    raw = bom.get("raw_materials", {}) or {}
    wanted = []
    if bamboos > 0:
        for component in (raw.get("adhesives", {}) or {}).get("components", []) or []:
            per_bamboo = Decimal(str(component.get("weight_kg") or 0))
            if per_bamboo > 0:
                wanted.append(("ADHESIVE", component.get("item_code") or component.get("name"), component.get("name"), "KG", per_bamboo * bamboos, 3))
        parchment = raw.get("parchment", {}) or {}
        per_bamboo = Decimal(str(parchment.get("weight_kg") or 0))
        if per_bamboo > 0 and line.get("parchment_required", True) is not False:
            for color, share in parchment_color_shares(line, parchment.get("color")):
                wanted.append(("PARCHMENT", color, f"Parchment {color}".strip(), "KG", per_bamboo * bamboos * share, 3))
    packing = bom.get("packing") or {}
    qty_per_box = Decimal(str(packing.get("qty_per_box") or 0))
    problems = []
    if packing.get("box_code") and qty_per_box > 0:
        boxes = (remaining / qty_per_box).to_integral_value(rounding=ROUND_CEILING)
        wanted.append(("PACKING", packing["box_code"], packing["box_code"], "PCS", boxes, 0))
        for sku_key, per_key in (("plastic_sku", "plastic_per_box"), ("fadda_sku", "fadda_per_box")):
            per_box = Decimal(str(packing.get(per_key) or 0))
            if packing.get(sku_key) and per_box > 0:
                wanted.append(("PACKING", packing[sku_key], packing[sku_key], "PCS", (boxes * per_box).to_integral_value(rounding=ROUND_CEILING), 0))
    elif packing.get("box_code"):
        problems.append(f"Box {packing['box_code']} has no pcs-per-box on the spec")
    grouped = {}
    for material_class, code, name, uom, qty, places in wanted:
        item = resolve_parchment_item(code, items) if material_class == "PARCHMENT" else resolve_material_item(material_class, code, name, items)
        mapped = bool(item)
        if not mapped:
            problems.append(f"{material_class.title()} {code or name or '?'} has no stock item yet")
        key = item["id"] if mapped else f"{material_class.lower()}:{normalize_code(code or name) or 'UNSPECIFIED'}"
        if mapped and item.get("uom") == "L":
            qty = qty / Decimal(str(item["density_kg_per_litre"]))
        step = Decimal(1).scaleb(-places)
        amount = float(qty.quantize(step, rounding=ROUND_CEILING))
        if key in grouped:
            grouped[key]["qty"] = round(grouped[key]["qty"] + amount, places)
            continue
        grouped[key] = {"date": max(start, due).isoformat(), "due_date": due.isoformat(), "overdue": due < start,
            "material_class": material_class, "item_id": key,
            "item_code": item["item_code"] if mapped else (code or name),
            "item_name": item["name"] if mapped else f"{name or code} (no stock item)",
            "mapped": mapped, "uom": (item.get("uom") if mapped else uom) or uom, "qty": amount,
            "sales_order_id": order["id"], "order_no": order["order_no"], "line_id": line["id"],
            "open_units": float(remaining), "bamboos": int(bamboos), "spec_id": spec.get("id")}
    return list(grouped.values()), ("; ".join(dict.fromkeys(problems)) or None)


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
    coverage_gap = snapshots.get("coverage") != "all_linked_jobs" or issues.get("coverage") != "all_attributed_job_issues"
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
    cache = {}; requirements = []; other_requirements = []; blocked = []; warnings = []; excluded = []; seen = set()
    if coverage_gap:
        warnings.append({"order_no": None, "line_id": None, "reason": "Some production issues are not attributed to job cards yet; residual need may be slightly overstated"})
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
            unlinked_released = max(0.0, float(line.get("released_qty", 0)) - linked_qty)
            if unlinked_released > 0.001:
                warnings.append({"order_no": order["order_no"], "line_id": line["id"], "spec_id": spec_id,
                    "reason": f"{unlinked_released:,.0f} released pcs have no job card yet — counted as still to make"})
            for job in linked_jobs:
                if job["status"] == "COMPLETED":
                    continue
                # On the planner: material is needed by the production slot. Still queued: by the customer date.
                plan_date = job.get("production_plan_date")
                need_date = min(plan_date, job_material_need_date(line, job)) if plan_date else job_material_need_date(line, job)
                job_source = {"source": "PRODUCTION_PLAN" if plan_date else "RELEASED_QUEUE", "job_card_no": job.get("job_card_no"), "production_plan_date": plan_date}
                snapshot = job.get("material_plan_snapshot") or {}
                frozen_bom = snapshot.get("bom_snapshot") or snapshot.get("theoretical_consumption") or {}
                frozen_recipe = snapshot.get("recipe_snapshot") or {}
                frozen_spec = job.get("spec_snapshot") or {}
                job_rows, job_problem = explode_paper_demand(order,
                    {**line, "due_date": need_date, "release_remaining_qty": job["planned_qty"]},
                    {"id": spec_id, "version": frozen_spec.get("version")},
                    {"id": frozen_recipe.get("recipe_id") or frozen_recipe.get("id"), "version": frozen_recipe.get("version")},
                    frozen_bom, item_by_id, item_by_code, paper_by_id, start, end)
                if job_problem:
                    warnings.append({"order_no": order["order_no"], "line_id": line["id"], "job_id": job["id"],
                        "reason": "Job card BOM: " + job_problem})
                for row in job_rows:
                    key = (job["id"], row["item_id"])
                    if key in shared_issues or (job.get("started") and key not in net_issues):
                        blocked.append({"order_no": order["order_no"], "line_id": line["id"], "job_id": job["id"],
                            "reason": f"{row['item_code']}: started work has no attributed net material issue; reconcile section consumption before net purchasing"})
                        continue
                    issued = max(0, float(net_issues.get(key, 0)))
                    gross = row["qty_kg"]
                    requirements.append({**row, **job_source, "job_id": job["id"], "basis": "FROZEN_JOB_RESIDUAL",
                        "gross_qty_kg": gross, "already_issued_kg": issued,
                        "qty_kg": round(max(0, gross - issued), 3)})
                other_rows, _ = explode_other_demand(order,
                    {**line, "due_date": need_date, "release_remaining_qty": job["planned_qty"],
                     "parchment_color": job.get("parchment_color") or line.get("parchment_color"), "color_splits": []},
                    {"id": spec_id}, frozen_bom, items, start, end)
                for row in other_rows:
                    issued = max(0, float(net_issues.get((job["id"], row["item_id"]), 0)))
                    other_requirements.append({**row, **job_source, "job_id": job["id"], "basis": "FROZEN_JOB_RESIDUAL",
                        "gross_qty": row["qty"], "already_issued": issued, "qty": round(max(0, row["qty"] - issued), 3)})
            linked_ids = {job["id"] for job in linked_jobs}
            accepted_fg = sum(float(row["quantity_pcs"]) for row in fg_by_line.get(line["id"], [])
                if row.get("spec_id") == spec_id and not linked_ids.intersection(row.get("source_job_ids", [])))
            new_build = max(0, min(float(line.get("release_remaining_qty", 0)) + unlinked_released,
                float(line.get("remaining_qty", line.get("release_remaining_qty", 0)))) - accepted_fg)
            if new_build <= 0:
                continue
            if spec_id not in cache:
                spec, recipes = await asyncio.gather(get(SPEC_URL, f"/specs/{spec_id}"), get(SPEC_URL, f"/recipes/spec/{spec_id}", {"status": "approved"}))
                size = size_by_id.get(spec.get("tube_size_id"))
                if not size or len(recipes) != 1 or spec.get("status") != "approved":
                    cache[spec_id] = (None, "An approved specification, one approved recipe and tube dimensions are required")
                else:
                    recipe = recipes[0]
                    # The calculator keeps fractional lengths (e.g. 120.5 mm); never round the tube.
                    bom = await get(SPEC_URL, f"/calculate/bom/{recipe['id']}", {"tube_length_mm": float(size["length_mm"]), "tube_od_mm": float(size["outer_diameter_mm"])})
                    cache[spec_id] = ((spec, recipe, bom), None)
            source, problem = cache[spec_id]
            if source:
                for bucket in dated_new_build_buckets(line, new_build):
                    rows, problem = explode_paper_demand(order, {**line, "due_date": bucket["due_date"], "release_remaining_qty": bucket["quantity"]}, *source, item_by_id, item_by_code, paper_by_id, start, end)
                    delivery_source = {"source": "CUSTOMER_DELIVERY" if bucket["delivery_schedule_ids"] else "LINE_DUE"}
                    requirements.extend({**row, **delivery_source, "gross_qty_kg": row["qty_kg"], "already_issued_kg": 0,
                        "delivery_schedule_ids": bucket["delivery_schedule_ids"], "accepted_external_fg_pcs": accepted_fg,
                        "timing_basis": "Saved call-offs, then unscheduled line balance; unassigned coverage retained against later dates"} for row in rows)
                    other_rows, other_problem = explode_other_demand(order, {**line, "due_date": bucket["due_date"], "release_remaining_qty": bucket["quantity"]},
                        source[0], source[2], items, start, end)
                    other_requirements.extend({**row, **delivery_source, "basis": "UNRELEASED_OPEN_SALES_BOM", "gross_qty": row["qty"], "already_issued": 0} for row in other_rows)
                    if other_problem:
                        warnings.append({"order_no": order["order_no"], "line_id": line["id"], "spec_id": spec_id, "reason": other_problem})
                if problem:
                    warnings.append({"order_no": order["order_no"], "line_id": line["id"], "spec_id": spec_id, "reason": problem})
            elif problem:
                blocked.append({"order_no": order["order_no"], "line_id": line["id"], "spec_id": spec_id, "reason": problem})
    digest = hashlib.sha256(json.dumps({"requirements": requirements, "blocked": blocked}, sort_keys=True).encode()).hexdigest()
    unmapped = {}
    for row in requirements:
        if not row.get("mapped", True):
            entry = unmapped.setdefault(row["item_id"], {"paper_id": row.get("paper_id"), "paper_code": row.get("paper_code"), "name": row["item_name"], "qty_kg": 0.0, "order_nos": set()})
            entry["qty_kg"] = round(entry["qty_kg"] + float(row["qty_kg"]), 3)
            entry["order_nos"].add(row.get("order_no"))
    unmapped_papers = [{**value, "order_nos": sorted(filter(None, value["order_nos"]))} for value in unmapped.values()]
    unmapped_other = {}
    for row in other_requirements:
        if not row.get("mapped", True):
            entry = unmapped_other.setdefault(row["item_id"], {"material_class": row["material_class"], "code": row["item_code"], "uom": row["uom"], "qty": 0.0, "order_nos": set()})
            entry["qty"] = round(entry["qty"] + float(row["qty"]), 3)
            entry["order_nos"].add(row.get("order_no"))
    return {"requirements": requirements, "material_requirements": other_requirements,
            "unmapped_materials": [{**value, "order_nos": sorted(filter(None, value["order_nos"]))} for value in unmapped_other.values()],
            "blocked": blocked, "warnings": warnings, "unmapped_papers": unmapped_papers,
            "excluded": excluded, "source_version": f"SALES-BOM:{digest}",
            "basis": "Unreleased approved sales demand plus residual paper for active jobs, using frozen job BOMs and item-specific net issues. Accepted allocated finished goods from outside the linked jobs reduce new-build units before BOM conversion. Saved customer call-offs set need dates; unscheduled quantities use the line delivery date. Where release-to-call-off attribution is absent, material timing conservatively uses the earliest commitment. Started jobs without issue attribution are flagged as incomplete; whole-bamboo cutting loss is included.",
            "as_of_date": start.isoformat(), "horizon_end": end.isoformat(), "order_count": len(orders)}


async def create_paper_stock_items(token, plant_id, paper_ids):
    """Create the missing KG stock item for each spec paper (item code = paper master code).

    Idempotent: a paper that already maps to a stock item is skipped.
    """
    if not plant_id or plant_id.upper() == "ALL":
        raise HTTPException(400, "Select one plant before creating stock items")
    headers = {"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id}
    papers_resp = await http_client.get(f"{MASTER_URL}/master/papers/", headers=headers, params={"include_inactive": True})
    items_resp = await http_client.get(f"{INVENTORY_URL}/items/", headers=headers)
    if papers_resp.status_code >= 400 or items_resp.status_code >= 400:
        raise HTTPException(502, "Paper master or stock items could not be loaded")
    papers = {str(row["id"]): row for row in papers_resp.json()}
    items = items_resp.json()
    item_by_id = {str(row["id"]): row for row in items}
    item_by_code = {row["item_code"]: row for row in items}
    created, skipped, failed = [], [], []
    for paper_id in dict.fromkeys(str(value) for value in paper_ids or []):
        paper = papers.get(paper_id)
        if not paper or str(paper.get("is_active", True)).lower() == "false" or str(paper.get("active", True)).lower() == "false":
            failed.append({"paper_id": paper_id, "reason": "Active paper master not found"})
            continue
        existing = resolve_paper_item(paper_id, paper, item_by_id, item_by_code)
        if existing:
            skipped.append({"paper_id": paper_id, "item_code": existing["item_code"]})
            continue
        clash = next((row for row in item_by_code.values() if normalize_code(row.get("item_code")) == normalize_code(paper.get("code"))), None)
        if clash:
            failed.append({"paper_id": paper_id, "item_code": clash.get("item_code"),
                           "reason": f"Code {clash.get('item_code')} is already a {clash.get('type')} item in {clash.get('uom')}. Change that item to RAW_PAPER in KG, or rename it, then retry."})
            continue
        body = {
            "item_code": paper.get("code"),
            "name": f"{paper.get('variety') or paper.get('code')} {paper.get('gsm') or ''} GSM".strip(),
            "type": "RAW_PAPER",
            "tracking_mode": "REEL",
            "uom": "KG",
        }
        response = await http_client.post(f"{INVENTORY_URL}/items/", headers=headers, json=body)
        if response.status_code >= 400:
            try:
                reason = response.json().get("detail")
            except ValueError:
                reason = response.text[:200]
            failed.append({"paper_id": paper_id, "item_code": body["item_code"], "reason": reason})
            continue
        row = response.json()
        item_by_code[row["item_code"]] = row
        created.append({"paper_id": paper_id, "item_id": row["id"], "item_code": row["item_code"]})
    return {"created": created, "skipped": skipped, "failed": failed}


MATERIAL_ITEM_CREATE = {"ADHESIVE": ("ADHESIVE", "KG"), "PARCHMENT": ("PARCHMENT", "KG"), "PACKING": ("PACKAGING", "PCS")}


async def create_material_stock_items(token, plant_id, materials):
    """Legacy route retained: arbitrary BOM text cannot create material masters."""
    raise HTTPException(409, "Create or link the exact adhesive, parchment or packaging item in Masters first. Planning cannot create materials from free-text BOM codes.")
