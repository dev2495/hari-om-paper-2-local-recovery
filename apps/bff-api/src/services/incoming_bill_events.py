"""Notifications after a bill-wise weigh-in save (6 Nov 2026). Best effort, like quality_events.

A lot that a save held or rejected tells the deciders (same event as the per-lot desk, QC_LOT_HELD);
lots released for issue are told to Stores once per save, not once per reel. The weight check's own
notifications (Owner decision, auto debit note, PO raiser follow-up) come from inventory's outbox.
"""
from __future__ import annotations

from typing import Any

from fastapi import Request, Response

from src.services.quality_events import HOLD_DECIDERS, _emit, _plant
from src.services.workspace import response_body_json


async def notify_bill_entries(response: Response, request: Request, token: str) -> None:
    if response.status_code >= 300:
        return
    body = response_body_json(response) or {}
    if not isinstance(body, dict):
        return
    bill = body.get("bill") or {}
    plant_id = _plant(request, bill)
    lots = {lot.get("entity_id"): lot for lot in bill.get("lots") or [] if isinstance(lot, dict)}
    released = []
    for row in body.get("rows") or []:
        if not isinstance(row, dict) or not row.get("ok") or row.get("idempotent") or not row.get("inspection_id"):
            continue
        lot = lots.get(row.get("entity_id")) or {}
        name = lot.get("label") or lot.get("code") or "Inward lot"
        if row.get("released"):
            released.append(lot.get("code") or name)
            continue
        entity = f"{row.get('entity_type')}:{row.get('entity_id')}"
        await _emit(
            token,
            event_type="QC_LOT_HELD",
            title=f"Inward lot held: {name}",
            message=f"{bill.get('title') or 'Inward bill'}: {row.get('status') or 'held'}{' · ' + row['disposition'] if row.get('disposition') else ''}. "
                    "It cannot be issued until QC decides: re-inspect, accept under concession, or return to the supplier.",
            href=f"/quality/incoming?lot={entity}",
            recipient_roles=[*HOLD_DECIDERS, "QC", "InwardQC", "Store"],
            role_context="QC",
            plant_id=plant_id,
            payload={"inspection_id": row.get("inspection_id"), "entity": entity, "action": "decide_lot", "priority": "critical", "plant_id": plant_id},
            event_id=f"lot-held:{row.get('inspection_id')}",
        )
    if released:
        await _emit(
            token,
            event_type="INVENTORY_QC_RECORDED",
            title=f"Passed QC: {len(released)} lot{'s' if len(released) != 1 else ''} · {bill.get('title') or 'inward bill'}",
            message=f"{', '.join(released[:12])}{' …' if len(released) > 12 else ''} can be issued to the floor.",
            href="/inventory",
            recipient_roles=["Store", "GRN", "RMIssue", "PlantManager"],
            role_context="Store",
            plant_id=plant_id,
            payload={"bill_key": bill.get("key"), "action": "review", "priority": "info", "plant_id": plant_id},
            event_id=f"bill-pass:{bill.get('key')}:{','.join(sorted(str(row.get('inspection_id')) for row in body.get('rows') or [] if isinstance(row, dict) and row.get('released')))}"[:120],
        )
