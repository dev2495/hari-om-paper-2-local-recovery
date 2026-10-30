"""Stock book rules without a database (client 2026-10-28, spec 2.1): what each movement counts as, and
which IST day it lands on."""
import uuid
from datetime import date, datetime
from types import SimpleNamespace

from src.models import ReelIssueStatus, TransactionType
from src.services.stock_control import _creates_reel_for, _issue_effective_datetime, _txn_kind, book_txn_day
from src.services.stock_lots import _unwrap


def _txn(txn_type, qty=-1.0, **meta):
    return SimpleNamespace(transaction_type=txn_type, qty_change=qty, movement_metadata=meta or None,
                           effective_date=None, effective_at=None, created_at=None)


def test_every_movement_has_one_place_in_the_identity():
    assert _txn_kind(_txn(TransactionType.INWARD, 10)) == "RECEIVED"
    assert _txn_kind(_txn(TransactionType.OPENING, 10)) == "OPENING_LOAD"
    assert _txn_kind(_txn(TransactionType.ISSUE_PRODUCTION)) == "ISSUED"
    # Issue to WIP leaves the store as STORE_OUT; its WIP_IN twin is floor stock, not store stock.
    assert _txn_kind(_txn(TransactionType.MOVE, side="STORE_OUT")) == "ISSUED"
    assert _txn_kind(_txn(TransactionType.MOVE, 1, side="WIP_IN")) is None
    assert _txn_kind(_txn(TransactionType.MOVE, 0)) is None
    assert _txn_kind(_txn(TransactionType.ADJUSTMENT, kind="SUPPLIER_RETURN")) == "SENT_BACK"
    assert _txn_kind(_txn(TransactionType.ADJUSTMENT, reason_code="PHYSICAL_COUNT_VARIANCE")) == "COUNT_VARIANCE"
    assert _txn_kind(_txn(TransactionType.ADJUSTMENT, count_id=str(uuid.uuid4()))) == "COUNT_VARIANCE"
    assert _txn_kind(_txn(TransactionType.ADJUSTMENT, reason_code="DAMAGED_IN_STORE")) == "CORRECTION"
    assert _txn_kind(_txn(TransactionType.ADJUSTMENT, source_document_type="CUSTOMER_REJECTION_SCRAP")) == "CORRECTION"


def test_business_days_are_ist_days():
    row = _txn(TransactionType.INWARD, 5)
    row.effective_date = date(2026, 10, 31)
    row.effective_at = datetime(2026, 10, 31, 23, 59)  # a "day end" stamp: the business date wins
    assert book_txn_day(row) == date(2026, 10, 31)
    row.effective_date = None
    row.effective_at = None
    row.created_at = datetime(2026, 10, 31, 19, 0)  # 31 Oct 19:00 UTC = 1 Nov 00:30 in India
    assert book_txn_day(row) == date(2026, 11, 1)
    row.created_at = datetime(2026, 10, 31, 18, 0)
    assert book_txn_day(row) == date(2026, 10, 31)


def test_a_floor_issue_is_out_on_its_issue_date_not_its_card_date():
    issue = SimpleNamespace(issue_mode="FLOOR", issue_date=date(2026, 10, 31), status=ReelIssueStatus.CLOSED,
                            created_at=datetime(2026, 10, 31, 8, 0), closed_at=datetime(2026, 11, 2, 9, 0))
    assert _issue_effective_datetime(issue).date() == date(2026, 10, 31)
    legacy = SimpleNamespace(issue_mode="LEGACY", issue_date=date(2026, 10, 3), status=ReelIssueStatus.CLOSED,
                             created_at=datetime(2026, 10, 3, 8, 0), closed_at=datetime(2026, 10, 4, 9, 0))
    assert _issue_effective_datetime(legacy).date() == date(2026, 10, 4)


def test_a_new_reel_from_a_correction_is_counted_once():
    line = str(uuid.uuid4())
    reel = SimpleNamespace(genealogy_metadata={"source_document_type": "STOCK_ADJUSTMENT", "adjustment_line_id": line})
    assert _creates_reel_for({"adjustment_line_id": line, "adjustment_qty_delta": 50}, reel)
    assert _creates_reel_for({"creates_reel": True}, SimpleNamespace(genealogy_metadata={}))
    # A gain added back to a known reel is its own correction.
    assert not _creates_reel_for({"adjustment_line_id": str(uuid.uuid4()), "adjustment_qty_delta": 50}, reel)


def test_scanned_labels_unwrap_from_scan_links():
    payload = "HARIOM|REEL|00000000-0000-0000-0000-0000000000a1|0b8a3a6e-5d4c-4f33-9e3b-2f1c0d9e8a77|AT-261027-026"
    assert _unwrap(f"https://erp.example/scan?c={payload.replace('|', '%7C')}") == payload
    assert _unwrap(f"/scan?c={payload}") == payload
    assert _unwrap(" AT-261027-026 ") == "AT-261027-026"
