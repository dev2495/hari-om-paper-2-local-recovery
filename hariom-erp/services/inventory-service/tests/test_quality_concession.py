import unittest

from fastapi import HTTPException

from src.routers.quality import (
    measured_inspection_status,
    reject_fail_accept_shortcut,
    require_concession_authority,
    stock_status_for_disposition,
)


class QualityConcessionPolicyTests(unittest.TestCase):
    def test_failures_force_measured_fail_even_if_client_sends_pass(self):
        status = measured_inspection_status(
            supplied_status="PASS",
            failures=[{"label": "GSM", "value": 1}],
        )
        self.assertEqual(status, "FAIL")

    def test_fail_accept_shortcut_is_rejected(self):
        with self.assertRaises(HTTPException) as caught:
            reject_fail_accept_shortcut("FAIL", "ACCEPT")
        self.assertEqual(caught.exception.status_code, 403)

    def test_fail_block_containment_is_allowed(self):
        reject_fail_accept_shortcut("FAIL", "BLOCK")
        self.assertEqual(stock_status_for_disposition("BLOCK"), "BLOCKED")

    def test_pass_accept_still_unrestricts(self):
        reject_fail_accept_shortcut("PASS", "ACCEPT")
        self.assertEqual(stock_status_for_disposition("ACCEPT"), "UNRESTRICTED")

    def test_qc_inspector_cannot_approve_concession(self):
        with self.assertRaises(HTTPException) as caught:
            require_concession_authority(
                {"sub": "qc@hariom.com", "roles": ["QC"], "permissions": ["qc:inspect"]},
                inspector_id="other@hariom.com",
            )
        self.assertEqual(caught.exception.status_code, 403)

    def test_second_person_required_even_for_owner(self):
        with self.assertRaises(HTTPException) as caught:
            require_concession_authority(
                {"sub": "owner@hariom.com", "roles": ["Owner"], "permissions": ["qc:disposition:approve"]},
                inspector_id="owner@hariom.com",
            )
        self.assertEqual(caught.exception.status_code, 403)

    def test_owner_can_approve_another_inspectors_fail(self):
        require_concession_authority(
            {"sub": "owner@hariom.com", "roles": ["Owner"], "permissions": ["qc:disposition:approve"]},
            inspector_id="qc@hariom.com",
        )


if __name__ == "__main__":
    unittest.main()


def test_critical_inspection_cannot_receive_admin_concession():
    from types import SimpleNamespace
    from unittest.mock import Mock
    import uuid
    import pytest
    from src.routers.quality import create_quality_concession, QualityConcessionCreate
    inspection = SimpleNamespace(id=uuid.uuid4(), status='FAIL', created_by='inspector', evaluation={
        'frozen_rules': [{'code': 'gsm', 'non_waivable': True}],
        'parameter_results': [{'code': 'gsm', 'verdict': 'FAIL'}],
    })
    db = Mock()
    db.query.return_value.filter.return_value.first.return_value = inspection
    payload = QualityConcessionCreate(inspection_id=inspection.id, reason='Admin accepts this lot', quantity=10)
    with pytest.raises(HTTPException) as exc:
        create_quality_concession(payload, db=db, plant_id=str(uuid.uuid4()), current_user={
            'sub': 'admin', 'roles': ['Admin'], 'permissions': ['qc:disposition:approve'],
        })
    assert exc.value.status_code == 409
    assert exc.value.detail['code'] == 'NON_WAIVABLE_QUALITY_CHECK'
    db.add.assert_not_called()
    db.commit.assert_not_called()


def test_profile_critical_policy_requires_boolean_and_survives_approval():
    import pytest
    from src.quality_profile_lifecycle import apply_profile_save, apply_profile_approve, ProfileLifecycleError
    with pytest.raises(ProfileLifecycleError):
        apply_profile_save(None, {'parameters': [{'code': 'gsm', 'non_waivable': 'false'}]})
    draft = apply_profile_save(None, {'parameters': [{'code': 'gsm', 'non_waivable': True}]})
    approved = apply_profile_approve(draft, expected_revision=1, actor='owner', actor_roles=['Owner'])
    assert approved['approved_snapshot']['parameters'][0]['non_waivable'] is True
    edited = apply_profile_save(approved, {'parameters': [{'code': 'gsm', 'non_waivable': False}]})
    assert edited['approved_snapshot']['parameters'][0]['non_waivable'] is True


def test_draft_cannot_forge_or_erase_approved_snapshot():
    from src.quality_profile_lifecycle import apply_profile_save
    forged = {'status': 'approved', 'parameters': [{'code': 'gsm', 'non_waivable': False}]}
    saved = apply_profile_save(None, {'parameters': [], 'approved_snapshot': forged})
    assert 'approved_snapshot' not in saved
    frozen = {'status': 'approved', 'revision': 1, 'parameters': [{'code': 'gsm', 'non_waivable': True}]}
    saved = apply_profile_save({'status': 'draft', 'revision': 2, 'approved_snapshot': frozen}, {'parameters': [], 'approved_snapshot': forged})
    assert saved['approved_snapshot'] == frozen
