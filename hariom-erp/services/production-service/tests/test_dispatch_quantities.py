from types import SimpleNamespace
import pytest

from src.dispatch_quantities import dispatchable_quantity, shipping_allowance, qc_excluded_quantities


def test_legacy_dispatch_keeps_packed_quantity_without_new_qc_requirement():
    job = SimpleNamespace(spec_snapshot={}, released_qty=50, planned_qty=50)
    packing = SimpleNamespace(total_packed_qty=60)
    assert dispatchable_quantity(job, packing, None) == 60
    assert shipping_allowance(job, 60, None) == 60


@pytest.mark.parametrize("qc, expected", [
    (None, 0),
    (SimpleNamespace(status="QUEUED", output_qty=45), 0),
    (SimpleNamespace(status="COMPLETED", output_qty=40), 40),
    (SimpleNamespace(status="COMPLETED", output_qty=60), 45),
])
def test_v2_stock_quantity_requires_closed_qc_and_never_exceeds_gross(qc, expected):
    job = SimpleNamespace(spec_snapshot={"entry_model": "V2"})
    assert dispatchable_quantity(job, SimpleNamespace(total_packed_qty=45), qc) == expected


def test_commercial_allowance_obeys_release_and_effective_short_close_target():
    job = SimpleNamespace(spec_snapshot={"entry_model": "V2"}, released_qty=50, planned_qty=100)
    assert shipping_allowance(job, 60, None) == 50
    assert shipping_allowance(job, 40, None) == 40
    assert shipping_allowance(job, 60, SimpleNamespace(actuals_snapshot={"effective_target": 45})) == 45
    job.released_qty = 0
    assert shipping_allowance(job, 120, None) == 100


@pytest.mark.parametrize("snapshot, scrap, rejected, uninspected", [
    ({"produced_total": 45, "rejected_total": 5}, 5, 5, 5),
    ({"produced_total": 45}, 5, 5, 5),
    ({"rejected_total": 0, "produced_total": 40}, 0, 0, 10),
    ({}, 0, 10, 0),
])
def test_qc_exclusions_distinguish_actual_rejects_from_residual_input(snapshot, scrap, rejected, uninspected):
    job = SimpleNamespace(spec_snapshot={"entry_model": "V2"})
    packing = SimpleNamespace(total_packed_qty=50)
    qc = SimpleNamespace(status="COMPLETED", output_qty=40, scrap_qty=scrap, actuals_snapshot=snapshot)
    assert qc_excluded_quantities(job, packing, qc) == {"qc_rejected_qty": rejected, "qc_uninspected_qty": uninspected}


def test_zero_acceptance_can_be_entirely_uninspected_input_without_false_rejects():
    job = SimpleNamespace(spec_snapshot={"entry_model": "V2"})
    qc = SimpleNamespace(status="COMPLETED", output_qty=0, scrap_qty=0, actuals_snapshot={"produced_total": 0, "rejected_total": 0})
    assert qc_excluded_quantities(job, SimpleNamespace(total_packed_qty=50), qc) == {"qc_rejected_qty": 0, "qc_uninspected_qty": 50}


def test_qc_exclusions_do_not_count_pending_qc_input_as_rejected():
    job = SimpleNamespace(spec_snapshot={"entry_model": "V2"})
    qc = SimpleNamespace(status="QUEUED", output_qty=None)
    assert qc_excluded_quantities(job, SimpleNamespace(total_packed_qty=50), qc) == {"qc_rejected_qty": 0, "qc_uninspected_qty": 0}
