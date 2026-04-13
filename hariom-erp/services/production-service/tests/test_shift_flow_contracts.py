import unittest
from types import SimpleNamespace
import uuid

from fastapi import HTTPException

from src.routers.planning import _build_carry_forward_suggestion, _validate_stage_completion_payload
from src.schemas.planning import StageOutputPayload


class ShiftFlowContractTests(unittest.TestCase):
    def test_carry_forward_suggestion_appears_for_short_completed_output(self):
        job_card = SimpleNamespace(
            id=uuid.uuid4(),
            planned_qty=100.0,
            sales_order_line_id=uuid.uuid4(),
            spec_snapshot={"parchment_color": "Blue"},
        )
        stages = [
            SimpleNamespace(stage_type="WINDER", status="COMPLETED", output_qty=80.0),
            SimpleNamespace(stage_type="OVEN", status="PLANNED", output_qty=None),
        ]

        suggestion = _build_carry_forward_suggestion(job_card, stages)
        self.assertTrue(suggestion["suggested"])
        self.assertEqual(suggestion["source_stage"], "WINDER")
        self.assertEqual(suggestion["remaining_qty"], 20.0)

    def test_oven_completion_blocks_missing_weight_fields(self):
        payload = StageOutputPayload(
            stage="OVEN",
            output_qty=95.0,
            entry_snapshot={
                "bamboo_count_in": 100,
                "pre_moisture": 12.0,
                "post_moisture": 7.0,
            },
        )
        stage = SimpleNamespace(entry_snapshot={}, actuals_snapshot={})

        with self.assertRaises(HTTPException) as exc:
            _validate_stage_completion_payload(
                selected_stage="OVEN",
                payload=payload,
                stage=stage,
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertIn("pre_weight", exc.exception.detail)
        self.assertIn("post_weight", exc.exception.detail)

    def test_slitting_completion_requires_parent_and_children(self):
        payload = StageOutputPayload(
            stage="SLITTING",
            output_qty=90.0,
            scrap_qty=2.0,
            entry_snapshot={},
        )
        stage = SimpleNamespace(entry_snapshot={}, actuals_snapshot={})

        with self.assertRaises(HTTPException) as exc:
            _validate_stage_completion_payload(
                selected_stage="SLITTING",
                payload=payload,
                stage=stage,
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertIn("parent_reel_id", exc.exception.detail)
        self.assertIn("child_reels", exc.exception.detail)


if __name__ == "__main__":
    unittest.main()
