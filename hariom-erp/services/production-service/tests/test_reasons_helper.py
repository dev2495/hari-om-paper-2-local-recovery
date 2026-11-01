"""Shared reason-code helper (owner decision 4, 1 Nov 2026): every service checks codes with master data."""
import unittest
from unittest import mock

import httpx
from fastapi import HTTPException

from src import reasons


def _resp(status, body):
    return httpx.Response(status, json=body, request=httpx.Request("POST", "http://master/validate"))


class ResolveReasonTests(unittest.TestCase):
    def test_free_text_only_is_refused_when_a_code_is_required(self):
        with self.assertRaises(HTTPException) as caught:
            reasons.resolve_reason(category="QC_HOLD", code="", note="bent tubes", what="the hold")
        self.assertEqual(caught.exception.status_code, 422)
        self.assertIn("Choose a reason for the hold", caught.exception.detail)

    def test_optional_reason_may_be_left_out(self):
        self.assertIsNone(reasons.resolve_reason(category="QC_HOLD", code=None, required=False))

    def test_other_needs_a_note_before_any_call(self):
        with mock.patch.object(reasons.httpx, "post") as post:
            with self.assertRaises(HTTPException) as caught:
                reasons.resolve_reason(category="QC_HOLD", code="qh-other", note="abc")
        post.assert_not_called()
        self.assertIn("at least 5", caught.exception.detail)

    def test_valid_choice_sends_plant_and_returns_label_and_legacy_text(self):
        body = {"code": "QH-SUSPECT", "label": "Suspected quality problem", "note": "edge damage"}
        with mock.patch.object(reasons.httpx, "post", return_value=_resp(200, body)) as post:
            got = reasons.resolve_reason(category="qc_hold", code="qh-suspect", note=" edge damage ", plant_id="P1", token="t")
        sent = post.call_args.kwargs
        self.assertEqual(sent["json"]["category"], "QC_HOLD")
        self.assertEqual(sent["json"]["plant_id"], "P1")
        self.assertEqual(sent["headers"]["X-Plant-ID"], "P1")
        self.assertEqual(sent["headers"]["Authorization"], "Bearer t")
        self.assertEqual(got.code, "QH-SUSPECT")
        self.assertEqual(got.text, "Suspected quality problem — edge damage")
        self.assertEqual(got.as_dict()["reason_label"], "Suspected quality problem")

    def test_master_refusal_is_passed_on(self):
        with mock.patch.object(reasons.httpx, "post", return_value=_resp(422, {"detail": "QH-OLD is switched off"})):
            with self.assertRaises(HTTPException) as caught:
                reasons.resolve_reason(category="QC_HOLD", code="QH-OLD")
        self.assertEqual(caught.exception.status_code, 422)
        self.assertIn("switched off", caught.exception.detail)

    def test_master_down_is_a_retry(self):
        with mock.patch.object(reasons.httpx, "post", side_effect=httpx.ConnectError("down")):
            with self.assertRaises(HTTPException) as caught:
                reasons.resolve_reason(category="QC_HOLD", code="QH-SUSPECT")
        self.assertEqual(caught.exception.status_code, 503)

    def test_reason_input_reads_dicts_models_and_old_note_name(self):
        self.assertEqual(reasons.reason_input({"reason_code": " qh-other ", "note": " x y z "}), ("QH-OTHER", "x y z"))

        class Body:
            reason_code = "DT-POWER"
            reason_note = None
            note = ""

        self.assertEqual(reasons.reason_input(Body()), ("DT-POWER", None))


if __name__ == "__main__":
    unittest.main()
