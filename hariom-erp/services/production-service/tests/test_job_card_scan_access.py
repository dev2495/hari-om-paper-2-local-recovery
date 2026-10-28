"""Job card scan (client 2026-10-27): the printed QR is a full link, and Operators can find their card."""
from datetime import datetime
from types import SimpleNamespace
import uuid

import pytest
from fastapi import HTTPException

from src.routers import planning


def _role_gate(path: str, method: str = "GET"):
    route = next(r for r in planning.router.routes if r.path == path and method in r.methods)
    checks = [d.call for d in route.dependant.dependencies if d.call.__name__ == "role_checker"]
    assert len(checks) == 1, f"{method} {path} must have one role gate"
    return checks[0]


def test_operator_can_list_and_open_job_cards_for_the_floor_picker():
    for path in ("/job-cards", "/job-cards/{job_card_id}"):
        gate = _role_gate(path)
        assert gate(current_user={"roles": ["Operator"], "sub": "op"})["roles"] == ["Operator"]


def test_roles_without_floor_access_still_cannot_list_job_cards():
    gate = _role_gate("/job-cards")
    with pytest.raises(HTTPException) as exc:
        gate(current_user={"roles": ["GRN"], "sub": "grn"})
    assert exc.value.status_code == 403


def _snapshot_qr():
    job_card = SimpleNamespace(id=uuid.uuid4(), created_at=datetime(2026, 10, 27, 9, 0), plant_id=uuid.uuid4(), planned_qty=100.0)
    document = planning._build_document_snapshot(job_card=job_card, sales_order=None, spec_snapshot={}, stages=[], snapshot_mode="stored")
    return job_card.id, document["header"]["qr_value"]


def test_snapshot_qr_is_a_full_link_when_the_public_site_is_set(monkeypatch):
    monkeypatch.setenv("PUBLIC_APP_ORIGIN", "https://erp.example.test/")
    card_id, qr = _snapshot_qr()
    assert qr == f"https://erp.example.test/production/entry/{card_id}"


def test_snapshot_qr_keeps_the_path_without_a_public_site(monkeypatch):
    monkeypatch.delenv("PUBLIC_APP_ORIGIN", raising=False)
    card_id, qr = _snapshot_qr()
    assert qr == f"/production/entry/{card_id}"
