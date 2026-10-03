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
    create(a,db,job,produced=5,accepted=4,details={'reject_reason':'One rejected'})
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
    create(a,db,job,produced=3,accepted=3)
    create(a,db,job,'OVEN',produced=3,accepted=3,input_quantity=3)
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
        return {'entry':{'request_id':'ignored-inner-key','stage':stage,'business_date':date.today(),'shift_code':'SHIFT_A','operator_id':uuid.uuid4(),'produced':produced,'accepted':produced,'input_quantity':input_qty,'submit':True}}
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
