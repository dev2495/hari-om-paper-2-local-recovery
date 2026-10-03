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


def test_bootstrap_publish_and_independent_history(api):
    a,db=api
    a.bootstrap(command(a),db,USER)
    roy=a.read_rules("ROY",db,USER);mon=a.read_rules("MONSOON",db,USER)
    assert roy["draft"]["rules"]==mon["draft"]["rules"]
    a.publish_rules(command(a,expected_version=1,note="Client approved rules"),"ROY",db,USER)
    assert a.read_rules("ROY",db,USER)["published"]["version"]==1
    assert a.read_rules("MONSOON",db,USER)["published"] is None


def test_stale_draft_and_idempotency_payload(api):
    a,db=api;a.bootstrap(command(a),db,USER)
    rows=a.read_rules("ROY",db,USER)["draft"]["rules"]
    payload=a.RuleDraft(request_id=str(uuid.uuid4()),expected_version=1,rules=rows,note="draft")
    first=a.save_rules(payload,"ROY",db,USER)
    assert a.save_rules(payload,"ROY",db,USER)==first
    with pytest.raises(HTTPException) as exc:a.save_rules(payload.model_copy(update={"note":"different"}),"ROY",db,USER)
    assert exc.value.status_code==409
    db.rollback()
    with pytest.raises(HTTPException):a.save_rules(a.RuleDraft(request_id=str(uuid.uuid4()),expected_version=1,rules=rows,note="stale"),"ROY",db,USER)


def test_switch_preview_and_epoch(api):
    a,db=api;a.bootstrap(command(a),db,USER)
    preview=a.preview_switch({"to":"MONSOON"},db,USER)
    payload=a.Switch(request_id=str(uuid.uuid4()),expected_version=1,note="Monsoon starts",to="MONSOON",preview_fingerprint=preview["fingerprint"])
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
    for season in ('ROY','MONSOON'):a.publish_rules(command(a,expected_version=1,note='Confirmed client rules'),season,db,USER)
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
    monkey=a._enforce_live_spec_edit_lock;a._enforce_live_spec_edit_lock=lambda *args:None
    try:
        changed=body.model_copy(update={'request_id':str(uuid.uuid4()),'expected_version':rev,'spec':{**body.spec,'required_cs':410,'target_tube_weight':body.spec['target_tube_weight']+0.5},'recipes':body.recipes})
        saved=a.update_document(sid,changed,db,plant,USER)
        assert saved['spec']['id']!=str(sid)
        assert saved['recipes']['ROY']['id']==before['recipes']['ROY']['id']
        assert saved['recipes']['MONSOON']['season_revision']==before['recipes']['MONSOON']['season_revision']
    finally:a._enforce_live_spec_edit_lock=monkey


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
