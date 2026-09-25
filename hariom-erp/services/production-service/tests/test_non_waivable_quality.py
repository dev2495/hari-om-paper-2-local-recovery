from types import SimpleNamespace
from unittest.mock import Mock
import uuid
import pytest
from fastapi import HTTPException
from src.quality_eval import evaluate_incoming, non_waivable_release_detail
from src.routers import quality, planning


def critical_evaluation(value=12, *, critical=True):
    return evaluate_incoming(profile={'status': 'approved', 'parameters': [
        {'code': 'gsm', 'label': 'GSM', 'unit': 'gsm', 'min': 90, 'max': 110,
         'non_waivable': critical, 'gating': 'advisory'},
    ]}, readings={'gsm': value}, reasons={'gsm': 'Investigating supplier lot'}).as_dict()


def test_critical_failure_is_blocking_even_when_advisory():
    ev = critical_evaluation()
    assert ev['verdict'] == 'FAIL'
    assert ev['gating'] == 'blocking'
    assert ev['frozen_rules'][0]['non_waivable'] is True
    assert ev['parameter_results'][0]['non_waivable'] is True
    assert non_waivable_release_detail(ev)['parameters'][0]['code'] == 'gsm'


@pytest.mark.parametrize('value', [None, 'unreadable', 12])
def test_critical_missing_invalid_or_failed_reading_cannot_be_waived(value):
    assert non_waivable_release_detail(critical_evaluation(value))['code'] == 'NON_WAIVABLE_QUALITY_CHECK'


def test_passing_critical_reading_does_not_block():
    assert non_waivable_release_detail(critical_evaluation(100)) is None


def test_ordinary_advisory_failure_retains_policy():
    ev = critical_evaluation(critical=False)
    assert ev['gating'] == 'advisory'
    assert non_waivable_release_detail(ev) is None


def test_frozen_critical_policy_overrules_result_flag_and_missing_result():
    ev = critical_evaluation()
    ev['parameter_results'][0]['non_waivable'] = False
    assert non_waivable_release_detail(ev)
    ev['parameter_results'] = []
    assert non_waivable_release_detail(ev)


def test_non_applicable_critical_rule_does_not_block():
    ev = critical_evaluation()
    ev['frozen_rules'][0]['applicable'] = False
    assert non_waivable_release_detail(ev) is None


def test_admin_cannot_release_critical_hold_or_mutate_stock():
    hold = SimpleNamespace(id=uuid.uuid4(), status='HOLD', source_inspection_id=uuid.uuid4())
    inspection = SimpleNamespace(status='FAIL', evaluation=critical_evaluation())
    db = Mock()
    db.query.return_value.filter.return_value.first.side_effect = [hold, inspection]
    with pytest.raises(HTTPException) as exc:
        quality.release_hold(hold.id, db=db, plant_id=str(uuid.uuid4()), current_user={'sub': 'admin', 'roles': ['Admin']})
    assert exc.value.status_code == 409
    assert exc.value.detail['code'] == 'NON_WAIVABLE_QUALITY_CHECK'
    assert hold.status == 'HOLD'
    db.commit.assert_not_called()
    db.add.assert_not_called()


def test_stage_override_reason_cannot_bypass_critical_hold():
    hold = SimpleNamespace(source_inspection_id=uuid.uuid4())
    db = Mock()
    db.query.return_value.filter.return_value.first.return_value = SimpleNamespace(evaluation=critical_evaluation())
    with pytest.raises(HTTPException) as exc:
        planning._enforce_non_waivable_hold_override(db, [hold])
    assert exc.value.detail['code'] == 'NON_WAIVABLE_QUALITY_CHECK'
    db.commit.assert_not_called()


@pytest.mark.parametrize('readings', [{}, {'height': 130}])
def test_admin_inline_stage_completion_cannot_skip_or_fail_critical_check(readings):
    job = SimpleNamespace(id=uuid.uuid4(), spec_snapshot={'qc_profile': {'stages': {'WINDER': {'parameters': [
        {'code': 'height', 'min': 118, 'max': 122, 'unit': 'mm', 'non_waivable': True},
    ]}}}})
    db = Mock()
    db.query.return_value.filter.return_value.filter.return_value.order_by.return_value.all.return_value = []
    with pytest.raises(HTTPException) as exc:
        planning._enforce_stage_quality_gate(db=db, plant_id=uuid.uuid4(), job_card=job,
            selected_stage='WINDER', quality_checks=readings, override_reason='Manager waiver', actor_role='Admin')
    assert exc.value.status_code == 409
    assert exc.value.detail['code'] == 'NON_WAIVABLE_QUALITY_CHECK'


def test_passing_inline_critical_measurement_allows_stage_completion():
    job = SimpleNamespace(id=uuid.uuid4(), spec_snapshot={'qc_profile': {'stages': {'WINDER': {'parameters': [
        {'code': 'height', 'min': 118, 'max': 122, 'unit': 'mm', 'non_waivable': True},
    ]}}}})
    planning._enforce_stage_quality_gate(db=Mock(), plant_id=uuid.uuid4(), job_card=job,
        selected_stage='WINDER', quality_checks={'height': 120}, override_reason=None, actor_role='Admin')


def test_critical_measurement_needing_calibration_is_not_releasable_without_it():
    ev = evaluate_incoming(profile={'status': 'approved', 'parameters': [
        {'code': 'height', 'min': 90, 'max': 110, 'non_waivable': True, 'requires_instrument': True},
    ]}, readings={'height': 100}).as_dict()
    assert ev['verdict'] == 'INVALID'
    assert non_waivable_release_detail(ev)['code'] == 'NON_WAIVABLE_QUALITY_CHECK'
