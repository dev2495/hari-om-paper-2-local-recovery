"""Masters are the materials (client rule 2026-10-18: "not showing the list of material in the P.O").

Every paper, adhesive, parchment colour and packing master is something the plant buys, receives,
issues and counts, so each needs a stock item in the plant. This keeps the item master in step:
for every master without a stock item of the same code, the inventory service creates one.
Existing items are never changed. Codes follow the masters so purchase, inward, issue, theory and
the month-end stock count all meet on the same item code.
"""
from __future__ import annotations

import logging
import os
import re
from typing import Any

import httpx

from src.services.workspace import current_user_claims

logger = logging.getLogger(__name__)
MASTER_URL = os.getenv("MASTER_SERVICE_URL", "http://127.0.0.1:18002")
INVENTORY_URL = os.getenv("INVENTORY_SERVICE_URL", "http://127.0.0.1:18005")
http_client = httpx.AsyncClient(timeout=20.0)


def _active(row: dict[str, Any]) -> bool:
    return str(row.get("active", True)).lower() != "false" and str(row.get("is_active", True)).lower() != "false"


def _text(*parts: Any) -> str:
    return " ".join(str(part).strip() for part in parts if part not in (None, "") and str(part).strip())


def _gsm(value: Any) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return ""
    return f"{number:g} GSM"


def _nominals(values: dict[str, Any]) -> dict[str, float] | None:
    """Master values that inward QC centres its bands on (only real positive numbers)."""
    out: dict[str, float] = {}
    for key, value in values.items():
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if number > 0 and number == number:
            out[key] = number
    return out or None


def parchment_item_code(color: str) -> str:
    """PARCHMENT-<COLOUR>: letters and digits kept, every other run becomes one dash."""
    return ("PARCHMENT-" + re.sub(r"[^A-Z0-9]+", "-", color.strip().upper()).strip("-"))[:50]


def master_lines(papers: list[dict], adhesives: list[dict], colors: list[dict], vendors: list[dict],
                 boxes: list[dict], sheets: list[dict], faddas: list[dict]) -> list[dict[str, str]]:
    """Stock item lines (code, name, type, unit) for every active master record."""
    lines: list[dict[str, str]] = []
    for row in papers:
        if _active(row) and str(row.get("code") or "").strip():
            lines.append({"item_code": str(row["code"]).strip(), "name": _text(row.get("variety") or "Paper", _gsm(row.get("gsm"))) or str(row["code"]), "type": "RAW_PAPER", "uom": "KG",
                          "nominals": _nominals({"gsm": row.get("gsm"), "bf": row.get("bf"), "caliper_mm": row.get("thickness_mm"), "ply_bond": row.get("ply_bond"), "bulk": row.get("bulk_factor"), "width_mm": row.get("width_mm")}),
                          "group": str(row.get("variety") or "").strip() or None})
    for row in adhesives:
        code = str(row.get("internal_code") or row.get("code") or "").strip()
        if _active(row) and code:
            lines.append({"item_code": code, "name": _text(row.get("name"), f"({row.get('variety')})" if row.get("variety") else "") or code, "type": "ADHESIVE", "uom": "KG",
                          "nominals": _nominals({"viscosity": row.get("viscosity"), "solid_content": row.get("solid_content_percent"), "ph": row.get("ph")}),
                          "group": str(row.get("variety") or "").strip() or None})
    vendor_names = {str(row.get("id")): str(row.get("name") or "").strip() for row in vendors}
    for row in colors:
        color = str(row.get("color_name") or "").strip()
        if _active(row) and color:
            lines.append({"item_code": parchment_item_code(color), "name": _text("Parchment", color, f"· {vendor_names.get(str(row.get('vendor_id')))}" if vendor_names.get(str(row.get("vendor_id"))) else ""), "type": "PARCHMENT", "uom": "KG"})
    for row in boxes:
        code = str(row.get("code") or "").strip()
        if _active(row) and code:
            lines.append({"item_code": code, "name": _text("Box", code, row.get("size_label")), "type": "PACKAGING", "uom": "PCS"})
    for row in sheets:
        code = str(row.get("sku") or "").strip()
        if _active(row) and code:
            lines.append({"item_code": code, "name": _text("Plastic sheet", code, row.get("size_label")), "type": "PACKAGING", "uom": "PCS"})
    for row in faddas:
        code = str(row.get("sku") or "").strip()
        if _active(row) and code:
            lines.append({"item_code": code, "name": _text("Fadda", code), "type": "PACKAGING", "uom": "PCS"})
    for line in lines:
        line["item_code"] = line["item_code"][:50]
        line["name"] = line["name"][:200]
    return lines


async def _get(url: str, headers: dict[str, str]) -> list[dict]:
    response = await http_client.get(url, headers=headers)
    if response.status_code >= 400:
        raise RuntimeError(f"{url} returned {response.status_code}")
    data = response.json()
    return data if isinstance(data, list) else data.get("items") or []


def plants_for(token: str, plant_header: str | None) -> list[str]:
    plant = str(plant_header or "").strip()
    if plant and plant.upper() != "ALL":
        return [plant]
    claims = current_user_claims(token)
    plants = [str(value) for value in claims.get("allowed_plants") or [] if str(value).strip()]
    return plants or ([str(claims["plant_id"])] if claims.get("plant_id") else [])


async def sync_master_items(token: str, plant_header: str | None) -> dict[str, Any]:
    """Create the missing stock items for every master, in the request's plant (or each plant the
    user can see when working in all plants)."""
    result: dict[str, Any] = {"plants": [], "created": [], "conflicts": []}
    for plant in plants_for(token, plant_header):
        headers = {"Authorization": f"Bearer {token}", "X-Plant-ID": plant}
        papers = await _get(f"{MASTER_URL}/master/papers/", headers)
        adhesives = await _get(f"{MASTER_URL}/master/adhesives/", headers)
        colors = await _get(f"{MASTER_URL}/master/parchment/colors", headers)
        vendors = await _get(f"{MASTER_URL}/master/parchment/vendors", headers)
        boxes = await _get(f"{MASTER_URL}/master/packaging/boxes", headers)
        sheets = await _get(f"{MASTER_URL}/master/packaging/plastic-sheets", headers)
        faddas = await _get(f"{MASTER_URL}/master/packaging/fadda", headers)
        lines = master_lines(papers, adhesives, colors, vendors, boxes, sheets, faddas)
        if not lines:
            result["plants"].append({"plant_id": plant, "created": 0})
            continue
        response = await http_client.post(f"{INVENTORY_URL}/items/sync-from-masters", headers=headers, json={"lines": lines})
        if response.status_code >= 400:
            raise RuntimeError(f"inventory sync returned {response.status_code}: {response.text[:200]}")
        body = response.json()
        result["plants"].append({"plant_id": plant, "created": len(body.get("created") or [])})
        result["created"].extend(body.get("created") or [])
        result["conflicts"].extend(body.get("conflicts") or [])
    return result


async def sync_quietly(token: str, plant_header: str | None) -> None:
    """After a master is saved: best effort, never fails the master save."""
    try:
        await sync_master_items(token, plant_header)
    except Exception:  # pragma: no cover - best effort
        logger.warning("master item sync failed", exc_info=True)
