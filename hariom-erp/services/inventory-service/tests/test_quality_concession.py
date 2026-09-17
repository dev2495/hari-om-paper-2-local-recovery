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
