"""Packing setup: packing-only amendments of live specs (owner decision 5, 1 Nov 2026).

The Owner/Admin sets box (master), qty per box, plastic and fadda on every active spec from one page.
A save rewrites only the packing keys of the spec, keeps its version number and approval, and is
recorded as a packing amendment (``spec_packing_amendments`` + season event). The new packing is then
pushed into open job cards of the spec that have not packed a box yet (production-service).
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import RecipeHeader, SpecDynamicFieldValue, SpecPackingAmendment, SpecificationSheet
from ..packing import (
    PACKING_AMENDMENT_KEYS,
    amended_packing_values,
    amendment_summary,
    changed_keys,
    current_packing,
    fetch_packaging_masters,
    packing_blockers,
)
from ..save_ops import bump_write_revision
from ..season_models import RecipeBinding, SeasonEvent, SeasonReceipt
from ..utils.auth import apply_plant_scope, get_current_plant, get_current_plant_scope, get_current_user, require_role
from .seasonal import confirmation_hash, load_spec, lock_state, receipt, refresh_readiness, version_check
from .specs import PROFILE_JSON_KEY, _dynamic_field_map, _safe_json_loads, _upsert_compat_dynamic_values
from season_quality import fingerprint

router = APIRouter(tags=["packing setup"])


class PackingAmendmentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(min_length=8, max_length=100)
    expected_version: Optional[int] = None
    box_code: str
    qty_per_box: float
    plastic_sku: Optional[str] = None
    plastic_per_box: Optional[float] = None
    fadda_sku: Optional[str] = None
    fadda_per_box: Optional[float] = None
    note: str = ""


def _amendment_dict(row: SpecPackingAmendment) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "spec_id": str(row.spec_id),
        "spec_version": row.spec_version,
        "spec_status": row.spec_status,
        "write_revision_before": row.write_revision_before,
        "write_revision_after": row.write_revision_after,
        "before": row.before,
        "after": row.after,
        "changed_keys": row.changed_keys,
        "summary": amendment_summary(row.after or {}),
        "note": row.note,
        "actor": row.actor,
        "job_cards_updated": row.job_cards_updated,
        "created_at": row.created_at,
    }


def _measure(spec: SpecificationSheet, dynamic: dict[str, Any], key: str) -> Any:
    value = dynamic.get(key)
    try:
        return float(value) if value not in (None, "") else getattr(spec, key, None)
    except (TypeError, ValueError):
        return getattr(spec, key, None)


def _setup_issues(packing: dict[str, Any], masters: Optional[dict[str, dict[str, Any]]]) -> list[str]:
    """What still keeps this spec's packing from being complete for the Packing setup page."""
    issues: list[str] = []
    if masters is None:
        return issues

    def in_master(code: str, kind: str) -> bool:
        row = masters.get(code.upper())
        return bool(row and row.get("kind") == kind)

    if packing["box_code"] and not in_master(packing["box_code"], "BOX"):
        issues.append(f"Box {packing['box_code']} is not in the Packaging master")
    for kind, label in (("PLASTIC", "plastic"), ("FADDA", "fadda")):
        code, count = packing[f"{label}_sku"], packing[f"{label}_per_box"]
        if code and not in_master(code, kind):
            issues.append(f"{label.capitalize()} {code} is not in the Packaging master")
        elif not code and count:
            issues.append(f"{label.capitalize()} per box is {count:g} but no {label} is chosen")
    return issues


def _row(spec: SpecificationSheet, last: Optional[SpecPackingAmendment], masters: Optional[dict[str, dict[str, Any]]] = None) -> dict[str, Any]:
    dynamic = _dynamic_field_map(spec)
    blockers = packing_blockers(dynamic) + _setup_issues(current_packing(dynamic), masters)
    return {
        "id": str(spec.id),
        "lineage_id": str(spec.lineage_id or spec.id),
        "plant_id": spec.plant_id,
        "version": spec.version,
        "status": spec.status,
        "seasonal_model": bool(spec.seasonal_model),
        "write_revision": int(spec.write_revision or 1),
        "customer_id": dynamic.get("customer_id") or (str(spec.customer_id) if spec.customer_id else None),
        "customer_name": dynamic.get("customer_name_snapshot") or spec.customer_name,
        "tube_size_id": str(spec.tube_size_id) if spec.tube_size_id else None,
        **{key: _measure(spec, dynamic, key) for key in ("id_min_mm", "id_max_mm", "od_min_mm", "od_max_mm", "length_min_mm", "length_max_mm")},
        "target_tube_weight": spec.target_tube_weight,
        "required_cs": spec.required_cs,
        "packing": current_packing(dynamic),
        "complete": not blockers,
        "blockers": blockers,
        "last_amendment": _amendment_dict(last) if last else None,
    }


@router.get("/specs/packing-setup")
def packing_setup_rows(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    user: dict = Depends(require_role(["Owner", "Admin"])),
):
    """Every active spec with its packing, for the Packing setup page (filters run in the browser)."""
    specs = (
        apply_plant_scope(db.query(SpecificationSheet).filter(SpecificationSheet.active == True), SpecificationSheet.plant_id, plant_scope)
        .options(selectinload(SpecificationSheet.dynamic_values).selectinload(SpecDynamicFieldValue.field))
        .order_by(SpecificationSheet.customer_name.asc(), SpecificationSheet.version.desc())
        .all()
    )
    latest: dict[uuid.UUID, SpecPackingAmendment] = {}
    if specs:
        for row in (
            db.query(SpecPackingAmendment)
            .filter(SpecPackingAmendment.spec_id.in_([spec.id for spec in specs]))
            .order_by(SpecPackingAmendment.created_at.asc())
            .all()
        ):
            latest[row.spec_id] = row
    token = str(user.get("token") or "")
    masters = {plant: fetch_packaging_masters(plant_id=plant, token=token) for plant in sorted({spec.plant_id for spec in specs})}
    items = [_row(spec, latest.get(spec.id), masters[spec.plant_id]) for spec in specs]
    return {"items": items, "total": len(items), "complete": sum(1 for item in items if item["complete"])}


@router.get("/specs/{spec_id}/packing-amendments")
def packing_amendments(
    spec_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    user: dict = Depends(get_current_user),
):
    """Packing amendments of this spec and the earlier versions of the same spec, newest first."""
    spec = apply_plant_scope(db.query(SpecificationSheet).filter(SpecificationSheet.id == spec_id), SpecificationSheet.plant_id, plant_scope).first()
    if not spec:
        raise HTTPException(404, "Specification not found")
    lineage = spec.lineage_id or spec.id
    rows = (
        db.query(SpecPackingAmendment)
        .filter(or_(SpecPackingAmendment.spec_id == spec.id, SpecPackingAmendment.lineage_id == lineage))
        .order_by(SpecPackingAmendment.created_at.desc())
        .limit(50)
        .all()
    )
    return {"spec_id": str(spec.id), "items": [_amendment_dict(row) for row in rows]}


def _lineage_spec_ids(db: Session, spec: SpecificationSheet) -> list[str]:
    """This spec and every earlier/later version of it: open cards on an older version get the packing too."""
    lineage = spec.lineage_id or spec.id
    rows = (
        db.query(SpecificationSheet.id)
        .filter(
            SpecificationSheet.plant_id == spec.plant_id,
            or_(SpecificationSheet.id == spec.id, SpecificationSheet.id == lineage, SpecificationSheet.lineage_id == lineage),
        )
        .all()
    )
    return sorted({str(row[0]) for row in rows} | {str(spec.id)})


def _rewrite_profile_packing(db: Session, spec: SpecificationSheet, values: dict[str, str]) -> None:
    """The stored profile JSON also carries packing; keep it equal to the amended values."""
    holder = next((value for value in spec.dynamic_values if value.field and value.field.key == PROFILE_JSON_KEY), None)
    if holder is None:
        return
    profile = _safe_json_loads(holder.value, None)
    if not isinstance(profile, dict):
        return
    packing = dict(profile.get("packing") or {})
    rules = dict(profile.get("packing_rules") or {})
    target = dict(rules.get("packing_target") or {})
    for key in PACKING_AMENDMENT_KEYS:
        for section in (packing, target):
            if values.get(key) in (None, ""):
                section.pop(key, None)
            else:
                section[key] = values[key]
    profile["packing"] = packing
    rules["packing_target"] = target
    profile["packing_rules"] = rules
    holder.value = json.dumps(profile)


def push_packing_to_job_cards(*, spec_ids: list[str], values: dict[str, str], source: dict[str, Any], plant_id: str, token: str) -> dict[str, Any]:
    """Refresh the packing in open job cards that have not packed a box yet. Never raises."""
    url = os.getenv("PRODUCTION_SERVICE_URL", "http://127.0.0.1:18004")
    try:
        response = httpx.post(
            f"{url}/job-cards/packing-refresh",
            json={"spec_ids": spec_ids, "values": values, "source": source},
            headers={"Authorization": f"Bearer {token}", "X-Plant-ID": str(plant_id)},
            timeout=20.0,
        )
    except httpx.HTTPError as exc:
        return {"updated": 0, "error": f"Job cards were not updated (production service unreachable: {exc}). Save again to retry."}
    if response.status_code >= 400:
        return {"updated": 0, "error": f"Job cards were not updated (production answered {response.status_code}). Save again to retry."}
    try:
        return response.json()
    except ValueError:
        return {"updated": 0, "error": "Job cards answer could not be read. Save again to retry."}


@router.put("/specs/{spec_id}/packing")
def amend_spec_packing(
    spec_id: uuid.UUID,
    payload: PackingAmendmentInput,
    db: Session = Depends(get_db),
    plant: str = Depends(get_current_plant),
    user: dict = Depends(require_role(["Owner", "Admin"])),
):
    """Save the packing straight to the spec as an audited packing amendment (no re-approval)."""
    lock_state(db)  # same lock as release authorization: the spec revision moves on below
    key = f"packing:{plant}:{payload.request_id}"
    content = payload.model_dump()
    prior = receipt(db, key, content)
    if prior:
        return {**prior, "replayed": True}
    spec = load_spec(db, spec_id, plant, lock=True)
    if not spec.active:
        raise HTTPException(409, "Only the active version of a specification can take a packing amendment. Refresh the list.")
    version_check(int(spec.write_revision or 1), payload.expected_version)
    masters = fetch_packaging_masters(plant_id=plant, token=str(user.get("token") or ""))
    values = amended_packing_values(
        box_code=payload.box_code,
        qty_per_box=payload.qty_per_box,
        plastic_sku=payload.plastic_sku,
        plastic_per_box=payload.plastic_per_box,
        fadda_sku=payload.fadda_sku,
        fadda_per_box=payload.fadda_per_box,
        masters=masters,
    )
    dynamic = _dynamic_field_map(spec)
    before = {name: dynamic.get(name) for name in PACKING_AMENDMENT_KEYS}
    changed = changed_keys(before, values)
    amendment: Optional[SpecPackingAmendment] = None
    if changed:
        revision_before = int(spec.write_revision or 1)
        bindings = db.query(RecipeBinding).filter_by(spec_id=spec.id).all()
        recipes = {
            recipe_id: db.get(RecipeHeader, recipe_id)
            for binding in bindings
            for recipe_id in (binding.recipe_id, binding.draft_recipe_id)
            if recipe_id
        }
        old_hashes = {recipe_id: confirmation_hash(spec, recipe) for recipe_id, recipe in recipes.items() if recipe}
        _upsert_compat_dynamic_values(spec.id, values, plant_id=spec.plant_id, db=db)
        _rewrite_profile_packing(db, spec, values)
        bump_write_revision(spec)
        spec.updated_at = datetime.utcnow()
        db.flush()
        # Packing is not part of the recipe: the spec revision moves on, but a recipe that was approved or
        # confirmed for this spec stays approved/confirmed (its hash is re-stamped, never newly granted).
        new_hashes = {recipe_id: confirmation_hash(spec, recipe) for recipe_id, recipe in recipes.items() if recipe}
        for binding in bindings:
            if binding.approved_context and binding.approved_context == old_hashes.get(binding.recipe_id):
                binding.approved_context = new_hashes[binding.recipe_id]
            for recipe_id in (binding.recipe_id, binding.draft_recipe_id):
                if recipe_id and binding.confirmed_hash and binding.confirmed_hash == old_hashes.get(recipe_id):
                    binding.confirmed_hash = new_hashes[recipe_id]
                    break
        amendment = SpecPackingAmendment(
            plant_id=spec.plant_id,
            spec_id=spec.id,
            lineage_id=spec.lineage_id or spec.id,
            spec_version=int(spec.version or 1),
            spec_status=spec.status,
            write_revision_before=revision_before,
            write_revision_after=int(spec.write_revision),
            before=before,
            after=values,
            changed_keys=changed,
            note=payload.note.strip() or None,
            actor=str(user.get("sub") or user.get("email") or "unknown"),
            request_id=payload.request_id,
        )
        db.add(amendment)
        db.add(SeasonEvent(action="spec_packing_amended", actor=str(user.get("sub") or "unknown"), note=payload.note.strip() or amendment_summary(values),
                           payload=jsonable_encoder({"spec_id": str(spec.id), "spec_version": spec.version, "before": before, "after": values, "changed_keys": changed})))
        db.flush()
        refresh_readiness(db, [spec.id])
    db.commit()
    db.refresh(spec)
    cards = push_packing_to_job_cards(
        spec_ids=_lineage_spec_ids(db, spec),
        values=values,
        source={"spec_id": str(spec.id), "spec_version": spec.version, "amendment_id": str(amendment.id) if amendment else None,
                "by": str(user.get("sub") or ""), "summary": amendment_summary(values)},
        plant_id=plant,
        token=str(user.get("token") or ""),
    )
    if amendment is not None:
        amendment.job_cards_updated = int(cards.get("updated") or 0)
        amendment.job_cards_result = jsonable_encoder(cards)
    last = amendment or db.query(SpecPackingAmendment).filter_by(spec_id=spec.id).order_by(SpecPackingAmendment.created_at.desc()).first()
    response = jsonable_encoder({
        "spec": _row(spec, last, masters),
        "amended": bool(changed),
        "changed_keys": changed,
        "amendment": _amendment_dict(amendment) if amendment else None,
        "job_cards": cards,
    })
    db.add(SeasonReceipt(operation_key=key, fingerprint=fingerprint(jsonable_encoder(content)), response=response))
    db.commit()
    return response
