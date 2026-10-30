"""RM inward calendar read model (spec 3, client 2026-10-28).

Joins forward demand (``procurement_demand.material_demand``) with what inventory says is in stock
and arriving (``/inventory/procurement/schedule/supply``) into one day-by-day picture per material:

    balance(d) = balance(d-1) + arrivals(d) - need(d)

starting from usable stock. QC-pending stock is shown apart and counted ``qc_days`` after today.
Arrivals count only when they are commitments (Owner-approved, or open rows of approved POs); a
received row is stock already, so it is never counted twice. Shortage is the first day the balance
goes below 0, or below the minimum stock when a stock policy has one. Pure functions, unit-tested.
"""
from __future__ import annotations

import math
import os
from datetime import date, datetime, timedelta
from typing import Any, Iterable, Optional
from zoneinfo import ZoneInfo

import httpx
from fastapi import HTTPException

from src.services.http_client import http_client

INVENTORY_URL = os.getenv("INVENTORY_SERVICE_URL", "http://127.0.0.1:18005")
MASTER_URL = os.getenv("MASTER_SERVICE_URL", "http://127.0.0.1:18002")
IST = ZoneInfo("Asia/Kolkata")
WINDOW_WEEKS = (4, 8, 12)
CLASS_LABELS = {"PAPER": "Paper", "CHEMICAL": "Chemicals", "PACKING": "Packing"}
EPS = 0.0005


def ist_today() -> date:
    return datetime.now(IST).date()


def indian_date(value: str | date) -> str:
    """"28 Oct 2026" (plain words in notes the desk and the Owner read)."""
    day = value if isinstance(value, date) else date.fromisoformat(str(value)[:10])
    return f"{day.day} {day.strftime('%b %Y')}"


# Spec 2.8: the calendar carries vendors, rates and open POs, so only purchasing roles see it.
CALENDAR_VIEW_ROLES = {"Owner", "Admin", "PlantManager", "Planner", "Store", "GRN"}


def assert_calendar_viewer(token: str) -> None:
    """Fail fast with plain words; inventory checks the same roles on the supply it serves."""
    from src.services.workspace import current_user_claims

    claims = current_user_claims(token)
    roles = {str(role) for role in (claims.get("effective_roles") or claims.get("roles") or []) if role}
    for key in ("acting_role", "role"):
        if claims.get(key):
            roles.add(str(claims[key]))
    if claims and not roles & CALENDAR_VIEW_ROLES:
        raise HTTPException(403, "The RM inward calendar is for the Owner, plant head, Planner, Store and GRN desks.")


def _num(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _r(value: float, places: int = 3) -> float:
    return round(value + 0.0, places)


def demand_rows(demand: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """(mapped need rows, unmapped rows) in each item's own unit."""
    mapped, unmapped = [], []
    for row in demand.get("requirements") or []:
        entry = {**row, "qty": _num(row.get("qty_kg")), "uom": "KG", "material_class": "PAPER"}
        (mapped if row.get("mapped", True) else unmapped).append(entry)
    for row in demand.get("material_requirements") or []:
        entry = {**row, "qty": _num(row.get("qty"))}
        (mapped if row.get("mapped", True) else unmapped).append(entry)
    return mapped, unmapped


def _need_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {"date": row.get("date"), "due_date": row.get("due_date"), "qty": _r(_num(row.get("qty"))), "late": bool(row.get("overdue")),
            "order_no": row.get("order_no"), "job_card_no": row.get("job_card_no"), "job_id": row.get("job_id"),
            "source": row.get("source") or row.get("basis"), "made_pcs": row.get("made_pcs"), "planned_pcs": row.get("planned_pcs"),
            # A card on the planner needs material by its slot; the order's due date is shown apart from it.
            "production_plan_date": row.get("production_plan_date"), "order_due_date": row.get("order_due_date"),
            # No delivery date (SPEC2 answer 6): counted from today, never "due" and never late.
            "no_date": bool(row.get("no_date"))}


def simulate(days: list[str], opening: float, need: list[float], arrive: list[float]) -> list[float]:
    balance, out = opening, []
    for index in range(len(days)):
        balance = balance + arrive[index] - need[index]
        out.append(_r(balance))
    return out


def first_short(days: list[str], balances: list[float], minimum: float) -> Optional[dict[str, Any]]:
    for index, value in enumerate(balances):
        if value < -EPS:
            return {"date": days[index], "index": index, "qty": _r(-value + max(minimum, 0)), "kind": "BELOW_ZERO", "balance": value}
        if minimum > 0 and value < minimum - EPS:
            return {"date": days[index], "index": index, "qty": _r(minimum - value), "kind": "BELOW_MIN", "balance": value}
    return None


def build_calendar(demand: dict[str, Any], supply: dict[str, Any], *, start: date, end: date, qc_days: int = 1) -> dict[str, Any]:
    days = [(start + timedelta(days=offset)).isoformat() for offset in range((end - start).days + 1)]
    index_of = {day: position for position, day in enumerate(days)}
    mapped, unmapped = demand_rows(demand)
    needs_by_item: dict[str, list[dict[str, Any]]] = {}
    for row in mapped:
        needs_by_item.setdefault(str(row["item_id"]), []).append(row)
    arrivals_by_item: dict[str, list[dict[str, Any]]] = {}
    for row in supply.get("arrivals") or []:
        arrivals_by_item.setdefault(str(row["item_id"]), []).append(row)
    qc_day = start + timedelta(days=max(0, qc_days))
    materials, pending = [], []
    for item in supply.get("items") or []:
        item_id = str(item["item_id"])
        needs = needs_by_item.get(item_id, [])
        arrivals = arrivals_by_item.get(item_id, [])
        usable = _num(item.get("usable_qty"))
        qc_pending = _num(item.get("qc_pending_qty"))
        policy = item.get("policy") or None
        minimum = _num((policy or {}).get("min_stock"))
        keep = bool(needs or arrivals) or (item.get("item_type") != "OTHER" and (usable > 0 or qc_pending > 0 or policy))
        if not keep:
            continue
        need = [0.0] * len(days)
        late = [0.0] * len(days)
        for row in needs:
            position = index_of.get(str(row.get("date")))
            if position is None:
                position = 0 if str(row.get("date")) < days[0] else None
            if position is None:
                continue
            need[position] += _num(row.get("qty"))
            if row.get("overdue"):
                late[position] += _num(row.get("qty"))
        arrive = [0.0] * len(days)
        proposed = [0.0] * len(days)
        chips = []
        for row in arrivals:
            day = str(row.get("date"))
            shown = day if day >= days[0] else days[0]
            position = index_of.get(shown)
            if row.get("state") == "PROPOSED":
                rate = row.get("rate")
                # Every waiting proposal is the Owner's to decide, whatever window is on screen
                # (checker 2026-10-28: the 4-week view hid a proposal for week 6).
                pending.append({"entry_id": row.get("entry_id"), "item_id": item_id, "item_code": item.get("item_code"), "item_name": item.get("item_name"),
                                "uom": item.get("uom"), "material_class": item.get("material_class"), "date": day, "qty": _num(row.get("qty")),
                                "late": day < days[0], "supplier_id": row.get("supplier_id"), "supplier_name": row.get("supplier_name"),
                                # What the Owner approves: the rate its draft line gets and the value.
                                "rate": rate, "rate_source": row.get("rate_source"),
                                "value": _r(_num(rate) * _num(row.get("qty")), 2) if rate else None,
                                "note": row.get("note"), "proposed_by": row.get("proposed_by"),
                                "outside_window": position is None})
            if position is None:
                continue
            arrive[position] += _num(row.get("counted_qty"))
            if row.get("state") == "PROPOSED":
                proposed[position] += _num(row.get("qty"))
            chips.append({**row, "shown_date": shown})
        # Stock waiting for incoming QC counts from qc_days after today; it is stock already, so it
        # is kept apart from arrivals (an "arriving" total never includes it).
        qc_position = index_of.get(qc_day.isoformat())
        qc_in = [0.0] * len(days)
        if qc_pending > 0 and qc_position is not None:
            qc_in[qc_position] += qc_pending
        cover_in = [a + q for a, q in zip(arrive, qc_in)]
        balance = simulate(days, usable, need, cover_in)
        with_proposals = simulate(days, usable, need, [a + p for a, p in zip(cover_in, proposed)])
        short = first_short(days, balance, minimum)
        short_after = first_short(days, with_proposals, minimum)
        materials.append({
            "item_id": item_id, "item_code": item.get("item_code"), "item_name": item.get("item_name"), "item_type": item.get("item_type"),
            "material_class": item.get("material_class"), "uom": item.get("uom"),
            "stock_now": _r(usable), "qc_pending": _r(qc_pending), "qc_counts_from": qc_day.isoformat(),
            "other_held": _r(_num(item.get("other_held_qty"))),
            "min_stock": minimum or None, "policy": policy, "last_vendor": item.get("last_vendor"), "rate": item.get("rate"),
            "need": [_r(value) for value in need], "late_need": [_r(value) for value in late],
            "arrive": [_r(value) for value in arrive], "qc_in": [_r(value) for value in qc_in], "proposed": [_r(value) for value in proposed],
            "balance": balance, "balance_with_proposals": with_proposals,
            "first_short": {key: value for key, value in short.items() if key != "index"} if short else None,
            "short_after_proposals": {key: value for key, value in short_after.items() if key != "index"} if short_after else None,
            "days_of_cover": short["index"] if short else None,
            "totals": {"need": _r(sum(need)), "late": _r(sum(late)), "arriving": _r(sum(arrive)), "proposed": _r(sum(proposed))},
            "arrivals": sorted(chips, key=lambda row: (row["shown_date"], row.get("state") or "")),
            "needs": sorted((_need_payload(row) for row in needs), key=lambda row: (str(row["date"]), str(row.get("order_no") or ""))),
        })
    materials.sort(key=lambda row: (row["first_short"]["date"] if row["first_short"] else "9999", row["material_class"] or "", row["item_code"] or ""))
    unmapped_summary: dict[str, dict[str, Any]] = {}
    for row in unmapped:
        key = str(row["item_id"])
        entry = unmapped_summary.setdefault(key, {"key": key, "code": row.get("paper_code") or row.get("item_code"), "name": row.get("item_name"),
            "material_class": row.get("material_class") or "PAPER", "uom": row.get("uom"), "qty": 0.0, "order_nos": set()})
        entry["qty"] = _r(entry["qty"] + _num(row.get("qty")))
        if row.get("order_no"):
            entry["order_nos"].add(row["order_no"])
    by_uom: dict[str, float] = {}
    for row in pending:
        by_uom[row["uom"] or ""] = _r(by_uom.get(row["uom"] or "", 0) + row["qty"])
    return {
        "today": start.isoformat(), "start": days[0], "end": days[-1], "days": days, "qc_days": qc_days,
        "materials": materials,
        "unmapped": [{**value, "order_nos": sorted(value["order_nos"])} for value in unmapped_summary.values()],
        "warnings": [row for row in demand.get("warnings") or [] if "has no stock item yet" not in str(row.get("reason") or "")],
        "pending_approval": {"count": len(pending), "entries": pending, "qty_by_uom": by_uom,
                             "vendors": sorted({row["supplier_name"] for row in pending if row.get("supplier_name")})},
        "source_version": demand.get("source_version"),
    }


def round_order_qty(qty: float, minimum: float = 0, multiple: float = 0) -> float:
    value = max(qty, minimum or 0)
    if multiple and multiple > 0:
        value = math.ceil(value / multiple - 1e-9) * multiple
    return float(math.ceil(value - 1e-9))


def suggest_for_material(material: dict[str, Any], days: list[str], *, horizon_days: int = 7, limit: int = 12) -> list[dict[str, Any]]:
    """Proposals that keep the balance at or above 0 (or the minimum stock): each shortage day gets
    an arrival the day before (today at the earliest), sized for the next ``horizon_days`` of need
    and rounded up to the policy's minimum order and order multiple."""
    policy = material.get("policy") or {}
    minimum = _num(material.get("min_stock"))
    qc_in = material.get("qc_in") or [0.0] * len(material["arrive"])
    arrive = [a + q + p for a, q, p in zip(material["arrive"], qc_in, material["proposed"])]
    need = list(material["need"])
    opening = _num(material.get("stock_now"))
    vendor = material.get("last_vendor") or {}
    out = []
    for _ in range(limit):
        balances = simulate(days, opening, need, arrive)
        short = first_short(days, balances, minimum)
        if not short:
            break
        position = short["index"]
        window = balances[position:position + horizon_days]
        deficit = max(minimum, 0) - min(window)
        qty = round_order_qty(deficit, _num(policy.get("minimum_order")), _num(policy.get("order_multiple")))
        if qty <= 0:
            break
        arrive_at = max(0, position - 1)
        arrive[arrive_at] += qty
        arrival_day = date.fromisoformat(days[arrive_at])
        lead = int(_num(policy.get("lead_time_days")))
        order_by = arrival_day - timedelta(days=lead) if lead else None
        out.append({"item_id": material["item_id"], "item_code": material.get("item_code"), "item_name": material.get("item_name"),
                    "uom": material.get("uom"), "material_class": material.get("material_class"),
                    "entry_date": days[arrive_at], "qty": qty, "short_date": days[position], "short_qty": _r(deficit),
                    "supplier_id": vendor.get("supplier_id"), "supplier_name": vendor.get("supplier_name"),
                    "order_by": order_by.isoformat() if order_by else None,
                    "late_to_order": bool(order_by and order_by < date.fromisoformat(days[0])),
                    "reason": ("Below minimum stock" if short["kind"] == "BELOW_MIN" else "Runs out") + f" on {indian_date(days[position])}"})
    return out


def suggest(calendar: dict[str, Any], *, material_class: Optional[str] = None, item_ids: Optional[Iterable[str]] = None) -> list[dict[str, Any]]:
    wanted = {str(value) for value in item_ids or []}
    out = []
    for material in calendar["materials"]:
        if material_class and material_class != "ALL" and material.get("material_class") != material_class:
            continue
        if wanted and material["item_id"] not in wanted:
            continue
        out.extend(suggest_for_material(material, calendar["days"]))
    return out


async def fetch_supply(token: str, plant_id: str, start: date, end: date) -> dict[str, Any]:
    try:
        response = await http_client.get(f"{INVENTORY_URL}/inventory/procurement/schedule/supply",
            headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id}, params={"start": start.isoformat(), "end": end.isoformat()})
    except httpx.RequestError as exc:
        raise HTTPException(502, "Stock and arrivals could not be loaded; the calendar was not calculated") from exc
    if response.status_code == 403:
        raise HTTPException(403, "The RM inward calendar is for the Owner, plant head, Planner, Store and GRN desks.")
    if response.status_code >= 400:
        raise HTTPException(response.status_code if response.status_code in (401, 404, 422) else 502,
                            "Stock and arrivals could not be loaded; the calendar was not calculated")
    return response.json()


async def calendar_for(token: str, plant_id: Optional[str], *, weeks: int = 8, start: Optional[date] = None) -> dict[str, Any]:
    from src.services.procurement_demand import material_demand

    if not plant_id or plant_id.upper() == "ALL":
        raise HTTPException(400, "Select one plant to open the RM inward calendar")
    if weeks not in WINDOW_WEEKS:
        raise HTTPException(422, "Choose 4, 8 or 12 weeks")
    assert_calendar_viewer(token)
    first = start or ist_today()
    last = first + timedelta(days=weeks * 7 - 1)
    # Supply first: inventory refuses roles outside spec 2.8 before any demand is worked out.
    supply = await fetch_supply(token, plant_id, first, last)
    demand = await material_demand(token, plant_id, first, last)
    return {"plant_id": plant_id, "weeks": weeks, **build_calendar(demand, supply, start=first, end=last)}


async def master_vendors(token: str, plant_id: str) -> dict[str, dict[str, Any]]:
    """Active vendors of this plant from the vendor master, by id. The master scopes the list to the
    X-Plant-ID plant, so another plant's vendor is never in it. Raises 503 when the master cannot be read:
    an arrival is never saved or approved for a vendor nobody could check (checker 2026-10-29)."""
    if not plant_id or plant_id.upper() == "ALL":
        raise HTTPException(400, "Select one plant first")
    try:
        response = await http_client.get(f"{MASTER_URL}/master/suppliers/", headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id})
        rows = response.json() if response.status_code < 400 else None
    except (httpx.RequestError, ValueError):
        rows = None
    if rows is None:
        raise HTTPException(503, "The vendor list could not be checked just now. Try again in a minute.")
    rows = rows if isinstance(rows, list) else rows.get("items", []) if isinstance(rows, dict) else []
    return {str(vendor.get("id")): vendor for vendor in rows
            if vendor.get("id") and vendor.get("active", vendor.get("is_active", True)) is not False}


def checked_vendor(vendors: dict[str, dict[str, Any]], supplier_id: Any, *, label: str = "") -> dict[str, Any]:
    """The master row for ``supplier_id``, or 422 in plain words (unknown, switched off or another plant's)."""
    vendor = vendors.get(str(supplier_id))
    if not vendor:
        raise HTTPException(422, f"{label}{'p' if label else 'P'}ick a vendor from this plant's vendor list. This vendor is not in it (unknown, switched off or another plant's).")
    return vendor


def apply_master_vendor(row: dict[str, Any], vendors: dict[str, dict[str, Any]], *, label: str = "") -> dict[str, Any]:
    """An arrival's vendor comes from the master: the id must be an active vendor of this plant and the
    printed name is the master name, whatever the caller typed. A name with no id is dropped."""
    out = dict(row)
    if out.get("supplier_id"):
        vendor = checked_vendor(vendors, out["supplier_id"], label=label)
        out["supplier_name"] = str(vendor.get("name") or "").strip() or None
    elif "supplier_id" in out:
        out["supplier_name"] = None
    else:
        out.pop("supplier_name", None)
    return out


def _vendor_facts(vendor: dict[str, Any]) -> dict[str, Any]:
    # Same order as the PO form (web lib/party-formats.ts vendorAddress).
    clean = lambda value: str(value or "").strip()  # noqa: E731
    place = ", ".join(part for part in (clean(vendor.get("city")), clean(vendor.get("state"))) if part)
    if clean(vendor.get("pin_code")):
        place = f"{place} - {clean(vendor.get('pin_code'))}" if place else clean(vendor.get("pin_code"))
    country = clean(vendor.get("country"))
    address = clean(vendor.get("full_address")) or ", ".join(part for part in (clean(vendor.get("address")), clean(vendor.get("address_line2")), place,
                        country if country and country.lower() != "india" else "") if part)
    phone = " / ".join(str(part) for part in (vendor.get("contact_phone"), vendor.get("alt_phone")) if part)
    return {
        "supplier_name": clean(vendor.get("name")) or None,
        "supplier_contact": " · ".join(str(part) for part in (vendor.get("contact_name") or vendor.get("contact_person"), vendor.get("contact_phone")) if part) or None,
        "supplier_address": address or None, "supplier_gst_no": vendor.get("gst_no") or None,
        "supplier_legal_name": vendor.get("legal_name") or None, "supplier_pan_no": vendor.get("pan_no") or None,
        "supplier_state": vendor.get("state") or None, "supplier_state_code": vendor.get("state_code") or None,
        "supplier_phone": phone or None, "supplier_email": vendor.get("contact_email") or None, "supplier_msme_no": vendor.get("msme_no") or None,
        "payment_terms": f"{vendor['payment_terms_days']} days from invoice date." if vendor.get("payment_terms_days") is not None else None,
    }


async def vendor_details(token: str, plant_id: str, supplier_ids: Iterable[str] | None = None) -> dict[str, dict[str, Any]]:
    """Vendor master facts a scheduled draft prints (name, address, GSTIN, contact), for every active
    vendor of the plant (or only ``supplier_ids``). Inventory approves an arrival only for a vendor in
    this map, so an unknown, switched-off or other-plant vendor never becomes a draft PO."""
    vendors = await master_vendors(token, plant_id)
    wanted = {str(value) for value in supplier_ids or [] if value}
    return {key: _vendor_facts(vendor) for key, vendor in vendors.items() if not wanted or key in wanted}
