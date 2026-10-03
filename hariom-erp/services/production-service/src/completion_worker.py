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
from .entry_models import CompletionEffect
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


def deliver_one():
    from .routers import planning
    import httpx
    db=SessionLocal()
    try:
        # One process at a time per card effect; a dead process releases this
        # transaction and the same stable receiver key is retried.
        effect=db.query(CompletionEffect).filter(CompletionEffect.status.in_(["PENDING","FAILED"]),CompletionEffect.next_attempt_at<=datetime.utcnow()).order_by(CompletionEffect.created_at).with_for_update(skip_locked=True).first()
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
