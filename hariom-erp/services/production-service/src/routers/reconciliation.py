from __future__ import annotations

from datetime import date, datetime
from statistics import pstdev
from typing import Any, Optional
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import (
    JobCard,
    JobCardStage,
    MonthlyMaterialActual,
    MonthlyMaterialClose,
    MonthlyMaterialProvisional,
    PackingRecord,
    PLANT_A_UUID,
    PLANT_B_UUID,
    QualityHold,
    ShiftMaterialLedger,
)
from ..utils.auth import get_current_plant_scope, get_current_user, require_role

router = APIRouter(prefix="/reconciliation", tags=["reconciliation"])
settings = get_settings()
PAPER_EXPECTED_CONSUMPTION_FACTOR = 1.07
PAPER_STANDARD_WASTAGE_PERCENT = 7.0


class ShiftMaterialLedgerPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage_type: str
    work_date: date
    shift_code: str
    issue_section: Optional[str] = None
    machine_id: Optional[uuid.UUID] = None
    reel_issue_ids: list[str] = Field(default_factory=list)
    parent_reel_id: Optional[str] = None
    child_reel_ids: list[str] = Field(default_factory=list)
    issued_weight_kg: float = Field(default=0.0, ge=0)
    consumed_weight_kg: float = Field(default=0.0, ge=0)
    slit_output_weight_kg: float = Field(default=0.0, ge=0)
    wastage_weight_kg: float = Field(default=0.0, ge=0)
    remaining_weight_kg: float = Field(default=0.0, ge=0)
    actual_job_card_ids: list[uuid.UUID] = Field(default_factory=list)
    transfer_snapshot: dict[str, Any] = Field(default_factory=dict)
    notes: Optional[str] = None


class AdvisoryAllocationRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_card_id: uuid.UUID
    sales_order_line_id: Optional[uuid.UUID] = None
    theoretical_qty: float
    allocation_share: float
    allocated_consumed_weight_kg: float
    allocated_wastage_weight_kg: float
    advisory_only: bool = True


class ShiftMaterialLedgerResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    plant_id: uuid.UUID
    stage_type: str
    work_date: date
    shift_code: str
    issue_section: Optional[str] = None
    machine_id: Optional[uuid.UUID] = None
    reel_issue_ids: list[str] = Field(default_factory=list)
    parent_reel_id: Optional[str] = None
    child_reel_ids: list[str] = Field(default_factory=list)
    issued_weight_kg: float
    consumed_weight_kg: float
    slit_output_weight_kg: float
    wastage_weight_kg: float
    remaining_weight_kg: float
    actual_job_card_ids: list[uuid.UUID] = Field(default_factory=list)
    transfer_snapshot: dict[str, Any] = Field(default_factory=dict)
    notes: Optional[str] = None
    advisory_allocations: list[AdvisoryAllocationRow] = Field(default_factory=list)
    created_by: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ShiftRetallyResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage_type: Optional[str] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    ledger_rows: int
    issued_weight_kg: float
    consumed_weight_kg: float
    slit_output_weight_kg: float
    wastage_weight_kg: float
    remaining_weight_kg: float
    advisory_allocated_consumed_weight_kg: float
    advisory_allocated_wastage_weight_kg: float


class MonthlyActualImportRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_code: str
    item_name: Optional[str] = None
    actual_consumed_weight_kg: float = Field(ge=0)
    actual_cost: float = Field(default=0.0, ge=0)
    notes: Optional[str] = None


class MonthlyActualImportPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    month: str
    rows: list[MonthlyActualImportRow] = Field(default_factory=list)


class MonthlyMaterialActualRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_code: str
    item_name: Optional[str] = None
    item_type: Optional[str] = None
    item_uom: Optional[str] = None
    unit_cost: float
    exact_output_paper_kg: Optional[float] = None
    standard_wastage_kg: Optional[float] = None
    expected_consumption_factor: float = 1.0
    theoretical_consumption_kg: float
    provisional_theory_consumption_kg: float
    actual_consumption_kg: float
    actual_month_end_consumption_kg: float
    variance_kg: float
    variance_percent: float
    theoretical_cost: float
    actual_cost: float
    variance_cost: float
    advisory_allocated_order_qty: float


class MonthlyMaterialSummaryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    month_start: date
    scope_all: bool
    plant_count: int
    total_theoretical_consumption_kg: float
    total_provisional_theory_consumption_kg: float
    total_actual_consumption_kg: float
    total_actual_month_end_consumption_kg: float
    total_variance_kg: float
    total_variance_adjustment_kg: float
    total_theoretical_cost: float
    total_actual_cost: float
    total_variance_cost: float
    rows: list[MonthlyMaterialActualRow] = Field(default_factory=list)


class MonthlyCloseApprovePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    month: str
    notes: Optional[str] = None


class MonthlyCloseStateResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    month_start: date
    scope_all: bool
    plant_count: int
    selected_plant_id: Optional[str] = None
    status: str
    import_batch_id: Optional[uuid.UUID] = None
    imported_rows_count: int = 0
    approved_by: Optional[str] = None
    approved_at: Optional[str] = None
    locked_at: Optional[str] = None
    notes: Optional[str] = None


class MonthlyCloseHistoryRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    plant_id: str
    month_start: date
    status: str
    imported_rows_count: int = 0
    approved_by: Optional[str] = None
    approved_at: Optional[str] = None
    locked_at: Optional[str] = None
    notes: Optional[str] = None


class MonthlyCloseHistoryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope_all: bool
    rows: list[MonthlyCloseHistoryRow] = Field(default_factory=list)


class WinderShiftReconciliationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    plant_id: str
    winder_machine_id: uuid.UUID
    shift: str
    date: date
    issued_weight: float
    fg_weight: float
    scrap_weight: float
    loss_weight: float
    loss_percentage: float
    alert_flag: bool
    alert_threshold_percent: float
    advisory_only: bool


class LossBucketsResponse(BaseModel):
    EXPECTED_SHRINKAGE: float
    PROCESS_LOSS: float
    OPERATOR_VARIANCE: float
    REEL_QUALITY_VARIANCE: float
    UNEXPLAINED: float


class JobCardLossBreakupResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_card_id: uuid.UUID
    plant_id: uuid.UUID
    issued_weight: float
    consumed_weight: float
    expected_consumption: float
    fg_weight: float
    scrap_weight: float
    total_loss_weight: float
    buckets: LossBucketsResponse
    heuristic_notes: list[str]
    inputs_missing: list[str]
    advisory_only: bool


def _apply_scope(query, model, plant_scope: dict):
    if plant_scope.get("scope_all"):
        allowed = plant_scope.get("allowed_plants") or []
        if allowed:
            return query.filter(model.plant_id.in_(allowed))
        return query
    return query.filter(model.plant_id == plant_scope["selected_plant_id"])


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


def _normalize_stage(stage_type: str) -> str:
    normalized = str(stage_type or "").strip().upper()
    if normalized not in {"SLITTING", "WINDER", "OVEN", "PROCESS"}:
        raise HTTPException(status_code=400, detail="stage_type must be one of SLITTING, WINDER, OVEN, PROCESS")
    return normalized


def _default_issue_section(stage_type: str) -> Optional[str]:
    mapping = {
        "SLITTING": "SLITTING_SECTION",
        "WINDER": "WINDER_SECTION",
        "OVEN": "OVEN_TRANSFER",
        "PROCESS": "PROCESS_TRANSFER",
    }
    return mapping.get(stage_type)


def _normalize_shift(shift_code: str) -> str:
    normalized = str(shift_code or "").strip().upper()
    if normalized not in {"SHIFT_A", "SHIFT_B"}:
        raise HTTPException(status_code=400, detail="shift_code must be one of SHIFT_A, SHIFT_B")
    return normalized


def _parse_month_start(month_value: str) -> date:
    text = str(month_value or "").strip()
    for fmt in ("%Y-%m", "%Y-%m-%d"):
        try:
            parsed = datetime.strptime(text, fmt)
            return date(parsed.year, parsed.month, 1)
        except ValueError:
            continue
    raise HTTPException(status_code=400, detail="month must be in YYYY-MM or YYYY-MM-DD format")


def _next_month(month_start: date) -> date:
    if month_start.month == 12:
        return date(month_start.year + 1, 1, 1)
    return date(month_start.year, month_start.month + 1, 1)


def _fetch_paper_catalog(token: str, plant_id: str) -> dict[str, dict[str, Any]]:
    with httpx.Client(timeout=15.0) as client:
        response = client.get(
            f"{settings.MASTERDATA_SERVICE_URL}/master/papers/",
            headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
        )
    if response.status_code != 200:
        return {}
    rows = response.json() or []
    catalog: dict[str, dict[str, Any]] = {}
    for row in rows:
        catalog[str(row.get("id") or "")] = row
    return catalog


def _fetch_inventory_item_catalog(token: str, plant_id: str) -> dict[str, dict[str, Any]]:
    with httpx.Client(timeout=15.0) as client:
        response = client.get(
            f"{settings.INVENTORY_SERVICE_URL}/items/",
            headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
        )
    if response.status_code != 200:
        return {}
    rows = response.json() or []
    catalog: dict[str, dict[str, Any]] = {}
    for row in rows:
        code = str(row.get("item_code") or "").strip().upper()
        if not code:
            continue
        catalog[code] = row
    return catalog


def _paper_catalog_codes(paper_catalog: dict[str, dict[str, Any]]) -> set[str]:
    codes: set[str] = set()
    for paper_id, row in (paper_catalog or {}).items():
        for value in (paper_id, row.get("code")):
            code = str(value or "").strip().upper()
            if code:
                codes.add(code)
    return codes


def _is_raw_paper_item(item_code: str, item_name: Optional[str], inventory_item: dict[str, Any], paper_codes: set[str]) -> bool:
    item_type = str(inventory_item.get("type") or "").strip().upper()
    code = str(item_code or "").strip().upper()
    name = str(item_name or inventory_item.get("name") or "").strip().upper()
    return item_type == "RAW_PAPER" or code in paper_codes or code.startswith("KRAFT") or "PAPER" in name


def _job_card_activity_date(job_card: JobCard) -> date:
    candidates: list[datetime] = []
    if getattr(job_card, "created_at", None):
        candidates.append(job_card.created_at)
    packing_record = getattr(job_card, "packing_record", None)
    if packing_record and getattr(packing_record, "updated_at", None):
        candidates.append(packing_record.updated_at)
    for stage_row in getattr(job_card, "stages", []) or []:
        for value in [stage_row.actual_end, stage_row.entered_at, stage_row.actual_start, stage_row.created_at]:
            if value:
                candidates.append(value)
    if not candidates:
        return date.today()
    return max(candidates).date()


def _job_card_produced_qty(job_card: JobCard) -> float:
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
    if best_qty > 0:
        return best_qty
    return float(getattr(job_card, "planned_qty", 0.0) or 0.0) if str(getattr(job_card, "status", "")).upper() == "COMPLETED" else 0.0


def _provisional_material_rows(
    job_card: JobCard,
    paper_catalog: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    material_snapshot = dict(getattr(job_card, "material_plan_snapshot", {}) or {})
    bom_snapshot = dict(material_snapshot.get("bom_snapshot") or material_snapshot.get("theoretical_consumption") or {})
    paper_rows = list((((bom_snapshot.get("raw_materials") or {}).get("papers")) or []))
    if not paper_rows:
        return []

    planned_output_qty = float(material_snapshot.get("planned_output_qty") or getattr(job_card, "planned_qty", 0.0) or 0.0)
    produced_qty = _job_card_produced_qty(job_card)
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

    advisory_allocated_order_qty = produced_qty
    rows: list[dict[str, Any]] = []
    for paper_row in paper_rows:
        paper_id = str(paper_row.get("paper_id") or "")
        catalog_row = paper_catalog.get(paper_id, {})
        code = str(catalog_row.get("code") or paper_id or "UNKNOWN").strip().upper()
        if not code:
            code = "UNKNOWN"
        name_parts = [
            str(catalog_row.get("variety") or "").strip(),
            f"GSM {catalog_row.get('gsm')}" if catalog_row.get("gsm") is not None else "",
        ]
        item_name = " · ".join([part for part in name_parts if part]) or None
        theoretical_kg = float(paper_row.get("weight_kg") or 0.0) * provisional_bamboo_count
        rows.append(
            {
                "item_code": code,
                "item_name": item_name,
                "theoretical_consumption_kg": round(theoretical_kg, 6),
                "advisory_allocated_order_qty": round(advisory_allocated_order_qty, 4),
            }
        )
    return rows


def _calculate_reconciliation(
    issued_weight: float,
    fg_weight: float,
    scrap_weight: float,
    alert_threshold_percent: float,
) -> dict[str, Any]:
    safe_issued = max(0.0, float(issued_weight or 0.0))
    safe_fg = max(0.0, float(fg_weight or 0.0))
    safe_scrap = max(0.0, float(scrap_weight or 0.0))
    loss_weight = max(0.0, safe_issued - (safe_fg + safe_scrap))
    loss_percentage = (loss_weight / safe_issued * 100.0) if safe_issued > 0 else 0.0
    return {
        "issued_weight": round(safe_issued, 4),
        "fg_weight": round(safe_fg, 4),
        "scrap_weight": round(safe_scrap, 4),
        "loss_weight": round(loss_weight, 4),
        "loss_percentage": round(loss_percentage, 4),
        "alert_flag": loss_percentage > float(alert_threshold_percent or 0.0),
    }


def _classify_loss_buckets(
    consumed_weight: float,
    fg_weight: float,
    scrap_weight: float,
    shrink_ratio: Optional[float],
    quality_factor: float,
) -> dict[str, float]:
    total_loss = max(0.0, float(consumed_weight or 0.0) - (float(fg_weight or 0.0) + float(scrap_weight or 0.0)))
    remaining = total_loss

    expected_shrinkage = 0.0
    if shrink_ratio is not None:
        expected_shrinkage = min(remaining, max(0.0, float(consumed_weight or 0.0) * max(0.0, float(shrink_ratio))))
        remaining -= expected_shrinkage

    operator_variance_cap = max(0.0, float(consumed_weight or 0.0) * 0.01)
    operator_variance = min(remaining, operator_variance_cap)
    remaining -= operator_variance

    process_loss_cap = max(0.0, float(scrap_weight or 0.0) * 0.20)
    process_loss = min(remaining, process_loss_cap)
    remaining -= process_loss

    reel_quality_variance = min(remaining, total_loss * max(0.0, float(quality_factor or 0.0)))
    remaining -= reel_quality_variance

    unexplained = max(0.0, remaining)
    return {
        "EXPECTED_SHRINKAGE": round(expected_shrinkage, 4),
        "PROCESS_LOSS": round(process_loss, 4),
        "OPERATOR_VARIANCE": round(operator_variance, 4),
        "REEL_QUALITY_VARIANCE": round(reel_quality_variance, 4),
        "UNEXPLAINED": round(unexplained, 4),
    }


def _fetch_reel_issues(
    token: str,
    plant_selector: str,
    winder_machine_id: uuid.UUID,
    shift: str,
    issue_date: date,
) -> list[dict[str, Any]]:
    with httpx.Client(timeout=15.0) as client:
        response = client.get(
            f"{settings.INVENTORY_SERVICE_URL}/reel-issues",
            params={
                "plant_id": plant_selector,
                "winder_machine_id": str(winder_machine_id),
                "shift": shift,
                "issue_date": issue_date.isoformat(),
            },
            headers={
                "Authorization": f"Bearer {token}",
                "X-Plant-ID": plant_selector,
            },
        )
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="Unable to fetch reel issues for reconciliation")
    data = response.json()
    if not isinstance(data, list):
        raise HTTPException(status_code=502, detail="Invalid reel issue response")
    return data


def _fetch_reel_issues_by_ids(token: str, plant_id: str, issue_ids: list[str]) -> list[dict[str, Any]]:
    if not issue_ids:
        return []
    with httpx.Client(timeout=15.0) as client:
        response = client.get(
            f"{settings.INVENTORY_SERVICE_URL}/reel-issues",
            params={"plant_id": plant_id, "issue_ids": ",".join(issue_ids)},
            headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
        )
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="Unable to fetch linked reel issues")
    data = response.json()
    if not isinstance(data, list):
        raise HTTPException(status_code=502, detail="Invalid linked reel issue response")
    return data


def _fetch_reels_by_ids(token: str, plant_id: str, reel_ids: list[str]) -> list[dict[str, Any]]:
    if not reel_ids:
        return []
    with httpx.Client(timeout=15.0) as client:
        response = client.get(
            f"{settings.INVENTORY_SERVICE_URL}/reels",
            params={"plant_id": plant_id, "reel_ids": ",".join(reel_ids)},
            headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
        )
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="Unable to fetch linked reels")
    data = response.json()
    if not isinstance(data, list):
        raise HTTPException(status_code=502, detail="Invalid linked reel response")
    return data


def _fetch_recipe_shrink_ratio(token: str, plant_id: str, spec_id: uuid.UUID) -> Optional[float]:
    try:
        with httpx.Client(timeout=15.0) as client:
            recipe_response = client.get(
                f"{settings.SPEC_SERVICE_URL}/recipes/spec/{spec_id}",
                params={"status": "approved"},
                headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
            )
    except httpx.HTTPError:
        return None
    if recipe_response.status_code != 200:
        return None
    recipes = recipe_response.json()
    if not isinstance(recipes, list) or not recipes:
        return None
    recipe_id = recipes[0].get("id")
    if not recipe_id:
        return None

    try:
        with httpx.Client(timeout=15.0) as client:
            weight_response = client.get(
                f"{settings.SPEC_SERVICE_URL}/calculate/weight/{recipe_id}",
                headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
            )
    except httpx.HTTPError:
        return None
    if weight_response.status_code != 200:
        return None
    payload = weight_response.json()
    try:
        wet_weight = float(payload.get("wet_weight_kg"))
        dry_weight = float(payload.get("dry_weight_kg"))
    except (TypeError, ValueError):
        return None
    if wet_weight <= 0:
        return None
    return max(0.0, min(1.0, (wet_weight - dry_weight) / wet_weight))


def _quality_variation_factor(reels: list[dict[str, Any]]) -> float:
    gsms = [float(row["gsm"]) for row in reels if row.get("gsm") is not None]
    bfs = [float(row["bf"]) for row in reels if row.get("bf") is not None]
    if len(gsms) < 2 and len(bfs) < 2:
        return 0.0

    gsm_cv = 0.0
    bf_cv = 0.0
    if len(gsms) >= 2:
        gsm_avg = sum(gsms) / len(gsms)
        if gsm_avg > 0:
            gsm_cv = pstdev(gsms) / gsm_avg
    if len(bfs) >= 2:
        bf_avg = sum(bfs) / len(bfs)
        if bf_avg > 0:
            bf_cv = pstdev(bfs) / bf_avg
    return max(0.0, min(0.25, gsm_cv + bf_cv))


def _matching_stage_rows(db: Session, ledger: ShiftMaterialLedger):
    if ledger.stage_type not in {"SLITTING", "WINDER"}:
        return []
    query = (
        db.query(JobCardStage, JobCard)
        .join(JobCard, JobCard.id == JobCardStage.job_card_id)
        .filter(
            JobCardStage.stage_type == ledger.stage_type,
            JobCardStage.status == "COMPLETED",
            JobCardStage.plan_date == ledger.work_date,
            JobCardStage.shift_code == ledger.shift_code,
        )
    )
    if ledger.machine_id:
        query = query.filter(JobCardStage.machine_id == ledger.machine_id)
    if ledger.actual_job_card_ids:
        query = query.filter(JobCard.id.in_(ledger.actual_job_card_ids))
    return query.all()


def _stage_theoretical_qty(stage_row: JobCardStage, job_card: JobCard) -> float:
    material_plan = dict(job_card.material_plan_snapshot or {})
    if material_plan.get("planned_output_qty") is not None:
        try:
            return max(0.0, float(material_plan["planned_output_qty"]))
        except (TypeError, ValueError):
            pass
    for value in (stage_row.input_qty, stage_row.output_qty, job_card.planned_qty):
        try:
            numeric = float(value or 0.0)
        except (TypeError, ValueError):
            continue
        if numeric > 0:
            return numeric
    return 0.0


def _build_advisory_allocations(db: Session, ledger: ShiftMaterialLedger) -> list[dict[str, Any]]:
    stage_rows = _matching_stage_rows(db, ledger)
    weighted_rows: list[tuple[JobCardStage, JobCard, float]] = []
    for stage_row, job_card in stage_rows:
        theoretical_qty = _stage_theoretical_qty(stage_row, job_card)
        if theoretical_qty <= 0:
            continue
        weighted_rows.append((stage_row, job_card, theoretical_qty))
    total_theoretical = sum(row[2] for row in weighted_rows)
    if total_theoretical <= 0:
        return []

    advisory_rows: list[dict[str, Any]] = []
    for _stage_row, job_card, theoretical_qty in weighted_rows:
        share = theoretical_qty / total_theoretical
        advisory_rows.append(
            {
                "job_card_id": job_card.id,
                "sales_order_line_id": job_card.sales_order_line_id,
                "theoretical_qty": round(theoretical_qty, 4),
                "allocation_share": round(share, 6),
                "allocated_consumed_weight_kg": round(float(ledger.consumed_weight_kg or 0.0) * share, 4),
                "allocated_wastage_weight_kg": round(float(ledger.wastage_weight_kg or 0.0) * share, 4),
                "advisory_only": True,
            }
        )
    return advisory_rows


def _serialize_shift_ledger(db: Session, ledger: ShiftMaterialLedger) -> dict[str, Any]:
    return {
        "id": ledger.id,
        "plant_id": ledger.plant_id,
        "stage_type": ledger.stage_type,
        "work_date": ledger.work_date,
        "shift_code": ledger.shift_code,
        "issue_section": ledger.issue_section,
        "machine_id": ledger.machine_id,
        "reel_issue_ids": list(ledger.reel_issue_ids or []),
        "parent_reel_id": ledger.parent_reel_id,
        "child_reel_ids": list(ledger.child_reel_ids or []),
        "issued_weight_kg": float(ledger.issued_weight_kg or 0.0),
        "consumed_weight_kg": float(ledger.consumed_weight_kg or 0.0),
        "slit_output_weight_kg": float(ledger.slit_output_weight_kg or 0.0),
        "wastage_weight_kg": float(ledger.wastage_weight_kg or 0.0),
        "remaining_weight_kg": float(ledger.remaining_weight_kg or 0.0),
        "actual_job_card_ids": list(ledger.actual_job_card_ids or []),
        "transfer_snapshot": dict(ledger.transfer_snapshot or {}),
        "notes": ledger.notes,
        "advisory_allocations": _build_advisory_allocations(db, ledger),
        "created_by": ledger.created_by,
        "created_at": ledger.created_at.isoformat() if ledger.created_at else None,
        "updated_at": ledger.updated_at.isoformat() if ledger.updated_at else None,
    }


def _month_scope_job_cards(db: Session, plant_scope: dict, month_start: date, month_end: date) -> list[JobCard]:
    query = _apply_scope(db.query(JobCard), JobCard, plant_scope)
    rows = query.all()
    return [row for row in rows if month_start <= _job_card_activity_date(row) < month_end]


def _build_monthly_material_summary(
    *,
    db: Session,
    plant_scope: dict,
    current_user: dict,
    month_start: date,
) -> MonthlyMaterialSummaryResponse:
    month_end = _next_month(month_start)
    machine_scope_plant = "ALL" if plant_scope.get("scope_all") else str(plant_scope["selected_plant_id"])
    paper_catalog = _fetch_paper_catalog(current_user.get("token", ""), machine_scope_plant)
    paper_codes = _paper_catalog_codes(paper_catalog)
    inventory_catalog = _fetch_inventory_item_catalog(current_user.get("token", ""), machine_scope_plant)

    provisional_query = _apply_scope(db.query(MonthlyMaterialProvisional), MonthlyMaterialProvisional, plant_scope).filter(
        MonthlyMaterialProvisional.month_start == month_start
    )
    provisional_map: dict[str, dict[str, float | str | None]] = {}
    for row in provisional_query.all():
        item_code = str(row.item_code or "").strip().upper()
        bucket = provisional_map.setdefault(
            item_code,
            {
                "item_code": item_code,
                "item_name": row.item_name,
                "theoretical_consumption_kg": 0.0,
                "advisory_allocated_order_qty": 0.0,
            },
        )
        bucket["theoretical_consumption_kg"] = float(bucket["theoretical_consumption_kg"] or 0.0) + float(row.provisional_theory_consumption_kg or 0.0)
        bucket["advisory_allocated_order_qty"] = float(bucket["advisory_allocated_order_qty"] or 0.0) + float(row.advisory_allocated_order_qty or 0.0)
        if not bucket.get("item_name") and row.item_name:
            bucket["item_name"] = row.item_name

    actual_query = _apply_scope(db.query(MonthlyMaterialActual), MonthlyMaterialActual, plant_scope).filter(
        MonthlyMaterialActual.month_start == month_start
    )
    actual_map: dict[str, dict[str, Any]] = {}
    for row in actual_query.all():
        bucket = actual_map.setdefault(
            str(row.item_code).strip().upper(),
            {
                "item_code": str(row.item_code).strip().upper(),
                "item_name": row.item_name,
                "actual_consumption_kg": 0.0,
                "actual_cost": 0.0,
            },
        )
        bucket["actual_consumption_kg"] += float(row.actual_consumed_weight_kg or 0.0)
        bucket["actual_cost"] += float(getattr(row, "actual_cost", 0.0) or 0.0)
        if not bucket.get("item_name") and row.item_name:
            bucket["item_name"] = row.item_name

    inventory_item_codes = {
        code
        for code, item in inventory_catalog.items()
        if str(item.get("type") or "").strip().upper() != "FINISHED_GOOD"
    }
    item_codes = sorted(set(provisional_map.keys()) | set(actual_map.keys()) | inventory_item_codes)
    rows: list[MonthlyMaterialActualRow] = []
    total_theoretical = 0.0
    total_provisional_theory = 0.0
    total_actual = 0.0
    total_theoretical_cost = 0.0
    total_actual_cost = 0.0
    for item_code in item_codes:
        provisional = provisional_map.get(item_code, {})
        actual = actual_map.get(item_code, {})
        inventory_item = inventory_catalog.get(item_code, {})
        exact_theory_kg = float(provisional.get("theoretical_consumption_kg") or 0.0)
        row_name = actual.get("item_name") or provisional.get("item_name") or inventory_item.get("name")
        is_paper = _is_raw_paper_item(item_code, str(row_name or ""), inventory_item, paper_codes)
        expected_factor = PAPER_EXPECTED_CONSUMPTION_FACTOR if is_paper and exact_theory_kg > 0 else 1.0
        theoretical_kg = round(exact_theory_kg * expected_factor, 6)
        standard_wastage_kg = round(theoretical_kg - exact_theory_kg, 6) if is_paper and exact_theory_kg > 0 else None
        actual_kg = float(actual.get("actual_consumption_kg") or 0.0)
        unit_cost = float(inventory_item.get("unit_cost") or 0.0)
        theoretical_cost = theoretical_kg * unit_cost
        actual_cost = float(actual.get("actual_cost") or 0.0)
        variance_kg = round(actual_kg - theoretical_kg, 4)
        variance_cost = round(actual_cost - theoretical_cost, 4)
        variance_percent = round((variance_kg / theoretical_kg) * 100.0, 2) if theoretical_kg > 0 else (0.0 if actual_kg == 0 else 100.0)
        total_theoretical += theoretical_kg
        total_provisional_theory += exact_theory_kg
        total_actual += actual_kg
        total_theoretical_cost += theoretical_cost
        total_actual_cost += actual_cost
        rows.append(
            MonthlyMaterialActualRow(
                item_code=item_code,
                item_name=row_name,
                item_type=str(inventory_item.get("type") or "").strip().upper() or None,
                item_uom=str(inventory_item.get("uom") or "").strip().upper() or None,
                unit_cost=round(unit_cost, 4),
                exact_output_paper_kg=round(exact_theory_kg, 4) if is_paper and exact_theory_kg > 0 else None,
                standard_wastage_kg=round(standard_wastage_kg, 4) if standard_wastage_kg is not None else None,
                expected_consumption_factor=round(expected_factor, 4),
                theoretical_consumption_kg=round(theoretical_kg, 4),
                provisional_theory_consumption_kg=round(exact_theory_kg, 4),
                actual_consumption_kg=round(actual_kg, 4),
                actual_month_end_consumption_kg=round(actual_kg, 4),
                variance_kg=variance_kg,
                variance_percent=variance_percent,
                theoretical_cost=round(theoretical_cost, 2),
                actual_cost=round(actual_cost, 2),
                variance_cost=variance_cost,
                advisory_allocated_order_qty=round(float(provisional.get("advisory_allocated_order_qty") or 0.0), 4),
            )
        )

    allowed_plants = plant_scope.get("allowed_plants") or []
    plant_count = len(allowed_plants) if plant_scope.get("scope_all") else (1 if plant_scope.get("selected_plant_id") else 0)
    return MonthlyMaterialSummaryResponse(
        month_start=month_start,
        scope_all=bool(plant_scope.get("scope_all")),
        plant_count=plant_count,
        total_theoretical_consumption_kg=round(total_theoretical, 4),
        total_provisional_theory_consumption_kg=round(total_provisional_theory, 4),
        total_actual_consumption_kg=round(total_actual, 4),
        total_actual_month_end_consumption_kg=round(total_actual, 4),
        total_variance_kg=round(total_actual - total_theoretical, 4),
        total_variance_adjustment_kg=round(total_actual - total_theoretical, 4),
        total_theoretical_cost=round(total_theoretical_cost, 2),
        total_actual_cost=round(total_actual_cost, 2),
        total_variance_cost=round(total_actual_cost - total_theoretical_cost, 2),
        rows=rows,
    )


def _serialize_monthly_close_state(
    *,
    close_row: Optional[MonthlyMaterialClose],
    month_start: date,
    plant_scope: dict,
) -> MonthlyCloseStateResponse:
    allowed_plants = plant_scope.get("allowed_plants") or []
    plant_count = len(allowed_plants) if plant_scope.get("scope_all") else (1 if plant_scope.get("selected_plant_id") else 0)
    if close_row is None:
        return MonthlyCloseStateResponse(
            month_start=month_start,
            scope_all=bool(plant_scope.get("scope_all")),
            plant_count=plant_count,
            selected_plant_id=None if plant_scope.get("scope_all") else str(plant_scope.get("selected_plant_id") or ""),
            status="READ_ONLY_ALL" if plant_scope.get("scope_all") else "DRAFT",
        )

    return MonthlyCloseStateResponse(
        month_start=month_start,
        scope_all=bool(plant_scope.get("scope_all")),
        plant_count=plant_count,
        selected_plant_id=None if plant_scope.get("scope_all") else str(close_row.plant_id),
        status=close_row.status,
        import_batch_id=close_row.import_batch_id,
        imported_rows_count=int(close_row.imported_rows_count or 0),
        approved_by=close_row.approved_by,
        approved_at=close_row.approved_at.isoformat() if close_row.approved_at else None,
        locked_at=close_row.locked_at.isoformat() if close_row.locked_at else None,
        notes=close_row.notes,
    )


@router.post("/shift-ledger", response_model=ShiftMaterialLedgerResponse)
def create_shift_material_ledger(
    payload: ShiftMaterialLedgerPayload,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["PlantManager", "Planner", "Store"])),
):
    if plant_scope.get("scope_all"):
        raise HTTPException(status_code=400, detail="Shift ledger writes require a selected plant")
    stage_type = _normalize_stage(payload.stage_type)
    shift_code = _normalize_shift(payload.shift_code)
    row = ShiftMaterialLedger(
        plant_id=_to_uuid(plant_scope["selected_plant_id"]),
        stage_type=stage_type,
        work_date=payload.work_date,
        shift_code=shift_code,
        issue_section=payload.issue_section or _default_issue_section(stage_type),
        machine_id=payload.machine_id,
        reel_issue_ids=list(payload.reel_issue_ids or []),
        parent_reel_id=payload.parent_reel_id,
        child_reel_ids=list(payload.child_reel_ids or []),
        issued_weight_kg=payload.issued_weight_kg,
        consumed_weight_kg=payload.consumed_weight_kg,
        slit_output_weight_kg=payload.slit_output_weight_kg,
        wastage_weight_kg=payload.wastage_weight_kg,
        remaining_weight_kg=payload.remaining_weight_kg,
        actual_job_card_ids=[str(uuid.UUID(str(value))) for value in (payload.actual_job_card_ids or [])],
        transfer_snapshot=dict(payload.transfer_snapshot or {}),
        notes=payload.notes,
        created_by=current_user.get("sub"),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize_shift_ledger(db, row)


@router.get("/shift-ledger", response_model=list[ShiftMaterialLedgerResponse])
def list_shift_material_ledger(
    stage_type: Optional[str] = Query(None),
    work_date: Optional[date] = Query(None),
    shift_code: Optional[str] = Query(None),
    issue_section: Optional[str] = Query(None),
    machine_id: Optional[uuid.UUID] = Query(None),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    query = _apply_scope(db.query(ShiftMaterialLedger), ShiftMaterialLedger, plant_scope)
    if stage_type:
        query = query.filter(ShiftMaterialLedger.stage_type == _normalize_stage(stage_type))
    if work_date:
        query = query.filter(ShiftMaterialLedger.work_date == work_date)
    if shift_code:
        query = query.filter(ShiftMaterialLedger.shift_code == _normalize_shift(shift_code))
    if issue_section:
        query = query.filter(ShiftMaterialLedger.issue_section == str(issue_section).strip().upper())
    if machine_id:
        query = query.filter(ShiftMaterialLedger.machine_id == machine_id)
    rows = query.order_by(ShiftMaterialLedger.work_date.desc(), ShiftMaterialLedger.created_at.desc()).all()
    return [_serialize_shift_ledger(db, row) for row in rows]


@router.get("/shift-ledger/retally", response_model=ShiftRetallyResponse)
def retally_shift_material_ledger(
    stage_type: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    query = _apply_scope(db.query(ShiftMaterialLedger), ShiftMaterialLedger, plant_scope)
    normalized_stage = _normalize_stage(stage_type) if stage_type else None
    if normalized_stage:
        query = query.filter(ShiftMaterialLedger.stage_type == normalized_stage)
    if date_from:
        query = query.filter(ShiftMaterialLedger.work_date >= date_from)
    if date_to:
        query = query.filter(ShiftMaterialLedger.work_date <= date_to)

    rows = query.all()
    advisory_allocations = []
    for row in rows:
        advisory_allocations.extend(_build_advisory_allocations(db, row))

    return ShiftRetallyResponse(
        stage_type=normalized_stage,
        date_from=date_from,
        date_to=date_to,
        ledger_rows=len(rows),
        issued_weight_kg=round(sum(float(row.issued_weight_kg or 0.0) for row in rows), 4),
        consumed_weight_kg=round(sum(float(row.consumed_weight_kg or 0.0) for row in rows), 4),
        slit_output_weight_kg=round(sum(float(row.slit_output_weight_kg or 0.0) for row in rows), 4),
        wastage_weight_kg=round(sum(float(row.wastage_weight_kg or 0.0) for row in rows), 4),
        remaining_weight_kg=round(sum(float(row.remaining_weight_kg or 0.0) for row in rows), 4),
        advisory_allocated_consumed_weight_kg=round(
            sum(float(row.get("allocated_consumed_weight_kg") or 0.0) for row in advisory_allocations),
            4,
        ),
        advisory_allocated_wastage_weight_kg=round(
            sum(float(row.get("allocated_wastage_weight_kg") or 0.0) for row in advisory_allocations),
            4,
        ),
    )


@router.get("/summary")
def reconciliation_summary(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    job_cards = _apply_scope(db.query(JobCard), JobCard, plant_scope).all()
    packing = _apply_scope(db.query(PackingRecord), PackingRecord, plant_scope).all()
    holds = _apply_scope(db.query(QualityHold), QualityHold, plant_scope).all()
    shift_rows = _apply_scope(db.query(ShiftMaterialLedger), ShiftMaterialLedger, plant_scope).all()
    return {
        "job_cards": len(job_cards),
        "completed_job_cards": sum(1 for row in job_cards if row.status == "COMPLETED"),
        "packing_records": len(packing),
        "active_quality_holds": sum(1 for row in holds if row.status == "HOLD"),
        "shift_material_rows": len(shift_rows),
    }


@router.post("/monthly-actuals/import")
def import_monthly_actuals(
    payload: MonthlyActualImportPayload,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Owner", "Admin", "PlantManager", "Planner", "Store"])),
):
    if plant_scope.get("scope_all"):
        raise HTTPException(status_code=400, detail="Monthly actual import requires one selected plant")
    month_start = _parse_month_start(payload.month)
    import_batch_id = uuid.uuid4()
    plant_uuid = _to_uuid(plant_scope["selected_plant_id"])
    close_row = (
        db.query(MonthlyMaterialClose)
        .filter(
            MonthlyMaterialClose.plant_id == plant_uuid,
            MonthlyMaterialClose.month_start == month_start,
        )
        .first()
    )
    if close_row and close_row.status == "APPROVED":
        raise HTTPException(status_code=400, detail="Monthly close is already approved and locked")

    db.query(MonthlyMaterialActual).filter(
        MonthlyMaterialActual.plant_id == plant_uuid,
        MonthlyMaterialActual.month_start == month_start,
    ).delete(synchronize_session=False)

    created_rows = 0
    for row in payload.rows:
        item_code = str(row.item_code or "").strip().upper()
        if not item_code:
            continue
        db.add(
            MonthlyMaterialActual(
                plant_id=plant_uuid,
                month_start=month_start,
                item_code=item_code,
                item_name=row.item_name,
                actual_consumed_weight_kg=float(row.actual_consumed_weight_kg or 0.0),
                actual_cost=float(row.actual_cost or 0.0),
                import_batch_id=import_batch_id,
                notes=row.notes,
                created_by=current_user.get("sub"),
            )
        )
        created_rows += 1

    if close_row is None:
        close_row = MonthlyMaterialClose(
            plant_id=plant_uuid,
            month_start=month_start,
        )
        db.add(close_row)

    close_row.status = "DRAFT"
    close_row.import_batch_id = import_batch_id
    close_row.imported_rows_count = created_rows
    close_row.approved_by = None
    close_row.approved_at = None
    close_row.locked_at = None

    db.commit()
    summary = _build_monthly_material_summary(
        db=db,
        plant_scope=plant_scope,
        current_user=current_user,
        month_start=month_start,
    )
    return {
        "month_start": month_start.isoformat(),
        "import_batch_id": str(import_batch_id),
        "created_rows": created_rows,
        "summary": summary.model_dump(mode="json"),
    }


@router.get("/monthly-close", response_model=MonthlyCloseStateResponse)
def get_monthly_close_state(
    month: str = Query(...),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    month_start = _parse_month_start(month)
    if plant_scope.get("scope_all"):
        return _serialize_monthly_close_state(close_row=None, month_start=month_start, plant_scope=plant_scope)

    plant_uuid = _to_uuid(plant_scope["selected_plant_id"])
    close_row = (
        db.query(MonthlyMaterialClose)
        .filter(
            MonthlyMaterialClose.plant_id == plant_uuid,
            MonthlyMaterialClose.month_start == month_start,
        )
        .first()
    )
    return _serialize_monthly_close_state(close_row=close_row, month_start=month_start, plant_scope=plant_scope)


@router.get("/monthly-close/history", response_model=MonthlyCloseHistoryResponse)
def list_monthly_close_history(
    limit: int = Query(12, ge=1, le=36),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    rows = (
        _apply_scope(db.query(MonthlyMaterialClose), MonthlyMaterialClose, plant_scope)
        .order_by(MonthlyMaterialClose.month_start.desc(), MonthlyMaterialClose.updated_at.desc())
        .limit(limit)
        .all()
    )
    return MonthlyCloseHistoryResponse(
        scope_all=bool(plant_scope.get("scope_all")),
        rows=[
            MonthlyCloseHistoryRow(
                plant_id=str(row.plant_id),
                month_start=row.month_start,
                status=row.status,
                imported_rows_count=int(row.imported_rows_count or 0),
                approved_by=row.approved_by,
                approved_at=row.approved_at.isoformat() if row.approved_at else None,
                locked_at=row.locked_at.isoformat() if row.locked_at else None,
                notes=row.notes,
            )
            for row in rows
        ],
    )


@router.post("/monthly-close/approve", response_model=MonthlyCloseStateResponse)
def approve_monthly_close(
    payload: MonthlyCloseApprovePayload,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Owner", "Admin", "PlantManager", "Planner", "Store"])),
):
    if plant_scope.get("scope_all"):
        raise HTTPException(status_code=400, detail="Monthly close approval requires one selected plant")

    month_start = _parse_month_start(payload.month)
    plant_uuid = _to_uuid(plant_scope["selected_plant_id"])
    close_row = (
        db.query(MonthlyMaterialClose)
        .filter(
            MonthlyMaterialClose.plant_id == plant_uuid,
            MonthlyMaterialClose.month_start == month_start,
        )
        .first()
    )
    if close_row is None:
        close_row = MonthlyMaterialClose(
            plant_id=plant_uuid,
            month_start=month_start,
            status="DRAFT",
            imported_rows_count=0,
        )
        db.add(close_row)

    close_row.status = "APPROVED"
    close_row.approved_by = str(current_user.get("sub") or current_user.get("email") or "")
    close_row.approved_at = datetime.utcnow()
    close_row.locked_at = datetime.utcnow()
    close_row.notes = payload.notes
    db.commit()
    db.refresh(close_row)
    return _serialize_monthly_close_state(close_row=close_row, month_start=month_start, plant_scope=plant_scope)


@router.get("/monthly-summary", response_model=MonthlyMaterialSummaryResponse)
def get_monthly_material_summary(
    month: str = Query(...),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    month_start = _parse_month_start(month)
    return _build_monthly_material_summary(
        db=db,
        plant_scope=plant_scope,
        current_user=current_user,
        month_start=month_start,
    )


@router.get("/winder-shift", response_model=WinderShiftReconciliationResponse)
def get_winder_shift_reconciliation(
    winder_machine_id: uuid.UUID = Query(...),
    shift: str = Query(...),
    report_date: date = Query(..., alias="date"),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["PlantManager", "Planner", "Store"])),
):
    normalized_shift = shift.strip().upper()
    plant_selector = "ALL" if plant_scope.get("scope_all") else str(plant_scope["selected_plant_id"])
    issues = _fetch_reel_issues(
        token=current_user.get("token", ""),
        plant_selector=plant_selector,
        winder_machine_id=winder_machine_id,
        shift=normalized_shift,
        issue_date=report_date,
    )
    issue_ids = {str(row.get("id")) for row in issues if row.get("id")}
    issued_weight = sum(float(row.get("issued_weight_kg") or 0.0) for row in issues)

    query = (
        db.query(JobCardStage)
        .join(JobCard, JobCard.id == JobCardStage.job_card_id)
        .filter(
            JobCardStage.stage_type == "WINDER",
            JobCardStage.status == "COMPLETED",
            JobCardStage.machine_id == winder_machine_id,
        )
    )

    if plant_scope.get("scope_all"):
        allowed_plants = plant_scope.get("allowed_plants") or []
        if allowed_plants:
            query = query.filter(JobCard.plant_id.in_([_to_uuid(value) for value in allowed_plants]))
    else:
        query = query.filter(JobCard.plant_id == _to_uuid(plant_scope["selected_plant_id"]))

    fg_weight = 0.0
    scrap_weight = 0.0
    for stage_row in query.all():
        linked_ids = [str(value) for value in (stage_row.reel_issue_ids or [])]
        if not linked_ids or not issue_ids.intersection(linked_ids):
            continue
        fg_weight += float(stage_row.output_qty or 0.0)
        scrap_weight += float(stage_row.scrap_qty or 0.0)

    calculated = _calculate_reconciliation(
        issued_weight=issued_weight,
        fg_weight=fg_weight,
        scrap_weight=scrap_weight,
        alert_threshold_percent=settings.WINDER_LOSS_ALERT_PERCENT,
    )
    return WinderShiftReconciliationResponse(
        plant_id=plant_selector,
        winder_machine_id=winder_machine_id,
        shift=normalized_shift,
        date=report_date,
        issued_weight=calculated["issued_weight"],
        fg_weight=calculated["fg_weight"],
        scrap_weight=calculated["scrap_weight"],
        loss_weight=calculated["loss_weight"],
        loss_percentage=calculated["loss_percentage"],
        alert_flag=calculated["alert_flag"],
        alert_threshold_percent=settings.WINDER_LOSS_ALERT_PERCENT,
        advisory_only=True,
    )


@router.get("/{job_card_id}/loss-breakup", response_model=JobCardLossBreakupResponse)
def get_job_card_loss_breakup(
    job_card_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["PlantManager", "Planner", "Store"])),
):
    query = _apply_scope(db.query(JobCard), JobCard, plant_scope).filter(JobCard.id == job_card_id)
    job_card = query.first()
    if not job_card:
        raise HTTPException(status_code=404, detail="Job card not found")

    winder_stage = (
        db.query(JobCardStage)
        .filter(JobCardStage.job_card_id == job_card.id, JobCardStage.stage_type == "WINDER")
        .first()
    )
    if not winder_stage:
        raise HTTPException(status_code=400, detail="WINDER stage missing for job card")

    linked_issue_ids = [str(value) for value in (winder_stage.reel_issue_ids or [])]
    issue_rows = _fetch_reel_issues_by_ids(
        token=current_user.get("token", ""),
        plant_id=str(job_card.plant_id),
        issue_ids=linked_issue_ids,
    )
    reel_ids = [str(row.get("reel_id")) for row in issue_rows if row.get("reel_id")]
    reel_rows = _fetch_reels_by_ids(
        token=current_user.get("token", ""),
        plant_id=str(job_card.plant_id),
        reel_ids=reel_ids,
    )

    inputs_missing: list[str] = []
    heuristic_notes = [
        "Classification is heuristic and diagnostic only; it does not enforce workflow.",
        "Bucket order is fixed: EXPECTED_SHRINKAGE -> OPERATOR_VARIANCE -> PROCESS_LOSS -> REEL_QUALITY_VARIANCE -> UNEXPLAINED.",
    ]

    issued_weight = sum(float(row.get("issued_weight_kg") or 0.0) for row in issue_rows)
    consumed_weight = sum(
        max(0.0, float(row.get("issued_weight_kg") or 0.0) - float(row.get("remaining_weight_kg") or 0.0))
        for row in issue_rows
    )
    if not issue_rows:
        inputs_missing.append("linked_reel_issues")

    fg_weight = float(winder_stage.output_qty or 0.0)
    scrap_weight = float(winder_stage.scrap_qty or 0.0)
    if winder_stage.output_qty is None:
        inputs_missing.append("winder_output_qty")

    shrink_ratio = _fetch_recipe_shrink_ratio(
        token=current_user.get("token", ""),
        plant_id=str(job_card.plant_id),
        spec_id=job_card.spec_id,
    )
    if shrink_ratio is None:
        inputs_missing.append("recipe_weight_ratio")

    quality_factor = _quality_variation_factor(reel_rows)
    if not reel_rows:
        inputs_missing.append("linked_reel_quality")
    else:
        heuristic_notes.append(f"Reel quality factor derived from GSM/BF variation: {round(quality_factor, 4)}")

    buckets = _classify_loss_buckets(
        consumed_weight=consumed_weight,
        fg_weight=fg_weight,
        scrap_weight=scrap_weight,
        shrink_ratio=shrink_ratio,
        quality_factor=quality_factor,
    )
    total_loss_weight = round(max(0.0, consumed_weight - (fg_weight + scrap_weight)), 4)
    expected_consumption = round(fg_weight + scrap_weight + buckets["EXPECTED_SHRINKAGE"], 4)

    return JobCardLossBreakupResponse(
        job_card_id=job_card.id,
        plant_id=job_card.plant_id,
        issued_weight=round(issued_weight, 4),
        consumed_weight=round(consumed_weight, 4),
        expected_consumption=expected_consumption,
        fg_weight=round(fg_weight, 4),
        scrap_weight=round(scrap_weight, 4),
        total_loss_weight=total_loss_weight,
        buckets=LossBucketsResponse(**buckets),
        heuristic_notes=heuristic_notes,
        inputs_missing=inputs_missing,
        advisory_only=True,
    )
