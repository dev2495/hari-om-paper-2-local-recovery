"""Inward QC standards API: QC parameter lists and Masters tolerance bands (2026-10-18)."""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import InventoryQualityStandardEvent, InventoryQualityTemplate, InventoryQualityTolerance, ItemMaster
from ..quality_standards import (
    MATERIAL_TYPES,
    MODES,
    SCOPES,
    is_numeric,
    item_type,
    line_key,
    materialize_item,
    materialize_type,
    next_scope_version,
    parameters_for,
    record_event,
    resolve_band,
    tolerance_dict,
    tolerance_index,
)
from ..utils.auth import get_current_plant, get_current_user, require_role

router = APIRouter(prefix="/inventory/quality/standards", tags=["inventory-quality-standards"])

# QC owns which checks exist; Masters (Owner/Admin) own the bands.
PARAMETER_ROLES = ["QC", "InwardQC", "Owner", "Admin"]
TOLERANCE_ROLES = ["Owner", "Admin"]
INPUT_TYPES = {"number", "select", "text"}


def _material(value: str) -> str:
    material = str(value or "").strip().upper()
    if material == "PAPER":
        material = "RAW_PAPER"
    if material not in MATERIAL_TYPES:
        raise HTTPException(400, f"material_type must be one of {', '.join(MATERIAL_TYPES)}")
    return material


def _parameter_dict(row: InventoryQualityTemplate) -> dict[str, Any]:
    return {
        "id": str(row.id), "material_type": row.material_type, "parameter_key": row.parameter_key, "label": row.label,
        "unit": row.unit or "", "input_type": row.input_type or "number", "options": list(row.options or []),
        "required": bool(row.required), "sort_order": float(row.sort_order or 0), "active": str(row.active) == "true",
        "measured": is_numeric(row.input_type), "updated_by": row.updated_by,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.get("/types")
def list_material_types(current_user: dict = Depends(get_current_user)):
    return [{"material_type": key, **value} for key, value in MATERIAL_TYPES.items()]


@router.get("/parameters")
def list_parameters(material_type: str = Query(...), include_inactive: bool = Query(True), db: Session = Depends(get_db),
                    current_user: dict = Depends(get_current_user)):
    material = _material(material_type)
    return [_parameter_dict(row) for row in parameters_for(db, material, include_inactive=include_inactive)]


class ParameterCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    material_type: str
    label: str = Field(min_length=1, max_length=160)
    unit: str = Field(default="", max_length=30)
    input_type: str = "number"
    options: list[str] = Field(default_factory=list)
    required: bool = True

    @field_validator("input_type")
    @classmethod
    def _input_type(cls, value: str) -> str:
        value = str(value or "number").strip().lower()
        if value not in INPUT_TYPES:
            raise ValueError("input_type must be number, select or text")
        return value


class ParameterUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: Optional[str] = Field(default=None, min_length=1, max_length=160)
    unit: Optional[str] = Field(default=None, max_length=30)
    input_type: Optional[str] = None
    options: Optional[list[str]] = None
    required: Optional[bool] = None
    sort_order: Optional[float] = None
    active: Optional[bool] = None

    @field_validator("input_type")
    @classmethod
    def _input_type(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = str(value).strip().lower()
        if value not in INPUT_TYPES:
            raise ValueError("input_type must be number, select or text")
        return value


def _clean_options(input_type: str, options: list[str]) -> list[str]:
    # Outcomes are stored as tokens (NOT OK -> NOT_OK) so FAIL / NO / NOT_OK / REJECT hold the lot.
    cleaned = list(dict.fromkeys(re.sub(r"\s+", "_", str(option).strip().upper()) for option in options or [] if str(option).strip()))
    if input_type == "select" and len(cleaned) < 2:
        raise HTTPException(422, "List at least two outcomes for a pass / fail check (for example OK, NOT OK)")
    return cleaned if input_type == "select" else []


def _key_for(label: str, taken: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")[:60] or "check"
    key, suffix = base, 2
    while key in taken:
        key, suffix = f"{base}_{suffix}", suffix + 1
    return key


@router.post("/parameters")
def create_parameter(payload: ParameterCreate, db: Session = Depends(get_db),
                     current_user: dict = Depends(require_role(PARAMETER_ROLES))):
    material = _material(payload.material_type)
    existing = parameters_for(db, material, include_inactive=True)
    if any(row.label.strip().lower() == payload.label.strip().lower() for row in existing):
        raise HTTPException(409, f"{payload.label} is already on the {MATERIAL_TYPES[material]['label']} list; switch it on instead")
    row = InventoryQualityTemplate(
        plant_id="GLOBAL", material_type=material, parameter_key=_key_for(payload.label, {r.parameter_key for r in existing}),
        label=payload.label.strip(), unit=payload.unit.strip(), input_type=payload.input_type,
        options=_clean_options(payload.input_type, payload.options), required=payload.required,
        sort_order=max([float(r.sort_order or 0) for r in existing] or [0]) + 10, active="true",
        updated_by=current_user.get("sub"), updated_at=datetime.utcnow(),
    )
    db.add(row)
    db.flush()
    record_event(db, material_type=material, kind="PARAMETER_ADDED", actor=current_user.get("sub"), after=_parameter_dict(row), parameter_key=row.parameter_key)
    changed = materialize_type(db, material, actor=current_user.get("sub") or "QC", reason=f"QC added {row.label}")
    db.commit()
    return {**_parameter_dict(row), "items_updated": changed}


@router.put("/parameters/{parameter_id}")
def update_parameter(parameter_id: uuid.UUID, payload: ParameterUpdate, db: Session = Depends(get_db),
                     current_user: dict = Depends(require_role(PARAMETER_ROLES))):
    row = db.query(InventoryQualityTemplate).filter_by(id=parameter_id, plant_id="GLOBAL").with_for_update().first()
    if not row or row.material_type not in MATERIAL_TYPES:
        raise HTTPException(404, "QC parameter not found")
    before = _parameter_dict(row)
    data = payload.model_dump(exclude_none=True)
    if "label" in data:
        label = data["label"].strip()
        clash = [r for r in parameters_for(db, row.material_type, include_inactive=True) if r.id != row.id and r.label.strip().lower() == label.lower()]
        if clash:
            raise HTTPException(409, f"{label} is already on this list")
        row.label = label
    if "unit" in data:
        row.unit = data["unit"].strip()
    input_type = data.get("input_type", row.input_type or "number")
    if "input_type" in data or "options" in data:
        row.input_type = input_type
        row.options = _clean_options(input_type, data.get("options", list(row.options or [])))
    if "required" in data:
        row.required = data["required"]
    if "sort_order" in data:
        row.sort_order = data["sort_order"]
    if "active" in data:
        row.active = "true" if data["active"] else "false"
    row.updated_by, row.updated_at = current_user.get("sub"), datetime.utcnow()
    db.flush()
    after = _parameter_dict(row)
    kind = "PARAMETER_DISABLED" if before["active"] and not after["active"] else "PARAMETER_ENABLED" if after["active"] and not before["active"] else "PARAMETER_EDITED"
    record_event(db, material_type=row.material_type, kind=kind, actor=current_user.get("sub"), before=before, after=after, parameter_key=row.parameter_key)
    changed = materialize_type(db, row.material_type, actor=current_user.get("sub") or "QC", reason=f"QC {kind.split('_')[1].lower()} {row.label}")
    db.commit()
    return {**after, "items_updated": changed}


def _item_row(item: ItemMaster, measured: list[InventoryQualityTemplate], index: dict) -> dict[str, Any]:
    return {
        "id": str(item.id), "item_code": item.item_code, "line_key": line_key(item.item_code), "name": item.name, "plant_id": item.plant_id,
        "active": str(item.active) != "false", "material_group": item.material_group or "", "material_subgroup": item.material_subgroup or "",
        "qc_nominals": item.qc_nominals if isinstance(item.qc_nominals, dict) else {},
        "profile_revision": (item.quality_profile or {}).get("revision") if isinstance(item.quality_profile, dict) else None,
        "bands": {row.parameter_key: resolve_band(item, row.parameter_key, index) for row in measured},
    }


@router.get("/tolerances")
def read_tolerances(material_type: str = Query(...), db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
                    current_user: dict = Depends(get_current_user)):
    material = _material(material_type)
    parameters = parameters_for(db, material, include_inactive=False)
    measured = [row for row in parameters if is_numeric(row.input_type)]
    index = tolerance_index(db, material)
    items = db.query(ItemMaster).filter(ItemMaster.type == material, ItemMaster.plant_id == plant_id).order_by(ItemMaster.item_code).all()
    groups: dict[str, set[str]] = {}
    for item in items:
        if item.material_group:
            groups.setdefault(item.material_group, set())
            if item.material_subgroup:
                groups[item.material_group].add(item.material_subgroup)
    for (scope, key, _code) in index:
        if scope == "GROUP" and key:
            groups.setdefault(key, set())
        if scope == "SUBGROUP" and "||" in key:
            group, subgroup = key.split("||", 1)
            groups.setdefault(group, set()).add(subgroup)
    return {
        "material_type": material, "meta": MATERIAL_TYPES[material],
        "parameters": [_parameter_dict(row) for row in parameters],
        "measured": [row.parameter_key for row in measured],
        "tolerances": [tolerance_dict(row) for row in index.values()],
        "groups": [{"group": group, "subgroups": sorted(subgroups)} for group, subgroups in sorted(groups.items())],
        "items": [_item_row(item, measured, index) for item in items],
    }


class ToleranceLine(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    parameter_key: str
    mode: str = "RANGE"
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    tolerance_value: Optional[float] = Field(default=None, ge=0)


class ToleranceSave(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    material_type: str
    scope: str
    scope_key: str = ""
    lines: list[ToleranceLine] = Field(default_factory=list, max_length=60)
    note: str = Field(default="", max_length=500)
    # Line saves from a master row also carry the row's nominal values and group (e.g. paper
    # variety), written onto every stock material with that code.
    nominals: Optional[dict[str, Optional[float]]] = None
    material_group: Optional[str] = Field(default=None, max_length=120)


def _line_items(db: Session, code: str) -> list[ItemMaster]:
    """Stock materials (any plant) carrying this line code."""
    from sqlalchemy import func

    return db.query(ItemMaster).filter(func.upper(func.trim(ItemMaster.item_code)) == line_key(code)).all()


def _validate_scope(db: Session, material: str, scope: str, key: str, plant_id: str) -> tuple[str, str]:
    scope = str(scope or "").upper()
    if scope not in SCOPES:
        raise HTTPException(400, "scope must be ITEM, SUBGROUP, GROUP or TYPE")
    key = (key or "").strip()
    if scope == "TYPE":
        return scope, ""
    if not key:
        raise HTTPException(422, "Choose the line or group the band applies to")
    if scope == "ITEM":
        key = line_key(key)
        clash = [item for item in _line_items(db, key) if item_type(item) != material]
        if clash:
            raise HTTPException(409, f"Code {key} is a {item_type(clash[0]).replace('_', ' ').lower()} material, not {MATERIAL_TYPES[material]['label'].lower()}")
    if scope == "SUBGROUP" and ("||" not in key or not all(part.strip() for part in key.split("||", 1))):
        raise HTTPException(422, "A sub-group band needs both the group and the sub-group")
    return scope, key


@router.put("/tolerances")
def save_tolerances(payload: ToleranceSave, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
                    current_user: dict = Depends(require_role(TOLERANCE_ROLES))):
    material = _material(payload.material_type)
    scope, key = _validate_scope(db, material, payload.scope, payload.scope_key, plant_id)
    measured = {row.parameter_key: row for row in parameters_for(db, material) if is_numeric(row.input_type)}
    actor = current_user.get("sub")
    line_items = _line_items(db, key) if scope == "ITEM" else []
    item_changed = False
    if scope == "ITEM" and (payload.nominals is not None or payload.material_group is not None):
        for code in (payload.nominals or {}):
            if code not in measured:
                raise HTTPException(422, f"{code} is not a measured QC parameter for {MATERIAL_TYPES[material]['label']}")
        for item in line_items:
            before = {"material_group": item.material_group, "qc_nominals": item.qc_nominals}
            if payload.nominals is not None:
                nominals = dict(item.qc_nominals or {}) if isinstance(item.qc_nominals, dict) else {}
                for code, value in payload.nominals.items():
                    if value is None:
                        nominals.pop(code, None)
                    else:
                        nominals[code] = float(value)
                item.qc_nominals = nominals
            if payload.material_group is not None and (payload.material_group or "").strip():
                if (item.material_group or "") != payload.material_group.strip():
                    item.material_group, item.material_subgroup = payload.material_group.strip(), None
            after = {"material_group": item.material_group, "qc_nominals": item.qc_nominals}
            if after != before:
                item_changed = True
    version = next_scope_version(db, material, scope, key)
    changed_codes: list[str] = []
    for line in payload.lines:
        if line.parameter_key not in measured:
            raise HTTPException(422, f"{line.parameter_key} is not a measured QC parameter for {MATERIAL_TYPES[material]['label']}; QC adds checks in Quality › Material standards")
        label = measured[line.parameter_key].label
        mode = str(line.mode or "RANGE").upper()
        if mode not in MODES:
            raise HTTPException(422, f"{label}: choose min–max, ± value or ± %")
        blank = (line.min_value is None and line.max_value is None) if mode == "RANGE" else line.tolerance_value is None
        if mode == "RANGE" and line.min_value is not None and line.max_value is not None and line.min_value > line.max_value:
            raise HTTPException(422, f"{label}: min {line.min_value:g} is above max {line.max_value:g}")
        if mode != "RANGE" and scope == "ITEM" and not blank:
            nominal = (payload.nominals or {}).get(line.parameter_key)
            if nominal is None:
                nominal = next((item.qc_nominals.get(line.parameter_key) for item in line_items if isinstance(item.qc_nominals, dict) and item.qc_nominals.get(line.parameter_key) is not None), None)
            if nominal in (None, ""):
                raise HTTPException(422, f"{label}: the line has no nominal value to centre ± on; enter it, or use a min–max band")
        row = db.query(InventoryQualityTolerance).filter_by(material_type=material, scope=scope, scope_key=key, parameter_key=line.parameter_key).with_for_update().first()
        before = tolerance_dict(row) if row else None
        if blank:
            if row:
                db.delete(row)
                record_event(db, material_type=material, kind="TOLERANCE_CLEARED", actor=actor, before=before, scope=scope, scope_key=key, parameter_key=line.parameter_key, note=payload.note, version=version)
                changed_codes.append(line.parameter_key)
            continue
        values = {"mode": mode, "min_value": line.min_value if mode == "RANGE" else None, "max_value": line.max_value if mode == "RANGE" else None,
                  "tolerance_value": line.tolerance_value if mode != "RANGE" else None}
        if row and all(getattr(row, field) == value for field, value in values.items()):
            continue
        if not row:
            row = InventoryQualityTolerance(material_type=material, scope=scope, scope_key=key, parameter_key=line.parameter_key)
            db.add(row)
        for field, value in values.items():
            setattr(row, field, value)
        row.version, row.note, row.updated_by, row.updated_at = version, payload.note.strip() or None, actor, datetime.utcnow()
        db.flush()
        record_event(db, material_type=material, kind="TOLERANCE_SET", actor=actor, before=before, after=tolerance_dict(row), scope=scope, scope_key=key, parameter_key=line.parameter_key, note=payload.note, version=version)
        changed_codes.append(line.parameter_key)
    if item_changed and not changed_codes:
        record_event(db, material_type=material, kind="LINE_NOMINALS", actor=actor, scope=scope, scope_key=key, after={"nominals": payload.nominals, "material_group": payload.material_group}, note=payload.note, version=version)
    if not changed_codes and not item_changed:
        return {"changed": [], "items_updated": 0, "version": version - 1}
    db.flush()
    updated = materialize_type(db, material, actor=actor or "Masters", reason=f"Masters tolerance change ({scope.lower()} v{version})")
    db.commit()
    return {"changed": changed_codes, "items_updated": updated, "version": version}


@router.get("/scope")
def read_scope(material_type: str = Query(...), scope: str = Query(...), scope_key: str = Query(""), group: str = Query(""),
               subgroup: str = Query(""), db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
               current_user: dict = Depends(get_current_user)):
    """One scope's bands, what a line inherits above it, and the scope's versioned history (master-row popup)."""
    material = _material(material_type)
    scope, key = _validate_scope(db, material, scope, scope_key, plant_id)
    parameters = [row for row in parameters_for(db, material) if is_numeric(row.input_type)]
    index = tolerance_index(db, material)
    rows = {code: tolerance_dict(row) for (s_, k_, code), row in index.items() if s_ == scope and k_ == key}
    items = _line_items(db, key) if scope == "ITEM" else []
    probe = items[0] if items else None
    group_name = (group or (probe.material_group if probe else "") or "").strip()
    subgroup_name = (subgroup or (probe.material_subgroup if probe else "") or "").strip()
    if scope == "GROUP":
        group_name, subgroup_name = key, ""
    if scope == "SUBGROUP":
        group_name, subgroup_name = key.split("||", 1)
    # What applies when this scope sets nothing: the next scope up the chain.
    chain = [("SUBGROUP", f"{group_name}||{subgroup_name}") if group_name and subgroup_name else None, ("GROUP", group_name) if group_name else None, ("TYPE", "")]
    order = {"ITEM": 0, "SUBGROUP": 1, "GROUP": 2, "TYPE": 3}
    above = [entry for entry in chain if entry and order[entry[0]] > order[scope]]
    nominals = (probe.qc_nominals if probe and isinstance(probe.qc_nominals, dict) else {})
    inherited: dict[str, Any] = {}
    for parameter in parameters:
        for s_, k_ in above:
            row = index.get((s_, k_, parameter.parameter_key))
            if row is None:
                continue
            inherited[parameter.parameter_key] = {**tolerance_dict(row), "from": s_, "from_key": k_}
            break
    events = db.query(InventoryQualityStandardEvent).filter(
        InventoryQualityStandardEvent.material_type == material, InventoryQualityStandardEvent.scope == scope,
        InventoryQualityStandardEvent.scope_key == key,
    ).order_by(InventoryQualityStandardEvent.created_at.desc()).limit(200).all()
    versions: dict[int, dict[str, Any]] = {}
    for event in events:
        number = int(event.version or 0)
        entry = versions.setdefault(number, {"version": number, "actor": event.actor, "at": event.created_at.isoformat() if event.created_at else None, "note": event.note, "changes": []})
        entry["changes"].append({"parameter_key": event.parameter_key, "kind": event.kind, "before": event.before, "after": event.after})
    return {
        "material_type": material, "scope": scope, "scope_key": key, "group": group_name, "subgroup": subgroup_name,
        "parameters": [_parameter_dict(row) for row in parameters], "bands": rows, "inherited": inherited,
        "nominals": nominals, "stock_lines": [{"id": str(item.id), "plant_id": item.plant_id, "item_code": item.item_code, "name": item.name} for item in items],
        "version": max(versions) if versions else 0, "history": [versions[number] for number in sorted(versions, reverse=True)],
    }


class ItemStandards(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    material_group: Optional[str] = Field(default=None, max_length=120)
    material_subgroup: Optional[str] = Field(default=None, max_length=120)
    qc_nominals: Optional[dict[str, Optional[float]]] = None


@router.put("/items/{item_id}")
def save_item_standards(item_id: uuid.UUID, payload: ItemStandards, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
                        current_user: dict = Depends(require_role(["Owner", "Admin", "Store"]))):
    item = db.query(ItemMaster).filter(ItemMaster.id == item_id, ItemMaster.plant_id == plant_id).with_for_update().first()
    if not item:
        raise HTTPException(404, "Material not found")
    material = item_type(item)
    if material not in MATERIAL_TYPES:
        raise HTTPException(400, "Finished goods have no inward QC standard")
    before = {"material_group": item.material_group, "material_subgroup": item.material_subgroup, "qc_nominals": item.qc_nominals}
    data = payload.model_dump(exclude_unset=True)
    if "material_group" in data:
        item.material_group = (data["material_group"] or "").strip() or None
        if not item.material_group:
            item.material_subgroup = None
    if "material_subgroup" in data:
        item.material_subgroup = (data["material_subgroup"] or "").strip() or None
        if item.material_subgroup and not item.material_group:
            raise HTTPException(422, "Choose the group before the sub-group")
    if "qc_nominals" in data:
        measured = {row.parameter_key for row in parameters_for(db, material) if is_numeric(row.input_type)}
        nominals = dict(item.qc_nominals or {}) if isinstance(item.qc_nominals, dict) else {}
        for code, value in (data["qc_nominals"] or {}).items():
            if code not in measured:
                raise HTTPException(422, f"{code} is not a measured QC parameter for this material")
            if value is None:
                nominals.pop(code, None)
            else:
                nominals[code] = float(value)
        item.qc_nominals = nominals
    after = {"material_group": item.material_group, "material_subgroup": item.material_subgroup, "qc_nominals": item.qc_nominals}
    if after == before:
        return {"changed": False}
    record_event(db, material_type=material, kind="ITEM_STANDARDS", actor=current_user.get("sub"), before=before, after=after, scope="ITEM", scope_key=str(item.id))
    db.flush()
    materialize_item(db, item, actor=current_user.get("sub") or "Masters", reason="Material group / nominal changed")
    db.commit()
    return {"changed": True, "item": _item_row(item, [r for r in parameters_for(db, material) if is_numeric(r.input_type)], tolerance_index(db, material))}


@router.get("/history")
def standards_history(material_type: Optional[str] = Query(None), limit: int = Query(100, ge=1, le=500), db: Session = Depends(get_db),
                      current_user: dict = Depends(get_current_user)):
    query = db.query(InventoryQualityStandardEvent)
    if material_type:
        query = query.filter(InventoryQualityStandardEvent.material_type == _material(material_type))
    rows = query.order_by(InventoryQualityStandardEvent.created_at.desc()).limit(limit).all()
    return [{"id": str(r.id), "material_type": r.material_type, "kind": r.kind, "scope": r.scope, "scope_key": r.scope_key,
             "parameter_key": r.parameter_key, "before": r.before, "after": r.after, "note": r.note, "actor": r.actor,
             "at": r.created_at.isoformat() if r.created_at else None} for r in rows]
