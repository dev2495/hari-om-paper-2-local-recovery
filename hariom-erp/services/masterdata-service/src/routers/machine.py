from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from .. import models
from ..database import get_db
from ..schemas.machine import MachineCreate, MachineResponse, MachineUpdate
from ..utils.auth import (
    accepted_persisted_plant_ids,
    apply_plant_scope,
    get_current_plant,
    get_current_plant_scope,
    require_role,
)

router = APIRouter(prefix="/master/machines", tags=["machines"])


def _canonical_capacity_type(department: str, capacity_type: str | None) -> str:
    normalized = str(capacity_type or "").strip().upper()
    department_key = str(department or "").strip().upper()
    if department_key == "WINDER" and normalized == "BAMBOOS_PER_DAY":
        return "METERS_PER_DAY"
    if normalized in {"REELS_PER_DAY", "BAMBOOS_PER_DAY", "METERS_PER_DAY", "BATCHES_PER_DAY", "TUBES_PER_DAY"}:
        return normalized

    if department_key == "SLITTING":
        return "REELS_PER_DAY"
    if department_key == "WINDER":
        return "METERS_PER_DAY"
    if department_key == "OVEN":
        return "BATCHES_PER_DAY"
    return "TUBES_PER_DAY"


def _apply_machine_updates_with_validation(db_machine: models.Machine, machine_update: MachineUpdate) -> dict:
    update_data = machine_update.model_dump(exclude_unset=True)
    include_supported_mandrels = "supported_mandrel_ids" in update_data
    merged = {
        "code": update_data.get("code", db_machine.code),
        "name": update_data.get("name", db_machine.name),
        "department": update_data.get("department", db_machine.department),
        "capacity_type": update_data.get("capacity_type", db_machine.capacity_type),
        "capacity_value": update_data.get("capacity_value", db_machine.capacity_value),
        "batch_bamboo_capacity": update_data.get("batch_bamboo_capacity", db_machine.batch_bamboo_capacity),
        "cycle_time_hours": update_data.get("cycle_time_hours", db_machine.cycle_time_hours),
        "id_min_mm": update_data.get("id_min_mm", db_machine.id_min_mm),
        "id_max_mm": update_data.get("id_max_mm", db_machine.id_max_mm),
        "od_min_mm": update_data.get("od_min_mm", db_machine.od_min_mm),
        "od_max_mm": update_data.get("od_max_mm", db_machine.od_max_mm),
        "length_min_mm": update_data.get("length_min_mm", db_machine.length_min_mm),
        "length_max_mm": update_data.get("length_max_mm", db_machine.length_max_mm),
    }
    validated = MachineCreate(**merged)
    update_data.update(validated.model_dump(exclude={"supported_mandrel_ids"}))
    if include_supported_mandrels:
        update_data["supported_mandrel_ids"] = machine_update.supported_mandrel_ids
    return update_data


def _serialize_machine(machine: models.Machine) -> dict:
    supported_rows = list(machine.supported_mandrels or [])
    return {
        "id": machine.id,
        "code": machine.code,
        "name": machine.name,
        "department": machine.department,
        "capacity_type": _canonical_capacity_type(machine.department, machine.capacity_type),
        "capacity_value": machine.capacity_value,
        "batch_bamboo_capacity": machine.batch_bamboo_capacity,
        "cycle_time_hours": machine.cycle_time_hours,
        "id_min_mm": machine.id_min_mm,
        "id_max_mm": machine.id_max_mm,
        "od_min_mm": machine.od_min_mm,
        "od_max_mm": machine.od_max_mm,
        "length_min_mm": machine.length_min_mm,
        "length_max_mm": machine.length_max_mm,
        "plant_id": machine.plant_id,
        "is_active": machine.is_active,
        "active": machine.active,
        "supported_mandrel_ids": [row.mandrel_id for row in supported_rows],
        "supported_mandrels": [
            {
                "id": row.mandrel.id,
                "mandrel_code": row.mandrel.mandrel_code,
                "outer_diameter_mm": row.mandrel.outer_diameter_mm,
            }
            for row in supported_rows
            if row.mandrel is not None
        ],
        "created_at": machine.created_at,
    }


def _resolve_supported_mandrels(db: Session, mandrel_ids: list[uuid.UUID], plant_values: list[str]) -> list[models.Mandrel]:
    if not mandrel_ids:
        return []
    mandrels = (
        db.query(models.Mandrel)
        .filter(
            models.Mandrel.id.in_(mandrel_ids),
            models.Mandrel.plant_id.in_(plant_values),
            models.Mandrel.active.is_(True),
        )
        .all()
    )
    found_ids = {row.id for row in mandrels}
    missing = [str(mandrel_id) for mandrel_id in mandrel_ids if mandrel_id not in found_ids]
    if missing:
        raise HTTPException(status_code=400, detail=f"Unsupported or inactive mandrel ids: {', '.join(missing)}")
    mandrel_map = {row.id: row for row in mandrels}
    return [mandrel_map[mandrel_id] for mandrel_id in mandrel_ids]


def _sync_supported_mandrels(db_machine: models.Machine, mandrels: list[models.Mandrel]) -> None:
    existing_by_id = {
        row.mandrel_id: row
        for row in db_machine.supported_mandrels or []
    }
    desired_ids = {row.id for row in mandrels}
    db_machine.supported_mandrels = [
        row for mandrel_id, row in existing_by_id.items() if mandrel_id in desired_ids
    ]
    current_ids = {row.mandrel_id for row in db_machine.supported_mandrels}
    for mandrel in mandrels:
        if mandrel.id in current_ids:
            continue
        db_machine.supported_mandrels.append(
            models.MachineSupportedMandrel(mandrel_id=mandrel.id, mandrel=mandrel)
        )


@router.get("/", response_model=list[MachineResponse])
def get_machines(
    department: Optional[str] = Query(None, description="Filter by department"),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    query = (
        db.query(models.Machine)
        .options(selectinload(models.Machine.supported_mandrels).selectinload(models.MachineSupportedMandrel.mandrel))
        .filter(models.Machine.is_active == True)
    )
    query = apply_plant_scope(query, models.Machine.plant_id, plant_scope)

    if department:
        query = query.filter(models.Machine.department == department.strip().upper())
    return [_serialize_machine(machine) for machine in query.order_by(models.Machine.department.asc(), models.Machine.code.asc()).all()]


@router.get("/{machine_id}", response_model=MachineResponse)
def get_machine(
    machine_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    query = db.query(models.Machine).options(
        selectinload(models.Machine.supported_mandrels).selectinload(models.MachineSupportedMandrel.mandrel)
    ).filter(
        models.Machine.id == machine_id,
        models.Machine.is_active == True,
    )
    query = apply_plant_scope(query, models.Machine.plant_id, plant_scope)
    machine = query.first()
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")
    return _serialize_machine(machine)


@router.post("/", response_model=MachineResponse)
def create_machine(
    machine: MachineCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "PlantManager"])),
):
    plant_values = accepted_persisted_plant_ids(plant_id)
    existing = db.query(models.Machine).filter(
        models.Machine.plant_id.in_(plant_values),
        ((models.Machine.code == machine.code) | (models.Machine.name == machine.name)),
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Machine code or name already exists in this plant")

    payload = machine.model_dump()
    supported_mandrels = _resolve_supported_mandrels(db, payload.pop("supported_mandrel_ids", []), plant_values)
    db_machine = models.Machine(**payload, plant_id=plant_id, is_active=True)
    db.add(db_machine)
    if supported_mandrels:
        _sync_supported_mandrels(db_machine, supported_mandrels)
    db.commit()
    db.refresh(db_machine)
    return _serialize_machine(db_machine)


@router.put("/{machine_id}", response_model=MachineResponse)
def update_machine(
    machine_id: uuid.UUID,
    machine_update: MachineUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "PlantManager"])),
):
    plant_values = accepted_persisted_plant_ids(plant_id)
    db_machine = db.query(models.Machine).options(
        selectinload(models.Machine.supported_mandrels).selectinload(models.MachineSupportedMandrel.mandrel)
    ).filter(
        models.Machine.id == machine_id,
        models.Machine.plant_id.in_(plant_values),
    ).first()
    if not db_machine:
        raise HTTPException(status_code=404, detail="Machine not found")

    update_data = _apply_machine_updates_with_validation(db_machine, machine_update)

    if "code" in update_data or "name" in update_data:
        candidate_code = update_data.get("code", db_machine.code)
        candidate_name = update_data.get("name", db_machine.name)
        conflict = db.query(models.Machine).filter(
            models.Machine.id != db_machine.id,
            models.Machine.plant_id.in_(plant_values),
            ((models.Machine.code == candidate_code) | (models.Machine.name == candidate_name)),
        ).first()
        if conflict:
            raise HTTPException(status_code=409, detail="Machine code or name already exists in this plant")

    supported_mandrel_ids = update_data.pop("supported_mandrel_ids", None)

    for field, value in update_data.items():
        setattr(db_machine, field, value)

    if supported_mandrel_ids is not None:
        supported_mandrels = _resolve_supported_mandrels(db, supported_mandrel_ids, plant_values)
        _sync_supported_mandrels(db_machine, supported_mandrels)

    db.commit()
    db.refresh(db_machine)
    return _serialize_machine(db_machine)


@router.delete("/{machine_id}")
def delete_machine(
    machine_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "PlantManager"])),
):
    plant_values = accepted_persisted_plant_ids(plant_id)
    db_machine = db.query(models.Machine).filter(
        models.Machine.id == machine_id,
        models.Machine.plant_id.in_(plant_values),
    ).first()
    if not db_machine:
        raise HTTPException(status_code=404, detail="Machine not found")

    db_machine.is_active = False
    db.commit()
    return {"message": "Machine deactivated successfully"}
