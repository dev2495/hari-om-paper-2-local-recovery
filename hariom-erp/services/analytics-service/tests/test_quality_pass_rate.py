from datetime import date

from src.routers.reports import _quality_report


def test_quality_report_empty_inspections_are_not_one_hundred_percent():
    report = _quality_report(
        {"quality_inspections": [], "quality_holds": []},
        date(2026, 9, 1),
        date(2026, 9, 17),
        "day",
    )
    assert report["summary"]["checked"] == 0
    assert report["summary"]["compliance_percent"] == 0.0
    assert report["summary"]["pass_rate"] is None
    assert report["summary"]["has_inspection_data"] is False
