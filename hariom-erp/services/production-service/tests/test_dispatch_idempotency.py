import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch
import uuid

from fastapi import HTTPException

from src.routers.dispatch import DispatchPayload, create_or_update_dispatch


class _FakeQuery:
    def __init__(self, result):
        self._result = result

    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return self._result

    def count(self):
        return int(self._result or 0)


class _FakeDB:
    def __init__(self, *, job_card, dispatch, idem, packing=None):
        self._job_card = job_card
        self._dispatch = dispatch
        self._idem = idem
        self._packing = packing
        self.commit_count = 0

    def query(self, model):
        model_name = getattr(model, "__name__", "")
        if model_name == "JobCard":
            return _FakeQuery(self._job_card)
        if model_name == "Dispatch":
            return _FakeQuery(self._dispatch)
        if model_name == "DispatchIdempotency":
            return _FakeQuery(self._idem)
        if model_name == "PackingRecord":
            return _FakeQuery(self._packing)
        if model_name == "QualityHold":
            return _FakeQuery(0)
        return _FakeQuery(None)

    def add(self, obj):
        return None

    def execute(self, *_args, **_kwargs):
        return None

    def flush(self):
        return None

    def commit(self):
        self.commit_count += 1

    def refresh(self, obj):
        return None


class DispatchIdempotencyTests(unittest.TestCase):
    def test_same_request_id_with_different_hash_is_conflict(self):
        job_card_id = uuid.UUID("00000000-0000-0000-0000-00000000d101")
        job_card = SimpleNamespace(
            id=job_card_id,
            plant_id=uuid.UUID("00000000-0000-0000-0000-0000000000a1"),
            sales_order_line_id=None,
            planned_qty=100,
            spec_id=uuid.UUID("00000000-0000-0000-0000-00000000d102"),
            status="IN_PROGRESS",
            current_stage="PROCESS",
        )
        dispatch = SimpleNamespace(
            id=uuid.UUID("00000000-0000-0000-0000-00000000d103"),
            job_card_id=job_card_id,
            dispatch_snapshot={},
            status="DRAFT",
            created_at=datetime.utcnow(),
        )
        idem = SimpleNamespace(
            job_card_id=job_card_id,
            request_hash="old-hash",
            status="FAILED",
            response_snapshot=None,
            error_message="old",
        )
        db = _FakeDB(job_card=job_card, dispatch=dispatch, idem=idem)

        payload = DispatchPayload(
            job_card_id=job_card_id,
            dispatch_snapshot={"summary": {"total_pcs": 10}},
            status="SEALED",
            dispatch_request_id="req-1",
            dispatch_qty=10,
        )

        with self.assertRaises(HTTPException) as exc:
            create_or_update_dispatch(
                payload=payload,
                db=db,
                plant_id="00000000-0000-0000-0000-0000000000a1",
                current_user={"token": "token", "sub": "user", "roles": ["Admin"]},
            )
        self.assertEqual(exc.exception.status_code, 409)

    def test_same_request_id_and_hash_replays_success(self):
        job_card_id = uuid.UUID("00000000-0000-0000-0000-00000000d201")
        job_card = SimpleNamespace(
            id=job_card_id,
            plant_id=uuid.UUID("00000000-0000-0000-0000-0000000000a1"),
            sales_order_line_id=None,
            planned_qty=100,
            spec_id=uuid.UUID("00000000-0000-0000-0000-00000000d202"),
            status="IN_PROGRESS",
            current_stage="PROCESS",
        )
        dispatch = SimpleNamespace(
            id=uuid.UUID("00000000-0000-0000-0000-00000000d203"),
            job_card_id=job_card_id,
            dispatch_snapshot={},
            status="DRAFT",
            created_at=datetime.utcnow(),
        )

        payload = DispatchPayload(
            job_card_id=job_card_id,
            dispatch_snapshot={"summary": {"total_pcs": 12}},
            status="SEALED",
            dispatch_request_id="req-2",
            dispatch_qty=12,
        )

        # Build matching hash using the same helper by creating once then reusing internals.
        from src.routers.dispatch import _request_hash

        idem = SimpleNamespace(
            job_card_id=job_card_id,
            request_hash=_request_hash(payload),
            status="SUCCESS",
            response_snapshot={
                "sales_order_line_id": None,
                "fg_item_id": None,
                "dispatch_qty": 12,
            },
            error_message=None,
        )
        db = _FakeDB(job_card=job_card, dispatch=dispatch, idem=idem)

        response = create_or_update_dispatch(
            payload=payload,
            db=db,
            plant_id="00000000-0000-0000-0000-0000000000a1",
            current_user={"token": "token", "sub": "user", "roles": ["Admin"]},
        )
        self.assertEqual(response.status, "SEALED")
        self.assertEqual(response.dispatch_request_id, "req-2")

    def test_unprivileged_role_cannot_seal(self):
        job_card_id = uuid.UUID("00000000-0000-0000-0000-00000000d301")
        job_card = SimpleNamespace(
            id=job_card_id,
            plant_id=uuid.UUID("00000000-0000-0000-0000-0000000000a1"),
            sales_order_line_id=None,
            planned_qty=100,
            spec_id=uuid.UUID("00000000-0000-0000-0000-00000000d302"),
            status="IN_PROGRESS",
            current_stage="PROCESS",
        )
        db = _FakeDB(job_card=job_card, dispatch=None, idem=None)
        payload = DispatchPayload(
            job_card_id=job_card_id,
            dispatch_snapshot={"summary": {"total_pcs": 10}},
            status="SEALED",
            dispatch_request_id="req-3",
            dispatch_qty=10,
        )

        with self.assertRaises(HTTPException) as exc:
            create_or_update_dispatch(
                payload=payload,
                db=db,
                plant_id="00000000-0000-0000-0000-0000000000a1",
                current_user={"token": "token", "sub": "store", "roles": ["Store"]},
            )
        self.assertEqual(exc.exception.status_code, 403)

    def test_fresh_pending_request_cannot_run_a_second_orchestrator(self):
        from src.routers.dispatch import _request_hash

        job_card_id = uuid.UUID("00000000-0000-0000-0000-00000000d351")
        job_card = SimpleNamespace(
            id=job_card_id,
            plant_id=uuid.UUID("00000000-0000-0000-0000-0000000000a1"),
            sales_order_line_id=None,
            planned_qty=100,
            spec_id=None,
            status="IN_PROGRESS",
            current_stage="PACKING",
        )
        payload = DispatchPayload(
            job_card_id=job_card_id,
            dispatch_snapshot={"qty": 10},
            status="SEALED",
            dispatch_request_id="pending-request",
            dispatch_qty=10,
        )
        idem = SimpleNamespace(
            job_card_id=job_card_id,
            request_hash=_request_hash(payload),
            status="PENDING",
            response_snapshot={},
            error_message=None,
            updated_at=datetime.utcnow(),
        )
        db = _FakeDB(job_card=job_card, dispatch=None, idem=idem)

        with self.assertRaises(HTTPException) as exc:
            create_or_update_dispatch(
                payload=payload,
                db=db,
                plant_id="00000000-0000-0000-0000-0000000000a1",
                current_user={"token": "token", "sub": "admin", "roles": ["Admin"]},
            )
        self.assertEqual(exc.exception.status_code, 409)

    def test_sealed_dispatch_requires_request_id(self):
        job_card_id = uuid.UUID("00000000-0000-0000-0000-00000000d401")
        job_card = SimpleNamespace(
            id=job_card_id,
            plant_id=uuid.UUID("00000000-0000-0000-0000-0000000000a1"),
            sales_order_line_id=None,
            planned_qty=100,
            spec_id=uuid.UUID("00000000-0000-0000-0000-00000000d402"),
            status="IN_PROGRESS",
            current_stage="PROCESS",
        )
        db = _FakeDB(job_card=job_card, dispatch=None, idem=None)
        payload = DispatchPayload(
            job_card_id=job_card_id,
            dispatch_snapshot={"summary": {"total_pcs": 10}},
            status="SEALED",
            dispatch_qty=10,
        )

        with self.assertRaises(HTTPException) as exc:
            create_or_update_dispatch(
                payload=payload,
                db=db,
                plant_id="00000000-0000-0000-0000-0000000000a1",
                current_user={"token": "token", "sub": "admin", "roles": ["Admin"]},
            )
        self.assertEqual(exc.exception.status_code, 422)

    def test_inventory_checkpoint_and_sales_retry_converge_exactly_once(self):
        from src.routers.dispatch import _request_hash

        job_card_id = uuid.UUID("00000000-0000-0000-0000-00000000d501")
        line_id = uuid.UUID("00000000-0000-0000-0000-00000000d502")
        job_card = SimpleNamespace(
            id=job_card_id,
            plant_id=uuid.UUID("00000000-0000-0000-0000-0000000000a1"),
            sales_order_id=uuid.UUID("00000000-0000-0000-0000-00000000d503"),
            sales_order_line_id=line_id,
            planned_qty=100,
            released_qty=100,
            spec_id=uuid.UUID("00000000-0000-0000-0000-00000000d504"),
            status="IN_PROGRESS",
            current_stage="PACKING",
        )
        dispatch = SimpleNamespace(
            id=uuid.UUID("00000000-0000-0000-0000-00000000d505"),
            job_card_id=job_card_id,
            dispatch_snapshot={},
            status="DRAFT",
            created_at=datetime.utcnow(),
        )
        packing = SimpleNamespace(
            total_packed_qty=50,
            fg_item_id=uuid.UUID("00000000-0000-0000-0000-00000000d506"),
            snapshot={"inventory_batch_id": "00000000-0000-0000-0000-00000000d507"},
        )
        payload = DispatchPayload(
            job_card_id=job_card_id,
            dispatch_snapshot={"qty": 40},
            status="SEALED",
            dispatch_request_id="retry-stable-1",
            dispatch_qty=40,
        )
        idem = SimpleNamespace(
            job_card_id=job_card_id,
            request_hash=_request_hash(payload),
            status="FAILED",
            response_snapshot=None,
            error_message=None,
        )
        db = _FakeDB(job_card=job_card, dispatch=dispatch, idem=idem, packing=packing)
        inventory_calls = []
        sales_record_attempts = 0

        def inventory_post(**kwargs):
            snapshot = kwargs["snapshot"]
            inventory_calls.append(snapshot.get("inventory_dispatch_transaction_id"))
            snapshot["inventory_dispatch_transaction_id"] = "inventory-txn-1"
            snapshot["inventory_dispatch_status"] = "POSTED"
            return snapshot

        def sales_post(**kwargs):
            nonlocal sales_record_attempts
            if kwargs["path"].endswith("/record-dispatch"):
                sales_record_attempts += 1
                if sales_record_attempts == 1:
                    raise HTTPException(status_code=502, detail="injected post-inventory timeout")
            return {"ok": True}

        with patch("src.routers.dispatch._post_inventory_dispatch_if_needed", side_effect=inventory_post), patch(
            "src.routers.dispatch._post_sales_request", side_effect=sales_post
        ):
            with self.assertRaises(HTTPException):
                create_or_update_dispatch(
                    payload=payload,
                    db=db,
                    plant_id="00000000-0000-0000-0000-0000000000a1",
                    current_user={"token": "token", "sub": "admin", "roles": ["Admin"]},
                )
            self.assertEqual(dispatch.status, "DRAFT")
            self.assertEqual(idem.status, "FAILED")
            self.assertEqual(dispatch.dispatch_snapshot["inventory_dispatch_transaction_id"], "inventory-txn-1")

            response = create_or_update_dispatch(
                payload=payload,
                db=db,
                plant_id="00000000-0000-0000-0000-0000000000a1",
                current_user={"token": "token", "sub": "admin", "roles": ["Admin"]},
            )

        self.assertEqual(response.status, "SEALED")
        self.assertEqual(idem.status, "SUCCESS")
        self.assertEqual(sales_record_attempts, 2)
        self.assertEqual(inventory_calls, [None, "inventory-txn-1"])


if __name__ == "__main__":
    unittest.main()
