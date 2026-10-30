"""The dated-write guard locks exactly the CLOSED months (spec 2.5, client 2026-10-28)."""
import asyncio
from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from src.services import books_guard


def _run(coro):
    return asyncio.run(coro)


def _state(monkeypatch, state):
    async def fake(token, plant_id):
        return state
    monkeypatch.setattr(books_guard, "fetch_books_state", fake)


def test_only_closed_months_are_refused(monkeypatch):
    _state(monkeypatch, {"locked_months": ["2026-08"], "locked_through": "2026-08-31", "locked_by": "owner@example.com"})
    _run(books_guard.assert_not_backdated("t", "PLANT", effective_date="2026-07-31"))  # July was never closed
    _run(books_guard.assert_not_backdated("t", "PLANT", effective_date="2026-09-01"))
    with pytest.raises(HTTPException) as refused:
        _run(books_guard.assert_not_backdated("t", "PLANT", effective_date="2026-08-15"))
    # One refusal everywhere: 409 BOOKS_LOCKED with the plain message, as inventory and production send it.
    assert refused.value.status_code == 409
    assert refused.value.detail["code"] == "BOOKS_LOCKED" and refused.value.detail["month"] == "2026-08"
    assert refused.value.detail["message"] == "August 2026 is closed. Ask the owner to re-open it."


def test_older_production_without_locked_months_keeps_locked_through(monkeypatch):
    _state(monkeypatch, {"locked_through": "2026-08-31"})
    with pytest.raises(HTTPException):
        _run(books_guard.assert_not_backdated("t", "PLANT", effective_date="2026-07-31"))
    _run(books_guard.assert_not_backdated("t", "PLANT", effective_date="2026-09-01"))


def test_no_closed_month_and_far_future_dates(monkeypatch):
    _state(monkeypatch, {"locked_months": []})
    _run(books_guard.assert_not_backdated("t", "PLANT", effective_date="2020-01-01"))
    with pytest.raises(HTTPException) as refused:
        _run(books_guard.assert_not_backdated("t", "PLANT", effective_date=(date.today() + timedelta(days=5)).isoformat()))
    assert refused.value.detail["code"] == "FUTURE_DATE_NOT_ALLOWED"
