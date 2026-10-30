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
from ..services.consumption import (
    financial_year_label as _consumption_fy_label,
    financial_year_start as _consumption_fy_start,
    ist_day as _consumption_ist_day,
    ist_today as _consumption_ist_today,
    last_day_of_month as _consumption_last_day,
    month_end_item_row as _consumption_month_end_item_row,
    month_end_unit_totals as _consumption_unit_totals,
    month_key as _consumption_month_key,
    month_label as _consumption_month_label,
    normalize_uom as _consumption_normalize_uom,
    parse_financial_year as _consumption_parse_fy,
    unit_label as _consumption_unit_label,
    with_floor_split as _consumption_with_floor_split,
    year_floor_split as _consumption_year_floor_split,
    PAPER_EXPECTED_CONSUMPTION_FACTOR as _CONSUMPTION_PAPER_EXPECTED_FACTOR,
    PAPER_STANDARD_WASTAGE_PERCENT as _CONSUMPTION_PAPER_WASTAGE_PCT,
    VARIANCE_TOLERANCE_DEFAULT_KG as _CONSUMPTION_DEFAULT_TOL,
    VARIANCE_TOLERANCE_KG_BY_TYPE as _CONSUMPTION_TOL_BY_TYPE,
    aggregate_provisional_rows as _consumption_aggregate_provisional,
    compose_streams_for_period as _consumption_compose_streams,
    is_raw_paper_item as _consumption_is_raw_paper,
    paper_catalog_codes as _consumption_paper_catalog_codes,
    paper_expected_factor_with_overrides as _consumption_paper_expected_factor_with_overrides,
    provisional_rows_for_job_card as _consumption_provisional_for_job,
    summarize_streams as _consumption_summarize,
    tolerance_for_item_type as _consumption_tolerance_for,
)
from ..models import (
    JobCard,
    JobCardStage,
    MonthlyCloseEvent,
    MonthlyMaterialActual,
    MonthlyMaterialClose,
    MonthlyMaterialNote,
    MonthlyMaterialProvisional,
    PackingRecord,
    PLANT_A_UUID,
    PLANT_B_UUID,
    PlantToleranceSetting,
    QualityHold,
    ShiftMaterialLedger,
)
from ..utils.auth import get_current_plant_scope, get_current_user, require_role

router = APIRouter(prefix="/reconciliation", tags=["reconciliation"])
settings = get_settings()

# Re-export constants from the centralized consumption service (Gap 8).
# Local names retained so external callers / tests don't break.
PAPER_EXPECTED_CONSUMPTION_FACTOR = _CONSUMPTION_PAPER_EXPECTED_FACTOR
PAPER_STANDARD_WASTAGE_PERCENT = _CONSUMPTION_PAPER_WASTAGE_PCT
VARIANCE_TOLERANCE_KG_BY_TYPE: dict[str, float] = _CONSUMPTION_TOL_BY_TYPE
VARIANCE_TOLERANCE_DEFAULT_KG = _CONSUMPTION_DEFAULT_TOL


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
    item_id: Optional[str] = None
    item_name: Optional[str] = None
    item_type: Optional[str] = None
    item_uom: Optional[str] = None
    unit_cost: float
    exact_output_paper_kg: Optional[float] = None
    standard_wastage_kg: Optional[float] = None
    expected_consumption_factor: float = 1.0
    theoretical_consumption_kg: float
    provisional_theory_consumption_kg: float
    # Gap 1: third stream — sum of ISSUE_PRODUCTION StockTransaction for the period.
    ledger_issued_kg: float = 0.0
    actual_consumption_kg: float
    actual_month_end_consumption_kg: float
    variance_kg: float
    variance_percent: float
    # Gap 1: derived comparisons for the operator
    ledger_vs_theoretical_kg: float = 0.0
    ledger_vs_actual_kg: float = 0.0
    theoretical_cost: float
    actual_cost: float
    variance_cost: float
    advisory_allocated_order_qty: float
    notes: Optional[str] = None
    # Gap 2/3: tolerance enforcement signal
    tolerance_kg: float = VARIANCE_TOLERANCE_DEFAULT_KG
    over_tolerance: bool = False
    needs_explanation: bool = False


class MonthlyMaterialSummaryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    month_start: date
    month_end: date
    scope_all: bool
    plant_count: int
    total_theoretical_consumption_kg: float
    total_provisional_theory_consumption_kg: float
    # Gap 1: ledger total
    total_ledger_issued_kg: float = 0.0
    total_actual_consumption_kg: float
    total_actual_month_end_consumption_kg: float
    total_variance_kg: float
    total_variance_adjustment_kg: float
    total_theoretical_cost: float
    total_actual_cost: float
    total_variance_cost: float
    # Gap 2/3: aggregate flags
    rows_over_tolerance: int = 0
    rows_needing_explanation: int = 0
    rows: list[MonthlyMaterialActualRow] = Field(default_factory=list)


class PeriodStateBlocker(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str
    item_code: Optional[str] = None
    detail: str


class PeriodStateResponse(BaseModel):
    """Gap 4 — joint posture of cert and reco for one period."""
    model_config = ConfigDict(extra="forbid")

    month_start: date
    month_end: date
    plant_id: Optional[str] = None
    reco_status: str
    reco_locked_at: Optional[str] = None
    stock_cert_status: Optional[str] = None  # DRAFT | CERTIFIED | CARRIED_FORWARD | None
    stock_cert_id: Optional[str] = None
    stock_cert_certified_at: Optional[str] = None
    can_approve_reco: bool
    blockers: list[PeriodStateBlocker] = Field(default_factory=list)


class WeeklyDriftRow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item_code: str
    item_name: Optional[str] = None
    item_type: Optional[str] = None
    theoretical_kg: float
    ledger_issued_kg: float
    running_variance_kg: float
    running_variance_percent: float
    over_tolerance: bool = False


class WeeklyDriftResponse(BaseModel):
    """Gap 9 — read-only early warning."""
    model_config = ConfigDict(extra="forbid")
    week_start: date
    week_end: date
    plant_id: Optional[str] = None
    total_theoretical_kg: float
    total_ledger_kg: float
    total_running_variance_kg: float
    rows_over_tolerance: int = 0
    rows: list[WeeklyDriftRow] = Field(default_factory=list)


class BooksStateResponse(BaseModel):
    """Closed months for the workspace header and the BFF guard (spec 2.5)."""
    model_config = ConfigDict(extra="forbid")
    plant_id: Optional[str] = None
    locked_through: Optional[date] = None
    locked_by: Optional[str] = None
    locked_at: Optional[str] = None
    current_month_status: str
    current_cert_status: Optional[str] = None
    last_reco_month: Optional[date] = None
    # Exactly the CLOSED months ("YYYY-MM"), the oldest ended month still open, and the running month.
    locked_months: list[str] = Field(default_factory=list)
    oldest_open_month: Optional[str] = None
    current_month: Optional[str] = None
    # False when the store could not be asked which months it moved in: the chip then says nothing
    # instead of "Books open" (a store-only month may still be open).
    store_months_known: Optional[bool] = None


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
    from ..lifecycle_rules import canonical_shift

    try:
        normalized = canonical_shift(shift_code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not normalized:
        raise HTTPException(status_code=400, detail="Choose Shift A or Shift B.")
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
    """Paper master lookup for books-state. Unreachable master must not 500 the shell."""
    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.get(
                f"{settings.MASTERDATA_SERVICE_URL}/master/papers/",
                headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
            )
        if response.status_code != 200:
            raise HTTPException(503, "Material catalogs are unavailable; reconciliation cannot be calculated safely")
        rows = response.json() or []
        catalog: dict[str, dict[str, Any]] = {}
        for row in rows:
            catalog[str(row.get("id") or "")] = row
        return catalog
    except httpx.HTTPError:
        raise HTTPException(503, "Material catalogs are unavailable; reconciliation cannot be calculated safely")


def _fetch_inventory_item_catalog(token: str, plant_id: str) -> dict[str, dict[str, Any]]:
    """Inventory item lookup for books-state. An unavailable catalog must not silently change reconciliation totals."""
    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.get(
                f"{settings.INVENTORY_SERVICE_URL}/items/",
                headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
            )
        if response.status_code != 200:
            raise HTTPException(503, "Material catalogs are unavailable; reconciliation cannot be calculated safely")
        rows = response.json() or []
        catalog: dict[str, dict[str, Any]] = {}
        for row in rows:
            code = str(row.get("item_code") or "").strip().upper()
            if not code:
                continue
            catalog[code] = row
        return catalog
    except httpx.HTTPError:
        raise HTTPException(503, "Material catalogs are unavailable; reconciliation cannot be calculated safely")


# ──────────────────────────────────────────────────────────────────────────
# Gap 1 + 4: cross-service ledger / certification fetches
# ──────────────────────────────────────────────────────────────────────────

def _fetch_ledger_consumption(
    token: str,
    plant_id: str,
    period_start: date,
    period_end: date,
) -> dict[str, dict[str, Any]]:
    """Sum ISSUE_PRODUCTION transactions per item across the period.

    Returns: { ITEM_CODE: { item_id, item_code, ledger_issued_kg } }
    Resilient — returns empty dict if the inventory service is unreachable.
    """
    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.get(
                f"{settings.INVENTORY_SERVICE_URL}/transactions/aggregate-by-item",
                params={
                    "start_date": period_start.isoformat(),
                    "end_date": period_end.isoformat(),
                    "transaction_types": "ISSUE_PRODUCTION,ISSUE_FROM_REEL",
                },
                headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
            )
        if response.status_code != 200:
            raise HTTPException(503, "Inventory issue ledger is unavailable; reconciliation cannot be calculated")
        rows = response.json() or []
        out: dict[str, dict[str, Any]] = {}
        for row in rows:
            code = str(row.get("item_code") or "").strip().upper()
            if not code:
                continue
            out[code] = {
                "item_id": row.get("item_id"),
                "item_code": code,
                "ledger_issued_kg": float(row.get("issued_kg") or 0.0),
            }
        return out
    except httpx.HTTPError as exc:
        raise HTTPException(503, "Inventory issue ledger is unavailable; retry reconciliation") from exc


def _fetch_stock_certification_for_period(
    token: str,
    plant_id: str,
    period_start: date,
    period_end: date,
) -> Optional[dict[str, Any]]:
    """Find the most-recent certification whose period_end falls in [start, end)."""
    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.get(
                f"{settings.INVENTORY_SERVICE_URL}/inventory/stock-control/certifications",
                params={
                    "period_start": period_start.isoformat(),
                    "period_end": period_end.isoformat(),
                },
                headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
            )
        if response.status_code != 200:
            return None
        payload = response.json() or []
        if isinstance(payload, dict):
            rows = payload.get("items") or payload.get("rows") or payload.get("certifications") or []
        elif isinstance(payload, list):
            rows = payload
        else:
            rows = []
        rows = [row for row in rows if isinstance(row, dict)]
        if not rows:
            return None
        # Pick the latest whose period_end is within the month
        candidates = [
            r
            for r in rows
            if r.get("period_end")
            and period_start.isoformat() <= str(r.get("period_end")) <= (period_end + _DAY).isoformat()
        ]
        if not candidates:
            # Only a count that ends inside the month belongs to it (a later month's count never does).
            return None
        # Latest first, then an approved count ahead of a later draft.
        candidates.sort(key=lambda r: str(r.get("period_end") or ""), reverse=True)
        candidates.sort(key=lambda r: 0 if str(r.get("status") or "").upper() in {"CERTIFIED", "CARRIED_FORWARD", "APPROVED"} else 1)
        return candidates[0]
    except httpx.HTTPError:
        return None


from datetime import timedelta as _td
_DAY = _td(days=1)


def _tolerance_for(item_type: Optional[str]) -> float:
    """Thin wrapper kept for backward compatibility — delegates to ConsumptionExpectationService."""
    return _consumption_tolerance_for(item_type)


def _load_plant_tolerance_overrides(db: Session, plant_id: Any) -> Optional[dict[str, Any]]:
    """Return ``PlantToleranceSetting`` for ``plant_id`` as a plain dict, or None.

    Caller-side use: pass the dict into
    :func:`tolerance_for_item_type_with_overrides` to get the effective
    tolerance for an item type. Falls back to global defaults on any error.
    """
    plant_uuid = _plant_uuid_or_none(plant_id)
    if plant_uuid is None:
        return None
    try:
        row = (
            db.query(PlantToleranceSetting)
            .filter(PlantToleranceSetting.plant_id == plant_uuid)
            .one_or_none()
        )
    except Exception:  # pragma: no cover — defensive
        return None
    if row is None:
        return None
    return {
        "default_kg": float(row.default_kg) if row.default_kg is not None else None,
        "raw_paper_kg": float(row.raw_paper_kg) if row.raw_paper_kg is not None else None,
        "adhesive_kg": float(row.adhesive_kg) if row.adhesive_kg is not None else None,
        "parchment_kg": float(row.parchment_kg) if row.parchment_kg is not None else None,
        "packaging_kg": float(row.packaging_kg) if row.packaging_kg is not None else None,
        "paper_expected_consumption_factor": float(row.paper_expected_consumption_factor)
        if row.paper_expected_consumption_factor is not None
        else None,
        "paper_standard_wastage_percent": float(row.paper_standard_wastage_percent)
        if row.paper_standard_wastage_percent is not None
        else None,
    }


def _tolerance_for_with_plant(item_type: Optional[str], overrides: Optional[dict[str, Any]]) -> float:
    """Plant-aware version of ``_tolerance_for``. Falls back to global when ``overrides`` is None."""
    if not overrides:
        return _tolerance_for(item_type)
    # Lazy import to avoid a circular import at module load.
    from ..services.consumption import tolerance_for_item_type_with_overrides
    return tolerance_for_item_type_with_overrides(item_type, overrides)


def _paper_catalog_codes(paper_catalog: dict[str, dict[str, Any]]) -> set[str]:
    """Delegates to ConsumptionExpectationService (Gap 8)."""
    return _consumption_paper_catalog_codes(paper_catalog)


def _is_raw_paper_item(item_code: str, item_name: Optional[str], inventory_item: dict[str, Any], paper_codes: set[str]) -> bool:
    """Delegates to ConsumptionExpectationService (Gap 8)."""
    return _consumption_is_raw_paper(item_code, item_name, inventory_item, paper_codes)


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
        return _consumption_ist_today()
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
    """Per-job-card BOM theoretical rows.

    Now delegates to ConsumptionExpectationService (Gap 8). Output shape preserved
    so existing callers (weekly drift, monthly summary) continue to work unchanged.
    """
    rows = _consumption_provisional_for_job(job_card, paper_catalog)
    return [row.to_dict() for row in rows]


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
    token = current_user.get("token", "")
    paper_catalog = _fetch_paper_catalog(token, machine_scope_plant)
    paper_codes = _paper_catalog_codes(paper_catalog)
    inventory_catalog = _fetch_inventory_item_catalog(token, machine_scope_plant)
    # The inventory aggregate is inclusive on both ends: stop the day before next month starts.
    ledger_map = _fetch_ledger_consumption(token, machine_scope_plant, month_start, month_end - _td(days=1))

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
        if row.notes:
            bucket["notes"] = "\n".join(filter(None, [bucket.get("notes"), row.notes]))
        if not bucket.get("item_name") and row.item_name:
            bucket["item_name"] = row.item_name

    plant_overrides = (
        None
        if plant_scope.get("scope_all")
        else _load_plant_tolerance_overrides(db, plant_scope.get("selected_plant_id"))
    )

    # Gap 8: delegate row composition + totals to ConsumptionExpectationService.
    streams = _consumption_compose_streams(
        provisional_map=provisional_map,
        actual_map=actual_map,
        ledger_map=ledger_map,
        inventory_catalog=inventory_catalog,
        paper_codes=paper_codes,
        plant_overrides=plant_overrides,
    )
    rows: list[MonthlyMaterialActualRow] = [
        MonthlyMaterialActualRow(**stream.to_actual_row_dict()) for stream in streams
    ]
    totals = _consumption_summarize(streams)
    total_theoretical = totals["total_theoretical_consumption_kg"]
    total_provisional_theory = totals["total_provisional_theory_consumption_kg"]
    total_ledger = totals["total_ledger_issued_kg"]
    total_actual = totals["total_actual_consumption_kg"]
    total_theoretical_cost = totals["total_theoretical_cost"]
    total_actual_cost = totals["total_actual_cost"]
    rows_over_tolerance = totals["rows_over_tolerance"]
    rows_needing_explanation = totals["rows_needing_explanation"]

    allowed_plants = plant_scope.get("allowed_plants") or []
    plant_count = len(allowed_plants) if plant_scope.get("scope_all") else (1 if plant_scope.get("selected_plant_id") else 0)
    return MonthlyMaterialSummaryResponse(
        month_start=month_start,
        month_end=month_end,
        scope_all=bool(plant_scope.get("scope_all")),
        plant_count=plant_count,
        total_theoretical_consumption_kg=round(total_theoretical, 4),
        total_provisional_theory_consumption_kg=round(total_provisional_theory, 4),
        total_ledger_issued_kg=round(total_ledger, 4),
        total_actual_consumption_kg=round(total_actual, 4),
        total_actual_month_end_consumption_kg=round(total_actual, 4),
        total_variance_kg=round(total_actual - total_theoretical, 4),
        total_variance_adjustment_kg=round(total_actual - total_theoretical, 4),
        total_theoretical_cost=round(total_theoretical_cost, 2),
        total_actual_cost=round(total_actual_cost, 2),
        total_variance_cost=round(total_actual_cost - total_theoretical_cost, 2),
        rows_over_tolerance=rows_over_tolerance,
        rows_needing_explanation=rows_needing_explanation,
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
    current_user: dict = Depends(require_role(["Owner", "Admin", "PlantManager"])),
):
    # Manual override only (month-end close reads used quantities from the approved count).
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


def _compute_period_state(
    *,
    db: Session,
    plant_scope: dict,
    current_user: dict,
    month_start: date,
) -> PeriodStateResponse:
    """Gap 4: joint cert + reco posture for one period."""
    month_end = _next_month(month_start)
    plant_id_str: Optional[str] = None
    reco_status = "OPEN"
    reco_locked_at: Optional[str] = None

    if not plant_scope.get("scope_all"):
        plant_uuid = _to_uuid(plant_scope["selected_plant_id"])
        plant_id_str = str(plant_scope["selected_plant_id"])
        close_row = (
            db.query(MonthlyMaterialClose)
            .filter(
                MonthlyMaterialClose.plant_id == plant_uuid,
                MonthlyMaterialClose.month_start == month_start,
            )
            .first()
        )
        if close_row:
            reco_status = close_row.status or "OPEN"
            reco_locked_at = close_row.locked_at.isoformat() if close_row.locked_at else None

    machine_scope_plant = "ALL" if plant_scope.get("scope_all") else (plant_id_str or "")
    cert = _fetch_stock_certification_for_period(
        current_user.get("token", ""), machine_scope_plant, month_start, month_end - _DAY
    )
    stock_cert_status: Optional[str] = None
    stock_cert_id: Optional[str] = None
    stock_cert_certified_at: Optional[str] = None
    if cert:
        stock_cert_status = str(cert.get("status") or "").upper() or None
        stock_cert_id = str(cert.get("id") or "") or None
        stock_cert_certified_at = cert.get("certified_at")

    blockers: list[PeriodStateBlocker] = []
    if stock_cert_status not in ("CERTIFIED", "CARRIED_FORWARD"):
        blockers.append(
            PeriodStateBlocker(
                code="CERT_NOT_CERTIFIED",
                detail=(
                    f"Stock certification for {month_start.isoformat()} is "
                    f"{stock_cert_status or 'missing'}. Physical count must be certified before monthly close."
                ),
            )
        )

    # Variance reason blockers (Gap 2/3)
    summary = _build_monthly_material_summary(
        db=db,
        plant_scope=plant_scope,
        current_user=current_user,
        month_start=month_start,
    )
    for row in summary.rows:
        if row.needs_explanation:
            blockers.append(
                PeriodStateBlocker(
                    code="VARIANCE_NEEDS_NOTE",
                    item_code=row.item_code,
                    detail=(
                        f"{row.item_code}: variance {row.variance_kg:+.2f} kg exceeds tolerance "
                        f"{row.tolerance_kg:.2f} kg — please add an explanation note."
                    ),
                )
            )

    can_approve = (reco_status == "DRAFT" or reco_status == "OPEN") and len(blockers) == 0

    return PeriodStateResponse(
        month_start=month_start,
        month_end=month_end,
        plant_id=plant_id_str,
        reco_status=reco_status,
        reco_locked_at=reco_locked_at,
        stock_cert_status=stock_cert_status,
        stock_cert_id=stock_cert_id,
        stock_cert_certified_at=stock_cert_certified_at,
        can_approve_reco=can_approve,
        blockers=blockers,
    )


@router.get("/period-state/{month}", response_model=PeriodStateResponse)
def get_period_state(
    month: str,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    month_start = _parse_month_start(month)
    return _compute_period_state(
        db=db,
        plant_scope=plant_scope,
        current_user=current_user,
        month_start=month_start,
    )


@router.get("/count-consumption/{month}")
def get_count_consumption(
    month: str,
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    """What the certified stock count says each item consumed in the month: opening + received -
    counted closing (book closing where an item was not counted). The Actuals tab offers these
    figures; the plant still reviews and saves them before the reconciliation is closed."""
    if plant_scope.get("scope_all"):
        raise HTTPException(status_code=400, detail="Choose one plant to read its stock count")
    month_start = _parse_month_start(month)
    month_end = _next_month(month_start)
    token = current_user.get("token", "")
    plant_id = str(plant_scope["selected_plant_id"])
    cert = _fetch_stock_certification_for_period(token, plant_id, month_start, month_end - _DAY)
    if not cert or not cert.get("id"):
        return {"month_start": month_start.isoformat(), "certification": None, "rows": []}
    try:
        with httpx.Client(timeout=20.0) as client:
            response = client.get(
                f"{settings.INVENTORY_SERVICE_URL}/inventory/stock-control/certifications/{cert['id']}",
                headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(503, "Inventory stock count is unavailable") from exc
    if response.status_code != 200:
        raise HTTPException(503, "Inventory stock count is unavailable")
    detail = response.json() or {}
    items: dict[str, dict[str, Any]] = {}
    for line in detail.get("lines") or []:
        code = str(line.get("item_code") or "").strip().upper()
        if not code:
            continue
        row = items.setdefault(code, {"item_code": code, "item_name": line.get("item_name"), "uom": line.get("uom"), "opening_qty": 0.0, "inward_qty": 0.0, "counted_qty": 0.0, "uncounted_lines": 0})
        counted = line.get("physical_qty")
        row["opening_qty"] += float(line.get("opening_qty") or 0.0)
        row["inward_qty"] += float(line.get("inward_qty") or 0.0)
        if counted is None:
            row["uncounted_lines"] += 1
            counted = line.get("closing_qty")
        row["counted_qty"] += float(counted or 0.0)
    rows = []
    for row in items.values():
        row["consumed_qty"] = round(max(0.0, row["opening_qty"] + row["inward_qty"] - row["counted_qty"]), 3)
        for key in ("opening_qty", "inward_qty", "counted_qty"):
            row[key] = round(row[key], 3)
        rows.append(row)
    rows.sort(key=lambda row: row["item_code"])
    return {
        "month_start": month_start.isoformat(),
        "certification": {key: detail.get(key, cert.get(key)) for key in ("id", "status", "period_start", "period_end", "count_session_no", "certified_at")},
        "rows": rows,
    }


@router.post("/monthly-close/approve", response_model=MonthlyCloseStateResponse)
def approve_monthly_close(
    payload: MonthlyCloseApprovePayload,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    """Older close call, kept for old clients: it is now the Owner-only month-end close (same checks,
    frozen snapshot and store books lock as POST /reconciliation/month-end/close)."""
    if not _is_actual_owner(current_user):
        raise HTTPException(status_code=403, detail="Only the Owner can do this.")
    if plant_scope.get("scope_all"):
        raise HTTPException(status_code=400, detail="Monthly close approval requires one selected plant")
    month_start = _parse_month_start(payload.month)
    close_row = _close_month(db, _concrete_plant(plant_scope), month_start, current_user, payload.notes)
    return _serialize_monthly_close_state(close_row=close_row, month_start=month_start, plant_scope=plant_scope)


# ─── Gap 9: weekly drift ───────────────────────────────────────────────────


@router.get("/weekly-drift", response_model=WeeklyDriftResponse)
def get_weekly_drift(
    week_start: str = Query(...),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    try:
        start = date.fromisoformat(week_start)
    except ValueError:
        raise HTTPException(status_code=400, detail="week_start must be YYYY-MM-DD")
    end = start + _td(days=7)

    machine_scope_plant = "ALL" if plant_scope.get("scope_all") else str(plant_scope["selected_plant_id"])
    token = current_user.get("token", "")
    inventory_catalog = _fetch_inventory_item_catalog(token, machine_scope_plant)
    ledger_map = _fetch_ledger_consumption(token, machine_scope_plant, start, end - _td(days=1))

    # Build a simple provisional sum for the week by scanning job cards active in window.
    job_cards = _month_scope_job_cards(db, plant_scope, start, end)
    paper_catalog = _fetch_paper_catalog(token, machine_scope_plant)
    paper_codes = _paper_catalog_codes(paper_catalog)
    provisional_rows: dict[str, float] = {}
    for job in job_cards:
        for prov in _provisional_material_rows(job, paper_catalog):
            code = str(prov.get("item_code") or "").strip().upper()
            if not code:
                continue
            provisional_rows[code] = provisional_rows.get(code, 0.0) + float(prov.get("theoretical_consumption_kg") or 0.0)

    # Load per-plant tolerance overrides once for the loop. ALL scope → no overrides.
    tolerance_overrides = (
        None
        if plant_scope.get("scope_all")
        else _load_plant_tolerance_overrides(db, plant_scope.get("selected_plant_id"))
    )

    item_codes = sorted(set(provisional_rows.keys()) | set(ledger_map.keys()))
    rows: list[WeeklyDriftRow] = []
    total_theory = 0.0
    total_ledger = 0.0
    rows_over_tolerance = 0
    for code in item_codes:
        provisional_kg = provisional_rows.get(code, 0.0)
        ledger_kg = float(ledger_map.get(code, {}).get("ledger_issued_kg") or 0.0)
        inv_item = inventory_catalog.get(code, {})
        item_type = str(inv_item.get("type") or "").strip().upper() or None
        is_paper = _is_raw_paper_item(code, inv_item.get("name"), inv_item, paper_codes)
        theory_kg = round(
            provisional_kg
            * _consumption_paper_expected_factor_with_overrides(
                is_paper=is_paper,
                provisional_kg=provisional_kg,
                overrides=tolerance_overrides,
            ),
            6,
        )
        running_variance = round(ledger_kg - theory_kg, 4)
        running_variance_pct = round((running_variance / theory_kg) * 100.0, 2) if theory_kg > 0 else 0.0
        over_tol = abs(running_variance) > _tolerance_for_with_plant(item_type, tolerance_overrides)
        if over_tol:
            rows_over_tolerance += 1
        total_theory += theory_kg
        total_ledger += ledger_kg
        rows.append(
            WeeklyDriftRow(
                item_code=code,
                item_name=inv_item.get("name"),
                item_type=item_type,
                theoretical_kg=round(theory_kg, 4),
                ledger_issued_kg=round(ledger_kg, 4),
                running_variance_kg=running_variance,
                running_variance_percent=running_variance_pct,
                over_tolerance=over_tol,
            )
        )

    return WeeklyDriftResponse(
        week_start=start,
        week_end=end - _td(days=1),
        plant_id=None if plant_scope.get("scope_all") else str(plant_scope.get("selected_plant_id") or ""),
        total_theoretical_kg=round(total_theory, 4),
        total_ledger_kg=round(total_ledger, 4),
        total_running_variance_kg=round(total_ledger - total_theory, 4),
        rows_over_tolerance=rows_over_tolerance,
        rows=rows,
    )


# ─── Gap 10: workspace books-state ─────────────────────────────────────────


def _plant_uuid_or_none(value: Any) -> Optional[uuid.UUID]:
    if value is None:
        return None
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError):
        return None


def _serialize_tolerance(row: Optional[PlantToleranceSetting], plant_id_str: str) -> dict[str, Any]:
    """Marshal a PlantToleranceSetting row (or `None`) into the UI shape.

    When ``row`` is ``None`` we return the global defaults so the UI can still
    render a starting point for a plant that hasn't been customized yet.
    """
    by_item_type: dict[str, Optional[float]] = {
        "RAW_PAPER": None,
        "ADHESIVE": None,
        "PARCHMENT": None,
        "PACKAGING": None,
    }
    if row is not None:
        by_item_type["RAW_PAPER"] = row.raw_paper_kg
        by_item_type["ADHESIVE"] = row.adhesive_kg
        by_item_type["PARCHMENT"] = row.parchment_kg
        by_item_type["PACKAGING"] = row.packaging_kg

    return {
        "plant_id": plant_id_str,
        "scope": "plant" if row else "global",
        "default_kg": float(row.default_kg) if row else VARIANCE_TOLERANCE_DEFAULT_KG,
        "by_item_type_effective": {
            k: (by_item_type[k] if by_item_type[k] is not None else float(VARIANCE_TOLERANCE_KG_BY_TYPE.get(k, VARIANCE_TOLERANCE_DEFAULT_KG)))
            for k in by_item_type
        },
        "by_item_type_overrides": {k: by_item_type[k] for k in by_item_type},
        "by_item_type_global": {k: float(v) for k, v in VARIANCE_TOLERANCE_KG_BY_TYPE.items()},
        "paper_expected_consumption_factor": (
            float(row.paper_expected_consumption_factor) if row and row.paper_expected_consumption_factor is not None else PAPER_EXPECTED_CONSUMPTION_FACTOR
        ),
        "paper_standard_wastage_percent": (
            float(row.paper_standard_wastage_percent) if row and row.paper_standard_wastage_percent is not None else PAPER_STANDARD_WASTAGE_PERCENT
        ),
        "updated_by": row.updated_by if row else None,
        "updated_at": row.updated_at.isoformat() if row and row.updated_at else None,
    }


class ToleranceSettingPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    default_kg: float = Field(..., ge=0.0, le=500.0)
    raw_paper_kg: Optional[float] = Field(default=None, ge=0.0, le=500.0)
    adhesive_kg: Optional[float] = Field(default=None, ge=0.0, le=500.0)
    parchment_kg: Optional[float] = Field(default=None, ge=0.0, le=500.0)
    packaging_kg: Optional[float] = Field(default=None, ge=0.0, le=500.0)
    paper_expected_consumption_factor: Optional[float] = Field(default=None, ge=0.5, le=5.0)
    paper_standard_wastage_percent: Optional[float] = Field(default=None, ge=0.0, le=50.0)


@router.get("/tolerance-settings")
def get_tolerance_settings(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    """Variance tolerance values per item type — plant-aware.

    For owners/admins in ALL scope, returns one row per allowed plant.
    For plant-scoped users, returns just the row for their plant.
    """
    if plant_scope.get("scope_all"):
        allowed = plant_scope.get("allowed_plants") or []
        rows: list[dict[str, Any]] = []
        for plant_id_str in allowed:
            plant_uuid = _plant_uuid_or_none(plant_id_str)
            if plant_uuid is None:
                continue
            row = (
                db.query(PlantToleranceSetting)
                .filter(PlantToleranceSetting.plant_id == plant_uuid)
                .one_or_none()
            )
            rows.append(_serialize_tolerance(row, str(plant_id_str)))
        return {
            "scope": "all",
            "rows": rows,
            "global_defaults": {
                "default_kg": VARIANCE_TOLERANCE_DEFAULT_KG,
                "by_item_type": {k: float(v) for k, v in VARIANCE_TOLERANCE_KG_BY_TYPE.items()},
                "paper_expected_consumption_factor": PAPER_EXPECTED_CONSUMPTION_FACTOR,
                "paper_standard_wastage_percent": PAPER_STANDARD_WASTAGE_PERCENT,
            },
        }

    plant_id = plant_scope["selected_plant_id"]
    plant_uuid = _plant_uuid_or_none(plant_id)
    if plant_uuid is None:
        raise HTTPException(status_code=400, detail="Invalid plant_id in scope")
    row = (
        db.query(PlantToleranceSetting)
        .filter(PlantToleranceSetting.plant_id == plant_uuid)
        .one_or_none()
    )
    return {
        "scope": "plant",
        "rows": [_serialize_tolerance(row, str(plant_id))],
        "global_defaults": {
            "default_kg": VARIANCE_TOLERANCE_DEFAULT_KG,
            "by_item_type": {k: float(v) for k, v in VARIANCE_TOLERANCE_KG_BY_TYPE.items()},
            "paper_expected_consumption_factor": PAPER_EXPECTED_CONSUMPTION_FACTOR,
            "paper_standard_wastage_percent": PAPER_STANDARD_WASTAGE_PERCENT,
        },
    }


@router.put("/tolerance-settings")
def put_tolerance_settings(
    payload: ToleranceSettingPayload,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Owner", "Admin"])),
):
    """Owner/Admin only. Upsert the plant's tolerance row.

    Plant target is taken from ``X-Plant-ID`` / ``plant_id`` query param via the
    standard plant-scope dependency. ALL scope is rejected here — the editor UI
    must commit one plant at a time, so the audit trail is unambiguous.
    """
    if plant_scope.get("scope_all"):
        raise HTTPException(status_code=400, detail="tolerance_setting requires a specific plant — choose one before saving")

    plant_id = plant_scope["selected_plant_id"]
    plant_uuid = _plant_uuid_or_none(plant_id)
    if plant_uuid is None:
        raise HTTPException(status_code=400, detail="Invalid plant_id in scope")

    row = (
        db.query(PlantToleranceSetting)
        .filter(PlantToleranceSetting.plant_id == plant_uuid)
        .one_or_none()
    )
    actor = current_user.get("actor_identity") or current_user.get("sub") or current_user.get("email") or "unknown"
    if row is None:
        row = PlantToleranceSetting(
            plant_id=plant_uuid,
            default_kg=payload.default_kg,
            raw_paper_kg=payload.raw_paper_kg,
            adhesive_kg=payload.adhesive_kg,
            parchment_kg=payload.parchment_kg,
            packaging_kg=payload.packaging_kg,
            paper_expected_consumption_factor=payload.paper_expected_consumption_factor,
            paper_standard_wastage_percent=payload.paper_standard_wastage_percent,
            updated_by=str(actor),
        )
        db.add(row)
    else:
        row.default_kg = payload.default_kg
        row.raw_paper_kg = payload.raw_paper_kg
        row.adhesive_kg = payload.adhesive_kg
        row.parchment_kg = payload.parchment_kg
        row.packaging_kg = payload.packaging_kg
        row.paper_expected_consumption_factor = payload.paper_expected_consumption_factor
        row.paper_standard_wastage_percent = payload.paper_standard_wastage_percent
        row.updated_by = str(actor)
    db.commit()
    db.refresh(row)
    return _serialize_tolerance(row, str(plant_id))


@router.get("/books-state", response_model=BooksStateResponse)
def get_books_state(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    """Closed months of the plant, for the header chip and the BFF dated-write guard (spec 2.5).

    Locked months are exactly the CLOSED months; ``locked_through`` (last day of the latest close) stays
    for old readers only. Read from this service's own tables, so the header never waits on other
    services."""
    today = _consumption_ist_today()
    current_month_start = today.replace(day=1)
    if plant_scope.get("scope_all"):
        return BooksStateResponse(current_month_status="RUNNING", current_month=_consumption_month_key(current_month_start))
    plant_uuid = _to_uuid(plant_scope["selected_plant_id"])
    rows_by_month = _close_rows_by_month(db, plant_uuid)
    closed = sorted(value for value, row in rows_by_month.items() if row.status == CLOSED_STATUS)
    latest = rows_by_month[closed[-1]] if closed else None
    # Store-only months (GRNs before the first spec posting, a month with only a count) come from the last
    # month-end probe of this plant. After a restart, or once a new month has begun, that hint is empty or
    # stale: probe the store once then (it is remembered per plant and month), so the chip never answers
    # "Books open" from an empty cache. A store that does not answer is asked again after a minute.
    store_months = _store_months_for_header(db, plant_uuid, current_user.get("token", ""), current_month_start)
    activity = _activity_months(db, plant_uuid) | (store_months or set())
    open_ended = sorted(value for value in activity if value < current_month_start and value not in closed)
    return BooksStateResponse(
        plant_id=str(plant_scope["selected_plant_id"]),
        locked_through=_consumption_last_day(closed[-1]) if closed else None,
        locked_by=(latest.closed_by or latest.approved_by) if latest is not None else None,
        locked_at=_iso(latest.closed_at or latest.approved_at) if latest is not None else None,
        current_month_status="RUNNING",
        current_cert_status=None,
        last_reco_month=closed[-1] if closed else None,
        locked_months=[_consumption_month_key(value) for value in closed],
        current_month=_consumption_month_key(current_month_start),
        oldest_open_month=_consumption_month_key(open_ended[0]) if open_ended else None,
        store_months_known=store_months is not None,
    )


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


# ═════════════════════════════════════════════════════════════════════════
# Month-end close (spec 2.1, 2.5, 2.6, client 2026-10-28)
#
# One page per plant and month: spec (BOM × good output, posted at the card's final close) against
# what the store issued to the floor against what the approved month-end count says was used.
# Store figures come from inventory month-figures; every number is in the item's own stock unit and
# totals are per unit. Close is Owner only, in month order, with a frozen snapshot, and locks the
# month in both services (production refuses floor entries, inventory refuses store movements).
# Re-open is Owner only with a reason and also re-opens later closed months, newest first.
# ═════════════════════════════════════════════════════════════════════════

MONTH_END_VIEW_ROLES = ["Owner", "Admin", "PlantManager"]
COUNT_APPROVED_STATUSES = {"CERTIFIED", "APPROVED"}
CLOSED_STATUS = "APPROVED"  # the close row status validate_books and books-state read
_MONTH_ABBR = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_FIGURE_COMPARE_KEYS = ("opening", "received", "sent_back", "issued", "corrections", "closing", "spec")
_TYPE_UNIT_HINTS = {
    "RAW_PAPER": "kg",
    "ADHESIVE": "kg",
    "PARCHMENT": "kg",
    "PACKAGING": "each item's own unit",
    "OTHER": "each item's own unit",
}
_OWN_UNIT_HINT = "each item's own unit"


def _limit_unit_hint(material_type: str, units_in_use: list[str]) -> str:
    """The unit the minimum gap is read in. It always applies in each item's own unit (spec 1), so one
    unit in use names it (adhesive kept in litres reads "litre"), and mixed units (adhesive in kg and in
    litres) say "each item's own unit" instead of naming one unit for both."""
    units = sorted({str(unit) for unit in units_in_use if unit})
    if len(units) == 1:
        return units[0]
    if len(units) > 1:
        return _OWN_UNIT_HINT
    return _TYPE_UNIT_HINTS.get(material_type, _OWN_UNIT_HINT)


def _day_label(value: date) -> str:
    """"1 Nov 2026"."""
    return f"{value.day} {_MONTH_ABBR[value.month - 1]} {value.year}"


def _short_month(value: date) -> str:
    return f"{_MONTH_ABBR[value.month - 1]} {value.year}"


def _month_word(value: date) -> str:
    """"October" (the month's own name, for sentences inside its page)."""
    return _consumption_month_label(value).split(" ")[0]


def _person(value: Any) -> str:
    """Who did it, in plain words (logins are e-mail addresses; the part before @ reads as a name)."""
    text = str(value or "").strip()
    return text.split("@", 1)[0] if "@" in text else (text or "someone")


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _roles_of(user: dict) -> set[str]:
    return {str(role) for role in [*(user.get("roles") or []), user.get("role")] if role}


def _is_actual_owner(user: dict) -> bool:
    """Owner in the login's real roles and in effect now (Admin alone is not the Owner; same rule as
    PO approval and the inventory books lock)."""
    actual = {str(role) for role in (user.get("actual_roles") or user.get("roles") or [])}
    return "Owner" in actual and "Owner" in _roles_of(user)


def _require_actual_owner(current_user: dict = Depends(get_current_user)) -> dict:
    if not _is_actual_owner(current_user):
        raise HTTPException(status_code=403, detail="Only the Owner can do this.")
    return current_user


def _can_write_month_notes(user: dict) -> bool:
    """Month-end notes: Owner and the plant head (spec 2.8)."""
    return _is_actual_owner(user) or "PlantManager" in _roles_of(user)


def _can_edit_usage_limits(user: dict) -> bool:
    return bool(_roles_of(user) & {"Owner", "Admin"})


def _concrete_plant(plant_scope: dict) -> uuid.UUID:
    if plant_scope.get("scope_all") or not plant_scope.get("selected_plant_id"):
        raise HTTPException(status_code=400, detail="Choose one plant first. Month-end close is kept per plant.")
    return _to_uuid(plant_scope["selected_plant_id"])


def _month_from_key(value: str) -> date:
    return _parse_month_start(value)


def _close_rows_by_month(db: Session, plant: uuid.UUID) -> dict[date, MonthlyMaterialClose]:
    rows = (
        db.query(MonthlyMaterialClose)
        .filter(MonthlyMaterialClose.plant_id == plant)
        .order_by(MonthlyMaterialClose.month_start.asc(), MonthlyMaterialClose.updated_at.desc())
        .all()
    )
    by_month: dict[date, MonthlyMaterialClose] = {}
    for row in rows:
        current = by_month.get(row.month_start)
        # A closed row wins over a stray draft for the same month.
        if current is None or (row.status == CLOSED_STATUS and current.status != CLOSED_STATUS):
            by_month[row.month_start] = row
    return by_month


def _closed_month_set(db: Session, plant: uuid.UUID) -> set[date]:
    return {
        value
        for (value,) in db.query(MonthlyMaterialClose.month_start)
        .filter(MonthlyMaterialClose.plant_id == plant, MonthlyMaterialClose.status == CLOSED_STATUS)
        .all()
    }


def _activity_months(db: Session, plant: uuid.UUID) -> set[date]:
    """Months with production-side activity: spec postings, notes or a close row (go-live lower bound)."""
    months: set[date] = set()
    for model in (MonthlyMaterialProvisional, MonthlyMaterialNote, MonthlyMaterialClose):
        months.update(value for (value,) in db.query(model.month_start).filter(model.plant_id == plant).distinct().all())
    return {value.replace(day=1) for value in months if value}


def _previous_month(month_start: date) -> date:
    return (month_start - _DAY).replace(day=1)


# How far back the store side is probed before go-live is assumed, and the store-active months last seen
# per plant (a hint for the header chip only; every close decision probes the store again).
_STORE_LOOKBACK_MONTHS = 24
_store_activity_hint: dict[str, set[date]] = {}
# Per plant: (running month of the probe, whether the store answered every call, monotonic time).
_store_hint_meta: dict[str, tuple[date, bool, float]] = {}
_STORE_HINT_RETRY_SECONDS = 60.0
# Inventory month-figures of each month read, per plant, for a short while. Month-figures reads the store's
# whole book, and the activity probe, the months list and the Year view each need many months: within the
# TTL an ENDED month is served from here (a month's own page, the running month and a close always ask the
# store again, and a fresh answer refreshes the entry). An entry whose month-end count changed since (the
# counts list says so) is dropped, so approving a count shows at once. Close and re-open clear the plant.
_STORE_STATE_TTL_SECONDS = 180.0
_store_state_cache: dict[tuple[str, date], tuple[float, Optional[dict[str, Any]]]] = {}


def _store_state_cache_clear(plant: Any) -> None:
    key = str(plant)
    for cached in [cached for cached in _store_state_cache if cached[0] == key]:
        _store_state_cache.pop(cached, None)


def _month_figures_memo(
    token: str, plant_text: str, month: date, memo: Optional[dict[date, Any]], *, reuse: bool = False,
) -> Optional[dict[str, Any]]:
    """Inventory month-figures at most once per month and request (the activity probe and the page share
    it). ``reuse`` also accepts a recent answer of an earlier request (ended months only, see the cache)."""
    import time as _time

    if memo is not None and month in memo:
        return memo[month]
    cached = _store_state_cache.get((plant_text, month)) if reuse else None
    if cached is not None and _time.monotonic() - cached[0] < _STORE_STATE_TTL_SECONDS:
        payload = cached[1]
    else:
        payload = _fetch_month_figures(token, plant_text, month)
        _store_state_cache[(plant_text, month)] = (_time.monotonic(), payload)
    if memo is not None:
        memo[month] = payload
    return payload


def _store_month_state(payload: Optional[dict[str, Any]]) -> tuple[bool, bool]:
    """(moved, stock_at_start): whether any material moved in the month, and whether any had book stock
    on its 1st (so something moved before it)."""

    def number(value: Any) -> float:
        try:
            return float(value or 0.0)
        except (TypeError, ValueError):
            return 0.0

    def moved(row: dict[str, Any]) -> bool:
        if "has_movement" in row:
            return bool(row.get("has_movement"))
        return any(abs(number(row.get(key))) > 0.0005 for key in ("received", "sent_back", "issued", "corrections"))

    rows = [row for row in (payload or {}).get("items") or [] if isinstance(row, dict)]
    return any(moved(row) for row in rows), any(abs(number(row.get("opening"))) > 0.0005 for row in rows)


_COUNT_LIST_STATUSES = "DRAFT,SUBMITTED,APPROVED,CERTIFIED"


def _fetch_month_end_counts(token: str, plant_id: str) -> Optional[dict[date, tuple[str, str]]]:
    """The plant's month-end counts that are not cancelled, by month: {month: (count id, status)}. One
    cheap store call (the counts list). None when the store does not answer."""
    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.get(
                f"{settings.INVENTORY_SERVICE_URL}/inventory/counts",
                # brief: only id, kind, month and status, answered by the store in one query.
                params={"kind": "MONTH_END", "status": _COUNT_LIST_STATUSES, "limit": 200, "brief": "true"},
                headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
            )
        if response.status_code != 200:
            return None
        payload = response.json() or {}
    except (httpx.HTTPError, ValueError):
        return None
    out: dict[date, tuple[str, str]] = {}
    for row in payload.get("items") or [] if isinstance(payload, dict) else []:
        if not isinstance(row, dict) or str(row.get("kind") or "").upper() != "MONTH_END" or not row.get("month"):
            continue
        status = str(row.get("status") or "").upper()
        if status == "CANCELLED":
            continue
        try:
            month = _parse_month_start(str(row["month"]))
        except HTTPException:
            continue
        out.setdefault(month, (str(row.get("id") or ""), status))  # newest first: the live one wins
    return out


def _drop_stale_figures(plant_text: str, counts: dict[date, tuple[str, str]]) -> None:
    """Forget cached month-figures whose month-end count is not the one (or not in the state) the counts
    list now shows: a count started, submitted, approved or cancelled since."""
    for (plant_key, month), (_at, payload) in list(_store_state_cache.items()):
        if plant_key != plant_text:
            continue
        count = (payload or {}).get("month_end_count") if isinstance(payload, dict) else None
        seen = (str(count.get("id") or ""), str(count.get("status") or "").upper()) if isinstance(count, dict) and count.get("id") else None
        if seen != counts.get(month):
            _store_state_cache.pop((plant_key, month), None)


def _store_activity_months(
    db: Session, plant: uuid.UUID, token: str, *, current: date, memo: Optional[dict[date, Any]] = None, fresh: bool = False,
) -> set[date]:
    """Ended months the close-in-order rule must see from the store side (spec 2.5): months with a
    month-end count (started, waiting or approved), and months in which the store book moved (GRN, issue,
    return, correction, count) from inventory month-figures. A month with store activity but no spec
    posting still closes in order, so September cannot close while a go-live August with only GRNs is open,
    and October cannot close while a counted September is open.

    The counts list is one call. Month-figures is probed month by month, only where nothing else says the
    month is active: every ended month from the earliest month known (production, closes, counts) to now,
    and, walking back from that earliest month, each month until one with no movement and no stock on its
    1st (before go-live). Probes share the page's ``memo`` and, within a few minutes, earlier requests'
    answers (``fresh`` asks the store again: the close decision)."""
    import time as _time

    plant_text = str(plant)
    closed = _closed_month_set(db, plant)
    production = _activity_months(db, plant)
    memo = memo if memo is not None else {}
    counts = _fetch_month_end_counts(token, plant_text)
    answered = counts is not None
    if counts is None:
        if fresh:
            raise HTTPException(503, "The store did not say which months were counted. Try again in a minute.")
        counts = {}
    else:
        _drop_stale_figures(plant_text, counts)
    counted = {value for value in counts if value < current}
    found: set[date] = set(counted)

    def probe(month: date) -> Optional[tuple[bool, bool]]:
        nonlocal answered
        try:
            payload = _month_figures_memo(token, plant_text, month, memo, reuse=not fresh)
        except HTTPException:
            answered = False
            return None
        return None if payload is None else _store_month_state(payload)

    known = production | closed | counted
    earliest = min(known | {current})
    cursor = earliest
    while cursor < current:
        if cursor not in known:
            state = probe(cursor)
            if state and state[0]:
                found.add(cursor)
        cursor = _next_month(cursor)
    cursor = _previous_month(earliest)
    for _ in range(_STORE_LOOKBACK_MONTHS):
        state = probe(cursor)
        if state is None:
            break
        moved, stock_at_start = state
        if moved:
            found.add(cursor)
        elif not stock_at_start:
            break  # nothing moved and nothing was in stock: the store book starts after this month
        cursor = _previous_month(cursor)
    _store_activity_hint[plant_text] = set(found)
    _store_hint_meta[plant_text] = (current, answered, _time.monotonic())
    return found


def _store_months_for_header(db: Session, plant: uuid.UUID, token: str, current: date) -> Optional[set[date]]:
    """Store-active ended months for the header chip: the last probe's hint while it is for the running
    month and the store answered it. Otherwise the probe runs once in the background (its own session),
    retried at most once a minute while the store does not answer, so the chip and the BFF's dated-write
    guard (5 s timeout) never wait on the store. None while the store's months are not known: the chip
    then says nothing and asks again in a few seconds."""
    import time as _time

    key = str(plant)
    meta = _store_hint_meta.get(key)
    usable = meta is not None and meta[0] == current and key in _store_activity_hint
    if not usable or (not meta[1] and _time.monotonic() - meta[2] >= _STORE_HINT_RETRY_SECONDS):
        if _STORE_HINT_IN_BACKGROUND:
            _warm_store_hint(plant, token, current)
        else:
            _probe_store_hint(db, plant, token, current)
        meta = _store_hint_meta.get(key)
    if meta is None or meta[0] != current or not meta[1]:
        return None
    return set(_store_activity_hint.get(key, set()))


# The header probe runs in a background thread; tests run it inline on their own session.
_STORE_HINT_IN_BACKGROUND = True
_store_hint_warming: set[str] = set()


def _probe_store_hint(db: Session, plant: uuid.UUID, token: str, current: date) -> None:
    import time as _time

    try:
        _store_activity_months(db, plant, token, current=current)
    except Exception:  # the hint stays "not known"; the chip asks again later
        _store_hint_meta[str(plant)] = (current, False, _time.monotonic())


def _warm_store_hint(plant: uuid.UUID, token: str, current: date) -> None:
    import threading

    from ..database import SessionLocal

    key = str(plant)
    if key in _store_hint_warming:
        return
    _store_hint_warming.add(key)

    def run() -> None:
        session = SessionLocal()
        try:
            _probe_store_hint(session, plant, token, current)
        finally:
            session.close()
            _store_hint_warming.discard(key)

    threading.Thread(target=run, name=f"store-hint-{key[:8]}", daemon=True).start()


def _earlier_open_months(db: Session, plant: uuid.UUID, month: date, store_months: Optional[set[date]] = None) -> list[date]:
    """Ended months before ``month`` with activity (production, or the store when ``store_months`` is
    given) that are not closed: the close-in-order rule."""
    closed = _closed_month_set(db, plant)
    active = _activity_months(db, plant) | set(store_months or ())
    return sorted(value for value in active if value < month and value not in closed)


def _later_closed_months(db: Session, plant: uuid.UUID, month: date) -> list[date]:
    return sorted(value for value in _closed_month_set(db, plant) if value > month)


def _fetch_month_figures(token: str, plant_id: str, month: date) -> Optional[dict[str, Any]]:
    """Inventory month-figures (spec 5). None while the store side has no such endpoint yet (404/405);
    any other failure is a 503 so a page never shows store numbers as zero by mistake."""
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(
                f"{settings.INVENTORY_SERVICE_URL}/inventory/stock-control/month-figures",
                params={"month": _consumption_month_key(month)},
                headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(503, "Store figures are unavailable right now. Try again in a minute.") from exc
    if response.status_code in (404, 405):
        return None
    if response.status_code in (401, 403):
        # Not a passing outage: waiting a minute will not help, so say what it is.
        raise HTTPException(403, "The store does not give you this plant's figures. Switch to this plant, or ask the Owner for access to it.")
    if response.status_code != 200:
        raise HTTPException(503, "Store figures are unavailable right now. Try again in a minute.")
    payload = response.json() or {}
    return payload if isinstance(payload, dict) else None


def _fetch_month_figure_sources(token: str, plant_id: str, month: date, item_id: str) -> Optional[dict[str, Any]]:
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(
                f"{settings.INVENTORY_SERVICE_URL}/inventory/stock-control/month-figures/{item_id}/sources",
                params={"month": _consumption_month_key(month)},
                headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
            )
    except httpx.HTTPError:
        return None
    if response.status_code != 200:
        return None
    payload = response.json()
    return payload if isinstance(payload, (dict, list)) else None


def _fetch_inventory_item(token: str, plant_id: str, item_id: str) -> Optional[dict[str, Any]]:
    """One stock item (its unit and kg per litre), best effort: None when the store does not answer."""
    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.get(
                f"{settings.INVENTORY_SERVICE_URL}/items/{item_id}",
                headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
            )
        payload = response.json() if response.status_code == 200 else None
    except (httpx.HTTPError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def _spec_in_stock_unit(spec: float, posted_unit: Any, stock_item: Optional[dict[str, Any]]) -> tuple[float, str]:
    """A posted spec in the stock item's own unit when it can be converted (kg → litre by the item's kg per
    litre), the same rule the month-end page applies; otherwise the posted figure and its own unit."""
    unit = _consumption_normalize_uom(posted_unit or "KG")
    uom = _consumption_normalize_uom((stock_item or {}).get("uom")) if stock_item else unit
    if uom == "L" and unit == "KG":
        density = float((stock_item or {}).get("density_kg_per_litre") or 0.0)
        if density > 0:
            return spec / density, "L"
    return spec, unit


class _BooksCallUnanswered(HTTPException):
    """The store did not answer a lock / unlock call: it may or may not have done it."""


def _inventory_books_call(token: str, plant_id: str, action: str, body: dict[str, Any]) -> dict[str, Any]:
    """POST /inventory/books/lock|unlock with the Owner's own token (service to service, spec 5)."""
    verb = "closed" if action == "lock" else "re-opened"
    try:
        with httpx.Client(timeout=20.0) as client:
            response = client.post(
                f"{settings.INVENTORY_SERVICE_URL}/inventory/books/{action}",
                json=body,
                headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
            )
    except httpx.HTTPError as exc:
        raise _BooksCallUnanswered(502, f"The store did not answer, so its books may not be {verb}.") from exc
    if response.status_code >= 300:
        try:
            detail = (response.json() or {}).get("detail")
        except ValueError:
            detail = None
        message = detail if isinstance(detail, str) and detail else f"The store books could not be {verb}."
        raise HTTPException(502 if response.status_code >= 500 else response.status_code, message)
    try:
        return response.json() or {}
    except ValueError:
        return {}


def _try_books_call(token: str, plant_id: str, action: str, body: dict[str, Any]) -> bool:
    """A compensating lock / unlock (both are idempotent in inventory); True when the store confirmed it."""
    try:
        _inventory_books_call(token, plant_id, action, body)
        return True
    except HTTPException:
        return False


def _backfill_spec_posting_days(db: Session, plant: uuid.UUID) -> int:
    """Spec rows posted before IST dating (no ``posted_on``) get the IST day of their stage close. A row
    filed under the UTC month by mistake (stage closed 00:00–05:29 IST on the 1st) moves to its IST month
    when both months are open and the card has no row for that material there. Rows in a closed month and
    rows whose card has no dated stage are left as they are. Idempotent; returns rows changed."""
    rows = db.query(MonthlyMaterialProvisional).filter(MonthlyMaterialProvisional.plant_id == plant).all()
    legacy = [row for row in rows if not (row.snapshot or {}).get("posted_on")]
    if not legacy:
        return 0
    closed = _closed_month_set(db, plant)
    stage_closed: dict[tuple[Any, str], datetime] = {}
    for stage in db.query(JobCardStage).filter(JobCardStage.job_card_id.in_({row.job_card_id for row in legacy})).all():
        when = stage.actual_end or stage.entered_at or stage.actual_start
        if when is not None:
            stage_closed[(stage.job_card_id, str(stage.stage_type or "").upper())] = when
    taken = {(row.job_card_id, str(row.item_code or "").upper(), row.month_start) for row in rows}
    changed = 0
    for row in legacy:
        when = stage_closed.get((row.job_card_id, str(row.source_stage or "").upper()))
        if when is None or row.month_start in closed:
            continue
        day = _consumption_ist_day(when)
        target = day.replace(day=1)
        snapshot = dict(row.snapshot or {})
        snapshot.update(posted_on=day.isoformat(), stage_closed_at=when.isoformat(), posted_on_backfilled=True)
        code = str(row.item_code or "").upper()
        if target != row.month_start and target not in closed and (row.job_card_id, code, target) not in taken:
            taken.discard((row.job_card_id, code, row.month_start))
            taken.add((row.job_card_id, code, target))
            snapshot["moved_from_month"] = _consumption_month_key(row.month_start)
            row.month_start = target
        row.snapshot = snapshot
        changed += 1
    if changed:
        db.commit()
    return changed


_spec_days_checked: set[str] = set()


def _backfill_spec_posting_days_once(db: Session, plant: uuid.UUID) -> None:
    """Run the legacy spec-day backfill once per plant and process, before the month-end page reads."""
    key = str(plant)
    if key in _spec_days_checked:
        return
    try:
        _backfill_spec_posting_days(db, plant)
        _spec_days_checked.add(key)
    except Exception:  # never let a data repair stop the page; it is tried again on the next read
        db.rollback()


def _spec_rows_for_month(db: Session, plant: uuid.UUID, month: date) -> list[MonthlyMaterialProvisional]:
    return (
        db.query(MonthlyMaterialProvisional)
        .filter(MonthlyMaterialProvisional.plant_id == plant, MonthlyMaterialProvisional.month_start == month)
        .all()
    )


def _aggregate_spec(rows: list[MonthlyMaterialProvisional]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        code = str(row.item_code or "").strip().upper()
        if not code:
            continue
        snapshot = dict(row.snapshot or {})
        bucket = out.setdefault(code, {"qty": 0.0, "item_name": row.item_name, "unit": None, "cards": set(), "posted_after_close": 0})
        bucket["qty"] += float(row.provisional_theory_consumption_kg or 0.0)
        bucket["cards"].add(str(row.job_card_id))
        if snapshot.get("unit") and not bucket["unit"]:
            bucket["unit"] = str(snapshot["unit"]).upper()
        if snapshot.get("posted_after_close"):
            bucket["posted_after_close"] += 1
        if not bucket.get("item_name") and row.item_name:
            bucket["item_name"] = row.item_name
    return out


_UNLINKED_FIX_BY_TYPE = {
    "RAW_PAPER": ("Paper", "Link the paper in Masters › Papers", "/masters/papers"),
    "PARCHMENT": ("Parchment", "Link the colour in Masters › Parchments", "/masters/parchments"),
    "ADHESIVE": ("Adhesive", "Set its stock item code in Masters › Adhesives", "/masters/adhesives"),
    "PACKAGING": ("Packing", "Set the box / sheet code in Masters › Packaging", "/masters/packaging"),
}


def _unlinked_fix(code: str, unit: Optional[str], item_type: Optional[str] = None) -> tuple[str, str, str]:
    """Where the stock link of a spec material is set: (kind, fix label, fix link). When a stock item has
    the code, its own type decides (a packing item stays packing whatever unit the spec came in)."""
    known = _UNLINKED_FIX_BY_TYPE.get(str(item_type or "").strip().upper())
    if known:
        return known
    if item_type:
        return "Other", "Check the item in Inventory › Items", "/inventory/items"
    if unit:
        return "Packing", "Set the box / sheet code in Masters › Packaging", "/masters/packaging"
    if code.startswith("PARCHMENT"):
        return "Parchment", "Link the colour in Masters › Parchments", "/masters/parchments"
    if code.startswith("KRAFT") or "PAPER" in code:
        return "Paper", "Link the paper in Masters › Papers", "/masters/papers"
    return "Adhesive", "Set its stock item code in Masters › Adhesives", "/masters/adhesives"


def _book_problem_words(figures: Optional[dict[str, Any]], row: dict[str, Any]) -> Optional[str]:
    """Why an item's store book does not add up, in plain words (None when it does): the store's own
    check (identity, lots below zero, ledger), and never a closing below zero."""
    if figures is None:
        return None
    closing = float(row.get("closing") or 0.0)
    if closing < -0.0005:
        return "Closing stock is below zero"
    if row.get("identity_ok") is False:
        return str(figures.get("book_problem_word") or "The store figures do not add up")
    return None


def _fetch_certified_closings(token: str, plant_id: str, count_id: str) -> Optional[dict[str, float]]:
    """The closing per item the approved month-end count certified (its certificate lines: closing before
    the count + the count's variance). None when the store does not answer."""
    try:
        with httpx.Client(timeout=20.0) as client:
            response = client.get(
                f"{settings.INVENTORY_SERVICE_URL}/inventory/stock-control/certifications/{count_id}",
                headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
            )
    except httpx.HTTPError:
        return None
    if response.status_code != 200:
        return None
    try:
        payload = response.json() or {}
    except ValueError:
        return None
    out: dict[str, float] = {}
    for line in payload.get("lines") or []:
        if not isinstance(line, dict) or not line.get("item_id"):
            continue
        value = line.get("physical_qty")
        if value is None:
            value = line.get("closing_qty")
        out[str(line["item_id"])] = out.get(str(line["item_id"]), 0.0) + float(value or 0.0)
    return out


def _fetch_count_start_note(token: str, plant_id: str, month: date) -> Optional[str]:
    """Why the store will not start a month-end count of ``month`` now (its own words), from the counts
    list's month-end cards; None when it can start, or when the store does not say."""
    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.get(
                f"{settings.INVENTORY_SERVICE_URL}/inventory/counts",
                params={"limit": 1, "kind": "MONTH_END"},
                headers={"Authorization": f"Bearer {token}", "X-Plant-ID": plant_id},
            )
        payload = response.json() if response.status_code == 200 else {}
    except (httpx.HTTPError, ValueError):
        return None
    key = _consumption_month_key(month)
    for state in (payload or {}).get("month_end") or []:
        if isinstance(state, dict) and state.get("month") == key and not state.get("count") and not state.get("can_start") and state.get("note"):
            return str(state["note"])
    return None


def _count_payload(count: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    if not isinstance(count, dict) or not count:
        return None
    status = str(count.get("status") or "").upper() or None
    return {
        "id": count.get("id"),
        "count_no": count.get("count_no") or count.get("count_session_no"),
        "status": status,
        "approved": status in COUNT_APPROVED_STATUSES,
        "approved_by": count.get("approved_by"),
        "approved_at": count.get("approved_at"),
        "counted_by": count.get("counted_by"),
        "progress": count.get("progress"),
    }


def _count_step(
    month: date,
    running: bool,
    figures_available: bool,
    count: Optional[dict[str, Any]],
    *,
    later_closed: Optional[list[date]] = None,
    store_empty: bool = False,
    store_note: Optional[Any] = None,
    changed_since_count: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    """The "Month-end count approved" step. An ended month the store will not count (a later month is
    closed, nothing was ever in the store, or the store's own reason) says why instead of offering a count
    that would be refused. ``store_note`` is called only when it is needed (it is one store call)."""
    word = _month_word(month)
    key = _consumption_month_key(month)
    step: dict[str, Any] = {"key": "count", "label": "Month-end count approved"}
    if count and count.get("approved"):
        when = str(count.get("approved_at") or "")[:10]
        try:
            when_text = _day_label(date.fromisoformat(when)) if when else ""
        except ValueError:
            when_text = when
        by = _person(count.get("approved_by")) if count.get("approved_by") else None
        step.update(
            state="done",
            detail=f"Count {count.get('count_no') or ''} approved{(' ' + when_text) if when_text else ''}{(' by ' + by) if by else ''}.".replace("Count  ", "Count "),
            action_label="Open the count",
            action_href=f"/inventory/counts/{count['id']}" if count.get("id") else f"/inventory/stock-control?tab=counts&month={key}",
        )
        if changed_since_count:
            first = changed_since_count[0]
            more = len(changed_since_count) - 1
            step["warning"] = (
                f"Store entries dated in {word} were posted after this count was approved. "
                f"{first['item_name']}: counted {_qty_words(first['counted'], first['unit_label'])}, closing now "
                f"{_qty_words(first['closing'], first['unit_label'])}"
                + (f", and {more} more item{'s' if more != 1 else ''}" if more else "")
                + ". Closing asks you to accept the new closing."
            )
        return step
    if not figures_available:
        step.update(state="todo", detail="Store figures are not available yet, so the count cannot be read.")
        return step
    if count and count.get("id"):
        status = count.get("status")
        if status == "SUBMITTED":
            detail = "Counted and submitted. Waiting for the Owner to approve it."
            label = "Review the count"
        else:
            detail = "Counting has started. Submit it when every rack is done."
            label = "Open the count"
        step.update(state="todo", detail=detail, action_label=label, action_href=f"/inventory/counts/{count['id']}")
        return step
    if running:
        step.update(state="todo", detail=f"Count the store when {word} ends.", action_label=f"Plan the {word} count",
                    action_href=f"/inventory/stock-control?tab=counts&month={key}")
        return step
    if later_closed:
        last, first_later = max(later_closed), min(later_closed)
        step.update(
            state="todo",
            detail=(f"{_consumption_month_label(last)} is already closed, so {word} can no longer be counted. "
                    f"Re-open {_consumption_month_label(first_later)} first."),
            action_label=f"Open {_consumption_month_label(first_later)}",
            action_href=f"?month={_consumption_month_key(first_later)}",
            blocked=True,
        )
        return step
    if store_empty:
        step.update(state="todo", detail=f"The store had no stock and no movement in {word}, so there is nothing to count.", blocked=True)
        return step
    note = store_note() if callable(store_note) else store_note
    if note:
        step.update(state="todo", detail=str(note), blocked=True)
        return step
    step.update(state="todo", detail=f"The {word} month-end count has not started yet.", action_label=f"Count {word} stock",
                action_href=f"/inventory/stock-control?tab=counts&month={key}")
    return step


def _book_step(month: date, running: bool, body: dict[str, Any]) -> dict[str, Any]:
    """"Store book adds up": every item's closing = opening + received − sent back − issued ± corrections
    by the store's own checks, and no closing below zero. A month never closes on a book that does not
    add up (its frozen figures would be wrong for good)."""
    key = _consumption_month_key(month)
    step: dict[str, Any] = {"key": "book", "label": "Store book adds up"}
    if not body.get("figures_available"):
        step.update(state="todo", detail="Store figures are not available yet, so the store book cannot be checked.")
        return step
    problems = body.get("book_problems") or []
    if problems:
        first = problems[0]
        more = len(problems) - 1
        closing = first.get("closing")
        detail = (f"{first['item_name']}: {str(first['problem']).lower()}"
                  + (f" (closing {_qty_words(closing, first['unit_label'])})" if closing is not None else "")
                  + (f", and {more} more item{'s' if more != 1 else ''}" if more else "")
                  + ".")
        step.update(
            state="todo",
            detail=f"{len(problems)} item{'s do' if len(problems) != 1 else ' does'} not add up. {detail}",
            action_label="Open the stock book",
            action_href=f"/inventory/stock-control?tab=book&month={key}",
            items=[row["item_code"] for row in problems],
        )
        return step
    step.update(state="done", detail="Every item adds up so far." if running else "Every item adds up and no stock is below zero.")
    return step


def _qty_words(value: Any, unit_label: str) -> str:
    """"1,234.5 kg" (en-IN grouping, up to 3 decimals, no trailing zeros)."""
    number = round(float(value or 0.0), 3)
    sign = "−" if number < 0 else ""
    whole, _, fraction = f"{abs(number):.3f}".partition(".")
    fraction = fraction.rstrip("0")
    head, tail = whole[:-3], whole[-3:]
    groups: list[str] = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    grouped = ",".join([*groups, tail]) if groups else tail
    return f"{sign}{grouped}{('.' + fraction) if fraction else ''} {unit_label}".strip()


def _build_live_month_view(
    db: Session,
    plant: uuid.UUID,
    month: date,
    current_user: dict,
    *,
    catalog: Optional[dict[str, dict[str, Any]]] = None,
    limits: Optional[dict[str, dict[str, Any]]] = None,
    today: Optional[date] = None,
    memo: Optional[dict[date, Any]] = None,
    check_count: bool = False,
    reuse: bool = False,
) -> dict[str, Any]:
    """Every figure of one plant-month worked out from the live books (not the frozen snapshot).

    ``check_count`` also compares each closing with the closing the approved month-end count certified,
    so store entries dated in the month but posted after the approval are shown (one store call).
    ``reuse`` accepts the store's figures of an ended month read a moment ago (see the figures cache)."""
    from ..services.usage_limits import usage_limit_type, usage_limits_for_plant

    today = today or _consumption_ist_today()
    current_month = today.replace(day=1)
    if month > current_month:
        raise HTTPException(status_code=422, detail=f"{_consumption_month_label(month)} has not started yet.")
    running = month == current_month
    token = current_user.get("token", "")
    plant_text = str(plant)
    figures_payload = _month_figures_memo(token, plant_text, month, memo, reuse=reuse and not running)
    figures_available = figures_payload is not None
    if catalog is None:
        catalog = _fetch_inventory_item_catalog(token, plant_text)
    limits = limits or usage_limits_for_plant(db, plant)
    notes = {
        str(row.item_code).strip().upper(): row
        for row in db.query(MonthlyMaterialNote).filter(MonthlyMaterialNote.plant_id == plant, MonthlyMaterialNote.month_start == month).all()
    }
    spec = _aggregate_spec(_spec_rows_for_month(db, plant, month))
    figure_items: dict[str, dict[str, Any]] = {}
    for row in (figures_payload or {}).get("items") or []:
        if isinstance(row, dict):
            code = str(row.get("item_code") or "").strip().upper()
            if code:
                figure_items[code] = row
    count = _count_payload((figures_payload or {}).get("month_end_count"))
    count_approved = bool(count and count.get("approved"))
    actual_known = bool(figures_available and count_approved and not running)

    items: list[dict[str, Any]] = []
    unlinked: list[dict[str, Any]] = []
    for code in sorted(set(figure_items) | set(spec)):
        figures = figure_items.get(code)
        stock_item = catalog.get(code) or {}
        spec_bucket = spec.get(code)
        if figures is None and not stock_item:
            fix_kind, fix_label, fix_href = _unlinked_fix(code, spec_bucket.get("unit"))
            unlinked.append({
                "link": "NO_STOCK_ITEM",
                "item_code": code,
                "item_name": spec_bucket.get("item_name"),
                "spec": round(float(spec_bucket["qty"]), 3),
                "uom": _consumption_normalize_uom(spec_bucket.get("unit") or "KG"),
                "unit_label": _consumption_unit_label(spec_bucket.get("unit") or "KG"),
                "job_cards": len(spec_bucket["cards"]),
                "kind": fix_kind,
                "reason": "No stock item has this code, so its use can never be counted.",
                "fix_label": fix_label,
                "fix_href": fix_href,
            })
            continue
        item_type = str((figures or {}).get("item_type") or stock_item.get("type") or "").strip().upper() or None
        uom = _consumption_normalize_uom((figures or {}).get("uom") or stock_item.get("uom"))
        spec_qty = float(spec_bucket["qty"]) if spec_bucket else 0.0
        spec_unlinked: Optional[dict[str, Any]] = None
        if spec_bucket and spec_qty:
            posted_unit = _consumption_normalize_uom(spec_bucket.get("unit") or "KG")
            if uom == "L" and posted_unit == "KG":
                density = float(stock_item.get("density_kg_per_litre") or 0.0)
                if density > 0:
                    spec_qty /= density
                    posted_unit = "L"
            if posted_unit != uom:
                fix_kind, fix_label, fix_href = _unlinked_fix(code, spec_bucket.get("unit"), item_type)
                unlinked.append({
                    "link": "UNIT_DIFFERS",
                    "item_code": code,
                    "item_name": spec_bucket.get("item_name") or stock_item.get("name"),
                    "spec": round(float(spec_bucket["qty"]), 3),
                    "uom": posted_unit,
                    "unit_label": _consumption_unit_label(posted_unit),
                    "job_cards": len(spec_bucket["cards"]),
                    "kind": fix_kind,
                    "reason": f"The spec is in {_consumption_unit_label(posted_unit)} but the stock item counts in {_consumption_unit_label(uom)}.",
                    "fix_label": "Set the unit (or kg per litre) on the stock item" if uom == "L" else fix_label,
                    "fix_href": "/inventory/items" if uom == "L" else fix_href,
                })
                spec_unlinked = {
                    "spec": round(float(spec_bucket["qty"]), 3),
                    "unit_label": _consumption_unit_label(posted_unit),
                    "job_cards": len(spec_bucket["cards"]),
                }
                spec_qty = 0.0
        material_type = usage_limit_type(item_type)
        row = _consumption_month_end_item_row(
            figures=figures, spec_qty=spec_qty, limits=limits[material_type], actual_known=actual_known,
        )
        note_row = notes.get(code)
        note = (
            {"note": note_row.note, "noted_by": note_row.noted_by, "noted_at": _iso(note_row.noted_at)}
            if note_row is not None
            else None
        )
        row.update({
            "item_id": str((figures or {}).get("item_id") or stock_item.get("id") or "") or None,
            "item_code": code,
            "item_name": (figures or {}).get("item_name") or stock_item.get("name") or (spec_bucket or {}).get("item_name") or code,
            "item_type": item_type,
            "material_type": material_type,
            "material_label": limits[material_type]["label"],
            "uom": uom,
            "unit_label": _consumption_unit_label(uom),
            "job_cards": len(spec_bucket["cards"]) if spec_bucket else 0,
            "posted_after_close": int(spec_bucket["posted_after_close"]) if spec_bucket else 0,
            "note": note,
            "needs_note": row["status"] in ("OVER", "UNDER") and note is None,
            "spec_unlinked": spec_unlinked,
            "book_problem": _book_problem_words(figures, row),
            "changed_since_count": None,
        })
        items.append(row)

    changed_since_count: Optional[list[dict[str, Any]]] = None
    if check_count and actual_known and count and count.get("id"):
        certified = _fetch_certified_closings(token, plant_text, str(count["id"]))
        if certified is not None:
            changed_since_count = []
            for row in items:
                counted = certified.get(str(row.get("item_id") or ""), 0.0)
                closing = float(row.get("closing") or 0.0)
                if abs(closing - counted) > 0.0005:
                    row["changed_since_count"] = {"counted": round(counted, 3), "closing": round(closing, 3)}
                    changed_since_count.append({
                        "item_code": row["item_code"], "item_name": row["item_name"], "unit_label": row["unit_label"],
                        "counted": round(counted, 3), "closing": round(closing, 3),
                    })

    units = _consumption_unit_totals(items, actual_known=actual_known)
    return {
        "figures_available": figures_available,
        "book_problems": [
            {"item_code": row["item_code"], "item_name": row["item_name"], "unit_label": row["unit_label"],
             "closing": row.get("closing"), "problem": row["book_problem"]}
            for row in items if row.get("book_problem")
        ],
        "changed_since_count": changed_since_count,
        "opening_source": (figures_payload or {}).get("opening_source"),
        "count": count,
        "actual_known": actual_known,
        "running": running,
        "items": items,
        "unlinked": sorted(unlinked, key=lambda row: (-float(row["spec"] or 0), row["item_code"])),
        "units": units,
        "limits": [dict(value) for value in limits.values()],
    }


def _figures_signature(view: dict[str, Any]) -> dict[str, list[Optional[float]]]:
    return {
        str(row.get("item_code")): [row.get(key) for key in _FIGURE_COMPARE_KEYS]
        for row in view.get("items") or []
    }


def _snapshot_hash(view: dict[str, Any]) -> str:
    import hashlib
    import json

    material = {
        "items": _figures_signature(view),
        "unlinked": {row["item_code"]: row["spec"] for row in view.get("unlinked") or []},
        "notes": {str(row.get("item_code")): (row.get("note") or {}).get("note") for row in view.get("items") or [] if row.get("note")},
    }
    return hashlib.sha256(json.dumps(material, sort_keys=True, default=str).encode()).hexdigest()


def _changed_items(snapshot: dict[str, Any], live: dict[str, Any]) -> list[str]:
    before = _figures_signature(snapshot)
    after = _figures_signature(live)
    changed: list[str] = []
    for code in sorted(set(before) | set(after)):
        old = before.get(code) or [0.0] * len(_FIGURE_COMPARE_KEYS)
        new = after.get(code) or [0.0] * len(_FIGURE_COMPARE_KEYS)
        if any(abs(float(a or 0.0) - float(b or 0.0)) > 0.0005 for a, b in zip(old, new)):
            changed.append(code)
    return changed


def _month_end_view(
    db: Session, plant: uuid.UUID, month: date, current_user: dict, *, today: Optional[date] = None, fresh: bool = False,
) -> dict[str, Any]:
    """The month-end page for one plant and month: the frozen snapshot of a closed month, otherwise the
    live figures, plus the checklist, the one Next action and what the viewer may do. ``fresh`` probes
    every earlier month in the store again (the close decision), instead of the short-lived hint."""
    today = today or _consumption_ist_today()
    rows_by_month = _close_rows_by_month(db, plant)
    close_row = rows_by_month.get(month)
    closed = bool(close_row and close_row.status == CLOSED_STATUS)
    word = _month_word(month)
    label = _consumption_month_label(month)
    key = _consumption_month_key(month)
    month_end = _consumption_last_day(month)
    is_fy_close = month.month == 3
    fy_label = _consumption_fy_label(month)
    is_owner = _is_actual_owner(current_user)

    frozen = bool(closed and close_row.snapshot)
    changed_after_close: Optional[list[str]] = None
    memo: dict[date, Any] = {}
    if frozen:
        body = dict(close_row.snapshot or {})
        try:
            live = _build_live_month_view(db, plant, month, current_user, today=today, memo=memo)
            changed_after_close = _changed_items(body, live) if live.get("figures_available") else None
        except HTTPException:
            changed_after_close = None
    else:
        body = _build_live_month_view(db, plant, month, current_user, today=today, memo=memo, check_count=True)
    running = bool(body.get("running")) and not closed

    items = body.get("items") or []
    # Frozen snapshots taken before the floor split existed get it from their own items.
    body["units"] = _consumption_with_floor_split(body.get("units") or [], items)
    needs_note = [row for row in items if row.get("needs_note")]
    explained = [row for row in items if row.get("status") in ("OVER", "UNDER") and row.get("note")]
    # A closed month lists them too: an earlier month that is open with activity (a count or GRN dated
    # there after this close) changes this month's opening, so the page names it next to "changed after
    # close" (checker r2: Plant B July open under closed August/September, with no word of it).
    store_months = _store_activity_months(db, plant, current_user.get("token", ""), current=today.replace(day=1), memo=memo, fresh=fresh and not closed)
    earlier_open = _earlier_open_months(db, plant, month, store_months)
    later_closed = _later_closed_months(db, plant, month)
    count = body.get("count")

    if closed:
        steps = [{**step, "state": "done"} for step in (body.get("checklist") or [])] or [
            {"key": "month_ended", "label": "Month ended", "state": "done", "detail": f"{word} ended on {_day_label(month_end)}."},
            {"key": "count", "label": "Month-end count approved", "state": "done", "detail": "Closed before the month-end count was part of the close."},
            {"key": "notes", "label": "Notes on items outside the limit", "state": "done", "detail": "Closed before frozen figures were kept; the figures below are live."},
            {"key": "earlier", "label": "Earlier months closed", "state": "done", "detail": "Closed in order."},
        ]
        if earlier_open:
            # The frozen step said "No earlier month is open" at the close; say what is true now.
            again = f"Closed in order. {_consumption_month_label(earlier_open[0])} has entries and is open again."
            steps = [{**step, "detail": again} if step.get("key") == "earlier" else step for step in steps]
    else:
        steps = []
        if running:
            steps.append({"key": "month_ended", "label": "Month ended", "state": "todo",
                          "detail": f"{word} is still running. It can be closed from 1 {_MONTH_ABBR[_next_month(month).month - 1]}."})
        else:
            steps.append({"key": "month_ended", "label": "Month ended", "state": "done", "detail": f"{word} ended on {_day_label(month_end)}."})
        moved, stock_at_start = _store_month_state(memo.get(month)) if memo.get(month) is not None else (True, True)
        steps.append(_count_step(
            month, running, bool(body.get("figures_available")), count,
            later_closed=later_closed,
            store_empty=bool(body.get("figures_available")) and not moved and not stock_at_start,
            store_note=lambda: _fetch_count_start_note(current_user.get("token", ""), str(plant), month),
            changed_since_count=body.get("changed_since_count"),
        ))
        steps.append(_book_step(month, running, body))
        if not body.get("actual_known"):
            steps.append({"key": "notes", "label": "Notes on items outside the limit", "state": "todo",
                          "detail": "Waiting for the count. Notes open once the month-end count is approved."})
        elif needs_note:
            many = len(needs_note) != 1
            steps.append({"key": "notes", "label": "Notes on items outside the limit", "state": "todo",
                          "detail": f"{len(needs_note)} item{'s are' if many else ' is'} outside the limit and need{'' if many else 's'} a short note.",
                          "action_label": f"Go to the {len(needs_note)} item{'s' if many else ''}", "action_href": "#needs-note"})
        else:
            steps.append({"key": "notes", "label": "Notes on items outside the limit", "state": "done",
                          "detail": "Every item is within its limit." if not explained else f"All within limit or explained ({len(explained)} with a note)."})
        if earlier_open:
            first = earlier_open[0]
            steps.append({"key": "earlier", "label": "Earlier months closed", "state": "todo",
                          "detail": f"{_consumption_month_label(first)} is still open. Close it first.",
                          "action_label": f"Open {_consumption_month_label(first)}", "action_href": f"?month={_consumption_month_key(first)}"})
        else:
            steps.append({"key": "earlier", "label": "Earlier months closed", "state": "done", "detail": "No earlier month is open."})
        first_open = next((index for index, step in enumerate(steps) if step["state"] != "done"), None)
        if first_open is not None:
            steps[first_open]["state"] = "now"

    done = sum(1 for step in steps if step["state"] == "done")
    ready = not closed and all(step["state"] == "done" for step in steps)
    close_title = f"Financial year close {fy_label}" if is_fy_close else f"Close {label}"

    if closed:
        when = _day_label(_consumption_ist_day(close_row.closed_at or close_row.approved_at)) if (close_row.closed_at or close_row.approved_at) else None
        next_action = {
            "kind": "closed",
            "title": f"{label} is closed" + (f" · Financial year {fy_label} closed" if is_fy_close else ""),
            "detail": f"Closed{(' ' + when) if when else ''} by {_person(close_row.closed_by or close_row.approved_by)}. "
                      f"Floor and store entries dated in {word} are locked.",
            "action_label": "Re-open month" if is_owner else None,
        }
    elif ready:
        next_action = {
            "kind": "close",
            "title": close_title,
            "detail": (f"Everything is ready. Closing freezes these figures and locks floor and store entries dated in {word}."
                       + (f" It also closes the financial year {fy_label}; 1 April opens from this close." if is_fy_close else "")),
            "action_label": close_title if is_owner else None,
            "waiting_for": None if is_owner else "Only the Owner can close the month.",
        }
    else:
        step = next(step for step in steps if step["state"] == "now")
        titles = {
            "month_ended": f"{word} is still running",
            "count": (f"{word} cannot be counted now" if step.get("blocked")
                      else f"Next: count {word} stock" if (step.get("action_label") or "").startswith(("Count", "Plan"))
                      else f"Next: {(step.get('action_label') or 'the month-end count').lower()}"),
            "book": "Next: fix the store book",
            "notes": "Next: wait for the count" if not body.get("actual_known") else f"Next: write a note on {len(needs_note)} item{'s' if len(needs_note) != 1 else ''}",
            "earlier": f"Next: close {_consumption_month_label(earlier_open[0])} first" if earlier_open else "",
        }
        details = {
            "month_ended": "Nothing to close yet. The floor gap below is so far; actual use is known after the month-end count.",
            "notes": "Say why more or less material was used than the spec allows. One line is enough." if body.get("actual_known") else step["detail"],
            "book": step["detail"] + " Month-end waits until every item adds up.",
        }
        next_action = {
            "kind": step["key"],
            "title": titles.get(step["key"]) or step["label"],
            "detail": details.get(step["key"], step["detail"]),
            "action_label": step.get("action_label"),
            "action_href": step.get("action_href"),
        }

    close_info = None
    if close_row is not None and (close_row.closed_at or close_row.approved_at or close_row.reopened_at):
        close_info = {
            "status": "CLOSED" if closed else "REOPENED" if close_row.reopened_at else str(close_row.status or "OPEN"),
            "closed_by": close_row.closed_by or close_row.approved_by,
            "closed_at": _iso(close_row.closed_at or close_row.approved_at),
            "close_note": close_row.close_note or close_row.notes,
            "version": int(close_row.version or 1),
            "snapshot_at": _iso(close_row.snapshot_at),
            "reopened_by": close_row.reopened_by,
            "reopened_at": _iso(close_row.reopened_at),
            "reopen_reason": close_row.reopen_reason,
        }
    events = (
        db.query(MonthlyCloseEvent)
        .filter(MonthlyCloseEvent.plant_id == plant, MonthlyCloseEvent.month_start == month)
        .order_by(MonthlyCloseEvent.created_at.desc())
        .limit(20)
        .all()
    )

    return {
        **{k: v for k, v in body.items() if k not in ("checklist", "next", "progress", "state", "can", "history", "close")},
        "plant_id": str(plant),
        "month": key,
        "month_label": label,
        "month_word": word,
        "period_start": month.isoformat(),
        "period_end": month_end.isoformat(),
        "fy": fy_label,
        "is_fy_close": is_fy_close,
        "close_title": close_title,
        "state": "CLOSED" if closed else "RUNNING" if running else "OPEN",
        "frozen": frozen,
        "changed_after_close": changed_after_close,
        "checklist": steps,
        "progress": {"done": done, "total": len(steps)},
        "next": next_action,
        "close": close_info,
        "history": [
            {"event": row.event, "actor": row.actor, "reason": row.reason, "at": _iso(row.created_at), "details": row.details or {}}
            for row in events
        ],
        "earlier_open_months": [_consumption_month_key(value) for value in earlier_open],
        "later_closed_months": [_consumption_month_key(value) for value in later_closed],
        "can": {
            "close": is_owner and ready,
            "reopen": is_owner and closed,
            "note": _can_write_month_notes(current_user) and bool(body.get("actual_known")) and not closed,
            "edit_limits": _can_edit_usage_limits(current_user),
            "is_owner": is_owner,
        },
    }


def _snapshot_from_view(view: dict[str, Any], *, closed_by: str, closed_at: datetime) -> dict[str, Any]:
    keep = (
        "figures_available", "opening_source", "count", "actual_known", "running", "items", "unlinked", "units",
        "limits", "checklist", "month", "month_label", "period_start", "period_end", "fy", "is_fy_close",
        "book_problems", "changed_since_count",
    )
    snapshot = {key: view.get(key) for key in keep}
    snapshot["running"] = False
    snapshot["closed_by"] = closed_by
    snapshot["closed_at"] = closed_at.isoformat()
    snapshot["hash"] = _snapshot_hash(view)
    return snapshot


def _plant_month_lock(db: Session, plant: uuid.UUID) -> None:
    """Close / re-open of one plant run one at a time (transaction-scoped advisory lock)."""
    from sqlalchemy import text as _sql_text

    db.execute(_sql_text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"month-end:{plant}"})


def _close_month(
    db: Session, plant: uuid.UUID, month: date, current_user: dict, note: Optional[str], *, accept_count_changes: bool = False,
) -> MonthlyMaterialClose:
    """Owner close: every checklist step must be done; the store books lock first, then the frozen
    snapshot, the close row and a CLOSED history event commit together. Idempotent for a closed month.

    When store entries dated in the month were posted after its month-end count was approved, the
    closings differ from what the count certified: the Owner must accept them (``accept_count_changes``),
    and the accepted items are kept with the close."""
    _plant_month_lock(db, plant)
    rows_by_month = _close_rows_by_month(db, plant)
    existing = rows_by_month.get(month)
    if existing is not None and existing.status == CLOSED_STATUS:
        return existing
    _store_state_cache_clear(plant)
    view = _month_end_view(db, plant, month, current_user, fresh=True)
    pending = [step for step in view["checklist"] if step["state"] != "done"]
    if pending:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "MONTH_NOT_READY",
                "message": f"{view['month_label']} cannot be closed yet: {pending[0]['detail']}",
                "steps": pending,
            },
        )
    changed = view.get("changed_since_count") or []
    if changed and not accept_count_changes:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "COUNT_CHANGED",
                "message": (f"Store entries dated in {view['month_word']} were posted after the month-end count was approved, "
                            f"so {len(changed)} closing{'s differ' if len(changed) != 1 else ' differs'} from the count. "
                            "Accept the new closing to close the month."),
                "items": changed,
            },
        )
    actor = str(current_user.get("actor_identity") or current_user.get("sub") or current_user.get("email") or "owner")
    token = current_user.get("token", "")
    key = _consumption_month_key(month)
    clean_note = (note or "").strip() or None
    label = _consumption_month_label(month)
    try:
        _inventory_books_call(token, str(plant), "lock", {"month": key, **({"note": clean_note[:500]} if clean_note else {})})
    except _BooksCallUnanswered as exc:
        # The store may have locked the month before its answer was lost: give it back so both services
        # agree that the month is still open, and say plainly what happened.
        released = _try_books_call(token, str(plant), "unlock", {"month": key, "reason": "Close did not complete (no answer from the store)"})
        raise HTTPException(
            status_code=502,
            detail=(f"The store did not answer, so {label} was not closed. Try again in a minute."
                    if released else
                    f"The store did not answer, so {label} was not closed here, but the store may already treat it "
                    f"as closed. Press Close again to finish the close."),
        ) from exc
    now = datetime.utcnow()
    try:
        row = existing
        if row is None:
            row = MonthlyMaterialClose(plant_id=plant, month_start=month, status="DRAFT", imported_rows_count=0, version=1)
            db.add(row)
        elif row.reopened_at:
            row.version = int(row.version or 1) + 1
        snapshot = _snapshot_from_view(view, closed_by=actor, closed_at=now)
        row.status = CLOSED_STATUS
        row.approved_by = actor
        row.approved_at = now
        row.locked_at = now
        row.notes = clean_note
        row.closed_by = actor
        row.closed_at = now
        row.close_note = clean_note
        row.snapshot = snapshot
        row.snapshot_at = now
        db.add(MonthlyCloseEvent(
            plant_id=plant, month_start=month, event="CLOSED", actor=actor, reason=clean_note,
            snapshot_hash=snapshot["hash"],
            details={
                "version": int(row.version or 1),
                "items": len(snapshot.get("items") or []),
                "explained": sum(1 for item in snapshot.get("items") or [] if item.get("status") in ("OVER", "UNDER") and item.get("note")),
                "financial_year_close": snapshot.get("fy") if view.get("is_fy_close") else None,
                "accepted_after_count": [row["item_code"] for row in changed] or None,
            },
        ))
        db.commit()
    except Exception:
        db.rollback()
        # The production close failed after the store locked: give the store month back.
        _try_books_call(token, str(plant), "unlock", {"month": key, "reason": "Production close did not complete"})
        raise
    db.refresh(row)
    return row


def _reopen_month(db: Session, plant: uuid.UUID, month: date, current_user: dict, reason: str) -> list[date]:
    """Owner re-open with a reason. Later closed months re-open too, newest first, each one store side
    first and then production, so both services always agree month by month."""
    _plant_month_lock(db, plant)
    rows_by_month = _close_rows_by_month(db, plant)
    target = rows_by_month.get(month)
    if target is None or target.status != CLOSED_STATUS:
        raise HTTPException(status_code=409, detail=f"{_consumption_month_label(month)} is not closed.")
    _store_state_cache_clear(plant)
    actor = str(current_user.get("actor_identity") or current_user.get("sub") or current_user.get("email") or "owner")
    token = current_user.get("token", "")
    cascade = sorted((value for value, row in rows_by_month.items() if value >= month and row.status == CLOSED_STATUS), reverse=True)
    reopened: list[date] = []
    for value in cascade:
        row = rows_by_month[value]
        key = _consumption_month_key(value)
        label = _consumption_month_label(value)
        why = reason if value == month else f"{reason} (re-opened with {_consumption_month_label(month)})"
        try:
            _inventory_books_call(token, str(plant), "unlock", {"month": key, "reason": why[:500]})
        except _BooksCallUnanswered as exc:
            # The store may have unlocked the month before its answer was lost: lock it again so both
            # services still say closed. Months re-opened before this one stay re-opened.
            relocked = _try_books_call(token, str(plant), "lock", {"month": key, "note": "Re-open did not complete (no answer from the store)"})
            done = f" {', '.join(_consumption_month_label(item) for item in reopened)} re-opened." if reopened else ""
            raise HTTPException(
                status_code=502,
                detail=(f"The store did not answer, so {label} is still closed.{done} Try again in a minute."
                        if relocked else
                        f"The store did not answer, so {label} is still closed here, but the store may already treat it "
                        f"as open.{done} Press Re-open again to finish."),
            ) from exc
        try:
            now = datetime.utcnow()
            row.status = "OPEN"
            row.locked_at = None
            row.reopened_by = actor
            row.reopened_at = now
            row.reopen_reason = why
            db.add(MonthlyCloseEvent(
                plant_id=plant, month_start=value, event="REOPENED", actor=actor, reason=why,
                snapshot_hash=(row.snapshot or {}).get("hash") if isinstance(row.snapshot, dict) else None,
                details={"version": int(row.version or 1), "with_month": _consumption_month_key(month) if value != month else None},
            ))
            db.commit()
        except Exception:
            db.rollback()
            # Production still says closed: lock the store month again so both services agree.
            _try_books_call(token, str(plant), "lock", {"month": key, "note": "Re-open did not complete"})
            raise
        reopened.append(value)
        if value != cascade[-1]:
            _plant_month_lock(db, plant)
    return reopened


class MonthEndClosePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    month: str
    note: Optional[str] = Field(default=None, max_length=1000)
    # The Owner accepts closings that changed after the month-end count was approved (store entries
    # dated in the month posted after the approval).
    accept_count_changes: bool = False


class MonthEndReopenPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    month: str
    reason: str = Field(min_length=3, max_length=500)


class MonthEndNotePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    month: str
    item_code: str = Field(min_length=1, max_length=120)
    item_id: Optional[str] = None
    item_name: Optional[str] = Field(default=None, max_length=255)
    note: str = Field(default="", max_length=1000)


class UsageLimitInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    material_type: str
    normal_wastage_pct: float = Field(ge=0.0, le=50.0)
    allowed_gap_pct: float = Field(ge=0.0, le=100.0)
    min_gap: float = Field(ge=0.0, le=100000.0)


class UsageLimitsPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    limits: list[UsageLimitInput] = Field(min_length=1, max_length=5)


@router.get("/month-end/overview")
def month_end_overview(
    month: str = Query(...),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(MONTH_END_VIEW_ROLES)),
):
    """The month-end close page of one plant and month (frozen snapshot once closed)."""
    plant = _concrete_plant(plant_scope)
    _backfill_spec_posting_days_once(db, plant)
    return _month_end_view(db, plant, _month_from_key(month), current_user)


@router.get("/month-end/months")
def month_end_months(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(MONTH_END_VIEW_ROLES)),
):
    """Every month since the plant's first activity (spec posting, store movement, note or close), newest
    first, with its close state and history (Past months), plus the default month: the oldest month with
    activity that has ended and is not closed."""
    plant = _concrete_plant(plant_scope)
    _backfill_spec_posting_days_once(db, plant)
    today = _consumption_ist_today()
    current = today.replace(day=1)
    activity = _activity_months(db, plant) | _store_activity_months(db, plant, current_user.get("token", ""), current=current)
    rows_by_month = _close_rows_by_month(db, plant)
    first = min(activity | {current})
    months: list[date] = []
    cursor = first
    while cursor <= current and len(months) < 60:
        months.append(cursor)
        cursor = _next_month(cursor)
    open_ended = [value for value in months if value < current and value in activity and (rows_by_month.get(value) is None or rows_by_month[value].status != CLOSED_STATUS)]
    default_month = open_ended[0] if open_ended else current
    events = (
        db.query(MonthlyCloseEvent)
        .filter(MonthlyCloseEvent.plant_id == plant)
        .order_by(MonthlyCloseEvent.created_at.desc())
        .limit(200)
        .all()
    )
    events_by_month: dict[date, list[dict[str, Any]]] = {}
    for row in events:
        events_by_month.setdefault(row.month_start, []).append(
            {"event": row.event, "actor": row.actor, "reason": row.reason, "at": _iso(row.created_at), "details": row.details or {}}
        )
    out = []
    for value in reversed(months):
        row = rows_by_month.get(value)
        closed = bool(row and row.status == CLOSED_STATUS)
        snapshot = (row.snapshot or {}) if (row is not None and isinstance(row.snapshot, dict)) else {}
        snapshot_items = snapshot.get("items") or []
        out.append({
            "month": _consumption_month_key(value),
            "month_label": _consumption_month_label(value),
            "fy": _consumption_fy_label(value),
            "is_fy_close": value.month == 3,
            "status": "CLOSED" if closed else "RUNNING" if value == current else "OPEN",
            "has_activity": value in activity,
            "closed_by": (row.closed_by or row.approved_by) if row is not None and closed else None,
            "closed_at": _iso(row.closed_at or row.approved_at) if row is not None and closed else None,
            "close_note": (row.close_note or row.notes) if row is not None and closed else None,
            "version": int(row.version or 1) if row is not None else None,
            "reopened_by": row.reopened_by if row is not None else None,
            "reopened_at": _iso(row.reopened_at) if row is not None else None,
            "reopen_reason": row.reopen_reason if row is not None else None,
            "frozen": bool(closed and snapshot),
            "summary": {
                "items_with_use": sum(1 for item in snapshot_items if item.get("has_use")),
                "over": sum(1 for item in snapshot_items if item.get("status") == "OVER"),
                "under": sum(1 for item in snapshot_items if item.get("status") == "UNDER"),
                # Only items outside the limit count as explained (a note kept on an item now within it does not).
                "explained": sum(1 for item in snapshot_items if item.get("status") in ("OVER", "UNDER") and item.get("note")),
                "units": snapshot.get("units") or [],
            } if snapshot else None,
            "history": events_by_month.get(value, []),
        })
    return {
        "plant_id": str(plant),
        "current_month": _consumption_month_key(current),
        "default_month": _consumption_month_key(default_month),
        "first_month": _consumption_month_key(first),
        "months": out,
    }


@router.get("/month-end/year")
def month_end_year(
    fy: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(MONTH_END_VIEW_ROLES)),
):
    """Financial year view (April–March): each month's state and FY totals per unit. 1 April opens from
    31 March's close, so the FY opening is April's opening and the FY closing is March's closing."""
    from ..services.usage_limits import usage_limits_for_plant

    plant = _concrete_plant(plant_scope)
    today = _consumption_ist_today()
    current = today.replace(day=1)
    try:
        start = _consumption_parse_fy(fy) if fy else _consumption_fy_start(current)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    _backfill_spec_posting_days_once(db, plant)
    rows_by_month = _close_rows_by_month(db, plant)
    token = current_user.get("token", "")
    memo: dict[date, Any] = {}
    activity = _activity_months(db, plant) | _store_activity_months(db, plant, token, current=current, memo=memo)
    catalog: Optional[dict[str, dict[str, Any]]] = None
    limits = usage_limits_for_plant(db, plant)
    months_out: list[dict[str, Any]] = []
    unit_series: list[tuple[date, list[dict[str, Any]], bool]] = []
    item_series: list[list[dict[str, Any]]] = []
    # Opening on 1 April is the first figured month's opening when every month before it was idle (no
    # store movement and no spec), so idle months need no store call at all.
    idle_before_first = True
    cursor = start
    for _ in range(12):
        row = rows_by_month.get(cursor)
        closed = bool(row and row.status == CLOSED_STATUS)
        entry: dict[str, Any] = {
            "month": _consumption_month_key(cursor),
            "month_label": _consumption_month_label(cursor),
            "short_label": _MONTH_ABBR[cursor.month - 1],
            "status": "FUTURE" if cursor > current else "CLOSED" if closed else "RUNNING" if cursor == current else "OPEN",
            "has_activity": cursor in activity,
            "closed_by": (row.closed_by or row.approved_by) if closed else None,
            "closed_at": _iso(row.closed_at or row.approved_at) if closed else None,
            "units": [],
            "figures_available": False,
            "actual_known": False,
            "needs_note": 0,
        }
        if cursor <= current:
            view: Optional[dict[str, Any]] = None
            idle = not closed and cursor != current and cursor not in activity
            if closed and isinstance(row.snapshot, dict) and row.snapshot:
                view = row.snapshot
            elif not idle:
                try:
                    if catalog is None:
                        catalog = _fetch_inventory_item_catalog(token, str(plant))
                    view = _build_live_month_view(db, plant, cursor, current_user, catalog=catalog, limits=limits, today=today, memo=memo, reuse=True)
                except HTTPException:
                    view = None
            if view is not None:
                entry["units"] = view.get("units") or []
                entry["figures_available"] = bool(view.get("figures_available"))
                entry["actual_known"] = bool(view.get("actual_known"))
                entry["needs_note"] = sum(1 for item in view.get("items") or [] if item.get("needs_note"))
                if view.get("figures_available"):
                    unit_series.append((cursor, entry["units"], bool(view.get("actual_known"))))
                    item_series.append(list(view.get("items") or []))
            if not unit_series and not idle:
                idle_before_first = False  # a month with activity but no store figures comes first
        months_out.append(entry)
        cursor = _next_month(cursor)

    totals: dict[str, dict[str, Any]] = {}
    for index, (value, units, actual_known) in enumerate(unit_series):
        for unit in units:
            uom = unit.get("uom")
            bucket = totals.setdefault(uom, {
                "uom": uom, "unit_label": unit.get("unit_label"), "opening": None, "closing": None,
                "received": 0.0, "opening_loads": 0.0, "sent_back": 0.0, "issued": 0.0, "corrections": 0.0,
                "spec": 0.0, "expected": 0.0, "actual_used": 0.0, "months_known": 0, "months": 0,
            })
            if bucket["opening"] is None:
                bucket["opening"] = unit.get("opening")
            bucket["closing"] = unit.get("closing")
            bucket["months"] += 1
            for name in ("received", "opening_loads", "sent_back", "issued", "corrections", "spec", "expected"):
                bucket[name] += float(unit.get(name) or 0.0)
            if actual_known and unit.get("actual_used") is not None:
                bucket["actual_used"] += float(unit.get("actual_used") or 0.0)
                bucket["months_known"] += 1
    totals_out = []
    year_split = _consumption_year_floor_split(item_series)
    for bucket in totals.values():
        for name in ("received", "opening_loads", "sent_back", "issued", "corrections", "spec", "expected", "actual_used"):
            bucket[name] = round(bucket[name], 3)
        bucket["floor_gap"] = round(bucket["issued"] - bucket["expected"], 3)
        # Items over / under their own limit across the year (the net floor_gap alone can hide them).
        bucket.update(year_split.get(_consumption_normalize_uom(bucket["uom"]), {
            "floor_over_items": 0, "floor_over": 0.0, "floor_under_items": 0, "floor_under": 0.0,
        }))
        totals_out.append(bucket)
    totals_out.sort(key=lambda bucket: ({"KG": 0, "PCS": 1, "L": 2}.get(str(bucket["uom"]), 9), str(bucket["uom"])))
    fy_end = _consumption_last_day(date(start.year + 1, 3, 1))
    march_closed = months_out[-1]["status"] == "CLOSED"
    last_with_figures = unit_series[-1][0] if unit_series else None
    return {
        "plant_id": str(plant),
        "fy": f"{start.year}-{(start.year + 1) % 100:02d}",
        "period_start": start.isoformat(),
        "period_end": fy_end.isoformat(),
        "previous_fy": f"{start.year - 1}-{start.year % 100:02d}",
        "next_fy": f"{start.year + 1}-{(start.year + 2) % 100:02d}" if date(start.year + 1, 4, 1) <= current else None,
        "months": months_out,
        "totals": totals_out,
        "closed_months": sum(1 for entry in months_out if entry["status"] == "CLOSED"),
        "complete": all(entry["status"] == "CLOSED" for entry in months_out),
        "march_closed": march_closed,
        "opening_label": (f"Opening {_day_label(start)}" if not unit_series or unit_series[0][0] == start or idle_before_first
                          else f"Opening {_day_label(unit_series[0][0])} (first month with store figures)"),
        "closing_label": (f"Closing {_day_label(fy_end)}" if march_closed
                          else f"Closing so far ({_short_month(last_with_figures)})" if last_with_figures else "Closing"),
    }


@router.get("/month-end/sources")
def month_end_sources(
    month: str = Query(...),
    item_code: str = Query(..., min_length=1),
    item_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(MONTH_END_VIEW_ROLES)),
):
    """What is behind one item's numbers: the job cards that posted its spec, and (from inventory) the
    receipts, issues and count / correction lines of the month."""
    plant = _concrete_plant(plant_scope)
    month_start = _month_from_key(month)
    code = item_code.strip().upper()
    rows = (
        db.query(MonthlyMaterialProvisional, JobCard)
        .outerjoin(JobCard, JobCard.id == MonthlyMaterialProvisional.job_card_id)
        .filter(
            MonthlyMaterialProvisional.plant_id == plant,
            MonthlyMaterialProvisional.month_start == month_start,
            MonthlyMaterialProvisional.item_code == code,
        )
        .all()
    )
    # Rows posted before IST dating have no posted_on: their day is the IST day of the stage close.
    stage_closed: dict[tuple[Any, str], datetime] = {}
    legacy_cards = {provisional.job_card_id for provisional, _ in rows if not (provisional.snapshot or {}).get("posted_on")}
    if legacy_cards:
        for stage in db.query(JobCardStage).filter(JobCardStage.job_card_id.in_(legacy_cards)).all():
            when = stage.actual_end or stage.entered_at or stage.actual_start
            if when is not None:
                stage_closed[(stage.job_card_id, str(stage.stage_type or "").upper())] = when
    token = current_user.get("token", "")
    # Spec is posted in kg for glue; the card shows it in the stock item's unit, so the drawer must too.
    stock_item = _fetch_inventory_item(token, str(plant), item_id) if item_id else None
    spec_rows = []
    for provisional, job in rows:
        snapshot = dict(provisional.snapshot or {})
        closed_at = stage_closed.get((provisional.job_card_id, str(provisional.source_stage or "").upper())) or provisional.created_at
        posted_spec = float(provisional.provisional_theory_consumption_kg or 0.0)
        posted_unit = _consumption_normalize_uom(snapshot.get("unit") or "KG")
        shown_spec, shown_unit = _spec_in_stock_unit(posted_spec, posted_unit, stock_item)
        spec_rows.append({
            "job_card_id": str(provisional.job_card_id),
            "job_card_no": getattr(job, "job_card_no", None),
            "product_code": getattr(job, "product_code", None),
            "stage": provisional.source_stage,
            "good_qty": round(float(provisional.advisory_allocated_order_qty or 0.0), 3),
            "planned_qty": snapshot.get("planned_qty"),
            "spec": round(shown_spec, 3),
            "unit": shown_unit,
            "unit_label": _consumption_unit_label(shown_unit),
            "posted_spec": round(posted_spec, 3),
            "posted_unit": posted_unit,
            "posted_on": snapshot.get("posted_on") or (_consumption_ist_day(closed_at).isoformat() if closed_at else None),
            "posted_after_close": snapshot.get("posted_after_close"),
        })
    spec_rows.sort(key=lambda row: (str(row.get("posted_on") or ""), str(row.get("job_card_no") or "")))
    # Totals per unit: kg and pcs are never added together.
    spec_totals: dict[str, float] = {}
    for row in spec_rows:
        spec_totals[row["unit"]] = spec_totals.get(row["unit"], 0.0) + row["spec"]
    stock_uom = _consumption_normalize_uom(stock_item.get("uom")) if stock_item else None
    total_unit = stock_uom if stock_uom in spec_totals or not spec_totals else next(iter(spec_totals))
    store = _fetch_month_figure_sources(token, str(plant), month_start, item_id) if item_id else None
    note_row = (
        db.query(MonthlyMaterialNote)
        .filter(MonthlyMaterialNote.plant_id == plant, MonthlyMaterialNote.month_start == month_start, MonthlyMaterialNote.item_code == code)
        .first()
    )
    return {
        "month": _consumption_month_key(month_start),
        "item_code": code,
        "item_id": item_id,
        "spec": {
            "rows": spec_rows,
            "total": round(spec_totals.get(total_unit, 0.0), 3) if total_unit else 0.0,
            "total_unit": total_unit,
            "total_unit_label": _consumption_unit_label(total_unit) if total_unit else None,
            "totals": [{"unit": unit, "unit_label": _consumption_unit_label(unit), "qty": round(value, 3)} for unit, value in spec_totals.items()],
            # The spec cannot be compared with the store (the card lists it under "Spec not linked").
            "unit_differs": bool(stock_uom and any(unit != stock_uom for unit in spec_totals)),
            "stock_unit_label": _consumption_unit_label(stock_uom) if stock_uom else None,
            "job_cards": len({row["job_card_id"] for row in spec_rows}),
        },
        "store": {"available": store is not None, "data": store},
        "ledger_href": f"/inventory/ledger?item_id={item_id}&start={month_start.isoformat()}&end={_consumption_last_day(month_start).isoformat()}&from=month-end" if item_id else None,
        "note": {"note": note_row.note, "noted_by": note_row.noted_by, "noted_at": _iso(note_row.noted_at)} if note_row else None,
    }


@router.put("/month-end/notes")
def put_month_end_note(
    payload: MonthEndNotePayload,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    """One note on one item of one month, saved on its own (Owner and plant head). Notes open only once
    the month-end count is approved, and a closed month's notes are frozen. A blank note removes it."""
    if not _can_write_month_notes(current_user):
        raise HTTPException(status_code=403, detail="Only the Owner or the plant head can write month-end notes.")
    plant = _concrete_plant(plant_scope)
    month = _month_from_key(payload.month)
    code = payload.item_code.strip().upper()
    if month in _closed_month_set(db, plant):
        # The same closed-month body as every other refusal (inventory, the BFF and floor entries).
        raise HTTPException(status_code=409, detail={
            "code": "BOOKS_LOCKED",
            "message": f"{_consumption_month_label(month)} is closed. Ask the owner to re-open it.",
            "month": _consumption_month_key(month),
        })
    today = _consumption_ist_today()
    if month >= today.replace(day=1):
        raise HTTPException(status_code=409, detail=f"{_consumption_month_label(month)} is still running. Notes open after its month-end count is approved.")
    figures = _fetch_month_figures(current_user.get("token", ""), str(plant), month)
    count = _count_payload((figures or {}).get("month_end_count"))
    if not (count and count.get("approved")):
        raise HTTPException(status_code=409, detail=f"Notes open once the {_month_word(month)} month-end count is approved.")
    actor = str(current_user.get("actor_identity") or current_user.get("sub") or current_user.get("email") or "")
    row = (
        db.query(MonthlyMaterialNote)
        .filter(MonthlyMaterialNote.plant_id == plant, MonthlyMaterialNote.month_start == month, MonthlyMaterialNote.item_code == code)
        .with_for_update()
        .first()
    )
    text_value = " ".join(payload.note.split())
    if not text_value:
        if row is not None:
            db.delete(row)
            db.commit()
        return {"month": _consumption_month_key(month), "item_code": code, "note": None}
    # A note belongs to a material of this month's page: one the store book lists or a job card posted.
    known = {
        str(item.get("item_code") or "").strip().upper()
        for item in (figures or {}).get("items") or []
        if isinstance(item, dict)
    } | set(_aggregate_spec(_spec_rows_for_month(db, plant, month)))
    if code not in known:
        raise HTTPException(status_code=422, detail=f"That material is not on the {_consumption_month_label(month)} month-end page, so it cannot have a note.")
    item_uuid = None
    if payload.item_id:
        try:
            item_uuid = uuid.UUID(str(payload.item_id))
        except ValueError:
            item_uuid = None
    now = datetime.utcnow()
    if row is None:
        row = MonthlyMaterialNote(plant_id=plant, month_start=month, item_code=code, note=text_value)
        db.add(row)
    row.note = text_value
    row.item_id = item_uuid or row.item_id
    row.item_name = payload.item_name or row.item_name
    row.noted_by = actor
    row.noted_at = now
    db.commit()
    return {
        "month": _consumption_month_key(month),
        "item_code": code,
        "note": {"note": row.note, "noted_by": row.noted_by, "noted_at": _iso(row.noted_at)},
    }


@router.post("/month-end/close")
def post_month_end_close(
    payload: MonthEndClosePayload,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(_require_actual_owner),
):
    """Owner closes the month: frozen snapshot, books locked in production and inventory, history kept."""
    plant = _concrete_plant(plant_scope)
    month = _month_from_key(payload.month)
    _backfill_spec_posting_days_once(db, plant)
    _close_month(db, plant, month, current_user, payload.note, accept_count_changes=payload.accept_count_changes)
    return _month_end_view(db, plant, month, current_user)


@router.post("/month-end/reopen")
def post_month_end_reopen(
    payload: MonthEndReopenPayload,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(_require_actual_owner),
):
    """Owner re-opens a closed month with a reason; any later closed month re-opens with it."""
    plant = _concrete_plant(plant_scope)
    month = _month_from_key(payload.month)
    reason = " ".join(payload.reason.split())
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="Give a reason for re-opening the month.")
    reopened = _reopen_month(db, plant, month, current_user, reason)
    view = _month_end_view(db, plant, month, current_user)
    view["reopened_months"] = [_consumption_month_key(value) for value in reopened]
    return view


@router.get("/month-end/limits")
def get_month_end_limits(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    """Usage limits per material type for the selected plant (every allowed plant for an ALL view)."""
    from ..services.usage_limits import DEFAULT_USAGE_LIMITS, MATERIAL_TYPE_LABELS, usage_limits_for_plant

    if plant_scope.get("scope_all"):
        plant_ids = [value for value in (plant_scope.get("allowed_plants") or []) if _plant_uuid_or_none(value)]
    else:
        plant_ids = [str(plant_scope["selected_plant_id"])]
    units_in_use: dict[str, list[str]] = {}
    if not plant_scope.get("scope_all"):
        try:
            catalog = _fetch_inventory_item_catalog(current_user.get("token", ""), plant_ids[0])
            from ..services.usage_limits import usage_limit_type

            for item in catalog.values():
                material_type = usage_limit_type(item.get("type"))
                label = _consumption_unit_label(item.get("uom"))
                if str(item.get("type") or "").upper() != "FINISHED_GOOD" and label not in units_in_use.setdefault(material_type, []):
                    units_in_use[material_type].append(label)
        except HTTPException:
            units_in_use = {}
    plants = []
    for plant_id in plant_ids:
        limits = usage_limits_for_plant(db, _to_uuid(plant_id))
        plants.append({
            "plant_id": str(plant_id),
            "limits": [
                {**value, "unit_hint": _limit_unit_hint(key, units_in_use.get(key, [])), "units_in_use": sorted(units_in_use.get(key, []))}
                for key, value in limits.items()
            ],
        })
    return {
        "scope": "all" if plant_scope.get("scope_all") else "plant",
        "plants": plants,
        "defaults": [{"material_type": key, "label": MATERIAL_TYPE_LABELS[key], **value} for key, value in DEFAULT_USAGE_LIMITS.items()],
        "can_edit": _can_edit_usage_limits(current_user),
    }


@router.put("/month-end/limits")
def put_month_end_limits(
    payload: UsageLimitsPayload,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Owner", "Admin"])),
):
    """Owner / Admin save one plant's limits. Closed months keep the limits frozen in their snapshot."""
    from ..models import USAGE_LIMIT_MATERIAL_TYPES, PlantUsageLimit
    from ..services.usage_limits import usage_limits_for_plant

    plant = _concrete_plant(plant_scope)
    actor = str(current_user.get("actor_identity") or current_user.get("sub") or current_user.get("email") or "")
    seen: set[str] = set()
    for value in payload.limits:
        material_type = value.material_type.strip().upper()
        if material_type not in USAGE_LIMIT_MATERIAL_TYPES or material_type in seen:
            raise HTTPException(status_code=422, detail=f"Unknown or repeated material type: {value.material_type}")
        seen.add(material_type)
        row = (
            db.query(PlantUsageLimit)
            .filter(PlantUsageLimit.plant_id == plant, PlantUsageLimit.material_type == material_type)
            .with_for_update()
            .first()
        )
        if row is None:
            row = PlantUsageLimit(plant_id=plant, material_type=material_type)
            db.add(row)
        row.normal_wastage_pct = round(float(value.normal_wastage_pct), 3)
        row.allowed_gap_pct = round(float(value.allowed_gap_pct), 3)
        row.min_gap = round(float(value.min_gap), 3)
        row.updated_by = actor
        row.updated_at = datetime.utcnow()
    db.commit()
    limits = usage_limits_for_plant(db, plant)
    return {"plant_id": str(plant), "limits": [{**value, "unit_hint": _limit_unit_hint(key, []), "units_in_use": []} for key, value in limits.items()]}
