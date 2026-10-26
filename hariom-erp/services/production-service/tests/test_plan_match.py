"""Runs matched to planned slots by date and shift (client 2026-10-26)."""
from datetime import date, datetime

from src.plan_match import Run, Slot, adherence, match_runs, slot_result

D = date(2026, 10, 26)


def slot(key, day=D, shift="SHIFT_A", machine="W1", planned=24, status="ASSIGNED", card="C1", stage="WINDER"):
    return Slot(key=key, card=card, stage=stage, day=day, shift=shift, machine=machine, planned=planned, status=status)


def run(key, day=D, shift="SHIFT_A", machine="W1", made=24, card="C1", stage="WINDER", unscheduled=False):
    return Run(key=key, card=card, stage=stage, day=day, shift=shift, machine=machine, made=made, good=made, unscheduled=unscheduled)


def test_run_in_its_slot_counts_there_and_finishes_it():
    s = slot("s1")
    [m] = match_runs([s], [run("r1", made=23)])
    assert m.kind == "ON_PLAN" and m.slot is s and s.made == 23
    assert slot_result(s, datetime(2026, 10, 27, 9)) == "DONE"


def test_other_machine_same_shift_still_fills_the_slot():
    s = slot("s1")
    [m] = match_runs([s], [run("r1", machine="W2")])
    assert m.kind == "OTHER_MACHINE" and s.made == 24


def test_split_plan_runs_fill_each_part():
    a, b = slot("a", planned=12), slot("b", day=date(2026, 10, 27), shift="SHIFT_B", planned=12)
    matches = match_runs([a, b], [run("r1", made=12), run("r2", day=date(2026, 10, 27), shift="SHIFT_B", made=6)])
    assert [m.kind for m in matches] == ["ON_PLAN", "ON_PLAN"]
    now = datetime(2026, 10, 28, 10)
    assert slot_result(a, now) == "DONE" and slot_result(b, now) == "PARTLY"


def test_late_and_early_runs_go_to_the_nearest_slot():
    s = slot("s1")
    late, early = match_runs([s], [run("r1", day=date(2026, 10, 28)), run("r0", day=date(2026, 10, 25))])[::-1]
    assert late.kind == "LATE" and late.days_off == 2
    assert early.kind == "EARLY" and early.days_off == -1
    assert s.made == 0 and s.made_elsewhere == 48
    assert slot_result(s, datetime(2026, 10, 29, 9)) == "MOVED"


def test_same_day_other_shift_and_unplanned():
    s = slot("s1")
    found = {m.run.key: m for m in match_runs([s], [run("r1", shift="SHIFT_B"), run("u1", card="C2")])}
    m, u = found["r1"], found["u1"]
    assert m.kind == "OTHER_SHIFT" and u.kind == "UNPLANNED" and u.slot is None
    [flagged] = match_runs([slot("s2")], [run("r2", unscheduled=True)])
    assert flagged.kind == "UNPLANNED"


def test_slot_results_over_time():
    s = slot("s1")
    assert slot_result(s, datetime(2026, 10, 26, 7)) == "UPCOMING"
    assert slot_result(s, datetime(2026, 10, 26, 12)) == "IN_PROGRESS"
    assert slot_result(s, datetime(2026, 10, 26, 21)) == "NOT_RUN"
    closed = slot("s2", day=date(2026, 10, 30), status="COMPLETED")
    assert slot_result(closed, datetime(2026, 10, 27, 9)) == "NOT_NEEDED"


def test_adherence_counts_only_finished_slots():
    assert adherence(["DONE", "DONE", "PARTLY", "NOT_RUN", "UPCOMING", "NOT_NEEDED"]) == 50.0
    assert adherence(["UPCOMING"]) is None
