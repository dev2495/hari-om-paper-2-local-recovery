"""Actionable in-app notifications for the QC, floor and complaint flows (client rule 2026-10-18).

Every notification names the exact thing and links straight to where it is decided:
- a batch saved on the floor that needs stage QC → In-process QC / QC ("Add QC");
- a batch whose QC fails → held; Owner / Admin / plant head decide ("Decide");
- a batch accepted → the floor and planner know the next stage can take it;
- GRN lots waiting for inward QC, a lot outside its band (held, decide), a lot passed;
- a customer complaint recorded / decided.
Best effort: a failed notification never fails the business action.
"""
from __future__ import annotations

from typing import Any

from fastapi import Request, Response

from src.services.workspace import emit_notification_event, response_body_json

HOLD_DECIDERS = ["Owner", "Admin", "PlantManager"]
STAGE_LABEL = {"WINDER": "Winding", "OVEN": "Oven", "PROCESS": "Process", "QC": "Final QC", "PACKING": "Packing"}
NEXT_STAGE = {"WINDER": "Oven", "OVEN": "Process", "PROCESS": "Packing"}


def _plant(request: Request, body: dict[str, Any] | None = None) -> str | None:
    value = (body or {}).get("plant_id") or request.headers.get("X-Plant-ID")
    return str(value) if value and str(value).upper() != "ALL" else None


async def _emit(token: str, **kwargs: Any) -> None:
    try:
        await emit_notification_event(token=token, **kwargs)
    except Exception:  # pragma: no cover - notification delivery is best effort
        return


async def notify_entry(response: Response, request: Request, token: str, card_id: str, path: str) -> None:
    """Stage batch saved / submitted / QC recorded on a continuous (V2) job card."""
    if response.status_code >= 300:
        return
    body = response_body_json(response) or {}
    if not isinstance(body, dict) or body.get("idempotent") is True:
        return
    entries = [body["entry"]] if isinstance(body.get("entry"), dict) else [row for row in body.get("entries") or [] if isinstance(row, dict)]
    for entry in entries:
        await _notify_one_entry(entry, request, token, card_id, path)


async def _notify_one_entry(entry: dict[str, Any], request: Request, token: str, card_id: str, path: str) -> None:
    if str(entry.get("status") or "") != "SUBMITTED" or str(entry.get("kind") or "") == "QC_ONLY":
        return
    if not entry.get("stage_has_qc"):
        return
    stage = str(entry.get("stage") or "")
    label = STAGE_LABEL.get(stage, stage.title())
    card_no = entry.get("job_card_no") or "Job card"
    batch = f"{card_no} · {label} batch #{entry.get('entry_no')}"
    customer = entry.get("customer") or ""
    plant_id = entry.get("plant_id") or _plant(request)
    entry_id = str(entry.get("id") or "")
    verdict = str((entry.get("evaluation") or {}).get("verdict") or "")
    common = {"plant_id": plant_id, "payload": {"job_card_id": card_id, "entry_id": entry_id, "stage": stage, "plant_id": plant_id}}
    if verdict == "FAIL":
        await _emit(
            token,
            event_type="QC_HOLD_RAISED",
            title=f"QC failed: {batch} is on hold",
            message=f"{customer + ' · ' if customer else ''}{entry.get('accepted')} {'bamboo' if stage != 'PROCESS' else 'pcs'} held. The next stage cannot take it. Plant head / Admin to decide: release, rework or scrap.",
            href=f"/quality/results?tab=jobs&card={card_id}",
            recipient_roles=[*HOLD_DECIDERS, "QC", "InProcessQC"],
            role_context="PlantManager",
            event_id=f"batch-hold:{entry_id}:{entry.get('row_version')}",
            **{**common, "payload": {**common["payload"], "action": "decide_hold", "priority": "critical"}},
        )
        return
    if entry.get("qc_cleared"):
        if "observations" in path:
            nxt = NEXT_STAGE.get(stage)
            await _emit(
                token,
                event_type="QC_BATCH_ACCEPTED",
                title=f"QC accepted: {batch}",
                message=f"{customer + ' · ' if customer else ''}{nxt + ' can take this batch now.' if nxt else 'Batch accepted.'}",
                href=f"/production/job-cards/{card_id}?stage={'OVEN' if stage == 'WINDER' else 'PROCESS' if stage == 'OVEN' else stage}",
                recipient_roles=["PlantManager", "Planner", "Operator"],
                role_context="PlantManager",
                event_id=f"batch-ok:{entry_id}",
                **{**common, "payload": {**common["payload"], "action": "continue", "priority": "info"}},
            )
        return
    short = entry.get("qc_readings_short") or []
    need = ", ".join(f"{row.get('label')} {row.get('have')}/{row.get('need')}" for row in short[:4]) if short else ""
    await _emit(
        token,
        event_type="QC_BATCH_DUE",
        title=f"Stage QC due: {batch}",
        message=f"{customer + ' · ' if customer else ''}{entry.get('accepted')} {'bamboo' if stage != 'PROCESS' else 'pcs'} waiting. The next stage opens once QC is accepted (2 readings per check){' · still needed: ' + need if need else ''}.",
        href=f"/production/job-cards/{card_id}?stage={stage}",
        recipient_roles=["QC", "InProcessQC"],
        role_context="QC",
        event_id=f"batch-due:{entry_id}",
        **{**common, "payload": {**common["payload"], "action": "add_qc", "priority": "action"}},
    )


async def notify_stage_closed(response: Response, request: Request, token: str, card_id: str, stage: str, action: str) -> None:
    if response.status_code >= 300 or action != "close":
        return
    body = response_body_json(response) or {}
    label = STAGE_LABEL.get(stage.upper(), stage.title())
    await _emit(
        token,
        event_type="JOB_CARD_STAGE_HANDOFF",
        title=f"{label} closed on a job card",
        message=f"{label} is closed. Open the card for the next stage and its plan.",
        href=f"/production/job-cards/{card_id}",
        recipient_roles=["PlantManager", "Planner", "QC", "InProcessQC"],
        role_context="Planner",
        plant_id=_plant(request, body if isinstance(body, dict) else None),
        payload={"job_card_id": card_id, "stage": stage.upper(), "action": "schedule", "priority": "action"},
        event_id=f"stage-closed:{card_id}:{stage.upper()}",
    )


async def notify_receipt(path: str, response: Response, request: Request, token: str) -> None:
    """GRN posted → its lots wait for inward QC; a manual GRN also waits for an Owner's approval."""
    if response.status_code >= 300:
        return
    body = response_body_json(response) or {}
    if not isinstance(body, dict) or body.get("idempotent") is True:
        return
    plant_id = _plant(request, body)
    commercial = str(body.get("commercial_status") or "").upper()
    grn_label = body.get("grn_no") or "GRN"
    supplier_label = body.get("supplier_name") or "Supplier"
    receipt_id = str(body.get("id") or body.get("receipt_id") or "")
    # Stock held for a commercial reason goes to the people who clear it (client 2026-10-18:
    # "approval ke liye kiske pass jayega").
    if path in {"receipts", "manual-receipts"} or path.endswith("/attach-invoice"):
        if commercial in {"RATE_REVIEW", "REVIEW_REQUIRED"}:
            await _emit(
                token,
                event_type="PURCHASE_INVOICE_DIFFERENCE",
                title=f"{grn_label}: invoice differs from the PO — decide",
                message=f"{supplier_label}: the invoice rate or quantity is not what the PO says, so the stock is held. Plant head or Accounts accepts the difference, raises a debit note or releases the stock (not the person who made the GRN).",
                href="/purchase/discrepancies",
                recipient_roles=["PlantManager", "Accounts", "Owner", "Admin"],
                role_context="PlantManager",
                plant_id=plant_id,
                payload={"receipt_id": receipt_id, "action": "approve", "priority": "action", "plant_id": plant_id},
                event_id=f"grn-difference:{receipt_id}:{commercial}",
            )
        elif commercial == "INVOICE_PENDING" and path in {"receipts", "manual-receipts"}:
            if body.get("rate_review_cases"):
                # Challan rate differs from the PO: the review case opens now, before the invoice comes.
                await _emit(
                    token,
                    event_type="PURCHASE_INVOICE_DIFFERENCE",
                    title=f"{grn_label}: challan rate differs from the PO — decide",
                    message=f"{supplier_label}: the rate on the challan is not what the PO says. Plant head or Accounts accepts the difference or keeps the case for the invoice (not the person who made the GRN). Incoming QC still decides whether the stock can be issued.",
                    href="/purchase/discrepancies",
                    recipient_roles=["PlantManager", "Accounts", "Owner", "Admin"],
                    role_context="PlantManager",
                    plant_id=plant_id,
                    payload={"receipt_id": receipt_id, "action": "approve", "priority": "action", "plant_id": plant_id},
                    event_id=f"grn-difference:{receipt_id}:CHALLAN_RATE",
                )
            await _emit(
                token,
                event_type="PURCHASE_INVOICE_PENDING",
                title=f"{grn_label}: attach the supplier invoice",
                message=f"{supplier_label} goods were received without an invoice, so the stock is held. Store attaches the invoice in the GRN register when it arrives; matching rates release the stock.",
                href=f"/purchase/receipts?receipt={receipt_id}",
                recipient_roles=["Store", "GRN", "PlantManager"],
                role_context="Store",
                plant_id=plant_id,
                payload={"receipt_id": receipt_id, "action": "attach_invoice", "priority": "action", "plant_id": plant_id},
                event_id=f"grn-invoice:{receipt_id}",
            )
    if path in {"receipts", "manual-receipts"}:
        lots = body.get("lots") or body.get("created_lots") or []
        grn = body.get("grn_no") or "GRN"
        if lots:
            await _emit(
                token,
                event_type="QC_LOTS_TO_INSPECT",
                title=f"{grn}: {len(lots)} lot{'s' if len(lots) != 1 else ''} to inspect",
                message=f"{body.get('supplier_name') or 'Supplier'} delivery is on QC hold. Inspect within 24 hours; lots inside their bands are released.",
                href="/quality/incoming",
                recipient_roles=["QC", "InwardQC"],
                role_context="InwardQC",
                plant_id=plant_id,
                payload={"receipt_id": str(body.get("id") or ""), "action": "inspect", "priority": "action", "plant_id": plant_id},
                event_id=f"grn-qc:{body.get('id')}",
            )
        if path == "manual-receipts":
            await _emit(
                token,
                event_type="PURCHASE_MANUAL_GRN_APPROVAL",
                title=f"Manual {grn} needs approval",
                message=f"{body.get('supplier_name') or 'Supplier'} goods were received without a PO. Plant head or Accounts (not the person who made the GRN) approves it before the stock is usable.",
                href=f"/purchase/receipts?receipt={body.get('id')}",
                recipient_roles=["PlantManager", "Accounts", "Owner", "Admin"],
                role_context="Owner",
                plant_id=plant_id,
                payload={"receipt_id": str(body.get("id") or ""), "action": "approve", "priority": "action", "plant_id": plant_id},
                event_id=f"manual-grn:{body.get('id')}",
            )


async def notify_inward_inspection(response: Response, request: Request, token: str) -> None:
    """An inward lot outside its band is held for a decision; a passing lot is usable."""
    if response.status_code >= 300:
        return
    body = response_body_json(response) or {}
    if not isinstance(body, dict):
        return
    status = str(body.get("status") or "").upper()
    disposition = str(body.get("disposition") or "").upper()
    entity = f"{body.get('entity_type')}:{body.get('entity_id')}"
    label = body.get("entity_label") or f"{str(body.get('material_type') or 'material').replace('_', ' ').lower()} lot"
    plant_id = _plant(request, body)
    failing = [str(row.get("label") or row.get("code") or "") for row in body.get("failures") or [] if isinstance(row, dict)]
    if status in {"FAIL", "INVALID"} and disposition not in {"ACCEPT"}:
        await _emit(
            token,
            event_type="QC_LOT_HELD",
            title=f"Inward lot held: {label}",
            message=f"Outside the band: {', '.join(filter(None, failing)) or 'see readings'}. It cannot be issued until QC decides — re-inspect, accept under concession, or return to the supplier.",
            href=f"/quality/incoming?lot={entity}",
            recipient_roles=["Owner", "Admin", "PlantManager", "QC", "InwardQC", "Store"],
            role_context="QC",
            plant_id=plant_id,
            payload={"inspection_id": str(body.get("id") or ""), "entity": entity, "action": "decide_lot", "priority": "critical", "plant_id": plant_id},
            event_id=f"lot-held:{body.get('id')}",
        )
    elif status == "PASS":
        await _emit(
            token,
            event_type="INVENTORY_QC_RECORDED",
            title=f"Inward lot passed QC: {label}",
            message="All readings are inside their bands. The lot is released for issue once purchase has cleared it.",
            href="/inventory",
            recipient_roles=["Store", "GRN", "RMIssue", "PlantManager"],
            role_context="Store",
            plant_id=plant_id,
            payload={"inspection_id": str(body.get("id") or ""), "entity": entity, "action": "review", "priority": "info", "plant_id": plant_id},
            event_id=f"lot-pass:{body.get('id')}",
        )
