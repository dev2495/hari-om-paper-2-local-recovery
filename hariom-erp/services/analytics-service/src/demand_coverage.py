"""Demand/BOM coverage read model.

Rebuilds time-phased material coverage from sales lines, canonical spec BOMs,
and the existing inventory ledger. This module does not persist stock, post
receipts, or apply reorder policy to shortfall.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Any, Iterable, Optional


def _safe_float(value: Any, fallback: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return fallback
    if result != result or result in (float("inf"), float("-inf")):
        return fallback
    return result


def iso_week_bucket(due_value: Any) -> str:
    if due_value in (None, ""):
        return "UNSCHEDULED"
    if isinstance(due_value, datetime):
        due = due_value.date()
    elif isinstance(due_value, date):
        due = due_value
    else:
        text = str(due_value)[:10]
        try:
            due = date.fromisoformat(text)
        except ValueError:
            return "UNSCHEDULED"
    iso = due.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def expand_bom_for_qty(bom: dict[str, Any], qty_pcs: float) -> list[dict[str, Any]]:
    """Scale a canonical generate_bom payload to a remaining piece quantity.

    Paper/adhesive/parchment weights in generate_bom are per whole bamboo.
    """
    qty = max(0.0, _safe_float(qty_pcs))
    if qty <= 0:
        return []
    expected = dict((bom or {}).get("expected_output") or {})
    tubes_per_bamboo = _safe_float(expected.get("tubes_per_bamboo"))
    if tubes_per_bamboo <= 0:
        return []
    bamboo_count = qty / tubes_per_bamboo
    raw = dict((bom or {}).get("raw_materials") or {})
    rows: list[dict[str, Any]] = []

    for paper in list(raw.get("papers") or []):
        paper_id = str(paper.get("paper_id") or "").strip()
        gsm = _safe_float(paper.get("gsm"))
        bf = _safe_float(paper.get("bf"))
        required_kg = _safe_float(paper.get("weight_kg")) * bamboo_count
        rows.append(
            {
                "kind": "PAPER",
                "material_key": f"PAPER:{paper_id}:GSM:{gsm:g}:BF:{bf:g}",
                "paper_id": paper_id,
                "gsm": gsm,
                "bf": bf,
                "ply_count": paper.get("ply_count"),
                "label": f"Paper {paper_id[:8]} GSM {gsm:g}",
                "required_qty": round(required_kg, 6),
                "uom": "KG",
            }
        )

    adhesives = dict(raw.get("adhesives") or {})
    for component in list(adhesives.get("components") or []):
        name = str(component.get("name") or "Adhesive").strip() or "Adhesive"
        required_kg = _safe_float(component.get("weight_kg")) * bamboo_count
        rows.append(
            {
                "kind": "ADHESIVE",
                "material_key": f"ADHESIVE:{name.upper()}",
                "paper_id": None,
                "label": name,
                "required_qty": round(required_kg, 6),
                "uom": "KG",
            }
        )

    parchment = dict(raw.get("parchment") or {})
    parchment_kg = _safe_float(parchment.get("weight_kg")) * bamboo_count
    if parchment_kg > 0:
        color = str(parchment.get("color") or "").strip()
        rows.append(
            {
                "kind": "PARCHMENT",
                "material_key": f"PARCHMENT:{color.upper() or 'UNSPECIFIED'}",
                "paper_id": None,
                "color": color or None,
                "item_code": f"PARCHMENT-{color.upper()}" if color else None,
                "label": f"Parchment {color}".strip(),
                "required_qty": round(parchment_kg, 6),
                "uom": "KG",
            }
        )
    return rows


def match_inventory_item(
    need: dict[str, Any],
    *,
    papers_by_id: dict[str, dict[str, Any]],
    items_by_code: dict[str, dict[str, Any]],
    items_by_id: dict[str, dict[str, Any]],
) -> tuple[Optional[dict[str, Any]], str]:
    """Exact identity match only. GSM-in-description is not a substitute."""
    kind = str(need.get("kind") or "").upper()
    if kind == "PAPER":
        paper_id = str(need.get("paper_id") or "")
        catalog = papers_by_id.get(paper_id) or {}
        code = str(catalog.get("code") or "").strip().upper()
        if code and code in items_by_code:
            return items_by_code[code], "MAPPED"
        if paper_id and paper_id in items_by_id:
            return items_by_id[paper_id], "MAPPED"
        return None, "UNKNOWN"
    if kind == "ADHESIVE":
        label = str(need.get("label") or "").strip().upper()
        if label and label in items_by_code:
            return items_by_code[label], "MAPPED"
        return None, "UNKNOWN"
    if kind == "PARCHMENT":
        color = str(need.get("color") or "").strip().upper()
        code_candidates = [item for item in (need.get("item_code"), f"PARCHMENT-{color}" if color else None) if item]
        for code in code_candidates:
            token = str(code).strip().upper()
            if token and token in items_by_code:
                return items_by_code[token], "MAPPED"
        return None, "UNKNOWN"
    return None, "UNKNOWN"


def build_coverage(
    *,
    demand_payload: dict[str, Any],
    boms_by_spec: dict[str, dict[str, Any]],
    balances: Iterable[dict[str, Any]],
    papers: Iterable[dict[str, Any]],
    open_purchase_lines: Iterable[dict[str, Any]] | None = None,
    plant_id: Optional[str] = None,
) -> dict[str, Any]:
    as_of = datetime.now(timezone.utc).isoformat()
    lines = list(demand_payload.get("lines") or [])
    papers_by_id = {str(row.get("id") or ""): row for row in papers}
    items_by_code: dict[str, dict[str, Any]] = {}
    items_by_id: dict[str, dict[str, Any]] = {}
    for row in balances:
        item_id = str(row.get("item_id") or row.get("id") or "")
        code = str(row.get("item_code") or "").strip().upper()
        if item_id:
            items_by_id[item_id] = row
        if code:
            items_by_code[code] = row

    materials: dict[str, dict[str, Any]] = {}
    unknown_lines: list[dict[str, Any]] = []
    contributing = 0
    specs_missing = 0
    recipes_unknown = 0

    for line in lines:
        spec_id = str(line.get("approved_spec_id") or "")
        remaining = _safe_float(line.get("remaining_qty"))
        bucket = iso_week_bucket(line.get("due_date"))
        contributing += 1
        bom_wrap = boms_by_spec.get(spec_id)
        if not spec_id:
            unknown_lines.append({**line, "reason": "Sales line has no approved spec."})
            specs_missing += 1
            continue
        if not bom_wrap:
            unknown_lines.append({**line, "reason": "BOM was not returned for this spec."})
            recipes_unknown += 1
            continue
        if str(bom_wrap.get("completeness") or "").upper() != "OK" or not bom_wrap.get("bom"):
            unknown_lines.append(
                {
                    **line,
                    "reason": bom_wrap.get("reason") or "Approved recipe or length mapping is incomplete.",
                    "source_revision": bom_wrap.get("source_revision"),
                }
            )
            recipes_unknown += 1
            continue
        expanded = expand_bom_for_qty(bom_wrap["bom"], remaining)
        if not expanded:
            unknown_lines.append({**line, "reason": "Canonical BOM did not yield per-piece material weights."})
            recipes_unknown += 1
            continue
        for need in expanded:
            item, mapping = match_inventory_item(
                need,
                papers_by_id=papers_by_id,
                items_by_code=items_by_code,
                items_by_id=items_by_id,
            )
            if item and str((item or {}).get("uom") or "").strip().upper() not in {"", str(need.get("uom") or "").upper()}:
                mapping = "UNKNOWN"
                item = None
            issue_map = line.get("net_issued_by_material") or {}
            mapped_id = str((item or {}).get("item_id") or (item or {}).get("id") or "")
            issue = issue_map.get(mapped_id) or issue_map.get(need["material_key"]) or {}
            issued_qty = _safe_float(issue.get("qty")) if issue.get("uom") == need["uom"] else 0.0
            # FG pieces are converted through their own frozen BOM before they
            # can appear as material coverage. An untyped scalar is not kg.
            fg_map = line.get("accepted_fg_material_coverage") or {}
            fg = fg_map.get(mapped_id) or fg_map.get(need["material_key"]) or {}
            allocated_fg = _safe_float(fg.get("qty")) if fg.get("uom") == need["uom"] else 0.0
            residual_need = max(0.0, need["required_qty"] - issued_qty - allocated_fg)
            material_key = need["material_key"]
            if item:
                material_key = f"ITEM:{item.get('item_id') or item.get('id')}"
            row = materials.setdefault(
                material_key,
                {
                    "material_key": material_key,
                    "kind": need["kind"],
                    "label": (item or {}).get("name") or need["label"],
                    "item_id": (item or {}).get("item_id"),
                    "item_code": (item or {}).get("item_code"),
                    "uom": need["uom"],
                    "inventory_uom": (item or {}).get("uom"),
                    "mapping_state": mapping,
                    "gross_demand_qty": 0.0,
                    "already_issued_qty": 0.0,
                    "allocated_accepted_fg_qty": 0.0,
                    "remaining_requirement_qty": 0.0,
                    "usable_qty": _safe_float((item or {}).get("usable_qty"), _safe_float((item or {}).get("available_qty"))),
                    "physical_qty": _safe_float((item or {}).get("balance")),
                    "qc_held_qty": _safe_float((item or {}).get("qc_held_qty")),
                    "reserved_qty": _safe_float((item or {}).get("reserved_qty")),
                    "supply_due_qty": 0.0,
                    "reorder_policy": {
                        "reorder_level": _safe_float((item or {}).get("reorder_level")),
                        "safety_stock": _safe_float((item or {}).get("safety_stock")),
                        "lead_time_days": _safe_float((item or {}).get("lead_time_days")),
                    },
                    "buckets": {},
                    "contributing_lines": [],
                    "source_revisions": [],
                },
            )
            if mapping == "UNKNOWN":
                row["mapping_state"] = "UNKNOWN"
            row["gross_demand_qty"] = round(row["gross_demand_qty"] + need["required_qty"], 6)
            row["already_issued_qty"] = round(row["already_issued_qty"] + issued_qty, 6)
            row["allocated_accepted_fg_qty"] = round(row.get("allocated_accepted_fg_qty", 0.0) + allocated_fg, 6)
            row["remaining_requirement_qty"] = round(row["remaining_requirement_qty"] + residual_need, 6)
            bucket_row = row["buckets"].setdefault(
                bucket,
                {"bucket": bucket, "gross_demand_qty": 0.0, "remaining_requirement_qty": 0.0},
            )
            bucket_row["gross_demand_qty"] = round(bucket_row["gross_demand_qty"] + need["required_qty"], 6)
            bucket_row["remaining_requirement_qty"] = round(
                bucket_row["remaining_requirement_qty"] + residual_need, 6
            )
            row["contributing_lines"].append(
                {
                    "order_id": line.get("order_id"),
                    "order_no": line.get("order_no"),
                    "line_id": line.get("line_id"),
                    "product_code": line.get("product_code"),
                    "due_date": line.get("due_date"),
                    "bucket": bucket,
                    "remaining_qty": remaining,
                    "required_qty": need["required_qty"],
                    "spec_id": spec_id,
                    "recipe_id": (bom_wrap.get("source_revision") or {}).get("recipe_id"),
                    "recipe_version": (bom_wrap.get("source_revision") or {}).get("recipe_version"),
                }
            )
            revision = bom_wrap.get("source_revision") or {}
            if revision and revision not in row["source_revisions"]:
                row["source_revisions"].append(revision)

    supply_by_item: dict[str, float] = defaultdict(float)
    usable_supply_by_item: dict[str, float] = defaultdict(float)
    for po_line in open_purchase_lines or []:
        item_id = str(po_line.get("item_id") or "")
        remaining_po = max(
            0.0,
            _safe_float(po_line.get("qty_ordered")) - _safe_float(po_line.get("qty_received")),
        )
        if item_id and remaining_po > 0:
            supply_by_item[item_id] += remaining_po
            awaiting_qc = str(po_line.get("qc_status") or po_line.get("stock_status") or "").upper() in {
                "QC_HOLD",
                "HOLD",
                "PENDING",
                "AWAITING_QC",
            }
            if not awaiting_qc:
                usable_supply_by_item[item_id] += remaining_po

    material_rows = []
    for row in materials.values():
        item_id = str(row.get("item_id") or "")
        row["supply_due_qty"] = round(supply_by_item.get(item_id, 0.0), 6)
        row["supply_usable_qty"] = round(usable_supply_by_item.get(item_id, 0.0), 6)
        # Shortfall is residual demand vs usable stock only. Future/QC-held supply is not coverage.
        shortfall = max(0.0, row["remaining_requirement_qty"] - row["usable_qty"])
        row["shortfall_qty"] = round(shortfall, 6)
        first_shortage = None
        running = 0.0
        usable = row["usable_qty"]
        for bucket_row in sorted(row["buckets"].values(), key=lambda item: item["bucket"]):
            running += bucket_row["remaining_requirement_qty"]
            bucket_row["cumulative_requirement_qty"] = round(running, 6)
            bucket_row["covered_by_stock"] = running <= usable + 1e-9
            if first_shortage is None and running > usable + 1e-9:
                first_shortage = bucket_row["bucket"]
        row["first_shortage_bucket"] = first_shortage
        row["buckets"] = sorted(row["buckets"].values(), key=lambda item: item["bucket"])
        row["confidence"] = "OK" if row["mapping_state"] == "MAPPED" else "UNKNOWN"
        material_rows.append(row)

    material_rows.sort(key=lambda row: (-row["shortfall_qty"], row["label"] or ""))
    demand_source_complete = demand_payload.get("coverage") == "all_open_lines"
    completeness = "ESTIMATE"
    notes = [
        "GROSS outstanding-BOM estimate. This is not a net buy recommendation.",
        "Deductions require material-specific quantities in the same unit. Generic issue totals and finished-piece counts never reduce material kg.",
        "Shortfall is remaining requirement minus usable (unrestricted) stock. Reorder/safety is a separate measure.",
        "QC-held stock and supplier receipts awaiting QC are reported but not treated as usable coverage of an earlier need.",
        "Customer delivery, production segments, and supplier receipts remain separate calendars.",
    ]
    if not demand_source_complete or unknown_lines or any(row["mapping_state"] != "MAPPED" for row in material_rows):
        completeness = "PARTIAL"
    if demand_payload.get("unavailable"):
        completeness = "UNAVAILABLE"
        notes.append("Sales demand source was unavailable; coverage must not be treated as zero.")

    shortfall_rows = [row for row in material_rows if row["shortfall_qty"] > 0]
    return {
        "as_of": as_of,
        "plant_id": plant_id,
        "ledger": False,
        "measure_set": {
            "demand": "gross remaining BOM from all open sales lines (estimate until residual snapshots are complete)",
            "available": "usable unrestricted stock from the inventory ledger",
            "reorder_policy": "item master reorder/safety/lead time; not used in shortfall",
            "calculation_mode": "GROSS_ESTIMATE",
        },
        "completeness": completeness,
        "notes": notes,
        "demand_source": {
            "total_orders": demand_payload.get("total_orders"),
            "total_open_lines": demand_payload.get("total_open_lines") or len(lines),
            "lines_expanded": contributing,
            "coverage": demand_payload.get("coverage"),
            "as_of": demand_payload.get("as_of"),
            "skipped_draft_orders": demand_payload.get("skipped_draft_orders"),
        },
        "unknown_or_unmapped_lines": unknown_lines,
        "unknown_line_count": len(unknown_lines),
        "specs_missing_count": specs_missing,
        "recipes_unknown_count": recipes_unknown,
        "material_count": len(material_rows),
        "shortfall_count": len(shortfall_rows),
        "materials": material_rows,
    }
