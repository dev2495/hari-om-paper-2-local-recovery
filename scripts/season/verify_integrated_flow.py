#!/usr/bin/env python3
"""Authenticated API acceptance against the disposable seasonal runtime only.

No credentials/tokens enter the report. The API URLs are loopback-only and the
caller must explicitly identify the disposable DB prefix. Fixtures use APIs.
"""
import json, os, re, secrets, string, uuid
from datetime import date, timedelta
from pathlib import Path
import httpx

if os.getenv('ERP_DB_PREFIX') != 'hariom_nverify_season_':
    raise SystemExit('Run only against the named disposable seasonal runtime')
PORTS={'auth':18022,'master':18023,'spec':18024,'sales':18028,'production':18025,'inventory':18026,'bff':14003}
PLANT='00000000-0000-0000-0000-0000000000a1'
RUN=os.getenv('SEASON_VERIFY_RUN','').upper()
if RUN and not re.fullmatch('[A-Z0-9]{1,16}',RUN):raise SystemExit('Use a short alphanumeric verification run ID')
STATE=Path(f'reports/season-integrated-fixture-{RUN.lower()}.json' if RUN else 'reports/season-integrated-fixture.json')
state=json.loads(STATE.read_text()) if STATE.exists() else {}
client=httpx.Client(timeout=40,headers={'X-Plant-ID':PLANT})

def test_code(value):return value+'_'+RUN if RUN and not value.endswith('_'+RUN) else value

def fixture_body(value):
    if isinstance(value,list):return [fixture_body(v) for v in value]
    if not isinstance(value,dict):return value
    return {k:test_code(v) if k in {'item_code','po_number','invoice_no','source_reel_no','challan_no'} and isinstance(v,str) and v.startswith('SEASON_') else fixture_body(v) for k,v in value.items()}

def req(service,method,path,body=None):
    r=client.request(method,f'http://127.0.0.1:{PORTS[service]}{path}',json=fixture_body(body))
    if not r.is_success:
        raise AssertionError(f'{method} {service} {path}: HTTP {r.status_code}: {r.text[:1800]}')
    return r.json()

def mark(name,**fields):
    state.update(fields);state.setdefault('checks',[]).append(name);STATE.parent.mkdir(exist_ok=True);STATE.write_text(json.dumps(state,indent=2));print('PASS',name,flush=True)

def cmd(**extra):return {'request_id':str(uuid.uuid4()),**extra}

def independent_approval(service,path,body):
    password='Verify-'+secrets.token_urlsafe(18)+'1aA!';email='season-checker-'+uuid.uuid4().hex[:8]+'@example.com'
    req('auth','POST','/users/',{'name':'Independent acceptance checker','email':email,'password':password,'role_names':['Owner','Admin'],'plant_id':PLANT,'allowed_plant_ids':[PLANT,'00000000-0000-0000-0000-0000000000b2']})
    signed=httpx.post(f'http://127.0.0.1:{PORTS["auth"]}/auth/login',data={'username':email,'password':password},timeout=20)
    assert signed.is_success
    original=client.headers['Authorization'];client.headers['Authorization']='Bearer '+signed.json()['access_token']
    try:return req(service,'POST',path,body)
    finally:client.headers['Authorization']=original

def master(key,path,payload):
    payload={k:test_code(v) if k in {'code','customer_code','employee_code','mandrel_code','description','name'} and isinstance(v,str) else v for k,v in payload.items()}
    values=req('master','GET',path)
    identifiers={k:v for k,v in payload.items() if k in ('code','customer_code','employee_code','mandrel_code','description') and v}
    row=next((r for r in values if identifiers and all(r.get(k)==v for k,v in identifiers.items())),None)
    row=row or req('master','POST',path,payload)
    state[key]=row;STATE.write_text(json.dumps(state,indent=2));return row

login=httpx.post(f'http://127.0.0.1:{PORTS["auth"]}/auth/login',data={'username':'admin@hariom.com','password':os.getenv('SEASON_VERIFY_PASSWORD','admin123')},timeout=20)
assert login.is_success,'Local bootstrap authentication failed'
client.headers['Authorization']='Bearer '+login.json()['access_token']
mark('Owner/Admin authenticated with both-plant scope')

if not state.get('rules_published'):
    roy=req('spec','GET','/qc-rules?season=ROY')
    if not roy.get('draft') and not roy.get('published'):req('spec','POST','/season/bootstrap',cmd())
    for season in ('ROY','MONSOON'):
        value=req('spec','GET','/qc-rules?season='+season)
        if not value.get('published'):req('spec','POST','/qc-rules/draft/publish?season='+season,cmd(expected_version=value['draft']['row_version'],note='Verified client default rules'))
    mark('Independent identical seasonal templates published',rules_published=True)

customer=master('customer','/master/customers/',{'customer_code':'SEASON_VERIFY','name':'Season acceptance customer'})
mandrel=master('mandrel','/master/mandrels/',{'outer_diameter_mm':76.3,'length_mm':1560,'mandrel_code':'SEASON_VERIFY_MANDREL'})
paper=master('paper','/master/papers/',{'code':'SEASON_VERIFY_300','variety':'Kraft','gsm':300,'bf':20,'bulk_factor':1})
tube=master('tube','/master/tube-sizes/',{'inner_diameter_mm':76.4,'outer_diameter_mm':81,'length_mm':150,'description':'Season acceptance'})
operator=master('operator','/master/employees/',{'employee_code':'SEASON_OP','name':'Acceptance operator','role':'Operator','department':'WINDER','default_shift':'SHIFT_A'})
supervisor=master('supervisor','/master/employees/',{'employee_code':'SEASON_SUP','name':'Acceptance supervisor','role':'Supervisor','department':'WINDER','default_shift':'SHIFT_A'})
for stage,capacity,unit in [('WINDER',5000,'METERS_PER_DAY'),('OVEN',10,'BATCHES_PER_DAY'),('PROCESS',1000,'TUBES_PER_DAY'),('PACKING',1000,'TUBES_PER_DAY')]:
    payload={'code':'SEASON_VERIFY_'+stage,'name':'Acceptance '+stage,'department':stage,'capacity_type':unit,'capacity_value':capacity,'id_min_mm':70,'id_max_mm':90,'od_min_mm':75,'od_max_mm':100,'length_min_mm':100,'length_max_mm':2000,'supported_mandrel_ids':[mandrel['id']]}
    if stage=='OVEN':payload.update(batch_bamboo_capacity=100,cycle_time_hours=6)
    master('machine_'+stage,'/master/machines/',payload)
mark('Scoped masters and operators created through APIs')

if not state.get('spec_id'):
    preview=req('spec','POST','/calculate/preview',{'tube_length_mm':150,'tube_od_mm':81,'tube_id_mm':76.3,'target_dry_weight_g':35,'drying_percent':9,'parchment_percent':0,'parchment_allowed':False,'adhesive_percent':12.5,'recipe_rows':[{'paper_id':paper['id'],'gsm':300,'thickness_per_ply':.3,'ply_count':3}]})
    # Match the canonical three-ply mass; recipe approval still validates it.
    import importlib.util
    module=importlib.util.spec_from_file_location('acceptance_spec_math','hariom-erp/services/spec-service/src/spec_math.py');math=importlib.util.module_from_spec(module)
    import sys
    sys.modules[module.name]=math;module.loader.exec_module(math)
    target=round(math.compute_preview(mandrel_od_mm=76.3,tube_length_mm=150,papers=[math.RecipePaper(paper_id=paper['id'],gsm=300,bulk=1,ply_count=3)],target_dry_g=35,adhesive_percent=12.5,parchment_percent=0,parchment_allowed=False).nominal_tube.dry_g,4)
    fields={'customer_id':customer['id'],'customer_name':customer['name'],'customer_name_snapshot':customer['name'],'tube_size_id':tube['id'],'mandrel_id':mandrel['id'],'id_min_mm':76.2,'id_max_mm':76.6,'od_min_mm':81,'od_max_mm':81,'length_min_mm':149.8,'length_max_mm':150.2,'target_tube_weight':target,'required_cs':400,'cs_min_n':400,'adhesive_percent':12.5,'moisture_loss_percent':9,'parchment_percent':0,'parchment_allowed':False,'dynamic_fields':[{'field_key':k,'value':v} for k,v in {'valid_upto':'2027-10-03','prepared_by':'Acceptance owner','prepared_date':date.today().isoformat(),'sign_off_note':'Client default seasonal verification','adhesive_components_json':'[{"name":"Glue","ratio_percent":100}]'}.items()]}
    layers=[{'paper_id':paper['id'],'ply_no':i,'gsm_snapshot':300,'bf_snapshot':20,'bulk_snapshot':1} for i in (1,2,3)]
    value=req('spec','POST','/specs/document',cmd(spec=fields,recipes={'ROY':{'layers':layers,'notes':'Acceptance original'},'MONSOON':{'layers':layers,'notes':'Acceptance original','confirm':True}}))
    mark('Atomic dual-recipe specification saved',spec_id=value['spec']['id'],spec_revision=value['spec']['write_revision'],target_weight=target)
if not state.get('spec_approved'):
    sid=state['spec_id'];rev=state['spec_revision']
    req('spec','POST',f'/specs/{sid}/season-review',cmd(expected_version=rev))
    req('spec','POST',f'/specs/{sid}/season-approve',cmd(expected_version=rev))
    mark('Both recipe bindings approved with effective QC',spec_approved=True)

if not state.get('order_id'):
    order=req('sales','POST','/sales-orders',{'customer_id':customer['id'],'origin':'CUSTOMER_PO','po_number':'SEASON_ACCEPTANCE_001','po_date':date.today().isoformat(),'expiry_date':(date.today()+timedelta(days=90)).isoformat(),'lines':[{'approved_spec_id':state['spec_id'],'qty':100,'due_date':(date.today()+timedelta(days=7)).isoformat(),'rate_per_pc':5,'product_code':'SEASON-TEST'}]})
    mark('Sales order bound to approved specification',order_id=order['id'],line_id=order['lines'][0]['id'])
if not state.get('order_approved'):
    # Existing segregation of duties remains mandatory.
    password='Verify-'+secrets.token_urlsafe(18)+'1aA!'
    email='season-approver-'+uuid.uuid4().hex[:8]+'@example.com'
    req('auth','POST','/users/',{'name':'Acceptance approver','email':email,'password':password,'role_names':['Admin'],'plant_id':PLANT,'allowed_plant_ids':[PLANT]})
    other=httpx.post(f'http://127.0.0.1:{PORTS["auth"]}/auth/login',data={'username':email,'password':password},timeout=20)
    assert other.is_success
    token=client.headers['Authorization'];client.headers['Authorization']='Bearer '+other.json()['access_token']
    req('sales','POST',f'/sales-orders/{state["order_id"]}/approve')
    client.headers['Authorization']=token
    mark('Sales segregation of duties retained',order_approved=True)
if not state.get('lot_id'):
    lot=req('sales','POST',f'/sales-orders/lines/{state["line_id"]}/release',{'release_qty':100,'winder_machine_id':state['machine_WINDER']['id'],'release_lot_id':str(uuid.uuid4())})
    mark('Sales release lot committed',lot_id=lot['id'])
if not state.get('job_id'):
    result=req('production','POST',f'/sales-orders/{state["order_id"]}/release-sync',{'release_rows':[{'sales_order_line_id':state['line_id'],'release_lot_id':state['lot_id'],'winder_machine_id':state['machine_WINDER']['id'],'release_qty':100}]})
    mark('Production release froze seasonal recipe and QC bundle',job_id=result['line_results'][0]['job_card_id'])
job=req('production','GET',f'/job-cards/{state["job_id"]}')
assert job['spec_snapshot']['entry_model']=='V2'
flow=req('production','GET',f'/job-cards/{state["job_id"]}/flow')
mark('Frozen card flow loads',season=flow['season'],recipe_revision=flow['recipe_revision'])
print('Fixture ready for floor and browser acceptance',flush=True)

if os.getenv('SEASON_VERIFY_FLOOR')=='1':
    jid=state['job_id']
    def floor():return req('production','GET',f'/job-cards/{jid}/flow')
    def stage_state(stage):return next(s for s in floor()['stages'] if s['stage']==stage)
    def samples(readings):return [{'sample_id':str(uuid.uuid4()),'readings':readings} for _ in range(2)]
    def submit(stage,produced,accepted,input_qty=0,readings=None,**extra):
        return req('production','POST',f'/job-cards/{jid}/entries',cmd(stage=stage,business_date=date.today().isoformat(),shift_code='SHIFT_A',operator_id=operator['id'],produced=produced,accepted=accepted,input_quantity=input_qty,samples=samples(readings) if readings else [],submit=True,**extra))
    def close(stage,**extra):
        return req('production','POST',f'/job-cards/{jid}/stages/{stage}/close',cmd(expected_version=stage_state(stage)['row_version'],supervisor_id=supervisor['id'],reason='Acceptance fixture material-issue exception',**extra))
    if not state.get('slots_scheduled'):
        for stage in ('WINDER','OVEN','PROCESS','PACKING'):
            req('production','POST',f'/job-cards/{jid}/assign-machine',{'stage':stage,'machine_id':state['machine_'+stage]['id'],'sequence_no':1,'plan_date':date.today().isoformat(),'shift_code':'SHIFT_A'})
        mark('Compatible machines scheduled in existing planner',slots_scheduled=True)
    profile=job['spec_snapshot']['qc_profile'];bamboo=profile['refs']['WINDING_LENGTH']
    wread={'id':76.3,'od':82,'height':bamboo,'weight':state['target_weight']*10*1.1,'cs':165}
    oread={'pre_weight':1000,'post_weight':910,'pre_moisture':10,'post_moisture':8,'cs':420}
    pread={'id':76.4,'od':81,'height':150,'weight':state['target_weight'],'cs':420,'moisture':8}
    if not state.get('continuous_output'):
        submit('WINDER',5,5,readings=wread)
        submit('OVEN',5,5,5,readings=oread)
        submit('PROCESS',50,50,5,readings=pread)
        f=floor();assert all(next(s for s in f['stages'] if s['stage']==x)['status']=='RUNNING' for x in ('WINDER','OVEN','PROCESS'))
        mark('Winding, Oven and Process overlap with bounded allocations',continuous_output=True)
    if not state.get('wop_complete'):
        for stage,target,inputs in [('WINDER',10,0),('OVEN',10,10),('PROCESS',100,10)]:
            current=stage_state(stage)
            if current['produced_total']<target:
                submit(stage,target,target,inputs,quantity_mode='TOTAL',expected_version=current['row_version'])
            if stage_state(stage)['status']!='COMPLETED':close(stage)
        mark('Cumulative totals post deltas; min-two QC and supervisor closure',wop_complete=True)
    if not state.get('packing_closed'):
        fg=req('inventory','POST','/items/',{'item_code':'SEASON_VERIFY_FG','name':'Acceptance finished tubes','type':'FINISHED_GOOD','uom':'PCS'})
        submit('PACKING',100,100,100)
        close('PACKING',fg_item_id=fg['id'])
        mark('Packing closed to a validated finished-good item',packing_closed=True,fg_item_id=fg['id'])
    if not state.get('final_qc'):
        final={'id':76.4,'od':81,'length':150,'weight':state['target_weight'],'cs':420}
        result=req('production','POST','/quality/inspections/import',{'rows':[{'job_card_id':jid,'stage_type':'QC','sample_id':str(uuid.uuid4()),'readings':final,'final_submission':True} for _ in range(2)]})
        assert all(v['status']=='PASS' for v in result),result
        submit('QC',100,100,100)
        close('QC')
        mark('Two final customer-spec samples passed and QC stage closed',final_qc=True)
    import time
    for _ in range(20):
        detail=req('production','GET',f'/job-cards/{jid}')
        record=detail.get('packing_record') or {}
        inward=record.get('snapshot') or {}
        if inward.get('inventory_batch_id'):break
        time.sleep(1)
    assert inward.get('inventory_batch_id'), 'Durable FG inward did not deliver; inspect outbox'
    mark('Durable finished-goods inward posted',fg_batch_id=inward['inventory_batch_id'],fg_transaction_id=inward.get('inventory_transaction_id'))
    if not state.get('dispatched'):
        body={'job_card_id':jid,'dispatch_request_id':str(uuid.uuid4()),'status':'SEALED','fg_item_id':state['fg_item_id'],'fg_batch_id':state['fg_batch_id'],'dispatch_qty':100,'dispatch_snapshot':{'date':date.today().isoformat(),'challan_no':'SEASON_ACCEPTANCE_CHALLAN'}}
        dispatch=req('production','POST','/dispatch/',body)
        duplicate=req('production','POST','/dispatch/',body)
        assert dispatch['id']==duplicate['id']
        order=req('sales','GET',f'/sales-orders/{state["order_id"]}')
        assert order['lines'][0]['fulfilled_qty']==100,order['lines'][0]
        detail=req('production','GET',f'/job-cards/{jid}')
        assert detail['status']=='COMPLETED'
        mark('Dispatch replay produced one stock movement and one fulfillment',dispatched=True,dispatch_id=dispatch['id'])

if os.getenv('SEASON_VERIFY_BOUNDARY')=='1':
    sid=state['spec_id'];original=req('production','GET',f'/job-cards/{state["job_id"]}')
    original_hash=original['spec_snapshot']['release_bundle_hash']
    document=req('spec','GET',f'/specs/{sid}/season-document')
    old_roy=document['recipes']['ROY']['id']
    monpaper=master('paper_monsoon','/master/papers/',{'code':'SEASON_VERIFY_MONSOON_300','variety':'Kraft','gsm':300,'bf':25,'bulk_factor':1})
    if not state.get('monsoon_revision'):
        stale=req('spec','POST','/season/switch/preview',{'to':'MONSOON'})
        layers=[{'paper_id':monpaper['id'],'ply_no':i,'gsm_snapshot':300,'bf_snapshot':25,'bulk_snapshot':1} for i in (1,2,3)]
        edited=req('spec','PUT',f'/specs/{sid}/recipes/MONSOON/revision',cmd(expected_version=document['recipes']['MONSOON']['row_version'],layers=layers,confirm=True,note='Monsoon-only paper substitution for acceptance'))
        draft=edited['recipes']['MONSOON']['draft']
        req('spec','POST',f'/specs/{sid}/recipes/MONSOON/approve',cmd(expected_version=draft['row_version'],note='Monsoon-only recipe reviewed'))
        negative=client.post(f'http://127.0.0.1:{PORTS["spec"]}/season/switch',json=cmd(to='MONSOON',expected_version=stale['epoch'],preview_fingerprint=stale['fingerprint'],note='Stale preview must fail'))
        assert negative.status_code==409,negative.text
        document=req('spec','GET',f'/specs/{sid}/season-document')
        assert document['recipes']['ROY']['id']==old_roy and document['recipes']['ROY']['season_revision']==1
        assert document['recipes']['MONSOON']['season_revision']==2
        mark('Monsoon changed independently; stale switch preview rejected',monsoon_revision=2,roy_recipe_id=old_roy,monsoon_recipe_id=document['recipes']['MONSOON']['id'])
    if not state.get('boundary_order_id'):
        order=req('sales','POST','/sales-orders',{'customer_id':customer['id'],'origin':'CUSTOMER_PO','po_number':'SEASON_ACCEPTANCE_BOUNDARY','po_date':date.today().isoformat(),'expiry_date':(date.today()+timedelta(days=90)).isoformat(),'lines':[{'approved_spec_id':sid,'qty':100,'due_date':(date.today()+timedelta(days=7)).isoformat(),'rate_per_pc':5,'product_code':'SEASON-BOUNDARY'}]})
        mark('Unreleased sales demand created',boundary_order_id=order['id'],boundary_line_id=order['lines'][0]['id'])
    if not state.get('boundary_approved'):
        password='Verify-'+secrets.token_urlsafe(18)+'1aA!';email='season-boundary-'+uuid.uuid4().hex[:8]+'@example.com'
        req('auth','POST','/users/',{'name':'Boundary approver','email':email,'password':password,'role_names':['Admin'],'plant_id':PLANT,'allowed_plant_ids':[PLANT]})
        other=httpx.post(f'http://127.0.0.1:{PORTS["auth"]}/auth/login',data={'username':email,'password':password},timeout=20)
        assert other.is_success
        token=client.headers['Authorization'];client.headers['Authorization']='Bearer '+other.json()['access_token']
        req('sales','POST',f'/sales-orders/{state["boundary_order_id"]}/approve');client.headers['Authorization']=token
        mark('Boundary sales approved independently',boundary_approved=True)
    def switch(to):
        active=req('spec','GET','/season')
        if active['active_season']==to:return
        preview=req('spec','POST','/season/switch/preview',{'to':to})
        req('spec','POST','/season/switch',cmd(to=to,expected_version=preview['epoch'],preview_fingerprint=preview['fingerprint'],acknowledge_blocked=True,note='Isolated season boundary acceptance'))
    switch('MONSOON')
    bom=req('spec','GET',f'/calculate/bom-for-spec/{sid}')
    assert bom['recipe_id']==state['monsoon_recipe_id']
    demand=req('bff','GET',f'/api/purchase/material-demand?as_of_date={date.today().isoformat()}&horizon_end={(date.today()+timedelta(days=30)).isoformat()}')
    own=[r for r in demand['requirements'] if r['line_id']==state['boundary_line_id']]
    assert own and all(r['recipe_id']==state['monsoon_recipe_id'] for r in own),demand
    mark('Unreleased material demand follows global Monsoon selection')
    if not state.get('boundary_lot_id'):
        lot=req('sales','POST',f'/sales-orders/lines/{state["boundary_line_id"]}/release',{'release_qty':50,'winder_machine_id':state['machine_WINDER']['id'],'release_lot_id':str(uuid.uuid4())})
        mark('Monsoon sales release committed',boundary_lot_id=lot['id'])
    if not state.get('boundary_job_id'):
        result=req('production','POST',f'/sales-orders/{state["boundary_order_id"]}/release-sync',{'release_rows':[{'sales_order_line_id':state['boundary_line_id'],'release_lot_id':state['boundary_lot_id'],'winder_machine_id':state['machine_WINDER']['id'],'release_qty':50}]})
        mark('New release froze Monsoon r2',boundary_job_id=result['line_results'][0]['job_card_id'])
    mon=req('production','GET',f'/job-cards/{state["boundary_job_id"]}')
    assert mon['spec_snapshot']['season']=='MONSOON' and mon['material_plan_snapshot']['recipe_snapshot']['season_revision']==2
    switch('ROY')
    bom=req('spec','GET',f'/calculate/bom-for-spec/{sid}');assert bom['recipe_id']==state['roy_recipe_id']
    after=req('production','GET',f'/job-cards/{state["job_id"]}')
    assert after['spec_snapshot']['release_bundle_hash']==original_hash and after['spec_snapshot']['season']=='ROY'
    still_mon=req('production','GET',f'/job-cards/{state["boundary_job_id"]}');assert still_mon['spec_snapshot']['release_bundle_hash']==mon['spec_snapshot']['release_bundle_hash']
    mark('Switch back refreshes unreleased demand while both released cards stay frozen',season_boundary=True)

if os.getenv('SEASON_VERIFY_BATCH')=='1':
    import time
    jid=state['boundary_job_id']
    def negative(service,method,path,body,expected=(409,422)):
        response=client.request(method,f'http://127.0.0.1:{PORTS[service]}{path}',json=body)
        assert response.status_code in expected,(path,response.status_code,response.text[:700])
    def snapshot():return req('production','GET',f'/job-cards/{jid}')
    def flow():return req('production','GET',f'/job-cards/{jid}/flow')
    def readings(values):return [{'sample_id':str(uuid.uuid4()),'readings':values} for _ in range(2)]
    if not state.get('mixed_demand_checked'):
        demand=req('bff','GET',f'/api/purchase/material-demand?as_of_date={date.today().isoformat()}&horizon_end={(date.today()+timedelta(days=30)).isoformat()}')
        own=[r for r in demand['requirements'] if r['line_id']==state['boundary_line_id']]
        frozen=[r for r in own if r['basis']=='FROZEN_JOB_RESIDUAL'];unreleased=[r for r in own if r['basis']=='UNRELEASED_OPEN_SALES_BOM']
        assert frozen and unreleased and all(r['open_units']==50 and r['recipe_id']==state['monsoon_recipe_id'] for r in frozen) and all(r['open_units']==50 and r['recipe_id']==state['roy_recipe_id'] for r in unreleased),own
        mark('Mixed demand partitions frozen Monsoon 50 and unreleased rest-of-year 50 without duplication',mixed_demand_checked=True)
    if not state.get('raw_item_id'):
        items=req('inventory','GET','/items/')
        item=next((i for i in items if i['item_code']==state['paper_monsoon']['code']),None) or req('inventory','POST','/items/',{'item_code':state['paper_monsoon']['code'],'name':'Acceptance Monsoon paper','type':'RAW_PAPER','tracking_mode':'REEL','uom':'KG'})
        saved=req('inventory','PUT',f'/items/{item["id"]}/quality-profile',{'quality_profile':{'parameters':[{'code':'gsm','label':'GSM','min':290,'max':310,'required':True,'unit':'gsm'}]},'setup_status':'complete'})
        own=client.post(f'http://127.0.0.1:{PORTS["inventory"]}/items/{item["id"]}/quality-profile/approve',json={'expected_revision':saved['quality_profile']['revision']})
        assert own.status_code==409 and own.json()['detail']['code']=='SELF_APPROVAL'
        independent_approval('inventory',f'/items/{item["id"]}/quality-profile/approve',{'expected_revision':saved['quality_profile']['revision']})
        mark('Incoming material profile approved independently of seasonal stage rules',raw_item_id=item['id'])
    if not state.get('procurement_po_id'):
        suppliers=req('master','GET','/master/suppliers/')
        supplier=next((r for r in suppliers if r['name']=='Season acceptance supplier'),None) or req('master','POST','/master/suppliers/',{'supplier_code':'SEASON_VERIFY_SUPPLIER','name':'Season acceptance supplier'})
        po=req('inventory','POST','/inventory/purchase/orders',{'request_id':str(uuid.uuid4()),'supplier_id':supplier['id'],'supplier_name':supplier['name'],'po_date':date.today().isoformat(),'expected_date':date.today().isoformat(),'lines':[{'item_id':state['raw_item_id'],'qty_ordered':100,'unit_cost':50,'uom':'KG','incoming_qc_required':True,'gsm':300,'width_mm':1500}]})
        submitted=req('inventory','POST',f'/inventory/purchase/orders/{po["id"]}/submit',{'expected_version':po['version']})
        mark('Purchase order submitted with versioned paper requirements',procurement_po_id=po['id'],procurement_po_version=submitted['version'],procurement_po_line_id=po['lines'][0]['id'])
    if not state.get('procurement_po_approved'):
        password='Verify-'+secrets.token_urlsafe(18)+'1aA!';email='season-po-'+uuid.uuid4().hex[:8]+'@example.com'
        req('auth','POST','/users/',{'name':'Acceptance purchasing Owner','email':email,'password':password,'role_names':['Owner'],'plant_id':PLANT,'allowed_plant_ids':[PLANT,'00000000-0000-0000-0000-0000000000b2']})
        second=httpx.post(f'http://127.0.0.1:{PORTS["auth"]}/auth/login',data={'username':email,'password':password},timeout=20)
        assert second.is_success
        original_token=client.headers['Authorization'];client.headers['Authorization']='Bearer '+second.json()['access_token']
        req('inventory','POST',f'/inventory/purchase/orders/{state["procurement_po_id"]}/approve',{'expected_version':state['procurement_po_version'],'reason':'Independent acceptance approval'})
        client.headers['Authorization']=original_token
        mark('A different Owner approved the purchase revision',procurement_po_approved=True)
    if not state.get('raw_receipt_id'):
        existing=next((r for r in req('inventory','GET','/inventory/procurement/receipts?limit=100')['items'] if r['purchase_order_id']==state['procurement_po_id']),None)
        body={'request_id':existing['request_id'] if existing else str(uuid.uuid4()),'purchase_order_id':state['procurement_po_id'],'received_date':existing['received_date'] if existing else date.today().isoformat(),'invoice_pending':True,'lines':[{'po_line_id':state['procurement_po_line_id'],'lots':[{'source_reel_no':'SEASON_ACCEPTANCE_RM_001','net_weight_kg':100,'width_mm':1500}]}]}
        receipt=existing or req('inventory','POST','/inventory/procurement/receipts',body)
        replay=req('inventory','POST','/inventory/procurement/receipts',body)
        assert receipt['id']==replay['id']
        reel=receipt['lots'][0]
        mark('Governed receipt replay creates one physical inward lot',raw_receipt_id=receipt['id'],raw_reel_id=reel['id'])
    if not state.get('raw_incoming_passed'):
        # QC cannot release stock while the invoice is still pending.
        inspected=req('inventory','POST','/inventory/quality/inspections',{'entity_type':'REEL','entity_id':state['raw_reel_id'],'readings':{'gsm':300},'sample_count':2,'sample_ids':[str(uuid.uuid4()),str(uuid.uuid4())]})
        assert inspected['status']=='PASS',inspected
        negative('inventory','POST','/reel-issues',{'reel_id':state['raw_reel_id'],'issue_section':'SLITTING_SECTION','shift':'A','issue_date':date.today().isoformat(),'issued_weight_kg':100},(400,409))
        receipt=req('inventory','GET',f'/inventory/procurement/receipts/{state["raw_receipt_id"]}')
        req('inventory','POST',f'/inventory/procurement/receipts/{state["raw_receipt_id"]}/attach-invoice',{'expected_version':receipt['posting_version'],'invoice_no':'SEASON_ACCEPTANCE_INVOICE','invoice_date':date.today().isoformat(),'lines':[{'receipt_line_id':receipt['lines'][0]['id'],'invoice_quantity':100,'invoice_rate':50}]})
        mark('Incoming QC passes; commercial pending blocks issue until invoice is attached',raw_incoming_passed=True)
    if not state.get('coil_id'):
        if not state.get('slitting_issue_id'):
            issue=next((r for r in req('inventory','GET','/reel-issues?status=OPEN') if r['reel_id']==state['raw_reel_id']),None) or req('inventory','POST','/reel-issues',{'reel_id':state['raw_reel_id'],'issue_section':'SLITTING_SECTION','shift':'A','issue_date':date.today().isoformat(),'issued_weight_kg':100})
            mark('Cleared reel issued to slitting',slitting_issue_id=issue['id'])
        slit=req('inventory','POST','/reels/slit',{'parent_reel_id':state['raw_reel_id'],'children':[{'weight_kg':49.5,'width_mm':750},{'weight_kg':49.5,'width_mm':750}],'trim_wastage_kg':1,'slit_date':date.today().isoformat(),'remarks':'Acceptance slitting mass conservation'})
        assert sum(c['weight_kg'] for c in slit['children'])+slit['trim_wastage_kg']==100
        mark('Slitting conserves parent mass into coils and trim',coil_id=slit['child_reel_ids'][0])
    if not state.get('batch_slots'):
        for stage in ('WINDER','OVEN','PROCESS','PACKING'):
            req('production','POST',f'/job-cards/{jid}/assign-machine',{'stage':stage,'machine_id':state['machine_'+stage]['id'],'sequence_no':2,'plan_date':date.today().isoformat(),'shift_code':'SHIFT_A'})
        mark('Second seasonal card scheduled',batch_slots=True)
    if not state.get('winder_issue_id'):
        issue=req('inventory','POST','/reel-issues',{'reel_id':state['coil_id'],'issue_section':'WINDER_SECTION','machine_id':state['machine_WINDER']['id'],'shift':'A','issue_date':date.today().isoformat(),'issued_weight_kg':5,'customer_id':customer['id'],'sales_order_id':state['boundary_order_id']})
        consumption=sum(float(p['weight_kg']) for p in snapshot()['material_plan_snapshot']['bom_snapshot']['raw_materials']['papers'])*5
        closed=req('inventory','POST',f'/reel-issues/{issue["id"]}/close',{'consumed_weight_kg':consumption})
        assert closed['status']=='CLOSED' and abs(closed['consumed_weight_kg']-consumption)<0.00001
        mark('Winding coil issued and actual material consumption reconciled',winder_issue_id=issue['id'])
    if not state.get('batch_production'):
        profile=snapshot()['spec_snapshot']['qc_profile'];bamboo=profile['refs']['WINDING_LENGTH'];fg=state['fg_item_id']
        values={'WINDER':{'id':76.3,'od':82,'height':bamboo,'weight':state['target_weight']*11,'cs':165},'OVEN':{'pre_weight':1000,'post_weight':910,'pre_moisture':10,'post_moisture':8,'cs':420},'PROCESS':{'id':76.4,'od':81,'height':150,'weight':state['target_weight'],'cs':420,'moisture':8}}
        stages={s['stage']:s for s in flow()['stages']}
        def step(stage,qty,input_qty,close=True):
            row=stages[stage]
            return {'entry':cmd(stage=stage,quantity_mode='TOTAL',expected_version=row['row_version'],business_date=date.today().isoformat(),shift_code='SHIFT_A',operator_id=operator['id'],produced=qty,accepted=qty,input_quantity=input_qty,samples=readings(values[stage]) if stage in values else [],submit=True),'close':cmd(expected_version=row['row_version']+1,supervisor_id=supervisor['id'],fg_item_id=fg if stage=='PACKING' else None,reel_issue_ids=[state['winder_issue_id']] if stage=='WINDER' else []) if close else None}
        failed=cmd(steps=[step('WINDER',5,0),step('OVEN',6,6)])
        negative('production','POST',f'/job-cards/{jid}/entries/batch',failed)
        assert all(s['accepted_total']==0 for s in flow()['stages'])
        good=cmd(steps=[step('WINDER',5,0),step('OVEN',5,5),step('PROCESS',50,5),step('PACKING',50,50)])
        saved=req('production','POST',f'/job-cards/{jid}/entries/batch',good)
        replay=req('production','POST',f'/job-cards/{jid}/entries/batch',good)
        assert saved==replay and len(saved['entries'])==4
        mark('Whole-card failure rolls back every stage; valid replay commits exactly once',batch_production=True)
    if not state.get('batch_final_qc'):
        negative('production','POST',f'/job-cards/{jid}/fg-inward/retry',{})
        negative('production','POST','/dispatch/',{'job_card_id':jid,'dispatch_request_id':str(uuid.uuid4()),'status':'SEALED','fg_item_id':state['fg_item_id'],'dispatch_qty':50})
        final={'id':76.4,'od':81,'length':150,'weight':state['target_weight'],'cs':420}
        req('production','POST','/quality/inspections/import',{'rows':[{'job_card_id':jid,'stage_type':'QC','sample_id':str(uuid.uuid4()),'readings':final,'final_submission':True} for _ in range(2)]})
        qc=next(s for s in flow()['stages'] if s['stage']=='QC')
        req('production','POST',f'/job-cards/{jid}/entries',cmd(stage='QC',business_date=date.today().isoformat(),shift_code='SHIFT_A',operator_id=operator['id'],produced=50,accepted=50,input_quantity=50,submit=True))
        qc=next(s for s in flow()['stages'] if s['stage']=='QC')
        req('production','POST',f'/job-cards/{jid}/stages/QC/close',cmd(expected_version=qc['row_version'],supervisor_id=supervisor['id']))
        mark('FG retry and Dispatch reject incomplete QC; two final samples permit close',batch_final_qc=True)
    for _ in range(30):
        record=snapshot().get('packing_record') or {};stock=record.get('snapshot') or {}
        if stock.get('inventory_batch_id'):break
        time.sleep(1)
    assert stock.get('inventory_batch_id'),'Second seasonal FG posting did not deliver'
    if not state.get('batch_dispatched'):
        hold=req('production','POST','/quality/holds',{'job_card_id':jid,'stage_type':'QC','reason':'Acceptance: late hold must block dispatch'})
        negative('production','POST','/dispatch/',{'job_card_id':jid,'dispatch_request_id':str(uuid.uuid4()),'status':'SEALED','fg_item_id':state['fg_item_id'],'fg_batch_id':stock['inventory_batch_id'],'dispatch_qty':50})
        req('production','POST',f'/quality/holds/{hold["id"]}/release')
        for _ in range(30):
            effects=req('production','GET',f'/job-cards/{jid}/effects')
            if not any(e['status'] in ('FAILED','PENDING') and e['kind'] in ('hold_stock','release_stock') for e in effects):break
            time.sleep(1)
        body={'job_card_id':jid,'dispatch_request_id':str(uuid.uuid4()),'status':'SEALED','fg_item_id':state['fg_item_id'],'fg_batch_id':stock['inventory_batch_id'],'dispatch_qty':50,'dispatch_snapshot':{'date':date.today().isoformat(),'challan_no':'SEASON_ACCEPTANCE_BATCH'}}
        dispatch=req('production','POST','/dispatch/',body);replay=req('production','POST','/dispatch/',body)
        assert dispatch['id']==replay['id']
        updated=req('sales','GET',f'/sales-orders/{state["boundary_order_id"]}')
        assert updated['lines'][0]['fulfilled_qty']==50 and updated['lines'][0]['release_remaining_qty']==50
        dispatch_stage=next(s for s in flow()['stages'] if s['stage']=='DISPATCH')
        assert dispatch_stage['accepted_total']==50 and dispatch_stage['status']=='COMPLETED'
        mark('Late QC hold blocks stock dispatch; release and replay yield one fulfillment',batch_dispatched=True)

if os.getenv('SEASON_VERIFY_UI_SETUP')=='1':
    if not state.get('ui_lot_id'):
        lot=req('sales','POST',f'/sales-orders/lines/{state["boundary_line_id"]}/release',{'release_qty':50,'winder_machine_id':state['machine_WINDER']['id'],'release_lot_id':str(uuid.uuid4())})
        mark('Remaining sales quantity released for browser entry verification',ui_lot_id=lot['id'])
    if not state.get('ui_job_id'):
        result=req('production','POST',f'/sales-orders/{state["boundary_order_id"]}/release-sync',{'release_rows':[{'sales_order_line_id':state['boundary_line_id'],'release_lot_id':state['ui_lot_id'],'winder_machine_id':state['machine_WINDER']['id'],'release_qty':50}]})
        mark('Fresh rest-of-year card prepared for browser entry',ui_job_id=result['line_results'][0]['job_card_id'])
        for stage in ('WINDER','OVEN','PROCESS','PACKING'):
            req('production','POST',f'/job-cards/{state["ui_job_id"]}/assign-machine',{'stage':stage,'machine_id':state['machine_'+stage]['id'],'sequence_no':3,'plan_date':date.today().isoformat(),'shift_code':'SHIFT_A'})

if os.getenv('SEASON_VERIFY_ROLES')=='1':
    owner_header=client.headers['Authorization']
    jid=state.get('ui_job_id') or state['job_id']
    for role in ('QC','Operator','Sales'):
        password='Verify-'+secrets.token_urlsafe(18)+'1aA!';email='season-role-'+uuid.uuid4().hex[:8]+'@example.com'
        req('auth','POST','/users/',{'name':'Disposable '+role+' acceptance','email':email,'password':password,'role_names':[role],'plant_id':PLANT,'allowed_plant_ids':[PLANT]})
        signed=httpx.post(f'http://127.0.0.1:{PORTS["auth"]}/auth/login',data={'username':email,'password':password},timeout=20)
        assert signed.is_success
        client.headers['Authorization']='Bearer '+signed.json()['access_token']
        try:
            req('production','GET',f'/job-cards/{jid}/flow')
            denied=client.post(f'http://127.0.0.1:{PORTS["spec"]}/season/switch/preview',json={'to':'MONSOON'})
            assert denied.status_code==403,(role,'season switch',denied.status_code)
            denied=client.post(f'http://127.0.0.1:{PORTS["production"]}/job-cards/{jid}/stages/WINDER/close',json=cmd(supervisor_id=supervisor['id']))
            assert denied.status_code==403,(role,'stage close',denied.status_code)
            wrong_plant=client.get(f'http://127.0.0.1:{PORTS["production"]}/job-cards/{jid}/flow',headers={'X-Plant-ID':'00000000-0000-0000-0000-0000000000b2'})
            assert wrong_plant.status_code==403,(role,'cross plant',wrong_plant.status_code)
            if role=='QC':
                rules=req('spec','GET','/qc-rules?season=ROY')
                saved=req('spec','PUT','/qc-rules/draft?season=ROY',cmd(expected_version=rules['draft']['row_version'] if rules.get('draft') else None,rules=(rules.get('draft') or rules['published'])['rules'],note='Disposable QC role contract: unchanged client rules'))
                assert saved['status']=='DRAFT'
                denied=client.post(f'http://127.0.0.1:{PORTS["production"]}/job-cards/{jid}/entries',json=cmd(stage='WINDER',produced=1,accepted=1))
                assert denied.status_code==403
            elif role=='Operator':
                denied=client.post(f'http://127.0.0.1:{PORTS["production"]}/job-cards/{jid}/entries',json=cmd(stage='WINDER',produced=1,accepted=1,submit=True))
                assert denied.status_code==403
                if state.get('ui_job_id'):
                    draft=req('production','POST',f'/job-cards/{jid}/entries',cmd(stage='WINDER',produced=1,accepted=1,operator_id=operator['id'],shift_code='SHIFT_A'))['entry']
                    assert draft['status']=='DRAFT'
                    client.headers['Authorization']=owner_header
                    voided=req('production','POST',f'/job-cards/{jid}/entries/{draft["id"]}/void',cmd(expected_version=draft['row_version'],reason='Dispose isolated role-verification draft'))['entry']
                    assert voided['status']=='VOID'
            else:
                denied=client.put(f'http://127.0.0.1:{PORTS["spec"]}/qc-rules/draft?season=ROY',json=cmd(rules=[],note='Must be denied'))
                assert denied.status_code==403
            mark('Authenticated '+role+' permissions and cross-plant denials verified')
        finally:client.headers['Authorization']=owner_header
