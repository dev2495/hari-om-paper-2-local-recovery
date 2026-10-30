"""Order close reasons (SO_CLOSE) are changed only by the Owner or an Admin (client 2026-10-28)."""
import unittest

from fastapi import HTTPException

from src.routers.shop_floor import _require_reason_category_writer


class OrderCloseReasonWriterTests(unittest.TestCase):
    def test_plant_manager_cannot_touch_order_close_reasons(self):
        with self.assertRaises(HTTPException) as caught:
            _require_reason_category_writer({"roles": ["PlantManager"]}, "so_close")
        self.assertEqual(caught.exception.status_code, 403)
        self.assertIn("Owner or an Admin", caught.exception.detail)

    def test_moving_a_floor_reason_into_so_close_is_refused_too(self):
        with self.assertRaises(HTTPException):
            _require_reason_category_writer({"roles": ["PlantManager"]}, "DOWNTIME", "SO_CLOSE")

    def test_plant_manager_keeps_the_floor_lists(self):
        _require_reason_category_writer({"roles": ["PlantManager"]}, "DOWNTIME", None)

    def test_owner_and_admin_may_change_them(self):
        _require_reason_category_writer({"roles": ["Owner"]}, "SO_CLOSE")
        _require_reason_category_writer({"roles": ["Admin"]}, "SO_CLOSE")


class _Query:
    def __init__(self, rows):
        self.rows = rows

    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return self.rows.pop(0) if self.rows else None


class _Db:
    """First query finds the row being edited, the second the row that already holds the wanted code."""

    def __init__(self, *rows):
        self.rows = list(rows)
        self.committed = False

    def query(self, model):
        return _Query(self.rows)

    def commit(self):
        self.committed = True

    def refresh(self, model):
        pass


class ReasonCodeRenameTests(unittest.TestCase):
    def _put(self, row, payload, taken=None):
        import uuid

        from src.routers.shop_floor import ReasonUpdate, update_reason

        db = _Db(row, *([taken] if taken else []))
        with self.assertRaises(HTTPException) as caught:
            update_reason(reason_id=uuid.uuid4(), payload=ReasonUpdate(**payload), db=db,
                          plant_id="00000000-0000-0000-0000-0000000000a1", current_user={"roles": ["Owner"]})
        self.assertFalse(db.committed)
        return caught.exception

    def test_an_order_close_reason_keeps_its_code(self):
        from types import SimpleNamespace

        row = SimpleNamespace(id=1, code="SO-BALANCE-NOT-REQ", category="SO_CLOSE", label="Balance not required")
        error = self._put(row, {"code": "SO-OTHER"})
        self.assertEqual(error.status_code, 409)
        self.assertIn("keeps its code", error.detail)
        self.assertEqual(row.code, "SO-BALANCE-NOT-REQ")

    def test_an_order_close_reason_cannot_leave_or_join_the_close_list_through_reason_codes(self):
        from types import SimpleNamespace

        row = SimpleNamespace(id=1, code="SO-BALANCE-NOT-REQ", category="SO_CLOSE", label="Balance not required")
        error = self._put(row, {"category": "OTHER"})
        self.assertEqual(error.status_code, 409)
        self.assertIn("Order close reasons", error.detail)
        self.assertEqual(row.category, "SO_CLOSE")
        scrap = SimpleNamespace(id=2, code="SC-TORN", category="SCRAP", label="Torn")
        error = self._put(scrap, {"category": "so_close"})
        self.assertEqual(error.status_code, 409)
        self.assertEqual(scrap.category, "SCRAP")

    def test_a_code_already_used_in_the_plant_is_refused_in_plain_words(self):
        from types import SimpleNamespace

        row = SimpleNamespace(id=1, code="DT-POWER", category="DOWNTIME", label="Power cut")
        error = self._put(row, {"code": "dt-belt"}, taken=SimpleNamespace(id=2, code="DT-BELT"))
        self.assertEqual(error.status_code, 409)
        self.assertIn("DT-BELT is already used", error.detail)
        self.assertEqual(row.code, "DT-POWER")
