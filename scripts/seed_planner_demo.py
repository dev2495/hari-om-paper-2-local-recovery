#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import uuid
from datetime import date, timedelta
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import psycopg2


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "hariom-erp" / "runtime" / "runtime_manifest.json"
ADMIN_EMAIL = os.getenv("HARIOM_ADMIN_EMAIL", "admin@hariom.com")
ADMIN_PASSWORD = os.getenv("HARIOM_ADMIN_PASSWORD", "admin123")
MASTER_DB_URL = os.getenv("MASTER_DATABASE_URL", "postgresql://devarshthakkar@localhost:5432/masterdb")
SALES_DB_URL = os.getenv("SALES_DATABASE_URL", "postgresql://devarshthakkar@localhost:5432/salesdb")
PRODUCTION_DB_URL = os.getenv("PRODUCTION_DATABASE_URL", "postgresql://devarshthakkar@localhost:5432/productiondb")
PLANT_ID = os.getenv("HARIOM_PLANT_ID", "00000000-0000-0000-0000-0000000000a1")


MACHINES = [
    {
        "code": "WINDER_01",
        "name": "Winder 01 - High volume",
        "department": "WINDER",
        "capacity_type": "BAMBOOS_PER_DAY",
        "capacity_value": 1000,
    },
    {
        "code": "WINDER_02",
        "name": "Winder 02 - Standard",
        "department": "WINDER",
        "capacity_type": "BAMBOOS_PER_DAY",
        "capacity_value": 900,
    },
    {
        "code": "WINDER_03",
        "name": "Winder 03 - Short runs",
        "department": "WINDER",
        "capacity_type": "BAMBOOS_PER_DAY",
        "capacity_value": 800,
    },
    {
        "code": "OVEN_01",
        "name": "Oven 01 - Batch A",
        "department": "OVEN",
        "capacity_type": "BATCHES_PER_DAY",
        "capacity_value": 2,
    },
    {
        "code": "OVEN_02",
        "name": "Oven 02 - Batch B",
        "department": "OVEN",
        "capacity_type": "BATCHES_PER_DAY",
        "capacity_value": 2,
    },
    {
        "code": "OVEN_03",
        "name": "Oven 03 - Trial batch",
        "department": "OVEN",
        "capacity_type": "BATCHES_PER_DAY",
        "capacity_value": 1,
    },
    {
        "code": "PROCESS_01",
        "name": "Process 01 - Finishing",
        "department": "PROCESS",
        "capacity_type": "TUBES_PER_DAY",
        "capacity_value": 8000,
    },
    {
        "code": "PROCESS_02",
        "name": "Process 02 - Inspection",
        "department": "PROCESS",
        "capacity_type": "TUBES_PER_DAY",
        "capacity_value": 6500,
    },
    {
        "code": "PROCESS_03",
        "name": "Process 03 - Short runs",
        "department": "PROCESS",
        "capacity_type": "TUBES_PER_DAY",
        "capacity_value": 5000,
    },
]


def load_manifest() -> dict:
    if not MANIFEST_PATH.exists():
        raise SystemExit(f"Runtime manifest missing: {MANIFEST_PATH}")
    return json.loads(MANIFEST_PATH.read_text())


def api_json(
    method: str,
    url: str,
    *,
    token: str | None = None,
    plant_id: str | None = PLANT_ID,
    payload: dict | list | None = None,
    form: dict | None = None,
    params: dict | None = None,
) -> dict | list:
    if params:
        url = f"{url}?{urlencode(params, doseq=True)}"
    headers = {"Accept": "application/json"}
    body = None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if plant_id:
        headers["X-Plant-ID"] = plant_id
    if form is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        body = urlencode(form).encode("utf-8")
    elif payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload).encode("utf-8")

    request = Request(url, data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=20) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} failed: {exc.code} {detail}") from exc
    return json.loads(raw) if raw else {}


def login(urls: dict) -> tuple[str, dict]:
    response = api_json(
        "POST",
        f"{urls['auth']}/auth/login",
        plant_id=None,
        form={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    return str(response["access_token"]), dict(response.get("user") or {})


def seed_machine_master() -> list[dict]:
    with psycopg2.connect(MASTER_DB_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE machine
                   SET code = CONCAT('OLD_', RIGHT(REPLACE(id::text, '-', ''), 24)),
                       name = CONCAT('Archived ', RIGHT(REPLACE(id::text, '-', ''), 18), ' ', SUBSTRING(name, 1, 70)),
                       is_active = FALSE,
                       active = FALSE
                 WHERE plant_id = %s
                   AND department IN ('WINDER', 'OVEN', 'PROCESS')
                """,
                (PLANT_ID,),
            )

            seeded: list[dict] = []
            for row in MACHINES:
                machine_id = str(uuid.uuid4())
                cursor.execute(
                    """
                    INSERT INTO machine (
                        id, code, name, department, capacity_type, capacity_value,
                        id_min_mm, id_max_mm, od_min_mm, od_max_mm,
                        length_min_mm, length_max_mm, plant_id, is_active, active
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, 10, 500, 10, 650, 25, 2500, %s, TRUE, TRUE)
                    RETURNING id, code, name, department, capacity_type, capacity_value
                    """,
                    (
                        machine_id,
                        row["code"],
                        row["name"],
                        row["department"],
                        row["capacity_type"],
                        float(row["capacity_value"]),
                        PLANT_ID,
                    ),
                )
                result = cursor.fetchone()
                seeded.append(
                    {
                        "id": str(result[0]),
                        "code": result[1],
                        "name": result[2],
                        "department": result[3],
                        "capacity_type": result[4],
                        "capacity_value": float(result[5]),
                    }
                )
    return seeded


def clear_demo_planner_rows() -> int:
    with psycopg2.connect(PRODUCTION_DB_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                WITH demo_cards AS (
                    SELECT id
                      FROM job_cards
                     WHERE plant_id = %s
                       AND COALESCE(product_code, '') LIKE 'PLAN-DEMO-%%'
                       AND status <> 'COMPLETED'
                )
                UPDATE job_card_stage_segments
                   SET status = 'CANCELLED'
                 WHERE job_card_id IN (SELECT id FROM demo_cards)
                   AND status <> 'COMPLETED'
                """,
                (PLANT_ID,),
            )
            cursor.execute(
                """
                UPDATE job_cards
                   SET status = 'CANCELLED'
                 WHERE plant_id = %s
                   AND COALESCE(product_code, '') LIKE 'PLAN-DEMO-%%'
                   AND status <> 'COMPLETED'
                """,
                (PLANT_ID,),
            )
            return int(cursor.rowcount or 0)


def ensure_customer(urls: dict, token: str) -> dict:
    customers = api_json("GET", f"{urls['master']}/master/customers/", token=token)
    active_customers = [row for row in customers if row.get("active", True)]
    if active_customers:
        return active_customers[0]
    return api_json(
        "POST",
        f"{urls['master']}/master/customers/",
        token=token,
        payload={
            "customer_code": "DEMO-CUTOVER",
            "name": "Cutover Demo Customer",
            "address": "Planner demo account",
            "primary_contact_name": "Planner",
            "primary_contact_phone": "9999999999",
            "primary_contact_email": "planner.demo@example.com",
        },
    )


def choose_specs(urls: dict, token: str) -> list[dict]:
    specs = api_json("GET", f"{urls['spec']}/specs/", token=token)
    approved = [
        row
        for row in specs
        if str(row.get("status") or "").lower() == "approved" and bool(row.get("active", True))
    ]
    selected = approved or [row for row in specs if bool(row.get("active", True))]
    if not selected:
        raise SystemExit("No active/approved specifications are available for planner demo releases.")
    while len(selected) < 10:
        selected.append(selected[len(selected) % len(selected)])
    return selected[:10]


def mark_sales_order_released(order_id: str) -> None:
    with psycopg2.connect(SALES_DB_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE sales_orders
                   SET status = 'RELEASED',
                       approved_by = 'planner-demo',
                       released_by = 'planner-demo',
                       approved_at = NOW(),
                       released_at = NOW()
                 WHERE id = %s
                """,
                (order_id,),
            )


def create_demo_release(urls: dict, token: str, customer: dict, specs: list[dict], winders: list[dict]) -> dict:
    today = date.today()
    line_qtys = [900, 1200, 1500, 1800, 2100, 2400, 1000, 1300, 1600, 1900]
    lines = []
    for index, spec in enumerate(specs, start=1):
        code = str(spec.get("product_code") or spec.get("spec_no") or spec.get("spec_reference") or spec.get("id"))[:24]
        lines.append(
            {
                "approved_spec_id": spec["id"],
                "line_no": index,
                "product_code": f"PLAN-DEMO-{index}-{code}",
                "parchment_color": spec.get("parchment_color") or "Demo parchment",
                "rate_per_pc": 1.0,
                "qty": line_qtys[index - 1],
                "due_date": str(today + timedelta(days=index)),
            }
        )

    created = api_json(
        "POST",
        f"{urls['sales']}/sales-orders",
        token=token,
        payload={
            "customer_id": customer["id"],
            "po_number": f"PO-PLANNER-DEMO-{today.strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}",
            "po_date": str(today),
            "notes": "Demo monthly PO seeded for planner drag-drop testing.",
            "lines": lines,
        },
    )
    mark_sales_order_released(created["id"])
    released = api_json("GET", f"{urls['sales']}/sales-orders/{created['id']}", token=token)

    release_rows = []
    for index, line in enumerate(released["lines"]):
        release_rows.append(
            {
                "release_lot_id": str(uuid.uuid4()),
                "sales_order_line_id": line["id"],
                "release_qty": min(float(line["qty"]), line_qtys[index]),
                "winder_machine_id": winders[index % len(winders)]["id"],
                "product_code": line.get("product_code"),
            }
        )

    sync = api_json(
        "POST",
        f"{urls['production']}/sales-orders/{created['id']}/release-sync",
        token=token,
        payload={"line_ids": [row["sales_order_line_id"] for row in release_rows], "release_rows": release_rows},
    )
    return {"sales_order": released, "sync": sync, "release_rows": release_rows}


def queue_snapshot(urls: dict, token: str) -> dict:
    return api_json(
        "GET",
        f"{urls['production']}/planning/board",
        token=token,
        params={"stage": "WINDER", "plan_date": str(date.today())},
    )


def main() -> int:
    manifest = load_manifest()
    urls = manifest["urls"]
    token, user = login(urls)
    print(f"Authenticated as {user.get('email')} for plant {PLANT_ID}")

    seeded_machines = seed_machine_master()
    winders = [row for row in seeded_machines if row["department"] == "WINDER"]
    ovens = [row for row in seeded_machines if row["department"] == "OVEN"]
    process = [row for row in seeded_machines if row["department"] == "PROCESS"]
    print(f"Seeded machines: {len(winders)} winders, {len(ovens)} ovens, {len(process)} process machines")

    cancelled_cards = clear_demo_planner_rows()
    print(f"Archived old demo planner cards: {cancelled_cards}")

    customer = ensure_customer(urls, token)
    specs = choose_specs(urls, token)
    release = create_demo_release(urls, token, customer, specs, winders)
    synced_job_cards = [row["job_card_id"] for row in release["sync"]["line_results"]]
    print(f"Released sales order: {release['sales_order']['order_no']} ({release['sales_order']['id']})")
    print(f"Synced job cards: {', '.join(synced_job_cards)}")

    board = queue_snapshot(urls, token)
    queue_count = 0
    for stage_view in board.get("stages") or []:
        if str(stage_view.get("stage") or "").upper() != "WINDER":
            continue
        for lane in stage_view.get("lanes") or []:
            if not lane.get("machine_id") and not lane.get("shift_code"):
                queue_count += len(lane.get("jobs") or [])
    print(f"Winder open queue now has {queue_count} unscheduled card(s).")
    print("Open http://127.0.0.1:13000/planning/board?section=winder to test drag-drop planning.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
