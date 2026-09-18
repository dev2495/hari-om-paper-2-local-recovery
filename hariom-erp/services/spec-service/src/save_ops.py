"""Stable save-operation key, payload fingerprint, and optimistic write revision."""

from __future__ import annotations

import hashlib
import json
from typing import Any, Optional
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from .models import SpecificationSheet, SpecSaveOperation


def payload_fingerprint(payload: BaseModel) -> str:
    dumped = payload.model_dump(mode="json", exclude={"save_operation_key", "expected_revision"})
    return hashlib.sha256(json.dumps(dumped, sort_keys=True, default=str).encode("utf-8")).hexdigest()


def clean_operation_key(value: Any) -> Optional[str]:
    if value is None:
        return None
    key = str(value).strip()
    return key or None


def require_expected_revision(spec: SpecificationSheet, expected: Any) -> None:
    if expected is None:
        return
    try:
        wanted = int(expected)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail={"code": "STALE_REVISION", "message": "expected_revision must be an integer."},
        ) from exc
    current = int(spec.write_revision or 1)
    if wanted != current:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "STALE_REVISION",
                "message": "This specification revision is stale. Reload the current revision before saving.",
                "current_revision": current,
            },
        )


def bump_write_revision(spec: SpecificationSheet) -> None:
    spec.write_revision = int(spec.write_revision or 1) + 1


def replay_or_conflict(
    *,
    db: Session,
    plant_id: str,
    operation_key: Optional[str],
    fingerprint: str,
) -> Optional[SpecificationSheet]:
    key = clean_operation_key(operation_key)
    if not key:
        return None
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"spec-save:{plant_id}:{key}"})
    existing = (
        db.query(SpecSaveOperation)
        .filter(SpecSaveOperation.plant_id == plant_id, SpecSaveOperation.operation_key == key)
        .first()
    )
    if not existing:
        return None
    if existing.payload_fingerprint != fingerprint:
        current = db.query(SpecificationSheet).filter(SpecificationSheet.id == existing.spec_id).first()
        raise HTTPException(
            status_code=409,
            detail={
                "code": "SAVE_KEY_CONFLICT",
                "message": "This save key already completed with a different payload. No duplicate spec was created.",
                "current_revision": int(current.write_revision or 1) if current else None,
                "spec_id": str(existing.spec_id),
            },
        )
    spec = db.query(SpecificationSheet).filter(SpecificationSheet.id == existing.spec_id).first()
    if not spec:
        raise HTTPException(status_code=409, detail="Save key is bound to a missing specification")
    return spec


def remember_save_operation(
    *,
    db: Session,
    plant_id: str,
    operation_key: Optional[str],
    fingerprint: str,
    spec_id: UUID,
) -> None:
    key = clean_operation_key(operation_key)
    if not key:
        return
    db.add(
        SpecSaveOperation(
            plant_id=plant_id,
            operation_key=key,
            payload_fingerprint=fingerprint,
            spec_id=spec_id,
        )
    )
