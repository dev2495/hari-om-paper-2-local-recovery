"""Operations honesty endpoints — short-close + downtime + data-entry-lag.

Three feature areas live in this single file so the operational surface stays
together:

    • POST /operations/short-close/{job_card_id}
          Close a job card with `gap_qty < planned_qty` and a normalized
          reason code. Caller picks one of three decisions:
              - CARRY_FORWARD    auto-spawn a top-up job card for the gap
              - SHORT_CLOSE_SO   reduce the SO line qty (sales role)
              - HOLD             leave the gap open, decide later

    • POST /operations/downtime
          Log a downtime event on a machine with start, end, reason.
          The optional `is_planned` flag separates maintenance from breakdown.

    • GET  /operations/data-entry-lag
          Roll-up of `entered_at - actual_end` across recent stages with
          median + p90 lag, and a list of the laggard rows.

Each handler emits an audit event for the operations timeline.
"""
from __future__ import annotations

import logging
import math
import time
import uuid
from datetime import date, datetime, timedelta
from statistics import median
from typing import Any, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import (
    JobCard,
    JobCardShortClose,
    JobCardStage,
    MachineDowntime,
)
from ..utils.auth import get_current_plant_scope, require_role
from ..utils.audit import record_audit_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/operations", tags=["Operations"])
settings = get_settings()

# Short-close can target the whole card ("JOB_CARD") or a specific stage. The
# uniqueness key is (job_card_id, stage_type) so a PROCESS-level short-close can
# coexist with a whole-card one.
ALLOWED_SHORT_CLOSE_STAGE_TYPES = {
    "JOB_CARD",
    "WINDER",
    "OVEN",
    "PROCESS",
    "SLITTING",
    "PACKING",
    "QC",
}

# P3.5 — transient HTTP statuses worth retrying on the sales short-close sync.
_RETRYABLE_STATUS = {502, 503, 504}
_SALES_SYNC_MAX_ATTEMPTS = 3
_SALES_SYNC_BACKOFF_SECONDS = 0.5


# ──────────────────────────────────────────────────────────────────────────
# Pure helpers (no DB / no network) — unit-tested in
# tests/test_operations_close_loop.py. Kept tiny and side-effect-free so the
# close-loop math/predicates can be verified without a live database.
# ──────────────────────────────────────────────────────────────────────────


def normalize_short_close_stage_type(value: Optional[str]) -> str:
    """Normalize + validate a short-close stage_type.

    Whole-card short-close uses ``JOB_CARD``. Anything outside the allowed set
    raises a 422 HTTPException. ``None``/empty defaults to ``JOB_CARD``.
    """
    stage_type = (value or "JOB_CARD").strip().upper()
    if stage_type not in ALLOWED_SHORT_CLOSE_STAGE_TYPES:
        raise HTTPException(
            status_code=422,
            detail=(
                "stage_type must be one of "
                f"{', '.join(sorted(ALLOWED_SHORT_CLOSE_STAGE_TYPES))}"
            ),
        )
    return stage_type


def carry_forward_lot_split(
    original_released_qty: float, gap_qty: float
) -> tuple[float, float]:
    """Compute the P1.10 release-lot split (no DB).

    The original lot shrinks to the produced portion; a NEW lot carries the
    gap. Total released qty across both lots is conserved (modulo float
    rounding) and the original never goes negative. Mirrors the arithmetic in
    sales-service ``reallocate_release_lot_carry_forward`` — production uses it
    to cross-check the lot sales actually minted (catches a sales-side math
    regression before we point the carry JC at a wrong-sized lot).

    Returns ``(shrunk_original_qty, new_lot_qty)``.
    """
    gap = float(gap_qty or 0.0)
    shrunk = max(0.0, round(float(original_released_qty or 0.0) - gap, 4))
    return shrunk, gap


def should_retry_sales_status(status_code: int, attempt: int) -> bool:
    """P3.5 retry predicate for ``_sync_sales_short_close`` HTTP responses.

    Retry only transient 5xx (502/503/504) and only while attempts remain.
    A 4xx is permanent and is never retried. ``attempt`` is 1-based.
    """
    return status_code in _RETRYABLE_STATUS and attempt < _SALES_SYNC_MAX_ATTEMPTS


def downtime_needs_reschedule(
    affected_job_card_ids: Any, reschedule_status: Optional[str]
) -> bool:
    """P2.14 reschedule-queue membership predicate (no DB).

    A downtime row belongs in the planner reschedule queue when it has at least
    one affected job card AND its reschedule_status is unresolved (NULL or
    PENDING). DONE / DISMISSED rows drop out.
    """
    has_affected = isinstance(affected_job_card_ids, list) and len(affected_job_card_ids) > 0
    unresolved = reschedule_status is None or str(reschedule_status).upper() == "PENDING"
    return has_affected and unresolved


def _validate_reason_code(
    token: str,
    plant_id: Optional[uuid.UUID],
    code: str,
    category: str,
) -> None:
    """Strictly validate `code` against active masterdata reason codes.

    Reason codes drive reconciliation and operational reporting. Accepting an
    unvalidated value while masterdata is unavailable permanently corrupts
    those dimensions, so availability failures are surfaced for a safe retry.
    """
    if not code or not category:
        return
    code_upper = code.strip().upper()
    cat_upper = category.strip().upper()
    headers: dict[str, str] = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if plant_id is not None:
        headers["X-Plant-ID"] = str(plant_id)
    try:
        with httpx.Client(timeout=5.0) as client:
            response = client.get(
                f"{settings.MASTERDATA_SERVICE_URL}/master/reason-codes/",
                headers=headers,
                params={"category": cat_upper},
            )
    except httpx.RequestError as exc:
        logger.warning("reason_code validation network failure: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Reason-code master is unavailable; retry without changing the entry",
        ) from exc
    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=(
                "Reason-code master rejected validation "
                f"(HTTP {response.status_code}); retry without changing the entry"
            ),
        )
    try:
        rows = response.json() or []
    except ValueError as exc:
        logger.warning("reason_code validation parse failure: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Reason-code master returned an invalid response; retry without changing the entry",
        ) from exc
    valid = {
        str((r or {}).get("code") or "").strip().upper()
        for r in rows
        if isinstance(r, dict)
    }
    if code_upper not in valid:
        raise HTTPException(
            status_code=422,
            detail=f"reason_code '{code_upper}' is not a valid {cat_upper} reason",
        )


def _scope_uuid(plant_scope: dict, *, action: str) -> Optional[uuid.UUID]:
    if plant_scope.get("scope_all"):
        return None
    selected = plant_scope.get("selected_plant_id")
    try:
        return uuid.UUID(str(selected)) if selected else None
    except (TypeError, ValueError):
        raise HTTPException(status_code=403, detail=f"Invalid plant scope for {action}")


def _apply_plant_scope(query, column, plant_scope: dict, *, action: str):
    selected = _scope_uuid(plant_scope, action=action)
    if selected is None:
        return query
    return query.filter(column == selected)


def _sync_sales_short_close(
    *,
    token: str,
    plant_id: uuid.UUID,
    sales_order_line_id: uuid.UUID,
    job_card_id: uuid.UUID,
    produced_qty: float,
    gap_qty: float,
    reason_code: str,
    notes: Optional[str],
) -> None:
    """Reduce the sales line/release lot for a SHORT_CLOSE_SO decision.

    P3.5 — transient failures (network errors and 502/503/504 from sales) are
    retried up to ``_SALES_SYNC_MAX_ATTEMPTS`` with a short backoff. A 4xx is a
    permanent failure (bad request / not found / forbidden) and is NOT retried.
    """
    last_exc: Optional[Exception] = None
    for attempt in range(1, _SALES_SYNC_MAX_ATTEMPTS + 1):
        try:
            response = httpx.post(
                f"{settings.SALES_SERVICE_URL}/sales-orders/lines/{sales_order_line_id}/short-close",
                headers={"Authorization": f"Bearer {token}", "X-Plant-ID": str(plant_id)},
                json={
                    "job_card_id": str(job_card_id),
                    "produced_qty": produced_qty,
                    "gap_qty": gap_qty,
                    "reason_code": reason_code,
                    "notes": notes,
                },
                timeout=10.0,
            )
        except httpx.RequestError as exc:
            last_exc = exc
            if attempt < _SALES_SYNC_MAX_ATTEMPTS:
                logger.warning(
                    "Sales short-close sync network failure (attempt %s/%s), retrying: %s",
                    attempt,
                    _SALES_SYNC_MAX_ATTEMPTS,
                    exc,
                )
                time.sleep(_SALES_SYNC_BACKOFF_SECONDS * attempt)
                continue
            raise HTTPException(
                status_code=502, detail=f"Sales short-close sync failed: {exc}"
            ) from exc

        if should_retry_sales_status(response.status_code, attempt):
            logger.warning(
                "Sales short-close sync transient %s (attempt %s/%s), retrying: %s",
                response.status_code,
                attempt,
                _SALES_SYNC_MAX_ATTEMPTS,
                (response.text or "")[:160],
            )
            time.sleep(_SALES_SYNC_BACKOFF_SECONDS * attempt)
            continue

        if response.status_code >= 400:
            # 4xx is permanent; an exhausted-retry 5xx also lands here.
            raise HTTPException(
                status_code=502,
                detail=f"Sales short-close sync failed: {response.text[:240]}",
            )
        return

    # Loop only exits without returning when retries were exhausted on RequestError.
    raise HTTPException(
        status_code=502,
        detail=f"Sales short-close sync failed: {last_exc}",
    )


def _reallocate_carry_forward_release_lot(
    *,
    token: str,
    plant_id: uuid.UUID,
    release_lot_id: uuid.UUID,
    carry_forward_job_card_id: uuid.UUID,
    gap_qty: float,
    new_release_lot_id: uuid.UUID,
) -> uuid.UUID:
    """Split the original release lot so the carry-forward JC owns `gap_qty`.

    Server-to-server call to sales-service. Returns the NEW release lot id on
    success. Raises HTTPException on any failure so production never commits an
    unallocated carry-forward job card.
    """
    try:
        response = httpx.post(
            f"{settings.SALES_SERVICE_URL}/sales-orders/release-lots/{release_lot_id}/reallocate-carry-forward",
            headers={"Authorization": f"Bearer {token}", "X-Plant-ID": str(plant_id)},
            json={
                "carry_forward_job_card_id": str(carry_forward_job_card_id),
                "gap_qty": gap_qty,
                "release_lot_id": str(new_release_lot_id),
            },
            timeout=10.0,
        )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502, detail=f"Release-lot reallocation failed: {exc}"
        ) from exc
    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"Release-lot reallocation failed: {response.text[:240]}",
        )
    try:
        body = response.json() or {}
    except ValueError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Release-lot reallocation returned non-JSON: {exc}",
        ) from exc
    new_lot_raw = body.get("release_lot_id") or body.get("id")
    if not new_lot_raw:
        raise HTTPException(
            status_code=502,
            detail="Release-lot reallocation response missing release_lot_id",
        )
    # Cross-check the lot sales minted against the split we expect. Quantity
    # mismatch is a hard contract failure because silent genealogy drift is not
    # acceptable in the production flow.
    _, expected_new_qty = carry_forward_lot_split(0.0, gap_qty)
    returned_qty = body.get("release_qty")
    if returned_qty is not None:
        try:
            if abs(float(returned_qty) - expected_new_qty) > 0.01:
                raise HTTPException(
                    status_code=502,
                    detail=f"Carry-forward lot qty mismatch: expected {expected_new_qty}, received {returned_qty}",
                )
        except (TypeError, ValueError):
            pass
    try:
        return uuid.UUID(str(new_lot_raw))
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Release-lot reallocation returned bad lot id: {new_lot_raw}",
        ) from exc


def _spawn_carry_forward_job_card(
    *,
    db: Session,
    source_job: JobCard,
    gap_qty: float,
    token: str,
) -> tuple[JobCard, bool]:
    """Create + flush the top-up job card for the gap and reallocate its lot.

    Shared by the short-close handler AND resolve-hold so both spawn the carry
    JC identically (DRY).

    A top-up job card runs the gap through the full route again — it always
    starts at WINDER (lost tubes are scrap; the gap is re-made from winding) so
    the gap qty is fully re-produced. We deliberately don't carry forward the
    assigned machine because capacity should be re-validated by the planner on
    the new JC.

    The carry JC gets its own release lot, split from the original through an
    idempotent sales-service request. Missing lineage or an upstream failure
    blocks the write; an orphan carry-forward is never committed.
    """
    if source_job.release_lot_id is None:
        raise HTTPException(status_code=409, detail="Cannot carry forward a job card without a sales release lot")
    carry_id = uuid.uuid5(uuid.NAMESPACE_URL, f"hariom:carry:{source_job.id}:{float(gap_qty):.4f}")
    new_release_lot_id = uuid.uuid5(uuid.NAMESPACE_URL, f"hariom:carry-release:{carry_id}")
    carry = JobCard(
        id=carry_id,
        plant_id=source_job.plant_id,
        sales_order_id=source_job.sales_order_id,
        sales_order_line_id=source_job.sales_order_line_id,
        release_lot_id=None,
        spec_id=source_job.spec_id,
        spec_snapshot=dict(source_job.spec_snapshot or {}),
        routing_snapshot=dict(source_job.routing_snapshot or {}),
        material_plan_snapshot=dict(source_job.material_plan_snapshot or {}),
        released_qty=gap_qty,
        planned_qty=gap_qty,
        assigned_winder_machine_id=None,
        product_code=source_job.product_code,
        status="CREATED",
        current_stage="WINDER",
        requires_slitting=bool(source_job.requires_slitting),
    )
    db.add(carry)
    db.flush()

    carry.release_lot_id = _reallocate_carry_forward_release_lot(
        token=token,
        plant_id=source_job.plant_id,
        release_lot_id=source_job.release_lot_id,
        carry_forward_job_card_id=carry.id,
        gap_qty=gap_qty,
        new_release_lot_id=new_release_lot_id,
    )
    return carry, False


# ──────────────────────────────────────────────────────────────────────────
# Short-close + carry-forward
# ──────────────────────────────────────────────────────────────────────────


class ShortClosePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    produced_qty: float = Field(..., ge=0)
    reason_code: str  # must exist in masterdata reason_code with category=SHORT_CLOSE
    decision: str  # CARRY_FORWARD | SHORT_CLOSE_SO | HOLD
    # Which stage the short-close targets. Whole-card short-close uses JOB_CARD.
    # Allowed: JOB_CARD | WINDER | OVEN | PROCESS | SLITTING | PACKING | QC.
    stage_type: Optional[str] = "JOB_CARD"
    notes: Optional[str] = None


class ResolveHoldPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: str  # CARRY_FORWARD | SHORT_CLOSE_SO
    notes: Optional[str] = None


class ShortCloseResponse(BaseModel):
    id: uuid.UUID
    job_card_id: uuid.UUID
    stage_type: Optional[str] = None
    planned_qty: float
    produced_qty: float
    gap_qty: float
    reason_code: str
    decision: str
    carry_forward_job_card_id: Optional[uuid.UUID] = None
    hold_status: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    resolved_at: Optional[datetime] = None
    resolved_by: Optional[str] = None
    resolution_decision: Optional[str] = None
    resolution_note: Optional[str] = None


def _serialize_short_close(row: JobCardShortClose) -> ShortCloseResponse:
    return ShortCloseResponse(
        id=row.id,
        job_card_id=row.job_card_id,
        stage_type=row.stage_type,
        planned_qty=row.planned_qty,
        produced_qty=row.produced_qty,
        gap_qty=row.gap_qty,
        reason_code=row.reason_code,
        decision=row.decision,
        carry_forward_job_card_id=row.carry_forward_job_card_id,
        hold_status=row.hold_status,
        notes=row.notes,
        created_at=row.created_at,
        resolved_at=row.resolved_at,
        resolved_by=row.resolved_by,
        resolution_decision=row.resolution_decision,
        resolution_note=row.resolution_note,
    )


@router.post("/short-close/{job_card_id}", response_model=ShortCloseResponse)
def short_close_job_card(
    job_card_id: uuid.UUID,
    payload: ShortClosePayload,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["PlantManager", "Admin", "Owner"])),
):
    decision = (payload.decision or "").strip().upper()
    if decision not in {"CARRY_FORWARD", "SHORT_CLOSE_SO", "HOLD"}:
        raise HTTPException(status_code=422, detail="decision must be CARRY_FORWARD, SHORT_CLOSE_SO, or HOLD")
    reason_code = (payload.reason_code or "").strip().upper()
    if not reason_code:
        raise HTTPException(status_code=422, detail="reason_code is required")
    # Process-level short-close: validate stage_type against the allowed set.
    stage_type = normalize_short_close_stage_type(payload.stage_type)

    # Plant-scope enforcement: a user cannot short-close a job card outside
    # their plant scope. ALL-scope (owner) passes; otherwise the job must
    # belong to the user's selected plant.
    query = db.query(JobCard).filter(JobCard.id == job_card_id)
    if not plant_scope.get("scope_all"):
        selected = plant_scope.get("selected_plant_id")
        try:
            scope_uuid = uuid.UUID(str(selected)) if selected else None
        except (TypeError, ValueError):
            scope_uuid = None
        if scope_uuid is None:
            raise HTTPException(status_code=403, detail="Invalid plant scope for short-close")
        query = query.filter(JobCard.plant_id == scope_uuid)
    job = query.first()
    if not job:
        raise HTTPException(status_code=404, detail="Job card not found in this plant scope")

    # P1.1 — idempotency guards. Reject if the JC is already COMPLETED or a
    # prior short-close already exists. Frontend filters are client-side only.
    if (job.status or "").upper() == "COMPLETED":
        raise HTTPException(
            status_code=409,
            detail="Job card already completed — short-close cannot be re-applied",
        )
    # Idempotency is keyed on (job_card_id, stage_type): a PROCESS-level
    # short-close can coexist with a whole-card (JOB_CARD) one, but the same
    # stage cannot be short-closed twice.
    existing_sc = (
        db.query(JobCardShortClose)
        .filter(
            JobCardShortClose.job_card_id == job.id,
            JobCardShortClose.stage_type == stage_type,
        )
        .first()
    )
    if existing_sc is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Short-close already recorded for this job card at stage {stage_type}",
        )

    planned = float(job.planned_qty or 0.0)
    produced = float(payload.produced_qty or 0.0)
    gap = round(planned - produced, 4)
    if gap <= 0:
        raise HTTPException(status_code=400, detail="No gap — produced_qty meets or exceeds planned_qty. Use the normal close.")
    if decision == "SHORT_CLOSE_SO" and not job.sales_order_line_id:
        raise HTTPException(status_code=422, detail="Job card has no linked sales order line to short-close")

    # P2.2 — soft-validate the reason_code against masterdata. Network/upstream
    # failures do NOT block; only an active 200 that omits the code raises 422.
    _validate_reason_code(
        token=str(current_user.get("token") or ""),
        plant_id=job.plant_id,
        code=reason_code,
        category="SHORT_CLOSE",
    )

    actor_id = current_user.get("sub") or current_user.get("actor_identity") or "unknown"
    actor_role = current_user.get("acting_role") or (current_user.get("roles") or ["?"])[0]

    # P2.3 — flag zero-production short-closes so analytics can surface them.
    zero_production = produced == 0.0

    # P0.1 — wrap the entire critical section in an explicit transaction so a
    # mid-flight failure rolls back the partial state AND we still get an
    # audit trail (`short_close_failed`) of the attempted operation.
    carry_id: Optional[uuid.UUID] = None
    carry_release_orphan = False
    try:
        short = JobCardShortClose(
            plant_id=job.plant_id,
            job_card_id=job.id,
            stage_type=stage_type,
            planned_qty=planned,
            produced_qty=produced,
            gap_qty=gap,
            reason_code=reason_code,
            decision=decision,
            notes=(payload.notes or None),
            actor_id=str(actor_id),
            actor_role=str(actor_role),
            # P3.2 — a HOLD short-close stays OPEN until someone resolves it.
            hold_status=("OPEN" if decision == "HOLD" else None),
        )
        db.add(short)
        db.flush()

        if decision == "SHORT_CLOSE_SO":
            _sync_sales_short_close(
                token=str(current_user.get("token") or ""),
                plant_id=job.plant_id,
                sales_order_line_id=job.sales_order_line_id,
                job_card_id=job.id,
                produced_qty=produced,
                gap_qty=gap,
                reason_code=reason_code,
                notes=payload.notes,
            )

        # Carry-forward branch: spawn a top-up job card sharing the same spec.
        # P1.10 — the carry JC gets its OWN release lot (split from the original
        # via sales-service) so the SO line tracks the gap qty back in
        # production. The helper falls back to orphaning the lot if the source
        # JC has no release_lot_id or the sales call fails — never hard-fails.
        if decision == "CARRY_FORWARD" and gap > 0:
            carry, carry_release_orphan = _spawn_carry_forward_job_card(
                db=db,
                source_job=job,
                gap_qty=gap,
                token=str(current_user.get("token") or ""),
            )
            short.carry_forward_job_card_id = carry.id
            carry_id = carry.id

        # Mark the originating job card complete with the short qty.
        if job.status != "COMPLETED":
            job.status = "COMPLETED"

        db.commit()
        db.refresh(short)
    except HTTPException:
        db.rollback()
        try:
            record_audit_event(
                db=db,
                plant_id=str(job.plant_id),
                entity_type="job_card",
                entity_id=str(job.id),
                action="short_close_failed",
                actor_id=str(actor_id),
                actor_role=str(actor_role),
                payload={
                    "reason_code": reason_code,
                    "stage_type": stage_type,
                    "planned_qty": planned,
                    "produced_qty": produced,
                    "gap_qty": gap,
                    "decision": decision,
                    "notes": payload.notes or None,
                },
            )
            db.commit()
        except Exception as audit_exc:
            logger.warning(
                "short_close_failed audit emission failed: %s", audit_exc
            )
        raise
    except Exception as exc:
        db.rollback()
        try:
            record_audit_event(
                db=db,
                plant_id=str(job.plant_id),
                entity_type="job_card",
                entity_id=str(job.id),
                action="short_close_failed",
                actor_id=str(actor_id),
                actor_role=str(actor_role),
                payload={
                    "reason_code": reason_code,
                    "stage_type": stage_type,
                    "planned_qty": planned,
                    "produced_qty": produced,
                    "gap_qty": gap,
                    "decision": decision,
                    "notes": payload.notes or None,
                    "error": str(exc),
                },
            )
            db.commit()
        except Exception as audit_exc:
            logger.warning(
                "short_close_failed audit emission failed: %s", audit_exc
            )
        raise HTTPException(
            status_code=500,
            detail=f"Short-close failed: {exc}",
        ) from exc

    # P1.10 — emit the orphan warning out of band so it never blocks the
    # write. A sales-service callback will need to allocate a new lot later.
    if carry_release_orphan and carry_id is not None:
        try:
            record_audit_event(
                db=db,
                plant_id=str(job.plant_id),
                entity_type="job_card",
                entity_id=str(carry_id),
                action="carry_forward_orphan_release_lot",
                actor_id=str(actor_id),
                actor_role=str(actor_role),
                payload={
                    "source_job_card_id": str(job.id),
                    "original_release_lot_id": (
                        str(job.release_lot_id) if job.release_lot_id else None
                    ),
                    "gap_qty": gap,
                    "note": (
                        "carry-forward JC has no release_lot — sales-service "
                        "callback must allocate a new lot for the gap_qty"
                    ),
                },
            )
            db.commit()
        except Exception as audit_exc:
            logger.warning(
                "carry_forward_orphan_release_lot audit failed: %s", audit_exc
            )
    elif decision == "CARRY_FORWARD" and carry_id is not None:
        # P1.10 — the gap qty was split into a fresh release lot on the carry JC.
        try:
            record_audit_event(
                db=db,
                plant_id=str(job.plant_id),
                entity_type="job_card",
                entity_id=str(carry_id),
                action="carry_forward_release_lot_reallocated",
                actor_id=str(actor_id),
                actor_role=str(actor_role),
                payload={
                    "source_job_card_id": str(job.id),
                    "original_release_lot_id": (
                        str(job.release_lot_id) if job.release_lot_id else None
                    ),
                    "new_release_lot_id": str(carry.release_lot_id) if carry.release_lot_id else None,
                    "gap_qty": gap,
                },
            )
            db.commit()
        except Exception as audit_exc:
            logger.warning(
                "carry_forward_release_lot_reallocated audit failed: %s", audit_exc
            )

    try:
        # P3.3 — snake_case lowercase action strings throughout the file.
        record_audit_event(
            db=db,
            plant_id=str(job.plant_id),
            entity_type="job_card",
            entity_id=str(job.id),
            action=f"short_close_{decision.lower()}",
            actor_id=str(actor_id),
            actor_role=str(actor_role),
            payload={
                "reason_code": reason_code,
                "stage_type": stage_type,
                "planned_qty": planned,
                "produced_qty": produced,
                "gap_qty": gap,
                "carry_forward_job_card_id": str(carry_id) if carry_id else None,
                "carry_forward_release_orphan": bool(carry_release_orphan),
                "hold_status": short.hold_status,
                "zero_production": zero_production,
                "notes": payload.notes or None,
            },
        )
    except Exception as audit_exc:
        # P3.4 — replace bare pass with a warning so audit failures are visible.
        logger.warning(
            "short_close_%s audit emission failed: %s",
            decision.lower(),
            audit_exc,
        )

    return _serialize_short_close(short)


@router.get("/short-close", response_model=List[ShortCloseResponse])
def list_short_closes(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    query = db.query(JobCardShortClose)
    query = _apply_plant_scope(query, JobCardShortClose.plant_id, plant_scope, action="short-close history")
    if start_date:
        try:
            sd = date.fromisoformat(start_date)
            query = query.filter(JobCardShortClose.created_at >= datetime.combine(sd, datetime.min.time()))
        except ValueError:
            pass
    if end_date:
        try:
            ed = date.fromisoformat(end_date)
            query = query.filter(JobCardShortClose.created_at < datetime.combine(ed + timedelta(days=1), datetime.min.time()))
        except ValueError:
            pass
    rows = query.order_by(JobCardShortClose.created_at.desc()).limit(200).all()
    return [_serialize_short_close(r) for r in rows]


@router.get("/short-close/holds", response_model=List[ShortCloseResponse])
def list_short_close_holds(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    """P3.2 — open HOLD short-closes awaiting a final decision (plant-scoped)."""
    query = db.query(JobCardShortClose).filter(
        JobCardShortClose.decision == "HOLD",
        JobCardShortClose.hold_status == "OPEN",
    )
    query = _apply_plant_scope(
        query, JobCardShortClose.plant_id, plant_scope, action="short-close holds"
    )
    rows = query.order_by(JobCardShortClose.created_at.desc()).limit(200).all()
    return [_serialize_short_close(r) for r in rows]


@router.post("/short-close/{short_close_id}/resolve-hold", response_model=ShortCloseResponse)
def resolve_short_close_hold(
    short_close_id: uuid.UUID,
    payload: ResolveHoldPayload,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["PlantManager", "Admin", "Owner"])),
):
    """P3.2 — resolve an OPEN HOLD by executing the final decision.

    Executes the chosen decision (spawn carry JC + sales reallocate, OR call
    sales short-close sync), then marks the HOLD RESOLVED with the final
    decision + note. Returns the updated short-close.
    """
    decision = (payload.decision or "").strip().upper()
    if decision not in {"CARRY_FORWARD", "SHORT_CLOSE_SO"}:
        raise HTTPException(
            status_code=422,
            detail="decision must be CARRY_FORWARD or SHORT_CLOSE_SO",
        )

    query = db.query(JobCardShortClose).filter(JobCardShortClose.id == short_close_id)
    query = _apply_plant_scope(
        query, JobCardShortClose.plant_id, plant_scope, action="resolve-hold"
    )
    short = query.first()
    if not short:
        raise HTTPException(status_code=404, detail="Short-close not found in this plant scope")
    if (short.hold_status or "").upper() != "OPEN":
        raise HTTPException(
            status_code=409,
            detail="Short-close is not an OPEN hold — nothing to resolve",
        )

    # The originating job card carries the SO/release-lot links the decision needs.
    job = db.query(JobCard).filter(JobCard.id == short.job_card_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Originating job card no longer exists")

    actor_id = current_user.get("sub") or current_user.get("actor_identity") or "unknown"
    actor_role = current_user.get("acting_role") or (current_user.get("roles") or ["?"])[0]
    token = str(current_user.get("token") or "")
    gap = float(short.gap_qty or 0.0)

    if decision == "SHORT_CLOSE_SO" and not job.sales_order_line_id:
        raise HTTPException(
            status_code=422,
            detail="Job card has no linked sales order line to short-close",
        )

    carry_id: Optional[uuid.UUID] = None
    carry_release_orphan = False
    carry: Optional[JobCard] = None
    try:
        if decision == "SHORT_CLOSE_SO":
            _sync_sales_short_close(
                token=token,
                plant_id=job.plant_id,
                sales_order_line_id=job.sales_order_line_id,
                job_card_id=job.id,
                produced_qty=float(short.produced_qty or 0.0),
                gap_qty=gap,
                reason_code=short.reason_code,
                notes=payload.notes,
            )
        elif decision == "CARRY_FORWARD" and gap > 0:
            carry, carry_release_orphan = _spawn_carry_forward_job_card(
                db=db,
                source_job=job,
                gap_qty=gap,
                token=token,
            )
            short.carry_forward_job_card_id = carry.id
            carry_id = carry.id

        short.hold_status = "RESOLVED"
        short.resolved_at = datetime.utcnow()
        short.resolved_by = str(actor_id)
        short.resolution_decision = decision
        short.resolution_note = (payload.notes or None)

        db.commit()
        db.refresh(short)
    except HTTPException:
        db.rollback()
        try:
            record_audit_event(
                db=db,
                plant_id=str(short.plant_id),
                entity_type="job_card",
                entity_id=str(short.job_card_id),
                action="short_close_hold_resolve_failed",
                actor_id=str(actor_id),
                actor_role=str(actor_role),
                payload={
                    "short_close_id": str(short.id),
                    "decision": decision,
                    "gap_qty": gap,
                    "notes": payload.notes or None,
                },
            )
            db.commit()
        except Exception as audit_exc:
            logger.warning(
                "short_close_hold_resolve_failed audit emission failed: %s", audit_exc
            )
        raise
    except Exception as exc:
        db.rollback()
        try:
            record_audit_event(
                db=db,
                plant_id=str(short.plant_id),
                entity_type="job_card",
                entity_id=str(short.job_card_id),
                action="short_close_hold_resolve_failed",
                actor_id=str(actor_id),
                actor_role=str(actor_role),
                payload={
                    "short_close_id": str(short.id),
                    "decision": decision,
                    "gap_qty": gap,
                    "notes": payload.notes or None,
                    "error": str(exc),
                },
            )
            db.commit()
        except Exception as audit_exc:
            logger.warning(
                "short_close_hold_resolve_failed audit emission failed: %s", audit_exc
            )
        raise HTTPException(
            status_code=500,
            detail=f"Resolve-hold failed: {exc}",
        ) from exc

    # Out-of-band carry-forward lot audits (mirror the short-close handler).
    if decision == "CARRY_FORWARD" and carry_id is not None:
        if carry_release_orphan:
            try:
                record_audit_event(
                    db=db,
                    plant_id=str(short.plant_id),
                    entity_type="job_card",
                    entity_id=str(carry_id),
                    action="carry_forward_orphan_release_lot",
                    actor_id=str(actor_id),
                    actor_role=str(actor_role),
                    payload={
                        "source_job_card_id": str(job.id),
                        "original_release_lot_id": (
                            str(job.release_lot_id) if job.release_lot_id else None
                        ),
                        "gap_qty": gap,
                        "note": (
                            "carry-forward JC has no release_lot — sales-service "
                            "callback must allocate a new lot for the gap_qty"
                        ),
                    },
                )
                db.commit()
            except Exception as audit_exc:
                logger.warning(
                    "carry_forward_orphan_release_lot audit failed: %s", audit_exc
                )
        else:
            try:
                record_audit_event(
                    db=db,
                    plant_id=str(short.plant_id),
                    entity_type="job_card",
                    entity_id=str(carry_id),
                    action="carry_forward_release_lot_reallocated",
                    actor_id=str(actor_id),
                    actor_role=str(actor_role),
                    payload={
                        "source_job_card_id": str(job.id),
                        "original_release_lot_id": (
                            str(job.release_lot_id) if job.release_lot_id else None
                        ),
                        "new_release_lot_id": (
                            str(carry.release_lot_id) if carry and carry.release_lot_id else None
                        ),
                        "gap_qty": gap,
                    },
                )
                db.commit()
            except Exception as audit_exc:
                logger.warning(
                    "carry_forward_release_lot_reallocated audit failed: %s", audit_exc
                )

    try:
        record_audit_event(
            db=db,
            plant_id=str(short.plant_id),
            entity_type="job_card",
            entity_id=str(short.job_card_id),
            action="short_close_hold_resolved",
            actor_id=str(actor_id),
            actor_role=str(actor_role),
            payload={
                "short_close_id": str(short.id),
                "stage_type": short.stage_type,
                "resolution_decision": decision,
                "carry_forward_job_card_id": str(carry_id) if carry_id else None,
                "carry_forward_release_orphan": bool(carry_release_orphan),
                "gap_qty": gap,
                "notes": payload.notes or None,
            },
        )
    except Exception as audit_exc:
        logger.warning("short_close_hold_resolved audit emission failed: %s", audit_exc)

    return _serialize_short_close(short)


# ──────────────────────────────────────────────────────────────────────────
# Machine downtime
# ──────────────────────────────────────────────────────────────────────────


class DowntimeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    machine_id: uuid.UUID
    machine_code: Optional[str] = None
    started_at: datetime
    ended_at: Optional[datetime] = None
    reason_code: str
    notes: Optional[str] = None
    is_planned: bool = False
    affected_job_card_ids: Optional[List[uuid.UUID]] = None


class DowntimeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ended_at: Optional[datetime] = None
    reason_code: Optional[str] = None
    notes: Optional[str] = None
    is_planned: Optional[bool] = None


class DowntimeResponse(BaseModel):
    id: uuid.UUID
    machine_id: uuid.UUID
    machine_code: Optional[str]
    started_at: datetime
    ended_at: Optional[datetime]
    duration_minutes: Optional[float]
    reason_code: str
    notes: Optional[str]
    is_planned: bool
    affected_job_card_ids: List[str]
    reschedule_status: Optional[str] = None
    actor_id: Optional[str]
    created_at: datetime


class RescheduleStatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str  # DONE | DISMISSED


def _serialize_downtime(row: MachineDowntime) -> DowntimeResponse:
    affected: List[str] = []
    raw = row.affected_job_card_ids or []
    if isinstance(raw, list):
        affected = [str(x) for x in raw]
    return DowntimeResponse(
        id=row.id,
        machine_id=row.machine_id,
        machine_code=row.machine_code,
        started_at=row.started_at,
        ended_at=row.ended_at,
        duration_minutes=row.duration_minutes,
        reason_code=row.reason_code,
        notes=row.notes,
        is_planned=bool(row.is_planned),
        affected_job_card_ids=affected,
        reschedule_status=row.reschedule_status,
        actor_id=row.actor_id,
        created_at=row.created_at,
    )


@router.post("/downtime", response_model=DowntimeResponse)
def create_downtime(
    payload: DowntimeCreate,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["PlantManager", "Planner", "Admin", "Owner"])),
):
    reason = (payload.reason_code or "").strip().upper()
    if not reason:
        raise HTTPException(status_code=422, detail="reason_code is required")
    if payload.ended_at and payload.ended_at < payload.started_at:
        raise HTTPException(status_code=422, detail="ended_at cannot be before started_at")
    # P2.5 — reject far-future starts (operator typos like 2099-01-01). A 1h
    # buffer covers clock skew between caller and server.
    if payload.started_at and payload.started_at > datetime.utcnow() + timedelta(hours=1):
        raise HTTPException(
            status_code=422,
            detail="started_at cannot be more than 1 hour in the future",
        )
    duration: Optional[float] = None
    if payload.ended_at:
        duration = round((payload.ended_at - payload.started_at).total_seconds() / 60.0, 2)
    actor_id = current_user.get("sub") or current_user.get("actor_identity") or "unknown"
    actor_role = current_user.get("acting_role") or (current_user.get("roles") or ["?"])[0]
    selected_plant = plant_scope.get("selected_plant_id")
    # Downtime is always plant-specific — `MachineDowntime.plant_id` is
    # nullable=False, so even owner-on-ALL must commit against a specific
    # plant. Owners get the first allowed plant by default; everyone else
    # must have a selected plant in scope.
    if not selected_plant:
        allowed = plant_scope.get("allowed_plants") or []
        if allowed:
            selected_plant = allowed[0]
    if not selected_plant:
        raise HTTPException(status_code=400, detail="A plant must be selected to log downtime")
    try:
        plant_uuid = uuid.UUID(str(selected_plant))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"Invalid plant id: {selected_plant}")

    # P2.2 — soft-validate reason_code against masterdata DOWNTIME category.
    _validate_reason_code(
        token=str(current_user.get("token") or ""),
        plant_id=plant_uuid,
        code=reason,
        category="DOWNTIME",
    )

    # P2.14 — when downtime affects job cards, flag a reschedule nudge so the
    # planner sees the affected cards in the reschedule queue.
    affected_ids = [str(j) for j in (payload.affected_job_card_ids or [])]
    reschedule_status = "PENDING" if affected_ids else None

    row = MachineDowntime(
        plant_id=plant_uuid,
        machine_id=payload.machine_id,
        machine_code=(payload.machine_code or None),
        started_at=payload.started_at,
        ended_at=payload.ended_at,
        duration_minutes=duration,
        reason_code=reason,
        notes=(payload.notes or None),
        is_planned=bool(payload.is_planned),
        actor_id=str(actor_id),
        actor_role=str(actor_role),
        affected_job_card_ids=affected_ids,
        reschedule_status=reschedule_status,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    try:
        record_audit_event(
            db=db,
            plant_id=str(plant_uuid) if plant_uuid else None,
            entity_type="machine_downtime",
            entity_id=str(row.id),
            action="downtime_logged",
            actor_id=str(actor_id),
            actor_role=str(actor_role),
            payload={
                "machine_id": str(payload.machine_id),
                "reason_code": reason,
                "duration_minutes": duration,
                "is_planned": bool(payload.is_planned),
                "affected_job_card_ids": affected_ids,
                "reschedule_status": reschedule_status,
                "notes": payload.notes or None,
            },
        )
    except Exception as audit_exc:
        # P3.4 — warn instead of swallowing silently.
        logger.warning("downtime_logged audit emission failed: %s", audit_exc)

    return _serialize_downtime(row)


@router.put("/downtime/{downtime_id}", response_model=DowntimeResponse)
def update_downtime(
    downtime_id: uuid.UUID,
    payload: DowntimeUpdate,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["PlantManager", "Planner", "Admin", "Owner"])),
):
    query = db.query(MachineDowntime).filter(MachineDowntime.id == downtime_id)
    query = _apply_plant_scope(query, MachineDowntime.plant_id, plant_scope, action="downtime update")
    row = query.first()
    if not row:
        raise HTTPException(status_code=404, detail="Downtime row not found")
    updates = payload.model_dump(exclude_unset=True)
    # P1.3 — mirror the POST temporal check so PUT does not silently accept
    # `ended_at < started_at`. Validate against the freshly-stored started_at.
    if (
        "ended_at" in updates
        and updates["ended_at"] is not None
        and row.started_at is not None
        and updates["ended_at"] < row.started_at
    ):
        raise HTTPException(
            status_code=422,
            detail="ended_at cannot be before started_at",
        )
    if "reason_code" in updates and updates["reason_code"] is not None:
        row.reason_code = str(updates["reason_code"]).strip().upper()
    if "notes" in updates:
        row.notes = updates["notes"]
    if "is_planned" in updates and updates["is_planned"] is not None:
        row.is_planned = bool(updates["is_planned"])
    if "ended_at" in updates and updates["ended_at"] is not None:
        row.ended_at = updates["ended_at"]
        if row.started_at and row.ended_at and row.ended_at >= row.started_at:
            row.duration_minutes = round((row.ended_at - row.started_at).total_seconds() / 60.0, 2)
    db.commit()
    db.refresh(row)

    # P2.13 — emit an audit event when an existing downtime row is mutated
    # (typical case: closing an ONGOING event). Previously only create emitted.
    actor_id = current_user.get("sub") or current_user.get("actor_identity") or "unknown"
    actor_role = current_user.get("acting_role") or (current_user.get("roles") or ["?"])[0]
    try:
        record_audit_event(
            db=db,
            plant_id=str(row.plant_id) if row.plant_id else None,
            entity_type="machine_downtime",
            entity_id=str(row.id),
            action="downtime_updated",
            actor_id=str(actor_id),
            actor_role=str(actor_role),
            payload={
                "updated_fields": sorted(updates.keys()),
                "ended_at": row.ended_at.isoformat() if row.ended_at else None,
                "duration_minutes": row.duration_minutes,
                "reason_code": row.reason_code,
                "is_planned": bool(row.is_planned),
            },
        )
    except Exception as audit_exc:
        # P3.4 — warn instead of bare pass.
        logger.warning("downtime_updated audit emission failed: %s", audit_exc)

    return _serialize_downtime(row)


@router.get("/downtime", response_model=List[DowntimeResponse])
def list_downtime(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    machine_id: Optional[uuid.UUID] = Query(None),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    query = db.query(MachineDowntime)
    query = _apply_plant_scope(query, MachineDowntime.plant_id, plant_scope, action="downtime list")
    if start_date:
        try:
            sd = date.fromisoformat(start_date)
            query = query.filter(MachineDowntime.started_at >= datetime.combine(sd, datetime.min.time()))
        except ValueError:
            pass
    if end_date:
        try:
            ed = date.fromisoformat(end_date)
            query = query.filter(MachineDowntime.started_at < datetime.combine(ed + timedelta(days=1), datetime.min.time()))
        except ValueError:
            pass
    if machine_id:
        query = query.filter(MachineDowntime.machine_id == machine_id)
    rows = query.order_by(MachineDowntime.started_at.desc()).limit(500).all()
    return [_serialize_downtime(r) for r in rows]


@router.get("/downtime/reschedule-queue", response_model=List[DowntimeResponse])
def downtime_reschedule_queue(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    """P2.14 — downtime events that affect job cards still awaiting a reschedule.

    Returns plant-scoped rows whose ``affected_job_card_ids`` is non-empty and
    whose ``reschedule_status`` is NULL or PENDING, so the planner can drill to
    the board and reschedule the affected cards.
    """
    query = db.query(MachineDowntime).filter(
        or_(
            MachineDowntime.reschedule_status.is_(None),
            MachineDowntime.reschedule_status == "PENDING",
        )
    )
    query = _apply_plant_scope(
        query, MachineDowntime.plant_id, plant_scope, action="downtime reschedule queue"
    )
    rows = query.order_by(MachineDowntime.started_at.desc()).limit(500).all()
    # JSONB emptiness is awkward to express portably in SQL — filter the bounded
    # result set in Python so only rows with affected job cards surface.
    return [
        _serialize_downtime(r)
        for r in rows
        if downtime_needs_reschedule(r.affected_job_card_ids, r.reschedule_status)
    ]


@router.put("/downtime/{downtime_id}/reschedule-status", response_model=DowntimeResponse)
def update_downtime_reschedule_status(
    downtime_id: uuid.UUID,
    payload: RescheduleStatusUpdate,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["PlantManager", "Planner", "Admin", "Owner"])),
):
    """P2.14 / P3.6 — planner marks a downtime reschedule nudge DONE or DISMISSED."""
    status_value = (payload.status or "").strip().upper()
    if status_value not in {"DONE", "DISMISSED"}:
        raise HTTPException(status_code=422, detail="status must be DONE or DISMISSED")

    query = db.query(MachineDowntime).filter(MachineDowntime.id == downtime_id)
    query = _apply_plant_scope(
        query, MachineDowntime.plant_id, plant_scope, action="downtime reschedule status"
    )
    row = query.first()
    if not row:
        raise HTTPException(status_code=404, detail="Downtime row not found")

    row.reschedule_status = status_value
    db.commit()
    db.refresh(row)

    actor_id = current_user.get("sub") or current_user.get("actor_identity") or "unknown"
    actor_role = current_user.get("acting_role") or (current_user.get("roles") or ["?"])[0]
    try:
        record_audit_event(
            db=db,
            plant_id=str(row.plant_id) if row.plant_id else None,
            entity_type="machine_downtime",
            entity_id=str(row.id),
            action="downtime_reschedule_status_updated",
            actor_id=str(actor_id),
            actor_role=str(actor_role),
            payload={
                "machine_id": str(row.machine_id),
                "reschedule_status": status_value,
                "affected_job_card_ids": (
                    [str(x) for x in row.affected_job_card_ids]
                    if isinstance(row.affected_job_card_ids, list)
                    else []
                ),
            },
        )
    except Exception as audit_exc:
        logger.warning(
            "downtime_reschedule_status_updated audit emission failed: %s", audit_exc
        )

    return _serialize_downtime(row)


# ──────────────────────────────────────────────────────────────────────────
# Data-entry lag rollup
# ──────────────────────────────────────────────────────────────────────────


class LagSummary(BaseModel):
    sample_size: int
    median_minutes: float
    p90_minutes: float
    late_count: int  # rows where lag > 6h
    threshold_minutes: float


class LagRow(BaseModel):
    job_card_id: uuid.UUID
    stage_type: str
    actual_end: Optional[datetime]
    entered_at: Optional[datetime]
    lag_minutes: float
    entered_by: Optional[str]
    shift_code: Optional[str]


class DataEntryLagResponse(BaseModel):
    summary: LagSummary
    laggard_rows: List[LagRow]


@router.get("/data-entry-lag", response_model=DataEntryLagResponse)
def data_entry_lag(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    threshold_hours: float = Query(6.0, ge=0.0, le=72.0),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    """Compute median + p90 lag between actual_end and entered_at.

    Only counts stages where both timestamps exist and entered_at >= actual_end
    (stages still in progress without an actual_end are excluded).
    """
    query = db.query(JobCardStage).join(JobCard, JobCardStage.job_card_id == JobCard.id).filter(
        JobCardStage.actual_end.isnot(None),
        JobCardStage.entered_at.isnot(None),
    )
    query = _apply_plant_scope(query, JobCard.plant_id, plant_scope, action="data-entry lag")
    if start_date:
        try:
            sd = date.fromisoformat(start_date)
            query = query.filter(JobCardStage.actual_end >= datetime.combine(sd, datetime.min.time()))
        except ValueError:
            pass
    if end_date:
        try:
            ed = date.fromisoformat(end_date)
            query = query.filter(JobCardStage.actual_end < datetime.combine(ed + timedelta(days=1), datetime.min.time()))
        except ValueError:
            pass

    rows = query.order_by(JobCardStage.actual_end.desc()).limit(1000).all()

    lags: List[tuple[JobCardStage, float]] = []
    for r in rows:
        if not r.actual_end or not r.entered_at:
            continue
        delta = (r.entered_at - r.actual_end).total_seconds() / 60.0
        if delta < 0:
            continue
        lags.append((r, delta))

    threshold_minutes = float(threshold_hours) * 60.0
    if not lags:
        return DataEntryLagResponse(
            summary=LagSummary(
                sample_size=0, median_minutes=0.0, p90_minutes=0.0,
                late_count=0, threshold_minutes=threshold_minutes,
            ),
            laggard_rows=[],
        )

    minutes = sorted([m for _, m in lags])
    p50 = float(median(minutes))
    # P2.7 — ceil instead of floor; floor returns the wrong index for n=5,
    # 11, 12, 15… Clamp into [0, len-1] for safety.
    p90_idx = max(0, min(len(minutes) - 1, math.ceil(len(minutes) * 0.9) - 1))
    p90 = float(minutes[p90_idx])
    late_count = sum(1 for m in minutes if m > threshold_minutes)

    # Worst 20 rows for the surface table
    lags_sorted = sorted(lags, key=lambda x: x[1], reverse=True)[:20]
    laggard_rows = [
        LagRow(
            job_card_id=r.job_card_id,
            stage_type=r.stage_type or "",
            actual_end=r.actual_end,
            entered_at=r.entered_at,
            lag_minutes=round(m, 1),
            entered_by=r.entered_by,
            shift_code=r.shift_code,
        )
        for r, m in lags_sorted
    ]

    return DataEntryLagResponse(
        summary=LagSummary(
            sample_size=len(lags),
            median_minutes=round(p50, 1),
            p90_minutes=round(p90, 1),
            late_count=late_count,
            threshold_minutes=threshold_minutes,
        ),
        laggard_rows=laggard_rows,
    )
