import unittest
from types import SimpleNamespace
import uuid

from fastapi import HTTPException

from src.routers import planning, quality


PLANT_ID = uuid.UUID("00000000-0000-0000-0000-0000000000a1")


def _spec_snapshot():
    return {
        "id_min_mm": 50,
        "id_max_mm": 55,
        "od_min_mm": 100,
        "od_max_mm": 110,
        "length_min_mm": 145,
        "length_max_mm": 155,
        "weight_min_g": 300,
        "weight_max_g": 340,
        "cs_min_n": 450,
        "cs_max_n": 550,
    }


def _full_spec_readings():
    return {
        "id": 52,
        "od": 105,
        "length": 150,
        "weight": 320,
        "cs": 500,
    }


class _InspectionQuery:
    def __init__(self, rows):
        self.rows = rows

    def filter(self, *_conditions):
        return self

    def order_by(self, *_conditions):
        return self

    def all(self):
        return self.rows


class _InspectionSession:
    def __init__(self, rows):
        self.rows = rows

    def query(self, *_models):
        return _InspectionQuery(self.rows)


class QualityEnforcementTests(unittest.TestCase):
    def _gate(self):
        gate = getattr(planning, "_enforce_stage_quality_gate", None)
        self.assertIsNotNone(gate, "_enforce_stage_quality_gate must enforce QC before completion")
        return gate

    def test_quality_router_accepts_final_qc_stage(self):
        self.assertEqual(quality._normalize_stage("qc"), "QC")

    def test_quality_router_checks_full_spec_ranges_for_final_qc(self):
        failures = quality._check_failures(
            "QC",
            _spec_snapshot(),
            {**_full_spec_readings(), "od": 120},
        )

        self.assertEqual([failure["label"] for failure in failures], ["OD"])

    def test_planning_checks_full_spec_ranges_for_final_qc(self):
        failures = planning._quality_failures_for_stage(
            "QC",
            _spec_snapshot(),
            {**_full_spec_readings(), "weight": 360},
        )

        self.assertEqual([failure["label"] for failure in failures], ["Weight"])

    def test_process_stage_completion_requires_qc_inspection_or_override(self):
        job_card = SimpleNamespace(id=uuid.uuid4(), spec_snapshot=_spec_snapshot())

        with self.assertRaises(HTTPException) as exc:
            self._gate()(
                db=_InspectionSession([]),
                plant_id=PLANT_ID,
                job_card=job_card,
                selected_stage="WINDER",
                quality_checks={},
                override_reason=None,
            )

        self.assertEqual(exc.exception.status_code, 409)
        self.assertIn("QC inspection", exc.exception.detail)

    def test_process_stage_completion_accepts_existing_qc_inspection(self):
        job_card = SimpleNamespace(id=uuid.uuid4(), spec_snapshot=_spec_snapshot())
        inspection = SimpleNamespace(stage_type="WINDER", status="PASS", readings={})

        self._gate()(
            db=_InspectionSession([inspection]),
            plant_id=PLANT_ID,
            job_card=job_card,
            selected_stage="WINDER",
            quality_checks={},
            override_reason=None,
        )

    def test_process_stage_completion_accepts_explicit_override(self):
        job_card = SimpleNamespace(id=uuid.uuid4(), spec_snapshot=_spec_snapshot())

        self._gate()(
            db=_InspectionSession([]),
            plant_id=PLANT_ID,
            job_card=job_card,
            selected_stage="WINDER",
            quality_checks={},
            override_reason="QC bench offline; PlantManager approved manual release.",
        )

    def test_final_qc_requires_full_spec_measurements(self):
        job_card = SimpleNamespace(id=uuid.uuid4(), spec_snapshot=_spec_snapshot())

        with self.assertRaises(HTTPException) as exc:
            self._gate()(
                db=_InspectionSession([]),
                plant_id=PLANT_ID,
                job_card=job_card,
                selected_stage="QC",
                quality_checks={"id": 52, "od": 105},
                override_reason=None,
            )

        self.assertEqual(exc.exception.status_code, 400)
        detail = exc.exception.detail.lower()
        self.assertIn("length", detail)
        self.assertIn("weight", detail)
        self.assertIn("cs", detail)

    def test_final_qc_accepts_existing_full_spec_inspection(self):
        job_card = SimpleNamespace(id=uuid.uuid4(), spec_snapshot=_spec_snapshot())
        inspection = SimpleNamespace(stage_type="QC", status="PASS", readings=_full_spec_readings())

        self._gate()(
            db=_InspectionSession([inspection]),
            plant_id=PLANT_ID,
            job_card=job_card,
            selected_stage="QC",
            quality_checks={},
            override_reason=None,
        )

    def test_fg_inward_waits_for_final_qc_and_posts_after_qc_stage(self):
        post_gate = getattr(planning, "_stage_allows_fg_inward", None)
        self.assertIsNotNone(post_gate, "_stage_allows_fg_inward must guard FG handoff")

        self.assertFalse(post_gate(selected_stage="PACKING", final_qc_ready=False))
        self.assertTrue(post_gate(selected_stage="QC", final_qc_ready=True))


if __name__ == "__main__":
    unittest.main()
