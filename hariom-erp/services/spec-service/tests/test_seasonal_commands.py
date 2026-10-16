"""Database-level seasonal command contracts, using a disposable database only."""
import os
import uuid
import pytest
from fastapi import HTTPException

pytestmark = pytest.mark.skipif("hariom_nverify" not in os.getenv("DATABASE_URL", ""), reason="isolated PostgreSQL required")


@pytest.fixture
def api(monkeypatch):
    from src.main import app
    from src.database import SessionLocal
    from src.routers import seasonal as api
    from src.season_models import SeasonState, RuleVersion, SeasonReceipt, SeasonEvent
    db=SessionLocal()
    for model in (SeasonReceipt,SeasonEvent,RuleVersion,SeasonState):db.query(model).delete()
    db.commit()
    yield api,db
    db.rollback();db.close()


USER={"sub":"season-test-owner","roles":["Owner"],"allowed_plants":["PLANT_A","PLANT_B"]}


def command(api,**extra):return api.Command(request_id=str(uuid.uuid4()),**extra)


def winder_cs(rows):
    return next(r for r in rows if r["stage"]=="WINDER" and r["parameter"]=="cs")


def test_bootstrap_publishes_client_defaults_and_independent_history(api):
    a,db=api
    a.bootstrap(command(a),db,USER)
    roy=a.read_rules("ROY",db,USER);mon=a.read_rules("MONSOON",db,USER)
    # Client defaults are active for both seasons without a manual publish.
    assert roy["published"]["version"]==1 and mon["published"]["version"]==1
    assert roy["draft"] is None and roy["published"]["rules"]==mon["published"]["rules"]
    cs=winder_cs(roy["published"]["rules"])
    assert cs["lower"]==[{"ref":"CUSTOMER_CS","factor":0.4,"offset":-10}] and cs["upper"]==[{"ref":"CUSTOMER_CS","factor":0.4,"offset":10}]
    # Editing stays versioned and per season.
    rows=roy["published"]["rules"];rows[0]={**rows[0],"min_readings":3}
    a.save_rules(a.RuleDraft(request_id=str(uuid.uuid4()),rules=rows,note="Three winding I.D. samples"),"ROY",db,USER)
    draft=a.read_rules("ROY",db,USER)["draft"]
    assert draft["version"]==2
    a.publish_rules(command(a,expected_version=draft["row_version"],note="Client approved change"),"ROY",db,USER)
    assert a.read_rules("ROY",db,USER)["published"]["version"]==2
    assert a.read_rules("MONSOON",db,USER)["published"]["version"]==1
    assert [v["status"] for v in a.read_rules("ROY",db,USER)["versions"]]==["PUBLISHED","SUPERSEDED"]
    # Restarting the service never re-publishes or reverts an edited standard.
    assert a.ensure_default_rules(db)==[]
    assert a.read_rules("ROY",db,USER)["published"]["version"]==2


def test_legacy_winder_cs_template_is_corrected_as_a_new_version(api):
    a,db=api
    from src.season_models import RuleVersion
    from season_quality import initial_rules, fingerprint
    legacy=initial_rules();winder_cs(legacy)["lower"]=[{"ref":"CUSTOMER_CS","factor":0.4,"offset":10}]
    db.add(RuleVersion(season="ROY",version=1,status="PUBLISHED",rules=legacy,fingerprint=fingerprint(legacy),change_note="first template",created_by="t"))
    db.add(RuleVersion(season="MONSOON",version=1,status="DRAFT",rules=legacy,fingerprint=fingerprint(legacy),change_note="never published",created_by="t"))
    db.commit()
    published=a.ensure_default_rules(db)
    assert {p["season"] for p in published}=={"ROY","MONSOON"}
    roy=a.read_rules("ROY",db,USER);mon=a.read_rules("MONSOON",db,USER)
    assert roy["published"]["version"]==2 and winder_cs(roy["published"]["rules"])["lower"][0]["offset"]==-10
    assert [v["status"] for v in roy["versions"]]==["PUBLISHED","SUPERSEDED"]
    # A never-published draft is corrected and published as is.
    assert mon["published"]["version"]==1 and winder_cs(mon["published"]["rules"])["lower"][0]["offset"]==-10
    assert a.ensure_default_rules(db)==[]


def test_stale_draft_and_idempotency_payload(api):
    a,db=api;a.bootstrap(command(a),db,USER)
    rows=a.read_rules("ROY",db,USER)["published"]["rules"]
    payload=a.RuleDraft(request_id=str(uuid.uuid4()),rules=rows,note="draft")
    first=a.save_rules(payload,"ROY",db,USER)
    assert a.save_rules(payload,"ROY",db,USER)==first
    with pytest.raises(HTTPException) as exc:a.save_rules(payload.model_copy(update={"note":"different"}),"ROY",db,USER)
    assert exc.value.status_code==409
    db.rollback()
    a.save_rules(a.RuleDraft(request_id=str(uuid.uuid4()),expected_version=1,rules=rows,note="second"),"ROY",db,USER)
    with pytest.raises(HTTPException):a.save_rules(a.RuleDraft(request_id=str(uuid.uuid4()),expected_version=1,rules=rows,note="stale"),"ROY",db,USER)


def test_switch_preview_and_epoch(api):
    a,db=api;a.bootstrap(command(a),db,USER)
    preview=a.preview_switch({"to":"MONSOON"},db,USER)
    # Specs left by other contracts in this disposable DB may be blocked; acknowledging them is the documented path.
    payload=a.Switch(request_id=str(uuid.uuid4()),expected_version=1,note="Monsoon starts",to="MONSOON",preview_fingerprint=preview["fingerprint"],acknowledge_blocked=preview["blocked_count"]>0)
    result=a.switch_season(payload,db,USER)
    assert result["epoch"]==2
    assert a.switch_season(payload,db,USER)==result
    assert a.read_season(db,USER)["active_season"]=="MONSOON"

@pytest.fixture
def document(api,monkeypatch):
    a,db=api
    from src import spec_math
    paper=str(uuid.uuid4());customer=str(uuid.uuid4())
    monkeypatch.setattr(a,'master_mandrel',lambda *args:76.3)
    class Response:
        def raise_for_status(self):pass
        def json(self):return [{'id':paper,'active':True}]
    monkeypatch.setattr(a.httpx,'get',lambda *args,**kw:Response())
    a.bootstrap(command(a),db,USER)
    layers=[{'paper_id':paper,'ply_no':i,'gsm_snapshot':300,'bf_snapshot':20,'bulk_snapshot':1} for i in (1,2,3)]
    preview=spec_math.compute_preview(mandrel_od_mm=76.3,tube_length_mm=150,papers=[spec_math.RecipePaper(paper_id=paper,gsm=300,bulk=1,ply_count=3)],target_dry_g=35,adhesive_percent=12.5,parchment_percent=0,parchment_allowed=False)
    target=round(preview.nominal_tube.dry_g,4)
    spec={'customer_id':customer,'customer_name':'Season contract '+customer[:8],'customer_name_snapshot':'Contract customer','tube_size_id':str(uuid.uuid4()),'mandrel_id':str(uuid.uuid4()),'id_min_mm':76.2,'id_max_mm':76.6,'od_min_mm':81,'od_max_mm':81,'length_min_mm':149.8,'length_max_mm':150.2,'target_tube_weight':target,'required_cs':400,'cs_min_n':400,'adhesive_percent':12.5,'moisture_loss_percent':9,'parchment_percent':0,'parchment_allowed':False,'dynamic_fields':[{'field_key':k,'value':v} for k,v in {'valid_upto':'2027-10-03','prepared_by':'Test owner','prepared_date':'2026-10-03','sign_off_note':'Reviewed','adhesive_components_json':'[{"name":"Glue","ratio_percent":100}]'}.items()]}
    body=a.Document(request_id=str(uuid.uuid4()),spec=spec,recipes={'ROY':{'layers':layers,'notes':'Original'},'MONSOON':{'layers':layers,'notes':'Original','confirm':True}})
    result=a.create_document(body,db,'00000000-0000-0000-0000-0000000000a1',USER)
    yield a,db,result,body,paper


def test_atomic_document_and_independent_unchanged_content(document):
    a,db,result,body,paper=document
    plant=result['spec']['plant_id'];sid=uuid.UUID(result['spec']['id']);rev=result['spec']['write_revision']
    a.review_spec(command(a,expected_version=rev),sid,db,plant,USER) if False else None
    a.review_spec(sid,command(a,expected_version=rev),db,plant,USER)
    a.approve_spec(sid,command(a,expected_version=rev),db,plant,USER)
    before=a.read_document(sid,db,plant,USER)
    # A new spec geometry revision binds unchanged immutable paper content.
    changed=body.model_copy(update={'request_id':str(uuid.uuid4()),'expected_version':rev,'spec':{**body.spec,'required_cs':410,'target_tube_weight':body.spec['target_tube_weight']+0.5},'recipes':body.recipes})
    saved=a.update_document(sid,changed,db,plant,USER)
    assert saved['spec']['id']!=str(sid)
    assert saved['recipes']['ROY']['id']==before['recipes']['ROY']['id']
    assert saved['recipes']['MONSOON']['season_revision']==before['recipes']['MONSOON']['season_revision']


def test_bad_monsoon_rolls_back_entire_document(document):
    a,db,result,body,paper=document
    from src.models import SpecificationSheet
    before=db.query(SpecificationSheet).count()
    broken=body.model_copy(update={'request_id':str(uuid.uuid4()),'recipes':{'ROY':body.recipes['ROY'],'MONSOON':{'layers':[{'paper_id':paper,'ply_no':1,'gsm_snapshot':-1,'bf_snapshot':20}]}}})
    with pytest.raises(HTTPException):a.create_document(broken,db,result['spec']['plant_id'],USER)
    db.rollback()
    assert db.query(SpecificationSheet).count()==before


def test_admin_cannot_toggle_global_season(api):
    a,db=api
    with pytest.raises(HTTPException) as err:a.preview_switch({'to':'MONSOON'},db,{**USER,'roles':['Admin']})
    assert err.value.status_code==403


def test_live_spec_stays_live_until_revision_is_approved(document,monkeypatch):
    a,db,result,body,paper=document
    from src.models import SpecificationSheet
    plant=result['spec']['plant_id'];sid=uuid.UUID(result['spec']['id']);rev=result['spec']['write_revision']
    a.review_spec(sid,command(a,expected_version=rev),db,plant,USER)
    a.approve_spec(sid,command(a,expected_version=rev),db,plant,USER)
    revision=a.update_document(sid,body.model_copy(update={'request_id':str(uuid.uuid4()),'expected_version':rev,'spec':{**body.spec,'required_cs':420}}),db,plant,USER)
    new_id=uuid.UUID(revision['spec']['id'])
    db.expire_all();live=db.get(SpecificationSheet,sid)
    # Sales can keep ordering on the live version while the revision is a draft.
    assert live.status=='approved' and live.active
    assert revision['spec']['status']=='draft'
    # Only one open revision per live version.
    with pytest.raises(HTTPException) as err:
        a.update_document(sid,body.model_copy(update={'request_id':str(uuid.uuid4()),'expected_version':rev}),db,plant,USER)
    assert err.value.status_code==409 and err.value.detail['code']=='REVISION_OPEN' and err.value.detail['spec_id']==str(new_id)
    db.rollback()
    blockers=a.read_blockers(sid,db,plant,USER)
    assert blockers['open_revision']['id']==str(new_id)
    # Review can be withdrawn back to draft.
    new_rev=db.get(SpecificationSheet,new_id).write_revision
    a.review_spec(new_id,command(a,expected_version=new_rev),db,plant,USER)
    a.return_to_draft(new_id,command(a,expected_version=new_rev),db,plant,USER)
    db.expire_all();assert db.get(SpecificationSheet,new_id).status=='draft'
    a.review_spec(new_id,command(a,expected_version=new_rev),db,plant,USER)
    calls=[]
    class Moved:
        status_code=200
        def json(self):return {'moved':1,'lines':['x']}
    monkeypatch.setattr(a.httpx,'post',lambda url,**kw:calls.append((url,kw['json'])) or Moved())
    a.approve_spec(new_id,command(a,expected_version=new_rev),db,plant,USER)
    db.expire_all()
    assert db.get(SpecificationSheet,sid).status=='obsolete' and not db.get(SpecificationSheet,sid).active
    assert db.get(SpecificationSheet,new_id).status=='approved'
    assert calls and calls[0][0].endswith('/sales-orders/spec-supersede') and calls[0][1]=={'from_spec_id':str(sid),'to_spec_id':str(new_id)}


def test_revision_approval_waits_for_lines_already_in_production(document,monkeypatch):
    a,db,result,body,paper=document
    from src.models import SpecificationSheet
    plant=result['spec']['plant_id'];sid=uuid.UUID(result['spec']['id']);rev=result['spec']['write_revision']
    a.review_spec(sid,command(a,expected_version=rev),db,plant,USER);a.approve_spec(sid,command(a,expected_version=rev),db,plant,USER)
    revision=a.update_document(sid,body.model_copy(update={'request_id':str(uuid.uuid4()),'expected_version':rev,'spec':{**body.spec,'required_cs':430}}),db,plant,USER)
    new_id=uuid.UUID(revision['spec']['id']);new_rev=revision['spec']['write_revision']
    a.review_spec(new_id,command(a,expected_version=new_rev),db,plant,USER)
    class Busy:
        status_code=409
        def json(self):return {'detail':{'code':'SPEC_IN_PRODUCTION','message':'SO-1 line 1 is released'}}
    monkeypatch.setattr(a.httpx,'post',lambda url,**kw:Busy())
    with pytest.raises(HTTPException) as err:a.approve_spec(new_id,command(a,expected_version=new_rev),db,plant,USER)
    assert err.value.status_code==409 and err.value.detail['code']=='SPEC_IN_PRODUCTION'
    db.rollback();db.expire_all()
    assert db.get(SpecificationSheet,sid).status=='approved' and db.get(SpecificationSheet,sid).active


def test_spec_sheet_qc_values_win_and_are_versioned(document):
    a,db,result,body,paper=document
    plant=result['spec']['plant_id'];sid=uuid.UUID(result['spec']['id'])
    before=a.read_qc_overview(sid,db,plant,USER)
    row=next(p for p in before['seasons']['ROY']['parameters'] if p['stage']=='WINDER' and p['parameter']=='cs')
    assert (row['min'],row['max'],row['source'])==(150.0,170.0,'GLOBAL')
    saved=a.save_spec_qc_values(sid,a.SpecQcValues(request_id=str(uuid.uuid4()),note='Customer drawing',values=[{'stage':'WINDER','parameter':'cs','min':155,'max':165}]),db,plant,USER)
    for season in ('ROY','MONSOON'):
        row=next(p for p in saved['seasons'][season]['parameters'] if p['stage']=='WINDER' and p['parameter']=='cs')
        assert (row['min'],row['max'],row['source'])==(155.0,165.0,'SPEC_SHEET')
    assert saved['overlay']['version']==1 and saved['values'][0]['min']==155.0
    cleared=a.save_spec_qc_values(sid,a.SpecQcValues(request_id=str(uuid.uuid4()),values=[{'stage':'WINDER','parameter':'cs'}]),db,plant,USER)
    row=next(p for p in cleared['seasons']['ROY']['parameters'] if p['stage']=='WINDER' and p['parameter']=='cs')
    assert row['source']=='GLOBAL' and cleared['overlay'] is None
    with pytest.raises(HTTPException) as err:
        a.save_spec_qc_values(sid,a.SpecQcValues(request_id=str(uuid.uuid4()),values=[{'stage':'WINDER','parameter':'cs','min':200,'max':100}]),db,plant,USER)
    assert err.value.status_code==422


def test_import_approved_with_and_without_recipe(document):
    a,db,result,body,paper=document
    plant=result['spec']['plant_id']
    spec={**body.spec,'customer_id':str(uuid.uuid4()),'tube_size_id':str(uuid.uuid4())}
    payload=a.ImportDocument(request_id=str(uuid.uuid4()),import_key='wb-row-6',spec=spec,recipes={'ROY':body.recipes['ROY']},note='Client workbook')
    first=a.import_approved(payload,db,plant,USER)
    assert first['status']=='approved' and first['recipe_approved_seasons']==['MONSOON','ROY'] and not first['recipe_pending']
    again=a.import_approved(payload,db,plant,USER)
    assert again.pop('replayed') is True and again==first
    doc=a.read_document(uuid.UUID(first['spec_id']),db,plant,USER)
    assert doc['recipes']['ROY']['approved'] and doc['recipes']['MONSOON']['approved']
    with pytest.raises(HTTPException) as err:
        a.import_approved(payload.model_copy(update={'import_key':'wb-row-7','request_id':str(uuid.uuid4())}),db,plant,USER)
    assert err.value.status_code==409 and err.value.detail['code']=='DUPLICATE_SPEC'
    db.rollback()
    pending={**spec,'tube_size_id':str(uuid.uuid4())}
    second=a.import_approved(a.ImportDocument(request_id=str(uuid.uuid4()),import_key='wb-row-8',spec=pending,recipes={},note='Recipe pending'),db,plant,USER)
    assert second['status']=='approved' and second['recipe_pending'] and second['recipe_approved_seasons']==[]
    blockers=a.read_blockers(uuid.UUID(second['spec_id']),db,plant,USER)
    assert any('recipe' in b.lower() for b in blockers['production']['ROY']['blockers'])


def test_duplicate_customer_specs_move_without_reapproval(document,monkeypatch):
    a,db,result,body,paper=document
    from src.models import SpecificationSheet
    from src.season_models import RecipeBinding, SpecReadiness, OverlayVersion
    plant=result['spec']['plant_id'];duplicate=str(uuid.uuid4());customer=str(uuid.uuid4())
    names={duplicate:{'id':duplicate,'name':'Alok Industries Limited','active':True},customer:{'id':customer,'name':'ALOK INDUSTRIES LTD.','active':True}}
    monkeypatch.setattr(a,'master_customer',lambda cid,user,plant:names[str(cid)])
    calls=[]
    class Moved:
        status_code=200
        def json(self):return {'moved':2,'lines':['l1','l2']}
    monkeypatch.setattr(a.httpx,'post',lambda url,**kw:calls.append((url,kw['json'])) or Moved())
    def imported(owner,tube,row):
        spec={**body.spec,'customer_id':owner,'customer_name':names[owner]['name'],'customer_name_snapshot':names[owner]['name'],'tube_size_id':tube}
        return uuid.UUID(a.import_approved(a.ImportDocument(request_id=str(uuid.uuid4()),import_key=f'merge-row-{row}',spec=spec,recipes={'ROY':body.recipes['ROY']},note='Workbook'),db,plant,USER)['spec_id'])
    shared=str(uuid.uuid4())
    kept=imported(customer,shared,1)          # the customer's own spec, made before the import
    moved=imported(duplicate,str(uuid.uuid4()),2)
    copy=imported(duplicate,shared,3)          # the workbook copy of a product the customer already has
    before={r.season:(r.ready,r.details['blockers']) for r in db.query(SpecReadiness).filter_by(spec_id=moved).all()}
    hashes={b.season:b.approved_context for b in db.query(RecipeBinding).filter_by(spec_id=moved).all()}
    payload=a.CustomerReassign(request_id=str(uuid.uuid4()),from_customer_id=duplicate,to_customer_id=customer)
    out=a.reassign_customer(payload,db,plant,USER)
    assert out['moved']==2 and set(out['spec_ids'])=={str(moved),str(copy)}
    assert out['retired_duplicates']==[{'spec_id':str(copy),'kept_spec_id':str(kept),'order_lines_moved':2}]
    assert calls==[(calls[0][0],{'from_spec_id':str(copy),'to_spec_id':str(kept)})] and calls[0][0].endswith('/sales-orders/spec-supersede')
    db.expire_all()
    spec=db.get(SpecificationSheet,moved)
    assert str(spec.customer_id)==customer and spec.customer_name==spec.customer_name_snapshot=='ALOK INDUSTRIES LTD.'
    # Same spec, same revision, recipe approvals still valid: nothing to re-approve.
    assert spec.status=='approved' and spec.active and spec.write_revision==1
    assert {b.season:b.approved_context for b in db.query(RecipeBinding).filter_by(spec_id=moved).all()}==hashes
    assert {r.season:(r.ready,r.details['blockers']) for r in db.query(SpecReadiness).filter_by(spec_id=moved).all()}==before
    retired=db.get(SpecificationSheet,copy)
    assert retired.status=='obsolete' and not retired.active and str(retired.customer_id)==customer
    assert db.get(SpecificationSheet,kept).status=='approved' and db.get(SpecificationSheet,kept).active
    # A retry replays; a new run finds nothing left to move.
    assert a.reassign_customer(payload,db,plant,USER)==out
    again=a.reassign_customer(a.CustomerReassign(request_id=str(uuid.uuid4()),from_customer_id=duplicate,to_customer_id=customer),db,plant,USER)
    assert again['moved']==0 and again['retired_duplicates']==[]
    # Guard rails: inactive target, same customer, duplicate with its own QC overlay.
    names[duplicate]['active']=False
    with pytest.raises(HTTPException) as err:a.reassign_customer(a.CustomerReassign(request_id=str(uuid.uuid4()),from_customer_id=customer,to_customer_id=duplicate),db,plant,USER)
    assert err.value.status_code==422
    with pytest.raises(HTTPException) as err:a.reassign_customer(a.CustomerReassign(request_id=str(uuid.uuid4()),from_customer_id=customer,to_customer_id=customer),db,plant,USER)
    assert err.value.status_code==422
    names[duplicate]['active']=True
    db.add(OverlayVersion(plant_id=plant,target_type='CUSTOMER',target_id=uuid.UUID(duplicate),season='BOTH',version=1,status='PUBLISHED',rules=[],fingerprint='x'*64,reason='Customer drawing'));db.commit()
    with pytest.raises(HTTPException) as err:a.reassign_customer(a.CustomerReassign(request_id=str(uuid.uuid4()),from_customer_id=duplicate,to_customer_id=customer),db,plant,USER)
    assert err.value.status_code==409 and err.value.detail['code']=='CUSTOMER_OVERLAY'
    db.rollback();db.query(OverlayVersion).filter_by(target_id=uuid.UUID(duplicate)).delete();db.commit()
