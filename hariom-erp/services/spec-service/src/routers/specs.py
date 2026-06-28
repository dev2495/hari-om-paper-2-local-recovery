import json
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    GlobalSpecDefaults,
    RecipeHeader,
    SpecDynamicField,
    SpecDynamicFieldValue,
    SpecificationSheet,
)
from .. import spec_math
from ..services.approval import ApprovalService
from ..utils.auth import (
    apply_plant_scope,
    get_current_plant,
    get_current_plant_scope,
    get_current_user,
    require_role,
)
from ..config import get_settings

router = APIRouter(prefix="/specs", tags=["specifications"])
settings = get_settings()

PROFILE_JSON_KEY = "profile_json"

COMPAT_DYNAMIC_FIELDS: dict[str, dict[str, str]] = {
    "customer_id": {"label": "Customer ID", "field_type": "text"},
    "customer_name_snapshot": {"label": "Customer Name Snapshot", "field_type": "text"},
    "id_min_mm": {"label": "ID Min (mm)", "field_type": "number"},
    "id_max_mm": {"label": "ID Max (mm)", "field_type": "number"},
    "od_min_mm": {"label": "OD Min (mm)", "field_type": "number"},
    "od_max_mm": {"label": "OD Max (mm)", "field_type": "number"},
    "length_min_mm": {"label": "Length Min (mm)", "field_type": "number"},
    "length_max_mm": {"label": "Length Max (mm)", "field_type": "number"},
    "weight_min_g": {"label": "Weight Min (g)", "field_type": "number"},
    "weight_max_g": {"label": "Weight Max (g)", "field_type": "number"},
    "cs_min_n": {"label": "CS Min (N)", "field_type": "number"},
    "cs_max_n": {"label": "CS Max (N)", "field_type": "number"},
    "moisture_min_pct": {"label": "Moisture Min (%)", "field_type": "number"},
    "moisture_max_pct": {"label": "Moisture Max (%)", "field_type": "number"},
    "adhesive_components_json": {"label": "Adhesive Components", "field_type": "text"},
    "recipe_sheet_json": {"label": "Recipe Sheet", "field_type": "text"},
    "candidate_papers_json": {"label": "Candidate Papers", "field_type": "text"},
    "notch_required": {"label": "Notch Required", "field_type": "boolean"},
    "top_paper_required": {"label": "Top Paper Required", "field_type": "boolean"},
    "notch_type": {"label": "Notch Type", "field_type": "text"},
    "notch_distance_mm": {"label": "Notch Distance (mm)", "field_type": "number"},
    "notch_depth_mm": {"label": "Notch Depth (mm)", "field_type": "number"},
    "notching_holder": {"label": "Holder", "field_type": "text"},
    "notching_blade": {"label": "Blade", "field_type": "text"},
    "v_flat": {"label": "V + Flat", "field_type": "text"},
    "punch": {"label": "Punch", "field_type": "text"},
    "notch_wider": {"label": "Notch Wider", "field_type": "boolean"},
    "notch_patti": {"label": "Notch Patti", "field_type": "boolean"},
    "notch_direction": {"label": "Notch Direction", "field_type": "text"},
    "tube_direction": {"label": "Tube Direction", "field_type": "text"},
    "notch_position": {"label": "Notch Position", "field_type": "text"},
    "bundle_type": {"label": "Bundle Type", "field_type": "text"},
    "bundle_code": {"label": "Bundle Code", "field_type": "text"},
    "packing_ply": {"label": "Packing Ply", "field_type": "number"},
    "qty_per_box": {"label": "Quantity per Box", "field_type": "number"},
    "packing_pcs": {"label": "Packing PCS", "field_type": "number"},
    "box_code": {"label": "Box Code", "field_type": "text"},
    "box_size": {"label": "Box Size", "field_type": "text"},
    "plastic_required": {"label": "Plastic Required", "field_type": "boolean"},
    "plastic_sku": {"label": "Plastic SKU", "field_type": "text"},
    "plastic_per_box": {"label": "Plastic per Box", "field_type": "number"},
    "fadda_sku": {"label": "Fadda SKU", "field_type": "text"},
    "fadda_per_box": {"label": "Fadda per Box", "field_type": "number"},
    "bopp_required": {"label": "BOPP Required", "field_type": "boolean"},
    "special_instructions": {"label": "Special Instructions", "field_type": "text"},
    PROFILE_JSON_KEY: {"label": "Profile JSON", "field_type": "text"},
}


class DynamicFieldValueInput(BaseModel):
    field_key: str
    value: Optional[str] = None


class DynamicFieldValueResponse(BaseModel):
    field_key: str
    label: str
    value: Optional[str]
    field_type: str


class SpecCreate(BaseModel):
    customer_name: Optional[str] = None
    customer_id: Optional[str] = None
    customer_name_snapshot: Optional[str] = None
    tube_size_id: uuid.UUID
    mandrel_id: uuid.UUID
    required_cs: float
    target_tube_weight: float
    id_min_mm: Optional[float] = None
    id_max_mm: Optional[float] = None
    od_min_mm: Optional[float] = None
    od_max_mm: Optional[float] = None
    length_min_mm: Optional[float] = None
    length_max_mm: Optional[float] = None
    weight_min_g: Optional[float] = None
    weight_max_g: Optional[float] = None
    cs_min_n: Optional[float] = None
    cs_max_n: Optional[float] = None
    moisture_min_pct: Optional[float] = None
    moisture_max_pct: Optional[float] = None
    parchment_percent: Optional[float] = settings.DEFAULT_PARCHMENT_PERCENT
    parchment_color: Optional[str] = None
    parchment_allowed: Optional[bool] = True
    adhesive_percent: Optional[float] = 15.0
    moisture_loss_percent: Optional[float] = 9.0
    adhesive_20100_percent: Optional[float] = None
    adhesive_30100_percent: Optional[float] = None
    shrink_percent: Optional[float] = settings.DEFAULT_SHRINK_PERCENT
    profile: Optional[Dict[str, Any]] = None
    dynamic_fields: Optional[List[DynamicFieldValueInput]] = None


class SpecUpdate(BaseModel):
    customer_name: Optional[str] = None
    customer_id: Optional[str] = None
    customer_name_snapshot: Optional[str] = None
    tube_size_id: Optional[uuid.UUID] = None
    mandrel_id: Optional[uuid.UUID] = None
    required_cs: Optional[float] = None
    target_tube_weight: Optional[float] = None
    id_min_mm: Optional[float] = None
    id_max_mm: Optional[float] = None
    od_min_mm: Optional[float] = None
    od_max_mm: Optional[float] = None
    length_min_mm: Optional[float] = None
    length_max_mm: Optional[float] = None
    weight_min_g: Optional[float] = None
    weight_max_g: Optional[float] = None
    cs_min_n: Optional[float] = None
    cs_max_n: Optional[float] = None
    moisture_min_pct: Optional[float] = None
    moisture_max_pct: Optional[float] = None
    parchment_percent: Optional[float] = None
    parchment_color: Optional[str] = None
    parchment_allowed: Optional[bool] = None
    adhesive_percent: Optional[float] = None
    moisture_loss_percent: Optional[float] = None
    adhesive_20100_percent: Optional[float] = None
    adhesive_30100_percent: Optional[float] = None
    shrink_percent: Optional[float] = None
    profile: Optional[Dict[str, Any]] = None
    dynamic_fields: Optional[List[DynamicFieldValueInput]] = None


class SpecResponse(BaseModel):
    id: uuid.UUID
    customer_name: str
    customer_id: Optional[str] = None
    customer_name_snapshot: Optional[str] = None
    tube_size_id: uuid.UUID
    mandrel_id: uuid.UUID
    required_cs: float
    approved_cs: Optional[float]
    target_tube_weight: float
    id_min_mm: Optional[float] = None
    id_max_mm: Optional[float] = None
    od_min_mm: Optional[float] = None
    od_max_mm: Optional[float] = None
    length_min_mm: Optional[float] = None
    length_max_mm: Optional[float] = None
    weight_min_g: Optional[float] = None
    weight_max_g: Optional[float] = None
    cs_min_n: Optional[float] = None
    cs_max_n: Optional[float] = None
    moisture_min_pct: Optional[float] = None
    moisture_max_pct: Optional[float] = None
    parchment_percent: float
    parchment_color: Optional[str]
    parchment_allowed: bool = True
    adhesive_percent: float = 15.0
    moisture_loss_percent: float = 9.0
    adhesive_20100_percent: Optional[float]
    adhesive_30100_percent: Optional[float]
    shrink_percent: float
    bamboo_max_length: int
    cut_loss_mm: int
    status: str
    version: int
    active: bool
    created_by: Optional[str]
    approved_by: Optional[str]
    plant_id: str
    created_at: datetime
    recipe_sheet_json: Optional[str] = None
    adhesive_components_json: Optional[str] = None
    profile: Optional[Dict[str, Any]] = None
    dynamic_fields: List[DynamicFieldValueResponse]


class SpecDefaultsPayload(BaseModel):
    adhesive_percent: float = spec_math.GLOBAL_ADHESIVE_PERCENT
    parchment_percent: float = spec_math.GLOBAL_PARCHMENT_PERCENT
    moisture_loss_percent: float = spec_math.GLOBAL_MOISTURE_LOSS_PERCENT


class SpecDefaultsResponse(SpecDefaultsPayload):
    plant_id: str
    updated_at: datetime


def _default_dynamic_label(field_key: str) -> str:
    return field_key.replace("_", " ").strip().title() or "Dynamic Field"


def _guess_field_type(value: Optional[str]) -> str:
    if value is None:
        return "text"
    text = str(value).strip().lower()
    if text in {"true", "false", "yes", "no"}:
        return "boolean"
    try:
        float(text)
        return "number"
    except ValueError:
        return "text"


def _dynamic_field_map(spec: SpecificationSheet) -> dict[str, Optional[str]]:
    mapping: dict[str, Optional[str]] = {}
    for value in spec.dynamic_values:
        if not value.field:
            continue
        mapping[value.field.key] = value.value
    return mapping


def _float_or_none(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_json_loads(value: Any, fallback: Any) -> Any:
    if value in (None, ""):
        return fallback
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return fallback


def _normalize_dynamic_value(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    return str(value)


def _normalize_percent(value: float, field_name: str) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{field_name} must be numeric")
    if numeric < 0 or numeric > 100:
        raise HTTPException(status_code=400, detail=f"{field_name} must be between 0 and 100")
    return numeric


def _get_or_create_defaults(db: Session, plant_id: str) -> GlobalSpecDefaults:
    defaults = db.query(GlobalSpecDefaults).filter(GlobalSpecDefaults.plant_id == plant_id).first()
    if defaults:
        return defaults
    defaults = GlobalSpecDefaults(
        plant_id=plant_id,
        adhesive_percent=spec_math.GLOBAL_ADHESIVE_PERCENT,
        parchment_percent=spec_math.GLOBAL_PARCHMENT_PERCENT,
        moisture_loss_percent=spec_math.GLOBAL_MOISTURE_LOSS_PERCENT,
    )
    db.add(defaults)
    db.commit()
    db.refresh(defaults)
    return defaults


def _ensure_dynamic_field(
    *,
    key: str,
    plant_id: str,
    db: Session,
    label: Optional[str] = None,
    field_type: Optional[str] = None,
) -> SpecDynamicField:
    field = db.query(SpecDynamicField).filter(
        SpecDynamicField.key == key,
        SpecDynamicField.plant_id == plant_id,
    ).first()
    if field:
        return field

    meta = COMPAT_DYNAMIC_FIELDS.get(key, {})
    field = SpecDynamicField(
        key=key,
        label=label or meta.get("label") or _default_dynamic_label(key),
        field_type=field_type or meta.get("field_type") or "text",
        required=False,
        active=True,
        plant_id=plant_id,
    )
    db.add(field)
    db.flush()
    return field


def _profile_from_dynamic_map(dynamic_map: dict[str, Optional[str]]) -> Optional[dict[str, Any]]:
    stored_profile = _safe_json_loads(dynamic_map.get(PROFILE_JSON_KEY), None)
    profile = stored_profile if isinstance(stored_profile, dict) else {}

    recipe_payload = _safe_json_loads(dynamic_map.get("recipe_sheet_json"), {})
    adhesive_components = _safe_json_loads(dynamic_map.get("adhesive_components_json"), [])
    candidate_papers = _safe_json_loads(dynamic_map.get("candidate_papers_json"), [])

    if recipe_payload or adhesive_components or candidate_papers:
        recipe_profile = dict(profile.get("recipe") or {})
        if candidate_papers:
            recipe_profile["candidate_papers"] = candidate_papers
        if isinstance(recipe_payload, dict):
            rows = recipe_payload.get("rows")
            if isinstance(rows, list):
                recipe_profile["recipe_rows"] = rows
            elif isinstance(recipe_payload.get("recipe_rows"), list):
                recipe_profile["recipe_rows"] = recipe_payload.get("recipe_rows")
        if isinstance(adhesive_components, list):
            recipe_profile["adhesive_components"] = adhesive_components
        if recipe_profile:
            profile["recipe"] = recipe_profile

    notch_keys = [
        "notch_required",
        "top_paper_required",
        "notch_type",
        "notch_distance_mm",
        "notch_depth_mm",
        "notching_holder",
        "notching_blade",
        "v_flat",
        "punch",
        "notch_wider",
        "notch_patti",
        "notch_direction",
        "tube_direction",
        "notch_position",
    ]
    notch_payload = {key: dynamic_map.get(key) for key in notch_keys if dynamic_map.get(key) not in (None, "")}
    if notch_payload:
        notch_profile = dict(profile.get("notch_tooling") or {})
        notch_profile["diagram"] = {**dict(notch_profile.get("diagram") or {}), **notch_payload}
        profile["notch_tooling"] = notch_profile

    packing_keys = [
        "bundle_type",
        "bundle_code",
        "packing_ply",
        "qty_per_box",
        "packing_pcs",
        "box_code",
        "box_size",
        "plastic_required",
        "plastic_sku",
        "plastic_per_box",
        "fadda_sku",
        "fadda_per_box",
        "bopp_required",
        "special_instructions",
    ]
    packing_payload = {key: dynamic_map.get(key) for key in packing_keys if dynamic_map.get(key) not in (None, "")}
    if packing_payload:
        profile["packing"] = {**dict(profile.get("packing") or {}), **packing_payload}
        rules = dict(profile.get("packing_rules") or {})
        rules["packing_target"] = {**dict(rules.get("packing_target") or {}), **packing_payload}
        profile["packing_rules"] = rules

    return profile or None


def _compat_dynamic_values_from_payload(payload: SpecCreate | SpecUpdate) -> dict[str, Any]:
    compat_values = {
        key: getattr(payload, key, None)
        for key in [
            "customer_id",
            "customer_name_snapshot",
            "id_min_mm",
            "id_max_mm",
            "od_min_mm",
            "od_max_mm",
            "length_min_mm",
            "length_max_mm",
            "weight_min_g",
            "weight_max_g",
            "cs_min_n",
            "cs_max_n",
            "moisture_min_pct",
            "moisture_max_pct",
        ]
        if getattr(payload, key, None) is not None
    }

    profile = getattr(payload, "profile", None)
    if isinstance(profile, dict):
        compat_values[PROFILE_JSON_KEY] = profile

        recipe_profile = dict(profile.get("recipe") or {})
        candidate_papers = recipe_profile.get("candidate_papers")
        if candidate_papers is not None:
            compat_values["candidate_papers_json"] = candidate_papers

        recipe_rows = recipe_profile.get("recipe_rows")
        if recipe_rows is not None:
            compat_values["recipe_sheet_json"] = {"rows": recipe_rows}
        elif recipe_profile.get("rows") is not None:
            compat_values["recipe_sheet_json"] = {"rows": recipe_profile.get("rows")}

        if recipe_profile.get("adhesive_components") is not None:
            compat_values["adhesive_components_json"] = recipe_profile.get("adhesive_components")

        notch_payload = dict(((profile.get("notch_tooling") or {}).get("diagram")) or {})
        for key in [
            "notch_required",
            "top_paper_required",
            "notch_type",
            "notch_distance_mm",
            "notch_depth_mm",
            "notching_holder",
            "notching_blade",
            "v_flat",
            "punch",
            "notch_wider",
            "notch_patti",
            "notch_direction",
            "tube_direction",
            "notch_position",
        ]:
            if notch_payload.get(key) is not None:
                compat_values[key] = notch_payload.get(key)

        packing_payload = {
            **dict((((profile.get("packing_rules") or {}).get("packing_target")) or {})),
            **dict(profile.get("packing") or {}),
        }
        for key in [
            "bundle_type",
            "bundle_code",
            "packing_ply",
            "qty_per_box",
            "packing_pcs",
            "box_code",
            "box_size",
            "plastic_required",
            "plastic_sku",
            "plastic_per_box",
            "fadda_sku",
            "fadda_per_box",
            "bopp_required",
            "special_instructions",
        ]:
            if packing_payload.get(key) is not None:
                compat_values[key] = packing_payload.get(key)

    return compat_values


def _serialize_spec(spec: SpecificationSheet) -> dict:
    dynamic_map = _dynamic_field_map(spec)
    recipe_sheet_json = dynamic_map.get("recipe_sheet_json")
    adhesive_components_json = dynamic_map.get("adhesive_components_json")

    dynamic_values = []
    for value in spec.dynamic_values:
        if not value.field:
            continue
        dynamic_values.append(
            {
                "field_key": value.field.key,
                "label": value.field.label,
                "value": value.value,
                "field_type": value.field.field_type,
            }
        )

    return {
        "id": spec.id,
        "customer_name": spec.customer_name,
        "customer_id": dynamic_map.get("customer_id"),
        "customer_name_snapshot": dynamic_map.get("customer_name_snapshot") or spec.customer_name,
        "tube_size_id": spec.tube_size_id,
        "mandrel_id": spec.mandrel_id,
        "required_cs": spec.required_cs,
        "approved_cs": spec.approved_cs,
        "target_tube_weight": spec.target_tube_weight,
        "id_min_mm": _float_or_none(dynamic_map.get("id_min_mm")) or spec.id_min_mm,
        "id_max_mm": _float_or_none(dynamic_map.get("id_max_mm")) or spec.id_max_mm,
        "od_min_mm": _float_or_none(dynamic_map.get("od_min_mm")) or spec.od_min_mm,
        "od_max_mm": _float_or_none(dynamic_map.get("od_max_mm")) or spec.od_max_mm,
        "length_min_mm": _float_or_none(dynamic_map.get("length_min_mm")) or spec.length_min_mm,
        "length_max_mm": _float_or_none(dynamic_map.get("length_max_mm")) or spec.length_max_mm,
        "weight_min_g": _float_or_none(dynamic_map.get("weight_min_g")) or spec.weight_min_g,
        "weight_max_g": _float_or_none(dynamic_map.get("weight_max_g")) or spec.weight_max_g,
        "cs_min_n": _float_or_none(dynamic_map.get("cs_min_n")) or spec.cs_min_n,
        "cs_max_n": _float_or_none(dynamic_map.get("cs_max_n")) or spec.cs_max_n,
        "moisture_min_pct": _float_or_none(dynamic_map.get("moisture_min_pct")) or spec.moisture_min_pct,
        "moisture_max_pct": _float_or_none(dynamic_map.get("moisture_max_pct")) or spec.moisture_max_pct,
        "parchment_percent": spec.parchment_percent,
        "parchment_color": spec.parchment_color,
        "parchment_allowed": bool(spec.parchment_allowed) if spec.parchment_allowed is not None else True,
        "adhesive_percent": float(spec.adhesive_percent) if spec.adhesive_percent is not None else 15.0,
        "moisture_loss_percent": float(spec.moisture_loss_percent) if spec.moisture_loss_percent is not None else 9.0,
        "adhesive_20100_percent": spec.adhesive_20100_percent,
        "adhesive_30100_percent": spec.adhesive_30100_percent,
        "shrink_percent": spec.shrink_percent,
        "bamboo_max_length": spec.bamboo_max_length,
        "cut_loss_mm": spec.cut_loss_mm,
        "status": spec.status,
        "version": spec.version,
        "active": spec.active,
        "created_by": spec.created_by,
        "approved_by": spec.approved_by,
        "plant_id": spec.plant_id,
        "created_at": spec.created_at,
        "recipe_sheet_json": recipe_sheet_json,
        "adhesive_components_json": adhesive_components_json,
        "profile": _profile_from_dynamic_map(dynamic_map),
        "dynamic_fields": sorted(dynamic_values, key=lambda x: x["field_key"]),
    }


def _upsert_dynamic_values(
    spec_id: uuid.UUID,
    dynamic_fields: Optional[List[DynamicFieldValueInput]],
    plant_id: str,
    db: Session,
):
    if dynamic_fields is None:
        return

    field_map = {
        field.key: field
        for field in db.query(SpecDynamicField).filter(
            SpecDynamicField.active == True,
            SpecDynamicField.plant_id == plant_id,
        ).all()
    }

    deduped_entries: dict[str, Optional[str]] = {}
    for entry in dynamic_fields:
        key = str(entry.field_key or "").strip()
        if key:
            deduped_entries[key] = entry.value

    for field_key, entry_value in deduped_entries.items():
        field = field_map.get(field_key)
        if not field:
            field = _ensure_dynamic_field(
                key=field_key,
                plant_id=plant_id,
                label=_default_dynamic_label(field_key),
                field_type=_guess_field_type(entry_value),
                db=db,
            )
            field_map[field_key] = field

        value_model = db.query(SpecDynamicFieldValue).filter(
            SpecDynamicFieldValue.spec_id == spec_id,
            SpecDynamicFieldValue.field_id == field.id
        ).first()

        if not value_model:
            value_model = SpecDynamicFieldValue(
                spec_id=spec_id,
                plant_id=plant_id,
                field_id=field.id,
                value=entry_value
            )
            db.add(value_model)
        else:
            value_model.plant_id = plant_id
            value_model.value = entry_value


def _upsert_compat_dynamic_values(
    spec_id: uuid.UUID,
    compat_values: dict[str, Any],
    *,
    plant_id: str,
    db: Session,
):
    if compat_values:
        db.flush()
    for key, raw_value in compat_values.items():
        field = _ensure_dynamic_field(key=key, plant_id=plant_id, db=db)
        stored_value = _normalize_dynamic_value(raw_value)
        value_model = db.query(SpecDynamicFieldValue).filter(
            SpecDynamicFieldValue.spec_id == spec_id,
            SpecDynamicFieldValue.field_id == field.id,
        ).first()
        if not value_model:
            value_model = SpecDynamicFieldValue(
                spec_id=spec_id,
                plant_id=plant_id,
                field_id=field.id,
                value=stored_value,
            )
            db.add(value_model)
        else:
            value_model.plant_id = plant_id
            value_model.value = stored_value


def _merged_dynamic_fields_for_replacement(
    previous: SpecificationSheet,
    payload_fields: Optional[List[DynamicFieldValueInput]],
) -> List[DynamicFieldValueInput]:
    merged: dict[str, Optional[str]] = {}
    for value in previous.dynamic_values:
        if value.field:
            merged[value.field.key] = value.value
    for entry in payload_fields or []:
        merged[entry.field_key] = entry.value
    return [DynamicFieldValueInput(field_key=key, value=value) for key, value in merged.items()]


def _replacement_spec_from_payload(
    *,
    previous: SpecificationSheet,
    payload: SpecUpdate,
    plant_id: str,
    current_user: dict,
) -> SpecificationSheet:
    updates = payload.model_dump(exclude_unset=True, exclude={"dynamic_fields", "profile"})

    def resolved(field: str):
        return updates[field] if field in updates else getattr(previous, field)

    customer_name = str(
        updates.get("customer_name")
        or updates.get("customer_name_snapshot")
        or previous.customer_name_snapshot
        or previous.customer_name
        or ""
    ).strip()
    if not customer_name:
        raise HTTPException(status_code=400, detail="customer_name or customer_name_snapshot is required")

    customer_id_value = updates.get("customer_id") if "customer_id" in updates else previous.customer_id
    return SpecificationSheet(
        customer_name=customer_name,
        customer_id=uuid.UUID(str(customer_id_value)) if customer_id_value else None,
        customer_name_snapshot=updates.get("customer_name_snapshot") or customer_name,
        tube_size_id=resolved("tube_size_id"),
        mandrel_id=resolved("mandrel_id"),
        required_cs=resolved("required_cs"),
        target_tube_weight=resolved("target_tube_weight"),
        id_min_mm=resolved("id_min_mm"),
        id_max_mm=resolved("id_max_mm"),
        od_min_mm=resolved("od_min_mm"),
        od_max_mm=resolved("od_max_mm"),
        length_min_mm=resolved("length_min_mm"),
        length_max_mm=resolved("length_max_mm"),
        weight_min_g=resolved("weight_min_g"),
        weight_max_g=resolved("weight_max_g"),
        cs_min_n=resolved("cs_min_n"),
        cs_max_n=resolved("cs_max_n"),
        moisture_min_pct=resolved("moisture_min_pct"),
        moisture_max_pct=resolved("moisture_max_pct"),
        parchment_percent=resolved("parchment_percent"),
        parchment_color=resolved("parchment_color"),
        parchment_allowed=resolved("parchment_allowed"),
        adhesive_percent=resolved("adhesive_percent"),
        moisture_loss_percent=resolved("moisture_loss_percent"),
        adhesive_20100_percent=resolved("adhesive_20100_percent"),
        adhesive_30100_percent=resolved("adhesive_30100_percent"),
        shrink_percent=resolved("shrink_percent"),
        bamboo_max_length=previous.bamboo_max_length or settings.BAMBOO_MAX_LENGTH,
        cut_loss_mm=previous.cut_loss_mm or settings.CUT_LOSS_MM,
        status="trial" if previous.status == "trial" else "draft",
        version=int(previous.version or 1) + 1,
        active=True,
        created_by=current_user.get("sub"),
        plant_id=plant_id,
    )


@router.get("/constants")
def get_spec_constants(
    current_user: dict = Depends(get_current_user)
):
    return {
        "bamboo_max_length_mm": settings.BAMBOO_MAX_LENGTH,
        "cut_loss_mm": settings.CUT_LOSS_MM,
        "default_parchment_percent": settings.DEFAULT_PARCHMENT_PERCENT,
        "default_shrink_percent": settings.DEFAULT_SHRINK_PERCENT,
    }


@router.get("/defaults", response_model=SpecDefaultsResponse)
def get_spec_defaults(
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user),
):
    return _get_or_create_defaults(db, plant_id)


@router.put("/defaults", response_model=SpecDefaultsResponse)
def update_spec_defaults(
    payload: SpecDefaultsPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
):
    defaults = _get_or_create_defaults(db, plant_id)
    defaults.adhesive_percent = _normalize_percent(payload.adhesive_percent, "adhesive_percent")
    defaults.parchment_percent = _normalize_percent(payload.parchment_percent, "parchment_percent")
    defaults.moisture_loss_percent = _normalize_percent(payload.moisture_loss_percent, "moisture_loss_percent")
    defaults.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(defaults)
    return defaults


@router.post("/", response_model=SpecResponse)
def create_spec(
    spec: SpecCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"]))
):
    customer_name = str(spec.customer_name or spec.customer_name_snapshot or "").strip()
    if not customer_name:
        raise HTTPException(status_code=400, detail="customer_name or customer_name_snapshot is required")

    model = SpecificationSheet(
        customer_name=customer_name,
        customer_id=uuid.UUID(str(spec.customer_id)) if spec.customer_id else None,
        customer_name_snapshot=spec.customer_name_snapshot or customer_name,
        tube_size_id=spec.tube_size_id,
        mandrel_id=spec.mandrel_id,
        required_cs=spec.required_cs,
        target_tube_weight=spec.target_tube_weight,
        id_min_mm=spec.id_min_mm,
        id_max_mm=spec.id_max_mm,
        od_min_mm=spec.od_min_mm,
        od_max_mm=spec.od_max_mm,
        length_min_mm=spec.length_min_mm,
        length_max_mm=spec.length_max_mm,
        weight_min_g=spec.weight_min_g,
        weight_max_g=spec.weight_max_g,
        cs_min_n=spec.cs_min_n,
        cs_max_n=spec.cs_max_n,
        moisture_min_pct=spec.moisture_min_pct,
        moisture_max_pct=spec.moisture_max_pct,
        parchment_percent=spec.parchment_percent,
        parchment_color=spec.parchment_color,
        parchment_allowed=spec.parchment_allowed if spec.parchment_allowed is not None else True,
        adhesive_percent=spec.adhesive_percent,
        moisture_loss_percent=spec.moisture_loss_percent,
        adhesive_20100_percent=spec.adhesive_20100_percent,
        adhesive_30100_percent=spec.adhesive_30100_percent,
        shrink_percent=spec.shrink_percent,
        bamboo_max_length=settings.BAMBOO_MAX_LENGTH,
        cut_loss_mm=settings.CUT_LOSS_MM,
        created_by=current_user.get("sub"),
        plant_id=plant_id,
    )
    db.add(model)
    db.flush()

    _upsert_dynamic_values(model.id, spec.dynamic_fields, plant_id, db)
    _upsert_compat_dynamic_values(
        model.id,
        _compat_dynamic_values_from_payload(spec),
        plant_id=plant_id,
        db=db,
    )

    db.commit()
    db.refresh(model)
    return _serialize_spec(model)


@router.get("/", response_model=List[SpecResponse])
def get_specs(
    status: Optional[str] = Query(None),
    customer_name: Optional[str] = Query(None),
    active_only: bool = Query(True),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user)
):
    query = apply_plant_scope(db.query(SpecificationSheet), SpecificationSheet.plant_id, plant_scope)
    if status:
        query = query.filter(SpecificationSheet.status == status)
    if customer_name:
        query = query.filter(SpecificationSheet.customer_name.ilike(f"%{customer_name}%"))
    if active_only:
        query = query.filter(SpecificationSheet.active == True)
    specs = query.order_by(SpecificationSheet.created_at.desc()).all()
    return [_serialize_spec(spec) for spec in specs]


@router.get("/{spec_id}", response_model=SpecResponse)
def get_spec(
    spec_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user)
):
    spec = apply_plant_scope(
        db.query(SpecificationSheet).filter(SpecificationSheet.id == spec_id),
        SpecificationSheet.plant_id,
        plant_scope,
    ).first()
    if not spec:
        raise HTTPException(status_code=404, detail="Specification not found")
    return _serialize_spec(spec)


@router.put("/{spec_id}", response_model=SpecResponse)
def update_spec(
    spec_id: uuid.UUID,
    payload: SpecUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"]))
):
    spec = db.query(SpecificationSheet).filter(
        SpecificationSheet.id == spec_id,
        SpecificationSheet.plant_id == plant_id
    ).first()
    if not spec:
        raise HTTPException(status_code=404, detail="Specification not found")
    if not spec.active:
        raise HTTPException(status_code=400, detail="Inactive specification versions are read-only")

    replacement = _replacement_spec_from_payload(
        previous=spec,
        payload=payload,
        plant_id=plant_id,
        current_user=current_user,
    )
    db.add(replacement)
    db.flush()

    spec.active = False
    if spec.status in {"draft", "trial", "approved"}:
        spec.status = "obsolete"

    _upsert_dynamic_values(
        replacement.id,
        _merged_dynamic_fields_for_replacement(spec, payload.dynamic_fields),
        plant_id,
        db,
    )
    _upsert_compat_dynamic_values(
        replacement.id,
        _compat_dynamic_values_from_payload(payload),
        plant_id=plant_id,
        db=db,
    )

    db.commit()
    db.refresh(replacement)
    return _serialize_spec(replacement)


class ApproveSpecPayload(BaseModel):
    recipe_id: Optional[uuid.UUID] = None

@router.post("/{spec_id}/approve")
def approve_spec(
    spec_id: uuid.UUID,
    payload: ApproveSpecPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"]))
):
    spec = db.query(SpecificationSheet).filter(
        SpecificationSheet.id == spec_id,
        SpecificationSheet.plant_id == plant_id
    ).first()
    if not spec:
        raise HTTPException(status_code=404, detail="Specification not found")

    duplicate = db.query(SpecificationSheet).filter(
        SpecificationSheet.id != spec.id,
        SpecificationSheet.plant_id == plant_id,
        SpecificationSheet.active == True,
        SpecificationSheet.status == "approved",
        SpecificationSheet.tube_size_id == spec.tube_size_id,
        SpecificationSheet.required_cs == spec.required_cs,
        SpecificationSheet.target_tube_weight == spec.target_tube_weight,
    ).first()
    if duplicate:
        raise HTTPException(
            status_code=400,
            detail="An active approved spec already exists for this tube size + CS + target weight"
        )

    recipe = None
    if payload.recipe_id:
        recipe = db.query(RecipeHeader).filter(
            RecipeHeader.id == payload.recipe_id,
            RecipeHeader.spec_id == spec.id
        ).first()
    else:
        recipe = db.query(RecipeHeader).filter(
            RecipeHeader.spec_id == spec.id,
            RecipeHeader.status == "trial"
        ).order_by(RecipeHeader.version.desc()).first()

    if not recipe:
        raise HTTPException(status_code=400, detail="No trial recipe found for this specification")

    service = ApprovalService(db)
    result = service.approve_recipe(str(recipe.id), approved_by=current_user.get("sub"))
    return result


@router.post("/{spec_id}/obsolete")
def obsolete_spec(
    spec_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"]))
):
    spec = db.query(SpecificationSheet).filter(
        SpecificationSheet.id == spec_id,
        SpecificationSheet.plant_id == plant_id
    ).first()
    if not spec:
        raise HTTPException(status_code=404, detail="Specification not found")
        
    service = ApprovalService(db)
    return service.obsolete_spec(str(spec_id))
