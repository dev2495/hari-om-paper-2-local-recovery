"""The plant's AIT reel serial setting (owner decision 6, 1 Nov 2026) and glue tank number setting (owner,
3 Nov 2026), two separate series with the same rules.

GET shows this financial year's next number, the highest given and who set it; PUT lets the Owner / Admin
set the next number once for the year the plant is in the middle of (afterwards only raised). Audited.
"""
from __future__ import annotations

import logging

from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..reasons import reason_input, resolve_reason, token_of
from ..services import reel_serial, tank_serial
from ..services.books import ist_today
from ..services.stock_lots import get_one_plant
from ..utils.audit_client import emit_audit_event
from ..utils.auth import require_role

router = APIRouter(prefix="/inventory/reel-serial", tags=["inventory-reel-serial"])
tank_router = APIRouter(prefix="/inventory/tank-serial", tags=["inventory-reel-serial"])
_logger = logging.getLogger(__name__)
VIEW_ROLES = ["Store", "GRN", "PlantManager"]


class ReelSerialSet(BaseModel):
    model_config = ConfigDict(extra="forbid")
    next_number: int = Field(ge=1, le=reel_serial.MAX_NUMBER)
    # A REEL_SERIAL code from Masters › Reason codes (owner decision 4, 1 Nov 2026); `reason` is the old
    # free text, never enough on its own.
    reason_code: Optional[str] = Field(default=None, max_length=80)
    reason_note: Optional[str] = Field(default=None, max_length=500)
    reason: Optional[str] = Field(default=None, max_length=500)


@router.get("")
def get_reel_serial(
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(require_role(VIEW_ROLES)),
):
    state = reel_serial.series_state(db, plant_id, ist_today())
    roles = set(current_user.get("roles") or [])
    return {**state, "can_set": bool(roles & {"Owner", "Admin"})}


@router.put("")
def set_reel_serial(
    payload: ReelSerialSet,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(require_role([])),  # Owner / Admin only
):
    actor = str(current_user.get("sub") or "unknown")
    code, note = reason_input(payload)
    why = resolve_reason(category="REEL_SERIAL", code=code, note=note, plant_id=plant_id, token=token_of(current_user),
                         what="setting the next reel number")
    change = reel_serial.set_next_number(db, plant_id, payload.next_number, actor=actor, reason=why.text, today=ist_today(),
                                         reason_code=why.code, reason_label=why.label, reason_note=why.note)
    db.commit()
    state = reel_serial.series_state(db, plant_id, ist_today())
    try:
        emit_audit_event(
            token=current_user.get("token", ""), event_type="reel_serial_set", entity_type="plant", entity_id=str(plant_id),
            plant_id=str(plant_id), actor_role=str((current_user.get("roles") or ["?"])[0]), actor_email=actor,
            summary=(f"Next reel serial for {state['year_label']} set from {reel_serial.serial_text(change['from_number'])} "
                     f"to {reel_serial.serial_text(change['to_number'])}: {why.text}"),
            payload={**change, "financial_year": state["financial_year"], "reason": why.text, "reason_code": why.code,
                     "reason_label": why.label, "reason_note": why.note},
        )
    except Exception as exc:  # pragma: no cover - the setting row is the record; the audit feed is a copy
        _logger.warning("audit emit failed for reel_serial_set %s: %s", plant_id, exc)
    return {**state, "can_set": True}


# Glue tanks: the same setting on its own series (owner, 3 Nov 2026). The why uses the REEL_SERIAL reason codes.
@tank_router.get("")
def get_tank_serial(
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(require_role(VIEW_ROLES)),
):
    state = tank_serial.series_state(db, plant_id, ist_today())
    roles = set(current_user.get("roles") or [])
    return {**state, "can_set": bool(roles & {"Owner", "Admin"})}


@tank_router.put("")
def set_tank_serial(
    payload: ReelSerialSet,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(require_role([])),  # Owner / Admin only
):
    actor = str(current_user.get("sub") or "unknown")
    code, note = reason_input(payload)
    why = resolve_reason(category="REEL_SERIAL", code=code, note=note, plant_id=plant_id, token=token_of(current_user),
                         what="setting the next glue tank number")
    change = tank_serial.set_next_number(db, plant_id, payload.next_number, actor=actor, reason=why.text, today=ist_today(),
                                         reason_code=why.code, reason_label=why.label, reason_note=why.note)
    db.commit()
    state = tank_serial.series_state(db, plant_id, ist_today())
    try:
        emit_audit_event(
            token=current_user.get("token", ""), event_type="tank_serial_set", entity_type="plant", entity_id=str(plant_id),
            plant_id=str(plant_id), actor_role=str((current_user.get("roles") or ["?"])[0]), actor_email=actor,
            summary=(f"Next glue tank number for {state['year_label']} set from {tank_serial.serial_text(change['from_number'])} "
                     f"to {tank_serial.serial_text(change['to_number'])}: {why.text}"),
            payload={**change, "kind": tank_serial.KIND, "financial_year": state["financial_year"], "reason": why.text,
                     "reason_code": why.code, "reason_label": why.label, "reason_note": why.note},
        )
    except Exception as exc:  # pragma: no cover - the setting row is the record; the audit feed is a copy
        _logger.warning("audit emit failed for tank_serial_set %s: %s", plant_id, exc)
    return {**state, "can_set": True}
