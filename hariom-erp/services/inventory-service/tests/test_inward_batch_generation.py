from datetime import datetime
from types import SimpleNamespace
import unittest

from src.routers.inward import _clean_batch_token, _next_system_batch_no
from src.routers.fg_inward import _next_system_fg_batch_no


class _FakeQuery:
    def __init__(self, existing):
        self.existing = existing
        self.candidate = None

    def filter(self, *criteria):
        for criterion in criteria:
            value = getattr(getattr(criterion, "right", None), "value", None)
            if isinstance(value, str) and value.startswith(("RM-", "FG-")):
                self.candidate = value
        return self

    def first(self):
        return object() if self.candidate in self.existing else None


class _FakeDb:
    def __init__(self, existing):
        self.existing = existing

    def query(self, *_args):
        return _FakeQuery(self.existing)


class InwardBatchGenerationTests(unittest.TestCase):
    def test_clean_batch_token_keeps_short_upper_item_code(self):
        self.assertEqual(_clean_batch_token("adhesive 999 / blue"), "ADHESIVE-999-BLUE")

    def test_next_system_batch_no_skips_existing_sequence(self):
        date_part = datetime.utcnow().strftime("%y%m%d")
        item = SimpleNamespace(item_code="adhesive 999", name="Adhesive")
        db = _FakeDb({f"RM-ADHESIVE-999-{date_part}-001"})

        self.assertEqual(
            _next_system_batch_no(db, item, "PLANT_A"),
            f"RM-ADHESIVE-999-{date_part}-002",
        )

    def test_next_system_fg_batch_no_uses_fg_prefix(self):
        date_part = datetime.utcnow().strftime("%y%m%d")
        item = SimpleNamespace(item_code="cup-75", name="Cup 75")
        db = _FakeDb({f"FG-CUP-75-{date_part}-001"})

        self.assertEqual(
            _next_system_fg_batch_no(db, item, "PLANT_A"),
            f"FG-CUP-75-{date_part}-002",
        )


if __name__ == "__main__":
    unittest.main()
