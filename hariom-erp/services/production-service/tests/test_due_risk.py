from datetime import date, datetime
from zoneinfo import ZoneInfo
import unittest

from src.due_risk import (
    DUE_RISK_OVERDUE,
    DUE_RISK_PRIORITY,
    classify_due_risk,
    due_risk_label,
    plant_today,
    priority_window,
)


class DueRiskPredicateTests(unittest.TestCase):
    def test_plant_today_uses_asia_kolkata(self):
        now = datetime(2026, 9, 17, 22, 30, tzinfo=ZoneInfo("UTC"))
        self.assertEqual(plant_today(now), date(2026, 9, 18))

    def test_priority_window_is_today_through_today_plus_two(self):
        start, end = priority_window(date(2026, 9, 17))
        self.assertEqual(start, date(2026, 9, 17))
        self.assertEqual(end, date(2026, 9, 19))

    def test_overdue_is_separate_from_priority(self):
        today = date(2026, 9, 17)
        self.assertEqual(classify_due_risk(date(2026, 9, 16), today), DUE_RISK_OVERDUE)
        self.assertEqual(classify_due_risk(date(2026, 9, 17), today), DUE_RISK_PRIORITY)
        self.assertEqual(classify_due_risk(date(2026, 9, 19), today), DUE_RISK_PRIORITY)
        self.assertIsNone(classify_due_risk(date(2026, 9, 20), today))
        self.assertIsNone(classify_due_risk(None, today))

    def test_label_names_the_three_day_window(self):
        label = due_risk_label(date(2026, 9, 17))
        self.assertIn("next 3 plant days", label)
        self.assertIn("Asia/Kolkata", label)
