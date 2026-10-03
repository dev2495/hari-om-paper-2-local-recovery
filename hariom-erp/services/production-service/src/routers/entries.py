"""Continuous physical production entry with a card-local allocation ledger."""
from datetime import date, datetime
from types import SimpleNamespace
import math
import calendar
import os
import uuid
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, text
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import JobCard, JobCardStage, JobCardStageSegment, QualityHold, QualityInspection, PackingRecord, Dispatch, MonthlyMaterialClose
from ..entry_models import StageEntry, EntryRevision, InputAllocation, EntryReceipt, CompletionEffect, ResidualWip
from ..utils.auth import get_current_plant, get_current_user, require_role
from ..lifecycle_rules import planned_in_stage_units, stage_unit
from ..quality_eval import evaluate_final_spec, instrument_readiness_for_snapshot, instrument_not_ready_detail
from season_quality import evaluate_samples, stage_readiness, fingerprint, RuleError
from . import planning

router=APIRouter(tags=["continuous entries"])
CONTINUOUS={("WINDER","OVEN"),("OVEN","PROCESS")}


class Mutation(BaseModel):
    model_config=ConfigDict(extra="forbid")
    request_id:str=Field(min_length=8,max_length=100)
    expected_version:int|None=None
    reason:str=""


class EntryInput(Mutation):
    stage:str
    quantity_mode:str="DELTA"
    kind:str="PRODUCTION"
    business_date:date|None=None
    shift_code:str|None=None
    operator_id:uuid.UUID|None=None
    machine_id:uuid.UUID|None=None
    segment_id:uuid.UUID|None=None
    produced:int=Field(default=0,ge=0,strict=True)
    accepted:int=Field(default=0,ge=0,strict=True)
    input_quantity:int=Field(default=0,ge=0,strict=True)
    cutting_loss_pcs:int=Field(default=0,ge=0,strict=True)
    carry_in_pcs:int=Field(default=0,ge=0,strict=True)
    carry_out_pcs:int=Field(default=0,ge=0,strict=True)
    samples:list[dict]=Field(default_factory=list,max_length=100)
    details:dict=Field(default_factory=dict)
    submit:bool=False


class CloseInput(Mutation):
    supervisor_id:uuid.UUID
    fg_item_id:uuid.UUID|None=None
    location_id:uuid.UUID|None=None
    short_close:bool=False
    residual_disposition:str|None=None
    reel_issue_ids:list[uuid.UUID]=Field(default_factory=list,max_length=100)


class Observations(Mutation):
    samples:list[dict]=Field(max_length=100)
    instrument:dict|None=None


class BatchStep(BaseModel):
    model_config=ConfigDict(extra="forbid")
    entry:EntryInput
    close:CloseInput|None=None


class BatchInput(Mutation):
    steps:list[BatchStep]=Field(min_length=1,max_length=20)


class ResidualResolve(Mutation):
    disposition:str


def card(db,card_id,plant,lock=False):
    query=db.query(JobCard).filter_by(id=card_id,plant_id=planning._to_uuid(plant))
    if lock:
        if not db.execute(text("SELECT pg_try_advisory_xact_lock(hashtext(:key))"),{"key":"production-effect:"+str(card_id)}).scalar():raise HTTPException(409,"A durable posting is running; retry after it finishes")
        query=query.with_for_update()
    job=query.first()
    if not job:raise HTTPException(404,"Job card not found")
    if (job.spec_snapshot or {}).get("entry_model")!="V2":raise HTTPException(409,"This card uses the legacy entry form")
    return job


def route(job):return list((job.routing_snapshot or {}).get("stages") or [])


def stage_row(db,job,stage):
    if stage not in route(job):raise HTTPException(422,"Stage is not on the frozen job-card route")
    row=db.query(JobCardStage).filter_by(job_card_id=job.id,stage_type=stage).first()
    if not row:raise HTTPException(409,"Stage setup is missing")
    return row


def entries(db,job,stage=None,status="SUBMITTED"):
    query=db.query(StageEntry).filter_by(job_card_id=job.id,status=status)
    if stage:query=query.filter_by(stage=stage)
    return query.order_by(StageEntry.entry_no).all()


def previous(job,stage):
    routing=route(job);index=routing.index(stage)
    return routing[index-1] if index else None


def available(db,job,stage):
    upstream=previous(job,stage)
    if not upstream or (stage=="WINDER" and upstream=="SLITTING"):return None
    prior=stage_row(db,job,upstream)
    if (upstream,stage) not in CONTINUOUS and prior.status!="COMPLETED":return 0
    if planning._movement_blocking_holds(db,db.query(QualityHold).filter_by(job_card_id=job.id).all()):return 0
    sources=entries(db,job,upstream)
    consumed=db.query(func.coalesce(func.sum(InputAllocation.quantity),0)).filter(InputAllocation.source_entry_id.in_([e.id for e in sources])).scalar() if sources else 0
    disposed=db.query(func.coalesce(func.sum(ResidualWip.quantity),0)).filter(ResidualWip.source_entry_id.in_([e.id for e in sources]),ResidualWip.status!="REVERSED").scalar() if sources else 0
    return sum(e.accepted for e in sources)-int(consumed)-int(disposed)


def entry_dict(e):
    return {"id":str(e.id),"stage":e.stage,"entry_no":e.entry_no,"status":e.status,"kind":e.kind,"business_date":e.business_date,"shift_code":e.shift_code,"operator_id":str(e.operator_id) if e.operator_id else None,"operator_name":e.operator_name,"operator_code":e.operator_code,"segment_id":str(e.segment_id) if e.segment_id else None,"machine_id":str(e.machine_id) if e.machine_id else None,"produced":e.produced,"accepted":e.accepted,"rejected":e.rejected,"input_quantity":e.input_quantity,"cutting_loss_pcs":e.cutting_loss_pcs,"carry_in_pcs":e.carry_in_pcs,"carry_out_pcs":e.carry_out_pcs,"samples":e.samples,"evaluation":e.evaluation,"details":e.details,"row_version":e.row_version,"created_at":e.created_at,"created_by":e.created_by}


def residual_dict(r):
    return {"id":str(r.id),"stage":r.stage,"source_entry_id":str(r.source_entry_id),"quantity":r.quantity,"unit":r.unit,"disposition":r.disposition,"status":r.status,"reason":r.reason,"created_by":r.created_by,"created_at":r.created_at,"resolved_by":r.resolved_by,"resolved_at":r.resolved_at,"row_version":r.row_version}


def flow(db,job):
    stage_map={r.stage_type:r for r in db.query(JobCardStage).filter_by(job_card_id=job.id).all()}
    segments=db.query(JobCardStageSegment).filter_by(job_card_id=job.id).all()
    all_entries=db.query(StageEntry).filter_by(job_card_id=job.id).order_by(StageEntry.entry_no).all()
    holds=db.query(QualityHold).filter_by(job_card_id=job.id).all()
    blocked=bool(planning._movement_blocking_holds(db,holds))
    disposed={h.source_inspection_id:str(h.id) for h in holds if h.status=="RELEASED"}
    inspections=db.query(QualityInspection).filter_by(job_card_id=job.id).order_by(QualityInspection.created_at).all()
    shipments=db.query(Dispatch).filter_by(job_card_id=job.id,status="SEALED").all()
    shipped=sum(float((d.dispatch_snapshot or {}).get("dispatch_qty") or (d.dispatch_snapshot or {}).get("qty") or 0) for d in shipments)
    inspection_map={i.sample_id:i for i in inspections if i.sample_id}
    used=dict(db.query(InputAllocation.source_entry_id,func.sum(InputAllocation.quantity)).filter_by(job_card_id=job.id).group_by(InputAllocation.source_entry_id).all())
    residuals=db.query(ResidualWip).filter_by(job_card_id=job.id).all()
    for r in residuals:
        if r.status!="REVERSED":used[r.source_entry_id]=int(used.get(r.source_entry_id,0))+r.quantity
    profile=(job.spec_snapshot or {}).get("qc_profile") or {};states=[]
    for stage in route(job):
        row=stage_map[stage];actual=[e for e in all_entries if e.stage==stage and e.status=="SUBMITTED"];snapshot=row.actuals_snapshot or {};evaluations=[]
        for e in actual:
            result=dict(e.evaluation or {});results=[dict(v) for v in result.get("results",[])]
            inspection=inspection_map.get(str(e.id));disposition=disposed.get(inspection.id) if inspection else None
            for item in results:
                if disposition and item.get("verdict")=="FAIL" and not item.get("non_waivable"):item["gating"]="advisory";item["disposition_id"]=disposition
            result["results"]=results;evaluations.append(result)
        readiness=stage_readiness(stage,profile,evaluations)
        if stage=="QC":
            final_samples={i.sample_id for i in inspections if i.stage_type=="QC" and i.status=="PASS" and i.sample_id and (i.evaluation or {}).get("workflow_status")!="SUPERSEDED" and planning._inspection_has_full_final_spec(i,job.spec_snapshot or {}) and all((i.readings or {}).get(k) not in (None,"") for k in ("id","od","length","weight","cs"))}
            final_pass=planning._final_spec_qc_passed(db=db,plant_id=job.plant_id,job_card=job,inline_quality_checks=None)
            readiness={"ready":len(final_samples)>=2 and final_pass,"missing":[] if len(final_samples)>=2 else [{"parameter":"final_spec","label":"Final specification QC","have":len(final_samples),"need":2}],"blockers":[] if final_pass else ["Final specification acceptance required"]}
        drafts=sum(e.stage==stage and e.status=="DRAFT" for e in all_entries)
        upstream=previous(job,stage);upstream_closed=not upstream or stage_map[upstream].status=="COMPLETED"
        target=int(snapshot.get("effective_target",planned_in_stage_units(stage,job.planned_qty,planning._pcs_per_bamboo_from_snapshot(job.spec_snapshot or {}))))
        accepted=int(shipped) if stage=="DISPATCH" else int(row.output_qty or 0) if stage=="SLITTING" else sum(e.accepted for e in actual)
        produced=accepted if stage in ("SLITTING","DISPATCH") else sum(e.produced for e in actual);blockers=[]
        cap=None
        if upstream and not (stage=="WINDER" and upstream=="SLITTING"):
            source=[e for e in all_entries if e.stage==upstream and e.status=="SUBMITTED"]
            cap=0 if blocked or not upstream_closed and (upstream,stage) not in CONTINUOUS else sum(e.accepted-int(used.get(e.id,0)) for e in source)
        if blocked:blockers.append("Resolve blocking QC holds")
        if not upstream_closed:blockers.append("Previous stage must close before this stage closes")
        if drafts:blockers.append(f"{drafts} draft entries remain")
        if not readiness["ready"]:blockers.append("Required QC samples or dispositions incomplete")
        if accepted<target:blockers.append("Target not reached; short-close reason required")
        status=row.status
        if stage=="DISPATCH":
            packed=int(stage_map["PACKING"].output_qty or 0) if "PACKING" in stage_map else target
            status="COMPLETED" if packed>0 and accepted>=packed else "RUNNING" if accepted>0 else row.status
            cap=max(0,packed-accepted);blockers=[] if status=="COMPLETED" else ["Complete shipment through Logistics Dispatch"]
        stage_segments=[s for s in segments if s.stage_type==stage]
        states.append({"stage":stage,"status":status,"unit":stage_unit(stage),"target":target,"produced_total":produced,"accepted_total":accepted,"rejected_total":produced-accepted,"input_total":accepted if stage=="DISPATCH" else sum(e.input_quantity for e in actual),"cutting_loss_total":sum(e.cutting_loss_pcs for e in actual),"carryover_pcs":sum(e.carry_out_pcs-e.carry_in_pcs for e in actual),"available_from_upstream":cap,"input_unit":stage_unit(upstream) if upstream else None,"qc":readiness,"draft_count":drafts,"can_close":status!="COMPLETED" and stage not in ("SLITTING","DISPATCH") and not blockers,"blockers":blockers,"row_version":int(snapshot.get("row_version",1)),"supervisor_name":snapshot.get("supervisor_name"),"closed_at":snapshot.get("closed_at"),"residual_quantity":snapshot.get("residual_quantity"),"residual_disposition":snapshot.get("residual_disposition"),"segments":[{"id":str(s.id),"machine_id":str(s.machine_id) if s.machine_id else None,"plan_date":s.plan_date,"shift_code":s.shift_code,"status":s.status,**planning._planner_gate_context(current_stage=stage,active_stage=row,active_segment=s)} for s in stage_segments]})
    pending=db.query(func.count(CompletionEffect.id)).filter(CompletionEffect.job_card_id==job.id,CompletionEffect.status.in_(["PENDING","RUNNING","FAILED"])).scalar()
    return {"job_card_id":str(job.id),"season":(job.spec_snapshot or {}).get("season"),"recipe_revision":((job.material_plan_snapshot or {}).get("recipe_snapshot") or {}).get("season_revision"),"stages":states,"pending_effects":pending,"residual_wip":[residual_dict(r) for r in residuals],"final_samples":[{"sample_id":i.sample_id,"status":i.status,"readings":i.readings,"qc_name":i.created_by,"recorded_at":i.created_at,"workflow_status":(i.evaluation or {}).get("workflow_status")} for i in inspections if i.stage_type=="QC"],"active_stages":[s["stage"] for s in states if s["status"]=="RUNNING"]}


def replay(db,job,payload,action):
    old=db.query(EntryReceipt).filter_by(job_card_id=job.id,request_id=payload.request_id).first();digest=fingerprint({"action":action,**payload.model_dump(mode="json")})
    if old:
        if old.fingerprint!=digest:raise HTTPException(409,"Command key already used for different inputs")
        return old.response
    return None


def finish(db,job,payload,action,user,response):
    result=jsonable_encoder(response)
    db.add(EntryReceipt(job_card_id=job.id,request_id=payload.request_id,fingerprint=fingerprint({"action":action,**payload.model_dump(mode="json")}),response=result))
    planning._record_audit_event(db=db,plant_id=job.plant_id,entity_type="job_card",entity_id=job.id,action=action,actor_id=user["sub"],actor_role=",".join(user.get("roles",[])),job_card_id=job.id,request_id=payload.request_id,payload={"reason":payload.reason,"result":result})
    if db.info.get("entry_batch"):db.flush()
    else:db.commit()
    return result


def employee(employee_id,user,plant,role=None):
    if not employee_id:raise HTTPException(422,f"{role or 'Employee'} is required")
    url=os.getenv("MASTERDATA_SERVICE_URL","http://127.0.0.1:18002")
    try:
        response=httpx.get(f"{url}/master/employees/{employee_id}",headers={"Authorization":f"Bearer {user.get('token','')}","X-Plant-ID":plant},timeout=8)
        response.raise_for_status();row=response.json()
    except (httpx.HTTPError,ValueError) as exc:raise HTTPException(503,"Could not validate the selected employee") from exc
    if not row.get("active",row.get("is_active",False)) or role and str(row.get("role") or "").lower()!=role:raise HTTPException(422,f"Select an active {role}")
    return row


def verified_employee(db,employee_id,user,plant,role):
    cache=db.info.get("entry_batch_employees",{})
    return cache[(str(employee_id),role)] if (str(employee_id),role) in cache else employee(employee_id,user,plant,role)


def verified_fg(item_id,user,plant):
    if not item_id:raise HTTPException(422,"Select the finished-good item before closing Packing")
    try:
        response=httpx.get(f"{planning.settings.INVENTORY_SERVICE_URL}/items/{item_id}",headers={"Authorization":f"Bearer {user.get('token','')}","X-Plant-ID":plant},timeout=8)
        response.raise_for_status();item=response.json()
    except (httpx.HTTPError,ValueError) as exc:raise HTTPException(503,"Could not verify the finished-good item") from exc
    if item.get("type")!="FINISHED_GOOD":raise HTTPException(422,"Selected item must be a finished good")
    return item


def verified_reel_links(db,job,issue_ids,user,plant):
    ids={str(i) for i in issue_ids}
    if not ids:return
    if ids<=db.info.get('entry_batch_reels',set()):return
    try:
        response=httpx.get(f"{planning.settings.INVENTORY_SERVICE_URL}/reel-issues",headers={"Authorization":f"Bearer {user.get('token','')}","X-Plant-ID":plant},params={'issue_ids':','.join(sorted(ids)),'limit':100},timeout=8)
        response.raise_for_status();issues=response.json()
    except (httpx.HTTPError,ValueError) as exc:raise HTTPException(503,'Could not verify material issue links') from exc
    machines={str(s.machine_id) for s in db.query(JobCardStage).filter_by(job_card_id=job.id,stage_type='WINDER').all()}|{str(s.machine_id) for s in db.query(JobCardStageSegment).filter_by(job_card_id=job.id,stage_type='WINDER').all()}
    if {str(i['id']) for i in issues}!=ids or any(i.get('issue_section')!='WINDER_SECTION' or i.get('status')!='CLOSED' or float(i.get('consumed_weight_kg') or 0)<=0 or str(i.get('machine_id')) not in machines or i.get('sales_order_id') and str(i['sales_order_id'])!=str(job.sales_order_id) for i in issues):raise HTTPException(422,'Link closed consumed Winding issues for this sales order and its assigned machines')


def entry_machine(db,job,data,user,plant):
    if data.kind=="QC_ONLY" or data.stage not in ("WINDER","OVEN","PROCESS","PACKING"):return None,None
    stage=stage_row(db,job,data.stage)
    segments=db.query(JobCardStageSegment).filter_by(job_card_id=job.id,stage_type=data.stage).all()
    active=[s for s in segments if s.status not in ("COMPLETED","CANCELLED")]
    segment=next((s for s in segments if s.id==data.segment_id),None) if data.segment_id else (active[0] if len(active)==1 else None)
    machine_id=data.machine_id or (segment or stage).machine_id
    if not machine_id:return None,None
    machine=planning._fetch_machine(machine_id,user.get("token",""),plant)
    return str(machine_id),machine


def validate_entry(e,job):
    if e.kind not in ("PRODUCTION","QC_ONLY","DISPOSITION"):raise HTTPException(422,"Unknown entry kind")
    if e.accepted>e.produced:raise HTTPException(422,"Accepted cannot exceed produced")
    if e.kind=="QC_ONLY":
        if any((e.produced,e.accepted,e.input_quantity,e.cutting_loss_pcs,e.carry_in_pcs,e.carry_out_pcs)) or not e.samples:raise HTTPException(422,"QC-only entry needs observations and zero quantities")
        return
    if not e.business_date or e.business_date>date.today():raise HTTPException(422,"Valid business date is required")
    if e.shift_code not in ("SHIFT_A","SHIFT_B"):raise HTTPException(422,"Select Shift A or Shift B")
    if not e.operator_id:raise HTTPException(422,"Operator is required")
    if e.kind=="DISPOSITION":
        if e.stage!="PROCESS" or e.produced or e.accepted or e.input_quantity or e.carry_out_pcs or e.carry_in_pcs<=0 or e.carry_in_pcs!=e.cutting_loss_pcs:raise HTTPException(422,"Disposition must account for held Process carryover as loss, without production")
    elif e.produced<=0:raise HTTPException(422,"Produced quantity must be positive")
    if (e.rejected or e.cutting_loss_pcs) and not str(e.details.get("reject_reason") or "").strip():raise HTTPException(422,"Reject reason is required")
    start,end=e.details.get("start_time"),e.details.get("end_time")
    try:
        values=[datetime.fromisoformat(str(t).replace("Z","+00:00")) for t in (start,end) if t]
        if len(values)==2 and values[1]<values[0]:raise ValueError()
    except (ValueError,TypeError) as exc:raise HTTPException(422,"End time must be after start time") from exc
    if e.details.get("cycle_time_hours") is not None:
        try:
            duration=float(e.details["cycle_time_hours"])
            if not math.isfinite(duration) or duration<=0:raise ValueError()
        except (ValueError,TypeError) as exc:raise HTTPException(422,"Oven cycle duration must be positive and finite") from exc


def validate_books(db,job,e):
    if e.kind=="QC_ONLY" or not e.business_date:return
    closed=db.query(MonthlyMaterialClose).filter_by(plant_id=job.plant_id,status="APPROVED").order_by(MonthlyMaterialClose.month_start.desc()).first()
    if closed:
        month=closed.month_start
        locked_through=date(month.year,month.month,calendar.monthrange(month.year,month.month)[1])
        if e.business_date<=locked_through:raise HTTPException(422,{"code":"BOOKS_LOCKED","message":f"Books are locked through {locked_through}; production cannot be backdated into this period"})


def sync_totals(db,job,stage):
    row=stage_row(db,job,stage);values=entries(db,job,stage)
    row.output_qty=sum(e.accepted for e in values);row.scrap_qty=sum(e.rejected for e in values);row.input_qty=sum(e.input_quantity for e in values)
    row.entry_snapshot={**(row.entry_snapshot or {}),"entry_model":"V2","entries_count":len(values),"operator_name":values[-1].operator_name if values else None}
    snapshot=dict(row.actuals_snapshot or {});snapshot.update(produced_total=sum(e.produced for e in values),accepted_total=row.output_qty,rejected_total=row.scrap_qty,row_version=int(snapshot.get("row_version",1))+1);row.actuals_snapshot=snapshot
    if values and row.status!="COMPLETED":row.status="RUNNING";job.status="IN_PROGRESS"
    for segment in db.query(JobCardStageSegment).filter_by(job_card_id=job.id,stage_type=stage).all():
        matched=[e for e in values if e.segment_id==segment.id]
        segment.output_qty=sum(e.accepted for e in matched);segment.scrap_qty=sum(e.rejected for e in matched);segment.input_qty=sum(e.input_quantity for e in matched)
        if matched and segment.status!="COMPLETED":segment.status="RUNNING"


def validate_setup(db,job,e):
    if e.kind=="QC_ONLY":return
    if e.stage=="DISPATCH":raise HTTPException(409,"Dispatch quantity is recorded through Logistics Dispatch")
    stage=stage_row(db,job,e.stage)
    if e.stage=="SLITTING":raise HTTPException(409,"Slitting keeps its material preparation form")
    if job.status in ("CANCELLED","COMPLETED"):raise HTTPException(409,"This job card is not open for production")
    segments=db.query(JobCardStageSegment).filter_by(job_card_id=job.id,stage_type=e.stage).all()
    segment=next((s for s in segments if s.id==e.segment_id),None) if e.segment_id else None
    if not e.segment_id:
        active=[s for s in segments if s.status not in ("COMPLETED","CANCELLED")]
        if len(active)>1:raise HTTPException(409,"Choose the scheduled stage segment for this entry")
        if active:segment=active[0];e.segment_id=segment.id
    if e.segment_id and not segment:raise HTTPException(422,"Segment does not belong to this card/stage")
    reference=segment or stage
    if not e.machine_id:e.machine_id=reference.machine_id
    gate=planning._planner_gate_context(current_stage=e.stage,active_stage=stage,active_segment=segment)
    if not gate["planner_gate_ready"]:raise HTTPException(409,{"code":"PLANNER_SLOT_REQUIRED","message":gate["planner_gate_reason"]})
    if segment and e.machine_id!=segment.machine_id:raise HTTPException(422,"Use the machine assigned to this segment")
    if e.machine_id and e.machine_id not in ([stage.machine_id]+[s.machine_id for s in db.query(JobCardStageSegment).filter_by(job_card_id=job.id,stage_type=e.stage).all()]):raise HTTPException(422,"Machine must be assigned to this stage")
    if e.machine_id:
        machine=db.info.get("entry_machines",{}).get(str(e.machine_id))
        if not machine:raise HTTPException(409,"The machine assignment changed; refresh the scheduled segment")
        warnings=[]
        advice=planning._validate_machine_compatibility(machine,e.stage,job.spec_snapshot or {},str(job.plant_id))
        if advice:warnings.append(advice)
        matching=[v for v in entries(db,job,e.stage) if v.id!=e.id and v.machine_id==e.machine_id and v.shift_code==e.shift_code and v.business_date==e.business_date]
        actual=SimpleNamespace(machine_id=e.machine_id,job_card=job,shift_code=e.shift_code,planned_start=None,planned_end=None)
        cycle=None
        if e.stage=="OVEN" and e.details.get("start_time") and e.details.get("end_time"):
            cycle=(datetime.fromisoformat(str(e.details["end_time"]).replace("Z","+00:00"))-datetime.fromisoformat(str(e.details["start_time"]).replace("Z","+00:00"))).total_seconds()/3600
        planning._validate_execution_capacity(db,actual,e.stage,machine,e.accepted+sum(v.accepted for v in matching),e.details,reference_time=datetime.combine(e.business_date,datetime.min.time()),card_cycle_hours=cycle,override_reason=e.details.get("overproduction_reason") or e.details.get("capacity_override_reason"),warnings=warnings)
        e.details={**e.details,"machine_warnings":warnings}
    current=sum(v.accepted for v in entries(db,job,e.stage) if v.id!=e.id)
    target=planned_in_stage_units(e.stage,job.planned_qty,planning._pcs_per_bamboo_from_snapshot(job.spec_snapshot or {}))
    if current+e.accepted>target*1.10 and not str(e.details.get("overproduction_reason") or "").strip():raise HTTPException(409,"Output above 110% of target requires an overproduction reason")


@router.patch("/job-cards/{card_id}/entries/{entry_id}")
def edit_entry(card_id:uuid.UUID,entry_id:uuid.UUID,payload:EntryInput,db:Session=Depends(get_db),plant:str=Depends(get_current_plant),user:dict=Depends(require_role(["Owner","Admin","PlantManager","Operator"]))):
    job=card(db,card_id,plant,True);prior=replay(db,job,payload,f"edit:{entry_id}")
    if prior:return prior
    e=db.query(StageEntry).filter_by(id=entry_id,job_card_id=job.id).first()
    if not e:raise HTTPException(404,"Entry not found")
    if e.status!="DRAFT" or stage_row(db,job,e.stage).status=="COMPLETED":raise HTTPException(409,"Only open drafts can be edited; void an unconsumed submission to replace quantities")
    if payload.expected_version!=e.row_version:raise HTTPException(409,"Entry changed; refresh")
    if "Operator" in user.get("roles",[]) and not set(user.get("roles",[]))&{"Owner","Admin","PlantManager"} and e.created_by!=user["sub"]:raise HTTPException(403,"Operators can edit their own drafts only")
    if payload.stage!=e.stage or payload.submit or payload.quantity_mode!="DELTA":raise HTTPException(422,"Stage cannot change in draft edit; use Submit after saving")
    for key,value in payload.model_dump(exclude={"request_id","expected_version","reason","submit","quantity_mode"}).items():setattr(e,key,value)
    e.rejected=e.produced-e.accepted
    if e.rejected<0:raise HTTPException(422,"Accepted cannot exceed produced")
    e.row_version+=1;db.add(EntryRevision(entry_id=e.id,row_version=e.row_version,payload=jsonable_encoder(entry_dict(e)),actor=user["sub"],reason=payload.reason or "Draft edited"));db.flush()
    return finish(db,job,payload,f"edit:{entry_id}",user,{"entry":entry_dict(e),"flow":flow(db,job)})


@router.get("/job-cards/{card_id}/entries/{entry_id}/history")
def entry_history(card_id:uuid.UUID,entry_id:uuid.UUID,db:Session=Depends(get_db),plant:str=Depends(get_current_plant),user:dict=Depends(get_current_user)):
    job=card(db,card_id,plant);e=db.query(StageEntry).filter_by(id=entry_id,job_card_id=job.id).first()
    if not e:raise HTTPException(404,"Entry not found")
    return [{"version":r.row_version,"payload":r.payload,"reason":r.reason,"actor":r.actor,"created_at":r.created_at} for r in db.query(EntryRevision).filter_by(entry_id=e.id).order_by(EntryRevision.row_version.desc()).all()]


def allocate(db,job,e):
    upstream=previous(job,e.stage)
    if e.kind=="QC_ONLY":return
    if not upstream:return
    if e.stage=="WINDER" and upstream=="SLITTING":
        if stage_row(db,job,"SLITTING").status!="COMPLETED":raise HTTPException(409,"Complete the Slitting material preparation first")
        return
    available_input=available(db,job,e.stage)
    if e.stage=="PROCESS":
        pcs=planning._pcs_per_bamboo_from_snapshot(job.spec_snapshot or {})
        prior=entries(db,job,"PROCESS")
        carry=sum(x.carry_out_pcs-x.carry_in_pcs for x in prior if x.id!=e.id)
        if e.carry_in_pcs>carry:raise HTTPException(409,"Process carryover balance is insufficient")
        if not pcs or e.input_quantity*pcs+e.carry_in_pcs!=e.produced+e.cutting_loss_pcs+e.carry_out_pcs:raise HTTPException(422,"Input bamboos × pieces per bamboo + carry-in must equal produced pcs + cutting loss + held carry-out")
        if (e.carry_out_pcs or e.carry_in_pcs) and not str(e.details.get("carryover_reason") or "").strip():raise HTTPException(422,"Carryover reason required")
    elif e.carry_in_pcs or e.carry_out_pcs or e.cutting_loss_pcs:raise HTTPException(422,"Cutting loss/carryover are Process-only")
    elif e.input_quantity!=e.produced:raise HTTPException(422,"Input quantity must equal produced quantity for this stage")
    if e.input_quantity>available_input:raise HTTPException(409,{"code":"UPSTREAM_SHORT","available":available_input,"unit":stage_unit(upstream)})
    remaining=e.input_quantity
    for source in entries(db,job,upstream):
        consumed=int(db.query(func.coalesce(func.sum(InputAllocation.quantity),0)).filter_by(source_entry_id=source.id).scalar())
        consumed+=int(db.query(func.coalesce(func.sum(ResidualWip.quantity),0)).filter(ResidualWip.source_entry_id==source.id,ResidualWip.status!="REVERSED").scalar())
        take=min(remaining,source.accepted-consumed)
        if take>0:db.add(InputAllocation(job_card_id=job.id,source_entry_id=source.id,consumer_entry_id=e.id,quantity=take));remaining-=take
        if remaining==0:break
    if remaining:raise HTTPException(409,"Upstream allocation changed")


def dispose_residual(db,job,stage,disposition,reason,user):
    upstream=previous(job,stage)
    if not upstream:return
    for source in entries(db,job,upstream):
        consumed=int(db.query(func.coalesce(func.sum(InputAllocation.quantity),0)).filter_by(source_entry_id=source.id).scalar())
        quantity=source.accepted-consumed
        if quantity<=0:continue
        old=db.query(ResidualWip).filter_by(job_card_id=job.id,stage=stage,source_entry_id=source.id).first()
        if old:
            if old.status!="REVERSED":continue
            old.status="HOLD" if disposition=="HOLD" else "DISPOSED";old.disposition=disposition;old.quantity=quantity;old.reason=reason;old.row_version+=1
        else:db.add(ResidualWip(job_card_id=job.id,stage=stage,source_entry_id=source.id,unit=stage_unit(upstream),quantity=quantity,disposition=disposition,status="HOLD" if disposition=="HOLD" else "DISPOSED",reason=reason,created_by=user["sub"]))


@router.post("/job-cards/{card_id}/residual-wip/{residual_id}/resolve")
def resolve_residual(card_id:uuid.UUID,residual_id:uuid.UUID,payload:ResidualResolve,db:Session=Depends(get_db),plant:str=Depends(get_current_plant),user:dict=Depends(require_role(["Owner","Admin","PlantManager"]))):
    job=card(db,card_id,plant,True);prior=replay(db,job,payload,f"residual_resolve:{residual_id}")
    if prior:return prior
    row=db.query(ResidualWip).filter_by(id=residual_id,job_card_id=job.id).first()
    if not row:raise HTTPException(404,"Residual WIP not found")
    if row.status!="HOLD" or payload.expected_version!=row.row_version:raise HTTPException(409,"Residual WIP changed; refresh")
    if payload.disposition not in ("SCRAP","RETURN") or not payload.reason.strip():raise HTTPException(422,"Record actual scrap or return with a reason")
    before=residual_dict(row)
    row.disposition=payload.disposition;row.status="DISPOSED";row.reason=payload.reason;row.resolved_by=user["sub"];row.resolved_at=datetime.utcnow();row.row_version+=1
    return finish(db,job,payload,f"residual_resolve:{residual_id}",user,{"before":before,"residual":residual_dict(row),"flow":flow(db,job)})


def inspect(db,job,e,user):
    existing_samples={str(sample.get("sample_id")) for other in entries(db,job,e.stage) if other.id!=e.id for sample in (other.samples or [])}
    if any(str(sample.get("sample_id")) in existing_samples for sample in (e.samples or [])):raise HTTPException(409,"This physical sample ID is already recorded on another entry; correct that entry instead")
    try:e.evaluation=evaluate_samples(e.stage,(job.spec_snapshot or {}).get("qc_profile") or {},e.samples)
    except RuleError as exc:raise HTTPException(422,str(exc)) from exc
    if any(r["verdict"] in ("INVALID","INCOMPLETE") for r in e.evaluation["results"]):raise HTTPException(422,{"message":"Correct invalid or unpaired observations before submitting","blockers":[r for r in e.evaluation["results"] if r["verdict"] in ("INVALID","INCOMPLETE")]})
    if not e.evaluation["results"]:return
    from .quality import _apply_instrument_register
    evidence=_apply_instrument_register(db,job.plant_id,{'instrument':(e.details or {}).get('instrument') or {}}).get('instrument',{})
    e.details={**(e.details or {}),'instrument':evidence}
    for sample in e.samples:
        instrument_state=instrument_readiness_for_snapshot(job.spec_snapshot or {},e.stage,{**sample.get("readings",{}),'instrument':evidence})
        if instrument_state.get("required") and not instrument_state.get("ready"):raise HTTPException(409,instrument_not_ready_detail(instrument_state,{"samples":e.samples}))
    e.details={**(e.details or {}),"qc_name":user.get("name") or user.get("email") or user["sub"]}
    failures=[r for r in e.evaluation["results"] if r["verdict"] in ("FAIL","INVALID","INCOMPLETE")]
    inspection=QualityInspection(plant_id=job.plant_id,job_card_id=job.id,stage_type=e.stage,status=e.evaluation["verdict"],readings={"samples":e.samples},evaluation={**e.evaluation,"entry_id":str(e.id),"entry_revision":e.row_version,"gating":"blocking" if any(r.get("gating")=="blocking" for r in failures) else "advisory"},failures=failures,reasons={},sample_id=str(e.id),entry_mode="CONTINUOUS",created_by=user["sub"])
    db.add(inspection);db.flush()
    if any(r["verdict"]=="FAIL" and r.get("gating")=="blocking" for r in failures):
        db.add(QualityHold(plant_id=job.plant_id,job_card_id=job.id,stage_type=e.stage,reason=f"Entry {e.entry_no} QC failure",source_inspection_id=inspection.id,status="HOLD",created_by=user["sub"]))
        db.add(CompletionEffect(job_card_id=job.id,effect_key=f"{job.id}:hold:{inspection.id}",kind="hold_stock",payload={"stage":e.stage,"plant_id":str(job.plant_id)}))
        for packing in db.query(PackingRecord).filter_by(job_card_id=job.id).all():packing.stock_status="QC_HOLD"
        for downstream in db.query(JobCardStage).filter_by(job_card_id=job.id).all():
            snapshot=dict(downstream.actuals_snapshot or {});snapshot["stock_status"]="QC_HOLD";downstream.actuals_snapshot=snapshot


@router.get("/job-cards/{card_id}/flow")
def get_flow(card_id:uuid.UUID,db:Session=Depends(get_db),plant:str=Depends(get_current_plant),user:dict=Depends(get_current_user)):
    return flow(db,card(db,card_id,plant))


@router.get("/job-cards/{card_id}/entries")
def get_entries(card_id:uuid.UUID,stage:str|None=None,offset:int=Query(0,ge=0),limit:int=Query(50,ge=1,le=100),db:Session=Depends(get_db),plant:str=Depends(get_current_plant),user:dict=Depends(get_current_user)):
    job=card(db,card_id,plant);query=db.query(StageEntry).filter_by(job_card_id=job.id)
    if stage:stage_row(db,job,stage);query=query.filter_by(stage=stage)
    return {"entries":[entry_dict(e) for e in query.order_by(StageEntry.created_at.desc(),StageEntry.id).offset(offset).limit(limit).all()],"total":query.count()}


@router.get("/job-cards/{card_id}/effects")
def posting_effects(card_id:uuid.UUID,db:Session=Depends(get_db),plant:str=Depends(get_current_plant),user:dict=Depends(get_current_user)):
    job=card(db,card_id,plant)
    return [{"id":str(e.id),"kind":e.kind,"stage":e.payload.get("stage"),"status":e.status,"attempts":e.attempts,"last_error":e.last_error,"next_attempt_at":e.next_attempt_at,"delivered_at":e.delivered_at} for e in db.query(CompletionEffect).filter_by(job_card_id=job.id).order_by(CompletionEffect.created_at).all()]


@router.post("/job-cards/{card_id}/effects/{effect_id}/retry")
def retry_effect(card_id:uuid.UUID,effect_id:uuid.UUID,payload:Mutation,db:Session=Depends(get_db),plant:str=Depends(get_current_plant),user:dict=Depends(require_role(["Owner","Admin","PlantManager"]))):
    job=card(db,card_id,plant,True);prior=replay(db,job,payload,f"effect_retry:{effect_id}")
    if prior:return prior
    e=db.query(CompletionEffect).filter_by(id=effect_id,job_card_id=job.id).first()
    if not e:raise HTTPException(404,"Posting not found")
    if e.status not in ("FAILED","PENDING") or payload.expected_version!=e.attempts:raise HTTPException(409,"Posting state changed; refresh")
    if not payload.reason.strip():raise HTTPException(422,"Retry reason is required")
    e.status="PENDING";e.next_attempt_at=datetime.utcnow()
    return finish(db,job,payload,f"effect_retry:{effect_id}",user,{"status":e.status,"effect_id":str(e.id)})


@router.post("/job-cards/{card_id}/entries")
def create_entry(card_id:uuid.UUID,payload:EntryInput,db:Session=Depends(get_db),plant:str=Depends(get_current_plant),user:dict=Depends(require_role(["Owner","Admin","PlantManager","Operator","QC"]))):
    roles=set(user.get("roles",[]))
    if "QC" in roles and not roles & {"Owner","Admin","PlantManager"} and payload.kind!="QC_ONLY":raise HTTPException(403,"QC may add observations only")
    if "Operator" in roles and payload.submit and not roles & {"Owner","Admin","PlantManager"}:raise HTTPException(403,"Operator submission is not enabled; save a draft for supervisor review")
    preliminary=card(db,card_id,plant);cached=replay(db,preliminary,payload,"entry_create")
    if cached:return cached
    if payload.submit and payload.kind=="PRODUCTION" and not {"produced","accepted"}<=payload.model_fields_set:raise HTTPException(422,"Quantity produced and accepted quantity are mandatory")
    operator=verified_employee(db,payload.operator_id,user,plant,"operator") if payload.submit and payload.kind in ("PRODUCTION","DISPOSITION") else None
    if payload.submit and not db.info.get("entry_batch"):
        machine_id,machine=entry_machine(db,preliminary,payload,user,plant)
        db.info["entry_machines"]={machine_id:machine} if machine_id else {}
    job=card(db,card_id,plant,True);prior=replay(db,job,payload,"entry_create")
    if prior:return prior
    row=stage_row(db,job,payload.stage)
    if row.status=="COMPLETED":raise HTTPException(409,"Reopen this stage before adding production")
    number=(db.query(func.max(StageEntry.entry_no)).filter_by(job_card_id=job.id,stage=payload.stage).scalar() or 0)+1
    if payload.quantity_mode not in ("DELTA","TOTAL"):raise HTTPException(422,"Unknown quantity entry mode")
    data=payload.model_dump(exclude={"request_id","expected_version","reason","submit","quantity_mode"})
    if payload.quantity_mode=="TOTAL":
        version_check=int((row.actuals_snapshot or {}).get("row_version",1))
        if payload.expected_version!=version_check:raise HTTPException(409,"Stage totals changed; review the new delta")
        if not payload.submit:raise HTTPException(422,"Cumulative totals must be submitted immediately")
        current=entries(db,job,payload.stage)
        for field in ("produced","accepted","input_quantity","cutting_loss_pcs"):
            data[field]-=sum(getattr(x,field) for x in current)
            if data[field]<0:raise HTTPException(409,"Cumulative total is below the posted total; use a governed correction")
    e=StageEntry(**data,plant_id=job.plant_id,job_card_id=job.id,entry_no=number,rejected=data["produced"]-data["accepted"],created_by=user["sub"])
    if operator:e.operator_name=operator["name"];e.operator_code=operator["employee_code"]
    if e.accepted>e.produced:raise HTTPException(422,"Accepted cannot exceed produced")
    db.add(e);db.flush()
    if payload.submit:
        validate_entry(e,job);validate_books(db,job,e);validate_setup(db,job,e);allocate(db,job,e);e.status="SUBMITTED";e.submitted_at=datetime.utcnow();inspect(db,job,e,user);db.flush();sync_totals(db,job,e.stage)
    db.add(EntryRevision(entry_id=e.id,row_version=e.row_version,payload=jsonable_encoder(entry_dict(e)),actor=user["sub"],reason=payload.reason or "Initial entry"));db.flush()
    return finish(db,job,payload,"entry_create",user,{"entry":entry_dict(e),"flow":flow(db,job)})


@router.post("/job-cards/{card_id}/entries/batch")
def batch_entries(card_id:uuid.UUID,payload:BatchInput,db:Session=Depends(get_db),plant:str=Depends(get_current_plant),user:dict=Depends(require_role(["Owner","Admin","PlantManager"]))):
    job=card(db,card_id,plant);cached=replay(db,job,payload,"entries_batch")
    if cached:return cached
    positions=[route(job).index(s.entry.stage) if s.entry.stage in route(job) else -1 for s in payload.steps]
    if -1 in positions or positions!=sorted(positions):raise HTTPException(422,"Whole-card entries must follow the frozen route order")
    employees={};fg={};machines={}
    # Reference services are called before locking the card. Local state and all
    # completion effects below share one transaction and one durable receipt.
    for step in payload.steps:
        if not step.entry.submit:raise HTTPException(422,"Whole-card items must be submitted entries")
        if step.entry.kind in ("PRODUCTION","DISPOSITION"):
            key=(str(step.entry.operator_id),"operator")
            if key not in employees:employees[key]=employee(step.entry.operator_id,user,plant,"operator")
        machine_id,machine=entry_machine(db,job,step.entry,user,plant)
        if machine_id:machines[machine_id]=machine
        if step.close:
            key=(str(step.close.supervisor_id),"supervisor")
            if key not in employees:employees[key]=employee(step.close.supervisor_id,user,plant,"supervisor")
            if step.entry.stage=="PACKING":fg[str(step.close.fg_item_id)]=verified_fg(step.close.fg_item_id,user,plant)
            if step.close.reel_issue_ids:verified_reel_links(db,job,step.close.reel_issue_ids,user,plant)
    db.info.update(entry_batch=True,entry_batch_employees=employees,entry_batch_fg=fg,entry_machines=machines,entry_batch_reels={str(i) for step in payload.steps if step.close for i in step.close.reel_issue_ids})
    try:
        job=card(db,card_id,plant,True);cached=replay(db,job,payload,"entries_batch")
        if cached:return cached
        # Validate the caller's original totals before any child writes. A short
        # closure may change downstream targets inside this same transaction;
        # those known version increments can then be carried into later steps.
        original_versions={s.stage_type:int((s.actuals_snapshot or {}).get('row_version',1)) for s in job.stages}
        own_increments={s:0 for s in original_versions}
        results=[]
        for index,step in enumerate(payload.steps):
            key=fingerprint({"batch":payload.request_id,"index":index})
            stage=step.entry.stage
            expected=original_versions[stage]+own_increments[stage]
            current=int((stage_row(db,job,stage).actuals_snapshot or {}).get('row_version',1))
            if step.entry.quantity_mode=='TOTAL' and step.entry.expected_version!=expected:raise HTTPException(409,'Stage totals changed; refresh the whole-card form')
            if step.close and step.close.expected_version!=expected+1:raise HTTPException(409,'Stage close version changed; refresh the whole-card form')
            entry=step.entry.model_copy(update={"request_id":"batch-entry:"+key,"expected_version":current if step.entry.quantity_mode=='TOTAL' else step.entry.expected_version})
            result=create_entry(card_id,entry,db,plant,user)
            own_increments[stage]+=1
            if step.close:
                close=step.close.model_copy(update={"request_id":"batch-close:"+key,"expected_version":current+1})
                close_stage(card_id,entry.stage,close,db,plant,user)
                own_increments[stage]+=1
            results.append(result["entry"])
        db.info["entry_batch"]=False
        return finish(db,job,payload,"entries_batch",user,{"entries":results,"flow":flow(db,job)})
    except Exception:
        db.rollback();raise
    finally:
        for key in ("entry_batch","entry_batch_employees","entry_batch_fg","entry_machines","entry_batch_reels"):db.info.pop(key,None)


@router.post("/job-cards/{card_id}/entries/{entry_id}/submit")
def submit_entry(card_id:uuid.UUID,entry_id:uuid.UUID,payload:Mutation,db:Session=Depends(get_db),plant:str=Depends(get_current_plant),user:dict=Depends(require_role(["Owner","Admin","PlantManager"]))):
    preliminary=card(db,card_id,plant);candidate=db.query(StageEntry).filter_by(id=entry_id,job_card_id=preliminary.id).first()
    if not candidate:raise HTTPException(404,"Entry not found")
    cached=replay(db,preliminary,payload,f"submit:{entry_id}")
    if cached:return cached
    operator=verified_employee(db,candidate.operator_id,user,plant,"operator") if candidate.kind in ("PRODUCTION","DISPOSITION") else None
    machine_id,machine=entry_machine(db,preliminary,candidate,user,plant)
    db.info["entry_machines"]={machine_id:machine} if machine_id else {}
    job=card(db,card_id,plant,True);prior=replay(db,job,payload,f"submit:{entry_id}")
    if prior:return prior
    e=db.query(StageEntry).filter_by(id=entry_id,job_card_id=job.id).populate_existing().one()
    if e.status!="DRAFT" or stage_row(db,job,e.stage).status=="COMPLETED":raise HTTPException(409,"Only an open-stage draft can be submitted")
    if payload.expected_version!=e.row_version:raise HTTPException(409,"Entry changed; refresh")
    if operator:e.operator_name=operator["name"];e.operator_code=operator["employee_code"]
    validate_entry(e,job);validate_books(db,job,e);validate_setup(db,job,e);allocate(db,job,e);e.status="SUBMITTED";e.row_version+=1;e.submitted_at=datetime.utcnow();inspect(db,job,e,user);db.flush();sync_totals(db,job,e.stage)
    db.add(EntryRevision(entry_id=e.id,row_version=e.row_version,payload=jsonable_encoder(entry_dict(e)),actor=user["sub"],reason="Submitted"));db.flush()
    return finish(db,job,payload,f"submit:{entry_id}",user,{"entry":entry_dict(e),"flow":flow(db,job)})


@router.post("/job-cards/{card_id}/entries/{entry_id}/observations")
def save_observations(card_id:uuid.UUID,entry_id:uuid.UUID,payload:Observations,db:Session=Depends(get_db),plant:str=Depends(get_current_plant),user:dict=Depends(require_role(["QC","Owner","Admin"]))):
    job=card(db,card_id,plant,True);prior=replay(db,job,payload,f"observations:{entry_id}")
    if prior:return prior
    e=db.query(StageEntry).filter_by(id=entry_id,job_card_id=job.id).first()
    if not e:raise HTTPException(404,"Entry not found")
    if e.status=="VOID":raise HTTPException(409,"Voided observations cannot be revised")
    if payload.expected_version!=e.row_version or not payload.reason.strip():raise HTTPException(409,"Current version and correction reason required")
    e.samples=payload.samples
    if payload.instrument is not None:e.details={**(e.details or {}),"instrument":payload.instrument}
    e.row_version+=1;inspect(db,job,e,user)
    db.add(EntryRevision(entry_id=e.id,row_version=e.row_version,payload=jsonable_encoder(entry_dict(e)),actor=user["sub"],reason=payload.reason));db.flush()
    return finish(db,job,payload,f"observations:{entry_id}",user,{"entry":entry_dict(e),"flow":flow(db,job)})


@router.post("/job-cards/{card_id}/entries/{entry_id}/void")
def void_entry(card_id:uuid.UUID,entry_id:uuid.UUID,payload:Mutation,db:Session=Depends(get_db),plant:str=Depends(get_current_plant),user:dict=Depends(require_role(["Owner","Admin","PlantManager"]))):
    job=card(db,card_id,plant,True);prior=replay(db,job,payload,f"void:{entry_id}")
    if prior:return prior
    e=db.query(StageEntry).filter_by(id=entry_id,job_card_id=job.id).first()
    if not e:raise HTTPException(404,"Entry not found")
    if not payload.reason.strip() or payload.expected_version!=e.row_version:raise HTTPException(409,"Current version and void reason required")
    if stage_row(db,job,e.stage).status=="COMPLETED" or db.query(InputAllocation).filter_by(source_entry_id=e.id).first() or db.query(ResidualWip).filter(ResidualWip.source_entry_id==e.id,ResidualWip.status!="REVERSED").first():raise HTTPException(409,"Cannot void closed-stage, consumed or disposed output")
    if e.carry_out_pcs and any(x.entry_no>e.entry_no and x.carry_in_pcs for x in entries(db,job,"PROCESS")):raise HTTPException(409,"Carryover has downstream use; reverse downstream entries first")
    db.query(InputAllocation).filter_by(consumer_entry_id=e.id).delete();e.status="VOID";e.row_version+=1;db.flush();sync_totals(db,job,e.stage)
    db.add(EntryRevision(entry_id=e.id,row_version=e.row_version,payload=jsonable_encoder(entry_dict(e)),actor=user["sub"],reason=payload.reason));db.flush()
    return finish(db,job,payload,f"void:{entry_id}",user,{"entry":entry_dict(e),"flow":flow(db,job)})


def effect(db,job,kind,stage):
    key=f"{job.id}:{stage}:{kind}"
    existing=db.query(CompletionEffect).filter_by(effect_key=key).first()
    if not existing:db.add(CompletionEffect(job_card_id=job.id,effect_key=key,kind=kind,payload={"stage":stage,"plant_id":str(job.plant_id)}))
    elif existing.status=="CANCELLED":existing.status="PENDING"


@router.post("/job-cards/{card_id}/stages/{stage}/close")
def close_stage(card_id:uuid.UUID,stage:str,payload:CloseInput,db:Session=Depends(get_db),plant:str=Depends(get_current_plant),user:dict=Depends(require_role(["Owner","Admin","PlantManager"]))):
    if stage=="SLITTING":raise HTTPException(409,"Complete Slitting through its material preparation form")
    if stage=="DISPATCH":raise HTTPException(409,"Complete dispatch through Logistics Dispatch")
    preliminary=card(db,card_id,plant);cached=replay(db,preliminary,payload,f"close:{stage}")
    if cached:return cached
    supervisor=verified_employee(db,payload.supervisor_id,user,plant,"supervisor")
    if payload.reel_issue_ids:
        if stage!='WINDER':raise HTTPException(422,'Link reel issues to Winding only')
        verified_reel_links(db,preliminary,payload.reel_issue_ids,user,plant)
    if stage=="PACKING":
        if str(payload.fg_item_id) not in db.info.get("entry_batch_fg",{}):verified_fg(payload.fg_item_id,user,plant)
    job=card(db,card_id,plant,True);prior=replay(db,job,payload,f"close:{stage}")
    if prior:return prior
    row=stage_row(db,job,stage);state=next(s for s in flow(db,job)["stages"] if s["stage"]==stage)
    if row.status=="COMPLETED":raise HTTPException(409,"Stage already closed")
    if payload.expected_version!=state["row_version"]:raise HTTPException(409,"Stage changed; refresh before closing")
    upstream=previous(job,stage)
    if upstream and stage_row(db,job,upstream).status!="COMPLETED":raise HTTPException(409,"Close the previous stage first")
    if state["draft_count"]:raise HTTPException(409,"Submit or discard outstanding drafts")
    if not state["qc"]["ready"]:raise HTTPException(409,{"code":"STAGE_QC_READINGS_SHORT","missing":state["qc"]["missing"],"blockers":state["qc"]["blockers"]})
    if planning._movement_blocking_holds(db,db.query(QualityHold).filter_by(job_card_id=job.id).all()):raise HTTPException(409,"Resolve blocking QC holds before close")
    if state["accepted_total"]<state["target"] and not (payload.short_close and payload.reason.strip()):raise HTTPException(409,"Short close requires an explicit reason")
    if stage=="WINDER" and not (row.reel_issue_ids or payload.reel_issue_ids) and not payload.reason.strip():raise HTTPException(409,"Link reel issues or record the material issue exception")
    if stage=="QC" and not planning._final_spec_qc_passed(db=db,plant_id=job.plant_id,job_card=job,inline_quality_checks=None):raise HTTPException(409,"Final specification QC acceptance required")
    if stage=="PROCESS" and state["carryover_pcs"]:raise HTTPException(409,"Use or explicitly dispose all held Process carryover before closing")
    # An inventory issue is attributed to one card. Serialize different cards
    # linking the same issue, so purchasing never subtracts its kg twice.
    for issue_id in sorted({str(i) for i in payload.reel_issue_ids}):
        if not db.execute(text('SELECT pg_try_advisory_xact_lock(hashtext(:key))'),{'key':'production-reel-link:'+issue_id}).scalar():raise HTTPException(409,'Material issue is being linked by another card; refresh and retry')
        if db.query(JobCardStage).filter(JobCardStage.job_card_id!=job.id,JobCardStage.reel_issue_ids.contains([issue_id])).first():raise HTTPException(409,'Material issue already belongs to another job card; select its own consumed issue')
    residual=available(db,job,stage)
    if residual and not (payload.residual_disposition in ("SCRAP","HOLD","RETURN") and payload.reason.strip()):raise HTTPException(409,{"code":"RESIDUAL_WIP","available":residual,"message":"Record residual input as HOLD, RETURN or SCRAP with a reason"})
    if residual:dispose_residual(db,job,stage,payload.residual_disposition,payload.reason,user)
    if payload.reel_issue_ids:row.reel_issue_ids=sorted({str(i) for i in (row.reel_issue_ids or [])+payload.reel_issue_ids})
    row.status="COMPLETED";row.entered_by=user["sub"];row.entered_at=datetime.utcnow()
    snapshot=dict(row.actuals_snapshot or {});snapshot.update(closed_at=datetime.utcnow().isoformat(),closed_by=user["sub"],supervisor_id=str(payload.supervisor_id),supervisor_name=supervisor["name"],close_reason=payload.reason,residual_quantity=residual or 0,residual_disposition=payload.residual_disposition,close_kind="SHORT_CLOSE" if state["accepted_total"]<state["target"] else "TARGET_MET",row_version=state["row_version"]+1);row.actuals_snapshot=snapshot
    row.entry_snapshot={**(row.entry_snapshot or {}),"supervisor_name":supervisor["name"]}
    for segment in db.query(JobCardStageSegment).filter_by(job_card_id=job.id,stage_type=stage).all():segment.status="COMPLETED";segment.completed_at=datetime.utcnow()
    routing=route(job);index=routing.index(stage)
    if state['accepted_total']<state['target']:
        qty=state['accepted_total'];unit=stage_unit(stage)
        for following in routing[index+1:]:
            next_unit=stage_unit(following)
            if unit=='bamboo' and next_unit=='pcs':qty*=planning._pcs_per_bamboo_from_snapshot(job.spec_snapshot or {})
            unit=next_unit
            nxt=stage_row(db,job,following);next_snapshot=dict(nxt.actuals_snapshot or {})
            old_target=int(next_snapshot.get('effective_target',planned_in_stage_units(following,job.planned_qty,planning._pcs_per_bamboo_from_snapshot(job.spec_snapshot or {}))))
            if qty<old_target:
                next_snapshot.update(effective_target=qty,row_version=int(next_snapshot.get('row_version',1))+1);nxt.actuals_snapshot=next_snapshot
    if stage=="PACKING":
        row.location_id=payload.location_id
        row.entry_snapshot={**(row.entry_snapshot or {}),"fg_item_id":str(payload.fg_item_id),"stock_status":"UNRESTRICTED"}
    if stage=="PACKING":planning._sync_packing_record(db=db,plant_id=job.plant_id,job_card=job,stage=row,current_user=user)
    job.current_stage,job.status=planning._derive_job_current_stage_and_status(db.query(JobCardStage).filter_by(job_card_id=job.id).all())
    if stage!="DISPATCH":effect(db,job,"tools",stage)
    if stage in ("PACKING","QC"):effect(db,job,"theory",stage)
    if stage=="QC":effect(db,job,"fg_inward","PACKING")
    db.flush()
    return finish(db,job,payload,f"close:{stage}",user,{"flow":flow(db,job)})


@router.post("/job-cards/{card_id}/stages/{stage}/reopen")
def reopen_stage(card_id:uuid.UUID,stage:str,payload:Mutation,db:Session=Depends(get_db),plant:str=Depends(get_current_plant),user:dict=Depends(require_role(["Owner","Admin"]))):
    job=card(db,card_id,plant,True);prior=replay(db,job,payload,f"reopen:{stage}")
    if prior:return prior
    row=stage_row(db,job,stage)
    if payload.expected_version!=int((row.actuals_snapshot or {}).get("row_version",1)):raise HTTPException(409,"Stage changed; refresh")
    if row.status!="COMPLETED" or not payload.reason.strip():raise HTTPException(409,"Closed stage and reopen reason required")
    effects=db.query(CompletionEffect).filter_by(job_card_id=job.id).all()
    if any(e.kind=='fg_inward' and e.status=='DELIVERED' for e in effects):raise HTTPException(409,"Posted finished goods require governed reversal/additional production")
    for e in effects:
        if e.kind=='tools' and e.payload.get('stage')==stage and e.attempts:
            if e.status!='DELIVERED' or e.payload.get('posted_tool_asset_ids')!=[]:raise HTTPException(409,"Posted or uncertain tool usage requires governed reversal/additional production")
    for entry in entries(db,job,stage):
        if entry.business_date:validate_books(db,job,entry)
    if any(stage_row(db,job,s).status=="COMPLETED" for s in route(job)[route(job).index(stage)+1:]):raise HTTPException(409,"Reopen affected downstream stages first")
    row.status="RUNNING";snapshot=dict(row.actuals_snapshot or {});snapshot["reopened_count"]=int(snapshot.get("reopened_count",0))+1;snapshot["row_version"]=int(snapshot.get("row_version",1))+1;row.actuals_snapshot=snapshot;job.current_stage=stage;job.status="IN_PROGRESS"
    for residual in db.query(ResidualWip).filter_by(job_card_id=job.id,stage=stage).filter(ResidualWip.status!="REVERSED").all():
        if residual.status!="HOLD":raise HTTPException(409,"Physically disposed WIP requires a governed reversal")
        residual.status="REVERSED";residual.row_version+=1
    for pending in effects:
        if pending.kind in ('tools','theory','fg_inward') and (pending.payload.get('stage')==stage or (stage=='QC' and pending.kind=='fg_inward')):
            pending.status="CANCELLED"
    return finish(db,job,payload,f"reopen:{stage}",user,{"flow":flow(db,job)})
