"""Month-end close on real PostgreSQL (client 2026-10-28, spec 2.1 / 2.5 / 2.6).

Spec posting by IST day, once per card and never into a closed month; floor entries refused in exactly
the closed months; Owner close in month order with notes after the count, a frozen snapshot and the
store books locked; Owner re-open with a reason that also re-opens later months, newest first.
Inventory (month-figures, item catalog, books lock / unlock) is stubbed at the router's HTTP helpers.
"""
import os
import uuid
from datetime import date, datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

if 'hardening_test' not in os.environ.get('DATABASE_URL', ''):
    pytest.skip('Requires isolated hardening_test PostgreSQL database', allow_module_level=True)

from src.database import Base, SessionLocal, engine
from src.models import (
    JobCard,
    JobCardStage,
    MonthlyCloseEvent,
    MonthlyMaterialClose,
    MonthlyMaterialNote,
    MonthlyMaterialProvisional,
    SalesOrder,
)
from src.month_end_schema import run_month_end_close_migrations
from src.routers import entries, planning
from src.routers import reconciliation as reco

TODAY = date(2026, 11, 5)


@pytest.fixture()
def db():
    Base.metadata.create_all(engine)
    run_month_end_close_migrations(engine)
    conn = engine.connect()
    transaction = conn.begin()
    session = SessionLocal(bind=conn, join_transaction_mode='create_savepoint')
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        conn.close()


def _card(db, plant, **stage_end):
    order = SalesOrder(plant_id=plant, customer_id=uuid.uuid4(), spec_id=uuid.uuid4(), order_qty=100, due_date=date(2026, 11, 30))
    db.add(order)
    db.flush()
    job = JobCard(plant_id=plant, sales_order_id=order.id, spec_id=order.spec_id, planned_qty=100, released_qty=100,
                  job_card_no=f'T{uuid.uuid4().hex[:8]}', status='COMPLETED', current_stage='PROCESS')
    db.add(job)
    db.flush()
    for stage, ended in stage_end.items():
        db.add(JobCardStage(job_card_id=job.id, stage_type=stage, status='COMPLETED', actual_end=ended))
    db.flush()
    db.refresh(job)
    return job


def _close_row(db, plant, month, status='APPROVED'):
    db.add(MonthlyMaterialClose(plant_id=plant, month_start=month, status=status, imported_rows_count=0))
    db.flush()


@pytest.fixture()
def posting(monkeypatch):
    rows = [{'item_code': 'KRAFT-1', 'item_name': 'Kraft 1', 'provisional_theory_consumption_kg': 9.5, 'advisory_allocated_order_qty': 100},
            {'item_code': 'BOX-1', 'item_name': 'Box 1', 'provisional_theory_consumption_kg': 4.0, 'advisory_allocated_order_qty': 100, 'unit': 'PCS', 'pieces': 4}]
    for name in ('_fetch_paper_catalog_for_theory', '_fetch_inventory_item_catalog_for_theory', '_fetch_adhesive_catalog_for_theory'):
        monkeypatch.setattr(planning, name, lambda *args, **kwargs: {} if 'paper' in name or 'adhesive' in name else [])
    monkeypatch.setattr(planning, '_build_provisional_material_rows_for_job_card', lambda **kwargs: [dict(row) for row in rows])
    user = {'sub': 'floor@example.com', 'roles': ['PlantManager'], 'token': 't'}

    def post(db, job, stage):
        planning._upsert_monthly_provisional_theory(db=db, job_card=job, selected_stage=stage, token='t', plant_id=str(job.plant_id), current_user=user)
        db.flush()
        return db.query(MonthlyMaterialProvisional).filter_by(job_card_id=job.id).all()
    return post


def test_spec_posts_by_ist_day_once_per_card_and_never_into_two_months(db, posting):
    plant = uuid.uuid4()
    # Process closed 31 Oct 19:00 UTC = 1 Nov 00:30 IST: the spec belongs to November, not October.
    job = _card(db, plant, PROCESS=datetime(2026, 10, 31, 19, 0), PACKING=datetime(2026, 12, 2, 6, 0))
    rows = posting(db, job, 'PROCESS')
    assert {(row.month_start, row.item_code) for row in rows} == {(date(2026, 11, 1), 'KRAFT-1'), (date(2026, 11, 1), 'BOX-1')}
    assert rows[0].snapshot['posted_on'] == '2026-11-01'
    # Posting the same close again changes nothing (one posting per card per material).
    assert len(posting(db, job, 'PROCESS')) == 2
    # A later close of an older card moves the posting from the still-open month; it is never in two months.
    rows = posting(db, job, 'PACKING')
    assert {row.month_start for row in rows} == {date(2026, 12, 1)} and len(rows) == 2
    box = next(row for row in rows if row.item_code == 'BOX-1')
    assert box.snapshot['unit'] == 'PCS'


def test_spec_never_changes_a_closed_month(db, posting):
    plant = uuid.uuid4()
    _close_row(db, plant, date(2026, 10, 1))
    # The close is dated in closed October: it posts into the next open month and is flagged.
    late = _card(db, plant, PROCESS=datetime(2026, 10, 20, 9, 0))
    rows = posting(db, late, 'PROCESS')
    assert {row.month_start for row in rows} == {date(2026, 11, 1)}
    assert all(row.snapshot['posted_after_close'] == '2026-10' for row in rows)
    # A card already posted into a month that is now closed keeps that posting; a re-close posts nothing.
    done = _card(db, plant, PROCESS=datetime(2026, 9, 10, 9, 0), QC=datetime(2026, 11, 3, 9, 0))
    db.add(MonthlyMaterialProvisional(plant_id=plant, month_start=date(2026, 9, 1), job_card_id=done.id, item_code='KRAFT-1',
                                      provisional_theory_consumption_kg=5, advisory_allocated_order_qty=50, snapshot={}))
    _close_row(db, plant, date(2026, 9, 1))
    rows = posting(db, done, 'QC')
    assert [(row.month_start, row.provisional_theory_consumption_kg) for row in rows] == [(date(2026, 9, 1), 5)]


def test_floor_entries_are_refused_in_exactly_the_closed_months(db):
    plant = uuid.uuid4()
    _close_row(db, plant, date(2026, 9, 1))
    _close_row(db, plant, date(2026, 8, 1), status='OPEN')
    job = SimpleNamespace(plant_id=plant)
    for day in (date(2026, 8, 31), date(2026, 10, 1)):
        entries.validate_books(db, job, SimpleNamespace(kind='PRODUCTION', business_date=day))
    with pytest.raises(HTTPException) as refused:
        entries.validate_books(db, job, SimpleNamespace(kind='PRODUCTION', business_date=date(2026, 9, 30)))
    assert refused.value.status_code == 409 and refused.value.detail['code'] == 'BOOKS_LOCKED'
    assert refused.value.detail['message'] == 'September 2026 is closed. Ask the owner to re-open it.'
    entries.validate_books(db, job, SimpleNamespace(kind='QC_ONLY', business_date=date(2026, 9, 30)))


# ── close / re-open ──────────────────────────────────────────────────────────

CATALOG = {
    'KRAFT-1': {'id': str(uuid.uuid4()), 'item_code': 'KRAFT-1', 'name': 'Kraft 1', 'type': 'RAW_PAPER', 'uom': 'KG'},
    'BOX-1': {'id': str(uuid.uuid4()), 'item_code': 'BOX-1', 'name': 'Box 1', 'type': 'PACKAGING', 'uom': 'PCS'},
}


def _figures(month, kraft_issued, kraft_corrections=0.0, count_status='CERTIFIED'):
    kraft = {'item_id': CATALOG['KRAFT-1']['id'], 'item_code': 'KRAFT-1', 'item_name': 'Kraft 1', 'item_type': 'RAW_PAPER', 'uom': 'KG',
             'opening': 500.0, 'received': 100.0, 'opening_loads': 0.0, 'sent_back': 0.0, 'issued': kraft_issued,
             'corrections': kraft_corrections, 'count_variance': kraft_corrections,
             'closing': 600.0 - kraft_issued + kraft_corrections}
    kraft['actual_used'] = kraft['opening'] + kraft['received'] - kraft['sent_back'] - kraft['closing']
    box = {'item_id': CATALOG['BOX-1']['id'], 'item_code': 'BOX-1', 'item_name': 'Box 1', 'item_type': 'PACKAGING', 'uom': 'PCS',
           'opening': 200.0, 'received': 0.0, 'sent_back': 0.0, 'issued': 40.0, 'corrections': 0.0, 'closing': 160.0, 'actual_used': 40.0}
    count = {'id': str(uuid.uuid4()), 'count_no': f'SC/{month[2:4]}/{month[5:]}', 'status': count_status,
             'approved_by': 'owner@example.com', 'approved_at': '2026-11-01T06:00:00'} if count_status else None
    return {'month': month, 'opening_source': 'PREVIOUS_CLOSE', 'month_end_count': count, 'items': [kraft, box]}


@pytest.fixture()
def store(monkeypatch):
    state = SimpleNamespace(figures={}, calls=[], fetches=[], certified=None, count_note=None, counts={})
    reco._store_state_cache.clear()
    monkeypatch.setattr(reco, '_STORE_HINT_IN_BACKGROUND', False)  # the header probe runs inline on the test session
    monkeypatch.setattr(reco, '_fetch_month_end_counts', lambda token, plant: dict(state.counts) if state.counts is not None else None)
    monkeypatch.setattr(reco, '_consumption_ist_today', lambda: TODAY)
    monkeypatch.setattr(reco, '_fetch_certified_closings', lambda token, plant, count_id: state.certified)
    monkeypatch.setattr(reco, '_fetch_count_start_note', lambda token, plant, month: state.count_note)
    monkeypatch.setattr(reco, '_fetch_inventory_item_catalog', lambda token, plant: CATALOG)

    def figures(token, plant, month):
        state.fetches.append(month.strftime('%Y-%m'))
        return state.figures.get(month.strftime('%Y-%m'))
    monkeypatch.setattr(reco, '_fetch_month_figures', figures)

    def books(token, plant, action, body):
        state.calls.append((action, body['month']))
        return {'status': 'LOCKED' if action == 'lock' else 'UNLOCKED'}
    monkeypatch.setattr(reco, '_inventory_books_call', books)
    return state


def _scope(plant):
    return {'selected_plant_id': str(plant), 'scope_all': False, 'allowed_plants': [str(plant)]}


OWNER = {'sub': 'owner@example.com', 'roles': ['Owner'], 'actual_roles': ['Owner'], 'token': 't'}
PM = {'sub': 'pm@example.com', 'roles': ['PlantManager'], 'token': 't'}
ADMIN = {'sub': 'admin@example.com', 'roles': ['Admin'], 'actual_roles': ['Admin'], 'token': 't'}


def _seed_spec(db, plant, month, kraft=100.0, box=40.0, unknown=0.0):
    job = _card(db, plant)
    for code, qty, snapshot in (('KRAFT-1', kraft, {}), ('BOX-1', box, {'unit': 'PCS'}), ('GLUE', unknown, {})):
        if qty:
            db.add(MonthlyMaterialProvisional(plant_id=plant, month_start=month, job_card_id=job.id, item_code=code,
                                              provisional_theory_consumption_kg=qty, advisory_allocated_order_qty=100, snapshot=snapshot))
    db.flush()
    return job


def _view(db, plant, month, user=OWNER):
    return reco.month_end_overview(month=month, db=db, plant_scope=_scope(plant), current_user=user)


def test_figures_units_statuses_and_spec_not_linked(db, store):
    plant = uuid.uuid4()
    _seed_spec(db, plant, date(2026, 10, 1), kraft=100.0, box=40.0, unknown=3.5)
    store.figures['2026-10'] = _figures('2026-10', kraft_issued=120.0, kraft_corrections=-3.0)
    view = _view(db, plant, '2026-10')
    kraft = next(row for row in view['items'] if row['item_code'] == 'KRAFT-1')
    assert (kraft['spec'], kraft['expected'], kraft['issued'], kraft['actual_used']) == (100.0, 107.0, 120.0, 123.0)
    assert (kraft['floor_gap'], kraft['store_gap'], kraft['total_gap'], kraft['allowed_gap']) == (13.0, 3.0, 16.0, 7.49)
    assert kraft['status'] == 'OVER' and kraft['needs_note'] is True
    box = next(row for row in view['items'] if row['item_code'] == 'BOX-1')
    assert box['uom'] == 'PCS' and box['status'] == 'OK' and box['allowed_gap'] == 10.0
    assert [(unit['uom'], unit['issued']) for unit in view['units']] == [('KG', 120.0), ('PCS', 40.0)]
    assert [row['item_code'] for row in view['unlinked']] == ['GLUE']
    assert view['unlinked'][0]['fix_href'] == '/masters/adhesives'
    assert view['state'] == 'OPEN' and view['next']['kind'] == 'notes'
    # Before the count is approved nothing is known about actual use.
    store.figures['2026-10'] = _figures('2026-10', kraft_issued=120.0, count_status='SUBMITTED')
    waiting = _view(db, plant, '2026-10')
    kraft = next(row for row in waiting['items'] if row['item_code'] == 'KRAFT-1')
    assert kraft['status'] == 'NOT_KNOWN' and kraft['floor_gap'] == 13.0 and kraft['actual_used'] is None
    assert waiting['next']['kind'] == 'count' and waiting['can']['note'] is False


def test_close_in_order_with_notes_frozen_snapshot_and_reopen_cascade(db, store, monkeypatch):
    plant = uuid.uuid4()
    for month in (date(2026, 9, 1), date(2026, 10, 1)):
        _seed_spec(db, plant, month)
        store.figures[month.strftime('%Y-%m')] = _figures(month.strftime('%Y-%m'), kraft_issued=120.0)

    # Running month cannot be closed; October cannot close while September is open.
    with pytest.raises(HTTPException) as refused:
        reco.post_month_end_close(reco.MonthEndClosePayload(month='2026-11'), db, _scope(plant), OWNER)
    assert refused.value.status_code in (409, 422)
    with pytest.raises(HTTPException) as refused:
        reco.post_month_end_close(reco.MonthEndClosePayload(month='2026-10'), db, _scope(plant), OWNER)
    assert refused.value.status_code == 409 and any(step['key'] == 'earlier' for step in refused.value.detail['steps'])

    # September: kraft is outside its limit, so a note is needed first; only Owner / plant head write it.
    with pytest.raises(HTTPException) as refused:
        reco.post_month_end_close(reco.MonthEndClosePayload(month='2026-09'), db, _scope(plant), OWNER)
    assert refused.value.detail['steps'][0]['key'] == 'notes'
    note = reco.MonthEndNotePayload(month='2026-09', item_code='kraft-1', note='  Trial run on winder 2  ')
    with pytest.raises(HTTPException) as refused:
        reco.put_month_end_note(note, db, _scope(plant), ADMIN)
    assert refused.value.status_code == 403
    saved = reco.put_month_end_note(note, db, _scope(plant), PM)
    assert saved['note']['note'] == 'Trial run on winder 2'
    with pytest.raises(HTTPException) as refused:
        reco._require_actual_owner(ADMIN)
    assert refused.value.status_code == 403

    closed = reco.post_month_end_close(reco.MonthEndClosePayload(month='2026-09', note='September done'), db, _scope(plant), OWNER)
    assert closed['state'] == 'CLOSED' and closed['frozen'] is True and store.calls == [('lock', '2026-09')]
    row = db.query(MonthlyMaterialClose).filter_by(plant_id=plant, month_start=date(2026, 9, 1)).one()
    assert row.status == 'APPROVED' and row.closed_by == 'owner@example.com' and row.version == 1
    assert row.snapshot['limits'] and row.snapshot['items'] and row.snapshot['hash']
    # Closing again is a no-op (no second lock call, no second event).
    reco.post_month_end_close(reco.MonthEndClosePayload(month='2026-09'), db, _scope(plant), OWNER)
    assert store.calls == [('lock', '2026-09')]
    assert db.query(MonthlyCloseEvent).filter_by(plant_id=plant, event='CLOSED').count() == 1
    # Notes on a closed month are refused.
    with pytest.raises(HTTPException) as refused:
        reco.put_month_end_note(note, db, _scope(plant), PM)
    assert refused.value.status_code == 409
    assert refused.value.detail == {'code': 'BOOKS_LOCKED', 'message': 'September 2026 is closed. Ask the owner to re-open it.', 'month': '2026-09'}

    # Limits change and the live books move: the closed month keeps its frozen figures and says what changed.
    reco.put_month_end_limits(reco.UsageLimitsPayload(limits=[reco.UsageLimitInput(material_type='RAW_PAPER', normal_wastage_pct=10, allowed_gap_pct=7, min_gap=5)]),
                              db, _scope(plant), OWNER)
    store.figures['2026-09'] = _figures('2026-09', kraft_issued=130.0)
    frozen = _view(db, plant, '2026-09')
    kraft = next(item for item in frozen['items'] if item['item_code'] == 'KRAFT-1')
    assert (kraft['expected'], kraft['issued'], kraft['note']['note']) == (107.0, 120.0, 'Trial run on winder 2')
    assert frozen['changed_after_close'] == ['KRAFT-1']
    live_october = _view(db, plant, '2026-10')
    assert next(item for item in live_october['items'] if item['item_code'] == 'KRAFT-1')['expected'] == 110.0

    # October now closes in order (its kraft is within the new limit).
    store.figures['2026-10'] = _figures('2026-10', kraft_issued=112.0)
    reco.post_month_end_close(reco.MonthEndClosePayload(month='2026-10'), db, _scope(plant), OWNER)
    state = reco.get_books_state(db, _scope(plant), OWNER)
    assert state.locked_months == ['2026-09', '2026-10'] and state.locked_through == date(2026, 10, 31)

    # Re-open September: October re-opens first, then September; both with the reason, both in history.
    with pytest.raises(ValidationError):
        reco.MonthEndReopenPayload(month='2026-09', reason='no')
    result = reco.post_month_end_reopen(reco.MonthEndReopenPayload(month='2026-09', reason='Late GRN for kraft'), db, _scope(plant), OWNER)
    assert result['reopened_months'] == ['2026-10', '2026-09']
    assert store.calls[-2:] == [('unlock', '2026-10'), ('unlock', '2026-09')]
    assert result['state'] == 'OPEN' and result['close']['reopen_reason'] == 'Late GRN for kraft'
    events = [(row.month_start, row.event) for row in db.query(MonthlyCloseEvent).filter_by(plant_id=plant).order_by(MonthlyCloseEvent.created_at).all()]
    assert events.count((date(2026, 9, 1), 'REOPENED')) == 1 and events.count((date(2026, 10, 1), 'REOPENED')) == 1
    assert reco.get_books_state(db, _scope(plant), OWNER).locked_months == []
    entries.validate_books(db, SimpleNamespace(plant_id=plant), SimpleNamespace(kind='PRODUCTION', business_date=date(2026, 9, 15)))
    # A second close counts as version 2.
    store.figures['2026-09'] = _figures('2026-09', kraft_issued=110.0)
    reco.post_month_end_close(reco.MonthEndClosePayload(month='2026-09'), db, _scope(plant), OWNER)
    assert db.query(MonthlyMaterialClose).filter_by(plant_id=plant, month_start=date(2026, 9, 1)).one().version == 2


def test_notes_wait_for_the_count_and_the_store_lock_failure_keeps_the_month_open(db, store, monkeypatch):
    plant = uuid.uuid4()
    _seed_spec(db, plant, date(2026, 10, 1))
    store.figures['2026-10'] = _figures('2026-10', kraft_issued=100.0, count_status='DRAFT')
    with pytest.raises(HTTPException) as refused:
        reco.put_month_end_note(reco.MonthEndNotePayload(month='2026-10', item_code='KRAFT-1', note='x'), db, _scope(plant), PM)
    assert refused.value.status_code == 409 and 'count is approved' in refused.value.detail
    store.figures['2026-10'] = _figures('2026-10', kraft_issued=107.0)

    def refuse(token, plant_id, action, body):
        raise HTTPException(409, 'October 2026 is still running.')
    monkeypatch.setattr(reco, '_inventory_books_call', refuse)
    with pytest.raises(HTTPException):
        reco.post_month_end_close(reco.MonthEndClosePayload(month='2026-10'), db, _scope(plant), OWNER)
    assert db.query(MonthlyMaterialClose).filter_by(plant_id=plant, status='APPROVED').count() == 0


def test_months_list_default_and_financial_year(db, store):
    plant = uuid.uuid4()
    _seed_spec(db, plant, date(2026, 9, 1))
    _seed_spec(db, plant, date(2026, 10, 1))
    store.figures['2026-09'] = _figures('2026-09', kraft_issued=107.0)
    store.figures['2026-10'] = _figures('2026-10', kraft_issued=107.0)
    store.figures['2026-11'] = _figures('2026-11', kraft_issued=50.0, count_status=None)
    months = reco.month_end_months(db, _scope(plant), OWNER)
    assert months['default_month'] == '2026-09' and months['current_month'] == '2026-11'
    assert [row['month'] for row in months['months']] == ['2026-11', '2026-10', '2026-09']
    reco.post_month_end_close(reco.MonthEndClosePayload(month='2026-09'), db, _scope(plant), OWNER)
    assert reco.month_end_months(db, _scope(plant), OWNER)['default_month'] == '2026-10'
    year = reco.month_end_year(fy=None, db=db, plant_scope=_scope(plant), current_user=OWNER)
    assert year['fy'] == '2026-27' and len(year['months']) == 12
    assert [entry['status'] for entry in year['months'][5:9]] == ['CLOSED', 'OPEN', 'RUNNING', 'FUTURE']
    kg = next(unit for unit in year['totals'] if unit['uom'] == 'KG')
    assert kg['opening'] == 500.0 and kg['issued'] == 107.0 * 2 + 50.0
    assert year['complete'] is False and year['closing_label'] == 'Closing so far (Nov 2026)'
    march = reco._month_end_view(db, plant, date(2026, 10, 1), OWNER, today=TODAY)
    assert march['close_title'] == 'Close October 2026'
    assert reco._consumption_fy_label(date(2027, 3, 1)) == '2026-27'


def _store_only(month, received=300.0, issued=0.0, opening=0.0):
    """Month-figures of a month with store movement only (a go-live GRN, no job card posted spec)."""
    kraft = {'item_id': CATALOG['KRAFT-1']['id'], 'item_code': 'KRAFT-1', 'item_name': 'Kraft 1', 'item_type': 'RAW_PAPER', 'uom': 'KG',
             'opening': opening, 'received': received, 'opening_loads': 0.0, 'sent_back': 0.0, 'issued': issued, 'corrections': 0.0,
             'count_variance': 0.0, 'closing': opening + received - issued, 'actual_used': issued, 'has_movement': bool(received or issued)}
    return {'month': month, 'opening_source': 'BOOK_AT_START', 'month_end_count': None, 'items': [kraft]}


def test_a_month_with_only_store_activity_closes_in_order(db, store):
    plant = uuid.uuid4()
    # August: GRNs only (go-live). September and October: spec postings. July: nothing at all.
    store.figures['2026-07'] = _store_only('2026-07', received=0.0)
    store.figures['2026-08'] = _store_only('2026-08', received=300.0)
    for month in (date(2026, 9, 1), date(2026, 10, 1)):
        _seed_spec(db, plant, month)
        store.figures[month.strftime('%Y-%m')] = _figures(month.strftime('%Y-%m'), kraft_issued=107.0)

    months = reco.month_end_months(db, _scope(plant), OWNER)
    assert months['first_month'] == '2026-08' and months['default_month'] == '2026-08'
    august = next(row for row in months['months'] if row['month'] == '2026-08')
    assert august['has_activity'] is True and august['status'] == 'OPEN'
    assert '2026-07' not in [row['month'] for row in months['months']]

    september = _view(db, plant, '2026-09')
    earlier = next(step for step in september['checklist'] if step['key'] == 'earlier')
    assert earlier['state'] != 'done' and 'August 2026' in earlier['detail']
    assert september['earlier_open_months'] == ['2026-08']
    with pytest.raises(HTTPException) as refused:
        reco.post_month_end_close(reco.MonthEndClosePayload(month='2026-09'), db, _scope(plant), OWNER)
    assert refused.value.status_code == 409 and refused.value.detail['steps'][0]['key'] == 'earlier'
    assert store.calls == []
    # The header chip learns the store-only month from the probe (it never calls inventory itself).
    assert reco.get_books_state(db, _scope(plant), OWNER).oldest_open_month == '2026-08'

    # The financial year shows August as open work and April–July as quiet, with no store call for them.
    store.fetches.clear()
    year = reco.month_end_year(fy='2026-27', db=db, plant_scope=_scope(plant), current_user=OWNER)
    states = {entry['month']: (entry['status'], entry['has_activity']) for entry in year['months']}
    assert states['2026-06'] == ('OPEN', False) and states['2026-08'] == ('OPEN', True)
    assert not {'2026-04', '2026-05', '2026-06'} & set(store.fetches)
    assert len(store.fetches) == len(set(store.fetches))  # one month-figures call per month and request
    assert year['opening_label'] == 'Opening 1 Apr 2026'

    # Once August is counted and closed, September closes.
    store.figures['2026-08'] = {**_store_only('2026-08', received=300.0), 'month_end_count': {'id': str(uuid.uuid4()), 'count_no': 'C-8', 'status': 'CERTIFIED'}}
    reco.post_month_end_close(reco.MonthEndClosePayload(month='2026-08'), db, _scope(plant), OWNER)
    closed = reco.post_month_end_close(reco.MonthEndClosePayload(month='2026-09'), db, _scope(plant), OWNER)
    assert closed['state'] == 'CLOSED' and store.calls == [('lock', '2026-08'), ('lock', '2026-09')]


def test_notes_only_for_materials_of_the_month(db, store):
    plant = uuid.uuid4()
    _seed_spec(db, plant, date(2026, 10, 1))
    store.figures['2026-10'] = _figures('2026-10', kraft_issued=120.0)
    with pytest.raises(HTTPException) as refused:
        reco.put_month_end_note(reco.MonthEndNotePayload(month='2026-10', item_code='NOPE-XYZ', note='random'), db, _scope(plant), OWNER)
    assert refused.value.status_code == 422
    assert db.query(MonthlyMaterialNote).filter_by(plant_id=plant).count() == 0
    saved = reco.put_month_end_note(reco.MonthEndNotePayload(month='2026-10', item_code='box-1', note='Fewer boxes per bundle'), db, _scope(plant), OWNER)
    assert saved['note']['note'] == 'Fewer boxes per bundle'


def test_a_store_that_does_not_answer_never_leaves_the_two_services_apart(db, store, monkeypatch):
    plant = uuid.uuid4()
    _seed_spec(db, plant, date(2026, 10, 1))
    store.figures['2026-10'] = _figures('2026-10', kraft_issued=107.0)
    calls = []

    def lost_answer(token, plant_id, action, body):
        calls.append((action, body['month']))
        if action == 'lock' and len(calls) == 1:
            raise reco._BooksCallUnanswered(502, 'no answer')
        return {}
    monkeypatch.setattr(reco, '_inventory_books_call', lost_answer)
    with pytest.raises(HTTPException) as failed:
        reco.post_month_end_close(reco.MonthEndClosePayload(month='2026-10'), db, _scope(plant), OWNER)
    # The store month is given back, the month stays open here, and the message says so plainly.
    assert failed.value.status_code == 502 and 'was not closed' in failed.value.detail and 'Nothing was changed' not in failed.value.detail
    assert calls == [('lock', '2026-10'), ('unlock', '2026-10')]
    assert db.query(MonthlyMaterialClose).filter_by(plant_id=plant, status='APPROVED').count() == 0

    # Re-open: if the store's unlock answer is lost, the store month is locked again and production stays closed.
    reco.post_month_end_close(reco.MonthEndClosePayload(month='2026-10'), db, _scope(plant), OWNER)
    calls.clear()

    def lost_unlock(token, plant_id, action, body):
        calls.append((action, body['month']))
        if action == 'unlock':
            raise reco._BooksCallUnanswered(502, 'no answer')
        return {}
    monkeypatch.setattr(reco, '_inventory_books_call', lost_unlock)
    with pytest.raises(HTTPException) as failed:
        reco.post_month_end_reopen(reco.MonthEndReopenPayload(month='2026-10', reason='Late GRN'), db, _scope(plant), OWNER)
    assert failed.value.status_code == 502 and 'still closed' in failed.value.detail
    assert calls == [('unlock', '2026-10'), ('lock', '2026-10')]
    assert db.query(MonthlyMaterialClose).filter_by(plant_id=plant, status='APPROVED').count() == 1


def test_old_spec_rows_get_their_ist_day_and_month(db, store):
    plant = uuid.uuid4()
    # Process closed 31 Oct 20:00 UTC = 1 Nov 01:30 IST, but the old posting filed it under October (UTC).
    late = _card(db, plant, PROCESS=datetime(2026, 10, 31, 20, 0))
    on_time = _card(db, plant, PROCESS=datetime(2026, 10, 20, 6, 0))
    for job in (late, on_time):
        db.add(MonthlyMaterialProvisional(plant_id=plant, month_start=date(2026, 10, 1), job_card_id=job.id, item_code='KRAFT-1',
                                          provisional_theory_consumption_kg=10, advisory_allocated_order_qty=100, source_stage='PROCESS', snapshot={}))
    db.flush()
    assert reco._backfill_spec_posting_days(db, plant) == 2
    rows = {row.job_card_id: row for row in db.query(MonthlyMaterialProvisional).filter_by(plant_id=plant).all()}
    assert (rows[late.id].month_start, rows[late.id].snapshot['posted_on']) == (date(2026, 11, 1), '2026-11-01')
    assert (rows[on_time.id].month_start, rows[on_time.id].snapshot['posted_on']) == (date(2026, 10, 1), '2026-10-20')
    assert reco._backfill_spec_posting_days(db, plant) == 0  # idempotent


def test_old_form_stage_outputs_are_refused_in_a_closed_month(db):
    plant = uuid.uuid4()
    _close_row(db, plant, date(2026, 9, 1))
    with pytest.raises(HTTPException) as refused:
        entries.validate_books_day(db, plant, date(2026, 9, 30))
    assert refused.value.detail['code'] == 'BOOKS_LOCKED'
    entries.validate_books_day(db, plant, date(2026, 10, 1))


# ── round 2: store book, count drift, refusals, unit-differs links ────────────────────────────────────

def test_a_month_whose_store_book_does_not_add_up_never_closes(db, store):
    plant = uuid.uuid4()
    _seed_spec(db, plant, date(2026, 10, 1), kraft=100.0, box=40.0)
    figures = _figures('2026-10', kraft_issued=107.0)
    box = figures['items'][1]
    box.update(issued=260.0, closing=-60.0, actual_used=260.0)  # more boxes issued than the store ever had
    store.figures['2026-10'] = figures
    view = _view(db, plant, '2026-10')
    book = next(step for step in view['checklist'] if step['key'] == 'book')
    assert book['state'] == 'now' and 'below zero' in book['detail'] and '−60 pcs' in book['detail']
    assert book['action_href'] == '/inventory/stock-control?tab=book&month=2026-10' and book['items'] == ['BOX-1']
    assert view['book_problems'][0]['item_code'] == 'BOX-1' and view['can']['close'] is False
    assert view['next']['kind'] == 'book'
    with pytest.raises(HTTPException) as refused:
        reco.post_month_end_close(reco.MonthEndClosePayload(month='2026-10'), db, _scope(plant), OWNER)
    assert refused.value.status_code == 409 and refused.value.detail['code'] == 'MONTH_NOT_READY'
    assert [step['key'] for step in refused.value.detail['steps']][0] == 'book' and store.calls == []
    # The store's own check (a lot below zero, a ledger row the book leaves out) also stops the close.
    figures = _figures('2026-10', kraft_issued=107.0)
    figures['items'][0].update(identity_ok=False, book_problem_word='A lot goes below zero by the month end')
    store.figures['2026-10'] = figures
    view = _view(db, plant, '2026-10')
    book = next(step for step in view['checklist'] if step['key'] == 'book')
    assert book['state'] == 'now' and 'a lot goes below zero' in book['detail']
    store.figures['2026-10'] = _figures('2026-10', kraft_issued=107.0)
    assert next(step for step in _view(db, plant, '2026-10')['checklist'] if step['key'] == 'book')['state'] == 'done'


def test_store_entries_after_the_count_need_the_owner_to_accept_the_new_closing(db, store):
    plant = uuid.uuid4()
    _seed_spec(db, plant, date(2026, 10, 1))
    store.figures['2026-10'] = _figures('2026-10', kraft_issued=107.0)  # kraft closing 493, box 160
    store.certified = {CATALOG['KRAFT-1']['id']: 492.0, CATALOG['BOX-1']['id']: 160.0}  # a 1 kg GRN came after the count
    view = _view(db, plant, '2026-10')
    count = next(step for step in view['checklist'] if step['key'] == 'count')
    assert count['state'] == 'done' and 'counted 492 kg, closing now 493 kg' in count['warning']
    assert view['changed_since_count'] == [{'item_code': 'KRAFT-1', 'item_name': 'Kraft 1', 'unit_label': 'kg', 'counted': 492.0, 'closing': 493.0}]
    kraft = next(row for row in view['items'] if row['item_code'] == 'KRAFT-1')
    assert kraft['changed_since_count'] == {'counted': 492.0, 'closing': 493.0} and view['can']['close'] is True
    with pytest.raises(HTTPException) as refused:
        reco.post_month_end_close(reco.MonthEndClosePayload(month='2026-10'), db, _scope(plant), OWNER)
    assert refused.value.status_code == 409 and refused.value.detail['code'] == 'COUNT_CHANGED' and store.calls == []
    closed = reco.post_month_end_close(reco.MonthEndClosePayload(month='2026-10', accept_count_changes=True), db, _scope(plant), OWNER)
    assert closed['state'] == 'CLOSED' and store.calls == [('lock', '2026-10')]
    event = db.query(MonthlyCloseEvent).filter_by(plant_id=plant, event='CLOSED').one()
    assert event.details['accepted_after_count'] == ['KRAFT-1']
    row = db.query(MonthlyMaterialClose).filter_by(plant_id=plant, month_start=date(2026, 10, 1)).one()
    assert row.snapshot['changed_since_count'][0]['item_code'] == 'KRAFT-1'
    # No change since the count: no warning and nothing to accept.
    other = uuid.uuid4()
    _seed_spec(db, other, date(2026, 10, 1))
    store.certified = {CATALOG['KRAFT-1']['id']: 493.0, CATALOG['BOX-1']['id']: 160.0}
    view = _view(db, other, '2026-10')
    assert view['changed_since_count'] == [] and 'warning' not in next(step for step in view['checklist'] if step['key'] == 'count')


def test_a_month_the_store_will_not_count_says_why_instead_of_offering_a_count(db, store):
    plant = uuid.uuid4()
    for month in (date(2026, 8, 1), date(2026, 9, 1)):
        _seed_spec(db, plant, month)
    store.figures['2026-08'] = _figures('2026-08', kraft_issued=107.0, count_status=None)
    store.figures['2026-09'] = _figures('2026-09', kraft_issued=107.0)
    _close_row(db, plant, date(2026, 9, 1))
    view = _view(db, plant, '2026-08')
    count = next(step for step in view['checklist'] if step['key'] == 'count')
    assert count['blocked'] is True and count['detail'].startswith('September 2026 is already closed, so August can no longer be counted')
    assert count['action_href'] == '?month=2026-09' and view['next']['title'] == 'August cannot be counted now'
    # The store's own reason when it will not start the count.
    plant = uuid.uuid4()
    _seed_spec(db, plant, date(2026, 10, 1))
    store.figures['2026-10'] = _figures('2026-10', kraft_issued=107.0, count_status=None)
    store.count_note = 'The stock book starts in November 2026. There is nothing to count for October 2026.'
    count = next(step for step in _view(db, plant, '2026-10')['checklist'] if step['key'] == 'count')
    assert count['detail'] == store.count_note and 'action_href' not in count
    store.count_note = None
    count = next(step for step in _view(db, plant, '2026-10')['checklist'] if step['key'] == 'count')
    assert count['action_label'] == 'Count October stock' and not count.get('blocked')
    # Nothing in the store and nothing moved: nothing to count.
    store.figures['2026-10'] = _store_only('2026-10', received=0.0)
    count = next(step for step in _view(db, plant, '2026-10')['checklist'] if step['key'] == 'count')
    assert count['blocked'] is True and 'nothing to count' in count['detail']


def test_a_spec_in_another_unit_links_by_the_stock_items_own_type(db, store):
    plant = uuid.uuid4()
    job = _card(db, plant)
    # Box spec posted in kg while the box item counts in pieces.
    db.add(MonthlyMaterialProvisional(plant_id=plant, month_start=date(2026, 10, 1), job_card_id=job.id, item_code='BOX-1',
                                      provisional_theory_consumption_kg=190.0, advisory_allocated_order_qty=100, snapshot={}))
    db.flush()
    store.figures['2026-10'] = _figures('2026-10', kraft_issued=0.0)
    view = _view(db, plant, '2026-10')
    row = next(row for row in view['unlinked'] if row['item_code'] == 'BOX-1')
    assert (row['link'], row['kind'], row['fix_href']) == ('UNIT_DIFFERS', 'Packing', '/masters/packaging')
    assert row['reason'] == 'The spec is in kg but the stock item counts in pcs.'
    box = next(item for item in view['items'] if item['item_code'] == 'BOX-1')
    assert box['spec'] == 0.0 and box['spec_unlinked'] == {'spec': 190.0, 'unit_label': 'kg', 'job_cards': 1}


def test_unit_totals_keep_items_over_and_under_apart(db, store):
    plant = uuid.uuid4()
    _seed_spec(db, plant, date(2026, 10, 1), kraft=0.0, box=2600.0)
    figures = _figures('2026-10', kraft_issued=0.0)
    figures['items'][1].update(opening=3000.0, issued=2400.0, closing=600.0, actual_used=2400.0)
    figures['items'].append({'item_id': str(uuid.uuid4()), 'item_code': 'BOX-2', 'item_name': 'Box 2', 'item_type': 'PACKAGING', 'uom': 'PCS',
                             'opening': 500.0, 'received': 0.0, 'sent_back': 0.0, 'issued': 200.0, 'corrections': 0.0, 'closing': 300.0, 'actual_used': 200.0})
    store.figures['2026-10'] = figures
    pcs = next(unit for unit in _view(db, plant, '2026-10')['units'] if unit['uom'] == 'PCS')
    assert pcs['floor_gap'] == 0.0
    assert (pcs['floor_over_items'], pcs['floor_over'], pcs['floor_under_items'], pcs['floor_under']) == (1, 200.0, 1, 200.0)
    year = reco.month_end_year(fy='2026-27', db=db, plant_scope=_scope(plant), current_user=OWNER)
    pcs_year = next(unit for unit in year['totals'] if unit['uom'] == 'PCS')
    assert (pcs_year['floor_gap'], pcs_year['floor_over_items'], pcs_year['floor_under_items']) == (0.0, 1, 1)


def _count_of(payload):
    count = payload['month_end_count']
    return (count['id'], count['status'])


def test_a_month_with_only_an_approved_month_end_count_closes_in_order(db, store):
    """September has an approved month-end count but no spec and no store movement (its count posted in
    October). Every page must agree that September is waiting: months list, default month, October's
    checklist, the books chip and the Year view."""
    plant = uuid.uuid4()
    september = {**_store_only('2026-09', received=0.0), 'month_end_count': {'id': str(uuid.uuid4()), 'count_no': 'C-9', 'status': 'CERTIFIED',
                                                                              'approved_by': 'owner@example.com', 'approved_at': '2026-10-28T06:00:00'}}
    store.figures['2026-09'] = september
    store.counts = {date(2026, 9, 1): _count_of(september)}
    store.figures['2026-08'] = _store_only('2026-08', received=0.0)
    _seed_spec(db, plant, date(2026, 10, 1))
    store.figures['2026-10'] = _figures('2026-10', kraft_issued=107.0)
    store.figures['2026-11'] = _figures('2026-11', kraft_issued=10.0, count_status=None)

    months = reco.month_end_months(db, _scope(plant), OWNER)
    assert months['default_month'] == '2026-09' and months['first_month'] == '2026-09'
    assert next(row for row in months['months'] if row['month'] == '2026-09')['has_activity'] is True

    october = _view(db, plant, '2026-10')
    earlier = next(step for step in october['checklist'] if step['key'] == 'earlier')
    assert earlier['state'] != 'done' and 'September 2026' in earlier['detail'] and october['earlier_open_months'] == ['2026-09']
    assert reco.get_books_state(db, _scope(plant), OWNER).oldest_open_month == '2026-09'
    year = reco.month_end_year(fy='2026-27', db=db, plant_scope=_scope(plant), current_user=OWNER)
    states = {entry['month']: (entry['status'], entry['has_activity']) for entry in year['months']}
    assert states['2026-09'] == ('OPEN', True) and states['2026-08'] == ('OPEN', False)

    # September's own page offers the close; October waits for it.
    sep = _view(db, plant, '2026-09')
    assert sep['can']['close'] is True and sep['progress']['done'] == sep['progress']['total']
    with pytest.raises(HTTPException) as refused:
        reco.post_month_end_close(reco.MonthEndClosePayload(month='2026-10'), db, _scope(plant), OWNER)
    assert refused.value.detail['steps'][0]['key'] == 'earlier'
    reco.post_month_end_close(reco.MonthEndClosePayload(month='2026-09'), db, _scope(plant), OWNER)
    assert reco.post_month_end_close(reco.MonthEndClosePayload(month='2026-10'), db, _scope(plant), OWNER)['state'] == 'CLOSED'

    # A month-end count still being counted is open work too; a cancelled one is not (not listed).
    other = uuid.uuid4()
    _seed_spec(db, other, date(2026, 10, 1))
    store.counts = {date(2026, 8, 1): ('c-8', 'DRAFT')}
    assert reco.month_end_months(db, _scope(other), OWNER)['default_month'] == '2026-08'
    store.counts = {}
    reco._store_state_cache.clear()
    assert reco.month_end_months(db, _scope(other), OWNER)['default_month'] == '2026-10'


def test_ended_months_figures_are_read_once_for_a_few_minutes(db, store):
    """The Year view, the months list and the activity probe share recent store answers of ended months;
    the running month and a month's own page always ask again, and a count that changed drops the
    cached month at once. A close asks the store again for every month."""
    plant = uuid.uuid4()
    for month in (date(2026, 9, 1), date(2026, 10, 1)):
        _seed_spec(db, plant, month)
        store.figures[month.strftime('%Y-%m')] = _figures(month.strftime('%Y-%m'), kraft_issued=107.0)
    store.figures['2026-11'] = _figures('2026-11', kraft_issued=10.0, count_status=None)
    store.figures['2026-08'] = _store_only('2026-08', received=0.0)  # before go-live: the probe stops here
    store.counts = {date(2026, 9, 1): _count_of(store.figures['2026-09']), date(2026, 10, 1): _count_of(store.figures['2026-10'])}

    reco.month_end_year(fy='2026-27', db=db, plant_scope=_scope(plant), current_user=OWNER)
    assert sorted(store.fetches) == ['2026-08', '2026-09', '2026-10', '2026-11']
    store.fetches.clear()
    reco.month_end_year(fy='2026-27', db=db, plant_scope=_scope(plant), current_user=OWNER)
    reco.month_end_months(db, _scope(plant), OWNER)
    assert store.fetches == ['2026-11']  # only the running month again
    store.fetches.clear()
    _view(db, plant, '2026-09')
    assert store.fetches == ['2026-09']  # a month's own page is always live

    # October's count is sent back to counting: its cached figures are dropped on the next request.
    store.fetches.clear()
    store.figures['2026-10'] = _figures('2026-10', kraft_issued=107.0, count_status='DRAFT')
    store.counts[date(2026, 10, 1)] = _count_of(store.figures['2026-10'])
    year = reco.month_end_year(fy='2026-27', db=db, plant_scope=_scope(plant), current_user=OWNER)
    assert '2026-10' in store.fetches
    assert next(entry for entry in year['months'] if entry['month'] == '2026-10')['actual_known'] is False

    # The close decision never trusts the cache, and refuses when the store cannot list the counts.
    store.fetches.clear()
    store.counts = None
    with pytest.raises(HTTPException) as refused:
        reco.post_month_end_close(reco.MonthEndClosePayload(month='2026-09'), db, _scope(plant), OWNER)
    assert refused.value.status_code == 503 and store.calls == []
    assert reco.month_end_months(db, _scope(plant), OWNER)['default_month'] == '2026-09'  # a view still opens


def test_the_books_chip_knows_store_only_months_right_after_a_restart(db, store, monkeypatch):
    """After a restart nobody has opened Month-end close yet: the chip still finds the store-only August
    (r4: it said "Books open"), and says nothing for sure while the store does not answer."""
    plant = uuid.uuid4()
    store.figures['2026-07'] = _store_only('2026-07', received=0.0)
    store.figures['2026-08'] = _store_only('2026-08', received=300.0)
    for month in (date(2026, 9, 1), date(2026, 10, 1)):
        _seed_spec(db, plant, month)
        store.figures[month.strftime('%Y-%m')] = _figures(month.strftime('%Y-%m'), kraft_issued=107.0)
    reco._store_activity_hint.pop(str(plant), None)
    reco._store_hint_meta.pop(str(plant), None)

    state = reco.get_books_state(db, _scope(plant), OWNER)
    assert state.oldest_open_month == '2026-08' and state.store_months_known is True
    # The probe is remembered for the running month: the next chip read asks the store nothing.
    store.fetches.clear()
    assert reco.get_books_state(db, _scope(plant), OWNER).oldest_open_month == '2026-08'
    assert store.fetches == []

    # Another plant whose store does not answer: production's own months only, flagged as not known.
    other = uuid.uuid4()
    _seed_spec(db, other, date(2026, 9, 1))
    store.counts = None

    def down(token, plant_id, month):
        raise HTTPException(503, 'Store figures are unavailable right now. Try again in a minute.')
    monkeypatch.setattr(reco, '_fetch_month_figures', down)
    state = reco.get_books_state(db, _scope(other), OWNER)
    assert state.store_months_known is False and state.oldest_open_month == '2026-09'


def test_past_months_count_only_notes_outside_the_limit_as_explained(db, store):
    """A note kept on an item that is now within its limit is not an explanation (r4: "2 (3 explained)")."""
    plant = uuid.uuid4()
    snapshot = {'items': [
        {'item_code': 'E-B1', 'has_use': True, 'status': 'OVER', 'note': {'note': 'Trial'}},
        {'item_code': 'E-H1', 'has_use': True, 'status': 'UNDER', 'note': {'note': 'Recount'}},
        {'item_code': 'E-A1', 'has_use': True, 'status': 'OK', 'note': {'note': 'Earlier note'}},
        {'item_code': 'E-C1', 'has_use': True, 'status': 'OVER', 'note': None},
    ], 'units': []}
    db.add(MonthlyMaterialClose(plant_id=plant, month_start=date(2026, 9, 1), status=reco.CLOSED_STATUS, imported_rows_count=0,
                                version=1, snapshot=snapshot, closed_by='owner@example.com', closed_at=datetime(2026, 10, 2, 6, 0)))
    db.flush()
    store.figures['2026-09'] = _store_only('2026-09', received=0.0)
    store.figures['2026-08'] = _store_only('2026-08', received=0.0)
    september = next(row for row in reco.month_end_months(db, _scope(plant), OWNER)['months'] if row['month'] == '2026-09')
    assert september['summary']['over'] + september['summary']['under'] == 3
    assert september['summary']['explained'] == 2


def test_a_closed_month_names_an_earlier_month_open_with_activity(db, store):
    """Plant B (checker r2): August and September closed, then a July count approved; the closed pages
    said nothing of July, which moved their opening."""
    plant = uuid.uuid4()
    for month in (date(2026, 8, 1), date(2026, 9, 1)):
        db.add(MonthlyMaterialClose(plant_id=plant, month_start=month, status=reco.CLOSED_STATUS, imported_rows_count=0, version=1,
                                    snapshot={'items': [], 'units': []}, closed_by='owner@example.com', closed_at=datetime(2026, 10, 2, 6, 0)))
    db.flush()
    store.figures['2026-06'] = _store_only('2026-06', received=0.0)
    store.figures['2026-07'] = _store_only('2026-07', received=120.0)
    store.figures['2026-08'] = _store_only('2026-08', received=0.0, opening=120.0)
    store.figures['2026-09'] = _store_only('2026-09', received=0.0, opening=120.0)
    store.figures['2026-10'] = _store_only('2026-10', received=0.0, opening=120.0)
    september = _view(db, plant, '2026-09')
    assert september['state'] == 'CLOSED' and september['earlier_open_months'] == ['2026-07']
    # Still closed: the checklist stays done and nothing offers a close.
    assert all(step['state'] == 'done' for step in september['checklist']) and september['can']['close'] is False
    earlier = next(step for step in september['checklist'] if step['key'] == 'earlier')
    assert 'July 2026' in earlier['detail'] and 'open again' in earlier['detail']
