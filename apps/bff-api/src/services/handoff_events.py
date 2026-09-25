"""Production handoff notifications.

The BFF sees every successful mutation, so it is the one place that can tell the
next role "this is now yours". Each emitter:

* runs only after a 2xx upstream response (never on validation failures),
* is scheduled in the background so the operator's request is not slowed,
* resolves the plant from the job card itself (the auth service refuses to
  deliver plant-less events, by design),
* carries a deterministic ``event_id`` so retries and replays never double-notify.

Failures are swallowed: a notification must never break a production write.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable, Optional

import httpx
from fastapi import Request, Response

from src.services.workspace import (
    PRODUCTION_SERVICE_URL,
    emit_notification_event,
    response_body_json,
    workspace_http_client,
)

logger = logging.getLogger(__name__)

_background: set[asyncio.Task] = set()

STAGE_LABELS = {
    "SLITTING": "Slitting",
    "WINDER": "Winding",
    "WINDING": "Winding",
    "OVEN": "Oven",
    "PROCESS": "Process",
    "CUTTING": "Cutting",
    "FINISHING": "Finishing",
    "PACKING": "Packing",
    "QC": "Quality check",
    "DISPATCH": "Dispatch",
    "DONE": "Complete",
}


def stage_label(value: Any) -> str:
    key = str(value or "").strip().upper()
    return STAGE_LABELS.get(key, key.replace("_", " ").title() or "Stage")


def _plant_header(request: Request) -> Optional[str]:
    value = (request.headers.get("X-Plant-ID") or "").strip()
    return value if value and value.upper() != "ALL" else None


def run_in_background(factory: Callable[[], Awaitable[None]]) -> None:
    async def runner() -> None:
        try:
            await factory()
        except Exception:  # pragma: no cover - defensive; notifications are best effort
            logger.warning("handoff notification failed", exc_info=True)

    try:
        task = asyncio.get_running_loop().create_task(runner())
    except RuntimeError:
        return
    _background.add(task)
    task.add_done_callback(_background.discard)


async def job_card_context(job_card_id: str, token: str, plant_hint: Optional[str]) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    if plant_hint:
        headers["X-Plant-ID"] = plant_hint
    try:
        response = await workspace_http_client.get(f"{PRODUCTION_SERVICE_URL}/job-cards/{job_card_id}", headers=headers)
        if response.status_code >= 400:
            return {}
        body = response.json()
        return body if isinstance(body, dict) else {}
    except (httpx.RequestError, ValueError):
        return {}


def _card_ref(card: dict[str, Any], job_card_id: str) -> str:
    return str(card.get("job_card_ref") or card.get("job_card_no") or job_card_id[:8])


def _order_ref(card: dict[str, Any]) -> str:
    order = card.get("sales_order") if isinstance(card.get("sales_order"), dict) else {}
    return str(card.get("sales_order_ref") or order.get("po_number") or order.get("order_no") or "")


def _customer(card: dict[str, Any]) -> str:
    order = card.get("sales_order") if isinstance(card.get("sales_order"), dict) else {}
    return str(order.get("customer_name") or "")


def _describe(card: dict[str, Any]) -> str:
    parts = [part for part in (card.get("product_code"), _order_ref(card), _customer(card)) if part]
    return " · ".join(str(part) for part in parts)


async def _emit(token: str, **kwargs: Any) -> None:
    try:
        await emit_notification_event(token=token, **kwargs)
    except httpx.RequestError:
        return


def _ok(response: Response) -> bool:
    return 200 <= response.status_code < 300


# ─────────────────────────── Emitters ───────────────────────────


def notify_release_sync(response: Response, request: Request, token: str, sales_order_id: str) -> None:
    if not _ok(response):
        return
    body = response_body_json(response) or {}
    results = body.get("line_results") if isinstance(body, dict) else None
    job_ids = [str(row.get("job_card_id")) for row in (results or []) if isinstance(row, dict) and row.get("job_card_id")]
    if not job_ids:
        return
    missing_qc = sum(1 for row in results or [] if isinstance(row, dict) and row.get("missing_qc_setup"))
    plant_hint = _plant_header(request)

    async def send() -> None:
        card = await job_card_context(job_ids[0], token, plant_hint)
        plant_id = str(card.get("plant_id") or plant_hint or "") or None
        count = len(job_ids)
        detail = _describe(card)
        await _emit(
            token,
            event_type="JOB_CARDS_READY_TO_PLAN",
            title=f"{count} job card{'s' if count != 1 else ''} ready to schedule",
            message=f"{detail or 'New release'} was handed to planning. Place it on a machine and shift.",
            href=f"/planning/board?order_id={sales_order_id}",
            recipient_roles=["Planner", "PlantManager"],
            role_context="Planner",
            plant_id=plant_id,
            payload={"order_id": sales_order_id, "job_card_ids": job_ids, "action": "schedule", "priority": "action"},
            event_id=f"release-sync:{sales_order_id}:{','.join(sorted(job_ids))}",
        )
        if missing_qc:
            await _emit(
                token,
                event_type="QC_SETUP_REQUIRED",
                title=f"QC setup needed for {missing_qc} released card{'s' if missing_qc != 1 else ''}",
                message=f"{detail or 'A release'} has no approved QC profile yet. Attach one before the first checkpoint.",
                href="/quality",
                recipient_roles=["QC", "PlantManager"],
                role_context="QC",
                plant_id=plant_id,
                payload={"order_id": sales_order_id, "job_card_ids": job_ids, "action": "attach_qc", "priority": "action"},
                event_id=f"qc-setup:{sales_order_id}:{','.join(sorted(job_ids))}",
            )

    run_in_background(send)


def notify_machine_assigned(response: Response, request: Request, token: str, job_card_id: str, body: Any) -> None:
    if not _ok(response):
        return
    result = response_body_json(response) or {}
    stage = result.get("stage") if isinstance(result, dict) else None
    plant_hint = _plant_header(request)
    plan_date = body.get("plan_date") if isinstance(body, dict) else None
    shift = body.get("shift_code") if isinstance(body, dict) else None

    async def send() -> None:
        card = await job_card_context(job_card_id, token, plant_hint)
        ref = _card_ref(card, job_card_id)
        when = " · ".join(str(part) for part in (plan_date, shift and f"shift {shift}") if part)
        await _emit(
            token,
            event_type="JOB_CARD_SCHEDULED",
            title=f"{ref} scheduled for {stage_label(stage)}",
            message=f"{_describe(card) or 'Job card'} is on the machine plan{f' ({when})' if when else ''}. Prepare material and start when due.",
            href=f"/production/job-cards/{job_card_id}",
            recipient_roles=["Operator", "PlantManager", "Store"],
            role_context="Operator",
            plant_id=str(card.get("plant_id") or plant_hint or "") or None,
            payload={"job_card_id": job_card_id, "stage": stage, "action": "start", "priority": "info"},
            event_id=f"assign:{job_card_id}:{stage}:{plan_date}:{shift}",
        )

    run_in_background(send)


def notify_stage_output(response: Response, request: Request, token: str, job_card_id: str) -> None:
    if not _ok(response):
        return
    result = response_body_json(response) or {}
    if not isinstance(result, dict) or not result.get("entry_saved", True):
        return
    stage = str(result.get("stage") or "")
    stage_status = str(result.get("stage_status") or "").upper()
    current = str(result.get("current_stage") or "")
    card_status = str(result.get("job_card_status") or "").upper()
    holds = [str(item) for item in result.get("quality_hold_ids") or []]
    segment = str(result.get("segment_id") or "")
    plant_hint = _plant_header(request)

    async def send() -> None:
        card = await job_card_context(job_card_id, token, plant_hint)
        ref = _card_ref(card, job_card_id)
        plant_id = str(card.get("plant_id") or plant_hint or "") or None
        detail = _describe(card)
        if holds:
            await _emit(
                token,
                event_type="QC_HOLD_RAISED",
                title=f"{ref} on quality hold at {stage_label(stage)}",
                message=f"{detail or 'Job card'} failed a checkpoint and cannot move on until QC decides.",
                href=f"/production/job-cards/{job_card_id}",
                recipient_roles=["QC", "PlantManager", "Planner", "Sales"],
                role_context="QC",
                plant_id=plant_id,
                payload={"job_card_id": job_card_id, "stage": stage, "hold_ids": holds, "action": "review_hold", "priority": "critical"},
                event_id=f"stage-hold:{job_card_id}:{','.join(sorted(holds))}",
            )
            return
        if stage_status not in {"COMPLETED", "DONE", "CLOSED"}:
            return
        if card_status in {"COMPLETED", "CLOSED"} or current.upper() in {"DONE", "DISPATCH"}:
            await _emit(
                token,
                event_type="JOB_CARD_READY_FOR_DISPATCH",
                title=f"{ref} finished production",
                message=f"{detail or 'Job card'} completed all stages. Book finished goods and plan the dispatch.",
                href="/logistics/dispatch",
                recipient_roles=["Dispatch", "Store", "Sales", "PlantManager"],
                role_context="Dispatch",
                plant_id=plant_id,
                payload={"job_card_id": job_card_id, "stage": stage, "action": "dispatch", "priority": "action"},
                event_id=f"stage-done:{job_card_id}",
            )
            return
        next_label = stage_label(current)
        await _emit(
            token,
            event_type="JOB_CARD_STAGE_HANDOFF",
            title=f"{ref}: {stage_label(stage)} done → {next_label}",
            message=f"{detail or 'Job card'} moved to {next_label}. Schedule the next machine or inspect before it proceeds.",
            href=f"/production/job-cards/{job_card_id}",
            recipient_roles=["Planner", "PlantManager", "QC", "Operator"],
            role_context="Planner",
            plant_id=plant_id,
            payload={"job_card_id": job_card_id, "stage": stage, "next_stage": current, "action": "schedule", "priority": "action"},
            event_id=f"stage-handoff:{job_card_id}:{stage}:{segment or 'all'}",
        )

    run_in_background(send)


def notify_qc_complete(response: Response, request: Request, token: str, job_card_id: str) -> None:
    if not _ok(response):
        return
    result = response_body_json(response) or {}
    if not isinstance(result, dict):
        return
    accepted = bool(result.get("accepted"))
    stage = result.get("visible_stage")
    issues = result.get("issues") or []
    plant_hint = _plant_header(request)

    async def send() -> None:
        card = await job_card_context(job_card_id, token, plant_hint)
        ref = _card_ref(card, job_card_id)
        detail = _describe(card)
        if accepted:
            await _emit(
                token,
                event_type="QC_CLEARED",
                title=f"{ref} cleared by QC",
                message=f"{detail or 'Job card'} passed {stage_label(stage)} inspection and can continue.",
                href=f"/production/job-cards/{job_card_id}",
                recipient_roles=["Planner", "PlantManager", "Operator", "Dispatch"],
                role_context="Planner",
                plant_id=str(card.get("plant_id") or plant_hint or "") or None,
                payload={"job_card_id": job_card_id, "stage": stage, "action": "continue", "priority": "info"},
                event_id=f"qc-complete:{job_card_id}:{stage}:{result.get('inspection_count')}",
            )
        elif issues:
            await _emit(
                token,
                event_type="QC_REJECTED",
                title=f"{ref} not cleared by QC",
                message=f"{len(issues)} issue{'s' if len(issues) != 1 else ''} to resolve on {detail or 'this job card'} before it can move on.",
                href=f"/production/job-cards/{job_card_id}",
                recipient_roles=["PlantManager", "Planner", "QC"],
                role_context="PlantManager",
                plant_id=str(card.get("plant_id") or plant_hint or "") or None,
                payload={"job_card_id": job_card_id, "stage": stage, "action": "resolve", "priority": "critical"},
                event_id=f"qc-reject:{job_card_id}:{stage}:{result.get('inspection_count')}",
            )

    run_in_background(send)


def notify_hold(response: Response, request: Request, token: str, *, released: bool) -> None:
    if not _ok(response):
        return
    result = response_body_json(response) or {}
    if not isinstance(result, dict) or not result.get("job_card_id"):
        return
    job_card_id = str(result["job_card_id"])
    hold_id = str(result.get("id") or "")
    reason = str(result.get("reason") or "")
    stage = result.get("stage_type")
    plant_hint = _plant_header(request)

    async def send() -> None:
        card = await job_card_context(job_card_id, token, plant_hint)
        ref = _card_ref(card, job_card_id)
        await _emit(
            token,
            event_type="QC_HOLD_RELEASED" if released else "QC_HOLD_RAISED",
            title=f"{ref} {'released from' if released else 'placed on'} quality hold",
            message=(f"{_describe(card) or 'Job card'} can resume at {stage_label(stage)}." if released else f"{stage_label(stage)}: {reason or 'Quality hold raised.'}"),
            href=f"/production/job-cards/{job_card_id}",
            recipient_roles=["Planner", "PlantManager", "Operator", "Sales"] if released else ["QC", "PlantManager", "Planner", "Sales"],
            role_context="Planner" if released else "QC",
            plant_id=str(card.get("plant_id") or plant_hint or "") or None,
            payload={"job_card_id": job_card_id, "hold_id": hold_id, "stage": stage, "action": "resume" if released else "review_hold", "priority": "info" if released else "critical"},
            event_id=f"hold:{hold_id}:{'released' if released else 'raised'}",
        )

    run_in_background(send)


def notify_job_closed(response: Response, request: Request, token: str, job_card_id: str) -> None:
    if not _ok(response):
        return
    plant_hint = _plant_header(request)

    async def send() -> None:
        card = await job_card_context(job_card_id, token, plant_hint)
        ref = _card_ref(card, job_card_id)
        await _emit(
            token,
            event_type="JOB_CARD_CLOSED",
            title=f"{ref} closed",
            message=f"{_describe(card) or 'Job card'} is closed. Finished goods are ready for dispatch planning.",
            href="/logistics/dispatch",
            recipient_roles=["Dispatch", "Sales", "Store", "PlantManager"],
            role_context="Dispatch",
            plant_id=str(card.get("plant_id") or plant_hint or "") or None,
            payload={"job_card_id": job_card_id, "action": "dispatch", "priority": "action"},
            event_id=f"job-closed:{job_card_id}",
        )

    run_in_background(send)


def notify_short_close(response: Response, request: Request, token: str, job_card_id: str) -> None:
    if not _ok(response):
        return
    result = response_body_json(response) or {}
    if not isinstance(result, dict):
        return
    gap = result.get("gap_qty")
    decision = str(result.get("decision") or "").replace("_", " ").lower()
    plant_hint = _plant_header(request)

    async def send() -> None:
        card = await job_card_context(job_card_id, token, plant_hint)
        ref = _card_ref(card, job_card_id)
        await _emit(
            token,
            event_type="JOB_CARD_SHORT_CLOSED",
            title=f"{ref} short-closed ({gap:,.0f} pcs gap)" if isinstance(gap, (int, float)) else f"{ref} short-closed",
            message=f"{_describe(card) or 'Job card'} closed below plan{f' — {decision}' if decision else ''}. Check the customer commitment.",
            href=f"/production/job-cards/{job_card_id}",
            recipient_roles=["Sales", "Planner", "PlantManager"],
            role_context="Sales",
            plant_id=str(card.get("plant_id") or plant_hint or "") or None,
            payload={"job_card_id": job_card_id, "short_close_id": str(result.get("id") or ""), "action": "review", "priority": "action"},
            event_id=f"short-close:{result.get('id')}",
        )

    run_in_background(send)


def notify_downtime(response: Response, request: Request, token: str) -> None:
    if not _ok(response):
        return
    result = response_body_json(response) or {}
    if not isinstance(result, dict) or result.get("is_planned"):
        return
    affected = [str(item) for item in result.get("affected_job_card_ids") or []]
    plant_hint = _plant_header(request)
    machine = str(result.get("machine_code") or "Machine")
    reason = str(result.get("reason_code") or "").replace("_", " ").lower()

    async def send() -> None:
        plant_id = plant_hint
        if not plant_id and affected:
            card = await job_card_context(affected[0], token, None)
            plant_id = str(card.get("plant_id") or "") or None
        await _emit(
            token,
            event_type="MACHINE_DOWNTIME",
            title=f"{machine} down{f' — {reason}' if reason else ''}",
            message=f"{len(affected)} scheduled job card{'s' if len(affected) != 1 else ''} affected. Reschedule or move the queue." if affected else "Unplanned downtime logged. Check the machine queue.",
            href="/operations/control",
            recipient_roles=["Planner", "PlantManager"],
            role_context="Planner",
            plant_id=plant_id,
            payload={"downtime_id": str(result.get("id") or ""), "job_card_ids": affected, "action": "reschedule", "priority": "critical" if affected else "action"},
            event_id=f"downtime:{result.get('id')}",
        )

    run_in_background(send)
