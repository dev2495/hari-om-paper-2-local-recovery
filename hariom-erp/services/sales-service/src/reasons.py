"""Reason codes from Masters › Reason codes (owner decision 4, 1 Nov 2026: master codes only, everywhere).

Every action that asks "why" sends ``reason_code`` (+ optional ``reason_note``). Before saving, the
owning service calls :func:`resolve_reason`, which asks master data to check the choice — the code is
active, in the right list (category) and of the record's plant, and a code with OTHER in it has a note
of at least 5 characters — and returns the code, the label at that moment and the note. The record keeps
all three; ``text`` ("Label — note") goes into the old free-text column so older screens keep reading it.

A request with only free text and no code is refused once a code is required. The same file is kept in
the sales, inventory and production services (each owns its own copy; keep them identical).
"""
from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from typing import Any, Mapping, Optional

import httpx
from fastapi import HTTPException

log = logging.getLogger(__name__)

OTHER_NOTE_MIN = 5
_OTHER_WORD = re.compile(r"(?<![A-Z0-9])OTHERS?(?![A-Z0-9])")
_TIMEOUT = 6.0


def _master_url() -> str:
    return (
        os.getenv("MASTERDATA_SERVICE_URL")
        or os.getenv("MASTER_DATA_SERVICE_URL")
        or os.getenv("MASTER_SERVICE_URL")
        or "http://masterdata-service:8002"
    ).rstrip("/")


def reason_needs_note(code: Optional[str]) -> bool:
    """OTHER / OTHERS as a whole word of the code (SO-OTHER, QH-OTHER), not inside ANOTHER or MOTHER."""
    return bool(_OTHER_WORD.search(str(code or "").strip().upper()))


@dataclass(frozen=True)
class ReasonChoice:
    category: str
    code: str
    label: str
    note: Optional[str]

    @property
    def text(self) -> str:
        """The legacy free-text form: "Label — note" (or just the label)."""
        return f"{self.label} — {self.note}" if self.note else self.label

    def as_dict(self) -> dict[str, Any]:
        return {"reason_code": self.code, "reason_label": self.label, "reason_note": self.note, "reason_category": self.category, "reason": self.text}


def reason_input(payload: Any, *, code_key: str = "reason_code", note_keys: tuple[str, ...] = ("reason_note", "note")) -> tuple[str, Optional[str]]:
    """(code, note) from a pydantic model or dict, accepting the old ``note`` name for the note."""
    def get(key: str) -> Any:
        if payload is None:
            return None
        if isinstance(payload, Mapping):
            return payload.get(key)
        return getattr(payload, key, None)

    code = str(get(code_key) or "").strip().upper()
    note = None
    for key in note_keys:
        value = get(key)
        if value is not None and str(value).strip():
            note = str(value).strip()
            break
    return code, note


def resolve_reason(
    *,
    category: str,
    code: Optional[str],
    note: Optional[str] = None,
    plant_id: Any = None,
    token: Optional[str] = None,
    required: bool = True,
    what: str = "this",
) -> Optional[ReasonChoice]:
    """Check a reason choice against the master and return it, or raise an HTTPException with plain words.

    ``required=False`` lets a missing code through (returns None) for actions where a reason is optional;
    a code that is sent is always checked.
    """
    cat = str(category or "").strip().upper()
    wanted = str(code or "").strip().upper()
    extra = str(note or "").strip() or None
    if not wanted:
        if not required:
            return None
        raise HTTPException(status_code=422, detail=f"Choose a reason for {what} from the list (Masters › Reason codes).")
    if reason_needs_note(wanted) and len(extra or "") < OTHER_NOTE_MIN:
        raise HTTPException(status_code=422, detail=f"Write a short note (at least {OTHER_NOTE_MIN} characters) when the reason is Other.")
    headers: dict[str, str] = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    plant = str(plant_id or "").strip()
    if plant and plant.upper() != "ALL":
        headers["X-Plant-ID"] = plant
    body = {"category": cat, "reason_code": wanted, "reason_note": extra, "plant_id": plant if plant and plant.upper() != "ALL" else None}
    try:
        response = httpx.post(f"{_master_url()}/master/reason-codes/validate", json=body, headers=headers, timeout=_TIMEOUT)
    except httpx.RequestError as exc:
        log.warning("reason check failed: %s", exc)
        raise HTTPException(status_code=503, detail="Reason codes could not be checked right now. Try again.") from exc
    if response.status_code == 422:
        detail = None
        try:
            detail = (response.json() or {}).get("detail")
        except ValueError:
            detail = None
        raise HTTPException(status_code=422, detail=detail if isinstance(detail, str) and detail else f"{wanted} is not a valid reason here.")
    if response.status_code in (401, 403):
        raise HTTPException(status_code=response.status_code, detail="You cannot use the reason list of this plant.")
    if response.status_code >= 400:
        raise HTTPException(status_code=503, detail="Reason codes could not be checked right now. Try again.")
    try:
        data = response.json() or {}
    except ValueError as exc:
        raise HTTPException(status_code=503, detail="Reason codes could not be checked right now. Try again.") from exc
    return ReasonChoice(category=cat, code=str(data.get("code") or wanted), label=str(data.get("label") or wanted), note=data.get("note") or extra)


def token_of(current_user: Any) -> Optional[str]:
    return current_user.get("token") if isinstance(current_user, Mapping) else None
