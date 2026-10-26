"""Real PostgreSQL contracts for quantities, concurrency and immutable entry history."""
import os
import uuid
from datetime import date
import pytest
from fastapi import HTTPException

pytestmark=pytest.mark.skipif('hariom_nverify' not in os.getenv('DATABASE_URL',''),reason='disposable database only')
PLANT='00000000-0000-0000-0000-0000000000a1'
USER={'sub':'entry-test-owner','roles':['Owner','QC'],'allowed_plants':[PLANT]}

@pytest.fixture
def card(monkeypatch):
    from src.main import app
    from src.database import SessionLocal
    from src.models import JobCard,JobCardStage,SalesOrder
    from src.routers import entries as api
    from season_quality import initial_rules,resolve_profile
    db=SessionLocal()
    order=SalesOrder(plant_id=uuid.UUID(PLANT),customer_id=uuid.uuid4(),spec_id=uuid.uuid4(),order_qty=100,due_date=date.today())
    db.add(order);db.flush()
    profile=resolve_profile({'id_min_mm':76.2,'id_max_mm':76.6,'od_min_mm':81,'od_max_mm':81,'length_min_mm':149.8,'length_max_mm':150.2,'target_tube_weight':120,'required_cs':400,'mandrel_diameter_mm':76.3,'selected_bamboo_length_mm':1560},initial_rules())
    job=JobCard(plant_id=uuid.UUID(PLANT),sales_order_id=order.id,spec_id=order.spec_id,planned_qty=100,released_qty=100,spec_snapshot={'entry_model':'V2','selected_bamboo_length_mm':1560,'pcs_per_bamboo':10,'qc_profile':profile},routing_snapshot={'stages':['WINDER','OVEN','PROCESS','PACKING','QC','DISPATCH']},material_plan_snapshot={'recipe_snapshot':{'season_revision':1}},status='PLANNED',current_stage='WINDER')
    job.spec_snapshot={**job.spec_snapshot,'id_min_mm':76.2,'id_max_mm':76.6,'od_min_mm':81,'od_max_mm':81,'length_min_mm':149.8,'length_max_mm':150.2}
    db.add(job);db.flush()
    for stage in api.route(job):db.add(JobCardStage(job_card_id=job.id,stage_type=stage,machine_id=uuid.uuid4() if stage in ('WINDER','OVEN','PROCESS') else None,plan_date=date.today(),shift_code='SHIFT_A'))
    db.commit()
    monkeypatch.setattr(api,'employee',lambda *args:{'name':'Operator / Supervisor','employee_code':'E1','active':True})
    monkeypatch.setattr(api.planning,'_fetch_machine',lambda machine_id,*args:{'id':str(machine_id),'plant_id':PLANT,'department':next(s.stage_type for s in job.stages if s.machine_id==machine_id),'is_active':True,'capacity_value':0,'id_min_mm':70,'id_max_mm':90,'od_min_mm':70,'od_max_mm':100,'length_min_mm':100,'length_max_mm':2000})
    yield api,db,job
    db.rollback();db.close()

def create(a,db,job,stage='WINDER',**kw):
    values=dict(request_id=str(uuid.uuid4()),stage=stage,business_date=date.today(),shift_code='SHIFT_A',operator_id=uuid.uuid4(),produced=5,accepted=5,submit=True)
    values.update(kw);return a.create_entry(job.id,a.EntryInput(**values),db,PLANT,USER)

def winding_samples():return [{'sample_id':str(uuid.uuid4()),'readings':{'id':76.3,'od':82,'height':1560,'weight':130,'cs':165}} for _ in range(2)]
def oven_samples():return [{'sample_id':str(uuid.uuid4()),'readings':{'pre_weight':1000,'post_weight':910,'pre_moisture':10,'post_moisture':8,'cs':420}} for _ in range(2)]

def test_rejected_excess_production_still_requires_variance_reason(card):
    a,db,job=card
    with pytest.raises(HTTPException) as error:
        create(a,db,job,produced=12,accepted=5,details={'reject_reason':'Setup trial rejects'})
    assert error.value.status_code==409
    db.rollback()
    result=create(a,db,job,produced=12,accepted=5,details={'reject_reason':'Setup trial rejects','overproduction_reason':'Setup trial produced extra rejected pieces'})
    assert result['entry']['produced']==12 and result['entry']['rejected']==7

def test_short_close_updates_every_downstream_target_and_rejects_stale_totals(card):
    a,db,job=card
    create(a,db,job,samples=winding_samples())
    result=a.close_stage(job.id,'WINDER',a.CloseInput(request_id=str(uuid.uuid4()),expected_version=2,supervisor_id=uuid.uuid4(),short_close=True,reason='Five bamboos accepted; close this short run'),db,PLANT,USER)
    states={s['stage']:s for s in result['flow']['stages']}
    assert states['OVEN']['target']==5 and states['OVEN']['row_version']==2
    assert all(states[s]['target']==50 for s in ('PROCESS','PACKING','QC','DISPATCH'))
    with pytest.raises(HTTPException) as caught:create(a,db,job,'OVEN',quantity_mode='TOTAL',expected_version=1,produced=5,accepted=5,input_quantity=5)
    assert caught.value.status_code==409;db.rollback()
    create(a,db,job,'OVEN',quantity_mode='TOTAL',expected_version=2,produced=5,accepted=5,input_quantity=5)
    assert a.flow(db,job)['stages'][1]['accepted_total']==5

def test_atomic_short_run_preserves_original_version_checks(card):
    a,db,job=card
    oven=[{'sample_id':str(uuid.uuid4()),'readings':{'pre_weight':1000,'post_weight':910,'pre_moisture':10,'post_moisture':8,'cs':420}} for _ in range(2)]
    steps=[]
    for stage,inputs,samples in [('WINDER',0,winding_samples()),('OVEN',5,oven)]:
        steps.append({'entry':{'request_id':'short-run-entry-'+stage,'stage':stage,'quantity_mode':'TOTAL','expected_version':1,'business_date':date.today(),'shift_code':'SHIFT_A','operator_id':uuid.uuid4(),'produced':5,'accepted':5,'input_quantity':inputs,'samples':samples,'submit':True},'close':{'request_id':'short-run-close-'+stage,'expected_version':2,'supervisor_id':uuid.uuid4(),'short_close':True,'reason':'Approved short production run'}})
    body=a.BatchInput(request_id=str(uuid.uuid4()),steps=steps)
    bad=body.model_copy(update={'steps':[body.steps[0],body.steps[1].model_copy(update={'entry':body.steps[1].entry.model_copy(update={'expected_version':2})})]})
    with pytest.raises(HTTPException) as caught:a.batch_entries(job.id,bad,db,PLANT,USER)
    assert caught.value.status_code==409
    assert not a.entries(db,job)
    result=a.batch_entries(job.id,body,db,PLANT,USER)
    assert result['flow']['stages'][1]['status']=='COMPLETED'
    assert result['flow']['stages'][2]['target']==50
    assert a.batch_entries(job.id,body,db,PLANT,USER)==result

def test_direct_service_blocks_backdated_entry_into_closed_books(card):
    from src.models import MonthlyMaterialClose
    a,db,job=card
    month=date.today().replace(day=1)
    previous_end=date.fromordinal(month.toordinal()-1)
    db.add(MonthlyMaterialClose(plant_id=job.plant_id,month_start=previous_end.replace(day=1),status='APPROVED'));db.commit()
    try:
        with pytest.raises(HTTPException) as caught:create(a,db,job,business_date=previous_end)
        assert caught.value.status_code==422 and caught.value.detail['code']=='BOOKS_LOCKED';db.rollback()
    finally:
        db.query(MonthlyMaterialClose).filter_by(plant_id=job.plant_id,month_start=previous_end.replace(day=1)).delete();db.commit()

def test_continuous_qc_uses_registered_calibration_instead_of_typed_evidence(card):
    import copy
    from datetime import timedelta
    from src.models import QcInstrument
    a,db,job=card
    snapshot=copy.deepcopy(job.spec_snapshot)
    snapshot['qc_profile']['stages']['WINDER']['parameters'][0]['requires_instrument']=True
    job.spec_snapshot=snapshot
    code='SEASON-'+uuid.uuid4().hex[:12]
    instrument=QcInstrument(plant_id=job.plant_id,code=code,name='Test gauge',active=True,calibration_due=date.today()-timedelta(days=1),certificate_ref='EXPIRED-CERT')
    db.add(instrument);db.commit()
    typed={'instrument':{'instrument_id':code,'calibration_due':'2099-01-01','instrument_evidence':'USER-TYPED'}}
    with pytest.raises(HTTPException) as caught:create(a,db,job,samples=winding_samples(),details=typed)
    assert caught.value.status_code==409 and caught.value.detail['instrument_status']=='expired';db.rollback()
    instrument.calibration_due=date.today()+timedelta(days=30);instrument.certificate_ref='REGISTER-CERT';db.commit()
    result=create(a,db,job,samples=winding_samples(),details=typed)
    assert result['entry']['details']['instrument']['source']=='register'
    assert result['entry']['details']['instrument']['evidence_ref']=='REGISTER-CERT'

def test_release_ack_and_noop_tools_allow_reopen_but_posted_stock_does_not(card):
    from src.entry_models import CompletionEffect
    a,db,job=card
    create(a,db,job,produced=10,accepted=10,samples=winding_samples())
    closed=a.close_stage(job.id,'WINDER',a.CloseInput(request_id=str(uuid.uuid4()),expected_version=2,supervisor_id=uuid.uuid4(),reason='Verified material exception'),db,PLANT,USER)
    tools=db.query(CompletionEffect).filter_by(job_card_id=job.id,kind='tools').one()
    tools.status='DELIVERED';tools.attempts=1;tools.payload={**tools.payload,'posted_tool_asset_ids':[]}
    db.add(CompletionEffect(job_card_id=job.id,effect_key=str(uuid.uuid4()),kind='release_ack',status='DELIVERED',payload={'stage':'WINDER'}));db.commit()
    version=closed['flow']['stages'][0]['row_version']
    body=a.Mutation(request_id=str(uuid.uuid4()),expected_version=version,reason='Continue the same unposted run')
    reopened=a.reopen_stage(job.id,'WINDER',body,db,PLANT,USER)
    assert reopened['flow']['stages'][0]['status']=='RUNNING' and tools.status=='CANCELLED'
    assert a.reopen_stage(job.id,'WINDER',body,db,PLANT,USER)==reopened
    closed=a.close_stage(job.id,'WINDER',a.CloseInput(request_id=str(uuid.uuid4()),expected_version=version+1,supervisor_id=uuid.uuid4(),reason='Run complete'),db,PLANT,USER)
    db.add(CompletionEffect(job_card_id=job.id,effect_key=str(uuid.uuid4()),kind='fg_inward',status='DELIVERED',payload={'stage':'PACKING'}));db.commit()
    with pytest.raises(HTTPException) as caught:a.reopen_stage(job.id,'WINDER',a.Mutation(request_id=str(uuid.uuid4()),expected_version=closed['flow']['stages'][0]['row_version'],reason='Posted stock cannot be edited'),db,PLANT,USER)
    assert caught.value.status_code==409;db.rollback()

def test_residual_hold_reserves_sources_and_physical_disposition_is_final(card):
    a,db,job=card
    create(a,db,job,produced=10,accepted=10,samples=winding_samples())
    close=lambda stage,**extra:a.close_stage(job.id,stage,a.CloseInput(request_id=str(uuid.uuid4()),supervisor_id=uuid.uuid4(),expected_version=next(s for s in a.flow(db,job)['stages'] if s['stage']==stage)['row_version'],reason='Verified short-run residual',**extra),db,PLANT,USER)
    close('WINDER')
    oven=[{'sample_id':str(uuid.uuid4()),'readings':{'pre_weight':1000,'post_weight':910,'pre_moisture':10,'post_moisture':8,'cs':420}} for _ in range(2)]
    create(a,db,job,'OVEN',produced=5,accepted=5,input_quantity=5,samples=oven)
    result=close('OVEN',short_close=True,residual_disposition='HOLD')
    residual=result['flow']['residual_wip'][0]
    assert residual['quantity']==5 and residual['status']=='HOLD'
    assert a.available(db,job,'OVEN')==0
    body=a.ResidualResolve(request_id=str(uuid.uuid4()),expected_version=residual['row_version'],reason='Returned five bamboos to identified source stock',disposition='RETURN')
    resolved=a.resolve_residual(job.id,uuid.UUID(residual['id']),body,db,PLANT,USER)
    assert resolved['residual']['status']=='DISPOSED'
    assert a.resolve_residual(job.id,uuid.UUID(residual['id']),body,db,PLANT,USER)==resolved
    state=next(s for s in a.flow(db,job)['stages'] if s['stage']=='OVEN')
    with pytest.raises(HTTPException) as err:a.reopen_stage(job.id,'OVEN',a.Mutation(request_id=str(uuid.uuid4()),expected_version=state['row_version'],reason='Try to reuse returned material'),db,PLANT,USER)
    assert err.value.status_code==409;db.rollback()
    assert a.available(db,job,'OVEN')==0

def test_material_issue_cannot_be_attributed_to_two_cards(card,monkeypatch):
    from src.models import JobCard,JobCardStage
    a,db,job=card
    monkeypatch.setattr(a,'verified_reel_links',lambda *args:None)
    issue=uuid.uuid4()
    def close(j):return a.close_stage(j.id,'WINDER',a.CloseInput(request_id=str(uuid.uuid4()),expected_version=2,supervisor_id=uuid.uuid4(),reel_issue_ids=[issue]),db,PLANT,USER)
    create(a,db,job,produced=10,accepted=10,samples=winding_samples());close(job)
    other=JobCard(plant_id=job.plant_id,sales_order_id=job.sales_order_id,spec_id=job.spec_id,planned_qty=100,released_qty=100,spec_snapshot=job.spec_snapshot,routing_snapshot=job.routing_snapshot,material_plan_snapshot=job.material_plan_snapshot,status='PLANNED',current_stage='WINDER')
    db.add(other);db.flush()
    for row in job.stages:db.add(JobCardStage(job_card_id=other.id,stage_type=row.stage_type,machine_id=row.machine_id,plan_date=row.plan_date,shift_code=row.shift_code))
    db.commit();create(a,db,other,produced=10,accepted=10,samples=winding_samples())
    with pytest.raises(HTTPException) as caught:close(other)
    assert caught.value.status_code==409 and 'another job card' in caught.value.detail;db.rollback()

def test_continuous_oven_before_winding_close_and_double_input(card):
    a,db,job=card
    # Each winding batch must pass its own QC before Oven may take it (client rule 2026-10-13).
    create(a,db,job,produced=5,accepted=4,details={'reject_reason':'One rejected'},samples=winding_samples())
    create(a,db,job,'OVEN',produced=3,accepted=2,input_quantity=3,details={'reject_reason':'One oven reject'})
    assert a.stage_row(db,job,'WINDER').status=='RUNNING'
    assert a.available(db,job,'OVEN')==1
    with pytest.raises(HTTPException) as err:create(a,db,job,'OVEN',produced=2,accepted=2,input_quantity=2)
    assert err.value.status_code==409;db.rollback()
    assert a.available(db,job,'OVEN')==1

def test_close_min_samples_and_previous_close(card):
    a,db,job=card
    create(a,db,job)
    payload=a.CloseInput(request_id=str(uuid.uuid4()),supervisor_id=uuid.uuid4(),expected_version=2,short_close=True,reason='Short test run')
    with pytest.raises(HTTPException) as err:a.close_stage(job.id,'WINDER',payload,db,PLANT,USER)
    assert err.value.detail['code']=='STAGE_QC_READINGS_SHORT';db.rollback()
    create(a,db,job,kind='QC_ONLY',produced=0,accepted=0,operator_id=None,shift_code=None,samples=winding_samples())
    state=a.flow(db,job)['stages'][0];assert state['qc']['ready']
    result=a.close_stage(job.id,'WINDER',payload.model_copy(update={'expected_version':state['row_version']}),db,PLANT,USER)
    assert result['flow']['stages'][0]['status']=='COMPLETED'

def test_request_replay_and_total_mode(card):
    a,db,job=card
    key=str(uuid.uuid4());operator=uuid.uuid4()
    first=create(a,db,job,request_id=key,operator_id=operator)
    again=create(a,db,job,request_id=key,operator_id=operator)
    assert first==again
    with pytest.raises(HTTPException):create(a,db,job,request_id=key,operator_id=operator,produced=6,accepted=6)
    db.rollback()
    state=a.flow(db,job)['stages'][0]
    create(a,db,job,quantity_mode='TOTAL',expected_version=state['row_version'],produced=8,accepted=8)
    assert a.flow(db,job)['stages'][0]['produced_total']==8

def test_process_conservation_and_carryover(card):
    a,db,job=card
    create(a,db,job,produced=3,accepted=3,samples=winding_samples())
    create(a,db,job,'OVEN',produced=3,accepted=3,input_quantity=3,samples=oven_samples())
    create(a,db,job,'PROCESS',produced=12,accepted=12,input_quantity=2,carry_out_pcs=7,cutting_loss_pcs=1,details={'carryover_reason':'Uncut pieces held','reject_reason':'Trim'})
    assert a.flow(db,job)['stages'][2]['carryover_pcs']==7
    create(a,db,job,'PROCESS',produced=7,accepted=7,input_quantity=0,carry_in_pcs=7,details={'carryover_reason':'Finish held pieces'})
    assert a.flow(db,job)['stages'][2]['carryover_pcs']==0
    with pytest.raises(HTTPException):create(a,db,job,'PROCESS',produced=1,accepted=1,input_quantity=0,carry_in_pcs=1,details={'carryover_reason':'Already used'})
    db.rollback()

def test_sample_correction_keeps_revision_and_duplicate_block(card):
    a,db,job=card
    samples=winding_samples();e=create(a,db,job,samples=samples)['entry']
    changed=[{**s,'readings':{**s['readings'],'id':76.31}} for s in samples]
    a.save_observations(job.id,uuid.UUID(e['id']),a.Observations(request_id=str(uuid.uuid4()),expected_version=e['row_version'],reason='Correct transcribed reading',samples=changed),db,PLANT,USER)
    history=a.entry_history(job.id,uuid.UUID(e['id']),db,PLANT,USER)
    assert len(history)==2 and history[1]['payload']['samples'][0]['readings']['id']==76.3
    with pytest.raises(HTTPException):create(a,db,job,samples=changed)
    db.rollback()

def test_first_batch_qc_needs_no_reason_but_a_correction_does(card):
    a,db,job=card
    e=create(a,db,job)['entry']
    assert e['evaluation']['verdict']!='PASS'
    first=a.save_observations(job.id,uuid.UUID(e['id']),a.Observations(request_id=str(uuid.uuid4()),expected_version=e['row_version'],samples=winding_samples()),db,PLANT,USER)['entry']
    assert first['evaluation']['verdict']=='PASS'
    history=a.entry_history(job.id,uuid.UUID(e['id']),db,PLANT,USER)
    assert history[0]['reason']=='QC readings recorded'
    with pytest.raises(HTTPException) as err:
        a.save_observations(job.id,uuid.UUID(e['id']),a.Observations(request_id=str(uuid.uuid4()),expected_version=first['row_version'],samples=winding_samples()),db,PLANT,USER)
    assert err.value.status_code==422
    db.rollback()
    with pytest.raises(HTTPException) as err:
        a.save_observations(job.id,uuid.UUID(e['id']),a.Observations(request_id=str(uuid.uuid4()),expected_version=e['row_version'],reason='late',samples=winding_samples()),db,PLANT,USER)
    assert err.value.status_code==409
    db.rollback()

def test_batch_qc_is_accepted_only_with_two_readings_and_more_can_be_added_without_reason(card):
    """Client rule 2026-10-18: minimum 2 readings per check; QC may add more; the next stage
    opens only for batches whose QC is accepted."""
    a,db,job=card
    one=[winding_samples()[0]]
    e=create(a,db,job,produced=4,accepted=4,samples=one)['entry']
    assert e['evaluation']['verdict']=='PASS'
    assert a.available(db,job,'OVEN')==0 and a.awaiting_qc(db,job,'OVEN')==4
    listed=a.get_entries(job.id,'WINDER',0,50,db,PLANT,USER)['entries'][0]
    assert not listed['qc_cleared'] and {r['parameter'] for r in listed['qc_readings_short']}>={'id','od','cs'}
    due=a.qc_due(200,db,{'selected_plant_id':PLANT},USER)
    assert any(row['entry_id']==e['id'] and row['state']=='MORE_READINGS' for row in due)
    # A second sample beside the first is an addition, not a correction: no reason needed.
    more=a.save_observations(job.id,uuid.UUID(e['id']),a.Observations(request_id=str(uuid.uuid4()),expected_version=e['row_version'],samples=one+winding_samples()[:1]),db,PLANT,USER)['entry']
    assert a.entry_history(job.id,uuid.UUID(e['id']),db,PLANT,USER)[0]['reason']=='More QC readings added'
    assert a.available(db,job,'OVEN')==4 and not any(row['entry_id']==e['id'] for row in a.qc_due(200,db,{'selected_plant_id':PLANT},USER))
    # A third reading may still be added.
    a.save_observations(job.id,uuid.UUID(e['id']),a.Observations(request_id=str(uuid.uuid4()),expected_version=more['row_version'],samples=more['samples']+winding_samples()[:1]),db,PLANT,USER)
    db.rollback()


def test_parent_lock_blocks_concurrent_writer(card):
    from src.database import SessionLocal
    a,db,job=card;other=SessionLocal()
    a.card(db,job.id,PLANT,True)
    try:
        with pytest.raises(HTTPException) as err:a.card(other,job.id,PLANT,True)
        assert err.value.status_code==409
    finally:other.rollback();other.close();db.rollback()

def test_cross_plant_and_operator_policy(card):
    a,db,job=card
    with pytest.raises(HTTPException) as err:a.get_flow(job.id,db,'00000000-0000-0000-0000-0000000000b2',USER)
    assert err.value.status_code==404
    body=a.EntryInput(request_id=str(uuid.uuid4()),stage='WINDER',submit=True)
    with pytest.raises(HTTPException) as err:a.create_entry(job.id,body,db,PLANT,{'sub':'op','roles':['Operator']})
    assert err.value.status_code==403


def test_whole_card_batch_rolls_back_entries_allocations_and_receipts(card):
    a,db,job=card
    from src.entry_models import StageEntry,InputAllocation,EntryReceipt
    def item(stage,produced,input_qty):
        return {'entry':{'request_id':'ignored-inner-key','stage':stage,'business_date':date.today(),'shift_code':'SHIFT_A','operator_id':uuid.uuid4(),'produced':produced,'accepted':produced,'input_quantity':input_qty,'submit':True,'samples':winding_samples() if stage=='WINDER' else []}}
    body=a.BatchInput(request_id=str(uuid.uuid4()),steps=[item('WINDER',5,0),item('OVEN',6,6)])
    with pytest.raises(HTTPException) as err:a.batch_entries(job.id,body,db,PLANT,USER)
    assert err.value.status_code==409
    assert not db.query(StageEntry).filter_by(job_card_id=job.id).count()
    assert not db.query(InputAllocation).filter_by(job_card_id=job.id).count()
    assert not db.query(EntryReceipt).filter_by(job_card_id=job.id).count()
    valid=body.model_copy(update={'steps':[a.BatchStep(**item('WINDER',5,0)),a.BatchStep(**item('OVEN',5,5))]})
    result=a.batch_entries(job.id,valid,db,PLANT,USER)
    assert len(result['entries'])==2
    assert a.batch_entries(job.id,valid,db,PLANT,USER)==result
    assert db.query(StageEntry).filter_by(job_card_id=job.id).count()==2


def test_missing_accepted_is_rejected_before_submission(card):
    a,db,job=card
    payload=a.EntryInput(request_id=str(uuid.uuid4()),stage='WINDER',business_date=date.today(),shift_code='SHIFT_A',operator_id=uuid.uuid4(),produced=5,details={'reject_reason':'Reject all'},submit=True)
    with pytest.raises(HTTPException) as err:a.create_entry(job.id,payload,db,PLANT,USER)
    assert err.value.status_code==422


def test_next_stage_takes_only_qc_cleared_batches_unless_supervisor_overrides(card):
    a,db,job=card
    # Winding batch 1: 5 produced, no QC yet. Oven may not take it.
    create(a,db,job,produced=5,accepted=5)
    assert a.available(db,job,'OVEN')==0 and a.awaiting_qc(db,job,'OVEN')==5
    with pytest.raises(HTTPException) as err:create(a,db,job,'OVEN',produced=3,accepted=3,input_quantity=3)
    assert err.value.status_code==409 and err.value.detail['code']=='UPSTREAM_AWAITING_QC' and err.value.detail['awaiting_qc']==5;db.rollback()
    # Winding batch 2 with passing QC readings: only this batch is available to Oven.
    create(a,db,job,produced=4,accepted=4,samples=winding_samples())
    assert a.available(db,job,'OVEN')==4 and a.awaiting_qc(db,job,'OVEN')==5
    create(a,db,job,'OVEN',produced=4,accepted=4,input_quantity=4)
    assert a.available(db,job,'OVEN')==0
    # Supervisor override with a reason may draw on the batch still awaiting QC; the reason is kept.
    create(a,db,job,'OVEN',produced=2,accepted=2,input_quantity=2,details={'qc_gate_override_reason':'Supervisor checked the winding batch physically'})
    assert a.available(db,job,'OVEN',override=True)==3 and a.awaiting_qc(db,job,'OVEN')==3
    flow=a.flow(db,job);oven=next(s for s in flow['stages'] if s['stage']=='OVEN')
    assert oven['available_from_upstream']==0 and oven['awaiting_qc_from_upstream']==3 and oven['upstream_has_qc']
    with pytest.raises(HTTPException) as denied:
        a.create_entry(job.id,a.EntryInput(request_id=str(uuid.uuid4()),stage='OVEN',business_date=date.today(),shift_code='SHIFT_A',operator_id=uuid.uuid4(),produced=1,accepted=1,input_quantity=1,submit=True,details={'qc_gate_override_reason':'x'}),db,PLANT,{'sub':'op','roles':['Operator'],'allowed_plants':[PLANT]})
    assert denied.value.status_code==403;db.rollback()


def test_a_failed_batch_holds_only_itself_not_the_passing_batches(card):
    a,db,job=card
    # Batch 1 fails winding QC (I.D. far out): it is held and cannot feed the oven.
    bad=[{'sample_id':str(uuid.uuid4()),'readings':{'id':70.0,'od':82,'height':1560,'weight':130,'cs':165}} for _ in range(2)]
    failed=create(a,db,job,produced=3,accepted=3,samples=bad)['entry']
    assert failed['evaluation']['verdict']=='FAIL' and not failed['qc_cleared']
    assert a.available(db,job,'OVEN')==0 and a.awaiting_qc(db,job,'OVEN')==3
    # Batch 2 passes: the oven may take it although batch 1 is on hold.
    create(a,db,job,produced=4,accepted=4,samples=winding_samples())
    assert a.available(db,job,'OVEN')==4
    oven=next(s for s in a.flow(db,job)['stages'] if s['stage']=='OVEN')
    assert oven['available_from_upstream']==4 and oven['awaiting_qc_from_upstream']==3
    create(a,db,job,'OVEN',produced=4,accepted=4,input_quantity=4)
    # The failed batch still stops the winding stage from closing until QC decides.
    winding=next(s for s in a.flow(db,job)['stages'] if s['stage']=='WINDER')
    assert any('Resolve blocking QC holds' in b for b in winding['blockers'])
    # A hold on the card itself (not from one batch) still stops all movement.
    from src.models import QualityHold
    db.add(QualityHold(plant_id=job.plant_id,job_card_id=job.id,stage_type='WINDER',reason='Customer complaint hold',status='HOLD',created_by='qc'));db.flush()
    create(a,db,job,produced=2,accepted=2,samples=winding_samples())
    assert a.available(db,job,'OVEN')==0
    db.rollback()


def test_released_card_takes_entries_before_the_planner_places_it_and_flags_them(card):
    a,db,job=card
    from src.models import JobCardStage, JobCardStageSegment
    # Winding released but never placed on the planner board: no date, no shift, no machine on its segment.
    stage=next(s for s in job.stages if s.stage_type=='WINDER');machine=stage.machine_id
    stage.plan_date=None;stage.shift_code=None;stage.machine_id=None
    a.planning._fetch_machine=lambda machine_id,*args:{'id':str(machine_id),'plant_id':PLANT,'department':'WINDER','is_active':True,'capacity_value':0,'id_min_mm':70,'id_max_mm':90,'od_min_mm':70,'od_max_mm':100,'length_min_mm':100,'length_max_mm':2000}
    segment=JobCardStageSegment(plant_id=job.plant_id,job_card_id=job.id,stage_type='WINDER',planned_qty=10,status='QUEUED');db.add(segment);db.flush()
    gate=a.planning._planner_gate_context(current_stage='WINDER',active_stage=stage,active_segment=segment)
    assert gate['planner_gate_ready'] is False
    entry=create(a,db,job,produced=3,accepted=3,machine_id=machine,samples=winding_samples())['entry']
    assert entry['status']=='SUBMITTED' and entry['details']['unscheduled_entry']['reason']
    db.expire_all()
    # The stage now sits on the slot it really ran in, so the next entry is a normal one.
    assert segment.plan_date==date.today() and segment.shift_code=='SHIFT_A' and segment.machine_id==machine and segment.status in ('ASSIGNED','RUNNING')
    assert stage.plan_date==date.today() and stage.machine_id==machine
    again=create(a,db,job,produced=2,accepted=2)['entry']
    assert 'unscheduled_entry' not in again['details']
    flow=a.flow(db,job);winding=next(s for s in flow['stages'] if s['stage']=='WINDER')
    assert winding['unscheduled_entries']==1
    flagged=a.flagged_entries(30,200,db,PLANT,USER)
    assert [f['entry_no'] for f in flagged if f['job_card_id']==str(job.id)]==[entry['entry_no']] and flagged[0]['flag']=='UNSCHEDULED'
    db.rollback()


def test_a_run_on_another_machine_of_the_department_moves_the_slot_and_is_flagged(card):
    a,db,job=card
    from src.models import JobCardStageSegment
    stage=next(s for s in job.stages if s.stage_type=='WINDER');planned=stage.machine_id;other=uuid.uuid4();oven=uuid.uuid4()
    segment=JobCardStageSegment(plant_id=job.plant_id,job_card_id=job.id,stage_type='WINDER',planned_qty=10,status='ASSIGNED',machine_id=planned,plan_date=date.today(),shift_code='SHIFT_A');db.add(segment);db.commit()
    a.planning._fetch_machine=lambda machine_id,*args:{'id':str(machine_id),'plant_id':PLANT,'department':'OVEN' if machine_id==oven else 'WINDER','is_active':True,'capacity_value':0,'id_min_mm':70,'id_max_mm':90,'od_min_mm':70,'od_max_mm':100,'length_min_mm':100,'length_max_mm':2000}
    with pytest.raises(HTTPException) as err:create(a,db,job,produced=2,accepted=2,machine_id=oven)
    assert err.value.status_code==422;db.rollback()
    moved=create(a,db,job,produced=2,accepted=2,machine_id=other,samples=winding_samples())['entry']
    assert moved['details']['machine_changed']=={'from':str(planned),'to':str(other)}
    db.expire_all()
    assert segment.machine_id==other and stage.machine_id==other
    assert [f['flag'] for f in a.flagged_entries(30,200,db,PLANT,USER) if f['job_card_id']==str(job.id)]==['MACHINE_CHANGED']
    db.rollback()


def test_whole_card_totals_entry_readings_cover_earlier_batches_without_readings(card):
    a,db,job=card
    # Two quick floor runs without readings, then the printed card is entered as running totals with readings.
    first=create(a,db,job,produced=3,accepted=3)['entry'];second=create(a,db,job,produced=2,accepted=2)['entry']
    assert a.available(db,job,'OVEN')==0 and a.awaiting_qc(db,job,'OVEN')==5
    row=a.stage_row(db,job,'WINDER');version=int((row.actuals_snapshot or {}).get('row_version',1))
    total=create(a,db,job,produced=10,accepted=10,quantity_mode='TOTAL',expected_version=version,samples=winding_samples())['entry']
    assert total['produced']==5 and total['evaluation']['verdict']=='PASS'
    listing=a.get_entries(job.id,'WINDER',0,50,db,PLANT,USER)['entries']
    covered={e['entry_no']:e for e in listing}
    assert covered[first['entry_no']]['qc_cleared'] and covered[second['entry_no']]['qc_cleared'] and covered[first['entry_no']]['details']['qc_covered_entry_no']==total['entry_no']
    assert a.available(db,job,'OVEN')==10 and a.awaiting_qc(db,job,'OVEN')==0
    # A batch that failed its own readings is not covered.
    bad=[{'sample_id':str(uuid.uuid4()),'readings':{'id':70.0,'od':82,'height':1560,'weight':130,'cs':165}} for _ in range(2)]
    failed=create(a,db,job,produced=1,accepted=1,samples=bad)['entry'];assert failed['evaluation']['verdict']=='FAIL'
    row=a.stage_row(db,job,'WINDER');version=int((row.actuals_snapshot or {}).get('row_version',1))
    create(a,db,job,produced=12,accepted=12,quantity_mode='TOTAL',expected_version=version,samples=winding_samples(),details={'overproduction_reason':'test'})
    assert not next(e for e in a.get_entries(job.id,'WINDER',0,50,db,PLANT,USER)['entries'] if e['entry_no']==failed['entry_no'])['qc_cleared']
    db.rollback()

def close_input(**kw):
    values=dict(request_id=str(uuid.uuid4()),expected_version=2,supervisor_id=uuid.uuid4());values.update(kw)
    from src.routers import entries as a
    return a.CloseInput(**values)

def test_winding_closes_without_reel_issue_or_material_note(card):
    # Client rule 2026-10-17: issue to the floor happens any time; the monthly stock count settles material.
    a,db,job=card
    create(a,db,job,produced=10,accepted=10,samples=winding_samples())
    result=a.close_stage(job.id,'WINDER',close_input(),db,PLANT,USER)
    assert next(s for s in result['flow']['stages'] if s['stage']=='WINDER')['status']=='COMPLETED'

def test_oven_closes_without_moisture_and_flags_it(card):
    a,db,job=card
    create(a,db,job,produced=10,accepted=10,samples=winding_samples())
    a.close_stage(job.id,'WINDER',close_input(),db,PLANT,USER)
    dry=[{'sample_id':str(uuid.uuid4()),'readings':{'pre_weight':1000,'post_weight':910,'cs':420}} for _ in range(2)]
    entry=create(a,db,job,'OVEN',produced=10,accepted=10,input_quantity=10,samples=dry)['entry']
    assert entry['evaluation']['verdict']=='PASS' and entry['qc_cleared']
    assert {u['parameter'] for u in entry['evaluation']['unrecorded']}=={'pre_moisture','post_moisture'}
    oven=next(s for s in a.flow(db,job)['stages'] if s['stage']=='OVEN')
    assert oven['qc']['ready'] and {u['parameter'] for u in oven['qc']['unrecorded']}=={'pre_moisture','post_moisture'}
    closed=a.close_stage(job.id,'OVEN',close_input(),db,PLANT,USER)
    assert next(s for s in closed['flow']['stages'] if s['stage']=='OVEN')['status']=='COMPLETED'
    flagged=[row for row in a.flagged_entries(30,200,db,PLANT,USER) if row['job_card_id']==str(job.id)]
    assert [row['flag'] for row in flagged]==['QC_NOT_RECORDED'] and 'Pre-moisture' in flagged[0]['reason']

def test_winding_before_slitting_record_is_flagged_and_closes_slitting_with_winding(card):
    from src.models import JobCardStage
    a,db,job=card
    job.routing_snapshot={**job.routing_snapshot,'stages':['SLITTING',*job.routing_snapshot['stages']]};job.requires_slitting=True
    db.add(JobCardStage(job_card_id=job.id,stage_type='SLITTING',plan_date=date.today(),shift_code='SHIFT_A'));db.commit()
    entry=create(a,db,job,produced=10,accepted=10,samples=winding_samples())['entry']
    assert entry['details']['material_prep_pending'] is True
    winder=next(s for s in a.flow(db,job)['stages'] if s['stage']=='WINDER')
    assert "Previous stage must close before this stage closes" not in winder['blockers']
    result=a.close_stage(job.id,'WINDER',close_input(),db,PLANT,USER)
    states={s['stage']:s for s in result['flow']['stages']}
    assert states['WINDER']['status']=='COMPLETED' and states['SLITTING']['status']=='COMPLETED'
    slitting=a.stage_row(db,job,'SLITTING')
    assert slitting.actuals_snapshot['close_kind']=='CLOSED_WITH_WINDING' and slitting.actuals_snapshot['material_prep_pending']
    flags={row['flag'] for row in a.flagged_entries(30,200,db,PLANT,USER) if row['job_card_id']==str(job.id)}
    assert 'MATERIAL_PREP_PENDING' in flags


def process_samples(job):
    """Two passing readings for every Process check, from the card's own resolved bands."""
    readings={}
    for p in job.spec_snapshot['qc_profile']['stages']['PROCESS']['parameters']:
        if not p.get('applicable',True):continue
        low,high=p.get('min'),p.get('max')
        readings[p['code']]=(low+high)/2 if low is not None and high is not None else low+1 if low is not None else high-1 if high is not None else 10
    return [{'sample_id':str(uuid.uuid4()),'readings':dict(readings)} for _ in range(2)]


def run_to_process(a,db,job,monkeypatch):
    monkeypatch.setattr(a,'fg_item_for',lambda *args:'11111111-1111-1111-1111-111111111111')
    create(a,db,job,produced=10,accepted=10,samples=winding_samples())
    a.close_stage(job.id,'WINDER',close_input(),db,PLANT,USER)
    create(a,db,job,'OVEN',produced=10,accepted=10,input_quantity=10,samples=oven_samples())
    a.close_stage(job.id,'OVEN',close_input(),db,PLANT,USER)


def test_process_close_completes_the_card_with_packing_from_the_spec(card,monkeypatch):
    # Client rule 2026-10-18: Process is the last floor step and its QC is the final QC.
    from src.entry_models import CompletionEffect
    from src.models import PackingRecord
    a,db,job=card
    job.spec_snapshot={**job.spec_snapshot,'qty_per_box':40,'box_code':'R-150','fadda_per_box':3,'fadda_sku':'FD-3','product_code':'FG-TEST'};db.commit()
    run_to_process(a,db,job,monkeypatch)
    create(a,db,job,'PROCESS',produced=100,accepted=100,input_quantity=10,samples=process_samples(job))
    process=next(s for s in a.flow(db,job)['stages'] if s['stage']=='PROCESS')
    assert process['completes_card'] and process['completion_preview']['packing']['box_count']==3
    states={s['stage']:s for s in a.close_stage(job.id,'PROCESS',close_input(expected_version=process['row_version']),db,PLANT,USER)['flow']['stages']}
    assert states['PACKING']['status']=='COMPLETED' and states['QC']['status']=='COMPLETED'
    assert states['PACKING']['accepted_total']==100 and states['PACKING']['system_step']
    assert states['DISPATCH']['available_from_upstream']==100
    packing=db.query(PackingRecord).filter_by(job_card_id=job.id).one()
    assert packing.total_packed_qty==100 and str(packing.fg_item_id)=='11111111-1111-1111-1111-111111111111'
    assert packing.snapshot['packaging_consumption']['box_count']==3 and packing.snapshot['packaging_consumption']['fadda']['consumed_pcs']==9
    kinds={(e.kind,e.payload['stage']) for e in db.query(CompletionEffect).filter_by(job_card_id=job.id)}
    assert ('theory','PROCESS') in kinds and ('fg_inward','PACKING') in kinds
    assert job.current_stage=='DISPATCH'


def test_process_cannot_close_while_a_batch_waits_for_qc(card,monkeypatch):
    # Process QC is the final QC: every good Process batch must be QC-accepted before the card completes.
    a,db,job=card
    run_to_process(a,db,job,monkeypatch)
    create(a,db,job,'PROCESS',produced=50,accepted=50,input_quantity=5,samples=process_samples(job))
    create(a,db,job,'PROCESS',produced=50,accepted=50,input_quantity=5)
    process=next(s for s in a.flow(db,job)['stages'] if s['stage']=='PROCESS')
    assert any('50 pcs on Process still need QC accepted' in b for b in process['blockers'])
    with pytest.raises(HTTPException) as err:
        a.close_stage(job.id,'PROCESS',close_input(expected_version=process['row_version']),db,PLANT,USER)
    assert err.value.status_code==409
    db.rollback()
    assert a.stage_row(db,job,'PACKING').status!='COMPLETED'


def test_card_already_packing_closes_without_choosing_an_fg_item(card,monkeypatch):
    # A card whose Process closed under the old flow and is packing on the floor (client screenshot
    # 2026-10-18: "Select the finished-good item before closing Packing"): closing Packing picks the
    # FG item automatically and completes final QC, which Process QC already covered.
    from src.entry_models import CompletionEffect
    a,db,job=card
    run_to_process(a,db,job,monkeypatch)
    create(a,db,job,'PROCESS',produced=100,accepted=100,input_quantity=10,samples=process_samples(job))
    process=a.stage_row(db,job,'PROCESS');process.status='COMPLETED';db.commit()
    create(a,db,job,'PACKING',produced=100,accepted=100,input_quantity=100)
    packing=next(s for s in a.flow(db,job)['stages'] if s['stage']=='PACKING')
    assert not packing['system_step']
    states={s['stage']:s for s in a.close_stage(job.id,'PACKING',close_input(expected_version=packing['row_version']),db,PLANT,USER)['flow']['stages']}
    assert states['PACKING']['status']=='COMPLETED' and states['QC']['status']=='COMPLETED'
    assert a.stage_row(db,job,'PACKING').entry_snapshot['fg_item_id']=='11111111-1111-1111-1111-111111111111'
    assert states['DISPATCH']['available_from_upstream']==100
    kinds={(e.kind,e.payload['stage']) for e in db.query(CompletionEffect).filter_by(job_card_id=job.id)}
    assert ('fg_inward','PACKING') in kinds and ('theory','PACKING') in kinds

def _winding_slots(db,job,*slots):
    from src.models import JobCardStageSegment
    machine=next(s.machine_id for s in job.stages if s.stage_type=='WINDER')
    rows=[JobCardStageSegment(plant_id=job.plant_id,job_card_id=job.id,stage_type='WINDER',segment_no=index,machine_id=machine,plan_date=day,shift_code=shift,planned_qty=50,required_capacity=0,status='ASSIGNED',split_source='MANUAL' if len(slots)>1 else 'NONE',sequence_no=index) for index,(day,shift) in enumerate(slots,start=1)]
    db.add_all(rows);db.commit()
    return rows

def test_run_goes_to_the_part_of_a_split_plan_on_its_own_shift(card):
    # Client 2026-10-26: the floor never picks a slot; the run lands in the part planned for its date and shift.
    a,db,job=card
    first,second=_winding_slots(db,job,(date.today(),'SHIFT_A'),(date.today(),'SHIFT_B'))
    night=create(a,db,job,shift_code='SHIFT_B',samples=winding_samples())['entry']
    day=create(a,db,job,shift_code='SHIFT_A',samples=winding_samples())['entry']
    assert night['segment_id']==str(second.id) and day['segment_id']==str(first.id)
    assert not (night['details'] or {}).get('unscheduled_entry')

def test_late_run_after_the_36h_rule_returns_the_card_to_its_slot(card):
    from datetime import timedelta
    from src.routers import missed_slots
    a,db,job=card
    ran_on=date.today()-timedelta(days=3)
    [slot]=_winding_slots(db,job,(ran_on,'SHIFT_A'))
    assert [row['job_card_id'] for row in missed_slots.sweep_missed_slots(db,job.plant_id)]==[str(job.id)]
    db.refresh(job);db.refresh(slot)
    assert job.missed_slot_open and slot.status=='QUEUED' and slot.machine_id is None
    entry=create(a,db,job,business_date=ran_on,samples=winding_samples())['entry']
    db.refresh(job);db.refresh(slot)
    assert not job.missed_slot_open and slot.plan_date==ran_on and slot.machine_id is not None
    assert not (entry['details'] or {}).get('unscheduled_entry') and entry['details']['planned_slot']['plan_date']==ran_on.isoformat()

def test_run_before_its_planned_day_keeps_the_plan_and_is_not_unplanned(card):
    # The floor never moves the plan: a run 3 days early stays on its slot and the reports call it early.
    from datetime import timedelta
    a,db,job=card
    later=date.today()+timedelta(days=3)
    [slot]=_winding_slots(db,job,(later,'SHIFT_A'))
    entry=create(a,db,job,samples=winding_samples())['entry']
    db.refresh(slot)
    assert slot.plan_date==later and slot.shift_code=='SHIFT_A'
    assert not (entry['details'] or {}).get('unscheduled_entry') and entry['segment_id']==str(slot.id)
