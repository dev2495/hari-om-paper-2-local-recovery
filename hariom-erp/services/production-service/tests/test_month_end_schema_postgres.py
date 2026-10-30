"""Month-end close schema: frozen snapshot columns, close history, per-item notes and usage limits,
with old data copied once (client 2026-10-28, isolated PostgreSQL)."""
import os
import uuid
from datetime import date, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

if 'hardening_test' not in os.environ.get('DATABASE_URL', ''):
    pytest.skip('Requires isolated hardening_test PostgreSQL database', allow_module_level=True)

from src.database import Base, SessionLocal, engine
from src.models import MonthlyCloseEvent, MonthlyMaterialNote, PlantUsageLimit
from src.month_end_schema import MONTH_END_CLOSE_MIGRATIONS, run_month_end_close_migrations
from src.services.usage_limits import usage_limits_for_plant


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


def test_limits_fall_back_to_the_spec_and_a_saved_row_wins(db):
    plant = uuid.uuid4()
    limits = usage_limits_for_plant(db, plant)
    assert set(limits) == {'RAW_PAPER', 'ADHESIVE', 'PARCHMENT', 'PACKAGING', 'OTHER'}
    assert limits['RAW_PAPER']['normal_wastage_pct'] == 7.0 and limits['RAW_PAPER']['source'] == 'DEFAULT'
    db.add(PlantUsageLimit(plant_id=plant, material_type='ADHESIVE', normal_wastage_pct=2, allowed_gap_pct=5, min_gap=0.25, updated_by='owner@example.com'))
    db.flush()
    adhesive = usage_limits_for_plant(db, plant)['ADHESIVE']
    assert (adhesive['normal_wastage_pct'], adhesive['allowed_gap_pct'], adhesive['min_gap'], adhesive['source']) == (2.0, 5.0, 0.25, 'PLANT')
    assert usage_limits_for_plant(db, plant)['PACKAGING']['min_gap'] == 10.0
    db.add(PlantUsageLimit(plant_id=plant, material_type='ADHESIVE', normal_wastage_pct=0, allowed_gap_pct=7, min_gap=1))
    with pytest.raises(IntegrityError):
        db.flush()


def test_one_note_per_item_per_month_and_close_history(db):
    plant = uuid.uuid4()
    db.add(MonthlyMaterialNote(plant_id=plant, month_start=date(2026, 10, 1), item_code='KRAFT-1', note='Trial run on winder 2', noted_by='pm@example.com'))
    db.add(MonthlyCloseEvent(plant_id=plant, month_start=date(2026, 10, 1), event='CLOSED', actor='owner@example.com', details={'snapshot_rows': 30}))
    db.add(MonthlyCloseEvent(plant_id=plant, month_start=date(2026, 10, 1), event='REOPENED', actor='owner@example.com', reason='Late GRN'))
    db.flush()
    db.add(MonthlyMaterialNote(plant_id=plant, month_start=date(2026, 10, 1), item_code='KRAFT-1', note='Second note'))
    with pytest.raises(IntegrityError):
        db.flush()


def test_old_close_rows_notes_and_bands_are_copied_once():
    """Runs the backfills on old-shaped rows inside a transaction that is rolled back."""
    plant = uuid.uuid4()
    Base.metadata.create_all(engine)
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            for table in ('monthly_material_notes', 'plant_usage_limits'):
                connection.execute(text(f'DELETE FROM {table}'))
            connection.execute(text(
                "INSERT INTO monthly_material_close (id, plant_id, month_start, status, imported_rows_count, approved_by, approved_at, "
                "locked_at, notes, created_at, updated_at) VALUES (:id, :plant, '2026-09-01', 'APPROVED', 0, 'owner@example.com', "
                ":at, :at, 'September closed', now(), now())"), {'id': uuid.uuid4(), 'plant': plant, 'at': datetime(2026, 10, 3, 6, 0)})
            for code, note, at in (('KRAFT-1', 'Trial run', datetime(2026, 10, 2)), ('KRAFT-1', 'Trial run on winder 2', datetime(2026, 10, 3)),
                                   ('ADH-1', 'Stock count SC/26/09: opening 10 + received 5 - counted 3', datetime(2026, 10, 3)),
                                   ('BOX-1', '   ', datetime(2026, 10, 3))):
                connection.execute(text(
                    "INSERT INTO monthly_material_actuals (id, plant_id, month_start, item_code, actual_consumed_weight_kg, notes, created_by, created_at, actual_cost) "
                    "VALUES (:id, :plant, '2026-09-01', :code, 1, :note, 'pm@example.com', :at, 0)"),
                    {'id': uuid.uuid4(), 'plant': plant, 'code': code, 'note': note, 'at': at})
            connection.execute(text(
                "INSERT INTO plant_tolerance_setting (id, plant_id, default_kg, raw_paper_kg, adhesive_kg, paper_expected_consumption_factor, "
                "paper_standard_wastage_percent, updated_by, created_at, updated_at) VALUES (:id, :plant, 6, 4, NULL, 1.08, 7, 'admin@example.com', now(), now())"),
                {'id': uuid.uuid4(), 'plant': plant})

            for statement in MONTH_END_CLOSE_MIGRATIONS:
                connection.execute(text(statement))
            for statement in MONTH_END_CLOSE_MIGRATIONS:  # a restart repeats nothing
                connection.execute(text(statement))

            closed = connection.execute(text(
                "SELECT closed_by, closed_at, close_note, version FROM monthly_material_close WHERE plant_id = :plant"), {'plant': plant}).one()
            assert closed == ('owner@example.com', datetime(2026, 10, 3, 6, 0), 'September closed', 1)
            events = connection.execute(text(
                "SELECT event, actor, reason FROM monthly_close_events WHERE plant_id = :plant"), {'plant': plant}).all()
            assert events == [('CLOSED', 'owner@example.com', 'September closed')]
            notes = dict(connection.execute(text(
                "SELECT item_code, note FROM monthly_material_notes WHERE plant_id = :plant"), {'plant': plant}).all())
            assert notes == {'KRAFT-1': 'Trial run on winder 2'}
            bands = {row[0]: tuple(row[1:]) for row in connection.execute(text(
                "SELECT material_type, normal_wastage_pct, allowed_gap_pct, min_gap FROM plant_usage_limits WHERE plant_id = :plant"),
                {'plant': plant}).all()}
            assert bands == {'RAW_PAPER': (8.0, 7.0, 4.0), 'ADHESIVE': (0.0, 7.0, 0.5), 'PARCHMENT': (0.0, 7.0, 1.0),
                             'PACKAGING': (0.0, 7.0, 10.0), 'OTHER': (0.0, 7.0, 6.0)}
        finally:
            transaction.rollback()
