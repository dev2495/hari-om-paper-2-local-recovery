"""Shift rule for floor issues (client 2026-10-30): A 08:00-20:00 IST, B 20:00-08:00 IST, business date = the
day the shift began. Server stamps are naive UTC."""
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

from src.services.shift_rule import floor_shift_now, shift_at


def test_shift_b_after_midnight_belongs_to_the_day_before():
    after_midnight = shift_at(datetime(2026, 10, 30, 20, 0))  # 01:30 IST on 31 Oct
    assert (after_midnight.shift, after_midnight.business_date, after_midnight.label) == ("B", date(2026, 10, 30), "Shift B · 30 Oct")
    assert after_midnight.code == "SHIFT_B" and after_midnight.at_ist.strftime("%d %H:%M") == "31 01:30"


def test_shift_edges_month_and_year_ends_and_aware_times():
    assert shift_at(datetime(2026, 10, 31, 2, 29)).label == "Shift B · 30 Oct"   # 07:59 IST
    assert shift_at(datetime(2026, 10, 31, 2, 30)).label == "Shift A · 31 Oct"   # 08:00 IST
    assert shift_at(datetime(2026, 10, 30, 14, 29)).label == "Shift A · 30 Oct"  # 19:59 IST
    assert shift_at(datetime(2026, 10, 30, 14, 30)).label == "Shift B · 30 Oct"  # 20:00 IST
    assert shift_at(datetime(2026, 10, 31, 20, 30)).business_date == date(2026, 10, 31)  # 02:00 IST on 1 Nov
    assert shift_at(datetime(2026, 12, 31, 21, 30)).business_date == date(2026, 12, 31)  # 03:00 IST on 1 Jan
    ist = timezone(timedelta(hours=5, minutes=30))
    aware = shift_at(datetime(2026, 10, 31, 1, 30, tzinfo=ist))
    assert (aware.shift, aware.business_date, aware.at_utc) == ("B", date(2026, 10, 30), datetime(2026, 10, 30, 20, 0))


def test_now_reads_the_frozen_registration_clock():
    with patch("src.services.shift_rule._utc_now", return_value=datetime(2026, 10, 30, 20, 0)):
        assert floor_shift_now().label == "Shift B · 30 Oct"
