from datetime import datetime
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..utils.auth import apply_plant_scope, get_current_plant_scope

router = APIRouter(prefix="/master/contact-directory", tags=["contact-directory"])


class ContactDirectoryRow(BaseModel):
    id: str
    entity_type: str
    entity_id: uuid.UUID
    entity_code: str
    entity_name: str
    contact_id: Optional[uuid.UUID] = None
    contact_name: str
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None
    department: Optional[str] = None
    source: str
    plant_id: str
    created_at: Optional[datetime] = None


def _has_contact_value(*values: Optional[str]) -> bool:
    return any(str(value or "").strip() for value in values)


@router.get("/", response_model=List[ContactDirectoryRow])
def get_contact_directory(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    rows: list[ContactDirectoryRow] = []

    customer_contact_query = (
        db.query(models.CustomerContact, models.Customer)
        .join(models.Customer, models.CustomerContact.customer_id == models.Customer.id)
        .filter(models.CustomerContact.active == True, models.Customer.active == True)
    )
    customer_contact_query = apply_plant_scope(
        customer_contact_query,
        models.CustomerContact.plant_id,
        plant_scope,
    )
    customers_with_contacts: set[uuid.UUID] = set()
    for contact, customer in customer_contact_query.order_by(models.Customer.name.asc(), models.CustomerContact.contact_name.asc()).all():
        customers_with_contacts.add(customer.id)
        rows.append(
            ContactDirectoryRow(
                id=f"customer:{contact.id}",
                entity_type="CUSTOMER",
                entity_id=customer.id,
                entity_code=customer.customer_code,
                entity_name=customer.name,
                contact_id=contact.id,
                contact_name=contact.contact_name,
                contact_phone=contact.contact_phone,
                contact_email=contact.contact_email,
                department=contact.department,
                source="CONTACT_TABLE",
                plant_id=contact.plant_id,
                created_at=contact.created_at,
            )
        )

    customer_query = db.query(models.Customer).filter(models.Customer.active == True)
    customer_query = apply_plant_scope(customer_query, models.Customer.plant_id, plant_scope)
    for customer in customer_query.order_by(models.Customer.name.asc()).all():
        if customer.id in customers_with_contacts:
            continue
        if not _has_contact_value(customer.primary_contact_name, customer.contact_phone, customer.contact_email, customer.primary_contact_phone, customer.primary_contact_email):
            continue
        rows.append(
            ContactDirectoryRow(
                id=f"customer-flat:{customer.id}",
                entity_type="CUSTOMER",
                entity_id=customer.id,
                entity_code=customer.customer_code,
                entity_name=customer.name,
                contact_id=None,
                contact_name=customer.primary_contact_name or customer.name,
                contact_phone=customer.primary_contact_phone or customer.contact_phone,
                contact_email=customer.primary_contact_email or customer.contact_email,
                department="General",
                source="MASTER_FALLBACK",
                plant_id=customer.plant_id,
                created_at=customer.created_at,
            )
        )

    supplier_contact_query = (
        db.query(models.SupplierContact, models.Supplier)
        .join(models.Supplier, models.SupplierContact.supplier_id == models.Supplier.id)
        .filter(models.SupplierContact.active == True, models.Supplier.active == True)
    )
    supplier_contact_query = apply_plant_scope(
        supplier_contact_query,
        models.SupplierContact.plant_id,
        plant_scope,
    )
    suppliers_with_contacts: set[uuid.UUID] = set()
    for contact, supplier in supplier_contact_query.order_by(models.Supplier.name.asc(), models.SupplierContact.contact_name.asc()).all():
        suppliers_with_contacts.add(supplier.id)
        rows.append(
            ContactDirectoryRow(
                id=f"vendor:{contact.id}",
                entity_type="VENDOR",
                entity_id=supplier.id,
                entity_code=supplier.supplier_code,
                entity_name=supplier.name,
                contact_id=contact.id,
                contact_name=contact.contact_name,
                contact_phone=contact.contact_phone,
                contact_email=contact.contact_email,
                department=contact.department,
                source="CONTACT_TABLE",
                plant_id=contact.plant_id,
                created_at=contact.created_at,
            )
        )

    supplier_query = db.query(models.Supplier).filter(models.Supplier.active == True)
    supplier_query = apply_plant_scope(supplier_query, models.Supplier.plant_id, plant_scope)
    for supplier in supplier_query.order_by(models.Supplier.name.asc()).all():
        if supplier.id in suppliers_with_contacts:
            continue
        if not _has_contact_value(supplier.contact_name, supplier.contact_phone, supplier.contact_email):
            continue
        rows.append(
            ContactDirectoryRow(
                id=f"vendor-flat:{supplier.id}",
                entity_type="VENDOR",
                entity_id=supplier.id,
                entity_code=supplier.supplier_code,
                entity_name=supplier.name,
                contact_id=None,
                contact_name=supplier.contact_name or supplier.name,
                contact_phone=supplier.contact_phone,
                contact_email=supplier.contact_email,
                department="General",
                source="MASTER_FALLBACK",
                plant_id=supplier.plant_id,
                created_at=supplier.created_at,
            )
        )

    return sorted(rows, key=lambda row: (row.entity_type, row.entity_name.lower(), row.contact_name.lower()))
