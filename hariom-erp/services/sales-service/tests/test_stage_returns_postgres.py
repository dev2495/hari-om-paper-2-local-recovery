"""Stage short-close returns (owner decision 1, 2026-11-01) on an isolated PostgreSQL database.

A job card stage closed short gives its unmade balance back to the order line at once; Sales can release it
again or short-close the order. A reopen takes it back only while the line still has it unreleased."""
import os
import uuid
from datetime import date

import pytest
from fastapi import HTTPException

if 'hardening_test' not in os.environ.get('DATABASE_URL', ''):
    pytest.skip('Requires isolated hardening_test PostgreSQL database', allow_module_level=True)

import src.main  # noqa: F401  create_all + startup DDL
from src.database import SessionLocal
from src.models import SalesOrder, SalesOrderStatus
from src.routers import release_returns as rr
from src.routers import sales_orders as so

MAKER = {'sub': 'sales@test', 'roles': ['Sales'], 'token': ''}
CHECKER = {'sub': 'owner@test', 'roles': ['Owner'], 'token': ''}
PRODUCTION = {'sub': 'production-completion-worker', 'roles': ['ProductionEffects'], 'token': ''}
PLANT = 'PLANT-RETURNS-TEST'
SCOPE = {'scope_all': False, 'selected_plant_id': PLANT}


@pytest.fixture()
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def _released(db, qty=1000, release=1000):
    payload = so.SalesOrderCreate(customer_id=uuid.uuid4(), origin='CUSTOMER_PO', po_number=f'PO-{uuid.uuid4().hex[:6]}', po_date=date.today(),
                                  lines=[so.SalesOrderLineInput(approved_spec_id=uuid.uuid4(), product_code='T135', size_label='135 x 120', qty=qty)])
    order = so.create_sales_order(payload, db=db, plant_id=PLANT, current_user=MAKER)
    db.get(SalesOrder, uuid.UUID(str(order['id']))).status = SalesOrderStatus.APPROVED
    db.commit()
    line_id = uuid.UUID(str(order['lines'][0]['id']))
    lot = so.release_sales_order_line(line_id, so.SalesOrderLineReleasePayload(release_qty=release, winder_machine_id=uuid.uuid4(), parchment_color='Blue'),
                                      db=db, plant_id=PLANT, current_user=CHECKER)
    card = uuid.uuid4()
    db.get(so.SalesOrderReleaseLot, uuid.UUID(str(lot['id']))).job_card_id = card
    db.commit()
    return uuid.UUID(str(order['id'])), line_id, uuid.UUID(str(lot['id'])), card


def _return(db, lot, card, qty, key='card:WINDER:close:1'):
    return rr.stage_return(lot, rr.StageReturnPayload(job_card_id=card, return_key=key, qty=qty, stage='WINDER', reason='Paper ran out'), db=db, plant_id=PLANT, current_user=PRODUCTION)


def _reverse(db, lot, card, key='card:WINDER:close:1'):
    return rr.reverse_stage_return(lot, rr.StageReturnReversePayload(job_card_id=card, return_key=key, reason='Reopened'), db=db, plant_id=PLANT, current_user=CHECKER)


def test_short_close_balance_goes_back_to_the_line_and_can_be_short_closed(db):
    order_id, line_id, lot, card = _released(db)
    result = _return(db, lot, card, 600)
    assert result['lot']['release_qty'] == 400 and result['lot']['returned_qty'] == 600 and result['lot']['status'] == 'released'
    assert _return(db, lot, card, 600)['replayed'] is True  # a retry never returns twice
    with pytest.raises(HTTPException) as other_qty:
        _return(db, lot, card, 500)
    assert other_qty.value.status_code == 409
    second = _return(db, lot, card, 20, key='card:OVEN:close:1')
    assert second['lot']['release_qty'] == 380 and second['lot']['returned_qty'] == 620
    fresh = so.get_sales_order(order_id, db=db, plant_scope=SCOPE, current_user=CHECKER)
    assert fresh['closure_options']['short_close']['allowed'] and fresh['closure_options']['drop_qty'] == 620
    # The returned pcs can be released again on a new card.
    again = so.release_sales_order_line(line_id, so.SalesOrderLineReleasePayload(release_qty=600, winder_machine_id=uuid.uuid4(), parchment_color='Blue'),
                                        db=db, plant_id=PLANT, current_user=CHECKER)
    assert again['release_qty'] == 600


def test_reverse_gives_the_pcs_back_to_the_card_only_while_unreleased(db):
    order_id, line_id, lot, card = _released(db)
    _return(db, lot, card, 600)
    reversed_ = _reverse(db, lot, card)
    assert reversed_['lot']['release_qty'] == 1000 and reversed_['lot']['returned_qty'] == 0 and reversed_['return']['status'] == 'REVERSED'
    assert _reverse(db, lot, card)['replayed'] is True
    _return(db, lot, card, 600, key='card:WINDER:close:2')
    so.release_sales_order_line(line_id, so.SalesOrderLineReleasePayload(release_qty=500, winder_machine_id=uuid.uuid4(), parchment_color='Blue'),
                                db=db, plant_id=PLANT, current_user=CHECKER)
    with pytest.raises(HTTPException) as taken:
        _reverse(db, lot, card, key='card:WINDER:close:2')
    assert taken.value.status_code == 409 and 'only 100 of the 600 pcs' in taken.value.detail


def test_return_after_order_short_close_is_dropped_and_cannot_be_reversed(db):
    order_id, line_id, lot, card = _released(db, qty=1200, release=1000)
    so.short_close_sales_order(order_id, so.SalesOrderClosurePayload(reason_code='SO-CUSTOMER-CANCELLED', note='Customer stopped the order'),
                               db=db, plant_id=PLANT, current_user=CHECKER) if hasattr(so, 'SalesOrderClosurePayload') else None
    order = db.get(SalesOrder, order_id)
    if str(order.closure_kind or '').upper() != 'SHORT_CLOSED':
        pytest.skip('order short close needs a reason code master in this database')
    result = _return(db, lot, card, 300)
    assert result['return']['dropped'] is True
    line = db.get(so.SalesOrderLine, line_id)
    assert float(line.qty) == 700  # the balance was dropped, not made releasable
    with pytest.raises(HTTPException) as dropped:
        _reverse(db, lot, card)
    assert dropped.value.status_code == 409 and 'short-closed' in dropped.value.detail


# ── Reasons are master codes (owner decision 4, 1 Nov 2026): production checks the code, Sales stores what it sent ──


def test_stage_return_and_force_close_keep_the_reason_code_and_label_for_the_timeline(db):
    order_id, line_id, lot, card = _released(db)
    result = rr.stage_return(lot, rr.StageReturnPayload(job_card_id=card, return_key='card:WINDER:close:1', qty=300, stage='WINDER',
                                                        reason='Paper or input short — reel 12 wet', reason_code='ss-material-short',
                                                        reason_label='Paper or input short', reason_note='reel 12 wet'),
                             db=db, plant_id=PLANT, current_user=PRODUCTION)
    assert (result['return']['reason_code'], result['return']['reason_label'], result['return']['reason_note']) == ('SS-MATERIAL-SHORT', 'Paper or input short', 'reel 12 wet')
    assert result['return']['reason'] == 'Paper or input short — reel 12 wet'
    reversed_ = rr.reverse_stage_return(lot, rr.StageReturnReversePayload(job_card_id=card, return_key='card:WINDER:close:1', reason='Entered wrongly',
                                                                          reason_code='EC-ENTRY-ERROR', reason_label='Entered wrongly'),
                                        db=db, plant_id=PLANT, current_user=CHECKER)
    row = db.query(so.SalesOrderReleaseLotReturn).filter_by(release_lot_id=lot).one()
    assert reversed_['return']['status'] == 'REVERSED' and (row.reverse_reason_code, row.reverse_reason_label) == ('EC-ENTRY-ERROR', 'Entered wrongly')

    so.return_release_lot_balance(lot, so.ReleaseLotReturnPayload(job_card_id=card, returned_qty=400, reason='Paper or material short — no kraft',
                                                                 reason_code='JC-MATERIAL-SHORT', reason_label='Paper or material short', reason_note='no kraft'),
                                  db=db, plant_id=PLANT, current_user=CHECKER)
    stored = db.get(so.SalesOrderReleaseLot, lot)
    assert (stored.returned_reason_code, stored.returned_reason_label, stored.returned_reason_note, stored.returned_reason) == (
        'JC-MATERIAL-SHORT', 'Paper or material short', 'no kraft', 'Paper or material short — no kraft')
    timeline = so.get_sales_order_timeline(order_id, depth=None, db=db, plant_scope=SCOPE, current_user=CHECKER)
    returned = next(e for e in timeline['events'] if e['event_type'] == 'SALES_ORDER_LOT_RETURNED')
    assert returned['message'].endswith('— Paper or material short')



def test_force_close_return_says_whether_the_pcs_went_back_or_were_dropped(db):
    """Issue #8: the cancel result says "back on the order" only when they are; a short-closed order drops them."""
    order_id, line_id, lot, card = _released(db, qty=1200, release=1000)
    back = so.return_release_lot_balance(lot, so.ReleaseLotReturnPayload(job_card_id=card, returned_qty=400, reason='Nothing made'),
                                         db=db, plant_id=PLANT, current_user=CHECKER)
    assert back['balance_dropped'] is False
    order_id, line_id, lot, card = _released(db, qty=1200, release=1000)
    db.get(SalesOrder, order_id).closure_kind = 'SHORT_CLOSED'
    db.commit()
    dropped = so.return_release_lot_balance(lot, so.ReleaseLotReturnPayload(job_card_id=card, returned_qty=400, reason='Nothing made'),
                                            db=db, plant_id=PLANT, current_user=CHECKER)
    assert dropped['balance_dropped'] is True
    assert float(db.get(so.SalesOrderLine, line_id).qty) == 600  # 1000 released - 400 handed back; the rest dropped
    # A retry answers the same.
    assert so.return_release_lot_balance(lot, so.ReleaseLotReturnPayload(job_card_id=card, returned_qty=400, reason='Nothing made'),
                                         db=db, plant_id=PLANT, current_user=CHECKER)['balance_dropped'] is True
