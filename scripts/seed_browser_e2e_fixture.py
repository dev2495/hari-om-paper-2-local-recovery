#!/usr/bin/env python3
"""Seed disposable isolated-stack browser fixtures with real IDs.

Refuses any non-loopback BFF URL. Does not run cutover against production.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

import requests

from runtime_support import REPORT_DIR, load_runtime_manifest

PASSWORD = os.getenv("ERP_TEST_USER_PASSWORD", "Nverify_User1!")
TIMEOUT = 30


def _require_loopback(url: str, label: str) -> None:
    host = urlparse(url).hostname or ""
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise SystemExit(f"{label} is not loopback ({url}). Refusing to seed.")


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

    def _json_rows(resp):
        if resp.status_code != 200:
            return []
        body = resp.json()
        if isinstance(body, dict):
            return body.get("items") or body.get("customers") or body.get("plants") or []
        return body or []

    for plant_id, label in ((plant_a, "A"), (plant_b, "B")):
        headers = {"X-Plant-ID": str(plant_id)}
        customers = _json_rows(session.get(f"{bff}/api/master/customers", headers=headers, timeout=TIMEOUT))
        if not customers:
            code = f"NV{label}-{datetime.now().strftime('%H%M%S')}"
            created = session.post(
                f"{bff}/api/master/customers",
                headers=headers,
                json={
                    "customer_code": code,
                    "name": f"Nverify Plant {label} {code}",
                    "contact_email": None,
                    "contact_phone": None,
                },
                timeout=TIMEOUT,
            )
            if created.status_code not in {200, 201}:
                print(f"WARNING: could not create Plant {label} customer: {created.status_code} {created.text[:200]}", file=sys.stderr)

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
        "flows": flows,
        "formula_fixtures": [],
    }
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / "browser_e2e_fixture_latest.json"
    path.write_text(json.dumps(fixture, indent=2), encoding="utf-8")
    public = {**fixture, "auth": {"admin_email": admin_email, "admin_password": "***redacted***"}}
    public["users"] = {
        key: {**value, "password": "***redacted***"}
        for key, value in users.items()
    }
    (REPORT_DIR / "browser_e2e_fixture_public.json").write_text(json.dumps(public, indent=2), encoding="utf-8")
    print(json.dumps({"fixture": str(path), "plant_a": plant_a, "users": list(users), "flows": len(flows)}, indent=2))
    if not flows:
        print("WARNING: no job cards yet; dispatch print journey will fail until one is created.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
