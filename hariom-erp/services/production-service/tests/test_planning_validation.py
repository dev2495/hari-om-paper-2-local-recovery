import unittest
from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID
from fastapi import HTTPException
from pydantic import ValidationError

from src.routers.planning import (
    _apply_fg_inward_snapshot,
    _bucket_entries,
    _next_stage,
    _next_sequence_for_bucket,
    _normalize_stage,
    _planner_gate_context,
    _place_queue_entry,
    _quality_failures_for_stage,
    _routing_stages_from_snapshot,
    _validate_machine_compatibility,
    preflight_sales_order_release,
)
from src.schemas.planning import AssignMachinePayload, ReleasePreflightPayload, SalesOrderCreate, StageOutputPayload


def _snapshot():
    return {
        "id_min_mm": 50,
        "id_max_mm": 55,
        "od_min_mm": 100,
        "od_max_mm": 110,
        "length_min_mm": 145,
        "length_max_mm": 155,
        "mandrel_id": "00000000-0000-0000-0000-00000000m001".replace("m", "0"),
    }


def _machine():
    return {
        "plant_id": "00000000-0000-0000-0000-0000000000a1",
        "is_active": True,
        "department": "WINDER",
        "id_min_mm": 45,
        "id_max_mm": 65,
        "od_min_mm": 90,
        "od_max_mm": 130,
        "length_min_mm": 120,
        "length_max_mm": 200,
    }


class _FakeQuery:
    def __init__(self, scalar_value=0):
        self.scalar_value = scalar_value
        self.filters = []

    def filter(self, *conditions):
        self.filters.extend(str(condition) for condition in conditions)
        return self

    def order_by(self, *_args):
        return self

    def all(self):
        return []

    def scalar(self):
        return self.scalar_value


class _FakeSession:
    def __init__(self, scalar_value=0):
        self.scalar_value = scalar_value
        self.queries = []

    def query(self, *_args):
        query = _FakeQuery(scalar_value=self.scalar_value)
        self.queries.append(query)
        return query


class PlanningValidationTests(unittest.TestCase):
    @patch("src.routers.planning._fetch_spec")
    @patch("src.routers.planning._fetch_stage_machines")
    @patch("src.routers.planning._fetch_sales_order")
    def test_release_preflight_returns_only_compatible_winders(self, fetch_order, fetch_machines, fetch_spec):
        order_id = UUID("00000000-0000-0000-0000-000000000701")
        line_id = UUID("00000000-0000-0000-0000-000000000702")
        compatible = {**_machine(), "id": "00000000-0000-0000-0000-000000000703", "code": "W-OK", "status": "UP"}
        incompatible = {**_machine(), "id": "00000000-0000-0000-0000-000000000704", "code": "W-SHORT", "status": "UP", "length_max_mm": 140}
        fetch_order.return_value = {
            "id": str(order_id),
            "status": "approved",
            "priority": "NORMAL",
            "lines": [{
                "id": str(line_id),
                "line_no": 1,
                "approved_spec_id": "00000000-0000-0000-0000-000000000705",
                "release_remaining_qty": 100,
                "release_lots": [],
            }],
        }
        fetch_machines.return_value = [incompatible, compatible]
        fetch_spec.return_value = {**_snapshot(), "id": "00000000-0000-0000-0000-000000000705", "status": "approved", "active": True}
        payload = ReleasePreflightPayload(release_rows=[{
            "sales_order_line_id": str(line_id),
            "release_qty": 25,
            "winder_machine_id": compatible["id"],
        }])

        result = preflight_sales_order_release(
            order_id,
            payload,
            plant_id="00000000-0000-0000-0000-0000000000a1",
            current_user={"token": "test"},
        )

        self.assertTrue(result.ready)
        self.assertEqual([row["code"] for row in result.line_results[0].compatible_winders], ["W-OK"])
        self.assertTrue(result.line_results[0].selected_winder_compatible)

    @patch("src.routers.planning._fetch_spec")
    @patch("src.routers.planning._fetch_stage_machines")
    @patch("src.routers.planning._fetch_sales_order")
    def test_release_preflight_blocks_incompatible_selected_winder(self, fetch_order, fetch_machines, fetch_spec):
        order_id = UUID("00000000-0000-0000-0000-000000000711")
        line_id = UUID("00000000-0000-0000-0000-000000000712")
        incompatible = {**_machine(), "id": "00000000-0000-0000-0000-000000000713", "code": "W-SHORT", "status": "UP", "length_max_mm": 140}
        fetch_order.return_value = {
            "id": str(order_id),
            "status": "released",
            "priority": "NORMAL",
            "lines": [{
                "id": str(line_id),
                "line_no": 4,
                "approved_spec_id": "00000000-0000-0000-0000-000000000715",
                "release_remaining_qty": 50,
                "release_lots": [],
            }],
        }
        fetch_machines.return_value = [incompatible]
        fetch_spec.return_value = {**_snapshot(), "id": "00000000-0000-0000-0000-000000000715", "status": "approved", "active": True}
        payload = ReleasePreflightPayload(release_rows=[{
            "sales_order_line_id": str(line_id),
            "release_qty": 20,
            "winder_machine_id": incompatible["id"],
        }])

        result = preflight_sales_order_release(
            order_id,
            payload,
            plant_id="00000000-0000-0000-0000-0000000000a1",
            current_user={"token": "test"},
        )

        self.assertFalse(result.ready)
        self.assertEqual(result.line_results[0].compatible_winders, [])
        self.assertIn("no active winder", str(result.line_results[0].blocker).lower())

    def test_planner_gate_context_blocks_unscheduled_stage(self):
        context = _planner_gate_context(
            current_stage="WINDER",
            active_stage=SimpleNamespace(machine_id=None, shift_code=None, plan_date=None),
            active_segment=None,
            today=date(2026, 4, 18),
        )

        self.assertFalse(context["planner_gate_ready"])
        self.assertIn("schedule", context["planner_gate_reason"].lower())
        self.assertIsNone(context["active_segment_plan_date"])
        self.assertIsNone(context["active_segment_machine_id"])

    def test_planner_gate_context_blocks_segment_outside_next_three_days(self):
        context = _planner_gate_context(
            current_stage="WINDER",
            active_stage=SimpleNamespace(
                machine_id="00000000-0000-0000-0000-00000000a101",
                shift_code="SHIFT_A",
                plan_date=date(2026, 4, 23),
            ),
            active_segment=SimpleNamespace(
                machine_id="00000000-0000-0000-0000-00000000a101",
                shift_code="SHIFT_A",
                plan_date=date(2026, 4, 23),
                status="PLANNED",
            ),
            today=date(2026, 4, 18),
        )

        self.assertFalse(context["planner_gate_ready"])
        self.assertIn("next 3 days", context["planner_gate_reason"].lower())
        self.assertEqual(context["active_segment_plan_date"], date(2026, 4, 23))

    def test_planner_gate_context_allows_scheduled_stage_within_next_three_days(self):
        context = _planner_gate_context(
            current_stage="WINDER",
            active_stage=SimpleNamespace(
                machine_id="00000000-0000-0000-0000-00000000a101",
                shift_code="SHIFT_B",
                plan_date=date(2026, 4, 19),
            ),
            active_segment=SimpleNamespace(
                machine_id="00000000-0000-0000-0000-00000000a101",
                shift_code="SHIFT_B",
                plan_date=date(2026, 4, 19),
                status="PLANNED",
            ),
            today=date(2026, 4, 18),
        )

        self.assertTrue(context["planner_gate_ready"])
        self.assertIsNone(context["planner_gate_reason"])
        self.assertEqual(context["active_segment_plan_date"], date(2026, 4, 19))
        self.assertEqual(context["active_segment_machine_id"], "00000000-0000-0000-0000-00000000a101")

    def test_planner_gate_context_allows_done_stage(self):
        context = _planner_gate_context(
            current_stage="DONE",
            active_stage=None,
            active_segment=None,
            today=date(2026, 4, 18),
        )

        self.assertTrue(context["planner_gate_ready"])
        self.assertIsNone(context["planner_gate_reason"])

    def test_apply_fg_inward_snapshot_updates_packing_record_snapshot(self):
        class _PackingRecord:
            def __init__(self):
                self.snapshot = {"fg_batch_no": "FG-TEST-1"}

        packing_record = _PackingRecord()
        _apply_fg_inward_snapshot(
            packing_record,
            {
                "batch_id": "batch-1",
                "transaction_id": "txn-1",
                "stock_status": "UNRESTRICTED",
            },
        )

        self.assertEqual(packing_record.snapshot["fg_batch_no"], "FG-TEST-1")
        self.assertEqual(packing_record.snapshot["inventory_batch_id"], "batch-1")
        self.assertEqual(packing_record.snapshot["inventory_transaction_id"], "txn-1")
        self.assertEqual(packing_record.snapshot["inventory_stock_status"], "UNRESTRICTED")

    def test_apply_fg_inward_snapshot_is_noop_without_result(self):
        class _PackingRecord:
            def __init__(self):
                self.snapshot = {"fg_batch_no": "FG-TEST-2"}

        packing_record = _PackingRecord()
        _apply_fg_inward_snapshot(packing_record, None)

        self.assertEqual(packing_record.snapshot, {"fg_batch_no": "FG-TEST-2"})

    def test_normalize_stage_accepts_value(self):
        self.assertEqual(_normalize_stage("winder"), "WINDER")
        self.assertEqual(_normalize_stage("slitting"), "SLITTING")

    def test_normalize_stage_rejects_invalid(self):
        with self.assertRaises(HTTPException) as exc:
            _normalize_stage("unknown")
        self.assertEqual(exc.exception.status_code, 400)

    def test_next_stage_progression(self):
        self.assertEqual(_next_stage("SLITTING"), "WINDER")
        self.assertEqual(_next_stage("WINDER"), "OVEN")
        self.assertEqual(_next_stage("OVEN"), "PROCESS")
        self.assertEqual(_next_stage("PROCESS"), "PACKING")
        self.assertEqual(_next_stage("PACKING"), "QC")
        self.assertEqual(_next_stage("QC"), "DISPATCH")
        self.assertEqual(_next_stage("DISPATCH"), "DONE")

    def test_routing_stages_skip_optional_slitting_when_not_required(self):
        self.assertEqual(
            _routing_stages_from_snapshot({"requires_slitting": False}),
            ["WINDER", "OVEN", "PROCESS", "PACKING", "QC", "DISPATCH"],
        )
        self.assertEqual(_routing_stages_from_snapshot({"requires_slitting": True})[0], "SLITTING")

    def test_sales_order_priority_validation(self):
        payload = SalesOrderCreate(
            customer_id="00000000-0000-0000-0000-00000000c0a1",
            spec_id="00000000-0000-0000-0000-0000000050a1",
            order_qty=10,
            due_date="2026-03-01",
            priority="high",
        )
        self.assertEqual(payload.priority, "HIGH")

    def test_assign_machine_window_validation(self):
        with self.assertRaises(ValidationError):
            AssignMachinePayload(
                machine_id="00000000-0000-0000-0000-00000000a101",
                sequence_no=1,
                planned_start="2026-03-01T10:00:00",
                planned_end="2026-03-01T09:00:00",
            )

    def test_assign_machine_stage_validation(self):
        payload = AssignMachinePayload(stage="oven", machine_id="00000000-0000-0000-0000-00000000a101", sequence_no=1)
        self.assertEqual(payload.stage, "OVEN")
        with self.assertRaises(ValidationError):
            AssignMachinePayload(stage="unknown", sequence_no=1)

    def test_machine_department_mismatch_rejected(self):
        machine = _machine()
        machine["department"] = "OVEN"
        with self.assertRaises(HTTPException) as exc:
            _validate_machine_compatibility(
                machine,
                "WINDER",
                _snapshot(),
                "00000000-0000-0000-0000-0000000000a1",
            )
        self.assertEqual(exc.exception.status_code, 400)

    def test_machine_dimension_mismatch_rejected(self):
        machine = _machine()
        machine["id_max_mm"] = 52
        with self.assertRaises(HTTPException) as exc:
            _validate_machine_compatibility(
                machine,
                "WINDER",
                _snapshot(),
                "00000000-0000-0000-0000-0000000000a1",
            )
        self.assertEqual(exc.exception.status_code, 400)

    def test_machine_under_maintenance_is_rejected(self):
        machine = _machine()
        machine["status"] = "MAINT"
        with self.assertRaises(HTTPException) as exc:
            _validate_machine_compatibility(
                machine,
                "WINDER",
                _snapshot(),
                "00000000-0000-0000-0000-0000000000a1",
            )
        self.assertEqual(exc.exception.status_code, 400)
        self.assertIn("MAINT", str(exc.exception.detail))

    def test_packing_machine_compatibility_is_noop(self):
        machine = _machine()
        machine["department"] = "PACKING"
        _validate_machine_compatibility(machine, "PACKING", _snapshot(), "00000000-0000-0000-0000-0000000000a1")

    def test_machine_supported_mandrel_rejected_when_snapshot_mandrel_missing(self):
        machine = _machine()
        machine["supported_mandrel_ids"] = ["00000000-0000-0000-0000-000000000111"]
        with self.assertRaises(HTTPException) as exc:
            _validate_machine_compatibility(
                machine,
                "WINDER",
                _snapshot(),
                "00000000-0000-0000-0000-0000000000a1",
            )
        self.assertEqual(exc.exception.status_code, 400)

    def test_stage_output_stage_validation(self):
        payload = StageOutputPayload(stage="process", output_qty=10, scrap_qty=1)
        self.assertEqual(payload.stage, "PROCESS")
        with self.assertRaises(ValidationError):
            StageOutputPayload(stage="unknown", output_qty=10)

    def test_stage_output_reel_issue_ids_accept_uuid_list(self):
        payload = StageOutputPayload(
            stage="winder",
            output_qty=10,
            reel_issue_ids=["00000000-0000-0000-0000-00000000e701"],
        )
        self.assertEqual(len(payload.reel_issue_ids), 1)
        self.assertEqual(str(payload.reel_issue_ids[0]), "00000000-0000-0000-0000-00000000e701")

    def test_stage_output_reel_issue_ids_reject_invalid_uuid(self):
        with self.assertRaises(ValidationError):
            StageOutputPayload(output_qty=10, reel_issue_ids=["invalid-uuid"])

    def test_quality_failures_detect_out_of_range_oven_moisture(self):
        failures = _quality_failures_for_stage(
            "OVEN",
            {"moisture_min_pct": 5, "moisture_max_pct": 7},
            {"moisture_after": 9},
        )
        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0]["label"], "Moisture")

    def test_unassigned_queue_sequence_ignores_plan_date_and_shift_filters(self):
        db = _FakeSession(scalar_value=4)

        next_sequence = _next_sequence_for_bucket(
            db=db,
            plant_id="00000000-0000-0000-0000-0000000000a1",
            stage="WINDER",
            machine_id=None,
            plan_date=date(2026, 3, 15),
            shift_code="SHIFT_A",
        )
        _bucket_entries(
            db=db,
            plant_id="00000000-0000-0000-0000-0000000000a1",
            stage="WINDER",
            machine_id=None,
            plan_date=date(2026, 3, 15),
            shift_code="SHIFT_A",
        )

        self.assertEqual(next_sequence, 5)
        joined_filters = " ".join(" ".join(query.filters) for query in db.queries)
        self.assertIn("machine_id IS NULL", joined_filters)
        self.assertNotIn("plan_date", joined_filters)
        self.assertNotIn("shift_code", joined_filters)

    def test_machine_queue_sequence_ignores_plan_date_and_shift_filters(self):
        db = _FakeSession(scalar_value=2)

        next_sequence = _next_sequence_for_bucket(
            db=db,
            plant_id="00000000-0000-0000-0000-0000000000a1",
            stage="WINDER",
            machine_id="00000000-0000-0000-0000-00000000a101",
            plan_date=date(2026, 3, 15),
            shift_code="SHIFT_B",
        )
        _bucket_entries(
            db=db,
            plant_id="00000000-0000-0000-0000-0000000000a1",
            stage="WINDER",
            machine_id="00000000-0000-0000-0000-00000000a101",
            plan_date=date(2026, 3, 15),
            shift_code="SHIFT_B",
        )

        self.assertEqual(next_sequence, 3)
        joined_filters = " ".join(" ".join(query.filters) for query in db.queries)
        self.assertIn("machine_id", joined_filters)
        self.assertNotIn("plan_date", joined_filters)
        self.assertNotIn("shift_code", joined_filters)

    def test_place_queue_entry_detaches_row_before_resequencing_old_machine_bucket(self):
        old_machine = UUID("00000000-0000-0000-0000-00000000a001")
        new_machine = UUID("00000000-0000-0000-0000-00000000a002")
        entry = SimpleNamespace(
            id=UUID("00000000-0000-0000-0000-00000000b001"),
            plant_id=UUID("00000000-0000-0000-0000-0000000000a1"),
            stage_type="WINDER",
            machine_id=old_machine,
            plan_date=date(2026, 3, 15),
            shift_code="SHIFT_A",
            sequence_no=1,
        )
        old_bucket_peer = SimpleNamespace(id=UUID("00000000-0000-0000-0000-00000000b002"), sequence_no=2)
        target_bucket_peer = SimpleNamespace(id=UUID("00000000-0000-0000-0000-00000000b003"), sequence_no=1)

        class _DB:
            def __init__(self):
                self.flush_calls = 0

            def flush(self):
                self.flush_calls += 1

        db = _DB()
        resequence_calls: list[list[UUID]] = []

        def fake_bucket_entries(*, machine_id, **_kwargs):
            if machine_id == old_machine:
                return [old_bucket_peer]
            if machine_id == new_machine:
                return [target_bucket_peer]
            return []

        def fake_resequence(_db, entries):
            resequence_calls.append([row.id for row in entries])
            if entries == [old_bucket_peer]:
                self.assertEqual(entry.machine_id, new_machine)
                self.assertEqual(entry.sequence_no, 1_000_002)

        with patch("src.routers.planning._bucket_entries", side_effect=fake_bucket_entries):
            with patch("src.routers.planning._resequence_entries", side_effect=fake_resequence):
                with patch("src.routers.planning._temporary_sequence_for_bucket", return_value=1_000_002):
                    _place_queue_entry(
                        db=db,
                        entry=entry,
                        desired_sequence=1,
                        machine_id=new_machine,
                        plan_date=date(2026, 3, 20),
                        shift_code="SHIFT_B",
                    )

        self.assertEqual(db.flush_calls, 1)
        self.assertEqual(entry.machine_id, new_machine)
        self.assertEqual(entry.plan_date, date(2026, 3, 20))
        self.assertEqual(entry.shift_code, "SHIFT_B")
        self.assertEqual(resequence_calls[0], [old_bucket_peer.id])
        self.assertEqual(resequence_calls[1], [entry.id, target_bucket_peer.id])

if __name__ == "__main__":
    unittest.main()
