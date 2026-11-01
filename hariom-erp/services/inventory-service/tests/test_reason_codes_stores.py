"""Stores reasons pick a code from Masters › Reason codes (owner decision 4, 1 Nov 2026).

Stock correction raise (STOCK_CORRECTION) and reject (APPROVAL_REJECT), stock count send-back
(APPROVAL_REJECT), manual FG inward (MANUAL_FG), books unlock (BOOKS_UNLOCK), receipt without a PO
(MANUAL_RECEIPT) and opening stock put on hold (QC_HOLD).
"""
import uuid
from types import SimpleNamespace

from _reason_fakes import OWNER, PLANT, FakeDB, refused, spy_on
from src.routers import books, fg_inward, manual_receipts, stock_control, stock_count

STORE = {"sub": "store@hariom.com", "roles": ["Store"], "token": "t"}


# ---------------------------------------------------------------- stock correction raise (STOCK_CORRECTION)

def test_correction_raise_takes_a_master_code_not_the_old_fixed_list(monkeypatch):
    spy = spy_on(monkeypatch, stock_control)
    old_style = stock_control.CorrectionPayload(code="AT-1", new_qty=4, reason="COUNT_SHORT")
    refused(lambda: stock_control.raise_correction(old_style, None, PLANT, STORE), 422, "Choose a reason for the correction")
    refused(lambda: stock_control.raise_correction(stock_control.CorrectionPayload(code="AT-1", new_qty=4, reason_code="STOCK-OTHER", note="lost"),
                                                   None, PLANT, STORE), 422, "at least 5")
    refused(lambda: stock_control.raise_correction(stock_control.CorrectionPayload(code="AT-1", new_qty=4, reason_code="PHYSICAL_COUNT_VARIANCE"),
                                                   None, PLANT, STORE), 422, "stock count")
    refused(lambda: stock_control.raise_correction(stock_control.CorrectionPayload(code="AT-1", new_qty=4, reason_code="BAD-CODE"),
                                                   None, PLANT, STORE), 422, "not in the STOCK_CORRECTION list")
    assert spy.categories == ["STOCK_CORRECTION", "STOCK_CORRECTION", "STOCK_CORRECTION"]


# ---------------------------------------------------------------- correction reject (APPROVAL_REJECT)

def test_correction_reject_needs_an_approval_reject_code(monkeypatch):
    spy = spy_on(monkeypatch, stock_control)
    header = SimpleNamespace(id=uuid.uuid4(), plant_id=PLANT, status="DRAFT", cancelled_by=None, cancelled_at=None, cancel_note=None,
                             cancel_reason_code=None, cancel_reason_label=None)
    monkeypatch.setattr(stock_control, "_draft_correction", lambda db, plant_id, voucher_id: header)
    monkeypatch.setattr(stock_control, "_correction_view", lambda db, h: h)
    db = FakeDB()
    refused(lambda: stock_control.reject_correction(header.id, stock_control.CorrectionDecisionPayload(note="Drum is in the QC bay"), db, PLANT, OWNER), 422)
    assert header.status == "DRAFT"
    stock_control.reject_correction(header.id, stock_control.CorrectionDecisionPayload(reason_code="AR-WRONG-ITEM", note="Drum is in the QC bay"),
                                    db, PLANT, OWNER)
    assert spy.categories[-1] == "APPROVAL_REJECT" and header.status == "CANCELLED"
    assert header.cancel_note == "Ar wrong item — Drum is in the QC bay"
    assert (header.cancel_reason_code, header.cancel_reason_label) == ("AR-WRONG-ITEM", "Ar wrong item")


# ---------------------------------------------------------------- stock count send-back (APPROVAL_REJECT)

def test_count_send_back_needs_an_approval_reject_code(monkeypatch):
    spy = spy_on(monkeypatch, stock_count)
    rack = SimpleNamespace(id=uuid.uuid4(), status="DONE", recount_note=None, done_by="x", done_at=None, updated_at=None)
    count = SimpleNamespace(id=uuid.uuid4(), plant_id=PLANT, status="SUBMITTED", count_state="SUBMITTED", sent_back_by=None, sent_back_at=None,
                            sent_back_note=None, sent_back_reason_code=None, sent_back_reason_label=None, updated_at=None, count_session_no="SC/1")
    monkeypatch.setattr(stock_count, "_count", lambda db, plant_id, count_id, lock=False: count)
    monkeypatch.setattr(stock_count, "_racks", lambda db, c: [rack])
    monkeypatch.setattr(stock_count, "_drop_auto_lines", lambda db, c, r: None)
    monkeypatch.setattr(stock_count, "_audit", lambda *args, **kwargs: None)
    monkeypatch.setattr(stock_count, "_detail", lambda db, plant_id, c, user: c)
    db = FakeDB()
    refused(lambda: stock_count.send_back_count(stock_count.SendBackPayload(note="Recount rack C"), count.id, db, PLANT, OWNER), 422)
    refused(lambda: stock_count.send_back_count(stock_count.SendBackPayload(reason_code="AR-OTHER", note="C"), count.id, db, PLANT, OWNER), 422, "at least 5")
    assert count.status == "SUBMITTED"
    stock_count.send_back_count(stock_count.SendBackPayload(reason_code="AR-RECOUNT", note="Recount rack C"), count.id, db, PLANT, OWNER)
    assert spy.categories[-1] == "APPROVAL_REJECT" and count.status == "DRAFT"
    assert count.sent_back_note == "Ar recount — Recount rack C" and rack.recount_note == "Ar recount — Recount rack C"
    assert (count.sent_back_reason_code, count.sent_back_reason_label) == ("AR-RECOUNT", "Ar recount")


# ---------------------------------------------------------------- manual FG inward (MANUAL_FG)

def test_manual_fg_needs_a_manual_fg_code_and_returns_still_go_to_quality(monkeypatch):
    spy = spy_on(monkeypatch, fg_inward)
    production = {"sub": "head@hariom.com", "roles": ["PlantManager"], "token": "t"}
    item = uuid.uuid4()
    refused(lambda: fg_inward.create_manual_fg_inward(fg_inward.ManualFGInwardCreate(item_id=item, qty=10, notes="Reworked lot"), None, PLANT, production), 422)
    refused(lambda: fg_inward.create_manual_fg_inward(fg_inward.ManualFGInwardCreate(item_id=item, qty=10, reason_code="RETURN"), None, PLANT, production),
            400, "Customer returns")
    refused(lambda: fg_inward.create_manual_fg_inward(fg_inward.ManualFGInwardCreate(item_id=item, qty=10, reason_code="FG-OTHER", notes="x"), None, PLANT, production),
            422, "at least 5")
    refused(lambda: fg_inward.create_manual_fg_inward(fg_inward.ManualFGInwardCreate(item_id=item, qty=10, reason_code="BAD-1"), None, PLANT, production),
            422, "not in the MANUAL_FG list")
    assert spy.categories == ["MANUAL_FG"] * 3


# ---------------------------------------------------------------- books unlock (BOOKS_UNLOCK)

def test_books_unlock_checks_a_code_and_keeps_it_in_the_history(monkeypatch):
    spy = spy_on(monkeypatch, books)
    calls = []

    def fake_unlock(db, plant_id, month, actor, reason, coded=None):
        calls.append((reason, coded))
        return SimpleNamespace(id=uuid.uuid4())

    monkeypatch.setattr(books, "unlock_month", fake_unlock)
    monkeypatch.setattr(books, "serialize_lock", lambda row: {"status": "UNLOCKED"})
    monkeypatch.setattr(books, "_audit", lambda *args, **kwargs: None)
    db = FakeDB()
    refused(lambda: books.unlock_books_month(books.BooksUnlockPayload(month="2026-09"), db, PLANT, OWNER), 422, "Choose a reason")
    refused(lambda: books.unlock_books_month(books.BooksUnlockPayload(month="2026-09", reason_code="BU-OTHER"), db, PLANT, OWNER), 422, "at least 5")
    books.unlock_books_month(books.BooksUnlockPayload(month="2026-09", reason_code="BU-LATE-GRN", reason_note="GRN 412"), db, PLANT, OWNER)
    assert spy.categories[-1] == "BOOKS_UNLOCK"
    assert calls[-1] == ("Bu late grn — GRN 412", {"reason_code": "BU-LATE-GRN", "reason_label": "Bu late grn", "reason_note": "GRN 412"})
    # Free text alone is refused for every caller now (second pass, 1 Nov 2026).
    refused(lambda: books.unlock_books_month(books.BooksUnlockPayload(month="2026-09", reason="Production close did not complete"), db, PLANT, OWNER), 422, "Choose a reason")
    # Production's undo of a close that did not finish needs no code while the lock is fresh, and records a fixed text.
    monkeypatch.setattr(books, "rollback_allowed", lambda db, plant_id, month: True)
    books.unlock_books_month(books.BooksUnlockPayload(month="2026-09", rollback=True, reason="Production close did not complete"), db, PLANT, OWNER)
    assert calls[-1] == (books.ROLLBACK_REASON, None)
    monkeypatch.setattr(books, "rollback_allowed", lambda db, plant_id, month: False)
    refused(lambda: books.unlock_books_month(books.BooksUnlockPayload(month="2026-09", rollback=True), db, PLANT, OWNER), 409, "did not finish")


def test_books_rollback_only_undoes_a_fresh_lock():
    from datetime import date, datetime, timedelta

    class Q:
        def __init__(self, row):
            self.row = row

        def filter(self, *args):
            return self

        def first(self):
            return self.row

    class DB:
        def __init__(self, row):
            self.row = row

        def query(self, model):
            return Q(self.row)

    now = datetime(2026, 11, 1, 10, 0)
    fresh = SimpleNamespace(status="LOCKED", locked_at=now - timedelta(minutes=2))
    old = SimpleNamespace(status="LOCKED", locked_at=now - timedelta(days=3))
    assert books.rollback_allowed(DB(fresh), PLANT, date(2026, 9, 1), now=now) is True
    assert books.rollback_allowed(DB(old), PLANT, date(2026, 9, 1), now=now) is False
    assert books.rollback_allowed(DB(None), PLANT, date(2026, 9, 1), now=now) is True


# ---------------------------------------------------------------- receipt without a PO (MANUAL_RECEIPT)

def test_manual_receipt_needs_a_manual_receipt_code(monkeypatch):
    spy = spy_on(monkeypatch, manual_receipts)
    payload = SimpleNamespace(reason="Urgent buy", reason_code=None, reason_note=None)
    refused(lambda: manual_receipts._manual_reason(payload, PLANT, STORE), 422, "receiving without a PO")
    choice = manual_receipts._manual_reason(SimpleNamespace(reason=None, reason_code="mr-cash", reason_note="Paid at the gate"), PLANT, STORE)
    assert spy.categories == ["MANUAL_RECEIPT", "MANUAL_RECEIPT"]
    assert (choice.code, choice.text) == ("MR-CASH", "Mr cash — Paid at the gate")
    assert manual_receipts.ManualReceiptCreate.model_fields["reason"].is_required() is False


# ---------------------------------------------------------------- opening stock on hold (QC_HOLD)

def test_opening_stock_hold_needs_a_qc_hold_code_only_on_held_lines(monkeypatch):
    spy = spy_on(monkeypatch, stock_control)
    item = uuid.uuid4()
    payload = stock_control.OpeningLoadPayload(effective_date="2026-10-01", lines=[
        {"item_id": item, "qty": 5},
        {"item_id": item, "qty": 6, "on_hold": True, "hold_reason_code": "QH-MOISTURE", "hold_reason_note": "Damp corner"},
        {"item_id": item, "qty": 7, "on_hold": True, "hold_reason": "Typed only"},
    ])
    stock_control._resolve_opening_hold_reasons(payload, PLANT, OWNER)
    cleared, held, typed = payload.lines
    assert spy.categories == ["QC_HOLD"]
    assert cleared.hold_reason is None and cleared.hold_reason_code is None
    assert (held.hold_reason, held.hold_reason_code, held.hold_reason_label) == ("Qh moisture — Damp corner", "QH-MOISTURE", "Qh moisture")
    # No code: the row check of the batch names this row ("Choose why this lot is on hold").
    assert typed.hold_reason is None

    other = stock_control.OpeningLoadPayload(effective_date="2026-10-01", lines=[
        {"item_id": item, "qty": 6, "stock_status": "QC_HOLD", "hold_reason_code": "QH-OTHER", "hold_reason_note": "odd"}])
    refused(lambda: stock_control._resolve_opening_hold_reasons(other, PLANT, OWNER), 422, "at least 5")
