import unittest
from datetime import datetime
from types import SimpleNamespace
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


class _FakeDB:
    def __init__(self, *, job_card, dispatch, idem):
        self._job_card = job_card
        self._dispatch = dispatch
        self._idem = idem

    def query(self, model):
        model_name = getattr(model, "__name__", "")
        if model_name == "JobCard":
            return _FakeQuery(self._job_card)
        if model_name == "Dispatch":
            return _FakeQuery(self._dispatch)
        if model_name == "DispatchIdempotency":
            return _FakeQuery(self._idem)
        return _FakeQuery(None)

    def add(self, obj):
        return None

    def flush(self):
        return None

    def commit(self):
        return None

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
                current_user={"token": "token", "sub": "user"},
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
            current_user={"token": "token", "sub": "user"},
        )
        self.assertEqual(response.status, "SEALED")
        self.assertEqual(response.dispatch_request_id, "req-2")


if __name__ == "__main__":
    unittest.main()
