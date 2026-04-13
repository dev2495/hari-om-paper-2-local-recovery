from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
import uuid
from ..database import get_db
from .. import models
from ..utils.auth import get_current_user, require_role, get_current_plant, get_plant_aliases

router = APIRouter(prefix="/master/machines", tags=["machines"])

class MachineCreate(BaseModel):
    name: str
    department: str

class MachineUpdate(BaseModel):
    name: Optional[str] = None
    department: Optional[str] = None
    active: Optional[bool] = None

from datetime import datetime

class MachineResponse(BaseModel):
    id: uuid.UUID
    name: str
    department: str
    plant_id: str
    active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

@router.get("/", response_model=List[MachineResponse])
def get_machines(
    department: Optional[str] = Query(None, description="Filter by department"),
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant)
):
    plant_aliases = get_plant_aliases(plant_id)
    query = db.query(models.Machine).filter(
        models.Machine.plant_id.in_(plant_aliases),
        models.Machine.active == True
    )
    if department:
        query = query.filter(models.Machine.department.ilike(f"%{department}%"))
    return query.all()

@router.get("/{machine_id}", response_model=MachineResponse)
def get_machine(
    machine_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant)
):
    machine = db.query(models.Machine).filter(
        models.Machine.id == machine_id,
        models.Machine.plant_id == plant_id,
        models.Machine.active == True
    ).first()
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")
    return machine

@router.post("/", response_model=MachineResponse)
def create_machine(
    machine: MachineCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    db_machine = models.Machine(**machine.model_dump(), plant_id=plant_id)
    db.add(db_machine)
    db.commit()
    db.refresh(db_machine)
    return db_machine

@router.put("/{machine_id}", response_model=MachineResponse)
def update_machine(
    machine_id: uuid.UUID,
    machine_update: MachineUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    db_machine = db.query(models.Machine).filter(
        models.Machine.id == machine_id,
        models.Machine.plant_id == plant_id
    ).first()
    if not db_machine:
        raise HTTPException(status_code=404, detail="Machine not found")
    
    update_data = machine_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_machine, field, value)
    
    db.commit()
    db.refresh(db_machine)
    return db_machine

@router.delete("/{machine_id}")
def delete_machine(
    machine_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    db_machine = db.query(models.Machine).filter(
        models.Machine.id == machine_id,
        models.Machine.plant_id == plant_id
    ).first()
    if not db_machine:
        raise HTTPException(status_code=404, detail="Machine not found")
    
    db_machine.active = False
    db.commit()
    return {"message": "Machine deactivated successfully"}
