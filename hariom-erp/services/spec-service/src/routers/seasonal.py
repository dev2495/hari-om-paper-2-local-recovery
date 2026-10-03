"""Season commands. Configuration and release authorization share one lock."""
from copy import deepcopy
from datetime import date, datetime
import json
import os
import uuid
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, text, or_, and_
from sqlalchemy.orm import Session, selectinload
from ..database import get_db
from ..models import SpecificationSheet, RecipeHeader, RecipeLayer, TrialResult
from ..season_models import SeasonState, RuleVersion, OverlayVersion, RecipeBinding, SeasonEvent, SeasonReceipt, ReleaseAuthorization, SpecReadiness
from ..utils.auth import get_current_user, get_current_plant, get_current_plant_scope, apply_plant_scope, require_role
from .. import spec_math
from ..calculators import generate_bom, calculate_yield, calculate_weights
from .specs import SpecCreate, SpecUpdate, _serialize_spec, _dynamic_field_map, _upsert_dynamic_values, _upsert_compat_dynamic_values, _compat_dynamic_values_from_payload, _validate_recipe_profile_limits, _replacement_spec_from_payload, _merged_dynamic_fields_for_replacement, _enforce_live_spec_edit_lock
from ..final_limits import merge_canonical_into_payload
from season_quality import SEASONS, RuleError, initial_rules, validate_rules, resolve_profile, fingerprint, potentially_loosens

router = APIRouter(tags=["seasonal manufacturing"])


class Command(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(min_length=8, max_length=100)
    expected_version: int | None = None
    note: str = ""


class RuleDraft(Command):
    rules: list[dict]


class Switch(Command):
    to: str
    preview_fingerprint: str
    acknowledge_blocked:bool=False


class Document(Command):
    spec: dict
    recipes: dict[str, dict] = Field(default_factory=dict)
    trial: dict | None = None


class RecipeEdit(Command):
    layers: list[dict]
    sheet_rows: list[dict] = Field(default_factory=list)
    confirm: bool = False


class OverlayDraft(RuleDraft):
    target_type: str
    target_id: uuid.UUID
    season: str


class Authorize(Command):
    quantity: int = Field(gt=0,strict=True)
    sales_order_line_id: uuid.UUID


class AuthorizationAck(Command):
    job_card_id:uuid.UUID
    bundle_hash:str


def season_key(value):
    if value not in SEASONS:
        raise HTTPException(422, "Season must be ROY or MONSOON")
    return value


def lock_state(db):
    db.execute(text("INSERT INTO production_season_state (id,active_season,epoch) VALUES ('ORGANIZATION','ROY',1) ON CONFLICT (id) DO NOTHING"))
    return db.query(SeasonState).filter_by(id="ORGANIZATION").with_for_update().one()


def checked_rules(rows, overlay=False):
    try:
        return validate_rules(rows, overlay=overlay)
    except RuleError as exc:
        raise HTTPException(422, str(exc)) from exc


def receipt(db, key, payload):
    prior = db.query(SeasonReceipt).filter_by(operation_key=key).first()
    digest = fingerprint(jsonable_encoder(payload))
    if prior:
        if prior.fingerprint != digest:
            raise HTTPException(409, "Request key was already used for a different command")
        return prior.response
    return None


def complete(db, key, payload, response, user, action, note=""):
    result = jsonable_encoder(response)
    db.add(SeasonReceipt(operation_key=key, fingerprint=fingerprint(jsonable_encoder(payload)), response=result))
    db.add(SeasonEvent(action=action, actor=str(user["sub"]), note=note, payload=result))
    db.flush()
    if action not in ("production_season_switched","season_release_authorized","season_release_acknowledged"):
        refresh_readiness(db)
    db.commit()
    return result


def version_check(actual, expected):
    if expected is None or actual != expected:
        raise HTTPException(409, {"code": "STALE_VERSION", "current_version": actual, "message": "Refresh before changing this record"})


def rule_dict(row):
    return {"id": str(row.id), "season": row.season, "version": row.version, "status": row.status, "rules": row.rules, "fingerprint": row.fingerprint, "row_version": row.row_version, "change_note": row.change_note, "created_by": row.created_by, "created_at": row.created_at, "published_by": row.published_by, "published_at": row.published_at}


def published_rules(db, season):
    row = db.query(RuleVersion).filter_by(scope_id="ORGANIZATION", season=season, status="PUBLISHED").first()
    if not row:
        raise HTTPException(409, {"code": "QC_RULES_NOT_PUBLISHED", "season": season, "message": "QC must publish the seasonal rules"})
    return row


def overlays_for(db, spec, season):
    rows = db.query(OverlayVersion).filter(OverlayVersion.plant_id == spec.plant_id, OverlayVersion.status == "PUBLISHED", OverlayVersion.season.in_(["BOTH", season]), or_(and_(OverlayVersion.target_type=="CUSTOMER", OverlayVersion.target_id==spec.customer_id), and_(OverlayVersion.target_type=="SPEC", OverlayVersion.target_id==(spec.lineage_id or spec.id)))).all()
    selected = [r for r in rows if r.target_type == "CUSTOMER" and r.target_id == spec.customer_id or r.target_type == "SPEC" and r.target_id == (spec.lineage_id or spec.id)]
    selected.sort(key=lambda r: (0 if r.target_type == "CUSTOMER" else 1, 0 if r.season == "BOTH" else 1))
    return [{"id": str(r.id), "version": r.version, "rows": r.rules, "parent_fingerprint":r.parent_fingerprint} for r in selected]


def spec_values(spec, db):
    data = _serialize_spec(spec)
    data["mandrel_diameter_mm"] = spec.mandrel_diameter_mm
    length = calculate_yield(str(spec.id), None, db)
    data["selected_bamboo_length_mm"] = length.get("selected_bamboo_length_mm") or length.get("bamboo_max_length_mm")
    dynamic = _dynamic_field_map(spec)
    if not data["selected_bamboo_length_mm"]:
        profile = data.get("profile") or {}
        data["selected_bamboo_length_mm"] = (profile.get("manufacturing") or {}).get("selected_bamboo_length_mm") or dynamic.get("selected_bamboo_length_mm")
    return data


def resolved(db, spec, season, rules=None):
    row = rules or published_rules(db, season)
    dynamic = _dynamic_field_map(spec)
    overlays=overlays_for(db,spec,season)
    profile=resolve_profile(spec_values(spec, db), row.rules, overlays, season=season, provenance={"rule_set_id": str(row.id), "rule_set_version": row.version, "overlays":[{"id":o["id"],"version":o["version"]} for o in overlays]}, notching=bool(dynamic.get("notch_type") or dynamic.get("notch_depth_mm")))
    for overlay in overlays:
        stored=db.get(OverlayVersion,uuid.UUID(overlay["id"]))
        try:
            parent=overlay_parent_basis(db,stored)
        except HTTPException:
            parent=None
        if stored.parent_fingerprint!=parent:
            profile["conflicts"].append({"overlay_id":overlay["id"],"message":"Overlay parent changed; publish a reviewed revision"})
    profile["fingerprint"]=fingerprint({k:v for k,v in profile.items() if k!="fingerprint"})
    return profile


def overlay_parent_basis(db,row):
    seasons=[s for s in SEASONS if row.season in (s,"BOTH")]
    parents=[]
    for season in seasons:
        base=published_rules(db,season)
        # Stable ordered parent heads: global, customer general, customer season,
        # spec general. Exclude this scope and all later precedence levels.
        heads=db.query(OverlayVersion).filter_by(plant_id=row.plant_id,status="PUBLISHED").all()
        affected=db.query(SpecificationSheet).filter_by(plant_id=row.plant_id,active=True)
        affected=affected.filter(SpecificationSheet.customer_id==row.target_id) if row.target_type=="CUSTOMER" else affected.filter(SpecificationSheet.lineage_id==row.target_id)
        customer_ids={s.customer_id for s in affected.all()}
        relevant=[]
        for head in heads:
            if head.target_type==row.target_type and head.target_id==row.target_id and head.season==row.season:continue
            if row.target_type=="CUSTOMER":
                include=head.target_type=="CUSTOMER" and head.target_id==row.target_id and row.season!="BOTH" and head.season=="BOTH"
            else:
                include=head.target_type=="CUSTOMER" and head.target_id in customer_ids and head.season in ("BOTH",season) or head.target_type=="SPEC" and head.target_id==row.target_id and row.season!="BOTH" and head.season=="BOTH"
            if include:relevant.append((str(head.id),head.fingerprint))
        parents.append((season,base.fingerprint,sorted(relevant)))
    return fingerprint(parents)


def load_spec(db, spec_id, plant_id, lock=False):
    query = db.query(SpecificationSheet).filter_by(id=spec_id, plant_id=plant_id)
    if lock:
        query = query.with_for_update()
    spec = query.first()
    if not spec:
        raise HTTPException(404, "Specification not found")
    return spec


def recipe_content_hash(layers,rows,notes):
    # Geometry and calculated mass belong to the specification revision, not
    # the independently versioned paper selection. Freeze master labels too.
    return fingerprint({"layers":layers,"rows":[{k:r.get(k) for k in ("paper_id","code","variety","gsm","bfPerPly","bulkFactor","plyCount","positionsText")} for r in rows],"notes":notes})


def recipe_hash(recipe):
    return recipe_content_hash([{"ply_no": l.ply_no, "paper_id": str(l.paper_id), "gsm_snapshot": l.gsm_snapshot, "bf_snapshot": l.bf_snapshot, "bulk_snapshot": l.bulk_snapshot} for l in sorted(recipe.layers, key=lambda l: l.ply_no)],recipe.sheet_rows or [],recipe.notes)


def recipe_dict(recipe):
    return {"id": str(recipe.id), "season": recipe.season, "season_revision": recipe.season_revision, "version": recipe.version, "status": recipe.status, "row_version": recipe.row_version, "content_hash": recipe.content_hash, "notes": recipe.notes, "change_note": recipe.change_note, "created_by": recipe.created_by, "created_at": recipe.created_at, "approved_by": recipe.approved_by, "sheet_rows": recipe.sheet_rows or [], "layers": [{"ply_no": l.ply_no, "paper_id": str(l.paper_id), "gsm_snapshot": l.gsm_snapshot, "bf_snapshot": l.bf_snapshot, "bulk_snapshot": l.bulk_snapshot} for l in sorted(recipe.layers, key=lambda l: l.ply_no)]}


def confirmation_hash(spec, recipe):
    return fingerprint({"content": recipe.content_hash, "spec_revision": spec.write_revision, "mandrel": spec.mandrel_diameter_mm})


def document_dict(db, spec):
    recipes = {}
    for binding in db.query(RecipeBinding).filter_by(spec_id=spec.id).all():
        recipe = db.get(RecipeHeader, binding.recipe_id)
        draft = db.get(RecipeHeader, binding.draft_recipe_id) if binding.draft_recipe_id else None
        confirmed=binding.confirmed_hash == confirmation_hash(spec, draft or recipe) or (not draft and binding.approved and binding.approved_context == confirmation_hash(spec,recipe))
        recipes[binding.season] = {**recipe_dict(recipe), "confirmed": confirmed, "approved": binding.approved, "draft": recipe_dict(draft) if draft else None}
    return {"spec": {**_serialize_spec(spec), "seasonal_model": spec.seasonal_model, "lineage_id": str(spec.lineage_id or spec.id)}, "recipes": recipes}


def recipe_blockers(recipe, db, spec=None):
    problems = []
    distinct = len({l.paper_id for l in recipe.layers})
    if not spec_math.RECIPE_MIN_PAPERS <= distinct <= spec_math.RECIPE_MAX_PAPERS:
        problems.append(f"Select {spec_math.RECIPE_MIN_PAPERS}–{spec_math.RECIPE_MAX_PAPERS} distinct papers")
    if not 1 <= len(recipe.layers) <= spec_math.RECIPE_MAX_PLIES:
        problems.append("Invalid ply count")
    if not problems:
        current=spec or recipe.specification
        try:
            preview=spec_math.compute_preview(mandrel_od_mm=float(current.mandrel_diameter_mm or (float(current.id_min_mm)+float(current.id_max_mm))/2), tube_length_mm=(float(current.length_min_mm)+float(current.length_max_mm))/2, papers=[spec_math.RecipePaper(paper_id=str(l.paper_id),gsm=float(l.gsm_snapshot),bulk=float(l.bulk_snapshot or 1),ply_count=1) for l in sorted(recipe.layers,key=lambda l:l.ply_no)],target_dry_g=float(current.target_tube_weight),adhesive_percent=float(current.adhesive_percent),parchment_percent=float(current.parchment_percent or 0),moisture_loss_percent=float(current.moisture_loss_percent),parchment_allowed=bool(current.parchment_allowed))
            if not preview.validation.delta_ok:problems.append(f"Modelled dry-weight delta {preview.validation.delta_g:+.2f} g exceeds {spec_math.DELTA_ABS_G} g")
        except (ValueError,TypeError):problems.append("Recipe geometry is incomplete")
    return problems


def refresh_readiness(db):
    """Write-time projection; list filters and counts do not run recipe HTTP/math."""
    for spec in db.query(SpecificationSheet).filter_by(seasonal_model=True).options(selectinload(SpecificationSheet.dynamic_values)).all():
        bindings={b.season:b for b in db.query(RecipeBinding).filter_by(spec_id=spec.id).all()}
        for season in SEASONS:
            blockers=[];binding=bindings.get(season);recipe=db.get(RecipeHeader,binding.recipe_id) if binding else None
            confirmed=bool(recipe and binding.confirmed_hash==confirmation_hash(spec,recipe))
            if not spec.active or spec.status!="approved":blockers.append("Specification approval required")
            if not binding or not binding.approved:blockers.append("Season recipe approval required")
            if recipe:blockers.extend(recipe_blockers(recipe,db,spec))
            else:blockers.append("Recipe missing")
            if season=="MONSOON" and not confirmed and not (binding and binding.approved):blockers.append("Monsoon confirmation required")
            qc_ready=False
            try:
                profile=resolved(db,spec,season);qc_ready=not profile["unresolved"] and not profile["conflicts"]
                if not qc_ready:blockers.append("QC references or overlay approval need attention")
            except (HTTPException,ValueError,RuleError):blockers.append("Season QC rules are not ready")
            row=db.get(SpecReadiness,(spec.id,season))
            if not row:row=SpecReadiness(spec_id=spec.id,season=season);db.add(row)
            row.ready=not blockers;row.details={"recipe_revision":recipe.season_revision if recipe else None,"recipe_approved":bool(binding and binding.approved),"draft_pending":bool(binding and binding.draft_recipe_id),"confirmed":confirmed,"qc_ready":qc_ready,"blockers":blockers};row.updated_at=datetime.utcnow()


@router.get("/specs/summary")
def spec_summary(search:str="",status:str="all",view:str="active",season:str="ROY",readiness:str="all",customer_id:uuid.UUID|None=None,offset:int=Query(0,ge=0),limit:int=Query(25,ge=1,le=100),db:Session=Depends(get_db),scope:dict=Depends(get_current_plant_scope),user:dict=Depends(get_current_user)):
    season_key(season)
    query=apply_plant_scope(db.query(SpecificationSheet).outerjoin(SpecReadiness,and_(SpecReadiness.spec_id==SpecificationSheet.id,SpecReadiness.season==season)),SpecificationSheet.plant_id,scope)
    query=query.filter(SpecificationSheet.active==(view!="disabled"))
    if search.strip():
        term="%"+search.strip()+"%"
        query=query.filter(or_(SpecificationSheet.customer_name.ilike(term),SpecificationSheet.customer_name_snapshot.ilike(term),SpecificationSheet.tube_size_id.cast(__import__("sqlalchemy").String).ilike(term),SpecificationSheet.id.cast(__import__('sqlalchemy').String).ilike(term)))
    if customer_id:query=query.filter(SpecificationSheet.customer_id==customer_id)
    facets=dict(query.with_entities(SpecificationSheet.status,func.count(SpecificationSheet.id)).group_by(SpecificationSheet.status).all())
    if status!="all":query=query.filter(SpecificationSheet.status==status)
    if readiness=="ready":query=query.filter(SpecReadiness.ready==True)
    elif readiness=="blocked":query=query.filter(or_(SpecReadiness.ready==False,SpecReadiness.spec_id==None))
    total=query.count()
    rows=query.order_by(SpecificationSheet.updated_at.desc(),SpecificationSheet.id).offset(offset).limit(limit).all()
    projections={(r.spec_id,r.season):r for r in db.query(SpecReadiness).filter(SpecReadiness.spec_id.in_([r.id for r in rows])).all()}
    items=[]
    for spec in rows:
        seasons={s:({"ready":projections[(spec.id,s)].ready,**projections[(spec.id,s)].details} if (spec.id,s) in projections else {"ready":False,"blockers":["Seasonal configuration required"]}) for s in SEASONS}
        items.append({"id":str(spec.id),"plant_id":spec.plant_id,"customer_name":spec.customer_name_snapshot or spec.customer_name,"customer_id":str(spec.customer_id) if spec.customer_id else None,"tube_size_id":spec.tube_size_id,"version":spec.version,"status":spec.status,"write_revision":spec.write_revision,"updated_at":spec.updated_at,"required_cs":spec.required_cs,"target_tube_weight":spec.target_tube_weight,"id_min_mm":spec.id_min_mm,"id_max_mm":spec.id_max_mm,"od_min_mm":spec.od_min_mm,"od_max_mm":spec.od_max_mm,"length_min_mm":spec.length_min_mm,"length_max_mm":spec.length_max_mm,"seasonal_model":spec.seasonal_model,"seasons":seasons})
    return {"items":items,"total":total,"facets":facets,"offset":offset,"limit":limit,"season":season}


class BulkConfirm(Command):
    specifications:list[dict]=Field(min_length=1,max_length=100)


@router.post("/season/confirm-monsoon")
def bulk_confirm(payload:BulkConfirm,db:Session=Depends(get_db),plant:str=Depends(get_current_plant),user:dict=Depends(require_role(["Owner","Admin"]))):
    lock_state(db);key=f"bulk-confirm:{plant}:{payload.request_id}";prior=receipt(db,key,payload.model_dump())
    if prior:return prior
    result=[]
    for item in sorted(payload.specifications,key=lambda s:s["id"]):
        spec=load_spec(db,uuid.UUID(item["id"]),plant,True);version_check(spec.write_revision,item.get("expected_version"))
        binding=db.query(RecipeBinding).filter_by(spec_id=spec.id,season="MONSOON").first()
        if not binding:raise HTTPException(409,"Monsoon recipe missing")
        recipe=db.get(RecipeHeader,binding.draft_recipe_id or binding.recipe_id);blockers=recipe_blockers(recipe,db,spec)
        if blockers:raise HTTPException(409,{"spec_id":str(spec.id),"blockers":blockers})
        binding.confirmed_hash=confirmation_hash(spec,recipe);binding.confirmed_by=user["sub"];binding.confirmed_at=datetime.utcnow();result.append(str(spec.id))
    return complete(db,key,payload.model_dump(),{"confirmed":result},user,"monsoon_bulk_confirmed",payload.note)


@router.get("/season")
def read_season(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    row = db.get(SeasonState, "ORGANIZATION")
    return {"scope": "Both plants", "active_season": row.active_season if row else "ROY", "epoch": row.epoch if row else 0, "switched_by": row.switched_by if row else None, "switched_at": row.switched_at if row else None, "initialized": bool(row)}


@router.post("/season/bootstrap")
def bootstrap(payload: Command, db: Session = Depends(get_db), user: dict = Depends(require_role(["QC", "Admin", "Owner"]))):
    state = lock_state(db)
    key = f"bootstrap:{payload.request_id}"
    prior = receipt(db, key, payload.model_dump())
    if prior: return prior
    for season in SEASONS:
        if not db.query(RuleVersion).filter_by(season=season).first():
            rules = initial_rules()
            db.add(RuleVersion(season=season, version=1, status="DRAFT", rules=rules, fingerprint=fingerprint(rules), change_note="Client rules 2026-10-03; process ±0.2 mm and paired oven samples confirmed", created_by=user["sub"]))
    return complete(db, key, payload.model_dump(), {"initialized": True, "active_season": state.active_season, "epoch": state.epoch}, user, "season_initialized")


@router.get("/qc-rules")
def read_rules(season: str = "ROY", db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    season_key(season)
    rows = db.query(RuleVersion).filter_by(season=season).order_by(RuleVersion.version.desc()).limit(100).all()
    return {"season": season, "versions": [rule_dict(r) for r in rows], "published": next((rule_dict(r) for r in rows if r.status == "PUBLISHED"), None), "draft": next((rule_dict(r) for r in rows if r.status == "DRAFT"), None)}


@router.put("/qc-rules/draft")
def save_rules(payload: RuleDraft, season: str, db: Session = Depends(get_db), user: dict = Depends(require_role(["QC", "Admin", "Owner"]))):
    season_key(season); lock_state(db)
    key = f"rules:{season}:{payload.request_id}"
    prior = receipt(db, key, payload.model_dump())
    if prior: return prior
    rows = checked_rules(payload.rules)
    draft = db.query(RuleVersion).filter_by(season=season, status="DRAFT").first()
    if draft:
        version_check(draft.row_version, payload.expected_version)
        draft.rules, draft.fingerprint = rows, fingerprint(rows)
        draft.row_version += 1
        draft.change_note = payload.note
    else:
        head = db.query(func.max(RuleVersion.version)).filter_by(season=season).scalar() or 0
        draft = RuleVersion(season=season, version=head+1, rules=rows, fingerprint=fingerprint(rows), change_note=payload.note, created_by=user["sub"])
        db.add(draft); db.flush()
    return complete(db, key, payload.model_dump(), rule_dict(draft), user, "qc_rule_draft_saved", payload.note)


def impact(db, season, candidate):
    specs = db.query(SpecificationSheet).filter_by(active=True, seasonal_model=True).options(selectinload(SpecificationSheet.dynamic_values)).all()
    blocked = []
    for spec in specs:
        profile = resolved(db, spec, season, candidate)
        if profile["unresolved"] or profile["conflicts"]:
            blocked.append({"spec_id": str(spec.id), "customer": spec.customer_name, "plant_id": spec.plant_id, "unresolved": profile["unresolved"], "conflicts": profile["conflicts"]})
    return {"specs_checked": len(specs), "blocked_count": len(blocked), "blocked": blocked[:50]}


@router.post("/qc-rules/draft/impact")
def rule_impact(season: str, db: Session = Depends(get_db), user: dict = Depends(require_role(["QC", "Admin", "Owner"]))):
    season_key(season)
    draft = db.query(RuleVersion).filter_by(season=season, status="DRAFT").first()
    if not draft: raise HTTPException(404, "No draft")
    return impact(db, season, draft)


@router.post("/qc-rules/draft/publish")
def publish_rules(payload: Command, season: str, db: Session = Depends(get_db), user: dict = Depends(require_role(["QC", "Admin", "Owner"]))):
    season_key(season); lock_state(db)
    key = f"publish:{season}:{payload.request_id}"
    prior = receipt(db, key, payload.model_dump())
    if prior: return prior
    if not payload.note.strip(): raise HTTPException(422, "Publication change note is required")
    draft = db.query(RuleVersion).filter_by(season=season, status="DRAFT").first()
    if not draft: raise HTTPException(404, "No draft")
    version_check(draft.row_version, payload.expected_version)
    checked_rules(draft.rules)
    report = impact(db, season, draft)
    for old in db.query(RuleVersion).filter_by(season=season, status="PUBLISHED").all(): old.status = "SUPERSEDED"
    db.flush()
    draft.status = "PUBLISHED"; draft.published_at = datetime.utcnow(); draft.published_by = user["sub"]; draft.change_note = payload.note
    return complete(db, key, payload.model_dump(), {"published": rule_dict(draft), "impact": report}, user, "qc_rules_published", payload.note)


@router.get("/qc-overlays")
def read_overlays(db: Session = Depends(get_db), scope: dict = Depends(get_current_plant_scope), user: dict = Depends(get_current_user)):
    rows = apply_plant_scope(db.query(OverlayVersion), OverlayVersion.plant_id, scope).order_by(OverlayVersion.created_at.desc()).limit(200).all()
    return [{"id": str(r.id), "target_type": r.target_type, "target_id": str(r.target_id), "season": r.season, "version": r.version, "status": r.status, "rules": r.rules, "row_version": r.row_version, "reason": r.reason, "loosens": r.loosens, "published_by": r.published_by} for r in rows]


@router.put("/qc-overlays/draft")
def save_overlay(payload: OverlayDraft, db: Session = Depends(get_db), plant: str = Depends(get_current_plant), user: dict = Depends(require_role(["QC", "Admin", "Owner"]))):
    if payload.target_type not in ("CUSTOMER", "SPEC") or payload.season not in (*SEASONS, "BOTH"):
        raise HTTPException(422, "Invalid overlay scope")
    if not payload.note.strip(): raise HTTPException(422, "Customer/spec override reason is required")
    key=f"overlay:{plant}:{payload.request_id}"
    prior=receipt(db,key,payload.model_dump())
    if prior:return prior
    if payload.target_type == "SPEC":
        if not db.query(SpecificationSheet).filter(SpecificationSheet.plant_id == plant, SpecificationSheet.lineage_id == payload.target_id).first(): raise HTTPException(404, "Spec lineage not found in this plant")
    else:
        url = os.getenv("MASTERDATA_SERVICE_URL", "http://127.0.0.1:18002")
        try:response = httpx.get(f"{url}/master/customers/{payload.target_id}", headers={"Authorization": f"Bearer {user.get('token','')}", "X-Plant-ID": plant}, timeout=8)
        except httpx.HTTPError as exc:raise HTTPException(503,"Could not validate the selected customer") from exc
        if response.status_code != 200: raise HTTPException(404, "Customer not found in this plant")
    lock_state(db)
    key=f"overlay:{plant}:{payload.request_id}"; prior=receipt(db,key,payload.model_dump())
    if prior: return prior
    query = db.query(OverlayVersion).filter_by(plant_id=plant, target_type=payload.target_type, target_id=payload.target_id, season=payload.season)
    row = query.filter_by(status="DRAFT").first()
    rules=checked_rules(payload.rules, True)
    if row:
        version_check(row.row_version,payload.expected_version); row.row_version+=1; row.rules=rules; row.reason=payload.note; row.fingerprint=fingerprint(rules)
    else:
        row=OverlayVersion(plant_id=plant,target_type=payload.target_type,target_id=payload.target_id,season=payload.season,version=(query.with_entities(func.max(OverlayVersion.version)).scalar() or 0)+1,rules=rules,fingerprint=fingerprint(rules),reason=payload.note,created_by=user["sub"])
        db.add(row); db.flush()
    return complete(db,key,payload.model_dump(),{"id":str(row.id),"row_version":row.row_version},user,"qc_overlay_saved",payload.note)


@router.post("/qc-overlays/{overlay_id}/publish")
def publish_overlay(overlay_id: uuid.UUID, payload: Command, db: Session=Depends(get_db), plant: str=Depends(get_current_plant), user: dict=Depends(require_role(["QC","Admin","Owner"]))):
    lock_state(db); key=f"overlay-publish:{plant}:{payload.request_id}"; prior=receipt(db,key,payload.model_dump())
    if prior: return prior
    row=db.query(OverlayVersion).filter_by(id=overlay_id,plant_id=plant,status="DRAFT").first()
    if not row: raise HTTPException(404,"Draft overlay not found")
    version_check(row.row_version,payload.expected_version)
    parents=[published_rules(db,s) for s in SEASONS if row.season in (s,"BOTH")]
    parent_rows=[p.rules for p in parents]
    for head in db.query(OverlayVersion).filter_by(plant_id=plant,status="PUBLISHED").all():
        if head.id!=row.id and (head.target_id==row.target_id or row.target_type=="SPEC" and head.target_type=="CUSTOMER"):
            parent_rows.append(head.rules)
    row.loosens=any(potentially_loosens(p,row.rules) for p in parent_rows)
    if row.loosens and not ({"Owner","Admin"}&set(user.get("roles",[]))): raise HTTPException(403,"Potentially loosening overrides require Owner/Admin approval")
    for old in db.query(OverlayVersion).filter_by(plant_id=plant,target_type=row.target_type,target_id=row.target_id,season=row.season,status="PUBLISHED").all(): old.status="SUPERSEDED"
    db.flush(); row.status="PUBLISHED"; row.parent_fingerprint=overlay_parent_basis(db,row); row.published_by=user["sub"]; row.published_at=datetime.utcnow()
    return complete(db,key,payload.model_dump(),{"id":str(row.id),"status":row.status,"loosens":row.loosens},user,"qc_overlay_published",payload.note)


@router.get("/specs/{spec_id}/qc-resolved")
def read_resolved(spec_id: uuid.UUID, season: str="ROY", db: Session=Depends(get_db), plant: dict=Depends(get_current_plant_scope), user: dict=Depends(get_current_user)):
    return resolved(db,load_visible_spec(db,spec_id,plant),season_key(season))


@router.get("/specs/{spec_id}/season-document")
def read_document(spec_id: uuid.UUID, db: Session=Depends(get_db), plant: dict=Depends(get_current_plant_scope), user: dict=Depends(get_current_user)):
    return document_dict(db,load_visible_spec(db,spec_id,plant))


def load_visible_spec(db,spec_id,plant):
    if not isinstance(plant,dict):return load_spec(db,spec_id,plant)
    spec=apply_plant_scope(db.query(SpecificationSheet).filter_by(id=spec_id),SpecificationSheet.plant_id,plant).first()
    if not spec:raise HTTPException(404,'Specification not found')
    return spec


def master_mandrel(data, user, plant):
    url=os.getenv("MASTERDATA_SERVICE_URL","http://127.0.0.1:18002")
    try:
        r=httpx.get(f"{url}/master/mandrels/{data['mandrel_id']}",headers={"Authorization":f"Bearer {user.get('token','')}","X-Plant-ID":plant},timeout=8)
        r.raise_for_status(); diameter=float(r.json()["outer_diameter_mm"])
    except (httpx.HTTPError,ValueError,KeyError,TypeError) as exc:
        raise HTTPException(503,"Could not validate the selected mandrel from masterdata") from exc
    if diameter<=0: raise HTTPException(422,"Mandrel diameter must be positive")
    return diameter


def fill_layers(recipe, layers, plant):
    if len(layers)>spec_math.RECIPE_MAX_PLIES: raise HTTPException(422,"Too many plies")
    positions=[int(l.get("ply_no",0)) for l in layers]
    if len(positions)!=len(set(positions)) or any(p<1 or p>spec_math.RECIPE_MAX_PLIES for p in positions): raise HTTPException(422,"Invalid or duplicate ply positions")
    recipe.layers.clear()
    for layer in layers:
        try:
            gsm=float(layer["gsm_snapshot"]); bf=float(layer["bf_snapshot"]); bulk=float(layer.get("bulk_snapshot") or 1)
            if not all(0<v<100000 for v in (gsm,bf,bulk)): raise ValueError()
            recipe.layers.append(RecipeLayer(plant_id=plant,ply_no=int(layer["ply_no"]),paper_id=uuid.UUID(str(layer["paper_id"])),gsm_snapshot=gsm,bf_snapshot=bf,bulk_snapshot=bulk))
        except (KeyError,ValueError,TypeError) as exc: raise HTTPException(422,"Invalid recipe layer") from exc


def canonical_recipe_rows(spec,layers,papers):
    """Freeze readable recipe rows from validated layers and authoritative math."""
    if not layers:return []
    ordered=sorted(layers,key=lambda l:int(l['ply_no']))
    try:
        length=(float(spec.length_min_mm)+float(spec.length_max_mm))/2
        preview=spec_math.compute_preview(mandrel_od_mm=float(spec.mandrel_diameter_mm),tube_length_mm=length,papers=[spec_math.RecipePaper(paper_id=str(l['paper_id']),gsm=float(l['gsm_snapshot']),bulk=float(l.get('bulk_snapshot') or 1),ply_count=1) for l in ordered],target_dry_g=float(spec.target_tube_weight),adhesive_percent=float(spec.adhesive_percent),parchment_percent=float(spec.parchment_percent or 0),moisture_loss_percent=float(spec.moisture_loss_percent),parchment_allowed=bool(spec.parchment_allowed))
    except (ValueError,TypeError,KeyError) as exc:raise HTTPException(422,"Recipe geometry is incomplete") from exc
    grouped={}
    for index,layer in enumerate(ordered):
        paper=papers.get(str(layer['paper_id']),{})
        key=(str(layer['paper_id']),float(layer['gsm_snapshot']),float(layer['bf_snapshot']),float(layer.get('bulk_snapshot') or 1))
        if key not in grouped:grouped[key]={"id":"paper-"+key[0],"paper_id":key[0],"code":paper.get('code') or paper.get('paper_code') or key[0],"variety":paper.get('variety') or 'Paper',"gsm":key[1],"bfPerPly":key[2],"bulkFactor":key[3],"thicknessPerPly":preview.per_ply_thickness_mm[index],"plyCount":0,"positions":[],"weightAllPly":0.0}
        row=grouped[key];row['plyCount']+=1;row['positions'].append(layer['ply_no']);row['weightAllPly']+=preview.target_per_ply_weight_per_mm_g[index]*length
    for row in grouped.values():
        row['positionsText']=','.join(str(p) for p in row.pop('positions'));row['weightAllPly']=round(row['weightAllPly'],6);row['weightPerPly']=row['weightAllPly']/row['plyCount']
    return list(grouped.values())


def new_recipe(db,spec,season,layers,rows,user,note,predecessor=None):
    version=(db.query(func.max(RecipeHeader.version)).filter_by(spec_id=spec.id).scalar() or 0)+1
    revision=(db.query(func.max(RecipeHeader.season_revision)).filter_by(lineage_id=spec.lineage_id,season=season).scalar() or 0)+1
    rows=canonical_recipe_rows(spec,layers,db.info.get('season_papers',{}))
    recipe=RecipeHeader(spec_id=spec.id,plant_id=spec.plant_id,version=version,season=season,lineage_id=spec.lineage_id,season_revision=revision,predecessor_id=predecessor.id if predecessor else None,status="trial",notes=note,change_note=note,sheet_rows=rows,created_by=user["sub"])
    fill_layers(recipe,layers,spec.plant_id); db.add(recipe); db.flush(); recipe.content_hash=recipe_hash(recipe)
    return recipe


def save_document_command(payload, db, plant, user, spec_id=None):
    key=f"document:{plant}:{payload.request_id}"
    prior=receipt(db,key,payload.model_dump())
    if prior: return prior
    if set(payload.recipes)-set(SEASONS):raise HTTPException(422,"Unknown recipe season")
    data=payload.spec.copy(); data.pop("save_operation_key",None); expected=data.pop("expected_revision",None) or payload.expected_version
    base=SpecUpdate(**data) if spec_id else SpecCreate(**data)
    _validate_recipe_profile_limits(base); merge_canonical_into_payload(base)
    diameter=master_mandrel(data,user,plant)
    url=os.getenv("MASTERDATA_SERVICE_URL","http://127.0.0.1:18002")
    requested={str(l.get("paper_id")) for patch in payload.recipes.values() for l in patch.get("layers",[])}
    if requested:
        try:
            response=httpx.get(f"{url}/master/papers/",headers={"Authorization":f"Bearer {user.get('token','')}","X-Plant-ID":plant},timeout=8);response.raise_for_status()
            db.info['season_papers']={str(row['id']):row for row in response.json() if row.get('active',row.get('is_active',True))}
            valid=set(db.info['season_papers'])
        except (httpx.HTTPError,ValueError,TypeError) as exc:raise HTTPException(503,"Could not verify paper selections") from exc
        if not requested<=valid:raise HTTPException(422,"Select active papers from this plant")
    previous=load_spec(db,spec_id,plant) if spec_id else None
    if previous and previous.status!="draft": _enforce_live_spec_edit_lock(previous,user,plant)
    lock_state(db); key=f"document:{plant}:{payload.request_id}"; prior=receipt(db,key,payload.model_dump())
    if prior: return prior
    if previous:
        previous=load_spec(db,spec_id,plant,True); version_check(previous.write_revision,expected)
        if previous.status=="review": raise HTTPException(409,"Return spec to draft before editing")
        if previous.status=="draft":
            spec=previous
            for k,v in base.model_dump(exclude_unset=True).items():
                if k in SpecificationSheet.__table__.columns and k not in ("status","id","plant_id","version","write_revision"):
                    setattr(spec,k,uuid.UUID(v) if k=="customer_id" and v else v)
            spec.write_revision+=1
        else:
            spec=_replacement_spec_from_payload(previous=previous,payload=base,plant_id=plant,current_user=user)
            spec.lineage_id=previous.lineage_id or previous.id; spec.supersedes_spec_id=previous.id; previous.active=False; previous.status="obsolete"; db.add(spec)
    else:
        values={k:v for k,v in base.model_dump().items() if k in SpecificationSheet.__table__.columns}
        values["customer_id"]=uuid.UUID(str(values["customer_id"])) if values.get("customer_id") else None
        values["customer_name"]=str(values.get("customer_name") or values.get("customer_name_snapshot") or "").strip()
        if not values["customer_name"]: raise HTTPException(422,"Customer is required")
        spec=SpecificationSheet(**values,plant_id=plant,created_by=user["sub"]); db.add(spec)
    spec.updated_at=datetime.utcnow();spec.seasonal_model=True; spec.mandrel_diameter_mm=diameter; db.flush(); spec.lineage_id=spec.lineage_id or spec.id
    dynamic=base.dynamic_fields
    if previous and spec.id!=previous.id: dynamic=_merged_dynamic_fields_for_replacement(previous,dynamic)
    _upsert_dynamic_values(spec.id,dynamic,plant,db); _upsert_compat_dynamic_values(spec.id,_compat_dynamic_values_from_payload(base),plant_id=plant,db=db)
    for season in SEASONS:
        patch=payload.recipes.get(season)
        binding=db.query(RecipeBinding).filter_by(spec_id=spec.id,season=season).first()
        if not binding and previous and spec.id!=previous.id:
            old=db.query(RecipeBinding).filter_by(spec_id=previous.id,season=season).first()
            if old: binding=RecipeBinding(spec_id=spec.id,plant_id=plant,season=season,recipe_id=old.recipe_id); db.add(binding)
        if not binding:
            source=patch or payload.recipes.get("ROY") or {}
            recipe=new_recipe(db,spec,season,source.get("layers",[]),source.get("sheet_rows",[]),user,source.get("notes") or payload.note)
            if season=="MONSOON":
                original=db.query(RecipeBinding).filter_by(spec_id=spec.id,season="ROY").first()
                if original and recipe.content_hash==db.get(RecipeHeader,original.recipe_id).content_hash:recipe.copied_from_id=original.recipe_id
            binding=RecipeBinding(spec_id=spec.id,plant_id=plant,season=season,recipe_id=recipe.id); db.add(binding)
        elif patch:
            patch={**patch,'sheet_rows':canonical_recipe_rows(spec,patch.get('layers',[]),db.info.get('season_papers',{}))}
            recipe=db.get(RecipeHeader,binding.recipe_id)
            candidate=recipe_content_hash([{"ply_no":int(l["ply_no"]),"paper_id":str(l["paper_id"]),"gsm_snapshot":float(l["gsm_snapshot"]),"bf_snapshot":float(l["bf_snapshot"]),"bulk_snapshot":float(l.get("bulk_snapshot") or 1)} for l in sorted(patch.get("layers",[]),key=lambda l:int(l["ply_no"]))],patch.get("sheet_rows",[]),patch.get("notes",recipe.notes))
            if candidate!=recipe.content_hash:
                if recipe.status!="trial":
                    recipe=new_recipe(db,spec,season,patch.get("layers",[]),patch.get("sheet_rows",[]),user,patch.get("notes",recipe.notes),recipe); binding.recipe_id=recipe.id
                else:
                    recipe.layers.clear();db.flush()
                    fill_layers(recipe,patch.get("layers",[]),plant); recipe.sheet_rows=patch.get("sheet_rows",[]); recipe.notes=patch.get("notes",recipe.notes); recipe.row_version+=1; db.flush(); recipe.content_hash=recipe_hash(recipe)
        else: recipe=db.get(RecipeHeader,binding.recipe_id)
        binding.approved=False
        if patch and patch.get("confirm"):
            binding.confirmed_hash=confirmation_hash(spec,recipe); binding.confirmed_by=user["sub"]; binding.confirmed_at=datetime.utcnow()
    db.flush()
    if payload.trial:
        roy=db.query(RecipeBinding).filter_by(spec_id=spec.id,season="ROY").one()
        fields={k:v for k,v in payload.trial.items() if k in ("actual_cs","actual_weight","actual_shrink","remarks")}
        db.add(TrialResult(recipe_id=roy.recipe_id,plant_id=plant,**fields))
    return complete(db,key,payload.model_dump(),document_dict(db,spec),user,"spec_document_saved",payload.note)


@router.post("/specs/document")
def create_document(payload: Document, db: Session=Depends(get_db), plant: str=Depends(get_current_plant), user: dict=Depends(require_role(["Owner","Admin"]))):
    return save_document_command(payload,db,plant,user)


@router.put("/specs/{spec_id}/document")
def update_document(spec_id: uuid.UUID,payload: Document, db: Session=Depends(get_db), plant: str=Depends(get_current_plant), user: dict=Depends(require_role(["Owner","Admin"]))):
    return save_document_command(payload,db,plant,user,spec_id)


@router.post("/specs/{spec_id}/recipes/{season}/confirm")
def confirm_recipe(spec_id: uuid.UUID,season: str,payload: Command,db: Session=Depends(get_db),plant: str=Depends(get_current_plant),user: dict=Depends(require_role(["Owner","Admin"]))):
    season_key(season);lock_state(db); key=f"confirm:{plant}:{spec_id}:{season}:{payload.request_id}"; prior=receipt(db,key,payload.model_dump())
    if prior:return prior
    spec=load_spec(db,spec_id,plant,True);version_check(spec.write_revision,payload.expected_version)
    binding=db.query(RecipeBinding).filter_by(spec_id=spec.id,season=season).one(); recipe=db.get(RecipeHeader,binding.draft_recipe_id or binding.recipe_id)
    errors=recipe_blockers(recipe,db,spec)
    if errors: raise HTTPException(409,{"code":"RECIPE_NOT_READY","blockers":errors})
    binding.confirmed_hash=confirmation_hash(spec,recipe);binding.confirmed_by=user["sub"];binding.confirmed_at=datetime.utcnow()
    return complete(db,key,payload.model_dump(),document_dict(db,spec),user,"season_recipe_confirmed",payload.note)


def common_release_blockers(spec):
    dynamic = _dynamic_field_map(spec)
    blockers=[]
    for name in ("valid_upto", "prepared_by", "prepared_date", "sign_off_note"):
        if not str(dynamic.get(name) or "").strip(): blockers.append(f"Release footer: {name} required")
    for name in ("valid_upto","prepared_date"):
        try:
            value=date.fromisoformat(str(dynamic.get(name) or ''))
            if name=='valid_upto' and value<date.today():blockers.append('Specification validity has expired')
            if name=='prepared_date' and value>date.today():blockers.append('Prepared date cannot be in the future')
        except ValueError:blockers.append(f'Release footer: {name} must be a valid date')
    try:
        adhesives=json.loads(dynamic.get("adhesive_components_json") or "[]")
        if not 1<=len(adhesives)<=6 or abs(sum(float(c.get("ratio_percent") or 0) for c in adhesives)-100)>.01: blockers.append("Adhesive ratios must total 100% with 1–6 components")
    except (ValueError,TypeError,AttributeError): blockers.append("Adhesive recipe is invalid")
    additions=float(spec.adhesive_percent or 0)
    if additions<=0 or spec.parchment_allowed and float(spec.parchment_percent or 0)>additions:blockers.append("Par­chment share cannot exceed total additions")
    return blockers


def seasonal_blockers(db,spec):
    blockers=common_release_blockers(spec)
    for season in SEASONS:
        binding=db.query(RecipeBinding).filter_by(spec_id=spec.id,season=season).first()
        if not binding: blockers.append(f"{season}: recipe missing");continue
        recipe=db.get(RecipeHeader,binding.recipe_id)
        blockers += [f"{season}: {b}" for b in recipe_blockers(recipe,db,spec)]
        if season=="MONSOON" and binding.confirmed_hash!=confirmation_hash(spec,recipe): blockers.append("MONSOON: recipe confirmation required")
        try:
            profile=resolved(db,spec,season)
            if profile["unresolved"] or profile["conflicts"]: blockers.append(f"{season}: QC references unresolved or conflicting")
        except HTTPException as exc: blockers.append(f"{season}: {exc.detail}")
    return blockers


@router.post("/specs/{spec_id}/season-review")
def review_spec(spec_id: uuid.UUID,payload: Command,db: Session=Depends(get_db),plant: str=Depends(get_current_plant),user: dict=Depends(require_role(["Owner","Admin"]))):
    lock_state(db);key=f"review:{plant}:{payload.request_id}";prior=receipt(db,key,payload.model_dump())
    if prior:return prior
    spec=load_spec(db,spec_id,plant,True);version_check(spec.write_revision,payload.expected_version)
    if spec.status!="draft":raise HTTPException(409,"Only drafts can enter review")
    blockers=seasonal_blockers(db,spec)
    if blockers:raise HTTPException(409,{"code":"SPEC_NOT_READY","blockers":blockers})
    spec.status="review"
    return complete(db,key,payload.model_dump(),document_dict(db,spec),user,"season_spec_review_requested",payload.note)


@router.post("/specs/{spec_id}/season-approve")
def approve_spec(spec_id: uuid.UUID,payload: Command,db: Session=Depends(get_db),plant: str=Depends(get_current_plant),user: dict=Depends(require_role(["Owner","Admin"]))):
    lock_state(db);key=f"approve:{plant}:{payload.request_id}";prior=receipt(db,key,payload.model_dump())
    if prior:return prior
    spec=load_spec(db,spec_id,plant,True);version_check(spec.write_revision,payload.expected_version)
    if spec.status!="review":raise HTTPException(409,"Spec must be in review")
    blockers=seasonal_blockers(db,spec)
    if blockers:raise HTTPException(409,{"code":"SPEC_NOT_READY","blockers":blockers})
    duplicate=db.query(SpecificationSheet).filter(SpecificationSheet.id!=spec.id,SpecificationSheet.active==True,SpecificationSheet.plant_id==plant,SpecificationSheet.customer_id==spec.customer_id,SpecificationSheet.tube_size_id==spec.tube_size_id,SpecificationSheet.required_cs==spec.required_cs,SpecificationSheet.target_tube_weight==spec.target_tube_weight,SpecificationSheet.status=="approved").first()
    if duplicate:raise HTTPException(409,"An approved specification already has this customer/size/weight/CS key")
    for binding in db.query(RecipeBinding).filter_by(spec_id=spec.id).all():
        recipe=db.get(RecipeHeader,binding.recipe_id); recipe.status="approved";recipe.approved_by=user["sub"];binding.approved=True;binding.approved_context=confirmation_hash(spec,recipe)
    spec.status="approved";spec.approved_by=user["sub"]
    roy=db.query(RecipeBinding).filter_by(spec_id=spec.id,season="ROY").one()
    trial=db.query(TrialResult).filter_by(recipe_id=roy.recipe_id,approved=True).order_by(TrialResult.tested_at.desc()).first()
    spec.approved_cs=float(trial.actual_cs) if trial and trial.actual_cs is not None else spec.required_cs
    return complete(db,key,payload.model_dump(),document_dict(db,spec),user,"season_spec_approved",payload.note)


@router.get("/specs/{spec_id}/recipes/{season}/history")
def recipe_history(spec_id: uuid.UUID,season: str,db: Session=Depends(get_db),plant: str=Depends(get_current_plant),user: dict=Depends(get_current_user)):
    spec=load_spec(db,spec_id,plant);season_key(season)
    rows=db.query(RecipeHeader).filter_by(lineage_id=spec.lineage_id,season=season).order_by(RecipeHeader.season_revision.desc()).limit(100).all()
    return [recipe_dict(r) for r in rows]


@router.put("/specs/{spec_id}/recipes/{season}/revision")
def save_revision(spec_id: uuid.UUID,season: str,payload: RecipeEdit,db: Session=Depends(get_db),plant: str=Depends(get_current_plant),user: dict=Depends(require_role(["Owner","Admin"]))):
    season_key(season);key=f"recipe-revision:{plant}:{payload.request_id}";prior=receipt(db,key,payload.model_dump())
    if prior:return prior
    try:
        response=httpx.get(f"{os.getenv('MASTERDATA_SERVICE_URL','http://127.0.0.1:18002')}/master/papers/",headers={"Authorization":f"Bearer {user.get('token','')}","X-Plant-ID":plant},timeout=8)
        response.raise_for_status();db.info['season_papers']={str(p['id']):p for p in response.json() if p.get('active',True)};active=set(db.info['season_papers'])
    except (httpx.HTTPError,ValueError) as exc:raise HTTPException(503,"Could not validate recipe papers") from exc
    if any(str(layer.get('paper_id')) not in active for layer in payload.layers):raise HTTPException(422,"Recipe paper must be active in this plant")
    lock_state(db);prior=receipt(db,key,payload.model_dump())
    if prior:return prior
    if not payload.note.strip():raise HTTPException(422,"Revision change note is required")
    spec=load_spec(db,spec_id,plant,True)
    if spec.status!="approved":raise HTTPException(409,"Use document save for draft spec recipes")
    binding=db.query(RecipeBinding).filter_by(spec_id=spec.id,season=season).one(); current=db.get(RecipeHeader,binding.draft_recipe_id or binding.recipe_id)
    version_check(current.row_version,payload.expected_version)
    if binding.draft_recipe_id:
        recipe=current;recipe.layers.clear();db.flush();fill_layers(recipe,payload.layers,plant);recipe.sheet_rows=canonical_recipe_rows(spec,payload.layers,db.info.get('season_papers',{}));recipe.notes=payload.note;recipe.change_note=payload.note;recipe.row_version+=1;db.flush();recipe.content_hash=recipe_hash(recipe)
    else:
        recipe=new_recipe(db,spec,season,payload.layers,payload.sheet_rows,user,payload.note,current);binding.draft_recipe_id=recipe.id
    binding.confirmed_hash=confirmation_hash(spec,recipe) if payload.confirm else None
    return complete(db,key,payload.model_dump(),document_dict(db,spec),user,"season_recipe_revision_saved",payload.note)


@router.post("/specs/{spec_id}/recipes/{season}/approve")
def approve_revision(spec_id: uuid.UUID,season: str,payload: Command,db: Session=Depends(get_db),plant: str=Depends(get_current_plant),user: dict=Depends(require_role(["Owner","Admin"]))):
    season_key(season);lock_state(db);key=f"recipe-approve:{plant}:{payload.request_id}";prior=receipt(db,key,payload.model_dump())
    if prior:return prior
    spec=load_spec(db,spec_id,plant,True);binding=db.query(RecipeBinding).filter_by(spec_id=spec.id,season=season).one()
    if not binding.draft_recipe_id:raise HTTPException(409,"No open recipe revision")
    recipe=db.get(RecipeHeader,binding.draft_recipe_id);version_check(recipe.row_version,payload.expected_version)
    errors=recipe_blockers(recipe,db,spec)
    if binding.confirmed_hash!=confirmation_hash(spec,recipe):errors.append("Confirm the current recipe revision")
    profile=resolved(db,spec,season)
    if profile["unresolved"] or profile["conflicts"]:errors.append("QC profile is unresolved/conflicting")
    if errors:raise HTTPException(409,{"code":"RECIPE_NOT_READY","blockers":errors})
    recipe.status="approved";recipe.approved_by=user["sub"];binding.recipe_id=recipe.id;binding.draft_recipe_id=None;binding.approved=True;binding.approved_context=confirmation_hash(spec,recipe)
    return complete(db,key,payload.model_dump(),document_dict(db,spec),user,"season_recipe_revision_approved",payload.note)


def global_owner(user):
    allowed={str(v).upper() for v in user.get("allowed_plants",[])}
    a=bool(allowed&{"PLANT_A","00000000-0000-0000-0000-0000000000A1"})
    b=bool(allowed&{"PLANT_B","00000000-0000-0000-0000-0000000000B2"})
    if "Owner" not in user.get("roles",[]) or not(a and b):raise HTTPException(403,"Global Owner capability with both plants is required")


def switch_preview(db,to):
    state=db.get(SeasonState,"ORGANIZATION");blocked=[];ready=0;basis=[]
    for spec in db.query(SpecificationSheet).filter_by(active=True,status="approved").all():
        binding=db.query(RecipeBinding).filter_by(spec_id=spec.id,season=to,approved=True).first()
        problems=[]
        if not binding:problems.append("Approved season recipe missing")
        try:
            profile=resolved(db,spec,to)
            basis.append((str(spec.id),spec.write_revision,str(binding.recipe_id) if binding else None,db.get(RecipeHeader,binding.recipe_id).content_hash if binding else None,profile["fingerprint"]))
            if profile["unresolved"] or profile["conflicts"]:problems.append("QC references unresolved/conflicting")
        except HTTPException:problems.append("QC rules not published")
        if problems:blocked.append({"spec_id":str(spec.id),"customer":spec.customer_name,"plant_id":spec.plant_id,"blockers":problems})
        else:ready+=1
    authorizations=db.query(ReleaseAuthorization.status,ReleaseAuthorization.season,func.count(ReleaseAuthorization.id)).group_by(ReleaseAuthorization.status,ReleaseAuthorization.season).all()
    result={"to":to,"epoch":state.epoch if state else 0,"ready":ready,"blocked_count":len(blocked),"blocked":blocked[:50],"pending_authorizations":sum(n for status,season,n in authorizations if status=="AUTHORIZED"),"released_cards":sum(n for status,season,n in authorizations if status=="COMMITTED"),"frozen_releases":[{"status":status,"season":season,"count":n} for status,season,n in authorizations]}
    result["fingerprint"]=fingerprint({**result,"all_blocked":blocked,"basis":sorted(basis),"configuration":[(str(r.id),r.fingerprint) for r in db.query(RuleVersion).filter_by(status="PUBLISHED").order_by(RuleVersion.id).all()]});return result


@router.post("/season/switch/preview")
def preview_switch(body: dict,db: Session=Depends(get_db),user: dict=Depends(require_role(["Owner"]))):
    global_owner(user)
    return switch_preview(db,season_key(body.get("to")))


@router.post("/season/switch")
def switch_season(payload: Switch,db: Session=Depends(get_db),user: dict=Depends(require_role(["Owner"]))):
    global_owner(user)
    season_key(payload.to);state=lock_state(db);key=f"switch:{payload.request_id}";prior=receipt(db,key,payload.model_dump())
    if prior:return prior
    version_check(state.epoch,payload.expected_version)
    if not payload.note.strip():raise HTTPException(422,"Season switch note is required")
    preview=switch_preview(db,payload.to)
    if preview["fingerprint"]!=payload.preview_fingerprint:raise HTTPException(409,"Season preview changed; review it again")
    if preview["blocked_count"] and not payload.acknowledge_blocked:raise HTTPException(409,"Acknowledge that listed specifications cannot release until their seasonal setup is ready")
    state.active_season=payload.to;state.epoch+=1;state.switched_by=user["sub"];state.switched_at=datetime.utcnow()
    return complete(db,key,payload.model_dump(),{"active_season":state.active_season,"epoch":state.epoch,"preview":preview},user,"production_season_switched",payload.note)


@router.get("/season/history")
def season_history(db: Session=Depends(get_db),user: dict=Depends(require_role(["Owner"]))):
    global_owner(user)
    return [{"action":r.action,"actor":r.actor,"note":r.note,"payload":r.payload,"created_at":r.created_at} for r in db.query(SeasonEvent).filter(SeasonEvent.action.in_(["production_season_switched","season_initialized"])).order_by(SeasonEvent.created_at.desc()).limit(100).all()]


@router.get("/season/release-authorizations")
def pending_release_bundles(db:Session=Depends(get_db),plant:str=Depends(get_current_plant),user:dict=Depends(get_current_user)):
    return [{"id":str(a.id),"operation_key":a.operation_key,"bundle":a.bundle,"status":a.status,"bundle_hash":a.bundle_hash} for a in db.query(ReleaseAuthorization).filter_by(plant_id=plant,status="AUTHORIZED").all()]


@router.post("/season/release-authorizations/{authorization_id}/acknowledge")
def acknowledge_release(authorization_id:uuid.UUID,payload:AuthorizationAck,db:Session=Depends(get_db),plant:str=Depends(get_current_plant),user:dict=Depends(get_current_user)):
    if user.get("service")!="production-effects" or "ProductionEffects" not in user.get("roles",[]):raise HTTPException(403,"Production service identity required")
    lock_state(db);a=db.query(ReleaseAuthorization).filter_by(id=authorization_id,plant_id=plant).with_for_update().first()
    if not a:raise HTTPException(404,"Release authorization not found")
    if a.bundle_hash!=payload.bundle_hash:raise HTTPException(409,"Release bundle hash changed")
    if a.status=="COMMITTED":
        if a.job_card_id!=payload.job_card_id:raise HTTPException(409,"Release already belongs to a different card")
        return {"authorization_id":str(a.id),"status":a.status,"job_card_id":str(a.job_card_id)}
    a.status="COMMITTED";a.job_card_id=payload.job_card_id;a.acknowledged_at=datetime.utcnow()
    return complete(db,f"release-ack:{a.id}",payload.model_dump(),{"authorization_id":str(a.id),"status":a.status,"job_card_id":str(a.job_card_id)},user,"season_release_acknowledged")


@router.post("/specs/{spec_id}/release-authorizations")
def authorize_release(spec_id: uuid.UUID,payload: Authorize,db: Session=Depends(get_db),plant: str=Depends(get_current_plant),user: dict=Depends(require_role(["Owner","Admin","Planner","PlantManager"]))):
    prior=db.query(ReleaseAuthorization).filter_by(plant_id=plant,operation_key=payload.request_id).first()
    request_hash=fingerprint({"spec_id":str(spec_id),**payload.model_dump(mode="json")})
    if prior:
        if prior.request_hash!=request_hash:raise HTTPException(409,"Release key reused with different inputs")
        return {"authorization_id":str(prior.id),"bundle":prior.bundle,"bundle_hash":prior.bundle_hash,"replayed":True}
    try:
        response=httpx.get(f"{os.getenv('SALES_SERVICE_URL','http://127.0.0.1:18004')}/sales-orders/lines/{payload.sales_order_line_id}",headers={"Authorization":f"Bearer {user.get('token','')}","X-Plant-ID":plant},timeout=8)
        response.raise_for_status();line=response.json()
    except (httpx.HTTPError,ValueError) as exc:raise HTTPException(503,"Could not verify the sales release context") from exc
    if str(line.get("approved_spec_id"))!=str(spec_id) or payload.quantity>float(line.get("qty") or 0)-float(line.get("fulfilled_qty") or 0):raise HTTPException(409,"Sales line does not authorize this specification/quantity")
    state=lock_state(db)
    # Another release may have authorized this operation while references were read.
    prior=db.query(ReleaseAuthorization).filter_by(plant_id=plant,operation_key=payload.request_id).first()
    if prior:
        if prior.request_hash!=request_hash:raise HTTPException(409,"Release key reused with different inputs")
        return {"authorization_id":str(prior.id),"bundle":prior.bundle,"bundle_hash":prior.bundle_hash,"replayed":True}
    reserved=sum(int(a.bundle.get("quantity") or 0) for a in db.query(ReleaseAuthorization).filter_by(plant_id=plant).filter(ReleaseAuthorization.bundle["sales_order_line_id"].as_string()==str(payload.sales_order_line_id)).all())
    if reserved+payload.quantity>float(line.get("released_qty") or 0):raise HTTPException(409,"Season authorization exceeds the quantity released by Sales; synchronize or reconcile the existing release")
    spec=load_spec(db,spec_id,plant,True)
    if spec.status!="approved" or not spec.active:raise HTTPException(409,"Active approved specification required")
    blockers=common_release_blockers(spec)
    if blockers:raise HTTPException(409,{"code":"SPEC_NOT_READY","blockers":blockers})
    if payload.expected_version is not None:version_check(spec.write_revision,payload.expected_version)
    binding=db.query(RecipeBinding).filter_by(spec_id=spec.id,season=state.active_season,approved=True).first()
    if not binding:raise HTTPException(409,{"code":"SEASON_NOT_READY","season":state.active_season,"blockers":["Approved seasonal recipe required"]})
    recipe=db.get(RecipeHeader,binding.recipe_id);profile=resolved(db,spec,state.active_season)
    if recipe.status!='approved' or binding.approved_context!=confirmation_hash(spec,recipe):raise HTTPException(409,{"code":"SEASON_NOT_READY","season":state.active_season,"blockers":["Approve the selected recipe for the current specification before release"]})
    if profile["unresolved"] or profile["conflicts"]:raise HTTPException(409,{"code":"SEASON_NOT_READY","season":state.active_season,"blockers":profile["unresolved"]+profile["conflicts"]})
    data=spec_values(spec,db);data["qc_profile"]=profile
    frozen_recipe=recipe_dict(recipe)
    labels={str(r['paper_id']):{'code':r.get('code'),'variety':r.get('variety')} for r in recipe.sheet_rows or []}
    frozen_recipe['sheet_rows']=canonical_recipe_rows(spec,frozen_recipe['layers'],labels)
    bundle=jsonable_encoder({"schema_version":2,"entry_model":"V2","season":state.active_season,"season_epoch":state.epoch,"spec":data,"recipe":frozen_recipe,"qc_profile":profile,"bom":generate_bom(str(recipe.id),None,None,db,spec_override=spec),"yield":calculate_yield(str(spec.id),None,db),"quantity":payload.quantity,"sales_order_line_id":str(payload.sales_order_line_id)})
    auth=ReleaseAuthorization(plant_id=plant,operation_key=payload.request_id,request_hash=request_hash,spec_id=spec.id,season=state.active_season,epoch=state.epoch,bundle=bundle,bundle_hash=fingerprint(bundle),authorized_by=user["sub"])
    db.add(auth);db.flush(); result={"authorization_id":str(auth.id),"bundle":bundle,"bundle_hash":auth.bundle_hash}
    return complete(db,f"authorization:{plant}:{payload.request_id}",payload.model_dump(),result,user,"season_release_authorized")
