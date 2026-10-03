"""Narrow inventory effects of authenticated production outbox commands."""
import uuid
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import func
from ..database import get_db
from ..models import StockBatch, StockTransaction, ReferenceType, InventoryQualityHold
from ..utils.auth import get_current_user, get_current_plant

router=APIRouter(prefix="/inventory/production-effects",tags=["production effects"])

class HoldInput(BaseModel):
    job_card_id:uuid.UUID
    effect_key:str=Field(min_length=8,max_length=180)

@router.post("/hold")
def hold_production_stock(payload:HoldInput,db:Session=Depends(get_db),plant:str=Depends(get_current_plant),user:dict=Depends(get_current_user)):
    return set_production_hold(payload,db,plant,user,True)

@router.post("/release")
def release_production_stock(payload:HoldInput,db:Session=Depends(get_db),plant:str=Depends(get_current_plant),user:dict=Depends(get_current_user)):
    return set_production_hold(payload,db,plant,user,False)

def set_production_hold(payload,db,plant,user,held):
    if user.get("service")!="production-effects" or "ProductionEffects" not in user.get("roles",[]):raise HTTPException(403,"Production service identity required")
    batches=db.query(StockBatch).join(StockTransaction,StockTransaction.batch_id==StockBatch.id).filter(StockBatch.plant_id==plant,StockTransaction.reference_id==payload.job_card_id,StockTransaction.reference_type==ReferenceType.PRODUCTION_JOB).with_for_update(of=StockBatch).all()
    for batch in batches:
        own=db.query(InventoryQualityHold).filter_by(plant_id=plant,entity_id=batch.id,hold_kind="PRODUCTION_JOB",status="HOLD").first()
        if held:
            if not own:
                quantity=max(0,float(db.query(func.coalesce(func.sum(StockTransaction.qty_change),0)).filter_by(batch_id=batch.id,plant_id=plant).scalar()))
                own=InventoryQualityHold(plant_id=plant,entity_type="BATCH",entity_id=batch.id,quantity=quantity,hold_kind="PRODUCTION_JOB",created_by=user["sub"],reason=json.dumps({"job_card_id":str(payload.job_card_id),"prior_status":batch.stock_status}),status="HOLD")
                db.add(own)
            if batch.stock_status in ("UNRESTRICTED","WIP","DISPATCH_STAGING","CONCESSION"):batch.stock_status="QC_HOLD"
        elif own:
            own.status="RELEASED";own.released_by=user["sub"];own.released_at=datetime.utcnow()
            others=db.query(InventoryQualityHold).filter(InventoryQualityHold.plant_id==plant,InventoryQualityHold.entity_id==batch.id,InventoryQualityHold.status=="HOLD",InventoryQualityHold.id!=own.id).count()
            if not others and batch.stock_status=="QC_HOLD":batch.stock_status=json.loads(own.reason).get("prior_status","UNRESTRICTED")
    db.commit();return {"affected_batches":len(batches),"effect_key":payload.effect_key}
