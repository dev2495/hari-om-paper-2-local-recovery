"""Bulk Assign profile: per-spec impact, no auto-publication, no issued-job rewrite."""

from __future__ import annotations

import copy
from typing import Any, Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .models import SpecificationSheet
from .qc_profile import STAGE_PARAMETER_DEFS, normalize_qc_profile, profile_status
from .save_ops import bump_write_revision


NOTCH_CODES = {"notch_distance", "notch_depth"}


def _as_uuid(value: Any) -> UUID:
    return value if isinstance(value, UUID) else UUID(str(value))


def _profile_dict(raw: Any) -> dict[str, Any]:
    return raw if isinstance(raw, dict) else {}


def template_requires_notching(profile: dict[str, Any]) -> bool:
    if profile.get("notching_applicable") is True:
        return True
    stages = profile.get("stages") if isinstance(profile.get("stages"), dict) else profile
    process = stages.get("PROCESS") if isinstance(stages, dict) else {}
    parameters = process.get("parameters") if isinstance(process, dict) else []
    for row in parameters or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("code") or "") not in NOTCH_CODES:
            continue
        if row.get("applicable") is False:
            continue
        if row.get("min") is not None or row.get("max") is not None or row.get("required"):
            return True
    return False


def target_notching_state(spec: SpecificationSheet) -> Optional[bool]:
    profile = _profile_dict(spec.qc_profile)
    if "notching_applicable" in profile and profile.get("notching_applicable") is not None:
        return bool(profile.get("notching_applicable"))
    stages = profile.get("stages") if isinstance(profile.get("stages"), dict) else {}
    process = stages.get("PROCESS") if isinstance(stages, dict) else {}
    parameters = process.get("parameters") if isinstance(process, dict) else []
    saw_notch = False
    any_true = False
    any_unknown = False
    any_false = False
    for row in parameters or []:
        if not isinstance(row, dict) or str(row.get("code") or "") not in NOTCH_CODES:
            continue
        saw_notch = True
        if row.get("applicable") is False:
            any_false = True
        elif row.get("applicable") is True:
            any_true = True
        else:
            any_unknown = True
    if any_true:
        return True
    if saw_notch and any_false and not any_true and not any_unknown:
        return False
    return None


def unresolved_fields(profile: dict[str, Any]) -> list[str]:
    missing: list[str] = []
    stages = profile.get("stages") if isinstance(profile.get("stages"), dict) else {}
    for stage, defs in STAGE_PARAMETER_DEFS.items():
        block = stages.get(stage) if isinstance(stages.get(stage), dict) else {}
        parameters = block.get("parameters") if isinstance(block, dict) else []
        by_code = {
            str(row.get("code")): row
            for row in parameters
            if isinstance(row, dict) and row.get("code")
        }
        for item in defs:
            row = by_code.get(item["code"], {})
            if row.get("applicable") is False:
                continue
            if not row.get("required", True):
                continue
            if row.get("min") is None or row.get("max") is None:
                missing.append(item["code"])
    return missing


def draft_from_template(template_profile: dict[str, Any], *, previous: Any) -> dict[str, Any]:
    incoming = copy.deepcopy(template_profile)
    incoming["status"] = "draft"
    incoming.pop("approved_by", None)
    incoming.pop("approved_at", None)
    incoming.pop("approved_snapshot", None)
    return normalize_qc_profile(incoming, previous=_profile_dict(previous) or None, mutating=True)


def classify_target(
    *,
    template_id: UUID,
    template_profile: dict[str, Any],
    spec: Optional[SpecificationSheet],
) -> dict[str, Any]:
    base = {
        "applicable": False,
        "action": None,
        "current_qc_status": None,
        "unresolved_fields": [],
        "error": None,
        "published": False,
        "rewrites_issued_jobs": False,
    }
    if spec is None:
        return {
            **base,
            "spec_id": None,
            "customer_name": None,
            "error": {"code": "SPEC_NOT_FOUND", "message": "Specification was not found in this plant."},
        }
    row = {
        **base,
        "spec_id": str(spec.id),
        "customer_name": spec.customer_name,
        "current_qc_status": profile_status(spec.qc_profile if isinstance(spec.qc_profile, dict) else None),
    }
    if spec.id == template_id:
        row["error"] = {"code": "TEMPLATE_TARGET", "message": "The template cannot be assigned onto itself."}
        return row
    if not spec.active or str(spec.status or "").lower() == "obsolete":
        row["error"] = {
            "code": "SPEC_RETIRED",
            "message": "Retired or inactive specifications cannot receive a bulk profile assignment.",
        }
        return row
    if str(spec.status or "").lower() == "review":
        row["error"] = {
            "code": "SPEC_IN_REVIEW",
            "message": "Specifications under approval review are excluded from bulk assignment.",
        }
        return row
    if template_requires_notching(template_profile) and target_notching_state(spec) is False:
        row["error"] = {
            "code": "NOTCHING_MISMATCH",
            "message": "Template requires notching; this spec is marked notching not applicable.",
        }
        return row
    drafted = draft_from_template(template_profile, previous=spec.qc_profile)
    row["applicable"] = True
    row["action"] = "create_draft" if row["current_qc_status"] in {None, "missing"} else "supersede_as_draft"
    row["unresolved_fields"] = unresolved_fields(drafted)
    return row


def _load_spec(db: Session, plant_id: str, spec_id: UUID) -> Optional[SpecificationSheet]:
    return (
        db.query(SpecificationSheet)
        .filter(SpecificationSheet.id == spec_id, SpecificationSheet.plant_id == plant_id)
        .first()
    )


def preview_assign(
    *,
    db: Session,
    plant_id: str,
    template_spec_id: UUID,
    spec_ids: list[UUID],
) -> dict[str, Any]:
    if not spec_ids:
        raise HTTPException(
            status_code=400,
            detail={"code": "EMPTY_SELECTION", "message": "Select at least one specification."},
        )
    template = _load_spec(db, plant_id, _as_uuid(template_spec_id))
    if not template:
        raise HTTPException(
            status_code=404,
            detail={"code": "TEMPLATE_NOT_FOUND", "message": "Template specification was not found."},
        )
    template_profile = _profile_dict(template.qc_profile)
    if profile_status(template_profile) == "missing":
        raise HTTPException(
            status_code=400,
            detail={"code": "TEMPLATE_HAS_NO_PROFILE", "message": "Template has no quality profile to assign."},
        )
    results = []
    for spec_id in spec_ids:
        target = _load_spec(db, plant_id, _as_uuid(spec_id))
        results.append(
            classify_target(
                template_id=template.id,
                template_profile=template_profile,
                spec=target,
            )
        )
        if results[-1]["spec_id"] is None:
            results[-1]["spec_id"] = str(spec_id)
    return {
        "template_spec_id": str(template.id),
        "published": False,
        "rewrites_issued_jobs": False,
        "results": results,
    }


def apply_assign(
    *,
    db: Session,
    plant_id: str,
    template_spec_id: UUID,
    spec_ids: list[UUID],
    publish: bool = False,
) -> dict[str, Any]:
    if publish:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "AUTO_PUBLICATION_FORBIDDEN",
                "message": "Bulk assign cannot auto-publish. Apply creates draft QC only; each spec keeps its own approval.",
            },
        )
    preview = preview_assign(
        db=db,
        plant_id=plant_id,
        template_spec_id=template_spec_id,
        spec_ids=spec_ids,
    )
    template = _load_spec(db, plant_id, _as_uuid(template_spec_id))
    template_profile = _profile_dict(template.qc_profile if template else None)
    applied: list[str] = []
    refreshed: list[dict[str, Any]] = []
    for row in preview["results"]:
        if not row.get("applicable"):
            refreshed.append(row)
            continue
        spec = _load_spec(db, plant_id, _as_uuid(row["spec_id"]))
        if spec is None:
            refreshed.append(row)
            continue
        spec.qc_profile = draft_from_template(template_profile, previous=spec.qc_profile)
        bump_write_revision(spec)
        applied.append(str(spec.id))
        updated = classify_target(
            template_id=_as_uuid(template_spec_id),
            template_profile=template_profile,
            spec=spec,
        )
        updated["applied"] = True
        refreshed.append(updated)
    db.commit()
    return {
        "template_spec_id": str(template_spec_id),
        "published": False,
        "rewrites_issued_jobs": False,
        "applied_spec_ids": applied,
        "results": refreshed,
    }
