"""Durable, retryable postings. No saved human access tokens or card locks over HTTP."""
from datetime import datetime, timedelta
from types import SimpleNamespace
import logging
import os
import threading
import time
import jwt
from sqlalchemy import text
from .database import SessionLocal
from .models import AuditEvent, JobCard, JobCardStage, JobCardStageSegment, PackingRecord, QualityHold
from .dispatch_quantities import dispatchable_quantity, qc_excluded_quantities
from .entry_models import CompletionEffect, FgBox
from .security.jwt_handler import SECRET_KEY

log=logging.getLogger(__name__)
_stop=threading.Event()


def service_actor(plant):
    now=datetime.utcnow()
    claims={"sub":"production-completion-worker","roles":["ProductionEffects"],"plant_id":str(plant),"allowed_plants":[str(plant)],"iat":now,"exp":now+timedelta(minutes=5),"service":"production-effects"}
    token=jwt.encode(claims,SECRET_KEY,algorithm="HS256")
    return {**claims,"token":token}


def post_accepted_fg(db, job, stage, packing, qc, actor):
    """Only final-QC accepted pieces become FG; rejects stay in the QC ledger."""
    from .routers import planning
    if not packing or not stage or stage.status!="COMPLETED" or not qc or qc.status!="COMPLETED":
        raise ValueError("Packing and final QC must both be closed")
    accepted = dispatchable_quantity(job, packing, qc)
    excluded = qc_excluded_quantities(job,packing,qc)
    if accepted > 0:
        result = planning._post_fg_inward_if_configured(job,stage,packing,actor["token"],str(job.plant_id),accepted_qty=accepted)
        if not result:raise ValueError("FG item and positive accepted output are required")
        planning._apply_fg_inward_snapshot(packing,result)
        packing.snapshot = {**(packing.snapshot or {}),**excluded}
        return
    gross = float(packing.total_packed_qty or 0)
    previous = packing.snapshot or {}
    if not previous.get("fg_zero_acceptance"):
        packing.snapshot = {**previous,"fg_accepted_qty":0,**excluded,"fg_zero_acceptance":True}
        dispatch = db.query(JobCardStage).filter_by(job_card_id=job.id,stage_type="DISPATCH").first()
        if not dispatch:raise ValueError("Dispatch stage is missing")
        now = datetime.utcnow()
        dispatch.status="COMPLETED";dispatch.input_qty=0;dispatch.output_qty=0;dispatch.actual_end=now
        dispatch.actuals_snapshot={**(dispatch.actuals_snapshot or {}),"closed_at":now.isoformat(),"closed_by":actor["sub"],"all_qc_rejected":True,"effective_target":0,"row_version":int((dispatch.actuals_snapshot or {}).get("row_version",1))+1}
        job.status="COMPLETED";job.current_stage="DONE"
        db.add(AuditEvent(plant_id=job.plant_id,entity_type="job_card",entity_id=job.id,job_card_id=job.id,
                          action="FINAL_QC_ZERO_ACCEPTANCE",actor_id=actor["sub"],actor_role="ProductionEffects",
                          payload={"packed_qty":gross,**excluded,"qc_close_reason":(qc.actuals_snapshot or {}).get("close_reason"),"fg_posted_qty":0}))


def post_box_fg(db, job, box, actor):
    """One box = one FG batch named by the box code (owner decision 2026-11-01). Idempotent per box."""
    from .routers import planning
    from .routers.entries import fg_item_for
    import httpx
    if box.fg_status=="POSTED":return
    if planning._movement_blocking_holds(db,db.query(QualityHold).filter_by(job_card_id=job.id).all()):raise ValueError("A hold placed on purpose stops this box going into stock until it is released")
    plant=str(job.plant_id)
    item_id=str(box.fg_item_id) if box.fg_item_id else fg_item_for(job,actor,plant)
    packing=db.query(JobCardStage).filter_by(job_card_id=job.id,stage_type="PACKING").first()
    payload={"item_id":item_id,"batch_no":box.box_code,"qty":float(box.qty),"production_job_id":str(job.id),"spec_id":str(job.spec_id) if job.spec_id else None,
             "external_ref":f"FG-BOX-{box.id}","location_id":str(packing.location_id) if packing is not None and packing.location_id else None,"stock_status":"UNRESTRICTED",
             "effective_date":box.business_date.isoformat() if box.business_date else None,"box_code":box.box_code,"part_box":bool(box.is_part),"job_card_no":job.job_card_no}
    response=httpx.post(f"{planning.settings.INVENTORY_SERVICE_URL}/fg-inward/",json=payload,headers={"Authorization":f"Bearer {actor['token']}","X-Plant-ID":plant},timeout=10)
    if response.status_code not in (200,201):raise ValueError(f"Inventory refused box {box.box_code}: {response.text[:200]}")
    result=response.json()
    import uuid as _uuid
    box.fg_item_id=_uuid.UUID(item_id);box.inventory_batch_id=_uuid.UUID(str(result["batch_id"]));box.inventory_transaction_id=_uuid.UUID(str(result["transaction_id"]));box.fg_status="POSTED"


def packaging_masters(actor, plant):
    """Weights of boxes, plastic sheets and fadda from the Packaging masters, by code (for theory kg)."""
    from .routers import planning
    import httpx
    out={}
    try:
        response=httpx.get(f"{planning.settings.MASTERDATA_SERVICE_URL}/master/packaging/unit-weights",headers={"Authorization":f"Bearer {actor['token']}","X-Plant-ID":plant},timeout=8)
        if response.status_code<400 and isinstance((response.json() or {}).get("by_code"),dict):
            return {str(k).upper():v for k,v in response.json()["by_code"].items()}
    except Exception:
        pass
    for path,key in (("boxes","code"),("plastic-sheets","sku"),("fadda","sku")):
        try:
            response=httpx.get(f"{planning.settings.MASTERDATA_SERVICE_URL}/master/packaging/{path}",headers={"Authorization":f"Bearer {actor['token']}","X-Plant-ID":plant},timeout=8)
            if response.status_code>=400:continue
            for row in response.json() or []:
                code=str(row.get(key) or "").strip().upper()
                if code:out[code]=row
        except Exception:continue
    return out


def deliver_keys(keys):
    """Deliver these effects now (called straight after the request that queued them committed)."""
    for key in keys:
        deliver_one(effect_key=key)


def deliver_one(effect_key=None):
    from .routers import planning
    import httpx
    db=SessionLocal()
    try:
        # One process at a time per card effect; a dead process releases this
        # transaction and the same stable receiver key is retried.
        query=db.query(CompletionEffect).filter(CompletionEffect.status.in_(["PENDING","FAILED"]))
        query=query.filter(CompletionEffect.effect_key==effect_key) if effect_key else query.filter(CompletionEffect.next_attempt_at<=datetime.utcnow())
        effect=query.order_by(CompletionEffect.created_at).with_for_update(skip_locked=True).first()
        if not effect:return False
        if not db.execute(text("SELECT pg_try_advisory_xact_lock(hashtext(:key))"),{"key":"production-effect:"+str(effect.job_card_id)}).scalar():return False
        job=db.get(JobCard,effect.job_card_id)
        if not job:effect.status="CANCELLED";db.commit();return True
        plant=str(job.plant_id);actor=service_actor(plant);stage_name=effect.payload["stage"]
        stage=db.query(JobCardStage).filter_by(job_card_id=job.id,stage_type=stage_name).first()
        packing=db.query(PackingRecord).filter_by(job_card_id=job.id).first()
        effect.attempts+=1
        try:
            if effect.kind=="release_ack":
                response=httpx.post(f"{planning.settings.SPEC_SERVICE_URL}/season/release-authorizations/{effect.payload['authorization_id']}/acknowledge",headers={"Authorization":f"Bearer {actor['token']}","X-Plant-ID":plant},json={"request_id":effect.effect_key,"job_card_id":str(job.id),"bundle_hash":effect.payload["bundle_hash"]},timeout=10)
                response.raise_for_status()
            elif effect.kind=="tools":
                if stage.status!="COMPLETED":effect.status="CANCELLED";db.commit();return True
                segments=db.query(JobCardStageSegment).filter_by(job_card_id=job.id,stage_type=stage_name).order_by(JobCardStageSegment.segment_no).all()
                posted=[]
                for segment in segments or [SimpleNamespace(id=stage.id,output_qty=stage.output_qty,scrap_qty=stage.scrap_qty)]:
                    actual=SimpleNamespace(id=stage.id,entry_snapshot=stage.entry_snapshot,output_qty=segment.output_qty,scrap_qty=segment.scrap_qty)
                    posted.extend(planning._record_physical_tool_usage(stage=actual,segment=segment,job_card=job,selected_stage=stage_name,token=actor["token"],plant_id=plant,current_user=actor))
                effect.payload={**effect.payload,'posted_tool_asset_ids':sorted(set(posted))}
            elif effect.kind=="theory":
                planning._upsert_monthly_provisional_theory(db=db,job_card=job,selected_stage=stage_name,token=actor["token"],plant_id=plant,current_user=actor)
            elif effect.kind=="fg_inward":
                qc=db.query(JobCardStage).filter_by(job_card_id=job.id,stage_type="QC").first()
                if not qc or qc.status!="COMPLETED" or not stage or stage.status!="COMPLETED":raise ValueError("Packing and final QC must both be closed")
                if planning._movement_blocking_holds(db,db.query(QualityHold).filter_by(job_card_id=job.id).all()):raise ValueError("QC hold prevents FG posting")
                post_accepted_fg(db,job,stage,packing,qc,actor)
            elif effect.kind=="fg_box":
                import uuid as _uuid
                box=db.get(FgBox,_uuid.UUID(effect.payload["box_id"]))
                if box is None or box.status=="VOID":effect.status="CANCELLED";db.commit();return True
                try:post_box_fg(db,job,box,actor)
                except Exception:
                    box.fg_status="FAILED";raise
            elif effect.kind=="box_theory":
                import uuid as _uuid
                from . import boxes as box_rules
                box=db.get(FgBox,_uuid.UUID(effect.payload["box_id"]))
                if box is not None and box.status!="VOID":
                    part_note=[w for w in ((box.packaging or {}).get("warnings") or []) if "no qty per box" in w]
                    fresh=box_rules.box_packaging(job,packaging_masters(actor,plant))
                    box.packaging={**fresh,"warnings":list(fresh.get("warnings") or [])+part_note}
                    db.flush()
                # Only this box's own packing is added (issue #13); Process close re-posts the whole card.
                planning._post_box_packaging_theory(db=db,job_card=job,box=box,token=actor["token"],plant_id=plant,current_user=actor)
            elif effect.kind=="sales_return":
                p=effect.payload
                response=httpx.post(f"{planning.settings.SALES_SERVICE_URL}/sales-orders/release-lots/{p['release_lot_id']}/stage-returns",headers={"Authorization":f"Bearer {actor['token']}","X-Plant-ID":plant},json={"job_card_id":p["job_card_id"],"return_key":p["return_key"],"qty":p["qty"],"stage":p.get("stage"),"reason":p.get("reason"),"reason_code":p.get("reason_code"),"reason_label":p.get("reason_label"),"reason_note":p.get("reason_note")},timeout=10)
                if response.status_code>=400:raise ValueError(f"Sales refused the return: {response.text[:300]}")
            elif effect.kind in ("hold_stock","release_stock"):
                held=bool(planning._movement_blocking_holds(db,db.query(QualityHold).filter_by(job_card_id=job.id).all()))
                if held!=(effect.kind=="hold_stock"):
                    effect.status="CANCELLED";db.commit();return True
                action="hold" if held else "release"
                response=httpx.post(f"{planning.settings.INVENTORY_SERVICE_URL}/inventory/production-effects/{action}",headers={"Authorization":f"Bearer {actor['token']}","X-Plant-ID":plant},json={"job_card_id":str(job.id),"effect_key":effect.effect_key},timeout=10)
                response.raise_for_status()
            else:raise ValueError("Unknown completion effect")
            effect.status="DELIVERED";effect.delivered_at=datetime.utcnow();effect.last_error=None
        except Exception as exc:
            effect.status="FAILED";effect.next_attempt_at=datetime.utcnow()+timedelta(seconds=min(300,30*2**min(effect.attempts,4)));effect.last_error=f"{type(exc).__name__}: {getattr(exc,'detail',str(exc))}"[:500]
            # Error strings contain no access tokens or request headers.
            log.warning("Completion effect %s failed: %s",effect.id,type(exc).__name__)
        db.commit();return True
    finally:db.close()


def run():
    while not _stop.wait(10):
        if os.getenv("ERP_MAINTENANCE","0")=="1":continue
        try:
            for _ in range(20):
                if not deliver_one():break
        except Exception:log.exception("Completion worker transaction failed")


def start():
    if os.getenv("COMPLETION_WORKER_ENABLED","1")=="1":
        _stop.clear();threading.Thread(target=run,daemon=True,name="completion-postings").start()


def stop():_stop.set()
