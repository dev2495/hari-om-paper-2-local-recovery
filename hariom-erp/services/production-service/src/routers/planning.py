from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
import csv
import hashlib
import io
import json
import math
from typing import Any, Optional
import uuid
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import String, and_, cast, func, or_
from sqlalchemy.orm import Session, selectinload

from ..config import get_settings
from ..database import get_db
from ..models import (
    AuditEvent,
    Dispatch,
    JobCard,
    JobCardShortClose,
    JobCardStage,
    JobCardStageSegment,
    MachineStageCapacityProfile,
    MonthlyMaterialProvisional,
    PackingRecord,
    PLANT_A_UUID,
    PLANT_B_UUID,
    QualityHold,
    QualityInspection,
    SalesOrder,
    ShiftMaterialLedger,
    StageQueueOrder,
)
from ..schemas.planning import (
    AssignMachinePayload,
    BoardMovePayload,
    JobCardCreate,
    JobCardPlannerSummary,
    JobCardPlanningDetail,
    JobCardPlanningStage,
    JobCardStageSegmentResponse,
    JobCardResponse,
    PlanningBoardLane,
    PlanningBoardMachineConstraint,
    PlanningBoardResponse,
    PlanningBoardStageView,
    PlanningBoardStageSummary,
    PlanningShift,
    PlanningQueueResponse,
    PlanningSuggestion,
    QueueJobCardItem,
    QueueMachineBucket,
    ReorderQueuePayload,
    ReleaseSyncLineResult,
    ReleaseSyncPayload,
    ReleaseSyncResponse,
    SalesOrderCreate,
    SalesOrderResponse,
    StageActionResponse,
    StageSegmentSplitPayload,
    StageOutputPayload,
)
from ..utils.auth import get_current_plant, get_current_plant_scope, require_role

router = APIRouter(tags=["planning"])
settings = get_settings()

STAGE_SEQUENCE = ["SLITTING", "WINDER", "OVEN", "PROCESS", "PACKING", "QC", "DISPATCH"]
PLANT_TIMEZONE = ZoneInfo("Asia/Kolkata")
OVEN_BATCH_MIN_HOURS = 5.0
OVEN_BATCH_MAX_HOURS = 6.0
NOTCH_TOOL_FIELD_CATEGORY_MAP = {
    "notch_type": ("NOTCH_TYPE", "Notch"),
    "notching_blade": ("NOTCHING_BLADE", "Blade"),
    "notching_holder": ("NOTCHING_HOLDER", "Holder"),
    "v_flat": ("V_FLAT", "V + Flat"),
    "punch": ("PUNCH", "Punch"),
    "notch_wider": ("NOTCH_WIDER", "Notch Wider"),
    "notch_patti": ("NOTCH_PATTI", "Notch Patti"),
    "notch_direction": ("NOTCH_DIRECTION", "Notch Direction"),
}
STAGE_TO_MACHINE_DEPARTMENT = {
    "SLITTING": "SLITTING",
    "WINDER": "WINDER",
    "OVEN": "OVEN",
    "PROCESS": "PROCESS",
    "PACKING": "PACKING",
}
STAGE_DEFAULT_CAPACITY_UNITS = {
    "SLITTING": "REELS_PER_DAY",
    "WINDER": "METERS_PER_DAY",
    "OVEN": "BATCHES_PER_DAY",
    "PROCESS": "TUBES_PER_DAY",
    "PACKING": "TUBES_PER_DAY",
    "QC": "TUBES_PER_DAY",
    "DISPATCH": "TUBES_PER_DAY",
}
QC_BLOCKING_STATUSES = {"HOLD"}
PROCESS_QC_STAGES = {"SLITTING", "WINDER", "OVEN", "PROCESS", "PACKING"}
FINAL_SPEC_QC_STAGE = "QC"
FINAL_SPEC_QC_FIELDS = [
    ("ID", "id", "id_min_mm", "id_max_mm"),
    ("OD", "od", "od_min_mm", "od_max_mm"),
    ("Length", "length", "length_min_mm", "length_max_mm"),
    ("Weight", "weight", "weight_min_g", "weight_max_g"),
    ("CS", "cs", "cs_min_n", "cs_max_n"),
]
WINDER_METER_CAPACITY_UNIT = "METERS_PER_DAY"
WINDER_BAMBOO_CAPACITY_UNIT = "BAMBOOS_PER_DAY"


def _winder_override_warning(job_card: JobCard, machine_id: Optional[uuid.UUID]) -> Optional[str]:
    if machine_id is None:
        return None
    assigned_winder = job_card.assigned_winder_machine_id
    if assigned_winder is None:
        return "No release winder was captured; planner assigned this WINDER job manually."
    if str(assigned_winder) != str(machine_id):
        return (
            "Other winder used. Release selected "
            f"{str(assigned_winder)[:8]}, planner assigned {str(machine_id)[:8]}."
        )
    return None
SHIFT_CALENDAR = [
    {"code": "SHIFT_A", "label": "Shift A", "capacity_share": 1.0},
    {"code": "SHIFT_B", "label": "Shift B", "capacity_share": 1.0},
]
MACHINE_BLOCKING_STATUSES = {"MAINT", "DOWN"}
VIRTUAL_STAGE_CAPACITY = {
    "QC": 12000.0,
    "DISPATCH": 12000.0,
}


def _normalize_stage(stage: str) -> str:
    normalized = stage.strip().upper()
    if normalized not in STAGE_SEQUENCE:
        raise HTTPException(
            status_code=400,
            detail="stage must be one of SLITTING, WINDER, OVEN, PROCESS, PACKING, QC, DISPATCH",
        )
    return normalized


def _next_stage(stage: str, stage_sequence: Optional[list[str]] = None) -> str:
    sequence = list(stage_sequence or STAGE_SEQUENCE)
    if stage not in sequence:
        raise HTTPException(status_code=400, detail=f"Invalid stage '{stage}'")
    index = sequence.index(stage)
    if index == len(sequence) - 1:
        return "DONE"
    return sequence[index + 1]


def _stage_index(stage: str) -> int:
    if stage not in STAGE_SEQUENCE:
        raise HTTPException(status_code=400, detail=f"Invalid stage '{stage}'")
    return STAGE_SEQUENCE.index(stage)


def _routing_stages_from_snapshot(spec_snapshot: dict[str, Any]) -> list[str]:
    if bool(spec_snapshot.get("operational_requires_slitting") or spec_snapshot.get("requires_slitting")):
        return list(STAGE_SEQUENCE)
    return [stage for stage in STAGE_SEQUENCE if stage != "SLITTING"]


def _shift_codes() -> list[str]:
    return [str(item["code"]) for item in SHIFT_CALENDAR]


def _shift_share(shift_code: Optional[str]) -> float:
    normalized = str(shift_code or "SHIFT_A").upper()
    for item in SHIFT_CALENDAR:
        if item["code"] == normalized:
            return float(item["capacity_share"])
    return 1.0


def _shift_label(shift_code: Optional[str]) -> str:
    normalized = str(shift_code or "SHIFT_A").upper()
    for item in SHIFT_CALENDAR:
        if item["code"] == normalized:
            return str(item["label"])
    return normalized.replace("_", " ")


def _sorted_stage_rows(stages: list[JobCardStage]) -> list[JobCardStage]:
    return sorted(stages, key=lambda item: _stage_sort_key(item.stage_type))


def _to_uuid(value: str, field: str = "plant_id") -> uuid.UUID:
    normalized = str(value or "").strip().upper()
    if normalized in {"PLANT_A", "PLANT-1", "PLANT_1", "PLANT1"}:
        return PLANT_A_UUID
    if normalized in {"PLANT_B", "PLANT-2", "PLANT_2", "PLANT2"}:
        return PLANT_B_UUID
    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid {field}: {value}") from exc


def _nullable_uuid(value: Any) -> Optional[uuid.UUID]:
    if value in (None, ""):
        return None
    try:
        return uuid.UUID(str(value))
    except ValueError:
        return None


def _optional_positive_float(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _fetch_spec(
    spec_id: uuid.UUID,
    token: str,
    plant_id: str,
    require_approved_active: bool = True,
) -> dict[str, Any]:
    with httpx.Client(timeout=10.0) as client:
        response = client.get(
            f"{settings.SPEC_SERVICE_URL}/specs/{spec_id}",
            headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
        )
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Unable to validate specification")
    spec = response.json()
    if require_approved_active:
        status = str(spec.get("status", "")).lower()
        if status != "approved" or not bool(spec.get("active", False)):
            raise HTTPException(status_code=400, detail="Specification must be approved and active")
    return spec


def _fetch_machine(machine_id: uuid.UUID, token: str, plant_id: str) -> dict[str, Any]:
    with httpx.Client(timeout=10.0) as client:
        response = client.get(
            f"{settings.MASTERDATA_SERVICE_URL}/master/machines/{machine_id}",
            headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
        )
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Unable to validate machine")
    return response.json()


def _fetch_stage_machines(stage: str, token: str, plant_id: str) -> list[dict[str, Any]]:
    department = STAGE_TO_MACHINE_DEPARTMENT.get(stage)
    if not department:
        return []
    with httpx.Client(timeout=10.0) as client:
        response = client.get(
            f"{settings.MASTERDATA_SERVICE_URL}/master/machines/",
            headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
            params={"department": department},
        )
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Unable to load machine lanes")
    return response.json() or []


def _fetch_sales_order(order_id: uuid.UUID, token: str, plant_id: str) -> dict[str, Any]:
    with httpx.Client(timeout=10.0) as client:
        response = client.get(
            f"{settings.SALES_SERVICE_URL}/sales-orders/{order_id}",
            headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
        )
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Unable to validate sales order")
    return response.json()


def _sync_sales_release_lot_job_card(release_lot_id: uuid.UUID, job_card_id: uuid.UUID, token: str, plant_id: str) -> None:
    with httpx.Client(timeout=10.0) as client:
        response = client.post(
            f"{settings.SALES_SERVICE_URL}/sales-orders/release-lots/{release_lot_id}/sync-job-card",
            headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
            json={"job_card_id": str(job_card_id)},
        )
    if response.status_code >= 400:
        raise HTTPException(status_code=400, detail="Unable to sync sales release lot with job card")


def _fetch_recipes_for_spec(spec_id: uuid.UUID, token: str, plant_id: str) -> list[dict[str, Any]]:
    with httpx.Client(timeout=10.0) as client:
        response = client.get(
            f"{settings.SPEC_SERVICE_URL}/recipes/spec/{spec_id}",
            headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
        )
    if response.status_code != 200:
        return []
    return response.json() or []


def _fetch_spec_calculation(path: str, token: str, plant_id: str, params: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    with httpx.Client(timeout=10.0) as client:
        response = client.get(
            f"{settings.SPEC_SERVICE_URL}{path}",
            params=params or None,
            headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
        )
    if response.status_code != 200:
        return {}
    data = response.json()
    return data if isinstance(data, dict) else {}


def _json_hash(value: Any) -> str:
    blob = json.dumps(value, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _fetch_paper_catalog_for_theory(token: str, plant_id: str) -> dict[str, dict[str, Any]]:
    with httpx.Client(timeout=15.0) as client:
        response = client.get(
            f"{settings.MASTERDATA_SERVICE_URL}/master/papers/",
            headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
        )
    if response.status_code != 200:
        return {}
    rows = response.json() or []
    return {str(row.get("id") or ""): row for row in rows}


def _fetch_inventory_item_catalog_for_theory(token: str, plant_id: str) -> list[dict[str, Any]]:
    with httpx.Client(timeout=15.0) as client:
        response = client.get(
            f"{settings.INVENTORY_SERVICE_URL}/items/",
            headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
        )
    if response.status_code != 200:
        return []
    rows = response.json()
    return rows if isinstance(rows, list) else []


def _find_inventory_item_match(
    *,
    inventory_items: list[dict[str, Any]],
    item_type: str,
    exact_codes: Optional[list[str]] = None,
    loose_tokens: Optional[list[str]] = None,
) -> Optional[dict[str, Any]]:
    normalized_type = str(item_type or "").strip().upper()
    exact = [str(value or "").strip().upper() for value in (exact_codes or []) if str(value or "").strip()]
    loose = [str(value or "").strip().upper() for value in (loose_tokens or []) if str(value or "").strip()]

    typed_items = [row for row in inventory_items if str(row.get("type") or "").strip().upper() == normalized_type]
    if not typed_items:
        return None

    for candidate in typed_items:
        candidate_code = str(candidate.get("item_code") or "").strip().upper()
        if candidate_code and candidate_code in exact:
            return candidate

    if len(typed_items) == 1:
        return typed_items[0]

    if not loose:
        return None

    matches: list[dict[str, Any]] = []
    for candidate in typed_items:
        haystack = " ".join(
            [
                str(candidate.get("item_code") or "").strip().upper(),
                str(candidate.get("name") or "").strip().upper(),
            ]
        )
        if all(token in haystack for token in loose):
            matches.append(candidate)
    return matches[0] if len(matches) == 1 else None


def _job_card_produced_qty_for_theory(job_card: JobCard) -> float:
    packing_record = getattr(job_card, "packing_record", None)
    if packing_record and float(getattr(packing_record, "total_packed_qty", 0.0) or 0.0) > 0:
        return float(packing_record.total_packed_qty or 0.0)

    best_stage_index = -1
    best_qty = 0.0
    stage_order = {"SLITTING": 0, "WINDER": 1, "OVEN": 2, "PROCESS": 3, "PACKING": 4, "QC": 5, "DISPATCH": 6}
    for stage_row in getattr(job_card, "stages", []) or []:
        qty = float(stage_row.output_qty or 0.0)
        if qty <= 0:
            continue
        score = stage_order.get(str(stage_row.stage_type or "").upper(), -1)
        if score > best_stage_index or (score == best_stage_index and qty > best_qty):
            best_stage_index = score
            best_qty = qty
    return best_qty


def _build_provisional_material_rows_for_job_card(
    *,
    job_card: JobCard,
    paper_catalog: dict[str, dict[str, Any]],
    inventory_items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    material_snapshot = dict(getattr(job_card, "material_plan_snapshot", {}) or {})
    bom_snapshot = dict(material_snapshot.get("bom_snapshot") or material_snapshot.get("theoretical_consumption") or {})
    paper_rows = list((((bom_snapshot.get("raw_materials") or {}).get("papers")) or []))
    adhesive_rows = list(((((bom_snapshot.get("raw_materials") or {}).get("adhesives")) or {}).get("components")) or [])
    parchment_row = dict((((bom_snapshot.get("raw_materials") or {}).get("parchment")) or {}))
    if not paper_rows and not adhesive_rows and not parchment_row:
        return []

    planned_output_qty = float(material_snapshot.get("planned_output_qty") or getattr(job_card, "planned_qty", 0.0) or 0.0)
    produced_qty = _job_card_produced_qty_for_theory(job_card)
    if produced_qty <= 0 or planned_output_qty <= 0:
        return []

    ratio = max(0.0, min(1.5, produced_qty / planned_output_qty))
    target_bamboo_count = material_snapshot.get("target_bamboo_count")
    pcs_per_bamboo = material_snapshot.get("pcs_per_bamboo")
    provisional_bamboo_count = None
    try:
        if target_bamboo_count:
            provisional_bamboo_count = float(target_bamboo_count) * ratio
        elif pcs_per_bamboo:
            provisional_bamboo_count = produced_qty / max(float(pcs_per_bamboo), 1.0)
    except (TypeError, ValueError):
        provisional_bamboo_count = None
    if not provisional_bamboo_count or provisional_bamboo_count <= 0:
        return []

    aggregated: dict[str, dict[str, Any]] = {}

    def accumulate(item_code: str, item_name: Optional[str], weight_kg: float) -> None:
        normalized_code = str(item_code or "").strip().upper()
        if not normalized_code:
            return
        if weight_kg <= 0:
            return
        bucket = aggregated.setdefault(
            normalized_code,
            {
                "item_code": normalized_code,
                "item_name": item_name,
                "provisional_theory_consumption_kg": 0.0,
                "advisory_allocated_order_qty": round(produced_qty, 4),
            },
        )
        if item_name and not bucket.get("item_name"):
            bucket["item_name"] = item_name
        bucket["provisional_theory_consumption_kg"] = round(
            float(bucket["provisional_theory_consumption_kg"] or 0.0) + weight_kg,
            6,
        )

    for paper_row in paper_rows:
        paper_id = str(paper_row.get("paper_id") or "")
        catalog_row = paper_catalog.get(paper_id, {})
        catalog_code = str(catalog_row.get("code") or paper_id or "UNKNOWN").strip().upper()
        gsm_value = paper_row.get("gsm")
        gsm_token = ""
        try:
            if gsm_value is not None:
                gsm_token = str(int(round(float(gsm_value))))
        except (TypeError, ValueError):
            gsm_token = ""
        inventory_match = _find_inventory_item_match(
            inventory_items=inventory_items,
            item_type="RAW_PAPER",
            exact_codes=[catalog_code],
            loose_tokens=[gsm_token] if gsm_token else None,
        )
        item_code = catalog_code or str((inventory_match or {}).get("item_code") or "UNKNOWN").strip().upper() or "UNKNOWN"
        item_name_parts = [
            str((inventory_match or {}).get("name") or "").strip(),
            str(catalog_row.get("variety") or "").strip() if not inventory_match else "",
            f"GSM {catalog_row.get('gsm')}" if catalog_row.get("gsm") is not None and not inventory_match else "",
        ]
        item_name = " · ".join([part for part in item_name_parts if part]) or None
        accumulate(
            item_code,
            item_name,
            round(float(paper_row.get("weight_kg") or 0.0) * provisional_bamboo_count, 6),
        )

    for adhesive_row in adhesive_rows:
        component_name = str(adhesive_row.get("name") or "").strip() or "Adhesive"
        normalized_name = component_name.upper().replace(" ", "").replace("-", "")
        adhesive_code = next(
            (
                token
                for token in ["20100", "30100", "30101", "TL4LV"]
                if token in normalized_name
            ),
            None,
        )
        inventory_match = _find_inventory_item_match(
            inventory_items=inventory_items,
            item_type="ADHESIVE",
            exact_codes=[adhesive_code] if adhesive_code else None,
            loose_tokens=[adhesive_code] if adhesive_code else [component_name.upper()],
        )
        item_code = str(adhesive_code or component_name).strip().upper().replace(" ", "_")
        item_name = str((inventory_match or {}).get("name") or component_name).strip() or None
        accumulate(
            item_code,
            item_name,
            round(float(adhesive_row.get("weight_kg") or 0.0) * provisional_bamboo_count, 6),
        )

    if parchment_row:
        color = str(parchment_row.get("color") or "").strip()
        inventory_match = _find_inventory_item_match(
            inventory_items=inventory_items,
            item_type="PARCHMENT",
            exact_codes=["PARCHMENT"],
            loose_tokens=[color.upper()] if color else None,
        )
        item_code = "PARCHMENT"
        item_name = str((inventory_match or {}).get("name") or (f"Parchment · {color}" if color else "Parchment")).strip() or None
        accumulate(
            item_code,
            item_name,
            round(float(parchment_row.get("weight_kg") or 0.0) * provisional_bamboo_count, 6),
        )

    return list(aggregated.values())


def _upsert_monthly_provisional_theory(
    *,
    db: Session,
    job_card: JobCard,
    selected_stage: str,
    token: str,
    plant_id: str,
    current_user: dict[str, Any],
) -> None:
    if selected_stage not in {"PACKING", "QC"}:
        return

    paper_catalog = _fetch_paper_catalog_for_theory(token, plant_id)
    inventory_items = _fetch_inventory_item_catalog_for_theory(token, plant_id)
    rows = _build_provisional_material_rows_for_job_card(
        job_card=job_card,
        paper_catalog=paper_catalog,
        inventory_items=inventory_items,
    )
    activity_dt = None
    for stage_row in getattr(job_card, "stages", []) or []:
        if str(stage_row.stage_type or "").upper() == selected_stage:
            activity_dt = stage_row.actual_end or stage_row.entered_at or stage_row.actual_start
            break
    month_start = activity_dt.date().replace(day=1) if activity_dt else date.today().replace(day=1)

    existing_rows = {
        str(row.item_code or "").strip().upper(): row
        for row in db.query(MonthlyMaterialProvisional).filter(
            MonthlyMaterialProvisional.plant_id == job_card.plant_id,
            MonthlyMaterialProvisional.month_start == month_start,
            MonthlyMaterialProvisional.job_card_id == job_card.id,
        ).all()
    }

    keep_codes: set[str] = set()
    for row in rows:
        item_code = str(row["item_code"]).strip().upper()
        keep_codes.add(item_code)
        existing = existing_rows.get(item_code)
        if existing is None:
            existing = MonthlyMaterialProvisional(
                plant_id=job_card.plant_id,
                month_start=month_start,
                job_card_id=job_card.id,
                sales_order_line_id=job_card.sales_order_line_id,
                item_code=item_code,
                created_by=current_user.get("sub"),
            )
            db.add(existing)
        existing.item_name = row.get("item_name")
        existing.provisional_theory_consumption_kg = float(row.get("provisional_theory_consumption_kg") or 0.0)
        existing.advisory_allocated_order_qty = float(row.get("advisory_allocated_order_qty") or 0.0)
        existing.source_stage = selected_stage
        existing.snapshot = {
            "selected_stage": selected_stage,
            "job_card_status": job_card.status,
            "planned_qty": float(job_card.planned_qty or 0.0),
        }

    for item_code, existing in existing_rows.items():
        if item_code not in keep_codes:
            db.delete(existing)

    if rows:
        _record_audit_event(
            db=db,
            plant_id=job_card.plant_id,
            entity_type="job_card",
            entity_id=job_card.id,
            action="provisional_theory_posted",
            actor_id=current_user.get("sub"),
            actor_role=str(current_user.get("role") or current_user.get("acting_role") or ""),
            job_card_id=job_card.id,
            payload={
                "source_stage": selected_stage,
                "month_start": month_start.isoformat(),
                "rows": rows,
            },
        )


def _record_audit_event(
    *,
    db: Session,
    plant_id: uuid.UUID,
    entity_type: str,
    entity_id: uuid.UUID,
    action: str,
    actor_id: Optional[str],
    actor_role: Optional[str],
    payload: dict[str, Any],
    job_card_id: Optional[uuid.UUID] = None,
    request_id: Optional[str] = None,
    before_payload: Optional[dict[str, Any]] = None,
    after_payload: Optional[dict[str, Any]] = None,
) -> None:
    db.add(
        AuditEvent(
            plant_id=plant_id,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            actor_id=actor_id,
            actor_role=actor_role,
            job_card_id=job_card_id,
            request_id=request_id,
            before_hash=_json_hash(before_payload) if before_payload is not None else None,
            after_hash=_json_hash(after_payload) if after_payload is not None else None,
            payload=payload,
        )
    )


def _validate_machine_compatibility(
    machine: dict[str, Any],
    stage: str,
    spec_snapshot: dict[str, Any],
    plant_id: str,
) -> None:
    try:
        machine_plant_id = _to_uuid(str(machine.get("plant_id") or ""), "machine.plant_id")
        selected_plant_id = _to_uuid(str(plant_id or ""), "plant_id")
    except HTTPException:
        machine_plant_id = None
        selected_plant_id = None
    if machine_plant_id != selected_plant_id:
        raise HTTPException(status_code=400, detail="Machine belongs to another plant")
    if not bool(machine.get("is_active", machine.get("active", False))):
        raise HTTPException(status_code=400, detail="Machine is inactive")
    machine_status = str(machine.get("status") or "UP").strip().upper()
    if machine_status in MACHINE_BLOCKING_STATUSES:
        raise HTTPException(status_code=400, detail=f"Machine is {machine_status}; restore it before scheduling")

    expected_department = STAGE_TO_MACHINE_DEPARTMENT.get(stage)
    if machine.get("department") != expected_department:
        raise HTTPException(status_code=400, detail=f"Machine department must be {expected_department} for {stage}")

    if stage == "PACKING":
        return

    def _within(spec_min_key: str, spec_max_key: str, machine_min_key: str, machine_max_key: str, label: str):
        try:
            spec_min = float(spec_snapshot.get(spec_min_key))
            spec_max = float(spec_snapshot.get(spec_max_key))
            machine_min = float(machine.get(machine_min_key))
            machine_max = float(machine.get(machine_max_key))
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="Specification snapshot or machine capability is incomplete") from exc
        if spec_min < machine_min or spec_max > machine_max:
            raise HTTPException(
                status_code=400,
                detail=f"Machine {label} capability is incompatible with specification range",
            )

    _within("id_min_mm", "id_max_mm", "id_min_mm", "id_max_mm", "ID")
    _within("od_min_mm", "od_max_mm", "od_min_mm", "od_max_mm", "OD")
    _within("length_min_mm", "length_max_mm", "length_min_mm", "length_max_mm", "Length")

    supported_mandrels = machine.get("supported_mandrel_ids") or []
    snapshot_mandrel_id = str(spec_snapshot.get("mandrel_id") or "").strip()
    if supported_mandrels and snapshot_mandrel_id and snapshot_mandrel_id not in {str(value) for value in supported_mandrels}:
        raise HTTPException(
            status_code=400,
            detail="Machine is not configured for the specification mandrel",
        )


def _validate_machine_presence_for_packing(machine: dict[str, Any], plant_id: str) -> None:
    _validate_machine_compatibility(machine, "PACKING", {}, plant_id)


def _normalize_sales_status(value: Any) -> str:
    return str(value or "").strip().lower()


def _today_utc_window(now_utc: datetime) -> tuple[datetime, datetime]:
    local_now = now_utc.replace(tzinfo=ZoneInfo("UTC")).astimezone(PLANT_TIMEZONE)
    local_start = datetime(local_now.year, local_now.month, local_now.day, tzinfo=PLANT_TIMEZONE)
    local_end = local_start + timedelta(days=1)
    return (
        local_start.astimezone(ZoneInfo("UTC")).replace(tzinfo=None),
        local_end.astimezone(ZoneInfo("UTC")).replace(tzinfo=None),
    )


def _parse_cycle_hours(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    if isinstance(value, str) and ":" in value:
        parts = value.split(":")
        if len(parts) >= 2:
            try:
                hours = float(parts[0])
                minutes = float(parts[1])
                return hours + (minutes / 60.0)
            except ValueError:
                return None
    try:
        raw = float(value)
    except (TypeError, ValueError):
        return None
    if raw <= 0:
        return None
    # Interpret large values as minutes.
    if raw > 24:
        return raw / 60.0
    return raw


def _extract_oven_cycle_hours(stage_row: JobCardStage, entry_snapshot: dict[str, Any]) -> Optional[float]:
    if stage_row.planned_start and stage_row.planned_end and stage_row.planned_end >= stage_row.planned_start:
        return (stage_row.planned_end - stage_row.planned_start).total_seconds() / 3600.0

    cycle_hours = _parse_cycle_hours(entry_snapshot.get("cycle_time_hours"))
    if cycle_hours is not None:
        return cycle_hours

    cycle_hours = _parse_cycle_hours(entry_snapshot.get("cycle_time"))
    if cycle_hours is not None:
        return cycle_hours

    cycle_minutes = _parse_cycle_hours(entry_snapshot.get("cycle_time_min"))
    if cycle_minutes is not None:
        return cycle_minutes / 60.0

    return None


def _snapshot_mid(min_value: Any, max_value: Any) -> Optional[float]:
    try:
        min_number = float(min_value)
        max_number = float(max_value)
    except (TypeError, ValueError):
        return None
    return (min_number + max_number) / 2.0


def _snapshot_number(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number


def _resolve_bamboo_plan_for_length(
    tube_length_mm: Optional[float],
    *,
    bamboo_min: float = 1390.0,
    bamboo_max: float = 1560.0,
    bamboo_increment: float = 10.0,
    cut_loss: float = 40.0,
) -> dict[str, float | int] | None:
    if tube_length_mm is None:
        return None
    try:
        resolved_tube_length = float(tube_length_mm)
    except (TypeError, ValueError):
        return None
    if resolved_tube_length <= 0:
        return None

    max_usable_length = max(bamboo_max - cut_loss, 0.0)
    tubes_from_max = int(math.floor(max_usable_length / resolved_tube_length))
    exact_required_bamboo = (tubes_from_max * resolved_tube_length) + cut_loss
    rounded_bamboo = math.ceil(exact_required_bamboo / bamboo_increment) * bamboo_increment
    selected_bamboo = min(bamboo_max, max(bamboo_min, rounded_bamboo))
    usable_length = max(selected_bamboo - cut_loss, 0.0)
    tubes_per_bamboo = max(int(math.floor(usable_length / resolved_tube_length)), 0)

    return {
        "tube_length_mm": resolved_tube_length,
        "selected_bamboo_length_mm": selected_bamboo,
        "usable_length_mm": usable_length,
        "tubes_per_bamboo": tubes_per_bamboo,
        "exact_required_bamboo_length_mm": exact_required_bamboo,
        "bamboo_min_length_mm": bamboo_min,
        "bamboo_max_length_mm": bamboo_max,
        "bamboo_increment_mm": bamboo_increment,
        "cut_loss_mm": cut_loss,
    }


def _pcs_per_bamboo_from_snapshot(spec_snapshot: dict[str, Any]) -> Optional[int]:
    bamboo_plan = _winder_bamboo_plan_from_snapshot(spec_snapshot)
    if not bamboo_plan:
        return None
    return max(int(bamboo_plan["tubes_per_bamboo"]), 1)


def _winder_bamboo_plan_from_snapshot(spec_snapshot: dict[str, Any]) -> dict[str, float | int] | None:
    snapshot = spec_snapshot or {}
    selected_length = _snapshot_number(
        snapshot.get("selected_bamboo_length_mm")
        or snapshot.get("selected_bamboo_length")
        or snapshot.get("bamboo_length_mm")
    )
    pcs_per_bamboo = _snapshot_number(snapshot.get("pcs_per_bamboo") or snapshot.get("tubes_per_bamboo"))
    if selected_length and selected_length > 0 and pcs_per_bamboo and pcs_per_bamboo > 0:
        return {
            "tube_length_mm": 0.0,
            "selected_bamboo_length_mm": selected_length,
            "usable_length_mm": selected_length,
            "tubes_per_bamboo": max(int(pcs_per_bamboo), 1),
            "exact_required_bamboo_length_mm": selected_length,
            "bamboo_min_length_mm": selected_length,
            "bamboo_max_length_mm": selected_length,
            "bamboo_increment_mm": 10.0,
            "cut_loss_mm": float(snapshot.get("cut_loss_mm") or 40.0),
        }

    length_mid = _snapshot_mid(snapshot.get("length_min_mm"), snapshot.get("length_max_mm"))
    if length_mid is None:
        length_mid = _snapshot_number(snapshot.get("tube_length_mm") or snapshot.get("length_mm"))
    if length_mid is None:
        return None
    bamboo_plan = _resolve_bamboo_plan_for_length(
        length_mid,
        bamboo_min=float(snapshot.get("bamboo_min_length") or 1390.0),
        bamboo_max=float(snapshot.get("bamboo_max_length") or 1560.0),
        bamboo_increment=float(snapshot.get("bamboo_increment_mm") or 10.0),
        cut_loss=float(snapshot.get("cut_loss_mm") or 40.0),
    )
    return bamboo_plan


def _winder_capacity_meters_for_bamboos(bamboo_count: float, spec_snapshot: dict[str, Any]) -> float:
    bamboo_plan = _winder_bamboo_plan_from_snapshot(spec_snapshot)
    if not bamboo_plan:
        return max(float(bamboo_count or 0.0), 0.0)
    selected_length_mm = max(float(bamboo_plan["selected_bamboo_length_mm"] or 0.0), 0.0)
    if selected_length_mm <= 0:
        return max(float(bamboo_count or 0.0), 0.0)
    return max(float(bamboo_count or 0.0), 0.0) * selected_length_mm / 1000.0


def _winder_capacity_meters_for_qty(planned_qty: float, spec_snapshot: dict[str, Any]) -> float:
    qty = max(float(planned_qty or 0.0), 0.0)
    bamboo_plan = _winder_bamboo_plan_from_snapshot(spec_snapshot)
    if not bamboo_plan:
        return qty
    pcs_per_bamboo = max(int(bamboo_plan["tubes_per_bamboo"] or 1), 1)
    bamboo_count = float(math.ceil(qty / pcs_per_bamboo)) if qty > 0 else 0.0
    return _winder_capacity_meters_for_bamboos(bamboo_count, spec_snapshot)


def _planned_load_for_capacity(
    *,
    stage: str,
    capacity_unit: str,
    planned_qty: float,
    spec_snapshot: dict[str, Any],
) -> float:
    qty = max(float(planned_qty or 0.0), 0.0)
    if capacity_unit == "REELS_PER_DAY":
        return 1.0 if qty > 0 else 0.0
    if capacity_unit == "BATCHES_PER_DAY":
        return 1.0 if qty > 0 else 0.0
    if stage == "WINDER" and capacity_unit == WINDER_METER_CAPACITY_UNIT:
        return _winder_capacity_meters_for_qty(qty, spec_snapshot)
    if capacity_unit == WINDER_BAMBOO_CAPACITY_UNIT:
        pcs_per_bamboo = _pcs_per_bamboo_from_snapshot(spec_snapshot)
        if pcs_per_bamboo and pcs_per_bamboo > 0:
            return float(math.ceil(qty / pcs_per_bamboo))
        return qty
    return qty


def _required_capacity_for_job(
    *,
    stage: str,
    planned_qty: float,
    spec_snapshot: dict[str, Any],
    capacity_unit: Optional[str] = None,
) -> float:
    resolved_unit = capacity_unit or STAGE_DEFAULT_CAPACITY_UNITS.get(stage, "TUBES_PER_DAY")
    return round(
        _planned_load_for_capacity(
            stage=stage,
            capacity_unit=resolved_unit,
            planned_qty=planned_qty,
            spec_snapshot=spec_snapshot,
        ),
        2,
    )


def _execution_load_for_capacity(
    *,
    capacity_unit: str,
    output_qty: float,
    spec_snapshot: Optional[dict[str, Any]] = None,
) -> float:
    qty = max(float(output_qty or 0.0), 0.0)
    if capacity_unit in {"REELS_PER_DAY", "BATCHES_PER_DAY"}:
        return 1.0 if qty > 0 else 0.0
    if capacity_unit == WINDER_METER_CAPACITY_UNIT:
        return _winder_capacity_meters_for_bamboos(qty, spec_snapshot or {})
    return qty


def _oven_bamboo_capacity_profile(stage: str, machine: dict[str, Any]) -> tuple[Optional[float], Optional[str]]:
    if stage != "OVEN":
        return None, None
    batches_per_shift = _snapshot_float(machine.get("capacity_value"))
    bamboos_per_batch = _snapshot_float(machine.get("batch_bamboo_capacity"))
    if not batches_per_shift or not bamboos_per_batch:
        return None, None
    return round(batches_per_shift * bamboos_per_batch, 2), "BAMBOOS_PER_DAY"


def _resolve_capacity_profile(
    *,
    db: Session,
    plant_id: uuid.UUID,
    stage: str,
    machine_id: uuid.UUID,
    machine_capacity: Optional[float],
    on_day: Optional[date] = None,
) -> tuple[Optional[float], Optional[str]]:
    rows = (
        db.query(MachineStageCapacityProfile)
        .filter(
            MachineStageCapacityProfile.plant_id == plant_id,
            MachineStageCapacityProfile.stage_type == stage,
            MachineStageCapacityProfile.machine_id == machine_id,
            MachineStageCapacityProfile.active.is_(True),
        )
        .order_by(MachineStageCapacityProfile.effective_date.desc(), MachineStageCapacityProfile.created_at.desc())
        .all()
    )
    effective_day = on_day or datetime.utcnow().date()
    for row in rows:
        if row.effective_date is None or row.effective_date <= effective_day:
            return float(row.capacity_value or 0.0), str(row.capacity_unit or STAGE_DEFAULT_CAPACITY_UNITS.get(stage, "TUBES_PER_DAY"))

    fallback_capacity = float(machine_capacity or 0.0)
    if fallback_capacity <= 0:
        return None, None
    return fallback_capacity, STAGE_DEFAULT_CAPACITY_UNITS.get(stage, "TUBES_PER_DAY")


def _shift_capacity_value(capacity_value: Optional[float], shift_code: Optional[str]) -> Optional[float]:
    if capacity_value is None:
        return None
    return round(float(capacity_value), 2)


def _capacity_warning_message(
    db: Session,
    plant_id: uuid.UUID,
    stage: str,
    machine_id: Optional[uuid.UUID],
    machine_capacity: Optional[float],
    plan_date: Optional[date] = None,
    shift_code: Optional[str] = None,
) -> Optional[str]:
    if machine_id is None or stage == "PACKING":
        return None
    capacity, capacity_unit = _resolve_capacity_profile(
        db=db,
        plant_id=plant_id,
        stage=stage,
        machine_id=machine_id,
        machine_capacity=machine_capacity,
    )
    if not capacity or capacity <= 0 or not capacity_unit:
        return None

    queue_rows = (
        db.query(JobCardStageSegment, JobCard)
        .join(JobCard, JobCard.id == JobCardStageSegment.job_card_id)
        .filter(
            JobCardStageSegment.plant_id == plant_id,
            JobCardStageSegment.stage_type == stage,
            JobCardStageSegment.machine_id == machine_id,
            JobCardStageSegment.status.notin_(["COMPLETED", "CANCELLED"]),
        )
    )
    if plan_date is not None:
        queue_rows = queue_rows.filter(JobCardStageSegment.plan_date == plan_date)
    if shift_code is not None:
        queue_rows = queue_rows.filter(JobCardStageSegment.shift_code == shift_code)
    queue_rows = queue_rows.all()
    planned_total = 0.0
    for queue_row, _job_card in queue_rows:
        planned_total += float(queue_row.required_capacity or 0.0)
    if planned_total <= capacity:
        return None
    return (
        f"Capacity warning: {stage} planned load {planned_total:.2f} {capacity_unit} exceeds "
        f"machine shift capacity {capacity:.2f} {capacity_unit}."
    )


def _parse_execution_timestamp(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)


def _segment_bucket_entries(
    db: Session,
    plant_id: uuid.UUID,
    stage: str,
    machine_id: Optional[uuid.UUID],
    plan_date: Optional[date],
    shift_code: Optional[str],
    exclude_id: Optional[uuid.UUID] = None,
) -> list[JobCardStageSegment]:
    query = db.query(JobCardStageSegment).filter(
        JobCardStageSegment.plant_id == plant_id,
        JobCardStageSegment.stage_type == stage,
        JobCardStageSegment.status.notin_(["COMPLETED", "CANCELLED"]),
    )
    if machine_id is None:
        query = query.filter(JobCardStageSegment.machine_id.is_(None))
    else:
        query = query.filter(JobCardStageSegment.machine_id == machine_id)
    if plan_date is None:
        query = query.filter(JobCardStageSegment.plan_date.is_(None))
    else:
        query = query.filter(JobCardStageSegment.plan_date == plan_date)
    if shift_code is None:
        query = query.filter(JobCardStageSegment.shift_code.is_(None))
    else:
        query = query.filter(JobCardStageSegment.shift_code == shift_code)
    if exclude_id:
        query = query.filter(JobCardStageSegment.id != exclude_id)
    return query.order_by(JobCardStageSegment.sequence_no.asc(), JobCardStageSegment.created_at.asc()).all()


def _resequence_stage_segments(db: Session, segments: list[JobCardStageSegment]) -> None:
    temp_base = max((int(segment.sequence_no or 0) for segment in segments), default=0) + len(segments) + 1_000
    for idx, segment in enumerate(segments, start=1):
        segment.sequence_no = temp_base + idx
    db.flush()
    for idx, segment in enumerate(segments, start=1):
        segment.sequence_no = idx


def _next_segment_sequence_for_bucket(
    db: Session,
    plant_id: uuid.UUID,
    stage: str,
    machine_id: Optional[uuid.UUID],
    plan_date: Optional[date],
    shift_code: Optional[str],
) -> int:
    query = db.query(func.max(JobCardStageSegment.sequence_no)).filter(
        JobCardStageSegment.plant_id == plant_id,
        JobCardStageSegment.stage_type == stage,
        JobCardStageSegment.status.notin_(["COMPLETED", "CANCELLED"]),
    )
    if machine_id is None:
        query = query.filter(JobCardStageSegment.machine_id.is_(None))
    else:
        query = query.filter(JobCardStageSegment.machine_id == machine_id)
    if plan_date is None:
        query = query.filter(JobCardStageSegment.plan_date.is_(None))
    else:
        query = query.filter(JobCardStageSegment.plan_date == plan_date)
    if shift_code is None:
        query = query.filter(JobCardStageSegment.shift_code.is_(None))
    else:
        query = query.filter(JobCardStageSegment.shift_code == shift_code)
    return int(query.scalar() or 0) + 1


def _temporary_segment_sequence(
    db: Session,
    plant_id: uuid.UUID,
    stage: str,
    machine_id: Optional[uuid.UUID],
    plan_date: Optional[date],
    shift_code: Optional[str],
) -> int:
    return _next_segment_sequence_for_bucket(
        db=db,
        plant_id=plant_id,
        stage=stage,
        machine_id=machine_id,
        plan_date=plan_date,
        shift_code=shift_code,
    ) + 1_000_000


def _place_stage_segment(
    db: Session,
    segment: JobCardStageSegment,
    desired_sequence: int,
    machine_id: Optional[uuid.UUID],
    plan_date: Optional[date],
    shift_code: Optional[str],
) -> None:
    old_bucket = (segment.machine_id, segment.plan_date, segment.shift_code)
    new_bucket = (machine_id, plan_date, shift_code)
    bucket_changed = old_bucket != new_bucket
    if bucket_changed:
        segment.machine_id = machine_id
        segment.plan_date = plan_date
        segment.shift_code = shift_code
        segment.sequence_no = _temporary_segment_sequence(
            db=db,
            plant_id=segment.plant_id,
            stage=segment.stage_type,
            machine_id=machine_id,
            plan_date=plan_date,
            shift_code=shift_code,
        )
        db.flush()
        previous_entries = _segment_bucket_entries(
            db=db,
            plant_id=segment.plant_id,
            stage=segment.stage_type,
            machine_id=old_bucket[0],
            plan_date=old_bucket[1],
            shift_code=old_bucket[2],
            exclude_id=segment.id,
        )
        if previous_entries:
            _resequence_stage_segments(db, previous_entries)

    target_entries = _segment_bucket_entries(
        db=db,
        plant_id=segment.plant_id,
        stage=segment.stage_type,
        machine_id=machine_id,
        plan_date=plan_date,
        shift_code=shift_code,
        exclude_id=segment.id,
    )
    position = max(1, min(desired_sequence, len(target_entries) + 1))
    segment.machine_id = machine_id
    segment.plan_date = plan_date
    segment.shift_code = shift_code
    target_entries.insert(position - 1, segment)
    _resequence_stage_segments(db, target_entries)


def _next_segment_no_for_stage(db: Session, job_card_id: uuid.UUID, stage: str) -> int:
    current_max = (
        db.query(func.max(JobCardStageSegment.segment_no))
        .filter(
            JobCardStageSegment.job_card_id == job_card_id,
            JobCardStageSegment.stage_type == stage,
        )
        .scalar()
    )
    return int(current_max or 0) + 1


def _open_stage_segments(db: Session, job_card_id: uuid.UUID, stage: str) -> list[JobCardStageSegment]:
    return (
        db.query(JobCardStageSegment)
        .filter(
            JobCardStageSegment.job_card_id == job_card_id,
            JobCardStageSegment.stage_type == stage,
            JobCardStageSegment.status.notin_(["COMPLETED", "CANCELLED"]),
        )
        .order_by(
            JobCardStageSegment.plan_date.asc().nullsfirst(),
            JobCardStageSegment.shift_code.asc().nullsfirst(),
            JobCardStageSegment.sequence_no.asc(),
            JobCardStageSegment.created_at.asc(),
        )
        .all()
    )


def _all_stage_segments(db: Session, job_card_id: uuid.UUID, stage: str) -> list[JobCardStageSegment]:
    return (
        db.query(JobCardStageSegment)
        .filter(
            JobCardStageSegment.job_card_id == job_card_id,
            JobCardStageSegment.stage_type == stage,
        )
        .order_by(JobCardStageSegment.segment_no.asc(), JobCardStageSegment.created_at.asc())
        .all()
    )


def _sync_stage_row_from_segments(
    stage_row: JobCardStage,
    segments: list[JobCardStageSegment],
) -> None:
    open_segments = [segment for segment in segments if segment.status not in {"COMPLETED", "CANCELLED"}]
    completed_segments = [segment for segment in segments if segment.status == "COMPLETED"]
    if open_segments:
        lead = open_segments[0]
        stage_row.machine_id = lead.machine_id
        stage_row.plan_date = lead.plan_date
        stage_row.shift_code = lead.shift_code
        stage_row.required_capacity = round(sum(float(segment.required_capacity or 0.0) for segment in open_segments), 2)
        if any(segment.status == "RUNNING" for segment in open_segments):
            stage_row.status = "RUNNING"
        elif any(segment.status == "ASSIGNED" for segment in open_segments):
            stage_row.status = "ASSIGNED"
        else:
            stage_row.status = _queue_status_for_stage(lead.machine_id)
    elif completed_segments:
        last_completed = max(
            completed_segments,
            key=lambda row: row.completed_at or row.started_at or row.created_at,
        )
        stage_row.machine_id = last_completed.machine_id
        stage_row.plan_date = last_completed.plan_date
        stage_row.shift_code = last_completed.shift_code
        stage_row.required_capacity = 0.0
        stage_row.status = "COMPLETED"
    else:
        stage_row.status = "PLANNED"

    if completed_segments:
        stage_row.input_qty = round(sum(float(segment.input_qty or 0.0) for segment in completed_segments), 2)
        stage_row.output_qty = round(sum(float(segment.output_qty or 0.0) for segment in completed_segments), 2)
        stage_row.scrap_qty = round(sum(float(segment.scrap_qty or 0.0) for segment in completed_segments), 2)
        starts = [segment.started_at for segment in completed_segments if segment.started_at]
        ends = [segment.completed_at for segment in completed_segments if segment.completed_at]
        if starts:
            stage_row.actual_start = min(starts)
        if ends:
            stage_row.actual_end = max(ends)


def _lane_existing_segment_load(
    db: Session,
    plant_id: uuid.UUID,
    stage: str,
    machine_id: Optional[uuid.UUID],
    plan_date: Optional[date],
    shift_code: Optional[str],
    exclude_segment_id: Optional[uuid.UUID] = None,
) -> float:
    rows = _segment_bucket_entries(
        db=db,
        plant_id=plant_id,
        stage=stage,
        machine_id=machine_id,
        plan_date=plan_date,
        shift_code=shift_code,
        exclude_id=exclude_segment_id,
    )
    return round(sum(float(row.required_capacity or 0.0) for row in rows), 2)


def _capacity_allocation_to_qty(
    stage: str,
    capacity_unit: str,
    spec_snapshot: dict[str, Any],
    remaining_qty: float,
    available_capacity: float,
) -> tuple[float, float]:
    qty_left = max(float(remaining_qty or 0.0), 0.0)
    capacity_left = max(float(available_capacity or 0.0), 0.0)
    if qty_left <= 0 or capacity_left <= 0:
        return 0.0, 0.0
    if stage == "WINDER" and capacity_unit == WINDER_METER_CAPACITY_UNIT:
        bamboo_plan = _winder_bamboo_plan_from_snapshot(spec_snapshot)
        if not bamboo_plan:
            qty = min(qty_left, capacity_left)
            return qty, qty
        selected_length_mm = max(float(bamboo_plan["selected_bamboo_length_mm"] or 0.0), 0.0)
        pcs_per_bamboo = max(int(bamboo_plan["tubes_per_bamboo"] or 1), 1)
        meters_per_bamboo = selected_length_mm / 1000.0
        if meters_per_bamboo <= 0:
            return 0.0, 0.0
        allocatable_bamboo = max(int(math.floor(capacity_left / meters_per_bamboo)), 0)
        if allocatable_bamboo <= 0:
            return 0.0, 0.0
        qty = min(qty_left, float(allocatable_bamboo * pcs_per_bamboo))
        required_capacity = _winder_capacity_meters_for_qty(qty, spec_snapshot)
        return qty, required_capacity
    if capacity_unit == WINDER_BAMBOO_CAPACITY_UNIT:
        pcs_per_bamboo = max(int(_pcs_per_bamboo_from_snapshot(spec_snapshot) or 1), 1)
        allocatable_bamboo = max(int(math.floor(capacity_left)), 0)
        if allocatable_bamboo <= 0:
            return 0.0, 0.0
        qty = min(qty_left, float(allocatable_bamboo * pcs_per_bamboo))
        required_capacity = float(math.ceil(qty / pcs_per_bamboo)) if qty > 0 else 0.0
        return qty, required_capacity
    if capacity_unit in {"REELS_PER_DAY", "BATCHES_PER_DAY"}:
        return qty_left, 1.0
    qty = min(qty_left, capacity_left)
    return qty, qty


def _future_stage_slots(start_date: date, shift_code: Optional[str], horizon_days: int = 30) -> list[tuple[date, str]]:
    ordered_codes = _shift_codes()
    current_code = shift_code if shift_code in ordered_codes else ordered_codes[0]
    start_index = ordered_codes.index(current_code)
    slots: list[tuple[date, str]] = []
    for day_offset in range(horizon_days):
        slot_day = start_date + timedelta(days=day_offset)
        codes = ordered_codes[start_index:] if day_offset == 0 else ordered_codes
        for code in codes:
            slots.append((slot_day, code))
    return slots


def _resolve_active_segment(
    db: Session,
    *,
    job_card: JobCard,
    stage: str,
    segment_id: Optional[uuid.UUID],
) -> JobCardStageSegment:
    if segment_id is not None:
        segment = (
            db.query(JobCardStageSegment)
            .filter(
                JobCardStageSegment.id == segment_id,
                JobCardStageSegment.job_card_id == job_card.id,
                JobCardStageSegment.stage_type == stage,
            )
            .first()
        )
        if not segment:
            raise HTTPException(status_code=404, detail="Stage segment not found")
        if segment.status in {"COMPLETED", "CANCELLED"}:
            raise HTTPException(status_code=400, detail="Selected stage segment is not editable")
        return segment

    open_segments = _open_stage_segments(db, job_card.id, stage)
    if not open_segments:
        raise HTTPException(status_code=400, detail="No open stage segment is available")
    if len(open_segments) > 1:
        raise HTTPException(status_code=409, detail="segment_id is required when multiple open segments exist for this stage")
    return open_segments[0]


def _append_stage_segment(
    *,
    db: Session,
    job_card: JobCard,
    stage_row: JobCardStage,
    machine_id: Optional[uuid.UUID],
    plan_date: Optional[date],
    shift_code: Optional[str],
    planned_qty: float,
    required_capacity: float,
    split_source: str,
    split_parent_segment_id: Optional[uuid.UUID],
    status: str,
) -> JobCardStageSegment:
    segment = JobCardStageSegment(
        plant_id=job_card.plant_id,
        job_card_id=job_card.id,
        stage_type=stage_row.stage_type,
        segment_no=_next_segment_no_for_stage(db, job_card.id, stage_row.stage_type),
        machine_id=machine_id,
        plan_date=plan_date,
        shift_code=shift_code,
        planned_qty=round(float(planned_qty or 0.0), 2),
        required_capacity=round(float(required_capacity or 0.0), 2),
        status=status,
        split_source=split_source,
        split_parent_segment_id=split_parent_segment_id,
        sequence_no=_next_segment_sequence_for_bucket(
            db=db,
            plant_id=job_card.plant_id,
            stage=stage_row.stage_type,
            machine_id=machine_id,
            plan_date=plan_date,
            shift_code=shift_code,
        ),
    )
    db.add(segment)
    db.flush()
    return segment


def _split_segment_capacity(
    segment: JobCardStageSegment,
    primary_qty: float,
) -> tuple[float, float]:
    original_qty = float(segment.planned_qty or 0.0)
    original_capacity = float(segment.required_capacity or 0.0)
    if original_qty <= 0:
        return 0.0, 0.0
    ratio = min(max(primary_qty / original_qty, 0.0), 1.0)
    primary_capacity = round(original_capacity * ratio, 2)
    secondary_capacity = round(max(original_capacity - primary_capacity, 0.0), 2)
    return primary_capacity, secondary_capacity


def _validate_execution_capacity(
    db: Session,
    stage_row: JobCardStage,
    stage: str,
    machine: dict[str, Any],
    output_qty: float,
    entry_snapshot: dict[str, Any],
) -> None:
    machine_id = stage_row.machine_id
    if machine_id is None or stage == "PACKING":
        return

    machine_capacity = float(machine.get("capacity_value") or 0.0)
    capacity, capacity_unit = _oven_bamboo_capacity_profile(stage, machine)
    if not capacity:
        capacity, capacity_unit = _resolve_capacity_profile(
            db=db,
            plant_id=stage_row.job_card.plant_id,
            stage=stage,
            machine_id=machine_id,
            machine_capacity=machine_capacity,
        )
    if capacity and capacity > 0 and capacity_unit:
        now = datetime.utcnow()
        start_utc, end_utc = _today_utc_window(now)
        normalized_shift = stage_row.shift_code or "SHIFT_A"
        completed_rows = (
            db.query(JobCardStageSegment.output_qty, JobCard.spec_snapshot)
            .join(JobCard, JobCard.id == JobCardStageSegment.job_card_id)
            .filter(
                JobCardStageSegment.stage_type == stage,
                JobCardStageSegment.machine_id == machine_id,
                JobCardStageSegment.shift_code == normalized_shift,
                JobCardStageSegment.status == "COMPLETED",
                JobCardStageSegment.completed_at.isnot(None),
                JobCardStageSegment.completed_at >= start_utc,
                JobCardStageSegment.completed_at < end_utc,
            )
            .all()
        )
        consumed_today = sum(
            _execution_load_for_capacity(
                capacity_unit=capacity_unit,
                output_qty=float(output_row or 0.0),
                spec_snapshot=spec_snapshot or {},
            )
            for output_row, spec_snapshot in completed_rows
        )
        projected = consumed_today + _execution_load_for_capacity(
            capacity_unit=capacity_unit,
            output_qty=float(output_qty or 0.0),
            spec_snapshot=stage_row.job_card.spec_snapshot or {},
        )
        if projected > capacity:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"{stage} capacity exceeded for {normalized_shift}. "
                    f"Projected {projected:.2f} {capacity_unit} > shift capacity {capacity:.2f} {capacity_unit}."
                ),
            )

    if stage == "OVEN":
        cycle_hours = _extract_oven_cycle_hours(stage_row, entry_snapshot or {})
        if cycle_hours is None:
            return
        if cycle_hours < OVEN_BATCH_MIN_HOURS or cycle_hours > OVEN_BATCH_MAX_HOURS:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Oven batch cycle must be between {OVEN_BATCH_MIN_HOURS:.0f} and "
                    f"{OVEN_BATCH_MAX_HOURS:.0f} hours. Received {cycle_hours:.2f}."
                ),
            )


def _post_fg_inward_if_configured(
    job_card: JobCard,
    final_stage_row: JobCardStage,
    packing_record: Optional[PackingRecord],
    token: str,
    plant_id: str,
) -> Optional[dict[str, Any]]:
    snapshot = final_stage_row.entry_snapshot or {}
    fg_item_id = snapshot.get("fg_item_id") or (job_card.spec_snapshot or {}).get("fg_item_id")
    if not fg_item_id:
        return None

    output_qty = float(final_stage_row.output_qty or 0.0)
    if output_qty <= 0:
        return None

    try:
        fg_item_uuid = str(uuid.UUID(str(fg_item_id)))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid fg_item_id in stage snapshot") from exc

    batch_no = str(snapshot.get("fg_batch_no") or f"FG-{str(job_card.id).replace('-', '')[:8].upper()}")
    payload = {
        "item_id": fg_item_uuid,
        "batch_no": batch_no,
        "qty": output_qty,
        "production_job_id": str(job_card.id),
        "spec_id": str(job_card.spec_id),
        "external_ref": f"FG-{job_card.id}",
        "location_id": (
            str(packing_record.location_id)
            if packing_record and packing_record.location_id
            else (str(final_stage_row.location_id) if final_stage_row.location_id else None)
        ),
        "stock_status": (
            str(packing_record.stock_status)
            if packing_record and packing_record.stock_status
            else str(snapshot.get("stock_status") or "UNRESTRICTED")
        ),
    }
    with httpx.Client(timeout=10.0) as client:
        response = client.post(
            f"{settings.INVENTORY_SERVICE_URL}/fg-inward/",
            json=payload,
            headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
        )
    if response.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail="Failed to post FG inward for completed job card")
    return response.json() if response.headers.get("content-type", "").startswith("application/json") else None


def _apply_fg_inward_snapshot(
    packing_record: Optional[PackingRecord],
    fg_inward_result: Optional[dict[str, Any]],
) -> None:
    if not packing_record or not fg_inward_result:
        return
    snapshot = dict(packing_record.snapshot or {})
    snapshot["inventory_batch_id"] = fg_inward_result.get("batch_id")
    snapshot["inventory_transaction_id"] = fg_inward_result.get("transaction_id")
    snapshot["inventory_stock_status"] = fg_inward_result.get("stock_status")
    packing_record.snapshot = snapshot


def _dynamic_field_map(spec: dict[str, Any]) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for row in spec.get("dynamic_fields") or []:
        key = row.get("field_key")
        if key:
            values[str(key)] = row.get("value")
    return values


def _snapshot_value(value: Any) -> Any:
    if value in (None, "", "null"):
        return None
    return value


def _snapshot_json(value: Any, fallback: Any) -> Any:
    raw = _snapshot_value(value)
    if raw is None:
        return fallback
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(str(raw))
    except (TypeError, ValueError, json.JSONDecodeError):
        return fallback


def _snapshot_float(value: Any) -> Optional[float]:
    value = _snapshot_value(value)
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _snapshot_midpoint(min_value: Any, max_value: Any) -> Optional[float]:
    min_number = _snapshot_float(min_value)
    max_number = _snapshot_float(max_value)
    if min_number is None or max_number is None:
        return None
    return round((min_number + max_number) / 2, 2)


def _snapshot_date(value: Any) -> Optional[date]:
    raw = _snapshot_value(value)
    if raw is None:
        return None
    try:
        return date.fromisoformat(str(raw))
    except ValueError:
        return None


def _format_measure(value: Any, digits: int = 2) -> str:
    number = _snapshot_float(value)
    if number is None:
        return ""
    if math.isclose(number, round(number), abs_tol=1e-9):
        return str(int(round(number)))
    return f"{number:.{digits}f}".rstrip("0").rstrip(".")


def _display_bool(value: Any) -> str:
    raw = _snapshot_value(value)
    if raw is None:
        return ""
    normalized = str(raw).strip().lower()
    if normalized in {"true", "1", "yes", "y"}:
        return "Yes"
    if normalized in {"false", "0", "no", "n"}:
        return "No"
    return str(raw)


def _notch_tooling_usage_from_values(values: dict[str, Any]) -> list[dict[str, Any]]:
    usage: list[dict[str, Any]] = []
    for field_key, (category, label) in NOTCH_TOOL_FIELD_CATEGORY_MAP.items():
        value = values.get(field_key)
        if field_key in {"notch_wider", "notch_patti"}:
            value = _display_bool(value)
        value_text = str(value or "").strip()
        if not value_text:
            continue
        usage.append(
            {
                "field_key": field_key,
                "label": label,
                "category": category,
                "tool_name": value_text,
            }
        )
    return usage


def _notch_tooling_usage_from_snapshot(spec_snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    existing = spec_snapshot.get("tooling_usage")
    if isinstance(existing, list):
        return [row for row in existing if isinstance(row, dict)]
    profile_usage = ((spec_snapshot.get("notch_tooling") or {}).get("tooling_usage")) if isinstance(spec_snapshot.get("notch_tooling"), dict) else None
    if isinstance(profile_usage, list):
        return [row for row in profile_usage if isinstance(row, dict)]
    return _notch_tooling_usage_from_values(spec_snapshot)


def _derive_thickness(
    outer_min: Any,
    outer_max: Any,
    inner_min: Any,
    inner_max: Any,
) -> dict[str, Optional[float]]:
    od_avg = _snapshot_midpoint(outer_min, outer_max)
    id_avg = _snapshot_midpoint(inner_min, inner_max)
    od_min = _snapshot_float(outer_min)
    od_max = _snapshot_float(outer_max)
    id_min = _snapshot_float(inner_min)
    id_max = _snapshot_float(inner_max)

    return {
        "avg": round((od_avg - id_avg) / 2, 2) if od_avg is not None and id_avg is not None else None,
        "min": round((od_min - id_max) / 2, 2) if od_min is not None and id_max is not None else None,
        "max": round((od_max - id_min) / 2, 2) if od_max is not None and id_min is not None else None,
    }


def _size_label(spec_snapshot: dict[str, Any]) -> str:
    id_avg = _snapshot_midpoint(spec_snapshot.get("id_min_mm"), spec_snapshot.get("id_max_mm"))
    od_avg = _snapshot_midpoint(spec_snapshot.get("od_min_mm"), spec_snapshot.get("od_max_mm"))
    length_avg = _snapshot_midpoint(spec_snapshot.get("length_min_mm"), spec_snapshot.get("length_max_mm"))
    parts = [_format_measure(id_avg), _format_measure(od_avg), _format_measure(length_avg)]
    if not any(parts):
        return "-"
    return " x ".join(part or "-" for part in parts)


def _packing_instructions(dynamic_map: dict[str, Any]) -> str:
    box_code = dynamic_map.get("box_code") or dynamic_map.get("box")
    parts: list[str] = []
    if dynamic_map.get("bundle_type"):
        parts.append(f"Bundle {dynamic_map['bundle_type']}")
    if dynamic_map.get("bundle_code"):
        parts.append(f"Bundle Code {dynamic_map['bundle_code']}")
    if dynamic_map.get("packing_ply"):
        parts.append(f"Packing Ply {dynamic_map['packing_ply']}")
    if dynamic_map.get("qty_per_box"):
        parts.append(f"Qty/Box {dynamic_map['qty_per_box']}")
    if dynamic_map.get("packing_pcs"):
        parts.append(f"Packing Pcs {dynamic_map['packing_pcs']}")
    if box_code:
        parts.append(f"Box {box_code}")
    if dynamic_map.get("box_size"):
        parts.append(f"Box Size {dynamic_map['box_size']}")
    if _display_bool(dynamic_map.get("plastic_required")) == "Yes":
        parts.append(f"Plastic Yes ({dynamic_map.get('plastic_sku') or 'SKU pending'})")
    elif dynamic_map.get("plastic_sku"):
        parts.append(f"Plastic SKU {dynamic_map['plastic_sku']}")
    if dynamic_map.get("plastic_per_box"):
        parts.append(f"Plastic/Box {dynamic_map['plastic_per_box']}")
    if dynamic_map.get("fadda_sku"):
        parts.append(f"Fadda {dynamic_map['fadda_sku']}")
    if dynamic_map.get("fadda_per_box"):
        parts.append(f"Fadda/Box {dynamic_map['fadda_per_box']}")
    if _display_bool(dynamic_map.get("bopp_required")) == "Yes":
        parts.append("BOPP Yes")
    if dynamic_map.get("special_instructions"):
        parts.append(str(dynamic_map["special_instructions"]))
    return " | ".join(parts)


def _is_stored_snapshot(spec_snapshot: dict[str, Any]) -> bool:
    required_keys = [
        "weight_min_g",
        "weight_max_g",
        "cs_min_n",
        "cs_max_n",
        "moisture_min_pct",
        "moisture_max_pct",
        "bamboo_max_length",
        "cut_loss_mm",
    ]
    return all(spec_snapshot.get(key) is not None for key in required_keys)


def _merge_spec_snapshot(base_snapshot: dict[str, Any], spec_payload: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base_snapshot)
    dynamic_map = _dynamic_field_map(spec_payload)

    for key in [
        "approved_cs",
        "weight_min_g",
        "weight_max_g",
        "cs_min_n",
        "cs_max_n",
        "moisture_min_pct",
        "moisture_max_pct",
        "parchment_color",
        "shrink_percent",
        "bamboo_max_length",
        "cut_loss_mm",
    ]:
        if merged.get(key) is None and spec_payload.get(key) is not None:
            merged[key] = spec_payload.get(key)

    flat_dynamic = {
        "notch_type": dynamic_map.get("notch_type"),
        "notch_distance_mm": dynamic_map.get("notch_distance_mm"),
        "notch_depth_mm": dynamic_map.get("notch_depth_mm"),
        "notching_holder": dynamic_map.get("notching_holder"),
        "notching_blade": dynamic_map.get("notching_blade"),
        "blade": dynamic_map.get("notching_blade"),
        "holder": dynamic_map.get("notching_holder"),
        "v_flat": dynamic_map.get("v_flat") or dynamic_map.get("groove"),
        "punch": dynamic_map.get("punch"),
        "notch_wider": dynamic_map.get("notch_wider"),
        "notch_patti": dynamic_map.get("notch_patti"),
        "notch_direction": dynamic_map.get("notch_direction") or dynamic_map.get("tube_direction"),
        "tube_direction": dynamic_map.get("notch_direction") or dynamic_map.get("tube_direction"),
        "tooling_usage": _notch_tooling_usage_from_values(dynamic_map),
        "groove": dynamic_map.get("groove"),
        "wider_tool": dynamic_map.get("wider_tool"),
        "tochha": dynamic_map.get("tochha"),
        "tochha_type": dynamic_map.get("tochha_type"),
        "height_gauge_go": dynamic_map.get("height_gauge_go"),
        "height_gauge_set": dynamic_map.get("height_gauge_set"),
        "height_gauge_no_go": dynamic_map.get("height_gauge_no_go"),
        "die": dynamic_map.get("die"),
        "top_paper_required": dynamic_map.get("top_paper_required"),
        "bundle_type": dynamic_map.get("bundle_type"),
        "bundle_code": dynamic_map.get("bundle_code"),
        "packing_ply": dynamic_map.get("packing_ply"),
        "qty_per_box": dynamic_map.get("qty_per_box"),
        "packing_pcs": dynamic_map.get("packing_pcs"),
        "box_code": dynamic_map.get("box_code") or dynamic_map.get("box"),
        "box_size": dynamic_map.get("box_size"),
        "plastic_required": _display_bool(dynamic_map.get("plastic_required")),
        "plastic_sku": dynamic_map.get("plastic_sku"),
        "plastic_per_box": dynamic_map.get("plastic_per_box"),
        "fadda_sku": dynamic_map.get("fadda_sku"),
        "fadda_per_box": dynamic_map.get("fadda_per_box"),
        "bopp_required": _display_bool(dynamic_map.get("bopp_required")),
        "box": dynamic_map.get("box_code") or dynamic_map.get("box"),
        "special_instructions": dynamic_map.get("special_instructions"),
        "packing_instructions": _packing_instructions(dynamic_map),
    }
    for key, value in flat_dynamic.items():
        if merged.get(key) is None and value not in (None, ""):
            merged[key] = value

    return merged


def _format_ref(prefix: str, value: Any) -> str:
    try:
        return f"{prefix}-{str(value).replace('-', '')[:8].upper()}"
    except Exception:
        return f"{prefix}-UNKNOWN"


def _reference_search_terms(value: str) -> list[str]:
    text = str(value or "").strip()
    if not text:
        return []
    if text.upper() in {"JC", "JOB", "JOB CARD", "JOB-CARD", "LOT", "SO", "SPEC"}:
        return []
    terms = [text]
    upper = text.upper()
    for prefix in ("JC-", "LOT-", "SO-", "LINE-", "SPEC-", "MC-"):
        if upper.startswith(prefix) and len(text) > len(prefix):
            terms.append(text[len(prefix):])
    compact = text.replace("-", "")
    if compact and compact != text:
        terms.append(compact)
    return list(dict.fromkeys(term for term in terms if term))


def _lot_number_for_job_card(job_card: JobCard) -> str:
    created_at = getattr(job_card, "created_at", None)
    created_on = created_at.date() if created_at else datetime.utcnow().date()
    short_ref = str(job_card.id).replace("-", "")[:6].upper()
    return f"{created_on.strftime('%d/%m')}/{short_ref}"


def _build_document_snapshot(
    job_card: JobCard,
    sales_order: Optional[SalesOrder],
    spec_snapshot: dict[str, Any],
    stages: list[JobCardStage],
    snapshot_mode: str,
) -> dict[str, Any]:
    missing_fields: list[str] = []

    def required_value(key: str) -> Any:
        value = _snapshot_value(spec_snapshot.get(key))
        if value is None:
            missing_fields.append(key)
        return value

    id_min = required_value("id_min_mm")
    id_max = required_value("id_max_mm")
    od_min = required_value("od_min_mm")
    od_max = required_value("od_max_mm")
    length_min = required_value("length_min_mm")
    length_max = required_value("length_max_mm")
    weight_min = required_value("weight_min_g")
    weight_max = required_value("weight_max_g")
    cs_min = required_value("cs_min_n")
    cs_max = required_value("cs_max_n")
    moisture_min = required_value("moisture_min_pct")
    moisture_max = required_value("moisture_max_pct")

    id_avg = _snapshot_midpoint(id_min, id_max)
    od_avg = _snapshot_midpoint(od_min, od_max)
    length_avg = _snapshot_midpoint(length_min, length_max)
    weight_avg = _snapshot_float(spec_snapshot.get("target_tube_weight")) or _snapshot_midpoint(weight_min, weight_max)
    cs_avg = (
        _snapshot_float(spec_snapshot.get("approved_cs"))
        or _snapshot_float(spec_snapshot.get("required_cs"))
        or _snapshot_midpoint(cs_min, cs_max)
    )
    moisture_avg = _snapshot_midpoint(moisture_min, moisture_max)
    thickness = _derive_thickness(od_min, od_max, id_min, id_max)

    bamboo_plan = _resolve_bamboo_plan_for_length(
        length_avg,
        bamboo_min=float(spec_snapshot.get("bamboo_min_length") or 1390.0),
        bamboo_max=float(spec_snapshot.get("bamboo_max_length") or 1560.0),
        bamboo_increment=float(spec_snapshot.get("bamboo_increment_mm") or 10.0),
        cut_loss=float(spec_snapshot.get("cut_loss_mm") or 40.0),
    )
    usable_length = float(bamboo_plan["usable_length_mm"]) if bamboo_plan else None
    selected_bamboo_length = float(bamboo_plan["selected_bamboo_length_mm"]) if bamboo_plan else None
    pcs_per_bamboo = int(bamboo_plan["tubes_per_bamboo"]) if bamboo_plan else None

    order_qty = float(sales_order.order_qty) if sales_order else float(job_card.planned_qty)
    target_bamboo_count = None
    if pcs_per_bamboo and pcs_per_bamboo > 0:
        target_bamboo_count = int(math.ceil(order_qty / pcs_per_bamboo))

    shrink_percent = _snapshot_float(spec_snapshot.get("shrink_percent"))
    recovery_factor = None
    if shrink_percent is not None and shrink_percent < 100:
        recovery_factor = 1 - (shrink_percent / 100)

    oven_dry_weight = None
    if weight_avg is not None:
        if recovery_factor and recovery_factor > 0:
            oven_dry_weight = round(weight_avg / recovery_factor, 2)
        else:
            oven_dry_weight = round(weight_avg, 2)

    with_mandrel_weight = None
    if oven_dry_weight is not None:
        with_mandrel_weight = round(oven_dry_weight + max(thickness.get("avg") or 0, 0), 2)

    first_machine_id = next((str(stage.machine_id) for stage in stages if stage.machine_id), None)
    stage_lookup = {
        getattr(row, "stage_type"): row
        for row in stages
        if getattr(row, "stage_type", None)
    }
    material_plan_snapshot = dict(getattr(job_card, "material_plan_snapshot", {}) or {})
    yield_snapshot = dict(material_plan_snapshot.get("yield_snapshot") or {})
    bom_snapshot = dict(material_plan_snapshot.get("bom_snapshot") or {})
    raw_materials = dict(bom_snapshot.get("raw_materials") or {})
    expected_output = dict(bom_snapshot.get("expected_output") or {})
    weight_bridge = dict(bom_snapshot.get("weight_bridge") or {})
    parchment_snapshot = dict(raw_materials.get("parchment") or {})
    bamboo_snapshot = dict(raw_materials.get("bamboo") or {})
    adhesives_snapshot = dict(raw_materials.get("adhesives") or {})
    exact_parchment = (
        spec_snapshot.get("sales_order_line_parchment_color")
        or spec_snapshot.get("parchment_color")
        or ""
    )
    parchment_parts = [part.strip() for part in str(exact_parchment).split("·") if part.strip()]
    parchment_family = parchment_parts[0] if parchment_parts else ""
    parchment_pattern = parchment_parts[-1] if len(parchment_parts) > 1 else exact_parchment
    winder_stage = stage_lookup.get("WINDER")
    process_stage = stage_lookup.get("PROCESS")
    packing_stage = stage_lookup.get("PACKING")
    dispatch_stage = stage_lookup.get("DISPATCH")
    recipe_sheet_payload = _snapshot_json(spec_snapshot.get("recipe_sheet_json"), {})
    recipe_rows_raw = recipe_sheet_payload.get("rows") if isinstance(recipe_sheet_payload, dict) else []
    recipe_rows = recipe_rows_raw if isinstance(recipe_rows_raw, list) else []
    adhesive_components_raw = _snapshot_json(spec_snapshot.get("adhesive_components_json"), [])
    adhesive_components = adhesive_components_raw if isinstance(adhesive_components_raw, list) else []
    first_adhesive_component = adhesive_components[0] if adhesive_components and isinstance(adhesive_components[0], dict) else {}
    tube_dry_weight_g = _snapshot_float(weight_bridge.get("predicted_dry_tube_g")) or weight_avg
    tube_wet_weight_g = _snapshot_float(weight_bridge.get("predicted_wet_tube_g")) or oven_dry_weight
    bamboo_dry_weight_g = (
        round(float(tube_dry_weight_g) * float(pcs_per_bamboo), 2)
        if tube_dry_weight_g is not None and pcs_per_bamboo
        else None
    )
    bamboo_wet_weight_g = (
        round(float(tube_wet_weight_g) * float(pcs_per_bamboo), 2)
        if tube_wet_weight_g is not None and pcs_per_bamboo
        else _snapshot_float(weight_bridge.get("bamboo_required_wet_g"))
    )

    return {
        "header": {
            "company_name": "Hari Om Paper",
            "logo_key": "hariom",
            "qr_value": f"/production/entry/{job_card.id}",
            "date": str(job_card.created_at.date()),
            "shift": "",
            "plant_id": str(job_card.plant_id),
            "sales_order_no": spec_snapshot.get("sales_order_po_number") or spec_snapshot.get("sales_order_order_no"),
            "po_number": spec_snapshot.get("sales_order_po_number"),
            "po_date": spec_snapshot.get("sales_order_po_date"),
            "job_card_number": getattr(job_card, "job_card_no", None) or _format_ref("JC", job_card.id),
            "lot_number": spec_snapshot.get("lot_number") or _lot_number_for_job_card(job_card),
            "customer_name": spec_snapshot.get("customer_name_snapshot") or spec_snapshot.get("customer_name") or "-",
            "product_size_label": _size_label(spec_snapshot),
            "product_code": getattr(job_card, "product_code", None) or spec_snapshot.get("product_code"),
            "spec_reference": spec_snapshot.get("spec_reference") or "",
            "color": exact_parchment,
            "parchment_family": parchment_family,
            "parchment_pattern": parchment_pattern,
            "mandrel_id": str(spec_snapshot.get("mandrel_id") or ""),
            "order_quantity_pcs": order_qty,
            "release_lot_id": str(getattr(job_card, "release_lot_id", None)) if getattr(job_card, "release_lot_id", None) else "",
            "release_qty_pcs": float(getattr(job_card, "released_qty", None) or job_card.planned_qty or 0.0),
            "assigned_winder_machine_id": str(getattr(job_card, "assigned_winder_machine_id", None)) if getattr(job_card, "assigned_winder_machine_id", None) else "",
            "required_cs": _snapshot_float(spec_snapshot.get("required_cs")),
            "pcs_per_bamboo": pcs_per_bamboo,
            "parchment_paper": exact_parchment or "WITHOUT PARCHMENT",
            "target_bamboo_count": material_plan_snapshot.get("target_bamboo_count") or target_bamboo_count,
            "selected_bamboo_length_mm": selected_bamboo_length,
            "usable_length_mm": usable_length,
            "trim_loss_mm": _snapshot_float(spec_snapshot.get("cut_loss_mm")) or _snapshot_float(yield_snapshot.get("cut_loss_mm")),
            "line_machine_id": first_machine_id,
            "planned_output_qty": material_plan_snapshot.get("planned_output_qty") or float(job_card.planned_qty or 0.0),
            "issued_input_qty": _snapshot_float(getattr(winder_stage, "input_qty", None)),
            "produced_output_qty": _snapshot_float(getattr(process_stage, "output_qty", None))
            or _snapshot_float(getattr(winder_stage, "output_qty", None)),
            "packed_qty": _snapshot_float(getattr(packing_stage, "output_qty", None)),
            "dispatched_qty": _snapshot_float(getattr(dispatch_stage, "output_qty", None)),
            "tube_dry_weight_g": tube_dry_weight_g,
            "tube_wet_weight_g": tube_wet_weight_g,
            "bamboo_dry_weight_g": bamboo_dry_weight_g,
            "bamboo_wet_weight_g": bamboo_wet_weight_g,
            "weight_per_mm_g": _snapshot_float(weight_bridge.get("weight_per_mm_g")),
        },
        "client_spec": {
            "id": {"avg": id_avg, "min": _snapshot_float(id_min), "max": _snapshot_float(id_max)},
            "od": {"avg": od_avg, "min": _snapshot_float(od_min), "max": _snapshot_float(od_max)},
            "length": {"avg": length_avg, "min": _snapshot_float(length_min), "max": _snapshot_float(length_max)},
            "tube_weight": {
                "avg": weight_avg,
                "min": _snapshot_float(weight_min),
                "max": _snapshot_float(weight_max),
            },
            "cs": {"avg": cs_avg, "min": _snapshot_float(cs_min), "max": _snapshot_float(cs_max)},
            "moisture": {
                "avg": moisture_avg,
                "min": _snapshot_float(moisture_min),
                "max": _snapshot_float(moisture_max),
            },
            "thickness": thickness,
        },
        "manufacturing_spec": {
            "oven_dry_weight": oven_dry_weight,
            "with_mandrel_weight": with_mandrel_weight,
            "winder_pre_dry_cs": round(cs_avg * 0.40, 2) if cs_avg is not None else None,
            "final_required_cs": cs_avg,
            "gsm_derived": None,
            "tube_dry_weight_g": tube_dry_weight_g,
            "tube_wet_weight_g": tube_wet_weight_g,
            "dry_weight_per_mm_g": _snapshot_float(weight_bridge.get("dry_weight_per_mm_g")) or _snapshot_float(weight_bridge.get("weight_per_mm_g")),
            "wet_weight_per_mm_g": _snapshot_float(weight_bridge.get("wet_weight_per_mm_g")),
            "weight_per_mm_g": _snapshot_float(weight_bridge.get("weight_per_mm_g")),
            "bamboo_dry_weight_g": bamboo_dry_weight_g,
            "bamboo_wet_weight_g": bamboo_wet_weight_g,
            "trim_loss_mm": _snapshot_float(spec_snapshot.get("cut_loss_mm")) or _snapshot_float(yield_snapshot.get("cut_loss_mm")),
            "selected_bamboo_length_mm": selected_bamboo_length,
            "usable_length_mm": usable_length,
            "pcs_per_bamboo": pcs_per_bamboo,
            "target_bamboo_count": material_plan_snapshot.get("target_bamboo_count") or target_bamboo_count,
            "moisture_limits": {
                "min": _snapshot_float(moisture_min),
                "max": _snapshot_float(moisture_max),
            },
        },
        "setup_tooling": {
            "mandrel": str(spec_snapshot.get("mandrel_id") or ""),
            "spec_reference": spec_snapshot.get("spec_reference") or "",
            "tube_direction": spec_snapshot.get("notch_direction") or spec_snapshot.get("tube_direction") or "",
            "notch_direction": spec_snapshot.get("notch_direction") or spec_snapshot.get("tube_direction") or "",
            "notch_position": spec_snapshot.get("notch_position") or "",
            "notch_type": spec_snapshot.get("notch_type") or "",
            "notch_distance": spec_snapshot.get("notch_distance_mm") or "",
            "notch_depth": spec_snapshot.get("notch_depth_mm") or "",
            "notching_holder": spec_snapshot.get("notching_holder") or spec_snapshot.get("holder") or "",
            "punch": spec_snapshot.get("punch") or "",
            "blade": spec_snapshot.get("notching_blade") or spec_snapshot.get("blade") or "",
            "v_flat": spec_snapshot.get("v_flat") or spec_snapshot.get("groove") or "",
            "notch_wider": spec_snapshot.get("notch_wider") or "",
            "notch_patti": spec_snapshot.get("notch_patti") or "",
            "tooling_usage": _notch_tooling_usage_from_snapshot(spec_snapshot),
            "groove": spec_snapshot.get("groove") or "",
            "wider_tool": spec_snapshot.get("wider_tool") or "",
            "tochha": spec_snapshot.get("tochha") or "",
            "tochha_type": spec_snapshot.get("tochha_type") or "",
            "height_gauge_go": spec_snapshot.get("height_gauge_go") or "",
            "height_gauge_set": spec_snapshot.get("height_gauge_set") or "",
            "height_gauge_no_go": spec_snapshot.get("height_gauge_no_go") or "",
            "die": spec_snapshot.get("die") or "",
            "bundle_type": spec_snapshot.get("bundle_type") or "",
            "bundle_code": spec_snapshot.get("bundle_code") or "",
            "packing_ply": spec_snapshot.get("packing_ply") or "",
            "qty_per_box": spec_snapshot.get("qty_per_box") or "",
            "packing_pcs": spec_snapshot.get("packing_pcs") or "",
            "box_code": spec_snapshot.get("box_code") or spec_snapshot.get("box") or "",
            "box": spec_snapshot.get("box_code") or spec_snapshot.get("box") or "",
            "box_size": spec_snapshot.get("box_size") or "",
            "plastic_required": spec_snapshot.get("plastic_required") or "",
            "plastic_sku": spec_snapshot.get("plastic_sku") or "",
            "plastic_per_box": spec_snapshot.get("plastic_per_box") or "",
            "fadda_sku": spec_snapshot.get("fadda_sku") or "",
            "fadda_per_box": spec_snapshot.get("fadda_per_box") or "",
            "bopp_required": spec_snapshot.get("bopp_required") or "",
            "special_instructions": spec_snapshot.get("special_instructions") or "",
            "packing_instructions": spec_snapshot.get("packing_instructions") or "",
        },
        "material_truth": {
            "planned_output_qty": material_plan_snapshot.get("planned_output_qty") or float(job_card.planned_qty or 0.0),
            "target_bamboo_count": material_plan_snapshot.get("target_bamboo_count") or target_bamboo_count,
            "pcs_per_bamboo": pcs_per_bamboo,
            "issued_input_qty": _snapshot_float(getattr(winder_stage, "input_qty", None)),
            "produced_output_qty": _snapshot_float(getattr(process_stage, "output_qty", None))
            or _snapshot_float(getattr(winder_stage, "output_qty", None)),
            "packed_qty": _snapshot_float(getattr(packing_stage, "output_qty", None)),
            "dispatched_qty": _snapshot_float(getattr(dispatch_stage, "output_qty", None)),
        },
        "recipe_summary": {
            "rows": recipe_rows,
            "adhesive_components": adhesive_components,
            "glue_base_percent": _snapshot_float(first_adhesive_component.get("base_percent")) or 15.0,
            "adhesive_total_g": _snapshot_float(adhesives_snapshot.get("total_adhesive_weight_kg")) * 1000.0
            if adhesives_snapshot.get("total_adhesive_weight_kg") is not None
            else None,
            "paper_total_g": _snapshot_float(raw_materials.get("total_input_weight_kg")) * 1000.0
            - (_snapshot_float(adhesives_snapshot.get("total_adhesive_weight_kg")) * 1000.0 if adhesives_snapshot.get("total_adhesive_weight_kg") is not None else 0.0)
            - (_snapshot_float(parchment_snapshot.get("weight_kg")) * 1000.0 if parchment_snapshot.get("weight_kg") is not None else 0.0)
            if raw_materials.get("total_input_weight_kg") is not None
            else None,
            "parchment_percent": _snapshot_float(parchment_snapshot.get("addition_percent")) or _snapshot_float(spec_snapshot.get("parchment_percent")),
            "parchment_weight_g": _snapshot_float(parchment_snapshot.get("weight_kg")) * 1000.0
            if parchment_snapshot.get("weight_kg") is not None
            else None,
            "drying_percent": shrink_percent,
            "predicted_dry_tube_g": _snapshot_float(weight_bridge.get("predicted_dry_tube_g")),
            "predicted_wet_tube_g": _snapshot_float(weight_bridge.get("predicted_wet_tube_g")),
            "bamboo_wet_weight_g": _snapshot_float(weight_bridge.get("bamboo_required_wet_g")),
            "weight_match_delta_g": _snapshot_float(weight_bridge.get("weight_match_delta_g")),
        },
        "winder_section": {
            "date": str(getattr(winder_stage, "plan_date", None) or job_card.created_at.date()),
            "shift_code": getattr(winder_stage, "shift_code", None),
            "machine_id": str(getattr(winder_stage, "machine_id", "") or ""),
            "operator_name": (getattr(winder_stage, "entry_snapshot", {}) or {}).get("operator_name"),
            "supervisor_name": (getattr(winder_stage, "entry_snapshot", {}) or {}).get("supervisor_name"),
            "qc_sign": (getattr(winder_stage, "entry_snapshot", {}) or {}).get("qc_sign"),
            "output_qty": _snapshot_float(getattr(winder_stage, "output_qty", None)),
            "accepted_qty": _snapshot_float((getattr(winder_stage, "entry_snapshot", {}) or {}).get("accepted_bamboo_count")),
            "reject_qty": _snapshot_float(getattr(winder_stage, "scrap_qty", None)),
            "rejection_code": (getattr(winder_stage, "entry_snapshot", {}) or {}).get("rejection_code"),
            "start_time": getattr(winder_stage, "actual_start", None),
            "end_time": getattr(winder_stage, "actual_end", None),
            "cycle_time_minutes": (getattr(winder_stage, "entry_snapshot", {}) or {}).get("cycle_time_minutes"),
            "dimension_rows": (getattr(winder_stage, "entry_snapshot", {}) or {}).get("dimension_readings", []),
            "reel_issue_ids": list(getattr(winder_stage, "reel_issue_ids", []) or []),
        },
        "oven_section": {
            "date": str(getattr(stage_lookup.get("OVEN"), "plan_date", None) or job_card.created_at.date()),
            "shift_code": getattr(stage_lookup.get("OVEN"), "shift_code", None),
            "machine_id": str(getattr(stage_lookup.get("OVEN"), "machine_id", "") or ""),
            "operator_name": (getattr(stage_lookup.get("OVEN"), "entry_snapshot", {}) or {}).get("operator_name"),
            "supervisor_name": (getattr(stage_lookup.get("OVEN"), "entry_snapshot", {}) or {}).get("supervisor_name"),
            "qc_sign": (getattr(stage_lookup.get("OVEN"), "entry_snapshot", {}) or {}).get("qc_sign"),
            "winder_ok_qty": _snapshot_float((getattr(stage_lookup.get("OVEN"), "entry_snapshot", {}) or {}).get("bamboo_count_in"))
            or _snapshot_float(getattr(stage_lookup.get("OVEN"), "input_qty", None)),
            "output_qty": _snapshot_float(getattr(stage_lookup.get("OVEN"), "output_qty", None)),
            "reject_qty": _snapshot_float(getattr(stage_lookup.get("OVEN"), "scrap_qty", None)),
            "rejection_code": (getattr(stage_lookup.get("OVEN"), "entry_snapshot", {}) or {}).get("rejection_code"),
            "start_time": getattr(stage_lookup.get("OVEN"), "actual_start", None),
            "end_time": getattr(stage_lookup.get("OVEN"), "actual_end", None),
            "cycle_time_minutes": (getattr(stage_lookup.get("OVEN"), "entry_snapshot", {}) or {}).get("cycle_time_minutes"),
            "pre_weight": (getattr(stage_lookup.get("OVEN"), "entry_snapshot", {}) or {}).get("pre_weight"),
            "post_weight": (getattr(stage_lookup.get("OVEN"), "entry_snapshot", {}) or {}).get("post_weight"),
            "pre_moisture": (getattr(stage_lookup.get("OVEN"), "entry_snapshot", {}) or {}).get("pre_moisture"),
            "post_moisture": (getattr(stage_lookup.get("OVEN"), "entry_snapshot", {}) or {}).get("post_moisture"),
        },
        "sections_meta": {
            "legacy_notes": (
                ["Rendered with live spec fallback because this job card predates Step 7C snapshot enrichment."]
                if snapshot_mode == "legacy_fallback"
                else []
            ),
            "missing_fields": sorted(set(missing_fields)),
        },
    }


def _build_spec_snapshot(spec: dict[str, Any], priority: str) -> dict[str, Any]:
    dynamic_map = _dynamic_field_map(spec)
    length_avg = _snapshot_mid(spec.get("length_min_mm"), spec.get("length_max_mm"))
    bamboo_plan = _resolve_bamboo_plan_for_length(
        length_avg,
        bamboo_min=float(spec.get("bamboo_min_length") or 1390.0),
        bamboo_max=float(spec.get("bamboo_max_length") or 1560.0),
        bamboo_increment=float(spec.get("bamboo_increment_mm") or 10.0),
        cut_loss=float(spec.get("cut_loss_mm") or 40.0),
    )
    slitting_hint_values = [
        dynamic_map.get("operational_requires_slitting"),
        dynamic_map.get("requires_slitting"),
        dynamic_map.get("source_material_form"),
        dynamic_map.get("source_material_type"),
        dynamic_map.get("source_reel_form"),
        dynamic_map.get("inward_form"),
        dynamic_map.get("material_form"),
        spec.get("operational_requires_slitting"),
        spec.get("requires_slitting"),
    ]
    operational_requires_slitting = False
    for hint in slitting_hint_values:
        if isinstance(hint, bool):
            operational_requires_slitting = hint
            break
        text = str(hint or "").strip().lower()
        if text in {"true", "1", "yes", "y"}:
            operational_requires_slitting = True
            break
        if any(token in text for token in ["jumbo", "roll", "mill roll"]):
            operational_requires_slitting = True
            break
        if any(token in text for token in ["reel", "slit reel", "ready reel"]):
            operational_requires_slitting = False
            break
    return {
        "spec_id": spec.get("id"),
        "spec_reference": spec.get("spec_reference"),
        "customer_id": spec.get("customer_id"),
        "customer_name_snapshot": spec.get("customer_name_snapshot", spec.get("customer_name")),
        "tube_size_id": spec.get("tube_size_id"),
        "mandrel_id": spec.get("mandrel_id"),
        "target_tube_weight": spec.get("target_tube_weight"),
        "required_cs": spec.get("required_cs"),
        "approved_cs": spec.get("approved_cs"),
        "id_min_mm": spec.get("id_min_mm"),
        "id_max_mm": spec.get("id_max_mm"),
        "od_min_mm": spec.get("od_min_mm"),
        "od_max_mm": spec.get("od_max_mm"),
        "length_min_mm": spec.get("length_min_mm"),
        "length_max_mm": spec.get("length_max_mm"),
        "weight_min_g": spec.get("weight_min_g"),
        "weight_max_g": spec.get("weight_max_g"),
        "cs_min_n": spec.get("cs_min_n"),
        "cs_max_n": spec.get("cs_max_n"),
        "moisture_min_pct": spec.get("moisture_min_pct"),
        "moisture_max_pct": spec.get("moisture_max_pct"),
        "parchment_percent": spec.get("parchment_percent"),
        "parchment_color": spec.get("parchment_color"),
        "shrink_percent": spec.get("shrink_percent"),
        "bamboo_min_length": 1390.0,
        "bamboo_max_length": spec.get("bamboo_max_length"),
        "bamboo_increment_mm": 10.0,
        "cut_loss_mm": spec.get("cut_loss_mm"),
        "selected_bamboo_length_mm": bamboo_plan.get("selected_bamboo_length_mm") if bamboo_plan else None,
        "usable_length_mm": bamboo_plan.get("usable_length_mm") if bamboo_plan else None,
        "pcs_per_bamboo": bamboo_plan.get("tubes_per_bamboo") if bamboo_plan else None,
        "status": spec.get("status"),
        "version": spec.get("version"),
        "priority": priority,
        "requires_slitting": operational_requires_slitting,
        "operational_requires_slitting": operational_requires_slitting,
        "notch_capability_required": _display_bool(dynamic_map.get("notch_required")) == "Yes",
        "top_paper_required": _display_bool(dynamic_map.get("top_paper_required")),
        "notch_type": dynamic_map.get("notch_type"),
        "notch_distance_mm": dynamic_map.get("notch_distance_mm"),
        "notch_depth_mm": dynamic_map.get("notch_depth_mm"),
        "notching_holder": dynamic_map.get("notching_holder"),
        "punch": dynamic_map.get("punch"),
        "notching_blade": dynamic_map.get("notching_blade"),
        "blade": dynamic_map.get("notching_blade"),
        "holder": dynamic_map.get("notching_holder"),
        "v_flat": dynamic_map.get("v_flat") or dynamic_map.get("groove"),
        "notch_wider": dynamic_map.get("notch_wider"),
        "notch_patti": dynamic_map.get("notch_patti"),
        "notch_direction": dynamic_map.get("notch_direction") or dynamic_map.get("tube_direction"),
        "tube_direction": dynamic_map.get("notch_direction") or dynamic_map.get("tube_direction"),
        "tooling_usage": _notch_tooling_usage_from_values(dynamic_map),
        "notch_position": dynamic_map.get("notch_position"),
        "groove": dynamic_map.get("groove"),
        "wider_tool": dynamic_map.get("wider_tool"),
        "tochha": dynamic_map.get("tochha"),
        "tochha_type": dynamic_map.get("tochha_type"),
        "height_gauge_go": dynamic_map.get("height_gauge_go"),
        "height_gauge_set": dynamic_map.get("height_gauge_set"),
        "height_gauge_no_go": dynamic_map.get("height_gauge_no_go"),
        "die": dynamic_map.get("die"),
        "bundle_type": dynamic_map.get("bundle_type"),
        "bundle_code": dynamic_map.get("bundle_code"),
        "packing_ply": dynamic_map.get("packing_ply"),
        "qty_per_box": dynamic_map.get("qty_per_box"),
        "packing_pcs": dynamic_map.get("packing_pcs"),
        "box_code": dynamic_map.get("box_code") or dynamic_map.get("box"),
        "box_size": dynamic_map.get("box_size"),
        "plastic_required": _display_bool(dynamic_map.get("plastic_required")),
        "plastic_sku": dynamic_map.get("plastic_sku"),
        "plastic_per_box": dynamic_map.get("plastic_per_box"),
        "fadda_sku": dynamic_map.get("fadda_sku"),
        "fadda_per_box": dynamic_map.get("fadda_per_box"),
        "bopp_required": _display_bool(dynamic_map.get("bopp_required")),
        "box": dynamic_map.get("box_code") or dynamic_map.get("box"),
        "special_instructions": dynamic_map.get("special_instructions"),
        "packing_instructions": _packing_instructions(dynamic_map),
        "adhesive_components_json": dynamic_map.get("adhesive_components_json"),
        "recipe_sheet_json": dynamic_map.get("recipe_sheet_json"),
    }


def _line_requires_slitting(line: dict[str, Any], spec_snapshot: dict[str, Any]) -> bool:
    del line
    return bool(spec_snapshot.get("operational_requires_slitting") or spec_snapshot.get("requires_slitting"))


def _primary_recipe_snapshot(spec_id: uuid.UUID, token: str, plant_id: str) -> dict[str, Any]:
    recipes = _fetch_recipes_for_spec(spec_id, token, plant_id)
    if not recipes:
        return {}
    approved = next((row for row in recipes if str(row.get("status", "")).lower() == "approved"), recipes[0])
    return {
        "recipe_id": approved.get("id"),
        "version": approved.get("version"),
        "status": approved.get("status"),
        "layers": approved.get("layers") or [],
    }


def _build_job_card_snapshots(
    *,
    spec: dict[str, Any],
    line: dict[str, Any],
    live_order: dict[str, Any],
    priority: str,
    token: str,
    plant_id: str,
    planned_qty: float,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], bool]:
    spec_snapshot = _build_spec_snapshot(spec, priority=priority)
    requires_slitting = _line_requires_slitting(line, spec_snapshot)
    spec_snapshot["requires_slitting"] = requires_slitting
    spec_snapshot["sales_order_line_id"] = str(line.get("id") or "")
    spec_snapshot["sales_order_order_no"] = live_order.get("order_no")
    spec_snapshot["sales_order_po_number"] = live_order.get("po_number")
    spec_snapshot["sales_order_po_date"] = live_order.get("po_date")
    spec_snapshot["sales_order_line_due_date"] = str(line.get("due_date") or "")
    spec_snapshot["sales_order_line_no"] = line.get("line_no")
    spec_snapshot["sales_order_line_size_label"] = line.get("size_label")
    spec_snapshot["sales_order_line_product_code"] = line.get("product_code")
    spec_snapshot["sales_order_line_rate_per_pc"] = line.get("rate_per_pc")
    spec_snapshot["sales_order_line_parchment_required"] = bool(line.get("parchment_required"))
    spec_snapshot["sales_order_line_parchment_color"] = line.get("parchment_color")
    spec_snapshot["parchment_color"] = line.get("parchment_color") if line.get("parchment_required") else None
    spec_snapshot["product_code"] = line.get("product_code")
    spec_snapshot["sales_order_remaining_qty"] = max(
        0.0,
        float(line.get("qty") or 0.0) - float(line.get("fulfilled_qty") or 0.0),
    )
    spec_snapshot["sales_order_dispatched_qty"] = float(line.get("fulfilled_qty") or 0.0)
    spec_snapshot["lot_number"] = f"{datetime.utcnow().strftime('%d/%m')}/{str(line.get('id') or '')[:6]}".upper()
    recipe_snapshot = _primary_recipe_snapshot(uuid.UUID(str(spec["id"])), token, plant_id)
    yield_snapshot = _fetch_spec_calculation(f"/calculate/yield/{spec['id']}", token, plant_id)
    bom_snapshot = {}
    if recipe_snapshot.get("recipe_id"):
        bom_snapshot = _fetch_spec_calculation(
            f"/calculate/bom/{recipe_snapshot['recipe_id']}",
            token,
            plant_id,
        )
    routing_stages = _routing_stages_from_snapshot(spec_snapshot)
    routing_snapshot = {
        "stages": routing_stages,
        "first_stage": routing_stages[0],
        "optional_stages": ["SLITTING"] if requires_slitting else [],
        "planning_gate": "TRUTH_GATED",
    }
    target_bamboo_count = None
    pcs_per_bamboo = spec_snapshot.get("pcs_per_bamboo")
    if pcs_per_bamboo and float(pcs_per_bamboo) > 0:
        target_bamboo_count = int(math.ceil(float(planned_qty or 0.0) / float(pcs_per_bamboo)))
    material_plan_snapshot = {
        "planned_qty": float(planned_qty or 0.0),
        "planned_output_qty": float(planned_qty or 0.0),
        "selected_bamboo_length_mm": spec_snapshot.get("selected_bamboo_length_mm"),
        "usable_length_mm": spec_snapshot.get("usable_length_mm"),
        "pcs_per_bamboo": pcs_per_bamboo,
        "target_bamboo_count": target_bamboo_count,
        "yield_snapshot": yield_snapshot,
        "recipe_snapshot": recipe_snapshot,
        "bom_snapshot": bom_snapshot,
        "theoretical_consumption": bom_snapshot,
    }
    return spec_snapshot, routing_snapshot, material_plan_snapshot, requires_slitting


def _current_actor_role(current_user: dict) -> Optional[str]:
    roles = current_user.get("roles") or []
    if isinstance(roles, list) and roles:
        return str(roles[0])
    if roles:
        return str(roles)
    return None


def _current_actor_label(current_user: dict) -> Optional[str]:
    return (
        current_user.get("name")
        or current_user.get("email")
        or current_user.get("username")
        or current_user.get("sub")
    )


def _log_tooling_usage_for_job_card(
    *,
    job_card: JobCard,
    token: str,
    plant_id: str,
    current_user: dict,
) -> None:
    usage_rows = _notch_tooling_usage_from_snapshot(job_card.spec_snapshot or {})
    if not usage_rows:
        return
    headers = {"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id}
    actor = _current_actor_label(current_user)
    with httpx.Client(timeout=3.0) as client:
        for row in usage_rows:
            category = str(row.get("category") or "").strip()
            tool_name = str(row.get("tool_name") or "").strip()
            if not category or not tool_name:
                continue
            try:
                client.post(
                    f"{settings.MASTERDATA_SERVICE_URL}/master/tools/log-usage",
                    headers=headers,
                    json={
                        "tool_id": row.get("tool_id"),
                        "category": category,
                        "tool_name": tool_name,
                        "event_type": "PRODUCTION_USED",
                        "source_type": "JOB_CARD",
                        "source_id": str(job_card.id),
                        "source_ref": _format_ref("JC", job_card.id),
                        "production_qty": float(job_card.planned_qty or 0.0),
                        "actor": actor,
                        "notes": "Tool assigned to production job card",
                        "metadata_json": {
                            "field_key": row.get("field_key"),
                            "field_label": row.get("label"),
                            "spec_id": str(job_card.spec_id),
                            "sales_order_id": str(job_card.sales_order_id) if job_card.sales_order_id else None,
                            "release_lot_id": str(job_card.release_lot_id) if job_card.release_lot_id else None,
                        },
                    },
                )
            except (httpx.HTTPError, ValueError):
                continue


def _default_plan_date_from_snapshot(spec_snapshot: dict[str, Any]) -> date:
    return _snapshot_date(spec_snapshot.get("sales_order_line_due_date")) or datetime.utcnow().date()


def _line_remaining_qty(line: dict[str, Any]) -> float:
    return max(0.0, float(line.get("qty") or 0.0) - float(line.get("fulfilled_qty") or 0.0))


def _build_carry_forward_suggestion(job_card: JobCard, stages: list[JobCardStage]) -> dict[str, Any]:
    latest_output = 0.0
    source_stage: Optional[str] = None
    for stage_name in ["DISPATCH", "PACKING", "PROCESS", "OVEN", "WINDER", "SLITTING"]:
        stage_row = next((row for row in stages if row.stage_type == stage_name and row.status == "COMPLETED"), None)
        if not stage_row:
            continue
        latest_output = float(stage_row.output_qty or 0.0)
        source_stage = stage_name
        break
    remaining_qty = max(0.0, float(job_card.planned_qty or 0.0) - latest_output)
    return {
        "suggested": remaining_qty > 0.0001 and source_stage is not None,
        "source_stage": source_stage,
        "remaining_qty": round(remaining_qty, 4),
        "reason": (
            f"{source_stage} output is short against planned quantity; planner should confirm a remainder job card."
            if remaining_qty > 0.0001 and source_stage is not None
            else None
        ),
        "sales_order_line_id": job_card.sales_order_line_id,
        "parchment_color": (job_card.spec_snapshot or {}).get("parchment_color"),
    }


def _line_due_date(line: dict[str, Any]) -> date:
    raw_value = line.get("due_date")
    try:
        return date.fromisoformat(str(raw_value)) if raw_value else date.today()
    except ValueError:
        return date.today()


def _order_total_qty(live_order: dict[str, Any]) -> float:
    return round(sum(float(line.get("qty") or 0.0) for line in (live_order.get("lines") or [])), 2)


def _order_due_date(live_order: dict[str, Any]) -> date:
    line_dates = [_line_due_date(line) for line in (live_order.get("lines") or [])]
    if not line_dates:
        return date.today()
    return min(line_dates)


def _sync_local_sales_order(
    *,
    db: Session,
    plant_uuid: uuid.UUID,
    live_order: dict[str, Any],
    line_spec_id: uuid.UUID,
    priority: str,
) -> SalesOrder:
    customer_id_raw = live_order.get("customer_id")
    if not customer_id_raw:
        raise HTTPException(status_code=400, detail="Sales order customer is missing")

    order_status = _normalize_sales_status(live_order.get("status"))
    local_status = "PLANNED" if order_status in {"partially_released", "released", "partially_dispatched"} else "OPEN"
    sales_order = (
        db.query(SalesOrder)
        .filter(
            SalesOrder.id == _to_uuid(str(live_order.get("id")), field="sales_order_id"),
            SalesOrder.plant_id == plant_uuid,
        )
        .first()
    )
    if not sales_order:
        sales_order = SalesOrder(
            id=_to_uuid(str(live_order.get("id")), field="sales_order_id"),
            plant_id=plant_uuid,
            customer_id=_to_uuid(str(customer_id_raw), field="customer_id"),
            spec_id=line_spec_id,
            order_qty=max(_order_total_qty(live_order), 0.0),
            due_date=_order_due_date(live_order),
            priority=priority,
            status=local_status,
        )
        db.add(sales_order)
        db.flush()
        return sales_order

    sales_order.customer_id = _to_uuid(str(customer_id_raw), field="customer_id")
    sales_order.order_qty = max(_order_total_qty(live_order), 0.0)
    sales_order.due_date = _order_due_date(live_order)
    sales_order.priority = priority
    if sales_order.status != "COMPLETED":
        sales_order.status = local_status
    return sales_order


def _queue_status_for_stage(machine_id: Optional[uuid.UUID]) -> str:
    return "ASSIGNED" if machine_id else "QUEUED"


def _ensure_job_card_stages(
    *,
    db: Session,
    job_card: JobCard,
    routing_stages: list[str],
    first_stage: str,
) -> bool:
    existing_rows = {
        row.stage_type: row
        for row in db.query(JobCardStage).filter(JobCardStage.job_card_id == job_card.id).all()
    }
    segment_created = False
    default_plan_date = _default_plan_date_from_snapshot(job_card.spec_snapshot or {})
    for stage_type in routing_stages:
        stage_row = existing_rows.get(stage_type)
        if stage_row is None:
            stage_row = JobCardStage(
                job_card_id=job_card.id,
                stage_type=stage_type,
                status="PLANNED",
            )
            db.add(stage_row)
            db.flush()
            existing_rows[stage_type] = stage_row
        stage_row.plan_date = stage_row.plan_date or default_plan_date
        stage_row.shift_code = stage_row.shift_code or "SHIFT_A"
        stage_row.required_capacity = _required_capacity_for_job(
            stage=stage_type,
            planned_qty=float(job_card.planned_qty or 0.0),
            spec_snapshot=job_card.spec_snapshot or {},
        )
        if stage_type == first_stage and stage_row.status == "PLANNED":
            stage_row.status = _queue_status_for_stage(stage_row.machine_id)
        if stage_type != first_stage and stage_row.status == "QUEUED":
            stage_row.status = "PLANNED"

    for stage_type in routing_stages:
        stage_row = existing_rows[stage_type]
        if stage_row.status == "COMPLETED":
            continue
        existing_segments = _all_stage_segments(db, job_card.id, stage_type)
        if not existing_segments:
            _append_stage_segment(
                db=db,
                job_card=job_card,
                stage_row=stage_row,
                machine_id=stage_row.machine_id,
                plan_date=stage_row.plan_date,
                shift_code=stage_row.shift_code if stage_row.machine_id is not None or stage_type in {"QC", "DISPATCH"} else None,
                planned_qty=float(job_card.planned_qty or 0.0),
                required_capacity=float(stage_row.required_capacity or 0.0),
                split_source="NONE",
                split_parent_segment_id=None,
                status="ASSIGNED" if stage_type == first_stage and stage_row.machine_id is not None else _queue_status_for_stage(stage_row.machine_id),
            )
            segment_created = True
        else:
            open_segments = [segment for segment in existing_segments if segment.status not in {"COMPLETED", "CANCELLED"}]
            if len(open_segments) == 1 and open_segments[0].split_source == "NONE":
                open_segment = open_segments[0]
                open_segment.planned_qty = round(float(job_card.planned_qty or 0.0), 2)
                open_segment.required_capacity = round(float(stage_row.required_capacity or 0.0), 2)
                if open_segment.status not in {"RUNNING", "COMPLETED"}:
                    open_segment.status = "ASSIGNED" if open_segment.machine_id is not None else _queue_status_for_stage(open_segment.machine_id)
            _sync_stage_row_from_segments(stage_row, existing_segments)

        existing_queue = (
            db.query(StageQueueOrder)
            .filter(
                StageQueueOrder.job_card_id == job_card.id,
                StageQueueOrder.stage_type == stage_type,
            )
            .all()
        )
        for queue_row in existing_queue:
            db.delete(queue_row)
    return segment_created


def _lifecycle_label_for(job_card: JobCard) -> str:
    """Map the raw job status + released_qty + current_stage into one
    operator-friendly token. UI uses this to show a single clear badge.
    """
    status = str(job_card.status or "").upper()
    if status == "CANCELLED":
        return "CANCELLED"
    if status == "COMPLETED":
        # Closed = job is COMPLETED AND has fg posted (use current_stage == DONE as proxy).
        if str(job_card.current_stage or "").upper() == "DONE":
            return "CLOSED"
        return "COMPLETED"
    if status == "IN_PROGRESS":
        return "IN_PROGRESS"
    if status == "PLANNED":
        if float(job_card.released_qty or 0.0) > 0:
            return "RELEASED"
        return "SCHEDULED"
    if status == "CREATED":
        return "DRAFT"
    return status or "UNKNOWN"


def _serialize_job_card_response(job_card: JobCard) -> JobCardResponse:
    return JobCardResponse(
        id=job_card.id,
        plant_id=job_card.plant_id,
        sales_order_id=job_card.sales_order_id,
        sales_order_line_id=job_card.sales_order_line_id,
        release_lot_id=job_card.release_lot_id,
        spec_id=job_card.spec_id,
        spec_snapshot=job_card.spec_snapshot or {},
        routing_snapshot=job_card.routing_snapshot or {},
        material_plan_snapshot=job_card.material_plan_snapshot or {},
        released_qty=float(job_card.released_qty or 0.0),
        assigned_winder_machine_id=job_card.assigned_winder_machine_id,
        product_code=job_card.product_code,
        planned_qty=job_card.planned_qty,
        status=job_card.status,
        current_stage=job_card.current_stage,
        requires_slitting=bool(job_card.requires_slitting),
        created_at=job_card.created_at,
        lifecycle_label=_lifecycle_label_for(job_card),
    )


def _move_or_split_segment(
    *,
    db: Session,
    job_card: JobCard,
    stage_row: JobCardStage,
    segment: JobCardStageSegment,
    stage: str,
    machine_id: Optional[uuid.UUID],
    plan_date: Optional[date],
    shift_code: Optional[str],
    desired_sequence: int,
    token: str,
    plant_id: str,
    split_source: str = "AUTO",
) -> tuple[JobCardStageSegment, int]:
    normalized_shift = shift_code or ("SHIFT_A" if machine_id is not None or stage in {"QC", "DISPATCH"} else None)
    normalized_date = plan_date or stage_row.plan_date or _default_plan_date_from_snapshot(job_card.spec_snapshot or {})
    spec_snapshot = job_card.spec_snapshot or {}
    remaining_qty = round(float(segment.planned_qty or 0.0), 2)
    remaining_capacity = round(float(segment.required_capacity or 0.0), 2)

    if stage not in {"WINDER", "PROCESS"} or machine_id is None or normalized_date is None or normalized_shift is None:
        segment.status = "ASSIGNED" if machine_id is not None else _queue_status_for_stage(machine_id)
        _place_stage_segment(
            db=db,
            segment=segment,
            desired_sequence=desired_sequence,
            machine_id=machine_id,
            plan_date=normalized_date,
            shift_code=normalized_shift,
        )
        _sync_stage_row_from_segments(stage_row, _all_stage_segments(db, job_card.id, stage))
        open_count = len(_open_stage_segments(db, job_card.id, stage))
        return segment, open_count

    machine = _fetch_machine(machine_id, token, plant_id)
    _validate_machine_compatibility(
        machine=machine,
        stage=stage,
        spec_snapshot=spec_snapshot,
        plant_id=plant_id,
    )
    machine_capacity = float(machine.get("capacity_value") or 0.0)
    daily_capacity, capacity_unit = _oven_bamboo_capacity_profile(stage, machine)
    if not daily_capacity:
        daily_capacity, capacity_unit = _resolve_capacity_profile(
            db=db,
            plant_id=job_card.plant_id,
            stage=stage,
            machine_id=machine_id,
            machine_capacity=machine_capacity,
            on_day=normalized_date,
        )
    if not daily_capacity or daily_capacity <= 0 or not capacity_unit:
        segment.status = "ASSIGNED"
        _place_stage_segment(
            db=db,
            segment=segment,
            desired_sequence=desired_sequence,
            machine_id=machine_id,
            plan_date=normalized_date,
            shift_code=normalized_shift,
        )
        _sync_stage_row_from_segments(stage_row, _all_stage_segments(db, job_card.id, stage))
        open_count = len(_open_stage_segments(db, job_card.id, stage))
        return segment, open_count

    allocations: list[tuple[date, str, float, float]] = []
    next_sequence = desired_sequence
    for slot_date, slot_shift in _future_stage_slots(normalized_date, normalized_shift):
        slot_capacity_value, slot_capacity_unit = _oven_bamboo_capacity_profile(stage, machine)
        if not slot_capacity_value:
            slot_capacity_value, slot_capacity_unit = _resolve_capacity_profile(
                db=db,
                plant_id=job_card.plant_id,
                stage=stage,
                machine_id=machine_id,
                machine_capacity=machine_capacity,
                on_day=slot_date,
            )
        if not slot_capacity_value or slot_capacity_value <= 0:
            continue
        effective_unit = slot_capacity_unit or capacity_unit
        shift_capacity = _shift_capacity_value(slot_capacity_value, slot_shift)
        used_capacity = _lane_existing_segment_load(
            db=db,
            plant_id=job_card.plant_id,
            stage=stage,
            machine_id=machine_id,
            plan_date=slot_date,
            shift_code=slot_shift,
            exclude_segment_id=segment.id,
        )
        available_capacity = max(float(shift_capacity or 0.0) - used_capacity, 0.0)
        if stage == "OVEN":
            available_capacity = float(shift_capacity or 0.0)
        alloc_qty, alloc_capacity = _capacity_allocation_to_qty(
            stage=stage,
            capacity_unit=effective_unit,
            spec_snapshot=spec_snapshot,
            remaining_qty=remaining_qty,
            available_capacity=available_capacity,
        )
        if alloc_qty <= 0 or alloc_capacity <= 0:
            continue
        allocations.append((slot_date, slot_shift, alloc_qty, alloc_capacity))
        remaining_qty = round(max(remaining_qty - alloc_qty, 0.0), 2)
        remaining_capacity = round(max(remaining_capacity - alloc_capacity, 0.0), 2)
        if remaining_qty <= 0.0001:
            break
        next_sequence = 1

    if allocations and remaining_qty > 0.0001:
        last_date, last_shift, last_qty, last_capacity = allocations[-1]
        allocations[-1] = (
            last_date,
            last_shift,
            round(last_qty + remaining_qty, 2),
            round(last_capacity + remaining_capacity, 2),
        )
        remaining_qty = 0.0
        remaining_capacity = 0.0

    if not allocations:
        segment.status = "ASSIGNED"
        _place_stage_segment(
            db=db,
            segment=segment,
            desired_sequence=desired_sequence,
            machine_id=machine_id,
            plan_date=normalized_date,
            shift_code=normalized_shift,
        )
        _sync_stage_row_from_segments(stage_row, _all_stage_segments(db, job_card.id, stage))
        open_count = len(_open_stage_segments(db, job_card.id, stage))
        return segment, open_count

    first_allocation = allocations[0]
    segment.machine_id = machine_id
    segment.plan_date = first_allocation[0]
    segment.shift_code = first_allocation[1]
    segment.planned_qty = round(first_allocation[2], 2)
    segment.required_capacity = round(first_allocation[3], 2)
    segment.split_source = split_source if len(allocations) > 1 else (segment.split_source or "NONE")
    segment.status = "ASSIGNED"
    _place_stage_segment(
        db=db,
        segment=segment,
        desired_sequence=desired_sequence,
        machine_id=machine_id,
        plan_date=first_allocation[0],
        shift_code=first_allocation[1],
    )

    for slot_index, (slot_date, slot_shift, alloc_qty, alloc_capacity) in enumerate(allocations[1:], start=1):
        new_segment = _append_stage_segment(
            db=db,
            job_card=job_card,
            stage_row=stage_row,
            machine_id=machine_id,
            plan_date=slot_date,
            shift_code=slot_shift,
            planned_qty=alloc_qty,
            required_capacity=alloc_capacity,
            split_source=split_source,
            split_parent_segment_id=segment.id,
            status="ASSIGNED",
        )
        _place_stage_segment(
            db=db,
            segment=new_segment,
            desired_sequence=1 if slot_index > 0 else desired_sequence,
            machine_id=machine_id,
            plan_date=slot_date,
            shift_code=slot_shift,
        )

    _sync_stage_row_from_segments(stage_row, _all_stage_segments(db, job_card.id, stage))
    open_count = len(_open_stage_segments(db, job_card.id, stage))
    return segment, open_count


def _create_or_sync_job_card_for_line(
    *,
    db: Session,
    plant_uuid: uuid.UUID,
    live_order: dict[str, Any],
    line: dict[str, Any],
    release_lot_id: uuid.UUID,
    winder_machine_id: uuid.UUID,
    planned_qty: float,
    priority: str,
    product_code: Optional[str],
    token: str,
    plant_id: str,
    current_user: dict,
) -> tuple[JobCard, bool]:
    line_spec_id_raw = line.get("approved_spec_id")
    if not line_spec_id_raw:
        raise HTTPException(status_code=400, detail="Sales order line does not contain approved spec reference")
    line_spec_id = _to_uuid(str(line_spec_id_raw), field="approved_spec_id")

    sales_order = _sync_local_sales_order(
        db=db,
        plant_uuid=plant_uuid,
        live_order=live_order,
        line_spec_id=line_spec_id,
        priority=priority,
    )

    line_id = _to_uuid(str(line.get("id")), field="sales_order_line_id")
    existing = (
        db.query(JobCard)
        .filter(
            JobCard.plant_id == plant_uuid,
            JobCard.release_lot_id == release_lot_id,
        )
        .first()
    )

    spec = _fetch_spec(line_spec_id, token, plant_id)
    line_payload = {**line, "product_code": product_code or line.get("product_code")}
    spec_snapshot, routing_snapshot, material_plan_snapshot, requires_slitting = _build_job_card_snapshots(
        spec=spec,
        line=line_payload,
        live_order=live_order,
        priority=priority,
        token=token,
        plant_id=plant_id,
        planned_qty=planned_qty,
    )
    routing_stages = list(routing_snapshot.get("stages") or _routing_stages_from_snapshot(spec_snapshot))
    first_stage = str(routing_snapshot.get("first_stage") or routing_stages[0])
    assigned_winder = _fetch_machine(winder_machine_id, token, plant_id)
    _validate_machine_compatibility(
        machine=assigned_winder,
        stage="WINDER",
        spec_snapshot=spec_snapshot,
        plant_id=plant_id,
    )

    def _reset_winder_to_release_queue(job_card: JobCard) -> None:
        winder_stage = next((stage for stage in job_card.stages if stage.stage_type == "WINDER"), None)
        if not winder_stage:
            return
        queue_anchor_date = datetime.now(PLANT_TIMEZONE).date()
        winder_stage.machine_id = None
        winder_stage.plan_date = queue_anchor_date
        winder_stage.shift_code = None
        winder_stage.required_capacity = _required_capacity_for_job(
            stage="WINDER",
            planned_qty=float(job_card.planned_qty or 0.0),
            spec_snapshot=job_card.spec_snapshot or {},
        )
        if winder_stage.status != "COMPLETED":
            winder_stage.status = "QUEUED"

        open_winder_segments = _open_stage_segments(db, job_card.id, "WINDER")
        target_segment = open_winder_segments[0] if open_winder_segments else _append_stage_segment(
            db=db,
            job_card=job_card,
            stage_row=winder_stage,
            machine_id=None,
            plan_date=winder_stage.plan_date,
            shift_code=None,
            planned_qty=float(job_card.planned_qty or 0.0),
            required_capacity=float(winder_stage.required_capacity or 0.0),
            split_source="NONE",
            split_parent_segment_id=None,
            status="QUEUED",
        )
        target_segment.machine_id = None
        target_segment.plan_date = winder_stage.plan_date
        target_segment.shift_code = None
        target_segment.required_capacity = round(float(winder_stage.required_capacity or 0.0), 2)
        target_segment.planned_qty = round(float(job_card.planned_qty or 0.0), 2)
        target_segment.status = "QUEUED"
        target_segment.sequence_no = 1
        _sync_stage_row_from_segments(winder_stage, _all_stage_segments(db, job_card.id, "WINDER"))

    if existing:
        before_payload = {
            "planned_qty": float(existing.planned_qty or 0.0),
            "current_stage": existing.current_stage,
            "status": existing.status,
        }
        existing.spec_id = line_spec_id
        existing.spec_snapshot = spec_snapshot
        existing.routing_snapshot = routing_snapshot
        existing.material_plan_snapshot = material_plan_snapshot
        existing.release_lot_id = release_lot_id
        existing.released_qty = planned_qty
        existing.assigned_winder_machine_id = winder_machine_id
        existing.product_code = product_code
        existing.planned_qty = planned_qty
        existing.requires_slitting = requires_slitting
        if existing.status != "COMPLETED":
            existing.current_stage = first_stage if existing.current_stage == "DONE" else existing.current_stage
            existing.status = "PLANNED"
        queue_created = _ensure_job_card_stages(
            db=db,
            job_card=existing,
            routing_stages=routing_stages,
            first_stage=first_stage,
        )
        _record_audit_event(
            db=db,
            plant_id=plant_uuid,
            entity_type="job_card",
            entity_id=existing.id,
            action="release_sync_refresh",
            actor_id=current_user.get("sub"),
            actor_role=_current_actor_role(current_user),
            job_card_id=existing.id,
            payload={
                "sales_order_id": str(sales_order.id),
                "sales_order_line_id": str(line_id),
                "release_lot_id": str(release_lot_id),
                "first_stage": first_stage,
                "queue_created": queue_created,
            },
            before_payload=before_payload,
            after_payload={
                "planned_qty": float(existing.planned_qty or 0.0),
                "current_stage": existing.current_stage,
                "status": existing.status,
            },
        )
        _reset_winder_to_release_queue(existing)
        try:
            _log_tooling_usage_for_job_card(
                job_card=existing,
                token=token,
                plant_id=plant_id,
                current_user=current_user,
            )
        except Exception:
            pass
        return existing, queue_created

    job_card = JobCard(
        plant_id=plant_uuid,
        sales_order_id=sales_order.id,
        sales_order_line_id=line_id,
        release_lot_id=release_lot_id,
        spec_id=line_spec_id,
        spec_snapshot=spec_snapshot,
        routing_snapshot=routing_snapshot,
        material_plan_snapshot=material_plan_snapshot,
        released_qty=planned_qty,
        assigned_winder_machine_id=winder_machine_id,
        product_code=product_code,
        planned_qty=planned_qty,
        status="PLANNED",
        current_stage=first_stage,
        requires_slitting=requires_slitting,
    )
    db.add(job_card)
    db.flush()
    queue_created = _ensure_job_card_stages(
        db=db,
        job_card=job_card,
        routing_stages=routing_stages,
        first_stage=first_stage,
    )
    _record_audit_event(
        db=db,
        plant_id=plant_uuid,
        entity_type="job_card",
        entity_id=job_card.id,
        action="release_sync_create",
        actor_id=current_user.get("sub"),
        actor_role=_current_actor_role(current_user),
        job_card_id=job_card.id,
        payload={
            "sales_order_id": str(sales_order.id),
            "sales_order_line_id": str(line_id),
            "release_lot_id": str(release_lot_id),
            "first_stage": first_stage,
            "queue_created": queue_created,
            "requires_slitting": requires_slitting,
        },
        after_payload={
            "planned_qty": float(job_card.planned_qty or 0.0),
            "current_stage": job_card.current_stage,
            "status": job_card.status,
        },
    )
    _reset_winder_to_release_queue(job_card)
    try:
        _log_tooling_usage_for_job_card(
            job_card=job_card,
            token=token,
            plant_id=plant_id,
            current_user=current_user,
        )
    except Exception:
        pass
    return job_card, queue_created


def _quality_failures_for_stage(stage_type: str, spec_snapshot: dict[str, Any], quality_checks: dict[str, Any]) -> list[dict[str, Any]]:
    checks = dict(quality_checks or {})
    failures: list[dict[str, Any]] = []
    stage_type = stage_type.upper()

    def _number(value: Any) -> Optional[float]:
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _check_range(label: str, key: str, min_key: str, max_key: str) -> None:
        value = _number(checks.get(key))
        minimum = _number(spec_snapshot.get(min_key))
        maximum = _number(spec_snapshot.get(max_key))
        if value is None or minimum is None or maximum is None:
            return
        if value < minimum or value > maximum:
            failures.append({"label": label, "value": value, "min": minimum, "max": maximum})

    if stage_type in {"WINDER", "PROCESS", "PACKING", "QC"}:
        _check_range("ID", "id", "id_min_mm", "id_max_mm")
        _check_range("OD", "od", "od_min_mm", "od_max_mm")
        _check_range("Length", "length", "length_min_mm", "length_max_mm")
        _check_range("Weight", "weight", "weight_min_g", "weight_max_g")
        _check_range("CS", "cs", "cs_min_n", "cs_max_n")
    if stage_type == "OVEN":
        _check_range("Moisture", "moisture_after", "moisture_min_pct", "moisture_max_pct")
    return failures


def _missing_final_spec_qc_fields(spec_snapshot: dict[str, Any], readings: dict[str, Any]) -> list[str]:
    missing: list[str] = []
    for label, reading_key, min_key, max_key in FINAL_SPEC_QC_FIELDS:
        spec_has_field = spec_snapshot.get(min_key) is not None or spec_snapshot.get(max_key) is not None
        if spec_has_field and readings.get(reading_key) is None:
            missing.append(label)
    return missing


def _quality_inspections_for_stage(
    db: Session,
    job_card_id: uuid.UUID,
    stage_type: str,
    plant_id: Optional[uuid.UUID] = None,
) -> list[QualityInspection]:
    query = db.query(QualityInspection).filter(
        QualityInspection.job_card_id == job_card_id,
        QualityInspection.stage_type == stage_type,
    )
    if plant_id is not None:
        query = query.filter(QualityInspection.plant_id == plant_id)
    return query.order_by(QualityInspection.created_at.desc()).all()


def _inspection_has_full_final_spec(
    inspection: QualityInspection,
    spec_snapshot: dict[str, Any],
) -> bool:
    readings = dict(getattr(inspection, "readings", None) or {})
    return not _missing_final_spec_qc_fields(spec_snapshot, readings)


def _final_spec_qc_passed(
    *,
    db: Session,
    plant_id: uuid.UUID,
    job_card: JobCard,
    inline_quality_checks: Optional[dict[str, Any]] = None,
) -> bool:
    spec_snapshot = job_card.spec_snapshot or {}
    inline_readings = dict(inline_quality_checks or {})
    if inline_readings:
        if not _missing_final_spec_qc_fields(spec_snapshot, inline_readings):
            return not _quality_failures_for_stage(FINAL_SPEC_QC_STAGE, spec_snapshot, inline_readings)

    for inspection in _quality_inspections_for_stage(db, job_card.id, FINAL_SPEC_QC_STAGE, plant_id):
        if str(getattr(inspection, "status", "") or "").upper() != "PASS":
            continue
        if not _inspection_has_full_final_spec(inspection, spec_snapshot):
            continue
        if _quality_failures_for_stage(FINAL_SPEC_QC_STAGE, spec_snapshot, getattr(inspection, "readings", {}) or {}):
            continue
        return True
    return False


def _enforce_stage_quality_gate(
    *,
    db: Session,
    plant_id: uuid.UUID,
    job_card: JobCard,
    selected_stage: str,
    quality_checks: dict[str, Any],
    override_reason: Optional[str],
) -> None:
    if (override_reason or "").strip():
        return

    normalized_stage = selected_stage.upper()
    inline_checks = dict(quality_checks or {})
    if normalized_stage == FINAL_SPEC_QC_STAGE:
        missing = _missing_final_spec_qc_fields(job_card.spec_snapshot or {}, inline_checks)
        if inline_checks and missing:
            raise HTTPException(
                status_code=400,
                detail=f"Final QC requires full spec readings: {', '.join(missing)}",
            )
        if inline_checks:
            return
        for inspection in _quality_inspections_for_stage(db, job_card.id, FINAL_SPEC_QC_STAGE, plant_id):
            if _inspection_has_full_final_spec(inspection, job_card.spec_snapshot or {}):
                return
        raise HTTPException(
            status_code=409,
            detail="Final QC inspection is required before job card completion or FG handoff. Provide override_reason to continue.",
        )

    # Routine process-stage QC is evidence, not a completion gate. If readings
    # are supplied they are stored by _sync_quality_artifacts; failures open an
    # active hold that blocks the next movement through the normal hold gate.
    return


def _stage_allows_fg_inward(*, selected_stage: str, final_qc_ready: bool) -> bool:
    return selected_stage.upper() in {"PACKING", FINAL_SPEC_QC_STAGE} and final_qc_ready


def _validate_stage_completion_payload(
    *,
    selected_stage: str,
    payload: StageOutputPayload,
    stage: JobCardStage,
) -> None:
    entry_snapshot = dict(payload.entry_snapshot or stage.entry_snapshot or {})
    actuals_snapshot = dict(payload.actuals or stage.actuals_snapshot or {})
    missing_fields: list[str] = []

    def _present(value: Any) -> bool:
        if value is None:
            return False
        if isinstance(value, str):
            return bool(value.strip())
        if isinstance(value, (list, dict, tuple, set)):
            return len(value) > 0
        return True

    if selected_stage == "SLITTING":
        if not _present(entry_snapshot.get("parent_reel_id")):
            missing_fields.append("entry_snapshot.parent_reel_id")
        if not _present(entry_snapshot.get("child_reels")):
            missing_fields.append("entry_snapshot.child_reels")
        if payload.scrap_qty is None and not _present(entry_snapshot.get("trim_waste_kg")):
            missing_fields.append("scrap_qty or entry_snapshot.trim_waste_kg")

    if selected_stage == "OVEN":
        if payload.input_qty is None and not _present(entry_snapshot.get("bamboo_count_in")):
            missing_fields.append("input_qty or entry_snapshot.bamboo_count_in")
        if not _present(entry_snapshot.get("pre_weight")):
            missing_fields.append("entry_snapshot.pre_weight")
        if not _present(entry_snapshot.get("post_weight")):
            missing_fields.append("entry_snapshot.post_weight")
        if not _present(entry_snapshot.get("pre_moisture")):
            missing_fields.append("entry_snapshot.pre_moisture")
        if not _present(entry_snapshot.get("post_moisture")):
            missing_fields.append("entry_snapshot.post_moisture")
        if _present(entry_snapshot.get("pre_weight")) and _present(entry_snapshot.get("post_weight")):
            try:
                pre_weight = float(entry_snapshot.get("pre_weight"))
                post_weight = float(entry_snapshot.get("post_weight"))
                if post_weight > pre_weight + 1e-9:
                    raise HTTPException(status_code=400, detail="OVEN post_weight cannot exceed pre_weight")
            except (TypeError, ValueError):
                missing_fields.append("entry_snapshot.pre_weight/post_weight numeric")

    if missing_fields:
        raise HTTPException(
            status_code=400,
            detail=f"{selected_stage} completion is missing required fields: {', '.join(missing_fields)}",
        )


def _sync_quality_artifacts(
    *,
    db: Session,
    plant_id: uuid.UUID,
    job_card: JobCard,
    stage: JobCardStage,
    selected_stage: str,
    current_user: dict,
) -> list[QualityHold]:
    quality_payload = dict(stage.quality_checks or {})
    if not quality_payload:
        return []
    failures = _quality_failures_for_stage(selected_stage, job_card.spec_snapshot or {}, quality_payload)
    inspection = QualityInspection(
        plant_id=plant_id,
        job_card_id=job_card.id,
        stage_type=selected_stage,
        status="FAIL" if failures else "PASS",
        readings=quality_payload,
        failures=failures,
        created_by=current_user.get("sub"),
    )
    db.add(inspection)
    db.flush()
    if not failures:
        return []
    hold = QualityHold(
        plant_id=plant_id,
        job_card_id=job_card.id,
        stage_type=selected_stage,
        reason="; ".join(
            f"{item['label']} out of range ({item['value']} not in {item['min']}..{item['max']})" for item in failures
        ),
        status="HOLD",
        source_inspection_id=inspection.id,
        created_by=current_user.get("sub"),
    )
    db.add(hold)
    db.flush()
    return [hold]


def _sync_packing_record(
    *,
    db: Session,
    plant_id: uuid.UUID,
    job_card: JobCard,
    stage: JobCardStage,
    current_user: dict,
) -> Optional[PackingRecord]:
    if stage.stage_type != "PACKING":
        return None
    snapshot = dict(stage.entry_snapshot or {})
    snapshot.setdefault("completed_at", stage.actual_end.isoformat() if stage.actual_end else None)
    existing = db.query(PackingRecord).filter(PackingRecord.job_card_id == job_card.id).first()
    packed_qty = float(stage.output_qty or snapshot.get("total_packed_qty") or 0.0)
    stock_status = "QC_HOLD" if _job_has_active_hold(db, job_card.id) else str(snapshot.get("stock_status") or "UNRESTRICTED")
    if existing is None:
        existing = PackingRecord(
            plant_id=plant_id,
            job_card_id=job_card.id,
            fg_batch_no=str(snapshot.get("fg_batch_no") or f"FG-{str(job_card.id).replace('-', '')[:8].upper()}"),
            total_packed_qty=packed_qty,
            created_by=current_user.get("sub"),
        )
        db.add(existing)
    existing.fg_item_id = _nullable_uuid(snapshot.get("fg_item_id") or (job_card.spec_snapshot or {}).get("fg_item_id"))
    existing.qty_per_bundle = _optional_positive_float(snapshot.get("qty_per_bundle") or snapshot.get("pcs_per_bundle"))
    bundle_count = snapshot.get("bundle_count")
    try:
        existing.bundle_count = int(bundle_count) if bundle_count not in (None, "") else existing.bundle_count
    except (TypeError, ValueError):
        pass
    existing.total_packed_qty = packed_qty
    existing.location_id = stage.location_id
    existing.stock_status = stock_status
    existing.snapshot = snapshot
    return existing


def _job_has_active_hold(db: Session, job_card_id: uuid.UUID) -> bool:
    count = (
        db.query(func.count(QualityHold.id))
        .filter(
            QualityHold.job_card_id == job_card_id,
            QualityHold.status.in_(list(QC_BLOCKING_STATUSES)),
        )
        .scalar()
    )
    return bool(count)


def _bucket_entries(
    db: Session,
    plant_id: uuid.UUID,
    stage: str,
    machine_id: Optional[uuid.UUID],
    plan_date: Optional[date] = None,
    shift_code: Optional[str] = None,
    exclude_id: Optional[uuid.UUID] = None,
) -> list[StageQueueOrder]:
    query = db.query(StageQueueOrder).filter(
        StageQueueOrder.plant_id == plant_id,
        StageQueueOrder.stage_type == stage,
    )
    if machine_id is None:
        query = query.filter(StageQueueOrder.machine_id.is_(None))
    else:
        query = query.filter(StageQueueOrder.machine_id == machine_id)
    # Queue slot uniqueness is defined only by plant + stage + machine/null-machine + sequence.
    # Plan date and shift remain board metadata and must not fragment slot resequencing.
    if exclude_id:
        query = query.filter(StageQueueOrder.id != exclude_id)
    return query.order_by(StageQueueOrder.sequence_no.asc(), StageQueueOrder.created_at.asc()).all()


def _resequence_entries(db: Session, entries: list[StageQueueOrder]) -> None:
    # Move every row into a bucket-local temporary positive range that is higher
    # than any currently assigned slot so PostgreSQL never sees duplicate
    # sequence_no values during the two-phase resequence.
    temp_base = max((int(entry.sequence_no or 0) for entry in entries), default=0) + len(entries) + 1_000
    for idx, entry in enumerate(entries, start=1):
        entry.sequence_no = temp_base + idx
    db.flush()
    for idx, entry in enumerate(entries, start=1):
        entry.sequence_no = idx


def _temporary_sequence_for_bucket(
    db: Session,
    plant_id: uuid.UUID,
    stage: str,
    machine_id: Optional[uuid.UUID],
) -> int:
    current_max = _next_sequence_for_bucket(
        db=db,
        plant_id=plant_id,
        stage=stage,
        machine_id=machine_id,
    )
    return int(current_max or 1) + 1_000_000


def _place_queue_entry(
    db: Session,
    entry: StageQueueOrder,
    desired_sequence: int,
    machine_id: Optional[uuid.UUID],
    plan_date: Optional[date],
    shift_code: Optional[str],
) -> None:
    old_machine = entry.machine_id
    # Queue slot uniqueness is defined by plant + stage + machine/null-machine + sequence.
    # Date and shift are board metadata only, so only a machine/null-machine change requires
    # detaching the moving row before resequencing the old bucket.
    bucket_changed = old_machine != machine_id
    if bucket_changed:
        entry.machine_id = machine_id
        entry.plan_date = plan_date
        entry.shift_code = shift_code
        entry.sequence_no = _temporary_sequence_for_bucket(
            db=db,
            plant_id=entry.plant_id,
            stage=entry.stage_type,
            machine_id=machine_id,
        )
        db.flush()

        old_bucket = _bucket_entries(
            db=db,
            plant_id=entry.plant_id,
            stage=entry.stage_type,
            machine_id=old_machine,
            exclude_id=entry.id,
        )
        if old_bucket:
            _resequence_entries(db, old_bucket)

    target_bucket = _bucket_entries(
        db=db,
        plant_id=entry.plant_id,
        stage=entry.stage_type,
        machine_id=machine_id,
        plan_date=plan_date,
        shift_code=shift_code,
        exclude_id=entry.id,
    )
    position = max(1, min(desired_sequence, len(target_bucket) + 1))
    entry.machine_id = machine_id
    entry.plan_date = plan_date
    entry.shift_code = shift_code
    target_bucket.insert(position - 1, entry)
    _resequence_entries(db, target_bucket)


def _upsert_stage_queue(
    db: Session,
    plant_id: uuid.UUID,
    stage: str,
    job_card_id: uuid.UUID,
    machine_id: Optional[uuid.UUID],
    desired_sequence: int,
    plan_date: Optional[date] = None,
    shift_code: Optional[str] = None,
    required_capacity: Optional[float] = None,
) -> StageQueueOrder:
    entry = (
        db.query(StageQueueOrder)
        .filter(
            StageQueueOrder.job_card_id == job_card_id,
            StageQueueOrder.stage_type == stage,
        )
        .first()
    )
    if not entry:
        temp_sequence = _next_sequence_for_bucket(
            db=db,
            plant_id=plant_id,
            stage=stage,
            machine_id=machine_id,
            plan_date=plan_date,
            shift_code=shift_code,
        )
        entry = StageQueueOrder(
            plant_id=plant_id,
            stage_type=stage,
            machine_id=machine_id,
            job_card_id=job_card_id,
            plan_date=plan_date,
            shift_code=shift_code,
            required_capacity=required_capacity,
            sequence_no=max(1, temp_sequence),
        )
        db.add(entry)
        db.flush()

    entry.required_capacity = required_capacity
    _place_queue_entry(
        db,
        entry,
        desired_sequence=max(1, desired_sequence),
        machine_id=machine_id,
        plan_date=plan_date,
        shift_code=shift_code,
    )
    return entry


def _next_sequence_for_bucket(
    db: Session,
    plant_id: uuid.UUID,
    stage: str,
    machine_id: Optional[uuid.UUID],
    plan_date: Optional[date] = None,
    shift_code: Optional[str] = None,
) -> int:
    query = db.query(func.max(StageQueueOrder.sequence_no)).filter(
        StageQueueOrder.plant_id == plant_id,
        StageQueueOrder.stage_type == stage,
    )
    if machine_id is None:
        query = query.filter(StageQueueOrder.machine_id.is_(None))
    else:
        query = query.filter(StageQueueOrder.machine_id == machine_id)
    current_max = query.scalar()
    return int(current_max or 0) + 1


def _next_sequence_for_unassigned(
    db: Session,
    plant_id: uuid.UUID,
    stage: str,
    plan_date: Optional[date] = None,
    shift_code: Optional[str] = None,
) -> int:
    return _next_sequence_for_bucket(
        db=db,
        plant_id=plant_id,
        stage=stage,
        machine_id=None,
        plan_date=plan_date,
        shift_code=shift_code,
    )


def _derive_job_current_stage_and_status(stages: list[JobCardStage]) -> tuple[str, str]:
    for row in _sorted_stage_rows(stages):
        if row.status != "COMPLETED":
            return row.stage_type, "IN_PROGRESS"
    return "DONE", "COMPLETED"


def _planner_gate_context(
    *,
    current_stage: str,
    active_stage: Optional[JobCardStage] = None,
    active_segment: Optional[JobCardStageSegment] = None,
    today: Optional[date] = None,
) -> dict[str, Any]:
    selected_stage = str(current_stage or "WINDER").upper()
    reference = active_segment or active_stage
    machine_id = str(getattr(reference, "machine_id", None)) if getattr(reference, "machine_id", None) else None
    plan_date = getattr(reference, "plan_date", None)
    shift_code = str(getattr(reference, "shift_code", "") or "").upper() or None
    status = str(getattr(reference, "status", "") or "").upper()
    scheduled_stages = {"SLITTING", "WINDER", "OVEN", "PROCESS"}

    context = {
        "planner_gate_ready": True,
        "planner_gate_reason": None,
        "active_segment_machine_id": machine_id,
        "active_segment_plan_date": plan_date,
    }

    if selected_stage == "DONE" or selected_stage not in scheduled_stages:
        return context

    if reference is None or status in {"COMPLETED", "CANCELLED"}:
        context["planner_gate_ready"] = False
        context["planner_gate_reason"] = (
            "Schedule this stage in the planner for the next 3 days before floor entry."
        )
        return context

    if not machine_id or not shift_code or plan_date is None:
        context["planner_gate_ready"] = False
        context["planner_gate_reason"] = (
            "Schedule machine, shift, and a planner date in the next 3 days before floor entry."
        )
        return context

    normalized_today = today or datetime.now(PLANT_TIMEZONE).date()
    window_end = normalized_today + timedelta(days=2)
    if plan_date < normalized_today:
        context["planner_gate_ready"] = False
        context["planner_gate_reason"] = (
            "Current planner slot is stale. Move this stage into the next 3 days before floor entry."
        )
        return context
    if plan_date > window_end:
        context["planner_gate_ready"] = False
        context["planner_gate_reason"] = (
            "Current planner slot is outside the next 3 days. Move it into the next 3 days before floor entry."
        )
        return context

    return context


def _update_sales_order_completion(db: Session, sales_order: SalesOrder) -> None:
    packed_qty = (
        db.query(func.coalesce(func.sum(JobCardStage.output_qty), 0.0))
        .join(JobCard, JobCard.id == JobCardStage.job_card_id)
        .filter(
            JobCard.sales_order_id == sales_order.id,
            JobCardStage.stage_type == "PACKING",
            JobCardStage.status == "COMPLETED",
        )
        .scalar()
    )
    if float(packed_qty or 0.0) >= float(sales_order.order_qty):
        sales_order.status = "COMPLETED"


def _apply_plant_scope_filter(query, column, plant_scope: dict):
    if plant_scope.get("scope_all"):
        allowed_plants = plant_scope.get("allowed_plants") or []
        if allowed_plants:
            allowed_uuids = [_to_uuid(value) for value in allowed_plants]
            return query.filter(column.in_(allowed_uuids))
        return query
    return query.filter(column == _to_uuid(plant_scope["selected_plant_id"]))


def _carry_forward_lookup(db: Session, plant_scope: dict) -> dict[str, dict[str, Optional[str]]]:
    """Build a lookup keyed by carry-forward (top-up) job_card_id.

    Returns { str(carry_forward_job_card_id): {"source": str(job_card_id), "reason": reason_code} }
    so the planner board/queue can badge top-up cards with their originating JC. The
    lookup is built once per board/queue request and threaded into the item builders.
    """
    query = db.query(JobCardShortClose).filter(JobCardShortClose.carry_forward_job_card_id.isnot(None))
    query = _apply_plant_scope_filter(query, JobCardShortClose.plant_id, plant_scope)
    lookup: dict[str, dict[str, Optional[str]]] = {}
    for row in query.all():
        if not row.carry_forward_job_card_id:
            continue
        lookup[str(row.carry_forward_job_card_id)] = {
            "source": str(row.job_card_id),
            "reason": row.reason_code,
        }
    return lookup


def _customer_name_from_snapshot(spec_snapshot: dict[str, Any]) -> Optional[str]:
    return (
        spec_snapshot.get("customer_name_snapshot")
        or spec_snapshot.get("customer_name")
    )


def _stage_activity_date(stage_row: JobCardStage) -> Optional[date]:
    for value in [stage_row.actual_end, stage_row.entered_at, stage_row.actual_start, stage_row.created_at]:
        if value:
            return value.date()
    return None


def _segment_activity_date(segment: JobCardStageSegment) -> Optional[date]:
    if segment.plan_date:
        return segment.plan_date
    for value in [segment.completed_at, segment.started_at, segment.created_at]:
        if value:
            return value.date()
    return None


def _build_execution_snapshot(
    *,
    db: Session,
    plant_scope: dict,
    start_date: date,
    end_date: date,
) -> dict[str, Any]:
    card_rows = (
        _apply_plant_scope_filter(
            db.query(JobCard, SalesOrder).outerjoin(SalesOrder, SalesOrder.id == JobCard.sales_order_id),
            JobCard.plant_id,
            plant_scope,
        )
        .order_by(JobCard.created_at.desc())
        .all()
    )

    open_segments = _apply_plant_scope_filter(
        db.query(JobCardStageSegment).filter(JobCardStageSegment.status.notin_(["COMPLETED", "CANCELLED"])),
        JobCardStageSegment.plant_id,
        plant_scope,
    ).all()
    open_segment_map: dict[tuple[uuid.UUID, str], list[JobCardStageSegment]] = defaultdict(list)
    for segment in open_segments:
        open_segment_map[(segment.job_card_id, str(segment.stage_type or "").upper())].append(segment)
    for bucket in open_segment_map.values():
        bucket.sort(
            key=lambda row: (
                row.plan_date or date.min,
                row.shift_code or "",
                int(row.sequence_no or 1),
                row.created_at or datetime.min,
            )
        )

    live_rows: list[dict[str, Any]] = []
    wip_by_stage: dict[str, int] = defaultdict(int)
    active_cards = 0
    blocked_jobs = 0
    overdue_jobs = 0
    completed_cards = 0
    today = datetime.now(PLANT_TIMEZONE).date()

    for job_card, sales_order in card_rows:
        status = str(job_card.status or "").upper()
        if status == "COMPLETED":
            completed_cards += 1
        if status in {"COMPLETED", "CANCELLED"}:
            continue
        active_cards += 1
        stage = str(job_card.current_stage or "WINDER").upper()
        wip_by_stage[stage] += 1
        scoped_segments = open_segment_map.get((job_card.id, stage), [])
        active_segment = scoped_segments[0] if scoped_segments else None
        blocked_reason = None
        if len(scoped_segments) > 1:
            blocked_reason = f"{len(scoped_segments)} open segments still need stage completion"
        due_date = sales_order.due_date if sales_order else _snapshot_date((job_card.spec_snapshot or {}).get("sales_order_line_due_date"))
        if due_date and due_date < today:
            overdue_jobs += 1
        if blocked_reason:
            blocked_jobs += 1
        live_rows.append(
            {
                "job_card_id": str(job_card.id),
                "job_card_ref": getattr(job_card, "job_card_no", None) or _format_ref("JC", job_card.id),
                "sales_order_ref": _format_ref("SO", sales_order.id if sales_order else job_card.sales_order_id),
                "customer_name": _customer_name_from_snapshot(job_card.spec_snapshot or {}),
                "product_code": job_card.product_code or (job_card.spec_snapshot or {}).get("product_code"),
                "current_stage": stage,
                "current_machine_id": str(active_segment.machine_id) if active_segment and active_segment.machine_id else None,
                "current_plan_date": active_segment.plan_date.isoformat() if active_segment and active_segment.plan_date else None,
                "current_shift_code": active_segment.shift_code if active_segment else None,
                "open_segment_count": len(scoped_segments),
                "released_qty": float(job_card.released_qty or 0.0),
                "blocked_reason": blocked_reason,
                "due_date": due_date.isoformat() if due_date else None,
                "status": job_card.status,
            }
        )

    stage_rows = (
        _apply_plant_scope_filter(
            db.query(JobCardStage, JobCard).join(JobCard, JobCard.id == JobCardStage.job_card_id),
            JobCard.plant_id,
            plant_scope,
        )
        .filter(JobCardStage.stage_type.in_(["PACKING", "PROCESS"]))
        .all()
    )
    trends_buckets: dict[str, dict[str, float]] = defaultdict(lambda: {"production": 0.0, "scrap": 0.0})
    scrap_rows: list[dict[str, Any]] = []
    for stage_row, job_card in stage_rows:
        event_day = _stage_activity_date(stage_row)
        if not event_day or event_day < start_date or event_day > end_date:
            continue
        if stage_row.stage_type == "PACKING":
            bucket = trends_buckets[event_day.isoformat()]
            bucket["production"] += float(stage_row.output_qty or 0.0)
            bucket["scrap"] += float(stage_row.scrap_qty or 0.0)
        if stage_row.stage_type == "PROCESS":
            tubes = float(stage_row.output_qty or 0.0)
            scrap_qty = float(stage_row.scrap_qty or 0.0)
            scrap_rows.append(
                {
                    "date": event_day.isoformat(),
                    "job_id": str(job_card.id),
                    "tubes_produced_qty": tubes,
                    "tube_scrap_qty": scrap_qty,
                    "scrap_percent": round((scrap_qty / tubes * 100.0), 2) if tubes else 0.0,
                    "severity": ((stage_row.entry_snapshot or {}).get("severity")),
                }
            )

    segment_rows = (
        _apply_plant_scope_filter(db.query(JobCardStageSegment), JobCardStageSegment.plant_id, plant_scope)
        .filter(JobCardStageSegment.stage_type.in_(["WINDER", "OVEN", "PROCESS", "PACKING"]))
        .all()
    )
    oee_buckets: dict[tuple[str, str], dict[str, Any]] = defaultdict(
        lambda: {
            "machine_id": None,
            "stage_type": None,
            "runtime_hours": 0.0,
            "planned_hours": 0.0,
            "planned_qty": 0.0,
            "output_qty": 0.0,
            "scrap_qty": 0.0,
            "segments": 0,
        }
    )
    for segment in segment_rows:
        machine_id = str(segment.machine_id) if segment.machine_id else None
        stage_type = str(segment.stage_type or "").upper()
        if not machine_id or not stage_type:
            continue
        activity_day = _segment_activity_date(segment)
        if not activity_day or activity_day < start_date or activity_day > end_date:
            continue
        key = (machine_id, stage_type)
        bucket = oee_buckets[key]
        bucket["machine_id"] = machine_id
        bucket["stage_type"] = stage_type
        bucket["segments"] += 1
        bucket["planned_hours"] += 12.0 if segment.shift_code else 0.0
        bucket["planned_qty"] += float(segment.planned_qty or 0.0)
        bucket["output_qty"] += float(segment.output_qty or 0.0)
        bucket["scrap_qty"] += float(segment.scrap_qty or 0.0)
        if segment.started_at and segment.completed_at and segment.completed_at >= segment.started_at:
            bucket["runtime_hours"] += (segment.completed_at - segment.started_at).total_seconds() / 3600.0

    oee_rows: list[dict[str, Any]] = []
    for (_machine_id, _stage_type), bucket in sorted(oee_buckets.items()):
        planned_hours = float(bucket["planned_hours"] or 0.0)
        runtime_hours = float(bucket["runtime_hours"] or 0.0)
        planned_qty = float(bucket["planned_qty"] or 0.0)
        output_qty = float(bucket["output_qty"] or 0.0)
        scrap_qty = float(bucket["scrap_qty"] or 0.0)
        availability = (runtime_hours / planned_hours * 100.0) if planned_hours else 0.0
        quality = (output_qty / (output_qty + scrap_qty) * 100.0) if (output_qty + scrap_qty) else 0.0
        performance = (output_qty / planned_qty * 100.0) if planned_qty else 0.0
        oee_rows.append(
            {
                "machine_id": bucket["machine_id"],
                "stage_type": bucket["stage_type"],
                "segments": bucket["segments"],
                "runtime_hours": round(runtime_hours, 2),
                "planned_hours": round(planned_hours, 2),
                "planned_qty": round(planned_qty, 2),
                "output_qty": round(output_qty, 2),
                "scrap_qty": round(scrap_qty, 2),
                "availability_percent": round(availability, 2),
                "quality_percent": round(quality, 2),
                "performance_percent": round(performance, 2),
                "oee_percent": round(availability * quality * performance / 10_000.0, 2),
            }
        )

    return {
        "trends": [
            {
                "date": bucket_date,
                "production": round(values["production"], 2),
                "scrap": round(values["scrap"], 2),
            }
            for bucket_date, values in sorted(trends_buckets.items())
        ],
        "scrap": sorted(scrap_rows, key=lambda row: row["date"]),
        "live_wip": {
            "kpis": {
                "live_jobs": active_cards,
                "blocked_jobs": blocked_jobs,
                "completed_jobs": completed_cards,
                "overdue_jobs": overdue_jobs,
            },
            "wip_by_stage": [{"stage": stage, "jobs": count} for stage, count in sorted(wip_by_stage.items())],
            "rows": live_rows,
        },
        "oee": oee_rows,
    }


def _stage_sort_key(stage_type: str) -> int:
    try:
        return STAGE_SEQUENCE.index(stage_type)
    except ValueError:
        return 99


def _query_stage_queue_rows(
    *,
    db: Session,
    stage: str,
    plan_date: Optional[date],
    include_unscheduled: bool,
    plant_scope: dict,
):
    query = (
        db.query(JobCardStageSegment, JobCard, JobCardStage, SalesOrder)
        .join(JobCard, JobCard.id == JobCardStageSegment.job_card_id)
        .join(
            JobCardStage,
            and_(
                JobCardStage.job_card_id == JobCard.id,
                JobCardStage.stage_type == JobCardStageSegment.stage_type,
            ),
        )
        .outerjoin(SalesOrder, SalesOrder.id == JobCard.sales_order_id)
        .filter(
            JobCardStageSegment.stage_type == stage,
            JobCardStageSegment.status.notin_(["COMPLETED", "CANCELLED"]),
        )
    )
    query = _apply_plant_scope_filter(query, JobCardStageSegment.plant_id, plant_scope)
    if plan_date:
        if include_unscheduled:
            query = query.filter(
                or_(
                    JobCardStageSegment.plan_date == plan_date,
                    JobCardStageSegment.plan_date.is_(None),
                    and_(
                        JobCardStageSegment.machine_id.is_(None),
                        JobCardStageSegment.shift_code.is_(None),
                    ),
                )
            )
        else:
            query = query.filter(JobCardStageSegment.plan_date == plan_date)
    elif not include_unscheduled:
        query = query.filter(JobCardStageSegment.plan_date.isnot(None))
    return query.order_by(
        JobCardStageSegment.machine_id.asc().nullsfirst(),
        JobCardStageSegment.plan_date.asc().nullsfirst(),
        JobCardStageSegment.shift_code.asc().nullsfirst(),
        JobCardStageSegment.sequence_no.asc(),
        JobCard.created_at.asc(),
    ).all()


def _planner_job_math(
    *,
    job_card: JobCard,
    planned_qty: float,
    spec_snapshot: dict[str, Any],
) -> dict[str, Any]:
    pcs_per_bamboo = _pcs_per_bamboo_from_snapshot(spec_snapshot)
    qty = max(float(planned_qty or 0.0), 0.0)
    material_snapshot = job_card.material_plan_snapshot or {}

    target_bamboo_count = None
    if pcs_per_bamboo and pcs_per_bamboo > 0:
        target_bamboo_count = int(math.ceil(qty / pcs_per_bamboo))
    elif material_snapshot.get("target_bamboo_count") is not None:
        try:
            target_bamboo_count = int(math.ceil(float(material_snapshot.get("target_bamboo_count"))))
        except (TypeError, ValueError):
            target_bamboo_count = None

    tube_weight_g = (
        _snapshot_float(spec_snapshot.get("target_tube_weight"))
        or _snapshot_midpoint(spec_snapshot.get("weight_min_g"), spec_snapshot.get("weight_max_g"))
    )
    planned_weight_kg = round((tube_weight_g * qty) / 1000.0, 3) if tube_weight_g is not None else None
    bamboo_weight_kg = (
        round((tube_weight_g * pcs_per_bamboo) / 1000.0, 3)
        if tube_weight_g is not None and pcs_per_bamboo
        else None
    )

    return {
        "pcs_per_bamboo": pcs_per_bamboo,
        "target_bamboo_count": target_bamboo_count,
        "tube_weight_g": tube_weight_g,
        "planned_weight_kg": planned_weight_kg,
        "bamboo_weight_kg": bamboo_weight_kg,
        "product_size_label": _size_label(spec_snapshot),
    }


def _queue_item_from_stage_row(
    queue_entry: JobCardStageSegment,
    job_card: JobCard,
    stage_row: JobCardStage,
    sales_order: Optional[SalesOrder],
    remaining_segments: int = 1,
    carry_forward_lookup: Optional[dict[str, dict[str, Optional[str]]]] = None,
) -> QueueJobCardItem:
    spec_snapshot = job_card.spec_snapshot or {}
    carry_forward_entry = (carry_forward_lookup or {}).get(str(job_card.id))
    segment_qty = float(queue_entry.planned_qty or job_card.planned_qty or 0.0)
    math_context = _planner_job_math(
        job_card=job_card,
        planned_qty=segment_qty,
        spec_snapshot=spec_snapshot,
    )
    required_capacity = (
        _required_capacity_for_job(
            stage="WINDER",
            planned_qty=segment_qty,
            spec_snapshot=spec_snapshot,
            capacity_unit=WINDER_METER_CAPACITY_UNIT,
        )
        if stage_row.stage_type == "WINDER"
        else float(queue_entry.required_capacity or 0.0) if queue_entry.required_capacity is not None else None
    )
    return QueueJobCardItem(
        queue_id=queue_entry.id,
        segment_id=queue_entry.id,
        job_card_id=job_card.id,
        sales_order_id=job_card.sales_order_id,
        sales_order_line_id=job_card.sales_order_line_id,
        release_lot_id=job_card.release_lot_id,
        job_card_ref=getattr(job_card, "job_card_no", None) or _format_ref("JC", job_card.id),
        stage_id=stage_row.id,
        stage_type=stage_row.stage_type,
        status=stage_row.status,
        segment_status=queue_entry.status,
        segment_no=int(queue_entry.segment_no or 1),
        split_source=str(queue_entry.split_source or "NONE"),
        split_parent_segment_id=queue_entry.split_parent_segment_id,
        sequence_no=queue_entry.sequence_no,
        slot_order=queue_entry.sequence_no,
        machine_id=str(queue_entry.machine_id) if queue_entry.machine_id else None,
        plan_date=queue_entry.plan_date,
        shift_code=queue_entry.shift_code,
        required_capacity=required_capacity,
        segment_planned_qty=segment_qty,
        remaining_segments=max(int(remaining_segments or 1), 1),
        planned_qty=segment_qty,
        priority=spec_snapshot.get("priority"),
        current_stage=job_card.current_stage,
        product_code=job_card.product_code or spec_snapshot.get("product_code"),
        product_size_label=math_context["product_size_label"],
        parchment_color=spec_snapshot.get("sales_order_line_parchment_color") or spec_snapshot.get("parchment_color"),
        released_qty=float(job_card.released_qty or 0.0),
        assigned_winder_machine_id=str(job_card.assigned_winder_machine_id) if job_card.assigned_winder_machine_id else None,
        customer_id=spec_snapshot.get("customer_id"),
        customer_name=_customer_name_from_snapshot(spec_snapshot),
        tube_size_id=spec_snapshot.get("tube_size_id"),
        spec_id=spec_snapshot.get("spec_id"),
        spec_reference=spec_snapshot.get("spec_reference"),
        spec_version=spec_snapshot.get("version"),
        required_cs=spec_snapshot.get("required_cs"),
        target_tube_weight=spec_snapshot.get("target_tube_weight"),
        tube_weight_g=math_context["tube_weight_g"],
        planned_weight_kg=math_context["planned_weight_kg"],
        bamboo_weight_kg=math_context["bamboo_weight_kg"],
        pcs_per_bamboo=math_context["pcs_per_bamboo"],
        target_bamboo_count=math_context["target_bamboo_count"],
        selected_bamboo_length_mm=_snapshot_float(spec_snapshot.get("selected_bamboo_length_mm")),
        usable_length_mm=_snapshot_float(spec_snapshot.get("usable_length_mm")),
        due_date=_snapshot_date(spec_snapshot.get("sales_order_line_due_date")) or (
            sales_order.due_date if sales_order else None
        ),
        planned_start=stage_row.planned_start,
        planned_end=stage_row.planned_end,
        created_at=job_card.created_at,
        is_carry_forward=carry_forward_entry is not None,
        carry_forward_source_job_card_id=(
            _nullable_uuid(carry_forward_entry.get("source")) if carry_forward_entry else None
        ),
        carry_forward_reason_code=(carry_forward_entry.get("reason") if carry_forward_entry else None),
    )


def _lane_constraints_from_machine(machine: Optional[dict[str, Any]]) -> PlanningBoardMachineConstraint:
    if not machine:
        return PlanningBoardMachineConstraint()
    return PlanningBoardMachineConstraint(
        id_min_mm=_snapshot_float(machine.get("id_min_mm")),
        id_max_mm=_snapshot_float(machine.get("id_max_mm")),
        od_min_mm=_snapshot_float(machine.get("od_min_mm")),
        od_max_mm=_snapshot_float(machine.get("od_max_mm")),
        length_min_mm=_snapshot_float(machine.get("length_min_mm")),
        length_max_mm=_snapshot_float(machine.get("length_max_mm")),
        supported_mandrel_ids=[str(value) for value in (machine.get("supported_mandrel_ids") or [])],
        supported_mandrels=list(machine.get("supported_mandrels") or []),
    )


def _lane_load(stage: str, capacity_unit: str, jobs: list[QueueJobCardItem], spec_lookup: dict[str, dict[str, Any]]) -> float:
    total = 0.0
    for job in jobs:
        if job.required_capacity is not None:
            total += float(job.required_capacity or 0.0)
            continue
        spec_snapshot = spec_lookup.get(str(job.job_card_id), {})
        total += _planned_load_for_capacity(
            stage=stage,
            capacity_unit=capacity_unit,
            planned_qty=float(job.planned_qty or 0.0),
            spec_snapshot=spec_snapshot,
        )
    return round(total, 2)


def _suggest_lane_for_job(
    *,
    stage: str,
    job: QueueJobCardItem,
    lanes: list[PlanningBoardLane],
    machine_map: dict[str, dict[str, Any]],
    spec_snapshot: dict[str, Any],
    plant_id: str,
) -> Optional[PlanningSuggestion]:
    required_capacity = float(
        job.required_capacity
        if job.required_capacity is not None
        else _required_capacity_for_job(
            stage=stage,
            planned_qty=float(job.planned_qty or 0.0),
            spec_snapshot=spec_snapshot,
        )
    )
    candidates: list[PlanningBoardLane] = []
    for lane in lanes:
        if lane.lane_id.endswith("UNSCHEDULED"):
            continue
        if stage in STAGE_TO_MACHINE_DEPARTMENT:
            if not lane.machine_id:
                continue
            machine = machine_map.get(lane.machine_id)
            if not machine:
                continue
            try:
                if stage == "PACKING":
                    _validate_machine_presence_for_packing(machine, plant_id)
                else:
                    _validate_machine_compatibility(machine=machine, stage=stage, spec_snapshot=spec_snapshot, plant_id=plant_id)
            except HTTPException:
                continue
        candidates.append(lane)
    if not candidates:
        return None

    def _score(lane: PlanningBoardLane) -> tuple[float, float]:
        capacity = float(lane.capacity_value or 0.0)
        projected = float(lane.current_load or 0.0) + required_capacity
        utilization = projected / capacity if capacity > 0 else projected
        overage = max(projected - capacity, 0.0) if capacity > 0 else projected
        return (overage, utilization)

    lane = min(candidates, key=_score)
    return PlanningSuggestion(
        stage=stage,
        job_card_id=job.job_card_id,
        lane_id=lane.lane_id,
        machine_id=lane.machine_id,
        plan_date=lane.plan_date,
        shift_code=lane.shift_code,
        sequence_no=len(lane.jobs) + 1,
        required_capacity=required_capacity,
        reason="Lowest projected capacity pressure for this route stage.",
    )


def _build_stage_board_view(
    *,
    db: Session,
    stage: str,
    plan_date: Optional[date],
    include_unscheduled: bool,
    plant_scope: dict,
    token: str,
    plant_id: str,
    carry_forward_lookup: Optional[dict[str, dict[str, Optional[str]]]] = None,
) -> tuple[PlanningBoardStageView, list[PlanningSuggestion]]:
    rows = _query_stage_queue_rows(
        db=db,
        stage=stage,
        plan_date=plan_date,
        include_unscheduled=include_unscheduled,
        plant_scope=plant_scope,
    )
    plant_uuid = _to_uuid(plant_id)
    machine_rows = _fetch_stage_machines(stage, token, plant_id) if stage in STAGE_TO_MACHINE_DEPARTMENT else []
    machine_map = {str(row.get("id")): row for row in machine_rows}
    spec_lookup: dict[str, dict[str, Any]] = {}
    bucket_map: dict[str, list[QueueJobCardItem]] = {f"{stage}:UNSCHEDULED": []}

    for queue_entry, job_card, stage_row, sales_order in rows:
        spec_lookup[str(job_card.id)] = job_card.spec_snapshot or {}
        remaining_segments = len(_open_stage_segments(db, job_card.id, stage_row.stage_type))
        item = _queue_item_from_stage_row(
            queue_entry,
            job_card,
            stage_row,
            sales_order,
            remaining_segments,
            carry_forward_lookup=carry_forward_lookup,
        )
        if queue_entry.machine_id:
            lane_key = f"{stage}:{str(queue_entry.machine_id)}:{queue_entry.shift_code or 'SHIFT_A'}"
        elif stage in {"QC", "DISPATCH"} and queue_entry.shift_code:
            lane_key = f"{stage}:SHIFT:{queue_entry.shift_code}"
        else:
            lane_key = f"{stage}:UNSCHEDULED"
        bucket_map.setdefault(lane_key, []).append(item)

    lanes: list[PlanningBoardLane] = []
    summary_unit = STAGE_DEFAULT_CAPACITY_UNITS.get(stage, "TUBES_PER_DAY")
    if include_unscheduled:
        unscheduled_jobs = bucket_map.get(f"{stage}:UNSCHEDULED", [])
        lanes.append(
            PlanningBoardLane(
                lane_id=f"{stage}:UNSCHEDULED",
                stage=stage,
                plan_date=plan_date,
                shift_code=None,
                shift_label=None,
                machine_id=None,
                machine_code=None,
                machine_name="Unscheduled",
                machine_department=stage,
                capacity_value=None,
                capacity_unit=summary_unit,
                current_load=_lane_load(stage, summary_unit, unscheduled_jobs, spec_lookup),
                warning="Suggestion pool",
                constraints=PlanningBoardMachineConstraint(),
                jobs=unscheduled_jobs,
            )
        )

    if stage in STAGE_TO_MACHINE_DEPARTMENT:
        for machine in sorted(machine_rows, key=lambda row: (str(row.get("code") or ""), str(row.get("name") or ""))):
            machine_id = str(machine.get("id"))
            capacity_value, capacity_unit = _oven_bamboo_capacity_profile(stage, machine)
            if not capacity_value:
                capacity_value, capacity_unit = _resolve_capacity_profile(
                    db=db,
                    plant_id=plant_uuid,
                    stage=stage,
                    machine_id=_to_uuid(machine_id, field="machine_id"),
                    machine_capacity=_snapshot_float(machine.get("capacity_value")),
                    on_day=plan_date,
                )
            resolved_unit = capacity_unit or summary_unit
            for shift_code in _shift_codes():
                lane_id = f"{stage}:{machine_id}:{shift_code}"
                machine_jobs = bucket_map.get(lane_id, [])
                shift_capacity = _shift_capacity_value(capacity_value, shift_code)
                lanes.append(
                    PlanningBoardLane(
                        lane_id=lane_id,
                        stage=stage,
                        plan_date=plan_date,
                        shift_code=shift_code,
                        shift_label=_shift_label(shift_code),
                        machine_id=machine_id,
                        machine_code=str(machine.get("code") or ""),
                        machine_name=str(machine.get("name") or machine.get("code") or "Machine"),
                        machine_department=str(machine.get("department") or ""),
                        capacity_value=shift_capacity,
                        capacity_unit=resolved_unit,
                        batch_bamboo_capacity=_snapshot_float(machine.get("batch_bamboo_capacity")),
                        cycle_time_hours=_snapshot_float(machine.get("cycle_time_hours")),
                        current_load=_lane_load(stage, resolved_unit, machine_jobs, spec_lookup),
                        warning=_capacity_warning_message(
                            db=db,
                            plant_id=plant_uuid,
                            stage=stage,
                            machine_id=_to_uuid(machine_id, field="machine_id"),
                            machine_capacity=_snapshot_float(machine.get("capacity_value")),
                            plan_date=plan_date,
                            shift_code=shift_code,
                        ),
                        constraints=_lane_constraints_from_machine(machine),
                        jobs=machine_jobs,
                    )
                )
    else:
        for shift_code in _shift_codes():
            lane_id = f"{stage}:SHIFT:{shift_code}"
            shift_jobs = bucket_map.get(lane_id, [])
            lanes.append(
                PlanningBoardLane(
                    lane_id=lane_id,
                    stage=stage,
                    plan_date=plan_date,
                    shift_code=shift_code,
                    shift_label=_shift_label(shift_code),
                    machine_id=None,
                    machine_code=None,
                    machine_name=f"{stage.title()} { _shift_label(shift_code) }",
                    machine_department=stage,
                    capacity_value=_shift_capacity_value(VIRTUAL_STAGE_CAPACITY.get(stage), shift_code),
                    capacity_unit=summary_unit,
                    current_load=_lane_load(stage, summary_unit, shift_jobs, spec_lookup),
                    warning=None,
                    constraints=PlanningBoardMachineConstraint(),
                    jobs=shift_jobs,
                )
            )

    suggestions: list[PlanningSuggestion] = []
    if include_unscheduled:
        for unscheduled_job in bucket_map.get(f"{stage}:UNSCHEDULED", []):
            spec_snapshot = spec_lookup.get(str(unscheduled_job.job_card_id), {})
            suggestion = _suggest_lane_for_job(
                stage=stage,
                job=unscheduled_job,
                lanes=lanes,
                machine_map=machine_map,
                spec_snapshot=spec_snapshot,
                plant_id=plant_id,
            )
            if suggestion:
                suggestions.append(suggestion)

    all_jobs = [job for lane in lanes for job in lane.jobs]
    return (
        PlanningBoardStageView(
            stage=stage,
            summary=PlanningBoardStageSummary(
                jobs=len(all_jobs),
                planned_qty=round(sum(float(job.planned_qty or 0.0) for job in all_jobs), 2),
                capacity_load=round(sum(float(lane.current_load or 0.0) for lane in lanes), 2),
                capacity_unit=summary_unit,
            ),
            lanes=lanes,
        ),
        suggestions,
    )


@router.post("/sales-orders", response_model=SalesOrderResponse)
def create_sales_order(
    payload: SalesOrderCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "PlantManager", "Planner"])),
):
    token = current_user.get("token", "")
    _fetch_spec(payload.spec_id, token, plant_id)

    sales_order = SalesOrder(
        plant_id=_to_uuid(plant_id),
        customer_id=payload.customer_id,
        spec_id=payload.spec_id,
        order_qty=payload.order_qty,
        due_date=payload.due_date,
        priority=payload.priority,
        status="OPEN",
    )
    db.add(sales_order)
    db.commit()
    db.refresh(sales_order)
    return sales_order


@router.post("/job-cards", response_model=JobCardResponse)
def create_job_card(
    payload: JobCardCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "PlantManager", "Planner"])),
):
    plant_uuid = _to_uuid(plant_id)
    token = current_user.get("token", "")
    live_order = _fetch_sales_order(payload.sales_order_id, token, plant_id)
    order_status = _normalize_sales_status(live_order.get("status"))
    if order_status not in {"partially_released", "released", "partially_dispatched"}:
        raise HTTPException(status_code=400, detail="Sales order must be released before planning job cards")

    lines = live_order.get("lines") or []
    selected_line = next((line for line in lines if str(line.get("id")) == str(payload.sales_order_line_id)), None)
    if selected_line is None:
        raise HTTPException(status_code=400, detail="sales_order_line_id does not belong to sales_order_id")
    if not bool(selected_line.get("is_released")):
        raise HTTPException(status_code=400, detail="sales order line must be released before planning job cards")
    release_lots = list(selected_line.get("release_lots") or [])
    selected_release_lot = next((row for row in release_lots if not row.get("job_card_id")), release_lots[-1] if release_lots else None)
    if not selected_release_lot:
        raise HTTPException(status_code=400, detail="No release lot is available for this sales-order line")

    remaining_qty = _line_remaining_qty(selected_line)
    if payload.planned_qty > remaining_qty + 1e-9:
        raise HTTPException(
            status_code=400,
            detail=f"Planned qty exceeds remaining sales quantity ({remaining_qty:.2f})",
        )

    priority = str(payload.priority or live_order.get("priority") or "NORMAL").upper()
    job_card, _queue_created = _create_or_sync_job_card_for_line(
        db=db,
        plant_uuid=plant_uuid,
        live_order=live_order,
        line=selected_line,
        release_lot_id=_to_uuid(str(selected_release_lot.get("id")), field="release_lot_id"),
        winder_machine_id=_to_uuid(str(selected_release_lot.get("winder_machine_id")), field="winder_machine_id"),
        planned_qty=payload.planned_qty,
        priority=priority,
        product_code=selected_line.get("product_code"),
        token=token,
        plant_id=plant_id,
        current_user=current_user,
    )
    db.commit()
    db.refresh(job_card)
    return _serialize_job_card_response(job_card)


@router.post("/sales-orders/{sales_order_id}/release-sync", response_model=ReleaseSyncResponse)
def sync_released_sales_order(
    sales_order_id: uuid.UUID,
    payload: Optional[ReleaseSyncPayload] = None,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Sales", "PlantManager", "Planner"])),
):
    plant_uuid = _to_uuid(plant_id)
    token = current_user.get("token", "")
    live_order = dict((payload.order_snapshot or {})) if payload and payload.order_snapshot else {}
    if not live_order:
        live_order = _fetch_sales_order(sales_order_id, token, plant_id)
    order_status = _normalize_sales_status(live_order.get("status"))
    if order_status not in {"partially_released", "released", "partially_dispatched"}:
        raise HTTPException(status_code=400, detail="Sales order must be released before sync")

    line_results: list[ReleaseSyncLineResult] = []
    requested_release_rows = list(payload.release_rows or []) if payload else []
    if not requested_release_rows:
        raise HTTPException(status_code=400, detail="release_rows payload is required for release sync")

    line_map = {str(line.get("id")): line for line in (live_order.get("lines") or [])}
    for requested_row in requested_release_rows:
        line = line_map.get(str(requested_row.sales_order_line_id))
        if line is None:
            raise HTTPException(status_code=400, detail="sales_order_line_id does not belong to sales_order_id")
        priority = str(live_order.get("priority") or "NORMAL").upper()
        job_card, queue_created = _create_or_sync_job_card_for_line(
            db=db,
            plant_uuid=plant_uuid,
            live_order=live_order,
            line=line,
            release_lot_id=requested_row.release_lot_id,
            winder_machine_id=requested_row.winder_machine_id,
            planned_qty=float(requested_row.release_qty or 0.0),
            priority=priority,
            product_code=requested_row.product_code or line.get("product_code"),
            token=token,
            plant_id=plant_id,
            current_user=current_user,
        )
        _sync_sales_release_lot_job_card(requested_row.release_lot_id, job_card.id, token, plant_id)
        line_results.append(
            ReleaseSyncLineResult(
                sales_order_line_id=job_card.sales_order_line_id,
                release_lot_id=requested_row.release_lot_id,
                job_card_id=job_card.id,
                first_stage=str((job_card.routing_snapshot or {}).get("first_stage") or job_card.current_stage),
                queue_created=queue_created,
            )
        )

    db.commit()
    return ReleaseSyncResponse(
        order_id=sales_order_id,
        order_status=str(live_order.get("status") or "").upper(),
        line_results=line_results,
    )


@router.get("/analytics/execution-snapshot")
def get_execution_snapshot(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Owner", "Admin", "PlantManager", "Planner", "Store", "Sales", "Dispatch"])),
):
    del current_user
    today = datetime.now(PLANT_TIMEZONE).date()
    scoped_end = end_date or today
    scoped_start = start_date or (scoped_end - timedelta(days=29))
    if scoped_end < scoped_start:
        raise HTTPException(status_code=400, detail="end_date must be on or after start_date")
    return _build_execution_snapshot(
        db=db,
        plant_scope=plant_scope,
        start_date=scoped_start,
        end_date=scoped_end,
    )


@router.get("/planning/queues", response_model=PlanningQueueResponse)
def get_stage_queue(
    stage: str = Query(...),
    plan_date: Optional[date] = Query(None),
    include_unscheduled: bool = Query(True),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Owner", "Admin", "PlantManager", "Planner"])),
):
    selected_stage = _normalize_stage(stage)
    rows = _query_stage_queue_rows(
        db=db,
        stage=selected_stage,
        plan_date=plan_date,
        include_unscheduled=include_unscheduled,
        plant_scope=plant_scope,
    )

    carry_forward_lookup = _carry_forward_lookup(db, plant_scope)
    bucket_map: dict[str, list[QueueJobCardItem]] = {}
    for queue_entry, job_card, stage_row, sales_order in rows:
        machine_key = str(queue_entry.machine_id) if queue_entry.machine_id else "UNASSIGNED"
        remaining_segments = len(_open_stage_segments(db, job_card.id, stage_row.stage_type))
        bucket_map.setdefault(machine_key, []).append(
            _queue_item_from_stage_row(
                queue_entry,
                job_card,
                stage_row,
                sales_order,
                remaining_segments,
                carry_forward_lookup=carry_forward_lookup,
            )
        )

    buckets: list[QueueMachineBucket] = []
    for key in sorted(bucket_map.keys(), key=lambda value: (value != "UNASSIGNED", value)):
        buckets.append(
            QueueMachineBucket(
                machine_id=None if key == "UNASSIGNED" else key,
                jobs=bucket_map[key],
            )
        )

    return PlanningQueueResponse(
        stage=selected_stage,
        scope_all=bool(plant_scope.get("scope_all")),
        buckets=buckets,
    )


@router.get("/planning/board", response_model=PlanningBoardResponse)
def get_planning_board(
    stage: Optional[str] = Query(None),
    plan_date: Optional[date] = Query(None),
    include_unscheduled: bool = Query(True),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Owner", "Admin", "PlantManager", "Planner"])),
):
    selected_stage = _normalize_stage(stage) if stage else None
    if plant_scope.get("scope_all"):
        return PlanningBoardResponse(
            plan_date=plan_date,
            include_unscheduled=include_unscheduled,
            scope_all=True,
            requires_explicit_plant=True,
            allowed_plants=list(plant_scope.get("allowed_plants") or []),
            shifts=[PlanningShift(**shift) for shift in SHIFT_CALENDAR],
            summary=PlanningBoardStageSummary(
                jobs=0,
                planned_qty=0.0,
                capacity_load=0.0,
                capacity_unit="MIXED",
            ),
            stages=[],
            suggestions=[],
        )

    machine_scope_plant = plant_scope.get("selected_plant_id")
    if not machine_scope_plant:
        raise HTTPException(status_code=400, detail="Select one concrete plant before opening the planning board")
    stage_order = [selected_stage] if selected_stage else [stage_name for stage_name in STAGE_SEQUENCE if stage_name != "SLITTING"]
    if selected_stage == "SLITTING" and "SLITTING" not in stage_order:
        stage_order = ["SLITTING"]
    stage_views: list[PlanningBoardStageView] = []
    suggestions: list[PlanningSuggestion] = []
    carry_forward_lookup = _carry_forward_lookup(db, plant_scope)
    for stage_name in stage_order:
        stage_view, stage_suggestions = _build_stage_board_view(
            db=db,
            stage=stage_name,
            plan_date=plan_date,
            include_unscheduled=include_unscheduled,
            plant_scope=plant_scope,
            token=current_user.get("token", ""),
            plant_id=machine_scope_plant,
            carry_forward_lookup=carry_forward_lookup,
        )
        stage_views.append(stage_view)
        suggestions.extend(stage_suggestions)

    all_jobs = [job for stage_view in stage_views for lane in stage_view.lanes for job in lane.jobs]
    return PlanningBoardResponse(
        plan_date=plan_date,
        include_unscheduled=include_unscheduled,
        scope_all=bool(plant_scope.get("scope_all")),
        requires_explicit_plant=False,
        allowed_plants=list(plant_scope.get("allowed_plants") or []),
        shifts=[PlanningShift(**shift) for shift in SHIFT_CALENDAR],
        summary=PlanningBoardStageSummary(
            jobs=len(all_jobs),
            planned_qty=round(sum(float(job.planned_qty or 0.0) for job in all_jobs), 2),
            capacity_load=round(
                sum(float(lane.current_load or 0.0) for stage_view in stage_views for lane in stage_view.lanes),
                2,
            ),
            capacity_unit="MIXED",
        ),
        stages=stage_views,
        suggestions=suggestions,
    )


@router.get("/planning/export")
def export_planning_board(
    stage: str = Query(...),
    plan_date: Optional[date] = Query(None),
    include_unscheduled: bool = Query(True),
    format: str = Query(default="csv", pattern="^(csv|print)$"),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Owner", "Admin", "PlantManager", "Planner"])),
):
    selected_stage = _normalize_stage(stage)
    rows = _query_stage_queue_rows(
        db=db,
        stage=selected_stage,
        plan_date=plan_date,
        include_unscheduled=include_unscheduled,
        plant_scope=plant_scope,
    )

    export_rows: list[dict[str, Any]] = []
    for queue_entry, job_card, stage_row, sales_order in rows:
        export_rows.append(
            {
                "sequence_no": queue_entry.sequence_no,
                "machine_id": str(queue_entry.machine_id) if queue_entry.machine_id else "UNASSIGNED",
                "job_card_id": str(job_card.id),
                "sales_order_id": str(job_card.sales_order_id),
                "sales_order_line_id": str(job_card.sales_order_line_id) if job_card.sales_order_line_id else "",
                "customer_name": _customer_name_from_snapshot(job_card.spec_snapshot or {}) or "",
                "planned_qty": float(job_card.planned_qty or 0.0),
                "current_stage": job_card.current_stage,
                "stage_status": stage_row.status,
                "planned_start": stage_row.planned_start.isoformat() if stage_row.planned_start else "",
                "planned_end": stage_row.planned_end.isoformat() if stage_row.planned_end else "",
                "due_date": str(
                    _snapshot_date((job_card.spec_snapshot or {}).get("sales_order_line_due_date"))
                    or (sales_order.due_date if sales_order else "")
                ),
            }
        )

    if format == "print":
        lines = [
            f"Planning Export - {selected_stage}",
            f"Plan Date: {plan_date.isoformat() if plan_date else 'ALL'}",
            "",
            "SEQ | MACHINE | JOB CARD | SALES ORDER | CUSTOMER | QTY | STAGE STATUS | DUE DATE",
        ]
        for row in export_rows:
            lines.append(
                " | ".join(
                    [
                        str(row["sequence_no"]),
                        row["machine_id"],
                        row["job_card_id"][:8],
                        row["sales_order_id"][:8],
                        row["customer_name"] or "-",
                        f"{row['planned_qty']:.2f}",
                        row["stage_status"],
                        row["due_date"] or "-",
                    ]
                )
            )
        return StreamingResponse(
            io.StringIO("\n".join(lines)),
            media_type="text/plain; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="planning-{selected_stage.lower()}-{plan_date or "all"}.txt"'
            },
        )

    buffer = io.StringIO()
    writer = csv.DictWriter(
        buffer,
        fieldnames=[
            "sequence_no",
            "machine_id",
            "job_card_id",
            "sales_order_id",
            "sales_order_line_id",
            "customer_name",
            "planned_qty",
            "current_stage",
            "stage_status",
            "planned_start",
            "planned_end",
            "due_date",
        ],
    )
    writer.writeheader()
    writer.writerows(export_rows)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="planning-{selected_stage.lower()}-{plan_date or "all"}.csv"'},
    )


@router.get("/job-cards", response_model=list[JobCardPlannerSummary])
def list_planning_job_cards(
    search: Optional[str] = Query(None),
    sales_order_id: Optional[uuid.UUID] = Query(None),
    sales_order_line_id: Optional[uuid.UUID] = Query(None),
    release_lot_id: Optional[uuid.UUID] = Query(None),
    status: Optional[str] = Query(None),
    current_stage: Optional[str] = Query(None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Owner", "Admin", "PlantManager", "Planner", "Store", "Sales", "Dispatch"])),
):
    query = (
        db.query(JobCard, SalesOrder)
        .options(selectinload(JobCard.stages))
        .outerjoin(SalesOrder, SalesOrder.id == JobCard.sales_order_id)
    )
    query = _apply_plant_scope_filter(query, JobCard.plant_id, plant_scope)

    if status:
        query = query.filter(JobCard.status == status.strip().upper())

    if current_stage:
        selected_stage = current_stage.strip().upper()
        if selected_stage not in [*STAGE_SEQUENCE, "DONE"]:
            raise HTTPException(status_code=400, detail="Invalid current_stage filter")
        query = query.filter(JobCard.current_stage == selected_stage)

    if sales_order_id:
        query = query.filter(JobCard.sales_order_id == sales_order_id)

    if sales_order_line_id:
        query = query.filter(JobCard.sales_order_line_id == sales_order_line_id)

    if release_lot_id:
        query = query.filter(JobCard.release_lot_id == release_lot_id)

    if search and search.strip():
        terms = _reference_search_terms(search)
        if terms:
            ref_conditions = []
            for term in terms:
                needle = f"%{term}%"
                ref_conditions.extend(
                    [
                        cast(JobCard.id, String).ilike(needle),
                        cast(JobCard.release_lot_id, String).ilike(needle),
                        cast(JobCard.sales_order_id, String).ilike(needle),
                        JobCard.product_code.ilike(needle),
                        JobCard.spec_snapshot["customer_name_snapshot"].astext.ilike(needle),
                        JobCard.spec_snapshot["customer_name"].astext.ilike(needle),
                    ]
                )
            query = query.filter(
                or_(*ref_conditions)
            )

    rows = (
        query.order_by(JobCard.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    response: list[JobCardPlannerSummary] = []
    for job_card, sales_order in rows:
        spec_snapshot = job_card.spec_snapshot or {}
        active_stage = next((stage for stage in (job_card.stages or []) if stage.stage_type == job_card.current_stage), None)
        active_segment = None
        blocked_reason = None
        open_segment_count = 0
        if job_card.current_stage != "DONE":
            open_segments = _open_stage_segments(db, job_card.id, job_card.current_stage)
            open_segment_count = len(open_segments)
            active_segment = open_segments[0] if open_segments else None
            if open_segment_count > 1:
                blocked_reason = f"{open_segment_count} open segments still need stage completion"
        planner_gate = _planner_gate_context(
            current_stage=job_card.current_stage,
            active_stage=active_stage,
            active_segment=active_segment,
        )
        if blocked_reason is None and not planner_gate["planner_gate_ready"]:
            blocked_reason = planner_gate["planner_gate_reason"]
        math_context = _planner_job_math(
            job_card=job_card,
            planned_qty=float(job_card.planned_qty or job_card.released_qty or 0.0),
            spec_snapshot=spec_snapshot,
        )
        response.append(
            JobCardPlannerSummary(
                id=job_card.id,
                plant_id=job_card.plant_id,
                sales_order_id=job_card.sales_order_id,
                sales_order_line_id=job_card.sales_order_line_id,
                release_lot_id=job_card.release_lot_id,
                job_card_ref=getattr(job_card, "job_card_no", None) or _format_ref("JC", job_card.id),
                spec_id=job_card.spec_id,
                released_qty=float(job_card.released_qty or 0.0),
                assigned_winder_machine_id=str(job_card.assigned_winder_machine_id) if job_card.assigned_winder_machine_id else None,
                product_code=job_card.product_code or spec_snapshot.get("product_code"),
                product_size_label=math_context["product_size_label"],
                parchment_color=spec_snapshot.get("sales_order_line_parchment_color") or spec_snapshot.get("parchment_color"),
                active_segment_id=str(active_segment.id) if active_segment else None,
                active_segment_status=str(active_segment.status) if active_segment else None,
                active_segment_machine_id=planner_gate["active_segment_machine_id"],
                active_segment_plan_date=planner_gate["active_segment_plan_date"],
                open_segment_count=open_segment_count,
                blocked_reason=blocked_reason,
                planner_gate_ready=planner_gate["planner_gate_ready"],
                planner_gate_reason=planner_gate["planner_gate_reason"],
                current_machine_id=str(active_segment.machine_id) if active_segment and active_segment.machine_id else (str(active_stage.machine_id) if active_stage and active_stage.machine_id else None),
                current_plan_date=active_segment.plan_date if active_segment else (active_stage.plan_date if active_stage else None),
                current_shift_code=active_segment.shift_code if active_segment else (active_stage.shift_code if active_stage else None),
                planned_qty=job_card.planned_qty,
                status=job_card.status,
                current_stage=job_card.current_stage,
                priority=spec_snapshot.get("priority"),
                customer_id=spec_snapshot.get("customer_id"),
                customer_name=_customer_name_from_snapshot(spec_snapshot),
                tube_size_id=spec_snapshot.get("tube_size_id"),
                spec_reference=spec_snapshot.get("spec_reference"),
                spec_version=spec_snapshot.get("version"),
                required_cs=spec_snapshot.get("required_cs"),
                target_tube_weight=spec_snapshot.get("target_tube_weight"),
                tube_weight_g=math_context["tube_weight_g"],
                planned_weight_kg=math_context["planned_weight_kg"],
                bamboo_weight_kg=math_context["bamboo_weight_kg"],
                pcs_per_bamboo=math_context["pcs_per_bamboo"],
                target_bamboo_count=math_context["target_bamboo_count"],
                selected_bamboo_length_mm=_snapshot_float(spec_snapshot.get("selected_bamboo_length_mm")),
                usable_length_mm=_snapshot_float(spec_snapshot.get("usable_length_mm")),
                due_date=_snapshot_date(spec_snapshot.get("sales_order_line_due_date")) or (
                    sales_order.due_date if sales_order else None
                ),
                created_at=job_card.created_at,
            )
        )
    return response


@router.get("/job-cards/{job_card_id}", response_model=JobCardPlanningDetail)
def get_planning_job_card(
    job_card_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Owner", "Admin", "PlantManager", "Planner", "Sales", "Dispatch", "Store"])),
):
    query = (
        db.query(JobCard, SalesOrder)
        .outerjoin(SalesOrder, SalesOrder.id == JobCard.sales_order_id)
        .filter(JobCard.id == job_card_id)
    )
    query = _apply_plant_scope_filter(query, JobCard.plant_id, plant_scope)
    row = query.first()
    if not row:
        raise HTTPException(status_code=404, detail="Job card not found")

    job_card, sales_order = row
    stored_snapshot = dict(job_card.spec_snapshot or {})
    effective_snapshot = dict(stored_snapshot)
    snapshot_mode = "stored" if _is_stored_snapshot(stored_snapshot) else "legacy_fallback"

    if snapshot_mode == "legacy_fallback":
        try:
            live_spec = _fetch_spec(
                job_card.spec_id,
                current_user.get("token", ""),
                str(job_card.plant_id),
                require_approved_active=False,
            )
            effective_snapshot = _merge_spec_snapshot(effective_snapshot, live_spec)
        except HTTPException:
            pass

    stages = (
        db.query(JobCardStage)
        .filter(JobCardStage.job_card_id == job_card.id)
        .all()
    )
    stage_segments = (
        db.query(JobCardStageSegment)
        .filter(JobCardStageSegment.job_card_id == job_card.id)
        .order_by(
            JobCardStageSegment.stage_type.asc(),
            JobCardStageSegment.segment_no.asc(),
            JobCardStageSegment.sequence_no.asc(),
            JobCardStageSegment.created_at.asc(),
        )
        .all()
    )
    packing_record = db.query(PackingRecord).filter(PackingRecord.job_card_id == job_card.id).first()
    quality_inspections = (
        db.query(QualityInspection)
        .filter(QualityInspection.job_card_id == job_card.id)
        .order_by(QualityInspection.created_at.asc())
        .all()
    )
    quality_holds = (
        db.query(QualityHold)
        .filter(QualityHold.job_card_id == job_card.id)
        .order_by(QualityHold.created_at.asc())
        .all()
    )
    audit_events = (
        db.query(AuditEvent)
        .filter(AuditEvent.job_card_id == job_card.id)
        .order_by(AuditEvent.event_ts.asc())
        .all()
    )
    sorted_stages = sorted(stages, key=lambda item: _stage_sort_key(item.stage_type))
    document_snapshot = _build_document_snapshot(
        job_card=job_card,
        sales_order=sales_order,
        spec_snapshot=effective_snapshot,
        stages=sorted_stages,
        snapshot_mode=snapshot_mode,
    )
    open_active_segments = _open_stage_segments(db, job_card.id, job_card.current_stage) if job_card.current_stage != "DONE" else []
    active_segment = open_active_segments[0] if open_active_segments else None
    planner_gate = _planner_gate_context(
        current_stage=job_card.current_stage,
        active_stage=next((stage for stage in sorted_stages if stage.stage_type == job_card.current_stage), None),
        active_segment=active_segment,
    )
    blocked_reason = (
        f"{len(open_active_segments)} open segments remain in {job_card.current_stage}"
        if len(open_active_segments) > 1
        else planner_gate["planner_gate_reason"]
    )

    return JobCardPlanningDetail(
        id=job_card.id,
        plant_id=job_card.plant_id,
        sales_order_id=job_card.sales_order_id,
        sales_order_line_id=job_card.sales_order_line_id,
        release_lot_id=job_card.release_lot_id,
        spec_id=job_card.spec_id,
        planned_qty=job_card.planned_qty,
        released_qty=float(job_card.released_qty or 0.0),
        assigned_winder_machine_id=str(job_card.assigned_winder_machine_id) if job_card.assigned_winder_machine_id else None,
        product_code=job_card.product_code or effective_snapshot.get("product_code"),
        status=job_card.status,
        current_stage=job_card.current_stage,
        requires_slitting=bool(job_card.requires_slitting),
        job_card_ref=_format_ref("JC", job_card.id),
        sales_order_ref=_format_ref("SO", sales_order.id if sales_order else job_card.sales_order_id),
        spec_snapshot=effective_snapshot,
        routing_snapshot=job_card.routing_snapshot or {},
        material_plan_snapshot=job_card.material_plan_snapshot or {},
        snapshot_mode=snapshot_mode,
        document_snapshot=document_snapshot,
        sales_order={
            "id": str(sales_order.id) if sales_order else str(job_card.sales_order_id),
            "line_id": str(job_card.sales_order_line_id) if job_card.sales_order_line_id else None,
            "order_no": effective_snapshot.get("sales_order_order_no"),
            "status": sales_order.status if sales_order else None,
            "priority": sales_order.priority if sales_order else None,
            "order_qty": sales_order.order_qty if sales_order else None,
            "due_date": _snapshot_date(effective_snapshot.get("sales_order_line_due_date")) or (
                sales_order.due_date if sales_order else None
            ),
            "customer_id": str(sales_order.customer_id) if sales_order else None,
            "spec_id": str(sales_order.spec_id) if sales_order else str(job_card.spec_id),
        },
        active_segment_id=str(active_segment.id) if active_segment else None,
        active_segment_status=str(active_segment.status) if active_segment else None,
        active_segment_machine_id=planner_gate["active_segment_machine_id"],
        active_segment_plan_date=planner_gate["active_segment_plan_date"],
        open_segment_count=len(open_active_segments),
        blocked_reason=blocked_reason,
        planner_gate_ready=planner_gate["planner_gate_ready"],
        planner_gate_reason=planner_gate["planner_gate_reason"],
        carry_forward_suggestion=_build_carry_forward_suggestion(job_card, sorted_stages),
        stages=[
            JobCardPlanningStage(
                stage_type=stage_row.stage_type,
                status=stage_row.status,
                machine_id=str(stage_row.machine_id) if stage_row.machine_id else None,
                plan_date=stage_row.plan_date,
                shift_code=stage_row.shift_code,
                planned_start=stage_row.planned_start,
                planned_end=stage_row.planned_end,
                actual_start=stage_row.actual_start,
                actual_end=stage_row.actual_end,
                input_qty=stage_row.input_qty,
                output_qty=stage_row.output_qty,
                scrap_qty=stage_row.scrap_qty,
                remarks=stage_row.remarks,
                reel_issue_ids=[str(value) for value in (stage_row.reel_issue_ids or [])],
                entry_snapshot=stage_row.entry_snapshot or {},
                actuals_snapshot=stage_row.actuals_snapshot or {},
                quality_checks=stage_row.quality_checks or {},
                material_allocations=stage_row.material_allocations or [],
                location_id=str(stage_row.location_id) if stage_row.location_id else None,
                required_capacity=stage_row.required_capacity,
            )
            for stage_row in sorted_stages
        ],
        stage_segments=[
            JobCardStageSegmentResponse(
                id=segment.id,
                stage_type=segment.stage_type,
                segment_no=int(segment.segment_no or 1),
                machine_id=str(segment.machine_id) if segment.machine_id else None,
                plan_date=segment.plan_date,
                shift_code=segment.shift_code,
                planned_qty=float(segment.planned_qty or 0.0),
                input_qty=segment.input_qty,
                output_qty=segment.output_qty,
                scrap_qty=segment.scrap_qty,
                required_capacity=float(segment.required_capacity or 0.0),
                status=segment.status,
                split_source=str(segment.split_source or "NONE"),
                split_parent_segment_id=str(segment.split_parent_segment_id) if segment.split_parent_segment_id else None,
                sequence_no=int(segment.sequence_no or 1),
                created_at=segment.created_at,
                started_at=segment.started_at,
                completed_at=segment.completed_at,
            )
            for segment in stage_segments
        ],
        packing_record=(
            {
                "id": str(packing_record.id),
                "fg_item_id": str(packing_record.fg_item_id) if packing_record.fg_item_id else None,
                "fg_batch_no": packing_record.fg_batch_no,
                "qty_per_bundle": packing_record.qty_per_bundle,
                "bundle_count": packing_record.bundle_count,
                "total_packed_qty": packing_record.total_packed_qty,
                "location_id": str(packing_record.location_id) if packing_record.location_id else None,
                "stock_status": packing_record.stock_status,
                "snapshot": packing_record.snapshot or {},
            }
            if packing_record
            else None
        ),
        quality_inspections=[
            {
                "id": str(row.id),
                "stage_type": row.stage_type,
                "status": row.status,
                "readings": row.readings or {},
                "failures": row.failures or [],
                "created_by": row.created_by,
                "created_at": row.created_at,
            }
            for row in quality_inspections
        ],
        quality_holds=[
            {
                "id": str(row.id),
                "stage_type": row.stage_type,
                "batch_id": row.batch_id,
                "reason": row.reason,
                "status": row.status,
                "source_inspection_id": str(row.source_inspection_id) if row.source_inspection_id else None,
                "created_by": row.created_by,
                "released_by": row.released_by,
                "created_at": row.created_at,
                "released_at": row.released_at,
            }
            for row in quality_holds
        ],
        audit_events=[
            {
                "id": str(row.id),
                "entity_type": row.entity_type,
                "entity_id": str(row.entity_id),
                "action": row.action,
                "actor_id": row.actor_id,
                "actor_role": row.actor_role,
                "request_id": row.request_id,
                "payload": row.payload or {},
                "event_ts": row.event_ts,
            }
            for row in audit_events
        ],
        created_at=job_card.created_at,
    )


def _service_json_for_genealogy(
    *,
    base_url: str,
    path: str,
    token: str,
    plant_id: str,
    params: Optional[dict[str, Any]] = None,
) -> Any:
    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.get(
                f"{base_url}{path}",
                params=params or None,
                headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
            )
    except httpx.RequestError as exc:
        return {"_error": str(exc), "_status": "service_unreachable"}
    if response.status_code >= 400:
        return {"_error": response.text, "_status": response.status_code}
    try:
        return response.json()
    except ValueError:
        return {}


def _payload_list(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [row for row in value if isinstance(row, dict)]
    if isinstance(value, dict):
        for key in ["items", "rows", "ledger", "results"]:
            nested = value.get(key)
            if isinstance(nested, list):
                return [row for row in nested if isinstance(row, dict)]
    return []


def _stage_genealogy_row(stage: JobCardStage) -> dict[str, Any]:
    return {
        "id": str(stage.id),
        "stage_type": stage.stage_type,
        "status": stage.status,
        "machine_id": str(stage.machine_id) if stage.machine_id else None,
        "plan_date": stage.plan_date,
        "shift_code": stage.shift_code,
        "input_qty": float(stage.input_qty or 0.0),
        "output_qty": float(stage.output_qty or 0.0),
        "scrap_qty": float(stage.scrap_qty or 0.0),
        "reel_issue_ids": [str(value) for value in (stage.reel_issue_ids or [])],
        "entry_snapshot": stage.entry_snapshot or {},
        "actuals_snapshot": stage.actuals_snapshot or {},
        "quality_checks": stage.quality_checks or {},
        "material_allocations": stage.material_allocations or [],
        "actual_start": stage.actual_start,
        "actual_end": stage.actual_end,
        "entered_at": stage.entered_at,
    }


def _segment_genealogy_row(segment: JobCardStageSegment) -> dict[str, Any]:
    return {
        "id": str(segment.id),
        "stage_type": segment.stage_type,
        "segment_no": int(segment.segment_no or 1),
        "sequence_no": int(segment.sequence_no or 1),
        "machine_id": str(segment.machine_id) if segment.machine_id else None,
        "plan_date": segment.plan_date,
        "shift_code": segment.shift_code,
        "planned_qty": float(segment.planned_qty or 0.0),
        "input_qty": float(segment.input_qty or 0.0),
        "output_qty": float(segment.output_qty or 0.0),
        "scrap_qty": float(segment.scrap_qty or 0.0),
        "required_capacity": float(segment.required_capacity or 0.0),
        "status": segment.status,
        "split_source": segment.split_source,
        "started_at": segment.started_at,
        "completed_at": segment.completed_at,
    }


def _flow_step(code: str, label: str, status: str, detail: str, metrics: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    return {
        "code": code,
        "label": label,
        "status": status,
        "detail": detail,
        "metrics": metrics or {},
    }


def _genealogy_gap(gaps: list[dict[str, Any]], severity: str, code: str, message: str) -> None:
    gaps.append({"severity": severity, "code": code, "message": message})


def _collect_reel_issue_ids(stages: list[JobCardStage]) -> list[str]:
    collected: list[str] = []
    seen: set[str] = set()
    for stage in stages:
        for raw in stage.reel_issue_ids or []:
            text = str(raw)
            if text and text not in seen:
                seen.add(text)
                collected.append(text)
    return collected


@router.get("/genealogy/job-cards/{job_card_id}", response_model=dict[str, Any])
def get_job_card_genealogy(
    job_card_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Owner", "Admin", "PlantManager", "Planner", "Sales", "Dispatch", "Store", "QC", "Production"])),
):
    query = (
        db.query(JobCard, SalesOrder)
        .outerjoin(SalesOrder, SalesOrder.id == JobCard.sales_order_id)
        .filter(JobCard.id == job_card_id)
    )
    query = _apply_plant_scope_filter(query, JobCard.plant_id, plant_scope)
    row = query.first()
    if not row:
        raise HTTPException(status_code=404, detail="Job card not found")

    job_card, local_sales_order = row
    token = current_user.get("token", "")
    plant_id = str(job_card.plant_id)
    stages = (
        db.query(JobCardStage)
        .filter(JobCardStage.job_card_id == job_card.id)
        .all()
    )
    sorted_stages = sorted(stages, key=lambda item: _stage_sort_key(item.stage_type))
    segments = (
        db.query(JobCardStageSegment)
        .filter(JobCardStageSegment.job_card_id == job_card.id)
        .order_by(
            JobCardStageSegment.stage_type.asc(),
            JobCardStageSegment.sequence_no.asc(),
            JobCardStageSegment.segment_no.asc(),
            JobCardStageSegment.created_at.asc(),
        )
        .all()
    )
    packing_record = db.query(PackingRecord).filter(PackingRecord.job_card_id == job_card.id).first()
    quality_inspections = (
        db.query(QualityInspection)
        .filter(QualityInspection.job_card_id == job_card.id)
        .order_by(QualityInspection.created_at.asc())
        .all()
    )
    quality_holds = (
        db.query(QualityHold)
        .filter(QualityHold.job_card_id == job_card.id)
        .order_by(QualityHold.created_at.asc())
        .all()
    )
    dispatch = db.query(Dispatch).filter(Dispatch.job_card_id == job_card.id).first()
    recent_shift_ledgers = (
        db.query(ShiftMaterialLedger)
        .filter(ShiftMaterialLedger.plant_id == job_card.plant_id)
        .order_by(ShiftMaterialLedger.work_date.desc(), ShiftMaterialLedger.created_at.desc())
        .limit(250)
        .all()
    )
    shift_ledgers = [
        row
        for row in recent_shift_ledgers
        if str(job_card.id) in {str(value) for value in (row.actual_job_card_ids or [])}
    ]
    audit_events = (
        db.query(AuditEvent)
        .filter(AuditEvent.job_card_id == job_card.id)
        .order_by(AuditEvent.event_ts.asc())
        .all()
    )

    external_sales_order = None
    if job_card.sales_order_id:
        external_sales_order = _service_json_for_genealogy(
            base_url=settings.SALES_SERVICE_URL,
            path=f"/sales-orders/{job_card.sales_order_id}",
            token=token,
            plant_id=plant_id,
        )

    packing_snapshot = dict(packing_record.snapshot or {}) if packing_record else {}
    dispatch_snapshot = dict(dispatch.dispatch_snapshot or {}) if dispatch else {}
    inventory_batch_id = dispatch_snapshot.get("inventory_batch_id") or packing_snapshot.get("inventory_batch_id")
    fg_production_ledger = _service_json_for_genealogy(
        base_url=settings.INVENTORY_SERVICE_URL,
        path="/ledger",
        token=token,
        plant_id=plant_id,
        params={"reference_type": "PRODUCTION_JOB", "reference_id": str(job_card.id), "limit": 100},
    )
    fg_batch_ledger = (
        _service_json_for_genealogy(
            base_url=settings.INVENTORY_SERVICE_URL,
            path="/ledger",
            token=token,
            plant_id=plant_id,
            params={"batch_id": str(inventory_batch_id), "limit": 100},
        )
        if inventory_batch_id
        else {"ledger": []}
    )
    dispatch_ledger = (
        _service_json_for_genealogy(
            base_url=settings.INVENTORY_SERVICE_URL,
            path="/ledger",
            token=token,
            plant_id=plant_id,
            params={"external_ref": f"PROD-DISPATCH-{dispatch.id}", "limit": 25},
        )
        if dispatch
        else {"ledger": []}
    )

    reel_issue_ids = _collect_reel_issue_ids(sorted_stages)
    reel_issues_response = (
        _service_json_for_genealogy(
            base_url=settings.INVENTORY_SERVICE_URL,
            path="/reel-issues",
            token=token,
            plant_id=plant_id,
            params={"issue_ids": ",".join(reel_issue_ids), "limit": 500},
        )
        if reel_issue_ids
        else []
    )
    reel_issues = _payload_list(reel_issues_response)
    reel_ids = sorted({str(row.get("reel_id")) for row in reel_issues if row.get("reel_id")})
    reels_response = (
        _service_json_for_genealogy(
            base_url=settings.INVENTORY_SERVICE_URL,
            path="/reels",
            token=token,
            plant_id=plant_id,
            params={"reel_ids": ",".join(reel_ids), "limit": 500},
        )
        if reel_ids
        else []
    )
    reels = _payload_list(reels_response)

    active_holds = [row for row in quality_holds if row.status in QC_BLOCKING_STATUSES]
    stage_map = {stage.stage_type: stage for stage in sorted_stages}
    winder_segments = [segment for segment in segments if segment.stage_type == "WINDER"]
    scheduled_winder = next((segment for segment in winder_segments if segment.machine_id and segment.plan_date), None)
    winder_warning = (
        _winder_override_warning(job_card, scheduled_winder.machine_id)
        if scheduled_winder and scheduled_winder.machine_id
        else None
    )
    production_stages = [stage for stage in ["SLITTING", "WINDER", "OVEN", "PROCESS", "PACKING"] if stage in stage_map]
    completed_stage_count = sum(1 for stage in production_stages if stage_map[stage].status == "COMPLETED")
    packing_completed = bool(stage_map.get("PACKING") and stage_map["PACKING"].status == "COMPLETED")
    quality_evidence = bool(quality_inspections) or any(bool(stage.quality_checks) for stage in sorted_stages)
    material_evidence = bool(reel_issue_ids) or bool(shift_ledgers) or any(bool(stage.material_allocations) for stage in sorted_stages)
    fg_posted = bool(packing_record and packing_snapshot.get("inventory_batch_id") and packing_snapshot.get("inventory_transaction_id"))
    inventory_dispatched = bool(
        dispatch_snapshot.get("inventory_dispatch_transaction_id")
        or dispatch_snapshot.get("inventory_transaction_id")
        or _payload_list(dispatch_ledger)
    )

    gaps: list[dict[str, Any]] = []
    flow_steps = [
        _flow_step(
            "SALES_ORDER",
            "Sales order",
            "COMPLETE" if (local_sales_order or (isinstance(external_sales_order, dict) and not external_sales_order.get("_error"))) else "WARNING",
            "Commercial demand is linked to the job card." if job_card.sales_order_id else "Job card is not linked to a sales order.",
            {"sales_order_id": str(job_card.sales_order_id) if job_card.sales_order_id else None},
        ),
        _flow_step(
            "RELEASE_TO_PLANNER",
            "Release to planner",
            "COMPLETE" if job_card.release_lot_id else "WARNING",
            "Sales release lot gates this job into the planner." if job_card.release_lot_id else "No release lot is linked; planner genealogy is weaker.",
            {
                "release_lot_id": str(job_card.release_lot_id) if job_card.release_lot_id else None,
                "assigned_winder_machine_id": str(job_card.assigned_winder_machine_id) if job_card.assigned_winder_machine_id else None,
            },
        ),
        _flow_step(
            "PLANNER_SCHEDULE",
            "Planner schedule",
            "WARNING" if winder_warning else ("COMPLETE" if scheduled_winder else "PENDING"),
            winder_warning or ("Winder schedule is fixed with machine, date, and shift." if scheduled_winder else "Winder scheduling is still pending."),
            {
                "machine_id": str(scheduled_winder.machine_id) if scheduled_winder and scheduled_winder.machine_id else None,
                "plan_date": scheduled_winder.plan_date if scheduled_winder else None,
                "shift_code": scheduled_winder.shift_code if scheduled_winder else None,
            },
        ),
        _flow_step(
            "PRODUCTION_OUTPUT",
            "Production output logs",
            "COMPLETE" if production_stages and completed_stage_count == len(production_stages) else "PENDING",
            f"{completed_stage_count}/{len(production_stages)} production stage(s) completed with output logs.",
            {"completed_stage_count": completed_stage_count, "stage_count": len(production_stages)},
        ),
        _flow_step(
            "QUALITY",
            "Quality and inspection",
            "BLOCKED" if active_holds else ("COMPLETE" if quality_evidence else "WARNING"),
            f"{len(active_holds)} active hold(s) block dispatch." if active_holds else ("Inspection evidence exists." if quality_evidence else "No inspection evidence is attached yet."),
            {"inspection_count": len(quality_inspections), "active_hold_count": len(active_holds)},
        ),
        _flow_step(
            "PACKING_FG",
            "Packing and FG creation",
            "COMPLETE" if packing_completed and fg_posted else ("WARNING" if packing_completed else "PENDING"),
            "Packing created FG stock and inventory batch." if fg_posted else "Packing is complete but FG stock posting is missing." if packing_completed else "Packing output is not complete yet.",
            {
                "packed_qty": float(packing_record.total_packed_qty or 0.0) if packing_record else 0.0,
                "inventory_batch_id": str(inventory_batch_id) if inventory_batch_id else None,
            },
        ),
        _flow_step(
            "DISPATCH",
            "Dispatch and sales close",
            "COMPLETE" if dispatch and dispatch.status == "SEALED" and inventory_dispatched else ("WARNING" if dispatch and dispatch.status == "SEALED" else "PENDING"),
            "Dispatch is sealed, inventory is reduced, and sales fulfillment is updated." if dispatch and dispatch.status == "SEALED" and inventory_dispatched else "Dispatch is sealed but inventory dispatch proof is missing." if dispatch and dispatch.status == "SEALED" else "Dispatch is not sealed yet.",
            {
                "dispatch_id": str(dispatch.id) if dispatch else None,
                "status": dispatch.status if dispatch else None,
                "inventory_dispatched": inventory_dispatched,
            },
        ),
    ]

    if not job_card.sales_order_id:
        _genealogy_gap(gaps, "high", "SALES_LINK_MISSING", "Job card has no sales order link.")
    if not job_card.release_lot_id:
        _genealogy_gap(gaps, "medium", "RELEASE_LOT_MISSING", "Job card was not created from a sales release lot.")
    if winder_warning:
        _genealogy_gap(gaps, "info", "OTHER_WINDER_USED", winder_warning)
    if production_stages and completed_stage_count != len(production_stages):
        _genealogy_gap(gaps, "medium", "PRODUCTION_OUTPUT_INCOMPLETE", "Not all production stage outputs are completed.")
    if active_holds:
        _genealogy_gap(gaps, "high", "QUALITY_HOLD_ACTIVE", "Active quality holds must be released before dispatch.")
    if not quality_evidence:
        _genealogy_gap(gaps, "medium", "QUALITY_EVIDENCE_MISSING", "Add inspection or stage quality checks before client handoff.")
    if packing_completed and not fg_posted:
        _genealogy_gap(gaps, "high", "FG_INWARD_MISSING", "Packing completed but FG inventory inward is not posted.")
    if dispatch and dispatch.status == "SEALED" and not inventory_dispatched:
        _genealogy_gap(gaps, "high", "DISPATCH_INVENTORY_MISSING", "Dispatch is sealed without inventory dispatch proof.")
    if not material_evidence:
        _genealogy_gap(gaps, "medium", "MATERIAL_PROOF_MISSING", "No reel issue, shift material ledger, or stage material allocation proof is attached.")

    return {
        "job_card": {
            "id": str(job_card.id),
            "job_card_ref": _format_ref("JC", job_card.id),
            "plant_id": str(job_card.plant_id),
            "sales_order_id": str(job_card.sales_order_id) if job_card.sales_order_id else None,
            "sales_order_line_id": str(job_card.sales_order_line_id) if job_card.sales_order_line_id else None,
            "release_lot_id": str(job_card.release_lot_id) if job_card.release_lot_id else None,
            "spec_id": str(job_card.spec_id),
            "product_code": job_card.product_code or (job_card.spec_snapshot or {}).get("product_code"),
            "status": job_card.status,
            "current_stage": job_card.current_stage,
            "planned_qty": float(job_card.planned_qty or 0.0),
            "released_qty": float(job_card.released_qty or 0.0),
            "assigned_winder_machine_id": str(job_card.assigned_winder_machine_id) if job_card.assigned_winder_machine_id else None,
            "created_at": job_card.created_at,
        },
        "sales_order": {
            "local": {
                "id": str(local_sales_order.id) if local_sales_order else None,
                "status": local_sales_order.status if local_sales_order else None,
                "order_qty": float(local_sales_order.order_qty or 0.0) if local_sales_order else None,
                "due_date": local_sales_order.due_date if local_sales_order else None,
            } if local_sales_order else None,
            "external": external_sales_order,
        },
        "flow_steps": flow_steps,
        "gaps": gaps,
        "stages": [_stage_genealogy_row(stage) for stage in sorted_stages],
        "stage_segments": [_segment_genealogy_row(segment) for segment in segments],
        "quality": {
            "inspections": [
                {
                    "id": str(row.id),
                    "stage_type": row.stage_type,
                    "status": row.status,
                    "readings": row.readings or {},
                    "failures": row.failures or [],
                    "created_by": row.created_by,
                    "created_at": row.created_at,
                }
                for row in quality_inspections
            ],
            "holds": [
                {
                    "id": str(row.id),
                    "stage_type": row.stage_type,
                    "batch_id": str(row.batch_id) if row.batch_id else None,
                    "reason": row.reason,
                    "status": row.status,
                    "source_inspection_id": str(row.source_inspection_id) if row.source_inspection_id else None,
                    "created_by": row.created_by,
                    "released_by": row.released_by,
                    "created_at": row.created_at,
                    "released_at": row.released_at,
                }
                for row in quality_holds
            ],
            "active_hold_count": len(active_holds),
        },
        "packing": (
            {
                "id": str(packing_record.id),
                "fg_item_id": str(packing_record.fg_item_id) if packing_record.fg_item_id else None,
                "fg_batch_no": packing_record.fg_batch_no,
                "qty_per_bundle": float(packing_record.qty_per_bundle or 0.0),
                "bundle_count": int(packing_record.bundle_count or 0),
                "total_packed_qty": float(packing_record.total_packed_qty or 0.0),
                "location_id": str(packing_record.location_id) if packing_record.location_id else None,
                "stock_status": packing_record.stock_status,
                "snapshot": packing_snapshot,
            }
            if packing_record
            else None
        ),
        "fg_inventory": {
            "batch_id": str(inventory_batch_id) if inventory_batch_id else None,
            "production_ledger": _payload_list(fg_production_ledger),
            "batch_ledger": _payload_list(fg_batch_ledger),
            "dispatch_ledger": _payload_list(dispatch_ledger),
        },
        "dispatch": (
            {
                "id": str(dispatch.id),
                "status": dispatch.status,
                "dispatch_snapshot": dispatch_snapshot,
                "created_at": dispatch.created_at,
            }
            if dispatch
            else None
        ),
        "materials": {
            "reel_issue_ids": reel_issue_ids,
            "reel_issues": reel_issues,
            "reels": reels,
            "shift_ledgers": [
                {
                    "id": str(row.id),
                    "stage_type": row.stage_type,
                    "work_date": row.work_date,
                    "shift_code": row.shift_code,
                    "issue_section": row.issue_section,
                    "machine_id": str(row.machine_id) if row.machine_id else None,
                    "reel_issue_ids": [str(value) for value in (row.reel_issue_ids or [])],
                    "parent_reel_id": row.parent_reel_id,
                    "child_reel_ids": row.child_reel_ids or [],
                    "issued_weight_kg": float(row.issued_weight_kg or 0.0),
                    "consumed_weight_kg": float(row.consumed_weight_kg or 0.0),
                    "wastage_weight_kg": float(row.wastage_weight_kg or 0.0),
                    "remaining_weight_kg": float(row.remaining_weight_kg or 0.0),
                    "actual_job_card_ids": [str(value) for value in (row.actual_job_card_ids or [])],
                    "transfer_snapshot": row.transfer_snapshot or {},
                    "notes": row.notes,
                }
                for row in shift_ledgers
            ],
        },
        "audit_events": [
            {
                "id": str(row.id),
                "entity_type": row.entity_type,
                "entity_id": str(row.entity_id),
                "action": row.action,
                "actor_id": row.actor_id,
                "actor_role": row.actor_role,
                "payload": row.payload or {},
                "event_ts": row.event_ts,
            }
            for row in audit_events
        ],
    }


@router.patch("/planning/queues/reorder", response_model=StageActionResponse)
def reorder_stage_queue(
    payload: ReorderQueuePayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "PlantManager", "Planner"])),
):
    plant_uuid = _to_uuid(plant_id)
    selected_stage = _normalize_stage(payload.stage)

    if payload.segment_id is not None:
        segment = (
            db.query(JobCardStageSegment)
            .join(JobCard, JobCard.id == JobCardStageSegment.job_card_id)
            .filter(
                JobCardStageSegment.id == payload.segment_id,
                JobCard.plant_id == plant_uuid,
            )
            .first()
        )
        if not segment:
            raise HTTPException(status_code=404, detail="Stage segment not found")
        job_card = segment.job_card
    else:
        job_card = (
            db.query(JobCard)
            .filter(
                JobCard.id == payload.job_card_id,
                JobCard.plant_id == plant_uuid,
            )
            .first()
        )
        if not job_card:
            raise HTTPException(status_code=404, detail="Job card not found")
        segment = None
    if not job_card:
        raise HTTPException(status_code=404, detail="Job card not found")
    if job_card.status in ["COMPLETED", "CANCELLED"]:
        raise HTTPException(status_code=400, detail="Job card is not reorderable")

    stage = (
        db.query(JobCardStage)
        .filter(
            JobCardStage.job_card_id == job_card.id,
            JobCardStage.stage_type == selected_stage,
        )
        .first()
    )
    if not stage:
        raise HTTPException(status_code=400, detail="Selected stage row is missing")
    if stage.status == "COMPLETED":
        raise HTTPException(status_code=400, detail="Cannot reorder a completed stage")
    segment = segment or _resolve_active_segment(
        db,
        job_card=job_card,
        stage=selected_stage,
        segment_id=payload.segment_id,
    )

    warnings: list[str] = []
    if selected_stage == "PACKING":
        machine_uuid = payload.machine_id
        machine_capacity = None
        if machine_uuid is not None:
            machine = _fetch_machine(machine_uuid, current_user.get("token", ""), plant_id)
            _validate_machine_presence_for_packing(machine, plant_id)
            machine_capacity = machine.get("capacity_value")
    else:
        machine_uuid = payload.machine_id
        machine_capacity = None
        if selected_stage in {"QC", "DISPATCH"}:
            machine_uuid = None
        elif machine_uuid is not None:
            if selected_stage == "WINDER":
                warning = _winder_override_warning(job_card, machine_uuid)
                if warning:
                    warnings.append(warning)
            machine = _fetch_machine(machine_uuid, current_user.get("token", ""), plant_id)
            _validate_machine_compatibility(
                machine=machine,
                stage=selected_stage,
                spec_snapshot=job_card.spec_snapshot,
                plant_id=plant_id,
            )
            machine_capacity = machine.get("capacity_value")

    stage.machine_id = machine_uuid
    stage.plan_date = payload.plan_date or stage.plan_date or _default_plan_date_from_snapshot(job_card.spec_snapshot or {})
    stage.shift_code = payload.shift_code or stage.shift_code or (
        "SHIFT_A" if machine_uuid is not None or selected_stage in {"QC", "DISPATCH"} else None
    )
    stage.required_capacity = _required_capacity_for_job(
        stage=selected_stage,
        planned_qty=float(job_card.planned_qty or 0.0),
        spec_snapshot=job_card.spec_snapshot or {},
    )
    moved_segment, open_count = _move_or_split_segment(
        db=db,
        job_card=job_card,
        stage_row=stage,
        segment=segment,
        stage=selected_stage,
        machine_id=machine_uuid,
        plan_date=stage.plan_date,
        shift_code=stage.shift_code if machine_uuid is not None or selected_stage in {"QC", "DISPATCH"} else None,
        desired_sequence=payload.sequence_no,
        token=current_user.get("token", ""),
        plant_id=plant_id,
    )
    stage.status = "ASSIGNED" if machine_uuid else stage.status

    if job_card.status == "CREATED":
        job_card.status = "PLANNED"

    warning_message = _capacity_warning_message(
        db=db,
        plant_id=plant_uuid,
        stage=selected_stage,
        machine_id=machine_uuid,
        machine_capacity=float(machine_capacity or 0.0) if machine_uuid else None,
    )
    if warning_message:
        warnings.append(warning_message)
    message = "Queue order updated"
    if warnings:
        message = f"{message}. {' '.join(warnings)}"
    db.commit()
    db.refresh(job_card)
    return StageActionResponse(
        message=message,
        job_card_id=job_card.id,
        stage=selected_stage,
        segment_id=moved_segment.id,
        job_card_status=job_card.status,
        current_stage=job_card.current_stage,
        stage_status=stage.status,
        remaining_open_segments=open_count,
        warnings=warnings,
        reel_issue_ids=[str(value) for value in (stage.reel_issue_ids or [])],
    )


@router.patch("/planning/board/move", response_model=StageActionResponse)
def move_planning_board_card(
    payload: BoardMovePayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "PlantManager", "Planner"])),
):
    reorder_payload = ReorderQueuePayload(
        job_card_id=payload.job_card_id,
        segment_id=payload.segment_id,
        stage=payload.stage,
        machine_id=payload.machine_id,
        sequence_no=payload.sequence_no,
        plan_date=payload.plan_date,
        shift_code=payload.shift_code,
    )
    return reorder_stage_queue(
        payload=reorder_payload,
        db=db,
        plant_id=plant_id,
        current_user=current_user,
    )


@router.post("/planning/segments/split", response_model=StageActionResponse)
def split_planning_segment(
    payload: StageSegmentSplitPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "PlantManager", "Planner"])),
):
    plant_uuid = _to_uuid(plant_id)
    selected_stage = _normalize_stage(payload.stage)
    if selected_stage not in {"WINDER", "PROCESS"}:
        raise HTTPException(status_code=400, detail="Manual split is available only for WINDER and PROCESS")

    segment = (
        db.query(JobCardStageSegment)
        .join(JobCard, JobCard.id == JobCardStageSegment.job_card_id)
        .filter(
            JobCardStageSegment.id == payload.segment_id,
            JobCard.plant_id == plant_uuid,
        )
        .first()
    )
    if not segment:
        raise HTTPException(status_code=404, detail="Stage segment not found")
    if segment.stage_type != selected_stage:
        raise HTTPException(status_code=400, detail="Segment does not belong to the selected stage")
    if segment.status in {"COMPLETED", "CANCELLED", "RUNNING"}:
        raise HTTPException(status_code=400, detail="Only planned or assigned segments can be split")

    job_card = segment.job_card
    if not job_card or job_card.status in {"COMPLETED", "CANCELLED"}:
        raise HTTPException(status_code=400, detail="Job card is not split-ready")

    stage = (
        db.query(JobCardStage)
        .filter(
            JobCardStage.job_card_id == job_card.id,
            JobCardStage.stage_type == selected_stage,
        )
        .first()
    )
    if not stage:
        raise HTTPException(status_code=400, detail="Selected stage row is missing")

    total_qty = round(float(segment.planned_qty or 0.0), 2)
    primary_qty = round(float(payload.primary_qty or 0.0), 2)
    if total_qty <= 0:
        raise HTTPException(status_code=400, detail="Segment has no planned quantity to split")
    if primary_qty <= 0 or primary_qty >= total_qty:
        raise HTTPException(
            status_code=400,
            detail=f"primary_qty must be greater than 0 and less than the current segment qty ({total_qty:.2f})",
        )

    secondary_qty = round(total_qty - primary_qty, 2)
    primary_capacity, secondary_capacity = _split_segment_capacity(segment, primary_qty)

    segment.planned_qty = primary_qty
    segment.required_capacity = primary_capacity
    segment.split_source = "MANUAL"

    split_segment = _append_stage_segment(
        db=db,
        job_card=job_card,
        stage_row=stage,
        machine_id=segment.machine_id,
        plan_date=segment.plan_date,
        shift_code=segment.shift_code,
        planned_qty=secondary_qty,
        required_capacity=secondary_capacity,
        split_source="MANUAL",
        split_parent_segment_id=segment.id,
        status=segment.status,
    )
    _place_stage_segment(
        db=db,
        segment=split_segment,
        desired_sequence=(segment.sequence_no or 1) + 1,
        machine_id=segment.machine_id,
        plan_date=segment.plan_date,
        shift_code=segment.shift_code,
    )
    _sync_stage_row_from_segments(stage, _all_stage_segments(db, job_card.id, selected_stage))
    db.commit()
    db.refresh(job_card)

    return StageActionResponse(
        message=f"Segment split into {primary_qty:.0f} pcs and {secondary_qty:.0f} pcs",
        job_card_id=job_card.id,
        stage=selected_stage,
        segment_id=segment.id,
        job_card_status=job_card.status,
        current_stage=job_card.current_stage,
        stage_status=stage.status,
        remaining_open_segments=len(_open_stage_segments(db, job_card.id, selected_stage)),
        reel_issue_ids=[str(value) for value in (stage.reel_issue_ids or [])],
    )


@router.post("/job-cards/{job_card_id}/assign-machine", response_model=StageActionResponse)
def assign_machine_to_current_stage(
    job_card_id: uuid.UUID,
    payload: AssignMachinePayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "PlantManager", "Planner"])),
):
    plant_uuid = _to_uuid(plant_id)
    job_card = (
        db.query(JobCard)
        .filter(
            JobCard.id == job_card_id,
            JobCard.plant_id == plant_uuid,
        )
        .first()
    )
    if not job_card:
        raise HTTPException(status_code=404, detail="Job card not found")
    if job_card.status in ["COMPLETED", "CANCELLED"] or job_card.current_stage == "DONE":
        raise HTTPException(status_code=400, detail="Job card is not assignable")

    selected_stage = payload.stage or job_card.current_stage
    selected_stage = _normalize_stage(selected_stage)

    stage = (
        db.query(JobCardStage)
        .filter(
            JobCardStage.job_card_id == job_card.id,
            JobCardStage.stage_type == selected_stage,
        )
        .first()
    )
    if not stage:
        raise HTTPException(status_code=400, detail="Selected stage row is missing")
    segment = _resolve_active_segment(
        db,
        job_card=job_card,
        stage=selected_stage,
        segment_id=None,
    )

    if selected_stage == "PACKING":
        machine_uuid = payload.machine_id
        machine_capacity = None
        if machine_uuid is not None:
            machine = _fetch_machine(machine_uuid, current_user.get("token", ""), plant_id)
            _validate_machine_presence_for_packing(machine, plant_id)
            machine_capacity = machine.get("capacity_value")
    else:
        if selected_stage in {"QC", "DISPATCH"}:
            machine_uuid = None
            machine_capacity = None
        else:
            if payload.machine_id is None:
                raise HTTPException(status_code=400, detail="machine_id is required for this stage")
            machine_uuid = payload.machine_id
            machine = _fetch_machine(machine_uuid, current_user.get("token", ""), plant_id)
            _validate_machine_compatibility(
                machine=machine,
                stage=selected_stage,
                spec_snapshot=job_card.spec_snapshot,
                plant_id=plant_id,
            )
            machine_capacity = machine.get("capacity_value")

    stage.machine_id = machine_uuid
    stage.plan_date = payload.plan_date or stage.plan_date or _default_plan_date_from_snapshot(job_card.spec_snapshot or {})
    stage.shift_code = payload.shift_code or stage.shift_code or (
        "SHIFT_A" if machine_uuid is not None or selected_stage in {"QC", "DISPATCH"} else None
    )
    stage.required_capacity = _required_capacity_for_job(
        stage=selected_stage,
        planned_qty=float(job_card.planned_qty or 0.0),
        spec_snapshot=job_card.spec_snapshot or {},
    )
    stage.planned_start = payload.planned_start if payload.planned_start is not None else stage.planned_start
    stage.planned_end = payload.planned_end if payload.planned_end is not None else stage.planned_end
    moved_segment, open_count = _move_or_split_segment(
        db=db,
        job_card=job_card,
        stage_row=stage,
        segment=segment,
        stage=selected_stage,
        machine_id=machine_uuid,
        plan_date=stage.plan_date,
        shift_code=stage.shift_code if machine_uuid is not None or selected_stage in {"QC", "DISPATCH"} else None,
        desired_sequence=payload.sequence_no,
        token=current_user.get("token", ""),
        plant_id=plant_id,
    )
    if stage.status != "COMPLETED":
        stage.status = "ASSIGNED" if machine_uuid is not None else stage.status

    if job_card.status == "CREATED":
        job_card.status = "PLANNED"

    warning_message = _capacity_warning_message(
        db=db,
        plant_id=plant_uuid,
        stage=selected_stage,
        machine_id=machine_uuid,
        machine_capacity=float(machine_capacity or 0.0) if machine_uuid else None,
    )
    db.commit()
    db.refresh(job_card)
    return StageActionResponse(
        message="Machine assignment planned" if not warning_message else f"Machine assignment planned. {warning_message}",
        job_card_id=job_card.id,
        stage=stage.stage_type,
        segment_id=moved_segment.id,
        job_card_status=job_card.status,
        current_stage=job_card.current_stage,
        stage_status=stage.status,
        remaining_open_segments=open_count,
        reel_issue_ids=[str(value) for value in (stage.reel_issue_ids or [])],
    )


@router.post("/job-cards/{job_card_id}/stage-output", response_model=StageActionResponse)
def capture_stage_output(
    job_card_id: uuid.UUID,
    payload: StageOutputPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "PlantManager", "Operator"])),
):
    plant_uuid = _to_uuid(plant_id)
    save_mode = payload.save_mode or "complete"
    token = current_user.get("token", "")
    actor_role = _current_actor_role(current_user)
    job_card = (
        db.query(JobCard)
        .filter(
            JobCard.id == job_card_id,
            JobCard.plant_id == plant_uuid,
        )
        .first()
    )
    if not job_card:
        raise HTTPException(status_code=404, detail="Job card not found")
    if job_card.status in ["COMPLETED", "CANCELLED"] or job_card.current_stage == "DONE":
        raise HTTPException(status_code=400, detail="Job card is not in executable state")

    # P1.2 — Active QC hold gates stage advancement. PlantManager+ may override
    # with an explicit override_reason; Operator can never override.
    active_holds = (
        db.query(QualityHold)
        .filter(
            QualityHold.job_card_id == job_card.id,
            QualityHold.status.in_(list(QC_BLOCKING_STATUSES)),
        )
        .all()
    )
    override_reason = (payload.override_reason or "").strip() if hasattr(payload, "override_reason") else ""
    if active_holds and not override_reason:
        hold_summaries = [
            {
                "id": str(h.id),
                "stage": h.stage,
                "reason": h.reason,
                "status": h.status,
                "created_by": h.created_by,
            }
            for h in active_holds
        ]
        raise HTTPException(
            status_code=409,
            detail={
                "code": "JOB_HAS_ACTIVE_QC_HOLD",
                "message": (
                    f"Job has {len(active_holds)} active QC hold(s) blocking stage advancement. "
                    "Release the hold(s) or provide an override_reason (PlantManager+ only)."
                ),
                "holds": hold_summaries,
            },
        )
    qc_hold_override_roles = {"Owner", "Admin", "PlantManager"}
    if active_holds and override_reason and actor_role not in qc_hold_override_roles:
        raise HTTPException(
            status_code=403,
            detail="Only Owner, Admin, or PlantManager can override an active QC hold.",
        )

    selected_stage = payload.stage or job_card.current_stage
    selected_stage = _normalize_stage(selected_stage)
    if actor_role == "Operator" and selected_stage != job_card.current_stage:
        raise HTTPException(status_code=403, detail="Operator can only enter data for the current stage")
    routing_stages = list((job_card.routing_snapshot or {}).get("stages") or _routing_stages_from_snapshot(job_card.spec_snapshot or {}))
    if selected_stage not in routing_stages:
        raise HTTPException(status_code=400, detail="Selected stage is not active for this job card")

    stage = (
        db.query(JobCardStage)
        .filter(
            JobCardStage.job_card_id == job_card.id,
            JobCardStage.stage_type == selected_stage,
        )
        .first()
    )
    if not stage:
        raise HTTPException(status_code=400, detail="Selected stage row is missing")
    if stage.status == "COMPLETED":
        if save_mode == "draft":
            raise HTTPException(status_code=400, detail="Completed stage cannot be edited")
        raise HTTPException(status_code=400, detail="Duplicate output entry is not allowed for this stage")
    segment = _resolve_active_segment(
        db,
        job_card=job_card,
        stage=selected_stage,
        segment_id=payload.segment_id,
    )
    if actor_role == "Operator" and payload.machine_id is not None:
        raise HTTPException(status_code=403, detail="Operator cannot change machine assignment during stage entry")
    if actor_role == "Operator" and (payload.override_reason or "").strip():
        raise HTTPException(status_code=403, detail="Operator cannot use override_reason")

    if payload.machine_id is not None:
        machine = _fetch_machine(payload.machine_id, current_user.get("token", ""), plant_id)
        if selected_stage == "PACKING":
            _validate_machine_presence_for_packing(machine, plant_id)
        else:
            _validate_machine_compatibility(
                machine=machine,
                stage=selected_stage,
                spec_snapshot=job_card.spec_snapshot,
                plant_id=plant_id,
            )
        stage.machine_id = payload.machine_id
        segment.machine_id = payload.machine_id

    before_payload = {
        "status": stage.status,
        "segment_status": segment.status,
        "segment_id": str(segment.id),
        "machine_id": str(stage.machine_id) if stage.machine_id else None,
        "input_qty": stage.input_qty,
        "output_qty": stage.output_qty,
        "scrap_qty": stage.scrap_qty,
        "location_id": str(stage.location_id) if stage.location_id else None,
    }
    stage.entry_snapshot = payload.entry_snapshot or {}
    if payload.start_time is not None:
        stage.entry_snapshot["start_time"] = payload.start_time.isoformat()
    if payload.end_time is not None:
        stage.entry_snapshot["end_time"] = payload.end_time.isoformat()
    stage.actuals_snapshot = payload.actuals or {}
    stage.quality_checks = payload.quality_checks or {}
    stage.material_allocations = list(payload.material_allocations or [])
    if payload.location_id is not None:
        stage.location_id = payload.location_id

    if payload.input_qty is not None:
        stage.input_qty = payload.input_qty
        segment.input_qty = payload.input_qty

    if payload.remarks is not None:
        stage.remarks = payload.remarks

    if payload.reel_issue_ids:
        stage.reel_issue_ids = [str(value) for value in payload.reel_issue_ids]
    override_reason = (payload.override_reason or "").strip() or None
    all_stage_rows = (
        db.query(JobCardStage)
        .filter(JobCardStage.job_card_id == job_card.id)
        .all()
    )

    now = datetime.utcnow()
    actual_start_value = _parse_execution_timestamp(payload.start_time) or segment.started_at or stage.actual_start or now
    actual_end_value = _parse_execution_timestamp(payload.end_time)
    stage.entered_by = current_user.get("sub")
    stage.entered_at = now

    if save_mode == "draft":
        if not segment.started_at:
            segment.started_at = actual_start_value
        segment.status = "RUNNING"
        stage.actual_start = stage.actual_start or segment.started_at
        _sync_stage_row_from_segments(stage, _all_stage_segments(db, job_card.id, selected_stage))
        job_card.status = "IN_PROGRESS"
        job_card.current_stage = selected_stage
        _record_audit_event(
            db=db,
            plant_id=plant_uuid,
            entity_type="job_card_stage",
            entity_id=stage.id,
            action="draft_saved",
            actor_id=current_user.get("sub"),
            actor_role=actor_role,
            job_card_id=job_card.id,
            payload={
                "stage": selected_stage,
                "save_mode": save_mode,
                "location_id": str(stage.location_id) if stage.location_id else None,
            },
            before_payload=before_payload,
            after_payload={
                "status": stage.status,
                "machine_id": str(stage.machine_id) if stage.machine_id else None,
                "input_qty": stage.input_qty,
                "output_qty": stage.output_qty,
                "scrap_qty": stage.scrap_qty,
                "location_id": str(stage.location_id) if stage.location_id else None,
            },
        )
        db.commit()
        db.refresh(job_card)
        db.refresh(stage)
        return StageActionResponse(
            message="Stage draft saved",
            job_card_id=job_card.id,
            stage=selected_stage,
            segment_id=segment.id,
            job_card_status=job_card.status,
            current_stage=job_card.current_stage,
            save_mode=save_mode,
            stage_status=stage.status,
            remaining_open_segments=len(_open_stage_segments(db, job_card.id, selected_stage)),
            entry_saved=True,
            reel_issue_ids=[str(value) for value in (stage.reel_issue_ids or [])],
        )

    if payload.output_qty is None:
        raise HTTPException(status_code=400, detail="output_qty is required when save_mode is complete")
    if selected_stage == "DISPATCH":
        raise HTTPException(
            status_code=400,
            detail="Dispatch completion is sealed from the dispatch module so inventory and sales stay synchronized",
        )

    selected_index = routing_stages.index(selected_stage)
    prior_incomplete: list[str] = []
    for prior_stage in routing_stages[:selected_index]:
        prior_row = next((row for row in all_stage_rows if row.stage_type == prior_stage), None)
        if prior_row and prior_row.status != "COMPLETED":
            prior_incomplete.append(prior_stage)
    if prior_incomplete and not override_reason:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot complete {selected_stage} before {', '.join(prior_incomplete)}. Provide override_reason to continue.",
        )
    if selected_stage == "WINDER" and not (payload.reel_issue_ids or stage.reel_issue_ids or override_reason):
        raise HTTPException(
            status_code=409,
            detail="WINDER completion requires linked reel_issue_ids or an override_reason.",
        )
    _enforce_stage_quality_gate(
        db=db,
        plant_id=plant_uuid,
        job_card=job_card,
        selected_stage=selected_stage,
        quality_checks=payload.quality_checks or {},
        override_reason=override_reason,
    )
    _validate_stage_completion_payload(
        selected_stage=selected_stage,
        payload=payload,
        stage=stage,
    )
    if override_reason:
        stage.actuals_snapshot = {
            **(stage.actuals_snapshot or {}),
            "override_reason": override_reason,
            "override_stage": selected_stage,
            "override_ts": now.isoformat(),
        }

    machine_for_capacity: Optional[dict[str, Any]] = None
    if selected_stage in STAGE_TO_MACHINE_DEPARTMENT and selected_stage != "PACKING":
        effective_machine_id = payload.machine_id or segment.machine_id or stage.machine_id
        if effective_machine_id is None:
            raise HTTPException(
                status_code=400,
                detail=f"{selected_stage} stage requires machine selection at execution or planning time",
            )
        stage.machine_id = effective_machine_id
        segment.machine_id = effective_machine_id
        machine_for_capacity = _fetch_machine(effective_machine_id, token, plant_id)
        _validate_machine_compatibility(
            machine=machine_for_capacity,
            stage=selected_stage,
            spec_snapshot=job_card.spec_snapshot,
            plant_id=plant_id,
        )
        _validate_execution_capacity(
            db=db,
            stage_row=stage,
            stage=selected_stage,
            machine=machine_for_capacity,
            output_qty=float(payload.output_qty or 0.0),
            entry_snapshot=stage.entry_snapshot or {},
        )

    segment.started_at = segment.started_at or actual_start_value
    segment.completed_at = actual_end_value or now
    segment.input_qty = payload.input_qty if payload.input_qty is not None else segment.input_qty
    segment.output_qty = float(payload.output_qty or 0.0)
    segment.scrap_qty = float(payload.scrap_qty or 0.0)
    segment.status = "COMPLETED"
    if stage.input_qty is None and stage.actuals_snapshot.get("input_qty") is not None:
        try:
            stage.input_qty = float(stage.actuals_snapshot.get("input_qty"))
        except (TypeError, ValueError):
            pass
    _sync_stage_row_from_segments(stage, _all_stage_segments(db, job_card.id, selected_stage))

    quality_holds = _sync_quality_artifacts(
        db=db,
        plant_id=plant_uuid,
        job_card=job_card,
        stage=stage,
        selected_stage=selected_stage,
        current_user=current_user,
    )
    if quality_holds:
        stage.remarks = (
            f"{stage.remarks}\n" if stage.remarks else ""
        ) + "Progression blocked until active quality hold is released."
    packing_record = _sync_packing_record(
        db=db,
        plant_id=plant_uuid,
        job_card=job_card,
        stage=stage,
        current_user=current_user,
    )
    if selected_stage == FINAL_SPEC_QC_STAGE and packing_record is None:
        packing_record = db.query(PackingRecord).filter(PackingRecord.job_card_id == job_card.id).first()
    if selected_stage in {"PACKING", "QC"} and stage.status == "COMPLETED":
        _upsert_monthly_provisional_theory(
            db=db,
            job_card=job_card,
            selected_stage=selected_stage,
            token=token,
            plant_id=plant_id,
            current_user=current_user,
        )
    final_qc_ready = _final_spec_qc_passed(
        db=db,
        plant_id=plant_uuid,
        job_card=job_card,
        inline_quality_checks=stage.quality_checks or {},
    )
    if _stage_allows_fg_inward(selected_stage=selected_stage, final_qc_ready=final_qc_ready) and stage.status == "COMPLETED":
        fg_stage_for_posting = stage
        if selected_stage == FINAL_SPEC_QC_STAGE:
            fg_stage_for_posting = next((row for row in all_stage_rows if row.stage_type == "PACKING"), stage)
        fg_inward_result = _post_fg_inward_if_configured(
            job_card=job_card,
            final_stage_row=fg_stage_for_posting,
            packing_record=packing_record,
            token=token,
            plant_id=plant_id,
        )
        _apply_fg_inward_snapshot(packing_record, fg_inward_result)

    remaining_open_segments = len(_open_stage_segments(db, job_card.id, selected_stage))
    if remaining_open_segments == 0 and not quality_holds:
        next_stage = _next_stage(selected_stage, routing_stages)
        if next_stage != "DONE":
            next_stage_row = (
                db.query(JobCardStage)
                .filter(
                    JobCardStage.job_card_id == job_card.id,
                    JobCardStage.stage_type == next_stage,
                )
                .first()
            )
            if next_stage_row:
                next_stage_row.plan_date = next_stage_row.plan_date or stage.plan_date or _default_plan_date_from_snapshot(job_card.spec_snapshot or {})
                next_stage_row.shift_code = next_stage_row.shift_code or stage.shift_code or (
                    "SHIFT_A" if next_stage in {"QC", "DISPATCH"} else None
                )
                next_stage_row.required_capacity = _required_capacity_for_job(
                    stage=next_stage,
                    planned_qty=float(job_card.planned_qty or 0.0),
                    spec_snapshot=job_card.spec_snapshot or {},
                )
                if next_stage_row.input_qty is None:
                    next_stage_row.input_qty = float(stage.output_qty or 0.0)
                next_segments = _all_stage_segments(db, job_card.id, next_stage)
                if not next_segments:
                    _append_stage_segment(
                        db=db,
                        job_card=job_card,
                        stage_row=next_stage_row,
                        machine_id=next_stage_row.machine_id,
                        plan_date=next_stage_row.plan_date,
                        shift_code=next_stage_row.shift_code if next_stage_row.machine_id or next_stage in {"QC", "DISPATCH"} else None,
                        planned_qty=float(job_card.planned_qty or 0.0),
                        required_capacity=float(next_stage_row.required_capacity or 0.0),
                        split_source="NONE",
                        split_parent_segment_id=None,
                        status=_queue_status_for_stage(next_stage_row.machine_id),
                    )
                    next_segments = _all_stage_segments(db, job_card.id, next_stage)
                _sync_stage_row_from_segments(next_stage_row, next_segments)

    all_stages = (
        db.query(JobCardStage)
        .filter(JobCardStage.job_card_id == job_card.id)
        .all()
    )
    derived_stage, derived_status = _derive_job_current_stage_and_status(all_stages)
    job_card.current_stage = derived_stage
    job_card.status = derived_status
    if derived_status == "COMPLETED":
        sales_order = db.query(SalesOrder).filter(SalesOrder.id == job_card.sales_order_id).first()
        if sales_order:
            _update_sales_order_completion(db, sales_order)
        final_packing = next((row for row in all_stages if row.stage_type == "PACKING"), None)
        if (
            final_packing
            and final_packing.status == "COMPLETED"
            and packing_record
            and final_qc_ready
            and not (packing_record.snapshot or {}).get("inventory_transaction_id")
        ):
            fg_inward_result = _post_fg_inward_if_configured(
                job_card=job_card,
                final_stage_row=final_packing,
                packing_record=packing_record,
                token=token,
                plant_id=plant_id,
            )
            _apply_fg_inward_snapshot(packing_record, fg_inward_result)

    _record_audit_event(
        db=db,
        plant_id=plant_uuid,
        entity_type="job_card_stage",
        entity_id=stage.id,
        action="completed" if save_mode == "complete" else "draft_saved",
        actor_id=current_user.get("sub"),
        actor_role=actor_role,
        job_card_id=job_card.id,
        payload={
            "stage": selected_stage,
            "save_mode": save_mode,
            "quality_hold_ids": [str(hold.id) for hold in quality_holds],
            "location_id": str(stage.location_id) if stage.location_id else None,
            "packing_record_id": str(packing_record.id) if packing_record else None,
            "override_reason": override_reason,
            "prior_incomplete": prior_incomplete,
        },
        before_payload=before_payload,
        after_payload={
            "status": stage.status,
            "machine_id": str(stage.machine_id) if stage.machine_id else None,
            "input_qty": stage.input_qty,
            "output_qty": stage.output_qty,
            "scrap_qty": stage.scrap_qty,
            "location_id": str(stage.location_id) if stage.location_id else None,
        },
    )

    db.commit()
    db.refresh(job_card)
    return StageActionResponse(
        message="Stage output captured with supervisor override" if override_reason else "Stage output captured",
        job_card_id=job_card.id,
        stage=selected_stage,
        segment_id=segment.id,
        job_card_status=job_card.status,
        current_stage=job_card.current_stage,
        save_mode=save_mode,
        stage_status=stage.status,
        remaining_open_segments=remaining_open_segments,
        entry_saved=True,
        override_used=bool(override_reason),
        override_reason=override_reason,
        reel_issue_ids=[str(value) for value in (stage.reel_issue_ids or [])],
        quality_hold_ids=[str(hold.id) for hold in quality_holds],
    )
