"""Client round 28 Oct, round 2 (floor): old-form (V1) checks flag, never stop the save."""
from datetime import datetime
from types import SimpleNamespace

from src.routers import planning


def _stage(stage_type, status="RUNNING", output_qty=None, actuals=None):
    return SimpleNamespace(stage_type=stage_type, status=status, output_qty=output_qty, actuals_snapshot=dict(actuals or {}))


def _flags(stage, payload, rows, final_qc_flags=None):
    return planning._old_form_stage_flags(
        stage=stage, selected_stage=stage.stage_type, payload=payload, all_stage_rows=rows,
        spec_snapshot={"pcs_per_bamboo": 10, "selected_bamboo_length_mm": 1560, "length_min_mm": 149.8, "length_max_mm": 150.2}, final_qc_flags=final_qc_flags, now=datetime(2026, 10, 30, 9, 0),
    )


def test_old_form_process_count_gap_is_flagged_on_the_stage():
    oven = _stage("OVEN", "COMPLETED", output_qty=12)
    process = _stage("PROCESS", actuals={"time_reconciliation": {"x": 1}})
    warnings = _flags(process, SimpleNamespace(input_qty=None, output_qty=116, scrap_qty=0), [oven, process])
    gap = process.actuals_snapshot["count_gap"]
    assert gap["possible"] == 120 and gap["counted"] == 116 and gap["gap"] == 4
    assert gap["message"].startswith("12 bamboo × 10 pcs = 120 pcs, but the card counts 116 pcs (116 good + 0 rejected). 4 pcs short.")
    assert warnings == [gap["message"]]
    assert process.actuals_snapshot["time_reconciliation"] == {"x": 1}


def test_old_form_process_that_balances_has_no_flag_and_an_old_flag_is_cleared():
    oven = _stage("OVEN", "COMPLETED", output_qty=12)
    process = _stage("PROCESS", actuals={"count_gap": {"gap": 4}})
    assert _flags(process, SimpleNamespace(input_qty=None, output_qty=110, scrap_qty=10), [oven, process]) == []
    assert "count_gap" not in process.actuals_snapshot


def test_old_form_final_qc_out_of_band_is_a_flag_in_words():
    qc = _stage("QC")
    warnings = _flags(qc, SimpleNamespace(input_qty=None, output_qty=100, scrap_qty=0), [qc], final_qc_flags=[{"label": "OD"}, {"parameter": "weight"}])
    assert qc.actuals_snapshot["qc_flag"]["parameters"] == ["OD", "weight"]
    assert warnings == ["Final QC out of band: OD, weight. Saved and flagged, not held."]
