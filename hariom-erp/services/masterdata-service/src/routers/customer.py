from datetime import datetime
from typing import List, Optional
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from .. import models
from ..database import get_db
from ..utils.auth import get_current_user, require_role, get_current_plant

router = APIRouter(prefix="/master/customers", tags=["customers"])


class CustomerCreate(BaseModel):
    customer_code: str
    name: str
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None


class CustomerUpdate(BaseModel):
    customer_code: Optional[str] = None
    name: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    active: Optional[bool] = None


class CustomerResponse(BaseModel):
    id: uuid.UUID
    customer_code: str
    name: str
    contact_email: Optional[str]
    contact_phone: Optional[str]
    plant_id: str
    active: bool
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("/", response_model=List[CustomerResponse])
def get_customers(
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant)
):
    return db.query(models.Customer).filter(
        models.Customer.plant_id == plant_id,
        models.Customer.active == True
    ).order_by(models.Customer.name.asc()).all()


@router.get("/{customer_id}", response_model=CustomerResponse)
def get_customer(
    customer_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant)
):
    customer = db.query(models.Customer).filter(
        models.Customer.id == customer_id,
        models.Customer.plant_id == plant_id
    ).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer


@router.post("/", response_model=CustomerResponse)
def create_customer(
    customer: CustomerCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    exists = db.query(models.Customer).filter(
        models.Customer.plant_id == plant_id,
        (models.Customer.customer_code == customer.customer_code) | (models.Customer.name == customer.name)
    ).first()
    if exists:
        raise HTTPException(status_code=400, detail="Customer code or name already exists in this plant")
    db_customer = models.Customer(**customer.model_dump(), plant_id=plant_id)
    db.add(db_customer)
    db.commit()
    db.refresh(db_customer)
    return db_customer


@router.put("/{customer_id}", response_model=CustomerResponse)
def update_customer(
    customer_id: uuid.UUID,
    customer_update: CustomerUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    db_customer = db.query(models.Customer).filter(
        models.Customer.id == customer_id,
        models.Customer.plant_id == plant_id
    ).first()
    if not db_customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    for field, value in customer_update.model_dump(exclude_unset=True).items():
        setattr(db_customer, field, value)
    db.commit()
    db.refresh(db_customer)
    return db_customer


@router.delete("/{customer_id}")
def deactivate_customer(
    customer_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    db_customer = db.query(models.Customer).filter(
        models.Customer.id == customer_id,
        models.Customer.plant_id == plant_id
    ).first()
    if not db_customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    db_customer.active = False
    db.commit()
    return {"message": "Customer deactivated successfully"}
