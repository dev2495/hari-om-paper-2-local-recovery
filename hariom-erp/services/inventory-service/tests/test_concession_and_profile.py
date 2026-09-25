from src.concession_partition import (
    ConcessionPartitionError,
    ConcessionScopeError,
    assert_concession_use_allowed,
    concession_release_stock_status,
    remaining_hold_quantity,
    validate_concession_quantity,
)
from types import SimpleNamespace
from datetime import datetime, timedelta
from src.quality_profile_lifecycle import ProfileLifecycleError, apply_profile_approve, apply_profile_save
from src.quality_pin import pin_quality_profile_metadata


def test_rr01_partial_concession_keeps_residual_and_independent_hold():
    release, residual = validate_concession_quantity(600, 1000, independent_hold_qty=400)
    assert release == 600
    assert residual == 400
    independent = remaining_hold_quantity(
        [
            {"status": "HOLD", "source_inspection_id": "a", "quantity": 400},
            {"status": "HOLD", "source_inspection_id": "b", "quantity": 600},
        ],
        excluding_inspection_id="b",
    )
    assert independent == 400


def test_rr02_zero_negative_excess_unspecified_rejected():
    for value in (0, -1, 1200, None):
        try:
            validate_concession_quantity(value, 1000)
            raise AssertionError(f"expected rejection for {value}")
        except ConcessionPartitionError as exc:
            assert exc.code in {"INVALID_QUANTITY", "EXCESS_QUANTITY", "UNSPECIFIED_SCOPE"}


def test_item_profile_cannot_self_approve():
    try:
        apply_profile_save(None, {"status": "approved", "parameters": []}, requested_status="approved")
        raise AssertionError("approved JSON save must fail")
    except ProfileLifecycleError as exc:
        assert exc.code == "APPROVAL_REQUIRED"


def test_approved_profile_edit_opens_new_draft():
    current = {"status": "approved", "revision": 3, "parameters": [{"code": "gsm", "min": 1, "max": 2}]}
    draft = apply_profile_save(current, {"parameters": [{"code": "gsm", "min": 1, "max": 3}]}, requested_status="draft")
    assert draft["status"] == "draft"
    assert draft["revision"] == 4
    assert draft["approved_snapshot"]["revision"] == 3


def test_approve_requires_matching_revision():
    current = {"status": "draft", "revision": 2, "parameters": []}
    try:
        apply_profile_approve(current, expected_revision=1, actor="owner", actor_roles=["Owner"])
        raise AssertionError("stale revision must fail")
    except ProfileLifecycleError as exc:
        assert exc.code == "STALE_REVISION"
    approved = apply_profile_approve(current, expected_revision=2, actor="owner", actor_roles=["Owner"])
    assert approved["status"] == "approved"
    assert approved["approved_by"] == "owner"


def test_rr01_independent_hold_blocks_over_release():
    try:
        validate_concession_quantity(700, 1000, independent_hold_qty=400)
        raise AssertionError("independent hold must block over-release")
    except ConcessionPartitionError as exc:
        assert exc.code == "INDEPENDENT_HOLD"


def test_receipt_pin_does_not_follow_later_master():
    first = pin_quality_profile_metadata({}, {"status": "approved", "revision": 1, "parameters": [{"code": "gsm"}]})
    later = pin_quality_profile_metadata(first, {"status": "approved", "revision": 2, "parameters": [{"code": "gsm", "max": 9}]})
    assert later["quality_profile"]["revision"] == 1


def test_qct066_scoped_release_is_concession_not_unrestricted():
    assert concession_release_stock_status() == "UNRESTRICTED"
    customer = "11111111-1111-1111-1111-111111111111"
    order = "22222222-2222-2222-2222-222222222222"
    assert (
        concession_release_stock_status(permitted_customer_id=customer, permitted_sales_order_id=order)
        == "CONCESSION"
    )
    expires = datetime.utcnow() + timedelta(days=1)
    assert concession_release_stock_status(expires_at=expires) == "CONCESSION"


def test_qct066_other_customer_or_expired_authorization_denied():
    customer = "11111111-1111-1111-1111-111111111111"
    order = "22222222-2222-2222-2222-222222222222"
    other = "33333333-3333-3333-3333-333333333333"
    concession = SimpleNamespace(
        permitted_customer_id=customer,
        permitted_sales_order_id=order,
        expires_at=datetime.utcnow() + timedelta(days=1),
    )
    assert_concession_use_allowed(concession, customer_id=customer, sales_order_id=order)
    try:
        assert_concession_use_allowed(concession, customer_id=other, sales_order_id=order)
        raise AssertionError("other customer must be denied")
    except ConcessionScopeError as exc:
        assert exc.code == "CONCESSION_SCOPE_MISMATCH"
    try:
        assert_concession_use_allowed(concession, customer_id=customer, sales_order_id=other)
        raise AssertionError("other order must be denied")
    except ConcessionScopeError as exc:
        assert exc.code == "CONCESSION_SCOPE_MISMATCH"
    try:
        assert_concession_use_allowed(concession, customer_id=None, sales_order_id=None)
        raise AssertionError("unspecified use must be denied")
    except ConcessionScopeError as exc:
        assert exc.code == "CONCESSION_SCOPE_MISMATCH"
    expired = SimpleNamespace(
        permitted_customer_id=customer,
        permitted_sales_order_id=order,
        expires_at=datetime.utcnow() - timedelta(hours=1),
    )
    try:
        assert_concession_use_allowed(expired, customer_id=customer, sales_order_id=order)
        raise AssertionError("expired authorization must be denied")
    except ConcessionScopeError as exc:
        assert exc.code == "CONCESSION_EXPIRED"
    try:
        assert_concession_use_allowed(None, customer_id=customer, sales_order_id=order)
        raise AssertionError("missing concession record must be denied")
    except ConcessionScopeError as exc:
        assert exc.code == "CONCESSION_RECORD_MISSING"
