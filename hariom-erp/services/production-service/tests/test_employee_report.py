"""Employee performance report (owner decision 7, 1 Nov 2026): the grouping rules, without a database."""
from src.routers.employee_report import card_hours, operator_key, summarise


def _run(**values):
    base = {"operator_key": "id:e1", "operator_id": "e1", "operator_name": "Ramesh", "operator_code": "W01", "stage": "WINDER",
            "made": 100, "good": 95, "rejected": 5, "flagged_qc": 0, "qc_readings": 0, "date": "2026-10-30", "shift": "SHIFT_A",
            "hours": None, "at": "2026-10-30T10:00:00", "kind": "PRODUCTION", "source": "BATCH"}
    return {**base, **values}


def test_operator_is_the_master_id_else_the_name_as_written():
    assert operator_key("e1", "Ramesh") == "id:e1"
    assert operator_key(None, "  ramesh   patel ") == "name:RAMESH PATEL"


def test_card_hours_only_when_both_times_make_sense():
    assert card_hours("2026-10-30T08:00", "2026-10-30T15:30") == 7.5
    assert card_hours("2026-10-30T08:00", None) is None
    assert card_hours("2026-10-30T15:00", "2026-10-30T08:00") is None


def test_rows_are_one_operator_at_one_stage_with_reject_pct_shifts_and_flags():
    employees = {"id:e1": {"id": "e1", "name": "Ramesh Patel", "employee_code": "W01", "department": "WINDER"}}
    rows = summarise([
        _run(),
        _run(made=200, good=180, rejected=20, shift="SHIFT_B", hours=7.5, at="2026-10-30T22:00:00"),
        _run(date="2026-10-31", made=50, good=50, rejected=0, flagged_qc=2, qc_readings=6),
        _run(kind="QC", made=0, good=0, rejected=0, flagged_qc=1, qc_readings=3, at="2026-10-31T12:00:00"),
        _run(stage="OVEN", made=80, good=78, rejected=2),
        _run(operator_key="name:SURESH", operator_id=None, operator_name="Suresh", made=10, good=10, rejected=0, source="CARD_FORM"),
    ], employees)
    winder = next(row for row in rows if row["operator_key"] == "id:e1" and row["stage"] == "WINDER")
    assert (winder["operator_name"], winder["department"], winder["unit"]) == ("Ramesh Patel", "WINDER", "bamboo")
    assert (winder["runs"], winder["made"], winder["good"], winder["rejected"]) == (3, 350, 325, 25)
    assert winder["reject_pct"] == 7.1
    assert (winder["flagged_qc"], winder["qc_readings"]) == (3, 9)      # QC-only readings count, not as runs
    assert (winder["shifts_worked"], winder["days_worked"]) == (3, 2)
    assert winder["hours"] == 7.5 and winder["last_activity"] == "2026-10-31T12:00:00"
    oven = next(row for row in rows if row["stage"] == "OVEN")
    assert oven["runs"] == 1 and oven["reject_pct"] == 2.5
    suresh = next(row for row in rows if row["operator_key"] == "name:SURESH")
    assert suresh["department"] is None and suresh["sources"] == ["CARD_FORM"] and suresh["hours"] is None


def test_no_made_means_no_reject_pct():
    rows = summarise([_run(kind="QC", made=0, good=0, rejected=0, flagged_qc=1)], {})
    assert rows[0]["runs"] == 0 and rows[0]["reject_pct"] is None and rows[0]["operator_name"] == "Ramesh"
