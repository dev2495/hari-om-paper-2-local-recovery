from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.routers import specs


def _spec(status="approved", qc=None):
    return SimpleNamespace(id="s1", status=status, qc_profile=qc or {})


QC = {"role": "QC", "roles": ["QC"], "token": "t"}
OWNER = {"role": "Owner", "roles": ["Owner"], "token": "t"}


def test_first_tolerance_setup_on_a_live_spec_is_open_to_qc(monkeypatch):
    monkeypatch.setattr(specs, "_live_spec_usage", lambda *a: {"open_lines": 3, "open_job_cards": 1})
    specs._enforce_live_qc_lock(_spec(qc={"status": "draft"}), QC, "P")  # no raise


def test_approved_tolerances_on_a_live_spec_are_owner_only(monkeypatch):
    monkeypatch.setattr(specs, "_live_spec_usage", lambda *a: {"open_lines": 0, "open_job_cards": 0})
    with pytest.raises(HTTPException) as error:
        specs._enforce_live_qc_lock(_spec(qc={"status": "approved"}), QC, "P")
    assert error.value.status_code == 403
    specs._enforce_live_qc_lock(_spec(qc={"status": "approved"}), OWNER, "P")  # owner, nothing open: allowed


def test_owner_blocked_while_orders_or_cards_use_the_spec(monkeypatch):
    monkeypatch.setattr(specs, "_live_spec_usage", lambda *a: {"open_lines": 2, "orders": ["SO-1"], "open_job_cards": 0})
    with pytest.raises(HTTPException) as error:
        specs._enforce_live_qc_lock(_spec(qc={"status": "complete", "approved_snapshot": {"x": 1}}), OWNER, "P")
    assert error.value.status_code == 409 and "SO-1" in error.value.detail


def test_draft_spec_is_not_locked(monkeypatch):
    monkeypatch.setattr(specs, "_live_spec_usage", lambda *a: pytest.fail("no usage lookup for a draft"))
    specs._enforce_live_qc_lock(_spec(status="draft", qc={"status": "approved"}), QC, "P")
