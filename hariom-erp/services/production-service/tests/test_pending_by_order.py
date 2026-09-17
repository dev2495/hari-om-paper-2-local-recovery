from datetime import date
from types import SimpleNamespace
import unittest
import uuid

from src.pending_by_order import flow_status_for_order, summarize_job_cards_by_sales_order


class PendingByOrderTests(unittest.TestCase):
    def test_groups_job_cards_by_sales_order_instead_of_a_capped_browser_join(self):
        order_a = str(uuid.uuid4())
        order_b = str(uuid.uuid4())
        jobs = [
            SimpleNamespace(id=uuid.uuid4(), sales_order_id=order_a, current_stage="WINDER", status="IN_PROGRESS", planned_qty=100, due_date=date(2026, 9, 18)),
            SimpleNamespace(id=uuid.uuid4(), sales_order_id=order_a, current_stage="DISPATCH", status="IN_PROGRESS", planned_qty=40, due_date=date(2026, 9, 16)),
            SimpleNamespace(id=uuid.uuid4(), sales_order_id=order_b, current_stage="QC", status="IN_PROGRESS", planned_qty=80, due_date=date(2026, 9, 17)),
        ]
        hold_id = jobs[2].id
        items, summary = summarize_job_cards_by_sales_order(
            jobs,
            hold_counts={hold_id: 1},
            today=date(2026, 9, 17),
            due_date_of=lambda job: job.due_date,
            classify_due_risk=lambda due, today: "OVERDUE" if due and due < today else ("PRIORITY" if due else None),
            is_open_status=lambda status: str(status).upper() not in {"COMPLETED", "CANCELLED"},
        )
        by_id = {row["sales_order_id"]: row for row in items}
        self.assertEqual(summary["order_count"], 2)
        self.assertEqual(summary["job_count"], 3)
        self.assertEqual(by_id[order_a]["job_count"], 2)
        self.assertEqual(by_id[order_a]["dispatch_ready_job_count"], 1)
        self.assertEqual(by_id[order_a]["flow_status"], "Dispatch ready")
        self.assertEqual(by_id[order_b]["blocked_job_count"], 1)
        self.assertEqual(by_id[order_b]["flow_status"], "Blocked")
        self.assertEqual(summary["blocked_order_count"], 1)

    def test_flow_status_completed_requires_every_card_closed(self):
        self.assertEqual(
            flow_status_for_order(blocked=0, dispatch_ready=0, job_count=2, completed_count=2, open_count=0),
            "Completed",
        )
        self.assertEqual(
            flow_status_for_order(blocked=0, dispatch_ready=0, job_count=0, completed_count=0, open_count=0),
            "Commercial open",
        )
