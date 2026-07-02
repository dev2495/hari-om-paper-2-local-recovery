#!/usr/bin/env python3
"""Idempotent RM master seeding for workbook-parity flows."""

from __future__ import annotations

import os
import requests

BFF_URL = os.getenv("BFF_URL", "http://127.0.0.1:14000")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@hariom.com")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")

PAPERS = [
    {"gsm": 220, "bf": 20, "label": "20BF", "code": "221", "bulk_factor": 1.50, "thickness_mm": 0.33, "ply_bond": 400.0},
    {"gsm": 230, "bf": 28, "label": "28BF", "code": "231", "bulk_factor": 1.50, "thickness_mm": 0.345, "ply_bond": 400.0},
    {"gsm": 300, "bf": 20, "label": "20BF", "code": "301", "bulk_factor": 1.50, "thickness_mm": 0.45, "ply_bond": 400.0},
    {"gsm": 350, "bf": 16, "label": "16BF", "code": "350", "bulk_factor": 1.55, "thickness_mm": 0.5425, "ply_bond": 300.0},
    {"gsm": 350, "bf": 18, "label": "18BF", "code": "355", "bulk_factor": 1.55, "thickness_mm": 0.5425, "ply_bond": 350.0},
    {"gsm": 350, "bf": 20, "label": "20BF", "code": "351", "bulk_factor": 1.50, "thickness_mm": 0.525, "ply_bond": 400.0},
    {"gsm": 350, "bf": 24, "label": "24BF", "code": "352", "bulk_factor": 1.45, "thickness_mm": 0.5075, "ply_bond": 500.0},
    {"gsm": 350, "bf": 28, "label": "28BF", "code": "353", "bulk_factor": 1.40, "thickness_mm": 0.49, "ply_bond": 600.0},
    {"gsm": 350, "bf": 32, "label": "32BF", "code": "354", "bulk_factor": 1.40, "thickness_mm": 0.49, "ply_bond": 700.0},
]

ADHESIVES = [
    {"name": "TL4(Vinsol)", "internal_code": "20100"},
    {"name": "Alcosol", "internal_code": "30100"},
    {"name": "TL4 LV", "internal_code": "TL4LV"},
]

PARCHMENT_VENDORS = ["Amma", "Sagar", "China"]

TOOLS = [
    {"category": "NOTCH", "name": "Bottom RHS - 7mm Step 55deg", "department": "PROCESS"},
    {"category": "NOTCH", "name": "Top RHS - 6mm Plain 50deg", "department": "PROCESS"},
    {"category": "BLADE", "name": "Plain Blade 1.1mm BAR 01 POY 140/130/20", "department": "PROCESS"},
    {"category": "BLADE", "name": "Full Serration Blade 0.9mm 150/100/100", "department": "PROCESS"},
    {"category": "HOLDER", "name": "Holder BAR 01 POY", "department": "PROCESS"},
    {"category": "HOLDER", "name": "Holder BAR 04 FDY", "department": "PROCESS"},
    {"category": "V_FLAT", "name": "V+Flat 70+30 x 4.0", "department": "PROCESS"},
    {"category": "V_FLAT", "name": "V+Flat 90+80 x 3.5", "department": "PROCESS"},
    {"category": "PUNCH", "name": "Single", "department": "PROCESS"},
    {"category": "PUNCH", "name": "Double", "department": "PROCESS"},
    {"category": "PUNCH", "name": "N/A", "department": "PROCESS"},
    {"category": "PUNCH", "name": "Double Punch 5x10mm[center dist. 30mm]", "department": "PROCESS"},
    {"category": "PUNCH", "name": "Double Punch 5X10mm[center dist. 30mm]", "department": "PROCESS"},
]


def _raise_for_status(resp: requests.Response) -> None:
    if resp.status_code >= 400:
        raise RuntimeError(f"{resp.request.method} {resp.url} -> {resp.status_code}: {resp.text}")


def login() -> str:
    resp = requests.post(
        f"{BFF_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=20,
    )
    _raise_for_status(resp)
    token = resp.json().get("access_token")
    if not token:
        raise RuntimeError("access_token missing in login response")
    return token


def headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def concrete_plant_ids(token: str) -> list[str]:
    resp = requests.get(f"{BFF_URL}/api/auth/plants", headers=headers(token), timeout=20)
    _raise_for_status(resp)
    rows = resp.json() or []
    plant_ids: list[str] = []
    for row in rows:
        value = str(row.get("id") or row.get("code") or "").strip()
        if not value or value.upper() == "ALL":
            continue
        plant_ids.append(value)
    return plant_ids


def upsert_papers(token: str, plant_ids: list[str]) -> None:
    for plant_id in plant_ids:
        h = {**headers(token), "X-Plant-ID": plant_id}
        existing_resp = requests.get(f"{BFF_URL}/api/master/papers", headers=h, timeout=20)
        _raise_for_status(existing_resp)
        existing = existing_resp.json() or []
        by_code = {str(row.get("code") or "").upper(): row for row in existing}

        for paper in PAPERS:
            thickness_mm = paper.get("thickness_mm")
            resolved_bulk_factor = (
                round((float(thickness_mm) * 1000.0) / float(paper["gsm"]), 4)
                if thickness_mm not in (None, "")
                else paper.get("bulk_factor", 1.0)
            )
            payload = {
                "code": paper["code"],
                "variety": "KRAFT PAPER",
                "gsm": paper["gsm"],
                "bf": paper["bf"],
                "thickness_mm": thickness_mm,
                "ply_bond": paper.get("ply_bond", 0.0),
                "strength_type": "BF",
                "strength_value": int(round(float(paper["bf"]))),
                "category": "KRAFT",
                "price": None,
                "bulk_factor": resolved_bulk_factor,
                "active": True,
            }
            row = by_code.get(paper["code"].upper())
            if row:
                resp = requests.put(f"{BFF_URL}/api/master/papers/{row['id']}", json=payload, headers=h, timeout=20)
            else:
                resp = requests.post(f"{BFF_URL}/api/master/papers", json=payload, headers=h, timeout=20)
            _raise_for_status(resp)

        approved_codes = {paper["code"].upper() for paper in PAPERS}
        for row in existing:
            code = str(row.get("code") or "").upper()
            row_id = row.get("id")
            if row_id and code and code not in approved_codes:
                resp = requests.delete(f"{BFF_URL}/api/master/papers/{row_id}", headers=h, timeout=20)
                _raise_for_status(resp)


def upsert_adhesives(token: str, plant_ids: list[str]) -> None:
    for plant_id in plant_ids:
        h = {**headers(token), "X-Plant-ID": plant_id}
        existing_resp = requests.get(f"{BFF_URL}/api/master/adhesives", headers=h, timeout=20)
        _raise_for_status(existing_resp)
        existing = existing_resp.json() or []
        by_code = {str(row.get("internal_code") or "").upper(): row for row in existing}

        for adhesive in ADHESIVES:
            row = by_code.get(adhesive["internal_code"].upper())
            if row:
                resp = requests.put(
                    f"{BFF_URL}/api/master/adhesives/{row['id']}",
                    json={"name": adhesive["name"], "internal_code": adhesive["internal_code"], "active": True},
                    headers=h,
                    timeout=20,
                )
            else:
                resp = requests.post(
                    f"{BFF_URL}/api/master/adhesives",
                    json=adhesive,
                    headers=h,
                    timeout=20,
                )
            _raise_for_status(resp)

        approved_codes = {adhesive["internal_code"].upper() for adhesive in ADHESIVES}
        for row in existing:
            code = str(row.get("internal_code") or "").upper()
            row_id = row.get("id")
            if row_id and code and code not in approved_codes:
                resp = requests.delete(f"{BFF_URL}/api/master/adhesives/{row_id}", headers=h, timeout=20)
                _raise_for_status(resp)


def upsert_parchments(token: str, plant_ids: list[str]) -> None:
    for plant_id in plant_ids:
        h = {**headers(token), "X-Plant-ID": plant_id}
        existing_resp = requests.get(f"{BFF_URL}/api/master/parchments", headers=h, timeout=20)
        _raise_for_status(existing_resp)
        existing = existing_resp.json() or []
        existing_keys = {
            (str(row.get("vendor_name") or "").strip().lower(), str(row.get("color_name") or "").strip().lower())
            for row in existing
        }

        for vendor in PARCHMENT_VENDORS:
            key = (vendor.strip().lower(), "many patterns")
            if key in existing_keys:
                continue
            resp = requests.post(
                f"{BFF_URL}/api/master/parchments",
                json={"vendor_name": vendor, "color_name": "Many patterns"},
                headers=h,
                timeout=20,
            )
            _raise_for_status(resp)

        approved_pairs = {(vendor.strip().lower(), "many patterns") for vendor in PARCHMENT_VENDORS}
        kept_pairs: set[tuple[str, str]] = set()
        for row in existing:
            vendor_key = str(row.get("vendor_name") or "").strip().lower()
            color_key = str(row.get("color_name") or "").strip().lower()
            row_id = row.get("id")
            pair = (vendor_key, color_key)
            should_delete = pair not in approved_pairs or pair in kept_pairs
            if row_id and should_delete:
                resp = requests.delete(f"{BFF_URL}/api/master/parchments/{row_id}", headers=h, timeout=20)
                _raise_for_status(resp)
                continue
            kept_pairs.add(pair)


def upsert_tools(token: str, plant_ids: list[str]) -> None:
    for plant_id in plant_ids:
        h = {**headers(token), "X-Plant-ID": plant_id}
        existing_resp = requests.get(f"{BFF_URL}/api/master/tools", headers=h, timeout=20)
        _raise_for_status(existing_resp)
        existing = existing_resp.json() or []
        existing_keys = {
            (
                str(row.get("category") or "").strip().upper(),
                str(row.get("name") or "").strip(),
            ): row
            for row in existing
        }

        for tool in TOOLS:
            payload = {
                "category": tool["category"],
                "subcategory": tool.get("subcategory"),
                "name": tool["name"],
                "code": tool.get("code"),
                "spec_text": tool.get("spec_text", "Seeded from Sanathan Polycoat P workbook"),
                "department": tool.get("department", "COMMON"),
            }
            key = (tool["category"].strip().upper(), tool["name"].strip())
            row = existing_keys.get(key)
            if row:
                resp = requests.put(f"{BFF_URL}/api/master/tools/{row['id']}", json={**payload, "active": True}, headers=h, timeout=20)
            else:
                resp = requests.post(f"{BFF_URL}/api/master/tools", json=payload, headers=h, timeout=20)
            _raise_for_status(resp)


def main() -> None:
    token = login()
    plant_ids = concrete_plant_ids(token)
    upsert_papers(token, plant_ids)
    upsert_adhesives(token, plant_ids)
    upsert_parchments(token, plant_ids)
    upsert_tools(token, plant_ids)
    print("RM master seed completed.")


if __name__ == "__main__":
    main()
