from datetime import date
from types import SimpleNamespace
import uuid

import pytest

from src.commercial import (
    ORIGIN_CUSTOMER_PO,
    ORIGIN_INTERNAL,
    ORIGIN_REVIEW,
    SalesCommercialError,
    delivery_date_error,
    resolve_parchment_variant,
    validate_bulk_import_order,
    validate_delivery_after_customer_po_date,
    validate_delivery_schedule_input,
    validate_origin_and_external_po,
    validate_order_lines_delivery_dates,
    validate_persisted_order,
)


CUSTOMER_ID = uuid.uuid4()


def test_delivery_date_must_be_strictly_later_than_customer_po_date():
    po_date = date(2026, 9, 24)
    validate_delivery_after_customer_po_date(date(2026, 9, 25), po_date, origin=ORIGIN_CUSTOMER_PO)

    with pytest.raises(SalesCommercialError, match="Delivery date must be after the Customer PO Date \\(24 Sep 2026\\)"):
        validate_delivery_after_customer_po_date(date(2026, 9, 24), po_date, origin=ORIGIN_CUSTOMER_PO)

    with pytest.raises(SalesCommercialError, match="Line 2: Delivery date must be after the Customer PO Date \\(24 Sep 2026\\)"):
        validate_delivery_after_customer_po_date(date(2026, 9, 20), po_date, origin=ORIGIN_CUSTOMER_PO, line_no=2)


def test_internal_origin_does_not_apply_customer_po_date_rule():
    validate_delivery_after_customer_po_date(
        date(2026, 9, 24),
        None,
        origin=ORIGIN_INTERNAL,
    )
    validate_delivery_after_customer_po_date(
        date(2026, 9, 24),
        date(2026, 9, 24),
        origin=ORIGIN_INTERNAL,
    )


def test_customer_po_requires_external_reference_and_date():
    origin, po_number, po_date, internal_date = validate_origin_and_external_po(
        origin="CUSTOMER_PO",
        customer_id=CUSTOMER_ID,
        po_number=" PO-88 ",
        po_date=date(2026, 9, 24),
    )
    assert origin == ORIGIN_CUSTOMER_PO
    assert po_number == "PO-88"
    assert po_date == date(2026, 9, 24)
    assert internal_date is None

    with pytest.raises(SalesCommercialError, match="Customer PO number is required"):
        validate_origin_and_external_po(
            origin=ORIGIN_CUSTOMER_PO,
            customer_id=CUSTOMER_ID,
            po_number="",
            po_date=date(2026, 9, 24),
        )


def test_internal_origin_clears_external_po_and_requires_internal_date():
    origin, po_number, po_date, internal_date = validate_origin_and_external_po(
        origin="internal",
        customer_id=CUSTOMER_ID,
        po_number="NA",
        po_date=date(2026, 9, 24),
        internal_order_date=date(2026, 9, 17),
    )
    assert origin == ORIGIN_INTERNAL
    assert po_number is None
    assert po_date is None
    assert internal_date == date(2026, 9, 17)

    with pytest.raises(SalesCommercialError, match="Internal order date is required"):
        validate_origin_and_external_po(
            origin=ORIGIN_INTERNAL,
            customer_id=CUSTOMER_ID,
            po_number=None,
            po_date=None,
            internal_order_date=None,
        )


def test_parchment_unchecked_clears_stale_color_and_master_id():
    required, color_id, color = resolve_parchment_variant(
        parchment_required=False,
        parchment_color="Aman · Many patterns",
        parchment_color_id=uuid.uuid4(),
    )
    assert required is False
    assert color_id is None
    assert color is None


def test_parchment_checked_requires_variant_and_keeps_master_link():
    color_id = uuid.uuid4()
    required, stored_id, color = resolve_parchment_variant(
        parchment_required=True,
        parchment_color="Natural",
        parchment_color_id=color_id,
        line_no=1,
    )
    assert required is True
    assert stored_id == color_id
    assert color == "Natural"

    with pytest.raises(SalesCommercialError, match="Line 3: Parchment color is required"):
        resolve_parchment_variant(
            parchment_required=True,
            parchment_color=None,
            parchment_color_id=None,
            line_no=3,
        )


def test_legacy_color_only_payload_infers_parchment_required():
    required, color_id, color = resolve_parchment_variant(
        parchment_required=None,
        parchment_color="Blue",
        parchment_color_id=None,
    )
    assert required is True
    assert color == "Blue"
    assert color_id is None


def test_delivery_schedule_and_bulk_import_share_create_rule():
    po_date = date(2026, 9, 24)
    validate_delivery_schedule_input(
        origin=ORIGIN_CUSTOMER_PO,
        customer_po_date=po_date,
        schedule_rows=[{"line_no": 1, "delivery_date": date(2026, 9, 30), "qty": 10}],
    )
    with pytest.raises(SalesCommercialError, match="Line 1: Delivery date must be after"):
        validate_delivery_schedule_input(
            origin=ORIGIN_CUSTOMER_PO,
            customer_po_date=po_date,
            schedule_rows=[{"line_no": 1, "delivery_date": date(2026, 9, 24), "qty": 10}],
        )

    with pytest.raises(SalesCommercialError, match="Delivery date must be after"):
        validate_bulk_import_order(
            {
                "origin": ORIGIN_CUSTOMER_PO,
                "customer_id": CUSTOMER_ID,
                "po_number": "PO-1",
                "po_date": po_date,
                "lines": [
                    {
                        "approved_spec_id": uuid.uuid4(),
                        "qty": 10,
                        "due_date": date(2026, 9, 24),
                        "parchment_required": False,
                    }
                ],
            }
        )

    validate_bulk_import_order(
        {
            "origin": ORIGIN_INTERNAL,
            "customer_id": CUSTOMER_ID,
            "internal_order_date": po_date,
            "lines": [
                {
                    "approved_spec_id": uuid.uuid4(),
                    "qty": 10,
                    "due_date": po_date,
                    "parchment_required": False,
                }
            ],
        }
    )


def test_approval_rejects_invalid_dates_and_unclassified_origin():
    po_date = date(2026, 9, 24)
    order = SimpleNamespace(
        origin=ORIGIN_CUSTOMER_PO,
        customer_id=CUSTOMER_ID,
        po_number="PO-9",
        po_date=po_date,
        internal_order_date=None,
        lines=[SimpleNamespace(line_no=1, due_date=date(2026, 9, 24))],
    )
    with pytest.raises(SalesCommercialError, match=r"Line 1: Delivery date must be after the Customer PO Date \(24 Sep 2026\)\."):
        validate_persisted_order(order)

    review_order = SimpleNamespace(
        origin=ORIGIN_REVIEW,
        customer_id=CUSTOMER_ID,
        po_number=None,
        po_date=None,
        internal_order_date=None,
        lines=[SimpleNamespace(line_no=1, due_date=date(2026, 9, 30))],
    )
    with pytest.raises(SalesCommercialError, match="flagged for review"):
        validate_persisted_order(review_order)


def test_header_date_change_revalidates_every_line():
    with pytest.raises(SalesCommercialError, match="Line 2:"):
        validate_order_lines_delivery_dates(
            origin=ORIGIN_CUSTOMER_PO,
            customer_po_date=date(2026, 9, 24),
            lines=[
                SimpleNamespace(line_no=1, due_date=date(2026, 9, 26)),
                SimpleNamespace(line_no=2, due_date=date(2026, 9, 24)),
            ],
        )
