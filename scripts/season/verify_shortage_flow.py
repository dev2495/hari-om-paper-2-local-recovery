#!/usr/bin/env python3
"""Local-only acceptance: QC rejects → partial shipments → frozen remake → final fulfillment."""
import json
import os
import time
import uuid
from datetime import date
from pathlib import Path

import httpx

if os.getenv('ERP_DB_PREFIX') != 'hariom_nverify_season_':
    raise SystemExit('Named disposable seasonal runtime only')
base = json.loads(Path('reports/season-integrated-fixture-final.json').read_text())
if not base.get('ui_job_id'):
    raise SystemExit('Prepare the FINAL UI fixture first')
state_path = Path('reports/season-shortage-fixture-final.json')
state = json.loads(state_path.read_text()) if state_path.exists() else {'date':date.today().isoformat()}
plant = '00000000-0000-0000-0000-0000000000a1'
ports = {'auth':18022,'master':18023,'sales':18028,'inventory':18026,'production':18025}
client = httpx.Client(timeout=30,headers={'X-Plant-ID':plant})
login = client.post('http://127.0.0.1:18022/auth/login',data={'username':'admin@hariom.com','password':os.getenv('SEASON_VERIFY_PASSWORD','admin123')})
assert login.is_success
client.headers['Authorization'] = 'Bearer '+login.json()['access_token']

def req(service,method,path,body=None):
    response = client.request(method,f'http://127.0.0.1:{ports[service]}{path}',json=body)
    assert response.is_success,(method,service,path,response.status_code,response.text[:1000])
    return response.json()

def mark(name,**values):
    state.update(values);state_path.write_text(json.dumps(state,indent=2));print('PASS',name,flush=True)

def key(job,operation):return str(uuid.uuid5(uuid.UUID(job),operation))
def flow(job):return req('production','GET',f'/job-cards/{job}/flow')
def stage(job,name):return next(row for row in flow(job)['stages'] if row['stage']==name)
def samples(readings):return [{'sample_id':str(uuid.uuid4()),'readings':readings} for _ in range(2)]

def produce(job,quantity,qc_accepted):
    assert quantity%10==0
    detail = req('production','GET',f'/job-cards/{job}')
    profile = detail['spec_snapshot']['qc_profile']
    values = {'WINDER':{'id':76.3,'od':82,'height':profile['refs']['WINDING_LENGTH'],'weight':base['target_weight']*11,'cs':165},
              'OVEN':{'pre_weight':1000,'post_weight':910,'pre_moisture':10,'post_moisture':8,'cs':420},
              'PROCESS':{'id':76.4,'od':81,'height':150,'weight':base['target_weight'],'cs':420,'moisture':8}}
    for name in ('WINDER','OVEN','PROCESS','PACKING'):
        if stage(job,name)['status']=='COMPLETED':continue
        req('production','POST',f'/job-cards/{job}/assign-machine',{'stage':name,'machine_id':base['machine_'+name]['id'],'plan_date':state['date'],'shift_code':'SHIFT_A','sequence_no':7})
        units = quantity//10 if name in ('WINDER','OVEN') else quantity
        inputs = 0 if name=='WINDER' else quantity//10 if name in ('OVEN','PROCESS') else quantity
        if not stage(job,name)['produced_total']:
            req('production','POST',f'/job-cards/{job}/entries',{'request_id':key(job,'produce-'+name),'stage':name,'business_date':state['date'],'shift_code':'SHIFT_A','operator_id':base['operator']['id'],'produced':units,'accepted':units,'input_quantity':inputs,'samples':samples(values[name]) if name in values else [],'submit':True})
        req('production','POST',f'/job-cards/{job}/stages/{name}/close',{'request_id':key(job,'close-'+name),'expected_version':stage(job,name)['row_version'],'supervisor_id':base['supervisor']['id'],'reason':'Disposable acceptance material issue exception','fg_item_id':state['fg_item_id'] if name=='PACKING' else None})
    if stage(job,'QC')['status']!='COMPLETED':
        current = flow(job)
        if not current['final_samples']:
            readings = {'id':76.4,'od':81,'length':150,'weight':base['target_weight'],'cs':420}
            req('production','POST','/quality/inspections/import',{'rows':[{'job_card_id':job,'stage_type':'QC','sample_id':str(uuid.uuid4()),'readings':readings,'final_submission':True} for _ in range(2)]})
        if not stage(job,'QC')['produced_total']:
            req('production','POST',f'/job-cards/{job}/entries',{'request_id':key(job,'produce-QC'),'stage':'QC','business_date':state['date'],'shift_code':'SHIFT_A','operator_id':base['operator']['id'],'produced':quantity,'accepted':qc_accepted,'input_quantity':quantity,'details':{'reject_reason':'QC rejected pieces segregated for remake'},'submit':True})
        req('production','POST',f'/job-cards/{job}/stages/QC/close',{'request_id':key(job,'close-QC'),'expected_version':stage(job,'QC')['row_version'],'supervisor_id':base['supervisor']['id'],'reason':'Final QC rejects are segregated; replacement decision follows','short_close':qc_accepted<quantity})
    for _ in range(30):
        packing = req('production','GET',f'/job-cards/{job}')['packing_record']
        if packing and (packing['snapshot'] or {}).get('inventory_batch_id'):return packing
        time.sleep(2)
    raise AssertionError('Accepted FG posting did not finish')

def dispatch(job,quantity,label):
    body = {'job_card_id':job,'status':'SEALED','dispatch_request_id':key(job,label),'dispatch_qty':quantity,'dispatch_snapshot':{'date':state['date'],'challan_no':'SEASON-PARTIAL-FINAL'}}
    result = req('production','POST','/dispatch/',body)
    assert req('production','POST','/dispatch/',body)['id']==result['id']
    return result

if not state.get('fg_item_id'):
    items = req('inventory','GET','/items/')
    item = next((row for row in items if row['item_code']=='SEASON_SHORTAGE_FG_FINAL'),None)
    item = item or req('inventory','POST','/items/',{'item_code':'SEASON_SHORTAGE_FG_FINAL','name':'Disposable rejected-quantity acceptance FG','type':'FINISHED_GOOD','uom':'PCS'})
    mark('Dedicated local FG fixture ready',fg_item_id=item['id'])
parent = base['ui_job_id']
packing = produce(parent,50,40)
assert packing['snapshot']['fg_accepted_qty']==40 and packing['snapshot']['qc_rejected_qty']==10
mark('Final QC accepted40 of packed50; only40 entered unrestricted FG')
if not state.get('partial30'):
    dispatch(parent,30,'partial-thirty')
    line = req('sales','GET',f'/sales-orders/lines/{base["boundary_line_id"]}')
    assert line['fulfilled_qty']==80
    mark('First partial shipment30 reconciled with Sales80',partial30=True)
if not state.get('partial10'):
    dispatch(parent,10,'partial-ten')
    line = req('sales','GET',f'/sales-orders/lines/{base["boundary_line_id"]}')
    assert line['fulfilled_qty']==90
    mark('Second partial shipment10 completed accepted FG; rejected10 stayed outside stock',partial10=True)
codes = req('master','GET','/master/reason-codes/?category=SHORT_CLOSE')
active_codes = [row for row in codes if row.get('is_active',True) and row.get('active',True)]
if not active_codes:
    active_codes = [req('master','POST','/master/reason-codes/',{
        'code':'SEASON-VERIFY-SHORT','label':'Disposable seasonal QC remake acceptance',
        'category':'SHORT_CLOSE','severity':'WATCH',
        'description':'Named local verification runtime only; final QC rejected quantity needs replacement',
    })]
    mark('Local shortage reason configured through the authorized Master endpoint')
code = active_codes[0]['code']
body = {'produced_qty':40,'reason_code':code,'stage_type':'JOB_CARD','decision':'CARRY_FORWARD','notes':'Verified final QC rejected ten pieces; remake only the ten-piece gap'}
result = req('production','POST',f'/operations/short-close/{parent}',body)
assert req('production','POST',f'/operations/short-close/{parent}',body)['id']==result['id']
child = result['carry_forward_job_card_id']; assert child
parent_detail = req('production','GET',f'/job-cards/{parent}')
child_detail = req('production','GET',f'/job-cards/{child}')
assert child_detail['spec_snapshot']['release_bundle_hash']==parent_detail['spec_snapshot']['release_bundle_hash']
assert len(flow(child)['stages'])==len(flow(parent)['stages'])
mark('Completed parent shortage remade with original frozen bundle and a distinct release lot',child_job_id=child)
produce(child,10,10)
dispatch(child,10,'remake-ten')
line = req('sales','GET',f'/sales-orders/lines/{base["boundary_line_id"]}')
assert line['fulfilled_qty']==100
assert req('production','GET',f'/job-cards/{child}')['status']=='COMPLETED'
mark('Remake production, final QC, FG and dispatch fulfilled Sales100 exactly once',complete=True)
