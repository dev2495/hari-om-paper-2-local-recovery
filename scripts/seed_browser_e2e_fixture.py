#!/usr/bin/env python3
"""Seed disposable isolated-stack browser fixtures with real IDs.

Refuses any non-loopback BFF URL. Does not run cutover against production.
Creates plant-scoped masters, approved specs, inventory items, winders, and a
sales order through supported BFF APIs. IDs come from live responses.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

import requests

from runtime_support import REPORT_DIR, load_runtime_manifest

PASSWORD = os.getenv("ERP_TEST_USER_PASSWORD", "Nverify_User1!")
TIMEOUT = 30
APPROVED_MANDREL_OD = 125.55
APPROVED_TUBE = (125.0, 137.0, 120.0)
FIXTURE_ITEM_CODE = "20100-A"


def _require_loopback(url: str, label: str) -> None:
    host = urlparse(url).hostname or ""
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise SystemExit(f"{label} is not loopback ({url}). Refusing to seed.")


def _rows(resp) -> list:
    if resp.status_code != 200:
        return []
    body = resp.json()
    if isinstance(body, list):
        return body
    if isinstance(body, dict):
        for key in ("items", "customers", "plants", "rows", "orders"):
            value = body.get(key)
            if isinstance(value, list):
                return value
    return []


def _require(resp, action: str, ok=(200, 201)) -> dict | list:
    if resp.status_code not in ok:
        raise SystemExit(f"{action} failed: {resp.status_code} {resp.text[:500]}")
    if not resp.content:
        return {}
    return resp.json()


def _find(rows: list, pred) -> dict | None:
    for row in rows or []:
        if pred(row):
            return row
    return None


def seed_plant_catalog(session: requests.Session, bff: str, plant_id: str, label: str) -> dict:
    headers = {"X-Plant-ID": str(plant_id)}

    def get(path: str):
        return session.get(f"{bff}{path}", headers=headers, timeout=TIMEOUT)

    def post(path: str, payload: dict, ok=(200, 201)):
        return _require(session.post(f"{bff}{path}", headers=headers, json=payload, timeout=TIMEOUT), f"{label} POST {path}", ok)

    customers = _rows(get("/api/master/customers"))
    customer = _find(customers, lambda row: str(row.get("customer_code") or "").startswith(f"NV{label}"))
    if customer is None and customers:
        customer = customers[0]
    if customer is None:
        code = f"NV{label}-{datetime.now().strftime('%H%M%S')}"
        customer = post(
            "/api/master/customers",
            {
                "customer_code": code,
                "name": f"Nverify Plant {label} {code}",
                "contact_email": None,
                "contact_phone": None,
            },
        )

    mandrels = _rows(get("/api/master/mandrels"))
    mandrel_125 = _find(mandrels, lambda row: abs(float(row.get("outer_diameter_mm") or 0) - APPROVED_MANDREL_OD) < 1e-6)
    if mandrel_125 is None:
        mandrel_125 = post(
            "/api/master/mandrels",
            {
                "mandrel_code": "125.55",
                "outer_diameter_mm": APPROVED_MANDREL_OD,
                "od_tolerance_mm": 0.1,
                "length_mm": 500.0,
                "material": "MS",
            },
        )
    mandrel_110 = _find(mandrels, lambda row: abs(float(row.get("outer_diameter_mm") or 0) - 110.65) < 1e-6)
    if mandrel_110 is None:
        mandrel_110 = post(
            "/api/master/mandrels",
            {
                "mandrel_code": "110.65",
                "outer_diameter_mm": 110.65,
                "od_tolerance_mm": 0.1,
                "length_mm": 500.0,
                "material": "MS",
            },
        )

    tubes = _rows(get("/api/master/tube-sizes"))
    tube_125 = _find(
        tubes,
        lambda row: abs(float(row.get("inner_diameter_mm") or 0) - APPROVED_TUBE[0]) < 1e-6
        and abs(float(row.get("outer_diameter_mm") or 0) - APPROVED_TUBE[1]) < 1e-6
        and abs(float(row.get("length_mm") or 0) - APPROVED_TUBE[2]) < 1e-6,
    )
    if tube_125 is None:
        tube_125 = post(
            "/api/master/tube-sizes",
            {
                "inner_diameter_mm": APPROVED_TUBE[0],
                "outer_diameter_mm": APPROVED_TUBE[1],
                "length_mm": APPROVED_TUBE[2],
                "description": "125 x 137 x 120",
            },
        )
    tube_110 = _find(
        tubes,
        lambda row: abs(float(row.get("inner_diameter_mm") or 0) - 110.0) < 1e-6
        and abs(float(row.get("outer_diameter_mm") or 0) - 122.0) < 1e-6
        and abs(float(row.get("length_mm") or 0) - 149.9) < 1e-6,
    )
    if tube_110 is None:
        tube_110 = post(
            "/api/master/tube-sizes",
            {
                "inner_diameter_mm": 110.0,
                "outer_diameter_mm": 122.0,
                "length_mm": 149.9,
                "description": "110 x 122 x 149.9",
            },
        )

    papers = _rows(get("/api/master/papers"))
    paper_rows = []
    for gsm, code, variety in ((250, f"NV{label}-P250", "Nverify Kraft 250"), (300, f"NV{label}-P300", "Nverify Kraft 300")):
        hit = _find(papers, lambda row, gsm=gsm: abs(float(row.get("gsm") or 0) - gsm) < 1e-6)
        if hit is None:
            hit = post(
                "/api/master/papers",
                {"code": code, "variety": variety, "gsm": gsm, "bf": 18, "bulk_factor": 1.4},
                ok=(200, 201, 409),
            )
            if not hit or not hit.get("id"):
                papers = _rows(get("/api/master/papers"))
                hit = _find(papers, lambda row, gsm=gsm: abs(float(row.get("gsm") or 0) - gsm) < 1e-6)
        if not hit:
            raise SystemExit(f"Plant {label} missing paper GSM {gsm} after create")
        paper_rows.append(hit)

    items = _rows(get("/api/inventory/items"))
    item = _find(items, lambda row: str(row.get("item_code") or "").upper() == FIXTURE_ITEM_CODE)
    if item is None:
        created = session.post(
            f"{bff}/api/inventory/items",
            headers=headers,
            json={
                "item_code": FIXTURE_ITEM_CODE,
                "name": "Nverify kraft 20100-A",
                "type": "RAW_PAPER",
                "tracking_mode": "BULK",
                "uom": "KG",
                "unit_cost": 42.5,
            },
            timeout=TIMEOUT,
        )
        if created.status_code not in {200, 201, 400}:
            raise SystemExit(f"Plant {label} item create failed: {created.status_code} {created.text[:300]}")
        if created.status_code in {200, 201}:
            item = created.json()
        else:
            items = _rows(get("/api/inventory/items"))
            item = _find(items, lambda row: str(row.get("item_code") or "").upper() == FIXTURE_ITEM_CODE)

    machines = _rows(get("/api/production/machines"))
    winders = []
    for idx in (1, 2, 3):
        code = f"WINDER_0{idx}"
        hit = _find(machines, lambda row, code=code: str(row.get("code") or "").upper() == code)
        if hit is None:
            payload = {
                "code": code,
                "name": f"Nverify Winder {idx} Plant {label}",
                "department": "WINDER",
                "capacity_type": "METERS_PER_DAY",
                "capacity_value": 8000,
                "id_min_mm": 50,
                "id_max_mm": 400,
                "od_min_mm": 60,
                "od_max_mm": 500,
                "length_min_mm": 50,
                "length_max_mm": 700,
                "supported_mandrel_ids": [mandrel_125["id"], mandrel_110["id"]],
            }
            created = session.post(f"{bff}/api/production/machines", headers=headers, json=payload, timeout=TIMEOUT)
            if created.status_code not in {200, 201}:
                print(f"WARNING: Plant {label} {code}: {created.status_code} {created.text[:200]}", file=sys.stderr)
                continue
            hit = created.json()
            machines.append(hit)
        winders.append(hit)

    specs = _rows(get("/api/spec/specifications"))
    approved = [
        row
        for row in specs
        if str(row.get("status") or "").lower() == "approved" and row.get("active") not in {False, "false", "False"}
    ]
    if not approved:
        spec = post(
            "/api/spec/specifications",
            {
                "customer_id": customer.get("id"),
                "customer_name": customer.get("name"),
                "customer_name_snapshot": customer.get("name"),
                "tube_size_id": tube_125["id"],
                "mandrel_id": mandrel_125["id"],
                "required_cs": 180,
                "target_tube_weight": 92,
                "id_min_mm": APPROVED_TUBE[0],
                "id_max_mm": APPROVED_TUBE[0],
                "od_min_mm": APPROVED_TUBE[1],
                "od_max_mm": APPROVED_TUBE[1],
                "length_min_mm": APPROVED_TUBE[2],
                "length_max_mm": APPROVED_TUBE[2],
                "weight_min_g": 92,
                "weight_max_g": 92,
                "cs_min_n": 180,
                "cs_max_n": 180,
                "moisture_min_pct": 6.0,
                "moisture_max_pct": 10.0,
                "parchment_percent": 1.5,
            },
        )
        spec_id = spec["id"]
        recipe = post(f"/api/spec/recipes/{spec_id}", {"notes": "Nverify approved recipe"})
        for ply_no, paper in enumerate(paper_rows, start=1):
            post(
                f"/api/spec/recipes/{recipe['id']}/layers",
                {
                    "ply_no": ply_no,
                    "paper_id": paper["id"],
                    "gsm_snapshot": int(round(float(paper.get("gsm") or 0))),
                    "bf_snapshot": int(round(float(paper.get("bf") or paper.get("strength_value") or 18))),
                    "bulk_snapshot": float(paper.get("bulk_factor") or 1.4),
                },
            )
        post(
            f"/api/spec/trials/{recipe['id']}",
            {
                "actual_cs": 190,
                "actual_weight": 92,
                "actual_shrink": 9.0,
                "remarks": "Nverify seeded trial",
                "approved": True,
            },
        )
        post(f"/api/spec/recipes/{recipe['id']}/approve", {})
        specs = _rows(get("/api/spec/specifications"))
        approved = [
            row
            for row in specs
            if str(row.get("status") or "").lower() == "approved" and row.get("active") not in {False, "false", "False"}
        ]
        if not approved:
            raise SystemExit(f"Plant {label} spec did not become approved: {[row.get('status') for row in specs]}")

    month = date.today().isoformat()[:7]
    import_resp = session.post(
        f"{bff}/api/production/import-monthly-actuals",
        headers=headers,
        json={
            "month": month,
            "rows": [
                {
                    "item_code": FIXTURE_ITEM_CODE,
                    "item_name": "Nverify kraft 20100-A",
                    "actual_consumed_weight_kg": 18.5,
                    "actual_cost": 786.0,
                    "notes": "Nverify register actual",
                }
            ],
        },
        timeout=TIMEOUT,
    )
    if import_resp.status_code not in {200, 201}:
        print(f"WARNING: Plant {label} monthly actuals import: {import_resp.status_code} {import_resp.text[:200]}", file=sys.stderr)

    return {
        "customer": {"id": str(customer.get("id")), "code": customer.get("customer_code"), "name": customer.get("name")},
        "mandrel_125": {"id": str(mandrel_125.get("id")), "od": mandrel_125.get("outer_diameter_mm")},
        "tube_125": {"id": str(tube_125.get("id"))},
        "approved_spec_id": str(approved[0]["id"]),
        "winder_ids": [str(row.get("id")) for row in winders if row.get("id")],
        "item_code": FIXTURE_ITEM_CODE,
    }


def seed_sales_order(session: requests.Session, bff: str, plant_id: str, catalog: dict) -> dict | None:
    headers = {"X-Plant-ID": str(plant_id)}
    existing = _rows(session.get(f"{bff}/api/sales/orders", headers=headers, timeout=TIMEOUT))
    if existing:
        row = existing[0]
        return {"id": str(row.get("id")), "status": row.get("status")}
    po_date = date.today() - timedelta(days=2)
    due = date.today() + timedelta(days=7)
    created = session.post(
        f"{bff}/api/sales/orders",
        headers=headers,
        json={
            "customer_id": catalog["customer"]["id"],
            "origin": "CUSTOMER_PO",
            "po_number": f"NV-PO-{datetime.now().strftime('%H%M%S')}",
            "po_date": po_date.isoformat(),
            "notes": "Nverify premium-flow seed order",
            "lines": [
                {
                    "approved_spec_id": catalog["approved_spec_id"],
                    "product_code": "NV-FG-125",
                    "qty": 64,
                    "due_date": due.isoformat(),
                    "rate_per_pc": 12.5,
                }
            ],
        },
        timeout=TIMEOUT,
    )
    if created.status_code not in {200, 201}:
        print(f"WARNING: sales order create failed: {created.status_code} {created.text[:300]}", file=sys.stderr)
        return None
    payload = created.json()
    order_id = payload.get("id")
    approve = session.post(f"{bff}/api/sales/orders/{order_id}/approve", headers=headers, timeout=TIMEOUT)
    if approve.status_code not in {200, 201}:
        print(f"WARNING: sales order approve failed: {approve.status_code} {approve.text[:300]}", file=sys.stderr)
    return {"id": str(order_id), "status": (approve.json().get("status") if approve.status_code in {200, 201} else payload.get("status"))}


def main() -> int:
    manifest = load_runtime_manifest()
    bff = str((manifest.get("urls") or {}).get("bff") or "")
    web = str((manifest.get("urls") or {}).get("web") or "")
    if not bff:
        raise SystemExit("Runtime manifest missing urls.bff")
    _require_loopback(bff, "BFF")
    if web:
        _require_loopback(web, "Web")

    admin_email = str((manifest.get("defaults") or {}).get("admin_email") or "admin@hariom.com")
    admin_password = str((manifest.get("defaults") or {}).get("admin_password") or "admin123")
    session = requests.Session()
    login = session.post(f"{bff}/api/auth/login", json={"email": admin_email, "password": admin_password}, timeout=TIMEOUT)
    if login.status_code != 200:
        raise SystemExit(f"Admin login failed: {login.status_code} {login.text[:300]}")
    payload = login.json()
    if payload.get("access_token") is not None:
        raise SystemExit("BFF login exposed an access token")

    plants_resp = session.get(f"{bff}/api/auth/plants", timeout=TIMEOUT)
    if plants_resp.status_code != 200:
        plants_resp = session.get(f"{bff}/api/master/plants", timeout=TIMEOUT)
    plants_payload = plants_resp.json() if plants_resp.status_code == 200 else []
    if isinstance(plants_payload, dict):
        plants_payload = plants_payload.get("items") or plants_payload.get("plants") or []
    plants = {}
    for row in plants_payload or []:
        code = str(row.get("code") or row.get("name") or "").upper()
        plant_id = str(row.get("id") or "")
        if "B" in code or code.endswith("2"):
            plants["plant_b"] = {"id": plant_id, "code": code, **row}
        else:
            plants.setdefault("plant_a", {"id": plant_id, "code": code, **row})
    if "plant_a" not in plants and plants_payload:
        first = plants_payload[0]
        plants["plant_a"] = {"id": str(first.get("id")), "code": str(first.get("code") or "PLANT_A")}
    if "plant_a" not in plants:
        raise SystemExit("Could not read a real Plant A id from the isolated stack")

    plant_a = plants["plant_a"]["id"]
    plant_b = (plants.get("plant_b") or {}).get("id") or plant_a

    desired = {
        "admin": {"email": admin_email, "password": admin_password, "roles": ["Admin"], "plant_id": plant_a},
        "owner": {"email": "nverify.owner@example.com", "password": PASSWORD, "roles": ["Owner"], "plant_id": plant_a, "is_owner_all_plants": True},
        "sales_maker_a": {"email": "nverify.sales.a@example.com", "password": PASSWORD, "roles": ["Sales"], "plant_id": plant_a},
        "sales_approver_a": {"email": "nverify.approver.a@example.com", "password": PASSWORD, "roles": ["SOApprover"], "plant_id": plant_a},
        "planner_a": {"email": "nverify.planner.a@example.com", "password": PASSWORD, "roles": ["Planner"], "plant_id": plant_a},
        "supervisor_a": {"email": "nverify.supervisor.a@example.com", "password": PASSWORD, "roles": ["SupervisorEntry"], "plant_id": plant_a},
        "dispatch_a": {"email": "nverify.dispatch.a@example.com", "password": PASSWORD, "roles": ["Dispatch"], "plant_id": plant_a},
        "sales_maker_b": {"email": "nverify.sales.b@example.com", "password": PASSWORD, "roles": ["Sales"], "plant_id": plant_b},
        "sales_approver_b": {"email": "nverify.approver.b@example.com", "password": PASSWORD, "roles": ["SOApprover"], "plant_id": plant_b},
        "store_b": {"email": "nverify.store.b@example.com", "password": PASSWORD, "roles": ["Store"], "plant_id": plant_b},
    }

    existing = session.get(f"{bff}/api/auth/users", timeout=TIMEOUT)
    existing_rows = []
    if existing.status_code == 200:
        body = existing.json()
        existing_rows = body.get("items") if isinstance(body, dict) else body
    by_email = {str(row.get("email") or "").lower(): row for row in existing_rows or []}

    users: dict[str, dict] = {}
    for key, spec in desired.items():
        email = spec["email"]
        row = by_email.get(email.lower())
        if row is None and key != "admin":
            create = session.post(
                f"{bff}/api/auth/users",
                json={
                    "name": key,
                    "email": email,
                    "password": spec["password"],
                    "plant_id": spec["plant_id"],
                    "role_names": spec["roles"],
                    "allowed_plant_ids": [spec["plant_id"]],
                    "is_owner_all_plants": bool(spec.get("is_owner_all_plants")),
                },
                timeout=TIMEOUT,
            )
            if create.status_code not in {200, 201}:
                raise SystemExit(f"Unable to create {key}: {create.status_code} {create.text[:400]}")
            row = create.json()
        if row is None and key == "admin":
            row = {"email": email, "plant_id": plant_a, "roles": ["Admin"]}
        users[key] = {
            "email": email,
            "password": spec["password"],
            "roles": spec["roles"],
            "plant_id": str(row.get("plant_id") or spec["plant_id"]),
            "id": str(row.get("id") or ""),
            "allowed_plant_ids": row.get("allowed_plant_ids") or [spec["plant_id"]],
            "is_owner_all_plants": bool(spec.get("is_owner_all_plants") or row.get("is_owner_all_plants")),
        }

    catalog_a = seed_plant_catalog(session, bff, plant_a, "A")
    catalog_b = seed_plant_catalog(session, bff, plant_b, "B")
    order_a = seed_sales_order(session, bff, plant_a, catalog_a)

    job_cards = session.get(f"{bff}/api/production/job-cards", params={"limit": 20}, timeout=TIMEOUT)
    flows = []
    if job_cards.status_code == 200:
        body = job_cards.json()
        items = body.get("items") if isinstance(body, dict) else body
        for row in items or []:
            job_id = row.get("id") or row.get("job_card_id")
            if job_id:
                flows.append({"job_card_id": str(job_id), "status": row.get("status"), "product_code": row.get("product_code")})
                break

    fixture = {
        "generated_at": datetime.now().isoformat(),
        "git_sha": ((manifest.get("identity") or {}).get("git") or {}).get("sha"),
        "base_urls": {"web": web, "bff": bff},
        "auth": {"admin_email": admin_email, "admin_password": admin_password},
        "users": users,
        "plants": plants,
        "catalog": {"plant_a": catalog_a, "plant_b": catalog_b},
        "sales_order_a": order_a,
        "flows": flows,
        "formula_fixtures": [{"mandrel_od_mm": APPROVED_MANDREL_OD, "tube": list(APPROVED_TUBE), "item_code": FIXTURE_ITEM_CODE}],
    }
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / "browser_e2e_fixture_latest.json"
    path.write_text(json.dumps(fixture, indent=2), encoding="utf-8")
    public = {**fixture, "auth": {"admin_email": admin_email, "admin_password": "***redacted***"}}
    public["users"] = {key: {**value, "password": "***redacted***"} for key, value in users.items()}
    (REPORT_DIR / "browser_e2e_fixture_public.json").write_text(json.dumps(public, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "fixture": str(path),
                "plant_a": plant_a,
                "plant_b": plant_b,
                "users": list(users),
                "approved_specs": {"A": catalog_a["approved_spec_id"], "B": catalog_b["approved_spec_id"]},
                "sales_order": order_a,
                "flows": len(flows),
            },
            indent=2,
        )
    )
    if not flows:
        print("WARNING: no job cards yet; dispatch print journey will fail until one is created.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
