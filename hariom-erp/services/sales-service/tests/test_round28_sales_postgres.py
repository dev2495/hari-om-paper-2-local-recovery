"""Client round 28 Oct 2026, sales order decisions (isolated PostgreSQL).

* Delivery date is optional on the order and at release.
* Parchment colour is compulsory at release: a plain line must get a colour, else refused.
* Customer PO: free before release, ONCE after release (history with who/when), then locked.
* An order made without a customer PO is an internal order waiting for the PO; adding it confirms it.
* Last rate: the newest rate for the same customer and product, as a suggestion only.
"""
import os
import uuid
from datetime import date, timedelta

import pytest
from fastapi import HTTPException

if 'hardening_test' not in os.environ.get('DATABASE_URL', ''):
    pytest.skip('Requires isolated hardening_test PostgreSQL database', allow_module_level=True)

import src.main  # noqa: F401  create_all + startup DDL
from src.database import SessionLocal
from src.models import SalesOrder, SalesOrderStatus
from src.routers import sales_orders as so

MAKER = {'sub': 'sales@test', 'roles': ['Sales'], 'token': ''}
CHECKER = {'sub': 'owner@test', 'roles': ['Owner'], 'token': ''}
PLANT = 'PLANT-R28-TEST'
SCOPE = {'scope_all': False, 'selected_plant_id': PLANT}


@pytest.fixture()
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def _line(**overrides):
    values = dict(approved_spec_id=uuid.uuid4(), product_code='T135', size_label='135 x 120', qty=1000)
    values.update(overrides)
    return so.SalesOrderLineInput(**values)


def _order(db, *, customer=None, internal=False, lines=None, po=None):
    payload = so.SalesOrderCreate(
        customer_id=customer or uuid.uuid4(),
        origin='INTERNAL' if internal else 'CUSTOMER_PO',
        po_number=None if internal else (po or f'PO-{uuid.uuid4().hex[:6]}'),
        po_date=None if internal else date.today(),
        internal_order_date=date.today() if internal else None,
        lines=lines or [_line()],
    )
    return so.create_sales_order(payload, db=db, plant_id=PLANT, current_user=MAKER)


def _approve(db, order_id):
    db.get(SalesOrder, uuid.UUID(str(order_id))).status = SalesOrderStatus.APPROVED
    db.commit()


def _release(db, line_id, qty, color=None):
    return so.release_sales_order_line(
        uuid.UUID(str(line_id)),
        so.SalesOrderLineReleasePayload(release_qty=qty, winder_machine_id=uuid.uuid4(), parchment_color=color),
        db=db,
        plant_id=PLANT,
        current_user=CHECKER,
    )


def test_order_and_release_without_any_delivery_date(db):
    order = _order(db)
    assert order['lines'][0]['due_date'] is None
    _approve(db, order['id'])
    lot = _release(db, order['lines'][0]['id'], 400, color='Blue')
    assert lot['parchment_color'] == 'Blue'
    timeline = so.get_sales_order_timeline(uuid.UUID(str(order['id'])), db=db, plant_scope=SCOPE, current_user=CHECKER)
    line_event = next(row for row in timeline['events'] if row['event_type'] == 'SALES_ORDER_LINE_CREATED')
    assert line_event['metadata']['due_date'] == 'No date'


def test_a_given_delivery_date_must_still_follow_the_po_date(db):
    with pytest.raises(HTTPException) as error:
        _order(db, lines=[_line(due_date=date.today())])
    assert 'Delivery date must be after the Customer PO Date' in str(error.value.detail)


def test_plain_line_release_needs_a_parchment_colour_and_then_carries_it(db):
    order = _order(db, lines=[_line(parchment_required=False, qty=1000)])
    _approve(db, order['id'])
    line_id = order['lines'][0]['id']
    with pytest.raises(HTTPException) as error:
        _release(db, line_id, 400)
    assert error.value.status_code == 400 and 'parchment colour' in error.value.detail
    db.rollback()
    lot = _release(db, line_id, 400, color='Natural')
    assert lot['parchment_color'] == 'Natural'
    fresh = so.get_sales_order(uuid.UUID(str(order['id'])), db=db, plant_scope=SCOPE, current_user=CHECKER)
    line = fresh['lines'][0]
    assert line['parchment_required'] is True
    assert line['color_splits'][0]['color'] == 'Natural' and line['color_splits'][0]['released_qty'] == 400
    assert line['unassigned_color_qty'] == 600


def test_parchment_line_with_undecided_colour_is_refused_without_one(db):
    order = _order(db, lines=[_line(parchment_required=True, qty=1000)])
    _approve(db, order['id'])
    with pytest.raises(HTTPException) as error:
        _release(db, order['lines'][0]['id'], 400)
    assert 'choose the parchment colour' in error.value.detail


def test_internal_order_waits_for_customer_po_and_is_confirmed_when_it_is_added(db):
    order = _order(db, internal=True)
    assert order['awaiting_customer_po'] is True
    assert order['po_change_options']['mode'] == 'free'
    result = so.set_customer_po(uuid.UUID(str(order['id'])), so.CustomerPoPayload(po_number='CUST-77', po_date=date.today()),
                                db=db, plant_id=PLANT, current_user=MAKER)
    assert result['awaiting_customer_po'] is False
    assert result['origin'] == 'CUSTOMER_PO' and result['po_number'] == 'CUST-77'
    assert result['po_changes'][0]['kind'] == 'CONFIRMED' and result['po_changes'][0]['after_release'] is False
    assert result['internal_order_date'] == date.today()
    timeline = so.get_sales_order_timeline(uuid.UUID(str(order['id'])), db=db, plant_scope=SCOPE, current_user=CHECKER)
    assert any(row['event_type'] == 'SALES_ORDER_PO_CONFIRMED' for row in timeline['events'])
    # Before release the number stays freely editable.
    again = so.set_customer_po(uuid.UUID(str(order['id'])), so.CustomerPoPayload(po_number='CUST-78'), db=db, plant_id=PLANT, current_user=MAKER)
    assert again['po_change_options']['mode'] == 'free' and len(again['po_changes']) == 2


def test_customer_po_changes_once_after_release_then_locks(db):
    order = _order(db, po='FIRST-1')
    order_id = uuid.UUID(str(order['id']))
    _approve(db, order['id'])
    _release(db, order['lines'][0]['id'], 400, color='Blue')
    fresh = so.get_sales_order(order_id, db=db, plant_scope=SCOPE, current_user=CHECKER)
    assert fresh['po_change_options']['mode'] == 'once'
    changed = so.set_customer_po(order_id, so.CustomerPoPayload(po_number='FIRST-2', note='Customer re-issued the PO'),
                                 db=db, plant_id=PLANT, current_user=MAKER)
    assert changed['po_number'] == 'FIRST-2'
    assert changed['po_changes'][-1]['after_release'] is True and changed['po_changes'][-1]['old_po_number'] == 'FIRST-1'
    assert changed['po_change_options']['allowed'] is False and changed['po_change_options']['mode'] == 'locked'
    with pytest.raises(HTTPException) as error:
        so.set_customer_po(order_id, so.CustomerPoPayload(po_number='FIRST-3'), db=db, plant_id=PLANT, current_user=MAKER)
    assert error.value.status_code == 409 and 'already changed once after release' in error.value.detail
    timeline = so.get_sales_order_timeline(order_id, db=db, plant_scope=SCOPE, current_user=CHECKER)
    event = next(row for row in timeline['events'] if row['event_type'] == 'SALES_ORDER_PO_CHANGED')
    assert event['actor'] == 'sales@test' and 'one change allowed after release' in event['message']


def test_internal_order_confirmed_after_release_uses_the_one_change(db):
    order = _order(db, internal=True)
    order_id = uuid.UUID(str(order['id']))
    _approve(db, order['id'])
    _release(db, order['lines'][0]['id'], 400, color='Blue')
    with pytest.raises(HTTPException) as error:
        so.set_customer_po(order_id, so.CustomerPoPayload(po_number='LATE-1'), db=db, plant_id=PLANT, current_user=MAKER)
    assert error.value.status_code == 422 and 'PO date' in error.value.detail
    db.rollback()
    result = so.set_customer_po(order_id, so.CustomerPoPayload(po_number='LATE-1', po_date=date.today()), db=db, plant_id=PLANT, current_user=MAKER)
    assert result['po_changes'][-1]['kind'] == 'CONFIRMED' and result['po_changes'][-1]['after_release'] is True
    assert result['po_change_options']['mode'] == 'locked'


def test_last_rate_is_the_newest_for_the_same_customer_and_product(db):
    customer = uuid.uuid4()
    spec = uuid.uuid4()
    older = _order(db, customer=customer, lines=[_line(approved_spec_id=spec, rate_per_pc=11.5)])
    newest = _order(db, customer=customer, lines=[_line(approved_spec_id=spec, rate_per_pc=12.25)])
    other = _order(db, customer=uuid.uuid4(), lines=[_line(approved_spec_id=spec, rate_per_pc=99)])
    for row in (older, newest, other):
        _approve(db, row['id'])
    # A draft that is not approved yet (it may be mistyped) is never the suggestion.
    _order(db, customer=customer, lines=[_line(approved_spec_id=spec, rate_per_pc=9.41)])
    found = so.get_last_rate(customer_id=customer, approved_spec_id=spec, size_label=None, exclude_order_id=None,
                             db=db, plant_scope=SCOPE, current_user=MAKER)
    assert found['found'] is True and found['rate_per_pc'] == 12.25 and found['order_no'] == newest['order_no']
    # Editing the newest order itself suggests the one before it.
    previous = so.get_last_rate(customer_id=customer, approved_spec_id=spec, size_label=None, exclude_order_id=uuid.UUID(str(newest['id'])),
                                db=db, plant_scope=SCOPE, current_user=MAKER)
    assert previous['rate_per_pc'] == 11.5
    # A new spec version of the same size still finds the rate by size.
    by_size = so.get_last_rate(customer_id=customer, approved_spec_id=uuid.uuid4(), size_label='135 X 120', exclude_order_id=None,
                               db=db, plant_scope=SCOPE, current_user=MAKER)
    assert by_size['found'] is True and by_size['match'] == 'size'
    nothing = so.get_last_rate(customer_id=uuid.uuid4(), approved_spec_id=spec, size_label=None, exclude_order_id=None,
                               db=db, plant_scope=SCOPE, current_user=MAKER)
    assert nothing == {'found': False}


def test_one_change_after_release_stays_used_after_every_card_is_cancelled(db):
    # Checker 28 Oct: handing back the whole lot made the order "not released" and unlocked the PO again.
    order = _order(db, po='KEEP-1')
    order_id = uuid.UUID(str(order['id']))
    _approve(db, order['id'])
    lot = _release(db, order['lines'][0]['id'], 400, color='Blue')
    so.set_customer_po(order_id, so.CustomerPoPayload(po_number='KEEP-2'), db=db, plant_id=PLANT, current_user=MAKER)
    job_card_id = uuid.uuid4()
    lot_row = db.get(so.SalesOrderReleaseLot, uuid.UUID(str(lot['id'])))
    lot_row.job_card_id = job_card_id
    db.commit()
    so.return_release_lot_balance(uuid.UUID(str(lot['id'])), so.ReleaseLotReturnPayload(job_card_id=job_card_id, returned_qty=400, reason='cancelled'),
                                  db=db, plant_id=PLANT, current_user=CHECKER)
    fresh = so.get_sales_order(order_id, db=db, plant_scope=SCOPE, current_user=CHECKER)
    assert fresh['po_change_options']['mode'] == 'locked'
    with pytest.raises(HTTPException) as error:
        so.set_customer_po(order_id, so.CustomerPoPayload(po_number='KEEP-3'), db=db, plant_id=PLANT, current_user=MAKER)
    assert error.value.status_code == 409


def test_customer_po_date_cannot_be_in_the_future(db):
    order = _order(db, internal=True)
    with pytest.raises(HTTPException) as error:
        so.set_customer_po(uuid.UUID(str(order['id'])), so.CustomerPoPayload(po_number='FUT-1', po_date=date.today() + timedelta(days=30)),
                           db=db, plant_id=PLANT, current_user=MAKER)
    assert error.value.status_code == 422 and 'later than today' in error.value.detail


def test_put_with_a_po_number_confirms_an_internal_draft(db):
    # Checker 28 Oct: the number was dropped silently when origin was not sent.
    order = _order(db, internal=True)
    order_id = uuid.UUID(str(order['id']))
    with pytest.raises(HTTPException) as error:
        so.update_sales_order(order_id, so.SalesOrderUpdate(po_number='PUT-1'), db=db, plant_id=PLANT, current_user=MAKER)
    assert error.value.status_code in (400, 422) and 'PO Date' in str(error.value.detail)
    db.rollback()
    result = so.update_sales_order(order_id, so.SalesOrderUpdate(po_number='PUT-1', po_date=date.today()), db=db, plant_id=PLANT, current_user=MAKER)
    assert result['po_number'] == 'PUT-1' and result['origin'] == 'CUSTOMER_PO' and result['awaiting_customer_po'] is False
    assert result['po_changes'][-1]['kind'] == 'CONFIRMED'


def test_only_the_word_other_asks_for_a_note():
    from src.order_closure import reason_needs_note, validate_reason
    assert reason_needs_note('SO-OTHER') and reason_needs_note('OTHER') and reason_needs_note('SO_OTHERS')
    assert not reason_needs_note('SO-CUSTOMER-CHOSE-ANOTHER-SUPPLIER') and not reason_needs_note('SO-MOTHER-PLANT')
    assert validate_reason('SO-CUSTOMER-CHOSE-ANOTHER-SUPPLIER', '') == ('SO-CUSTOMER-CHOSE-ANOTHER-SUPPLIER', '')
    with pytest.raises(ValueError):
        validate_reason('SO-OTHER', '')


def test_cancelling_every_card_before_the_one_change_does_not_reopen_free_editing(db):
    # Checker 30 Oct: force-closing a card that made nothing put the order back to approved, the
    # PO became freely editable again, and after a re-release the "once" change was available too.
    order = _order(db, po='TWICE-1')
    order_id = uuid.UUID(str(order['id']))
    _approve(db, order['id'])
    lot = _release(db, order['lines'][0]['id'], 400, color='Blue')
    job_card_id = uuid.uuid4()
    db.get(so.SalesOrderReleaseLot, uuid.UUID(str(lot['id']))).job_card_id = job_card_id
    db.commit()
    so.return_release_lot_balance(uuid.UUID(str(lot['id'])), so.ReleaseLotReturnPayload(job_card_id=job_card_id, returned_qty=400, reason='nothing made'),
                                  db=db, plant_id=PLANT, current_user=CHECKER)
    fresh = so.get_sales_order(order_id, db=db, plant_scope=SCOPE, current_user=CHECKER)
    assert fresh['status'] == 'approved'
    assert fresh['po_change_options']['mode'] == 'once'
    changed = so.set_customer_po(order_id, so.CustomerPoPayload(po_number='TWICE-2'), db=db, plant_id=PLANT, current_user=MAKER)
    assert changed['po_changes'][-1]['after_release'] is True
    _release(db, order['lines'][0]['id'], 400, color='Blue')
    with pytest.raises(HTTPException) as error:
        so.set_customer_po(order_id, so.CustomerPoPayload(po_number='TWICE-3'), db=db, plant_id=PLANT, current_user=MAKER)
    assert error.value.status_code == 409


def test_quantity_edit_of_an_old_card_released_without_a_colour_is_allowed(db):
    # Checker 30 Oct: a plain-line card released before 28 Oct (no parchment colour) could no
    # longer have its quantity changed from planning, because the compulsory colour rule ran.
    order = _order(db, lines=[_line(parchment_required=False, qty=1000)])
    _approve(db, order['id'])
    line_row = db.get(so.SalesOrderLine, uuid.UUID(str(order['lines'][0]['id'])))
    job_card_id = uuid.uuid4()
    legacy = so.SalesOrderReleaseLot(
        sales_order_line_id=line_row.id, sales_order_id=line_row.sales_order_id, winder_machine_id=uuid.uuid4(),
        released_qty=400, status='released', job_card_id=job_card_id, parchment_color=None,
    )
    db.add(legacy)
    line_row.sales_order.status = SalesOrderStatus.PARTIALLY_RELEASED
    db.commit()
    amended = so.amend_release_lot(legacy.id, so.ReleaseLotAmendPayload(job_card_id=job_card_id, release_qty=300),
                                   db=db, plant_id=PLANT, current_user=CHECKER)
    assert amended['release_qty'] == 300 and amended['parchment_color'] is None
    # A new release on that line still needs a colour.
    with pytest.raises(HTTPException):
        _release(db, order['lines'][0]['id'], 200)


def test_po_date_only_change_on_a_draft_is_kept_in_the_history(db):
    order = _order(db, po='DATE-1')
    order_id = uuid.UUID(str(order['id']))
    earlier = date.today() - timedelta(days=2)
    result = so.update_sales_order(order_id, so.SalesOrderUpdate(po_date=earlier), db=db, plant_id=PLANT, current_user=MAKER)
    assert result['po_date'] == earlier
    assert result['po_changes'][-1]['old_po_date'] == date.today().isoformat()
    assert result['po_changes'][-1]['new_po_date'] == earlier.isoformat()
    timeline = so.get_sales_order_timeline(order_id, db=db, plant_scope=SCOPE, current_user=CHECKER)
    assert any(row['title'] == 'Customer PO date changed' for row in timeline['events'])
    # Saving notes only records nothing more.
    again = so.update_sales_order(order_id, so.SalesOrderUpdate(notes='just a note'), db=db, plant_id=PLANT, current_user=MAKER)
    assert len(again['po_changes']) == len(result['po_changes'])


# --- Checker 30 Oct: "there is no none" holds on the API too -----------------------------------
from src import parchment_master as pm  # noqa: E402

RED_ID = uuid.UUID('de3af734-94c2-4c85-9849-b0a3aba6f09d')
MASTER_ROWS = [{'id': str(RED_ID), 'color_name': 'RED', 'label': 'RED / SAGAR POLYFILMS'}]


@pytest.fixture()
def signed_in(monkeypatch):
    """Behave like an HTTP call: a sign-in is present, and the master answers with one colour (RED)."""
    token = pm._REQUEST.set({'authorization': 'Bearer test', 'plant': PLANT, 'cache': {'colours': MASTER_ROWS}})
    yield
    pm._REQUEST.reset(token)


@pytest.mark.parametrize('word', ['None', 'NONE', '-', 'no parchment', 'No Parchment', 'N/A', '—'])
def test_a_placeholder_word_is_never_a_release_colour(db, word):
    order = _order(db, lines=[_line(parchment_required=False, qty=300)])
    _approve(db, order['id'])
    with pytest.raises(HTTPException) as error:
        _release(db, order['lines'][0]['id'], 100, color=word)
    assert error.value.status_code == 400 and 'is not a parchment colour' in error.value.detail


def test_a_made_up_colour_is_refused_and_a_master_colour_is_taken_with_its_id(db, signed_in):
    order = _order(db, lines=[_line(parchment_required=False, qty=300)])
    _approve(db, order['id'])
    line_id = order['lines'][0]['id']
    with pytest.raises(HTTPException) as error:
        _release(db, line_id, 100, color='NOT-A-REAL-COLOUR-9AEE4')
    assert error.value.status_code == 400 and 'not in the parchment colour list' in error.value.detail
    db.rollback()
    lot = _release(db, line_id, 100, color='red / sagar polyfilms')
    assert lot['parchment_color'] == 'red / sagar polyfilms'
    assert str(lot['parchment_color_id']) == str(RED_ID)


def test_bulk_release_with_only_the_master_id_gets_the_master_name(db, signed_in):
    order = _order(db, lines=[_line(parchment_required=False, qty=300)])
    _approve(db, order['id'])
    row = so.BulkReleaseLinePayload(line_id=uuid.UUID(str(order['lines'][0]['id'])), release_qty=100,
                                    winder_machine_id=uuid.uuid4(), parchment_color_id=RED_ID)
    result = so.bulk_release_sales_order_lines([row], db=db, plant_id=PLANT, current_user=CHECKER)
    lot = result['lots'][0]
    assert lot['parchment_color'] == 'RED / SAGAR POLYFILMS'


def test_an_order_line_cannot_be_saved_with_a_none_or_made_up_colour(db, signed_in):
    for colour, message in (('None', 'is not a parchment colour'), ('PURPLE-RAIN', 'not in the parchment colour list')):
        with pytest.raises(HTTPException) as error:
            _order(db, lines=[_line(parchment_required=True, qty=300, color_splits=[{'color': colour, 'qty': 300}])])
        assert message in error.value.detail
        db.rollback()
    order = _order(db, lines=[_line(parchment_required=True, qty=300, color_splits=[{'color': 'RED', 'color_id': str(RED_ID), 'qty': 300}])])
    assert order['lines'][0]['color_splits'][0]['color'] == 'RED'


def test_a_colour_already_on_the_order_is_released_without_a_master_lookup(db):
    order = _order(db, lines=[_line(parchment_required=True, qty=300, color_splits=[{'color': 'Blue', 'qty': 300}])])
    _approve(db, order['id'])
    token = pm._REQUEST.set({'authorization': 'Bearer test', 'plant': PLANT, 'cache': {'colours': []}})
    try:
        lot = _release(db, order['lines'][0]['id'], 100, color='Blue')
    finally:
        pm._REQUEST.reset(token)
    assert lot['parchment_color'] == 'Blue'


def test_the_same_master_colour_by_id_then_by_name_stays_one_colour_row(db, signed_in):
    order = _order(db, lines=[_line(parchment_required=False, qty=300)])
    _approve(db, order['id'])
    line_id = uuid.UUID(str(order['lines'][0]['id']))
    by_id = so.BulkReleaseLinePayload(line_id=line_id, release_qty=50, winder_machine_id=uuid.uuid4(), parchment_color_id=RED_ID)
    so.bulk_release_sales_order_lines([by_id], db=db, plant_id=PLANT, current_user=CHECKER)
    lot = _release(db, line_id, 50, color='RED / SAGAR POLYFILMS')
    assert str(lot['parchment_color_id']) == str(RED_ID)
    fresh = so.get_sales_order(uuid.UUID(str(order['id'])), db=db, plant_scope=SCOPE, current_user=CHECKER)
    splits = fresh['lines'][0]['color_splits']
    assert [(row['color'], row['qty']) for row in splits] == [('RED / SAGAR POLYFILMS', 100.0)]
    assert fresh['lines'][0]['parchment_color'] == 'RED / SAGAR POLYFILMS'


def test_bulk_refusal_reads_as_one_sentence(db):
    order = _order(db, lines=[_line(parchment_required=False, qty=300)])
    _approve(db, order['id'])
    row = so.BulkReleaseLinePayload(line_id=uuid.UUID(str(order['lines'][0]['id'])), release_qty=50, winder_machine_id=uuid.uuid4(), parchment_color='None')
    with pytest.raises(HTTPException) as error:
        so.bulk_release_sales_order_lines([row], db=db, plant_id=PLANT, current_user=CHECKER)
    assert '..' not in error.value.detail and error.value.detail.endswith('list. Nothing was released.')
