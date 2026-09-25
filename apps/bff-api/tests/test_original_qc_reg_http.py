"""QC-02 token matrix and REG-01 closed-period receipt (Procurement V2) against isolated BFF."""
from __future__ import annotations

import os
import uuid
from datetime import date, datetime

import httpx
import pytest
from sqlalchemy import create_engine, text

BFF = os.environ.get("HARI_OM_BFF_URL", "http://127.0.0.1:24000")
PLANT_A = "00000000-0000-0000-0000-0000000000a1"
PLANT_B = "00000000-0000-0000-0000-0000000000b2"
PROD_URL = os.environ.get(
    "HARI_OM_PRODUCTION_DATABASE_URL",
    "postgresql://devarshthakkar@127.0.0.1:5432/hariom_nverify_productiondb",
)

if os.environ.get("HARI_OM_LIVE_HTTP") != "1":
    pytest.skip("Requires isolated BFF HTTP (HARI_OM_LIVE_HTTP=1)", allow_module_level=True)
if "hariom_nverify" not in PROD_URL:
    pytest.skip("Requires isolated hariom_nverify production DSN", allow_module_level=True)


def _login(email: str, password: str) -> httpx.Client:
    client = httpx.Client(base_url=BFF, timeout=20.0)
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    if response.status_code != 200:
        pytest.skip(f"BFF login failed for {email}: {response.status_code} {response.text}")
    return client


def test_qc02_qc_token_denied_admin_sales_approval_and_other_plant():
    admin = _login("admin@hariom.com", "admin123")
    email = f"nverify.qc.{uuid.uuid4().hex[:8]}@example.com"
    created = admin.post(
        "/api/auth/users",
        json={
            "name": "Nverify QC",
            "email": email,
            "password": "Nverify_Qc1!",
            "plant_id": PLANT_A,
            "role_names": ["QC"],
            "allowed_plant_ids": [PLANT_A],
            "is_owner_all_plants": False,
        },
        headers={"X-Plant-ID": PLANT_A},
    )
    assert created.status_code in {200, 201}, created.text
    qc = _login(email, "Nverify_Qc1!")
    users = qc.get("/api/auth/users", headers={"X-Plant-ID": PLANT_A})
    assert users.status_code in {401, 403}, users.text
    approve = qc.post(
        f"/api/sales/orders/{uuid.uuid4()}/approve",
        json={},
        headers={"X-Plant-ID": PLANT_A},
    )
    assert approve.status_code in {401, 403}, approve.text
    other = qc.get("/api/production/job-cards", headers={"X-Plant-ID": PLANT_B})
    assert other.status_code in {401, 403}, other.text
    admin.close()
    qc.close()


def test_reg01_closed_period_grn_is_books_locked():
    admin = _login("admin@hariom.com", "admin123")
    headers = {"X-Plant-ID": PLANT_A}
    suffix = uuid.uuid4().hex[:8]
    item = admin.post(
        "/api/inventory/items",
        json={
            "item_code": f"NV-R01-{suffix}",
            "name": "REG01 paper",
            "type": "RAW_PAPER",
            "tracking_mode": "BULK",
            "uom": "KG",
        },
        headers=headers,
    )
    assert item.status_code in {200, 201}, item.text
    item_id = item.json()["id"]
    loc = admin.post(
        "/api/inventory/locations",
        json={"code": f"NV-R01-{suffix}", "warehouse": "WH"},
        headers=headers,
    )
    assert loc.status_code in {200, 201}, loc.text
    location_id = loc.json()["id"]
    po = admin.post(
        "/api/purchase/orders",
        json={
            "request_id": str(uuid.uuid4()),
            "supplier_id": str(uuid.uuid4()),
            "supplier_name": "Lock Mills",
            "lines": [{"item_id": item_id, "qty_ordered": 10, "unit_cost": 4}],
        },
        headers=headers,
    )
    assert po.status_code in {200, 201}, po.text
    po_body = po.json()
    po_id = po_body["id"]
    line_id = po_body["lines"][0]["id"]
    history = admin.get(f"/api/purchase/orders/{po_id}/history", headers=headers)
    assert history.status_code == 200, history.text
    content_hash = history.json()["items"][0]["content_hash"]
    submitted = admin.post(
        f"/api/purchase/orders/{po_id}/submit",
        json={"expected_version": po_body["version"], "content_hash": content_hash, "reason": "REG-01"},
        headers=headers,
    )
    assert submitted.status_code in {200, 201}, submitted.text
    owner = _login("nverify.owner@example.com", "Nverify_User1!")
    approved = owner.post(
        f"/api/purchase/orders/{po_id}/approve",
        json={"expected_version": submitted.json()["version"], "content_hash": content_hash, "reason": "REG-01"},
        headers=headers,
    )
    assert approved.status_code in {200, 201}, approved.text
    owner.close()
    engine = create_engine(PROD_URL)
    with engine.begin() as connection:
        connection.execute(
            text("DELETE FROM monthly_material_close WHERE plant_id = CAST(:plant_id AS uuid) AND month_start = :month_start"),
            {"plant_id": PLANT_A, "month_start": date(2026, 8, 1)},
        )
        connection.execute(
            text(
                "INSERT INTO monthly_material_close (id, plant_id, month_start, status, approved_by, approved_at, locked_at, imported_rows_count, created_at, updated_at) "
                "VALUES (CAST(:id AS uuid), CAST(:plant_id AS uuid), :month_start, 'APPROVED', 'nverify-reg01', :approved_at, :approved_at, 0, :approved_at, :approved_at)"
            ),
            {
                "id": str(uuid.uuid4()),
                "plant_id": PLANT_A,
                "month_start": date(2026, 8, 1),
                "approved_at": datetime.utcnow(),
            },
        )
    close = admin.post(
        "/api/production/approve-monthly-close",
        json={"month": "2026-08", "notes": "REG-01 nverify lock"},
        headers=headers,
    )
    if close.status_code not in {200, 201, 400, 422}:
        pytest.fail(f"Unexpected monthly-close status {close.status_code}: {close.text}")
    state = admin.get("/api/production/books-state", headers=headers)
    assert state.status_code == 200, state.text
    locked_through = str((state.json() or {}).get("locked_through") or "")
    assert locked_through[:10] >= "2026-08-31", state.text
    grn = admin.post(
        "/api/purchase/v2/receipts",
        json={
            "request_id": str(uuid.uuid4()),
            "purchase_order_id": po_id,
            "received_date": "2026-08-15",
            "invoice_no": f"INV-R01-{suffix}",
            "invoice_date": "2026-08-15",
            "lines": [{"po_line_id": str(line_id), "quantity": 10, "invoice_rate": 4, "location_id": str(location_id)}],
        },
        headers=headers,
    )
    assert grn.status_code == 422, grn.text
    body = grn.json()
    detail = body.get("detail") if isinstance(body.get("detail"), dict) else body
    assert detail.get("code") == "BOOKS_LOCKED" or "BOOKS_LOCKED" in str(body)
    receivable = admin.get("/api/purchase/v2/receivable-lines", headers=headers)
    assert receivable.status_code == 200, receivable.text
    open_line = next(row for row in receivable.json()["items"] if row["po_line_id"] == str(line_id))
    assert open_line["received_qty"] == 0 and open_line["open_qty"] == 10
    admin.close()
