"""Copy the common masters into a new plant (owner decision 3 Nov 2026).

Plants are isolated, but a few masters are the same everywhere: the material list (papers, adhesives,
parchment companies and colours, boxes, plastic sheets, fadda), customers, suppliers and the tool list
(tool definitions and their dropdown values; the physical tools live in inventory-service). Every
master is still stored per plant, so when a plant starts the owner copies these from an existing plant.

Only active rows are copied. A row whose code (or name, where that is the master's key) is already in
the target plant is skipped, never changed. Machines, mandrels, tube sizes, people, shifts, holidays,
reason codes, specs, stock and every transaction stay with their plant and are never copied.
"""
from __future__ import annotations

import copy
import logging
import uuid
from typing import Any, Callable, Optional

import requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..utils.audit_client import AUTH_SERVICE_URL, emit_audit_event
from ..utils.auth import (
    SUPER_ROLES,
    _resolve_scope,
    accepted_persisted_plant_ids,
    get_current_user,
    get_plant_aliases,
    oauth2_scheme,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/master", tags=["common-masters"])

SAMPLE_SIZE = 5
# Never copied: identity, plant, timestamps. Tool usage counts belong to the plant that used the tool.
_SKIP_COLUMNS = {"id", "plant_id", "created_at", "updated_at"}


class CopyCommonRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_plant_id: str
    target_plant_id: str
    dry_run: bool = True


def _norm(value: Any) -> str:
    return " ".join(str(value or "").split()).upper()


def _values(row: Any, *, skip: tuple[str, ...] = ()) -> dict[str, Any]:
    """Every column of a master row except id / plant / timestamps (JSON values deep-copied)."""
    out: dict[str, Any] = {}
    for column in sa_inspect(row).mapper.column_attrs:
        if column.key in _SKIP_COLUMNS or column.key in skip:
            continue
        out[column.key] = copy.deepcopy(getattr(row, column.key))
    return out


def _is_active(row: Any) -> bool:
    return getattr(row, "active", True) is not False


# ── the common master types ──────────────────────────────────────────────
# Each type: the model, its natural keys (any key already in the target means "already there"),
# a label for the samples, and optional child rows copied with a new parent.

def _paper_keys(row: models.PaperMaster) -> list[tuple]:
    if str(row.code or "").strip():
        return [("code", _norm(row.code))]
    # A paper saved without a code is matched on what it is.
    return [("spec", _norm(row.variety), row.gsm, row.bf, _norm(row.strength_type), row.strength_value, _norm(row.category))]


def _tool_active(row: models.ToolMaster) -> bool:
    return _is_active(row) and str(row.status or "ACTIVE").upper() == "ACTIVE"


COMMON_TYPES: list[dict[str, Any]] = [
    {"key": "papers", "label": "Papers", "model": models.PaperMaster, "keys": _paper_keys,
     "name": lambda r: r.code or f"{r.variety or 'Paper'} {r.gsm:g} GSM"},
    {"key": "adhesives", "label": "Adhesives", "model": models.AdhesiveMaster,
     "keys": lambda r: [("code", _norm(r.internal_code)), ("name", _norm(r.name))],
     "name": lambda r: f"{r.internal_code} {r.name}"},
    {"key": "parchment_companies", "label": "Parchment companies", "model": models.ParchmentVendor,
     "keys": lambda r: [("name", _norm(r.name))], "name": lambda r: r.name},
    # Colours are copied under the target plant's company of the same name (handled below).
    {"key": "parchment_colours", "label": "Parchment colours", "model": models.ParchmentColor, "keys": None,
     "name": lambda r: f"{r.vendor.name if r.vendor else ''} {r.color_name}".strip()},
    {"key": "boxes", "label": "Boxes", "model": models.PackagingBox,
     "keys": lambda r: [("code", _norm(r.code))], "name": lambda r: f"{r.code} {r.size_label}"},
    {"key": "plastic_sheets", "label": "Plastic sheets", "model": models.PackagingPlasticSheet,
     "keys": lambda r: [("code", _norm(r.sku))], "name": lambda r: f"{r.sku} {r.size_label}"},
    {"key": "fadda", "label": "Fadda", "model": models.PackagingFadda,
     "keys": lambda r: [("code", _norm(r.sku))], "name": lambda r: r.sku},
    {"key": "customers", "label": "Customers", "model": models.Customer,
     "keys": lambda r: [("code", _norm(r.customer_code)), ("name", _norm(r.name))],
     "name": lambda r: f"{r.customer_code} {r.name}", "children": ("contacts", models.CustomerContact, "customer_id")},
    {"key": "suppliers", "label": "Suppliers", "model": models.Supplier,
     "keys": lambda r: [("code", _norm(r.supplier_code)), ("name", _norm(r.name))],
     "name": lambda r: f"{r.supplier_code} {r.name}", "children": ("contacts", models.SupplierContact, "supplier_id")},
    {"key": "tools", "label": "Tool list", "model": models.ToolMaster, "active": _tool_active,
     "keys": lambda r: [("tool", _norm(r.category), _norm(r.name))], "name": lambda r: f"{r.category} {r.name}",
     "reset": {"usage_count": 0}},
    {"key": "tool_options", "label": "Tool dropdown values", "model": models.ToolAttributeOption,
     "keys": lambda r: [("option", _norm(r.category), _norm(r.field_key), _norm(r.value))],
     "name": lambda r: f"{r.category} {r.field_key}: {r.value}"},
]

# For the report: what is deliberately left with its plant.
NOT_COPIED = ["machines", "mandrels", "tube sizes", "employees", "shifts", "holidays", "reason codes",
              "specs", "stock", "transactions"]


def _rows(db: Session, model, plant_values: list[str]):
    return db.query(model).filter(model.plant_id.in_(plant_values)).order_by(model.created_at.asc(), model.id.asc()).all()


def _plan_simple(db: Session, spec: dict, source: list[str], target: list[str]) -> tuple[list, int]:
    """Source rows to copy and the count already in the target, for one master type."""
    existing: set[tuple] = set()
    for row in _rows(db, spec["model"], target):
        existing.update(spec["keys"](row))
    is_active: Callable = spec.get("active") or _is_active
    to_copy, already = [], 0
    for row in _rows(db, spec["model"], source):
        if not is_active(row):
            continue
        keys = spec["keys"](row)
        if existing.intersection(keys):
            already += 1
            continue
        # Mark as taken so a duplicate under a plant alias in the source is copied once.
        existing.update(keys)
        to_copy.append(row)
    return to_copy, already


def _plan_colours(db: Session, source: list[str], target: list[str]) -> tuple[list, int]:
    """Active colours of active source companies; matched on company name + colour name."""
    existing = {
        (_norm(colour.vendor.name), _norm(colour.color_name))
        for colour in db.query(models.ParchmentColor).join(models.ParchmentVendor)
        .filter(models.ParchmentVendor.plant_id.in_(target)).all()
    }
    to_copy, already = [], 0
    for colour in (db.query(models.ParchmentColor).join(models.ParchmentVendor)
                   .filter(models.ParchmentVendor.plant_id.in_(source))
                   .order_by(models.ParchmentColor.created_at.asc(), models.ParchmentColor.id.asc()).all()):
        if not (_is_active(colour) and _is_active(colour.vendor)):
            continue
        key = (_norm(colour.vendor.name), _norm(colour.color_name))
        if key in existing:
            already += 1
            continue
        existing.add(key)
        to_copy.append(colour)
    return to_copy, already


def _copy_rows(db: Session, spec: dict, rows: list, target_plant: str) -> int:
    """Insert copies of the planned rows (and active child contacts) into the target plant."""
    children = spec.get("children")
    contacts = 0
    for row in rows:
        values = {**_values(row), **(spec.get("reset") or {})}
        clone = spec["model"](id=uuid.uuid4(), plant_id=target_plant, **values)
        db.add(clone)
        if children:
            relation, child_model, parent_column = children
            for child in getattr(row, relation):
                if not _is_active(child):
                    continue
                db.add(child_model(id=uuid.uuid4(), plant_id=target_plant, **{**_values(child, skip=(parent_column,)), parent_column: clone.id}))
                contacts += 1
    return contacts


def _copy_colours(db: Session, colours: list, target: list[str], target_plant: str) -> None:
    db.flush()  # companies copied just before are now visible
    vendors = {_norm(vendor.name): vendor for vendor in db.query(models.ParchmentVendor).filter(models.ParchmentVendor.plant_id.in_(target)).all()}
    for colour in colours:
        # The company is in the target: it was there already or was copied in the step before.
        vendor = vendors[_norm(colour.vendor.name)]
        db.add(models.ParchmentColor(id=uuid.uuid4(), plant_id=target_plant, **{**_values(colour, skip=("vendor_id",)), "vendor_id": vendor.id}))


def _active_plants(token: str) -> Optional[list[dict]]:
    """Active plants from the auth-service plant master (None when it cannot be read)."""
    try:
        response = requests.get(f"{AUTH_SERVICE_URL}/plants", headers={"Authorization": f"Bearer {token}"}, timeout=3.0)
        if response.status_code >= 300:
            return None
        rows = response.json() or []
        if isinstance(rows, dict):
            rows = rows.get("items") or []
        return [row for row in rows if isinstance(row, dict) and row.get("is_active", True) is not False]
    except Exception as exc:  # pragma: no cover - network
        logger.warning("plant master unavailable for copy-common: %s", exc)
        return None


def _find_plant(plants: list[dict], plant_id: str) -> Optional[dict]:
    wanted = set(get_plant_aliases(plant_id))
    return next((row for row in plants if wanted.intersection({str(row.get("id") or ""), str(row.get("code") or "")})), None)


@router.post("/copy-common")
def copy_common_masters(
    payload: CopyCommonRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
    token: str = Depends(oauth2_scheme),
):
    """Owner/Admin: copy the common masters from one plant into another. dry_run=true only counts."""
    if not set(current_user.get("roles") or []).intersection(SUPER_ROLES):
        raise HTTPException(status_code=403, detail="Only Owner or Admin can copy masters between plants")
    source_id = str(payload.source_plant_id or "").strip()
    target_id = str(payload.target_plant_id or "").strip()
    if not source_id or not target_id or "ALL" in {source_id.upper(), target_id.upper()}:
        raise HTTPException(status_code=400, detail="Pick one source plant and one target plant")
    if set(get_plant_aliases(source_id)).intersection(get_plant_aliases(target_id)):
        raise HTTPException(status_code=400, detail="Source and target must be different plants")
    # Both plants must be inside the caller's allowed plants (same rule as every other plant request).
    _resolve_scope(current_user, source_id, allow_all=False)
    _resolve_scope(current_user, target_id, allow_all=False)

    plants = _active_plants(token)
    if plants is None:
        raise HTTPException(status_code=503, detail="Plant list could not be read. Try again.")
    target_plant = _find_plant(plants, target_id)
    if not target_plant:
        raise HTTPException(status_code=404, detail="Target plant not found or not active")
    # New rows are stored under the plant's id, like every other master of that plant.
    target_store = str(target_plant.get("id") or target_id)
    if set(get_plant_aliases(source_id)).intersection(get_plant_aliases(target_store)):
        raise HTTPException(status_code=400, detail="Source and target must be different plants")

    source = accepted_persisted_plant_ids(source_id)
    target = sorted(set(accepted_persisted_plant_ids(target_id)) | set(accepted_persisted_plant_ids(target_store)))

    types: list[dict[str, Any]] = []
    try:
        for spec in COMMON_TYPES:
            if spec["key"] == "parchment_colours":
                rows, already = _plan_colours(db, source, target)
            else:
                rows, already = _plan_simple(db, spec, source, target)
            entry: dict[str, Any] = {
                "key": spec["key"],
                "label": spec["label"],
                "to_copy": len(rows),
                "already_there": already,
                "samples": [str(spec["name"](row)).strip() for row in rows[:SAMPLE_SIZE]],
            }
            if not payload.dry_run and rows:
                if spec["key"] == "parchment_colours":
                    _copy_colours(db, rows, target, target_store)
                else:
                    contacts = _copy_rows(db, spec, rows, target_store)
                    if spec.get("children"):
                        entry["contacts"] = contacts
                db.flush()
            elif spec.get("children"):
                entry["contacts"] = sum(1 for row in rows for child in getattr(row, spec["children"][0]) if _is_active(child))
            types.append(entry)
        if payload.dry_run:
            db.rollback()
        else:
            db.commit()
    except IntegrityError as exc:
        db.rollback()
        logger.warning("copy-common conflict: %s", exc)
        raise HTTPException(status_code=409, detail="Another change to these masters happened at the same time. Press Check again.") from exc

    total = sum(entry["to_copy"] for entry in types)
    result = {
        "dry_run": payload.dry_run,
        "source_plant_id": source_id,
        "target_plant_id": target_store,
        "types": types,
        "not_copied": NOT_COPIED,
    }
    result["total_to_copy" if payload.dry_run else "copied"] = total
    if not payload.dry_run:
        # Each copied row is also in the transactional audit outbox (one CREATED event per row).
        try:
            emit_audit_event(
                token=token,
                event_type="common_masters_copied",
                entity_type="plant",
                entity_id=target_store,
                plant_id=target_store,
                actor_role=",".join(current_user.get("roles") or []),
                actor_email=current_user.get("sub"),
                summary=f"Copied {total} common master rows from {source_id} to {target_store}",
                payload={"source_plant_id": source_id, "counts": {entry["key"]: entry["to_copy"] for entry in types}},
            )
        except Exception as exc:  # pragma: no cover - best effort
            logger.warning("audit emit failed (common_masters_copied): %s", exc)
    return result
