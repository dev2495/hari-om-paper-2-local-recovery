"""Instrument register, hold-release reason and quality analytics against isolated PostgreSQL."""
import os
import uuid
from datetime import date, timedelta

import pytest

if 'hardening_test' not in os.environ.get('DATABASE_URL', ''):
    pytest.skip('Requires isolated hardening_test PostgreSQL database', allow_module_level=True)

from src.database import Base, SessionLocal, engine
from src.models import AuditEvent, JobCard, QualityHold, QualityInspection, SalesOrder, PLANT_A_UUID
from src.routers import quality

PLANT = str(PLANT_A_UUID)
QC = {'roles': ['QC'], 'role': 'QC', 'sub': 'qc-1', 'token': 't'}
SCOPE = {'scope_all': False, 'selected_plant_id': PLANT}


@pytest.fixture()
def db():
    Base.metadata.create_all(engine)
    conn = engine.connect()
    transaction = conn.begin()
    session = SessionLocal(bind=conn, join_transaction_mode='create_savepoint')
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()


def _job(db):
    order = SalesOrder(id=uuid.uuid4(), plant_id=PLANT_A_UUID, customer_id=uuid.uuid4(), spec_id=uuid.uuid4(),
        order_qty=100, due_date=date.today(), priority='NORMAL', status='OPEN')
    db.add(order); db.flush()
    job = JobCard(id=uuid.uuid4(), plant_id=PLANT_A_UUID, sales_order_id=order.id, spec_id=order.spec_id,
        planned_qty=100, status='CREATED', spec_snapshot={})
    db.add(job); db.flush()
    return job


def test_register_overrides_typed_calibration(db):
    plant = PLANT_A_UUID
    typed = {'height': 120, 'instrument': {'instrument_id': 'VC-01', 'calibration_due': '2099-01-01', 'calibration_status': 'valid'}}
    # No register kept yet: typed evidence passes through unchanged.
    assert quality._apply_instrument_register(db, plant, typed) == typed

    quality.upsert_instrument(quality.InstrumentUpsert(code='vc-01', name='Vernier 150 mm',
        calibration_due=date.today() - timedelta(days=1), certificate_ref='CAL-9'), db=db, plant_id=PLANT, current_user=QC)
    expired = quality._apply_instrument_register(db, plant, typed)['instrument']
    assert expired['instrument_id'] == 'VC-01' and expired['calibration_status'] == 'expired'
    assert expired['calibration_due'] == (date.today() - timedelta(days=1)).isoformat()

    unknown = quality._apply_instrument_register(db, plant, {'instrument': {'instrument_id': 'NOPE', 'calibration_due': '2099-01-01'}})
    assert unknown['instrument']['calibration_status'] == 'unregistered' and 'calibration_due' not in unknown['instrument']

    quality.upsert_instrument(quality.InstrumentUpsert(code='VC-01', name='Vernier 150 mm',
        calibration_due=date.today() + timedelta(days=90), certificate_ref='CAL-10'), db=db, plant_id=PLANT, current_user=QC)
    rows = quality.list_instruments(db=db, plant_id=PLANT, current_user=QC)['items']
    assert len(rows) == 1 and rows[0]['calibration_status'] == 'valid' and rows[0]['certificate_ref'] == 'CAL-10'


def test_hold_release_records_reason_and_analytics_counts_first_pass(db):
    job = _job(db)
    first = QualityInspection(plant_id=PLANT_A_UUID, job_card_id=job.id, stage_type='WINDER', status='FAIL',
        failures=[{'label': 'Height'}], readings={'height': 130})
    db.add(first); db.flush()
    db.add(QualityInspection(plant_id=PLANT_A_UUID, job_card_id=job.id, stage_type='WINDER', status='PASS', readings={'height': 120}))
    db.add(QualityInspection(plant_id=PLANT_A_UUID, job_card_id=job.id, stage_type='QC', status='PASS', readings={}))
    hold = QualityHold(plant_id=PLANT_A_UUID, job_card_id=job.id, stage_type='WINDER', reason='Height high', status='HOLD')
    db.add(hold); db.flush()

    quality.release_hold(hold.id, quality.HoldReleasePayload(reason='Re-cut and re-measured', disposition='REWORKED', affected_qty=12),
        db=db, plant_id=PLANT, current_user={'roles': ['Admin'], 'sub': 'admin-1', 'token': 't'})
    audit = db.query(AuditEvent).filter_by(entity_id=hold.id, action='released').one()
    assert audit.payload['reason'] == 'Re-cut and re-measured' and audit.payload['disposition'] == 'REWORKED'

    report = quality.production_quality_analytics(date_from=date.today() - timedelta(days=1), date_to=date.today(),
        db=db, plant_scope=SCOPE, current_user=QC)
    stages = {row['stage']: row for row in report['by_stage']}
    assert stages['WINDER']['job_cards'] == 1 and stages['WINDER']['first_pass_yield'] == 0.0
    assert stages['WINDER']['checks'] == 2 and stages['WINDER']['failed_checks'] == 1
    assert stages['QC']['first_pass_yield'] == 100.0
    assert report['failing_parameters'][0] == {'stage': 'WINDER', 'parameter': 'Height', 'job_cards': 1}
    assert report['holds']['opened'] == 1 and report['holds']['still_open'] == 0
