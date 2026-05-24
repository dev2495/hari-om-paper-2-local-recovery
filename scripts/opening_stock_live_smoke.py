#!/usr/bin/env python3
"""Post one small opening-stock document through the live BFF and report the result."""

from __future__ import annotations

import json
import os
import sys
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any

import requests

from runtime_support import REPORT_DIR, load_runtime_manifest


MANIFEST = load_runtime_manifest()
URLS = MANIFEST.get("urls") or {}
BFF_URL = os.getenv("BFF_URL", str(URLS.get("bff") or "http://127.0.0.1:14000"))
DEFAULTS = MANIFEST.get("defaults") or {}
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", str(DEFAULTS.get("admin_email") or "admin@hariom.com"))
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", str(DEFAULTS.get("admin_password") or "admin123"))
REQUEST_TIMEOUT = float(os.getenv("REQUEST_TIMEOUT", "30"))


def request(method: str, path: str, *, token: str | None = None, plant_id: str | None = None, **kwargs: Any) -> Any:
    headers = kwargs.pop("headers", {})
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if plant_id:
        headers["X-Plant-ID"] = plant_id
    if "json" in kwargs:
        headers.setdefault("Content-Type", "application/json")
    response = requests.request(
        method,
        f"{BFF_URL}{path}",
        headers=headers,
        timeout=REQUEST_TIMEOUT,
        **kwargs,
    )
    try:
        payload = response.json()
    except Exception:
        payload = {"raw": response.text}
    if response.status_code >= 400:
        raise RuntimeError(f"{method} {path} failed {response.status_code}: {payload}")
    return payload


def rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("items", "data", "rows", "results"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
    return []


def pick_item(items: list[dict[str, Any]]) -> dict[str, Any]:
    for item in items:
        if str(item.get("tracking_mode") or "").upper() != "REEL":
            return item
    if items:
        return items[0]
    raise RuntimeError("No inventory items are available for opening-stock smoke")


def main() -> int:
    login = request("POST", "/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    token = login["access_token"]
    user = login.get("user") or {}
    plant_id = str(user.get("plant_id") or "")
    if not plant_id or plant_id == "ALL":
        allowed = user.get("allowed_plant_ids") or user.get("allowed_plants") or []
        plant_id = str(allowed[0]) if allowed else ""
    if not plant_id:
        raise RuntimeError("Could not resolve a concrete plant for opening-stock smoke")

    items = rows(request("GET", "/api/inventory/items", token=token, plant_id=plant_id))
    locations = rows(request("GET", "/api/inventory/locations", token=token, plant_id=plant_id))
    item = pick_item(items)
    location = locations[0] if locations else None

    tracking_mode = str(item.get("tracking_mode") or "").upper()
    doc_no = f"OPEN-SMOKE-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:4].upper()}"
    line: dict[str, Any] = {
        "item_id": item["id"],
        "qty": 1,
        "stock_status": "UNRESTRICTED",
        "unit_cost": float(item.get("unit_cost") or 1),
        "cost_source": "MANUAL",
        "notes": "Codex live opening-stock smoke; safe one-unit proof document.",
    }
    if location:
        line["location_id"] = location["id"]
    if tracking_mode == "REEL":
        line["reel_code"] = f"{doc_no}-R001"
    else:
        line["batch_no"] = f"{doc_no}-B001"

    opening = request(
        "POST",
        "/api/inventory/stock-control/opening-loads",
        token=token,
        plant_id=plant_id,
        json={
            "document_no": doc_no,
            "effective_date": date.today().isoformat(),
            "notes": "Live go-live opening-stock posting smoke.",
            "lines": [line],
        },
    )
    statement = request(
        "GET",
        "/api/inventory/stock-control/statement",
        token=token,
        plant_id=plant_id,
        params={"start_date": date.today().replace(day=1).isoformat(), "end_date": date.today().isoformat()},
    )

    report = {
        "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "bff_url": BFF_URL,
        "plant_id": plant_id,
        "document_no": doc_no,
        "opening_load": opening,
        "item": {
            "id": item.get("id"),
            "item_code": item.get("item_code"),
            "name": item.get("name"),
            "tracking_mode": item.get("tracking_mode"),
        },
        "location": {
            "id": location.get("id"),
            "code": location.get("code"),
        } if location else None,
        "statement_rows": len(rows(statement)),
    }
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    json_path = REPORT_DIR / f"opening_stock_live_smoke_{stamp}.json"
    md_path = REPORT_DIR / f"opening_stock_live_smoke_{stamp}.md"
    latest_json = REPORT_DIR / "opening_stock_live_smoke_latest.json"
    latest_md = REPORT_DIR / "opening_stock_live_smoke_latest.md"
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    latest_json.write_text(json.dumps(report, indent=2), encoding="utf-8")
    md = "\n".join(
        [
            "# Opening Stock Live Smoke",
            "",
            f"Generated at: `{report['generated_at']}`",
            f"BFF URL: `{BFF_URL}`",
            f"Plant: `{plant_id}`",
            f"Document: `{doc_no}`",
            "",
            "## Result",
            "",
            f"- Opening load id: `{opening.get('id')}`",
            f"- Line count: `{opening.get('line_count')}`",
            f"- Item: `{report['item']['item_code'] or report['item']['name']}`",
            f"- Statement rows returned: `{report['statement_rows']}`",
        ]
    )
    md_path.write_text(md + "\n", encoding="utf-8")
    latest_md.write_text(md + "\n", encoding="utf-8")
    print(json.dumps({"opening_load_id": opening.get("id"), "document_no": doc_no, "report_md": str(md_path)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
