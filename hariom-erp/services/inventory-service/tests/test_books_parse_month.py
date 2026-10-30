"""The store's month key is strict YYYY-MM everywhere (books, month figures, sources): checker 30 Oct."""
from datetime import date

import pytest
from fastapi import HTTPException

from src.services.books import books_locked_detail, parse_month


def test_parse_month_accepts_only_yyyy_mm():
    assert parse_month("2026-05") == date(2026, 5, 1)
    assert parse_month(" 2026-10 ") == date(2026, 10, 1)
    for bad in ("2026-5", "26-05", "2026-05-01", "2026-13", "2026-00", "May 2026", "", None):
        with pytest.raises(HTTPException) as refused:
            parse_month(bad)
        assert refused.value.status_code == 422
        assert refused.value.detail == "Give the month as YYYY-MM, for example 2026-10."


def test_closed_month_detail_is_the_shared_shape():
    assert books_locked_detail(date(2026, 3, 1)) == {"code": "BOOKS_LOCKED", "message": "March 2026 is closed. Ask the owner to re-open it.", "month": "2026-03"}
