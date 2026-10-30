"""Client round 28 Oct, floor round 3: old-form Final QC flags every sample; reversed card times never block."""
from datetime import date, datetime
from types import SimpleNamespace

from src.routers import entries, planning
from src.schemas.planning import StageOutputPayload

SPEC = {"od_min_mm": 81.0, "od_max_mm": 81.0, "id_min_mm": 76.0, "id_max_mm": 76.2}


def test_out_of_band_reading_in_the_second_sample_is_flagged():
    good = {"od": 81.0, "id": 76.1}
    checks = {**good, "sample_id": "FQ-1", "samples": [{"sample_id": "FQ-1", "readings": good}, {"sample_id": "FQ-2", "readings": {**good, "od": 86.0}}]}
    failures = planning._final_qc_sample_failures(SPEC, checks)
    assert [row["sample_id"] for row in failures] == ["FQ-2"]
    assert failures[0]["label"].endswith("(FQ-2)")


def test_all_samples_in_band_give_no_flag_and_top_level_is_used_without_samples():
    good = {"od": 81.0, "id": 76.1}
    assert planning._final_qc_sample_failures(SPEC, {**good, "samples": [{"sample_id": "FQ-1", "readings": good}, {"sample_id": "FQ-2", "readings": good}]}) == []
    single = planning._final_qc_sample_failures(SPEC, {"od": 90.0, "id": 76.1, "sample_id": "FQ-1"})
    assert len(single) == 1 and "(" not in single[0]["label"]


def test_old_form_payload_keeps_an_end_time_before_the_start_time():
    payload = StageOutputPayload(stage="WINDER", save_mode="draft", output_qty=5, start_time="2026-10-30T14:00:00", end_time="2026-10-30T09:00:00", shift_code="A")
    assert payload.end_time < payload.start_time
    _, warnings = planning._reconcile_card_times(
        stage="WINDER", save_mode="draft", card_start=payload.start_time, card_end=payload.end_time,
        now=datetime(2026, 10, 30, 15, 0), job_card_created_at=None, override_reason=None,
    )
    assert any("end time (B) is before start time (A)" in w for w in warnings)


def _entry(**details):
    return SimpleNamespace(kind="PRODUCTION", produced=10, accepted=10, input_quantity=0, cutting_loss_pcs=0, carry_in_pcs=0, carry_out_pcs=0, rejected=0,
                           samples=[], business_date=date(2026, 10, 30), shift_code="SHIFT_A", operator_id="op", stage="WINDER", details=dict(details))


def test_batch_entry_run_with_reversed_times_saves_with_a_flag():
    e = _entry(start_time="2026-10-30T14:00:00", end_time="2026-10-30T09:00:00")
    entries.validate_entry(e, None)
    assert e.details["time_reversed"]["message"].startswith("End time is before start time")
    e2 = _entry(start_time="2026-10-30T09:00:00", end_time="2026-10-30T14:00:00", time_reversed={"old": 1})
    entries.validate_entry(e2, None)
    assert "time_reversed" not in e2.details
