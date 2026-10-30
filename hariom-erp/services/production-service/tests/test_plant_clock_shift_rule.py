"""Client 30 Oct 2026: a partial entry at 01:31 IST was refused with "Valid business date is required".

The container clock is UTC, so between 00:00 and 05:30 IST the India date was "in the future". Business
"today" is India time, and the shift rule gives the business date: 01:30 IST on 31 Oct is Shift B of 30 Oct.
"""
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from src import lifecycle_rules
from src.lifecycle_rules import latest_entry_date, plant_today, shift_business_date, shift_slot
from src.routers import entries

# 01:30 IST on 31 Oct 2026 is 20:00 UTC on 30 Oct 2026.
NIGHT_0130_IST = datetime(2026, 10, 30, 20, 0, tzinfo=timezone.utc)


def frozen(moment):
    return patch.object(lifecycle_rules, "_clock", return_value=moment)


def _entry(day, shift="SHIFT_B"):
    return SimpleNamespace(kind="PRODUCTION", produced=10, accepted=10, input_quantity=0, cutting_loss_pcs=0, carry_in_pcs=0, carry_out_pcs=0,
                           rejected=0, samples=[], business_date=day, shift_code=shift, operator_id="op", stage="WINDER", details={})


def test_0130_ist_is_shift_b_of_the_day_before():
    with frozen(NIGHT_0130_IST):
        assert plant_today() == date(2026, 10, 31)  # the UTC date is still 30 Oct
        assert shift_slot() == (date(2026, 10, 30), "SHIFT_B")
        assert shift_business_date("SHIFT_B") == date(2026, 10, 30)
        assert shift_business_date("SHIFT_A") == date(2026, 10, 30)
        assert latest_entry_date() == date(2026, 10, 31)


def test_partial_entry_at_0130_ist_is_accepted_for_the_shift_date_and_the_calendar_date():
    with frozen(NIGHT_0130_IST):
        entries.validate_entry(_entry(date(2026, 10, 30)), None)  # Shift B of 30 Oct (the shift rule)
        entries.validate_entry(_entry(date(2026, 10, 31)), None)  # the India calendar date is not the future


def test_a_real_future_date_is_still_refused_in_plain_words():
    with frozen(NIGHT_0130_IST):
        with pytest.raises(HTTPException) as exc:
            entries.validate_entry(_entry(date(2026, 11, 1)), None)
    assert exc.value.status_code == 422
    assert "01 Nov 2026 is in the future" in exc.value.detail
    assert "Shift B of 30 Oct" in exc.value.detail


@pytest.mark.parametrize("utc, expected", [
    (datetime(2026, 10, 31, 2, 29, tzinfo=timezone.utc), (date(2026, 10, 30), "SHIFT_B")),  # 07:59 IST
    (datetime(2026, 10, 31, 2, 30, tzinfo=timezone.utc), (date(2026, 10, 31), "SHIFT_A")),  # 08:00 IST
    (datetime(2026, 10, 31, 14, 29, tzinfo=timezone.utc), (date(2026, 10, 31), "SHIFT_A")),  # 19:59 IST
    (datetime(2026, 10, 31, 14, 30, tzinfo=timezone.utc), (date(2026, 10, 31), "SHIFT_B")),  # 20:00 IST
    (datetime(2026, 10, 31, 18, 29, tzinfo=timezone.utc), (date(2026, 10, 31), "SHIFT_B")),  # 23:59 IST
    (datetime(2026, 10, 31, 18, 30, tzinfo=timezone.utc), (date(2026, 10, 31), "SHIFT_B")),  # 00:00 IST 1 Nov
])
def test_shift_boundaries_follow_shift_start(utc, expected):
    assert shift_slot(utc) == expected


def test_night_shift_card_entered_next_morning_belongs_to_the_night_it_started():
    morning = datetime(2026, 10, 31, 4, 30, tzinfo=timezone.utc)  # 10:00 IST on 31 Oct, Shift A running
    assert shift_business_date("SHIFT_A", morning) == date(2026, 10, 31)
    assert shift_business_date("SHIFT_B", morning) == date(2026, 10, 30)


def test_naive_server_timestamps_are_read_as_utc():
    assert shift_slot(datetime(2026, 10, 30, 20, 0)) == (date(2026, 10, 30), "SHIFT_B")
