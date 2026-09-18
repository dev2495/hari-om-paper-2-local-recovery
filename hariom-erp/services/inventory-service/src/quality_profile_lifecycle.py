"""Immutable item quality-profile revisions.

Ordinary Store/QC JSON writes cannot self-approve. An approved revision is
frozen; further edits open a new draft and keep the approved snapshot.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Iterable, Optional


class ProfileLifecycleError(ValueError):
    def __init__(self, message: str, *, code: str, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.message = message

    def as_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message}


WRITABLE_STATUSES = frozenset({"draft", "incomplete", "complete", "pending_review", "missing"})
APPROVER_ROLES = frozenset({"Admin", "Owner"})


def _roles(values: Iterable[str] | str | None) -> set[str]:
    if values is None:
        return set()
    if isinstance(values, str):
        return {values}
    return {str(item) for item in values if str(item).strip()}


def apply_profile_save(
    current: Optional[dict[str, Any]],
    incoming: dict[str, Any],
    *,
    requested_status: Optional[str] = None,
    actor_roles: Iterable[str] | str | None = None,
) -> dict[str, Any]:
    del actor_roles
    payload = dict(incoming or {})
    status = str(requested_status or payload.get("setup_status") or payload.get("status") or "draft").strip().lower()
    if status in {"approved", "exemption", "approved_exemption", "not_required"}:
        raise ProfileLifecycleError(
            "Approval and exemption require the dedicated approve command. JSON save cannot self-approve.",
            code="APPROVAL_REQUIRED",
            status_code=403,
        )
    if status not in WRITABLE_STATUSES:
        status = "draft"
    current = dict(current or {})
    current_status = str(current.get("status") or current.get("setup_status") or "").strip().lower()
    revision = int(current.get("revision") or 1)
    if current_status in {"approved", "approved_exemption", "exemption", "not_required"}:
        snapshot = current.get("approved_snapshot") or {
            key: value for key, value in current.items() if key != "approved_snapshot"
        }
        payload["approved_snapshot"] = snapshot
        payload["supersedes_revision"] = revision
        revision = revision + 1
    elif not current:
        revision = 1
    payload["status"] = status
    payload["setup_status"] = status
    payload["revision"] = revision
    payload.pop("approved_by", None)
    payload.pop("approved_at", None)
    return payload


def apply_profile_approve(
    current: Optional[dict[str, Any]],
    *,
    expected_revision: int,
    actor: str,
    actor_roles: Iterable[str] | str | None = None,
) -> dict[str, Any]:
    roles = _roles(actor_roles)
    if roles and not roles.intersection(APPROVER_ROLES):
        raise ProfileLifecycleError(
            "Only Owner/Admin can approve an incoming quality profile.",
            code="FORBIDDEN_APPROVAL",
            status_code=403,
        )
    payload = dict(current or {})
    if not payload:
        raise ProfileLifecycleError("There is no profile to approve.", code="MISSING_PROFILE")
    revision = int(payload.get("revision") or 1)
    if int(expected_revision) != revision:
        raise ProfileLifecycleError(
            "Profile revision changed since preview. Reload and review again.",
            code="STALE_REVISION",
            status_code=409,
        )
    payload["status"] = "approved"
    payload["setup_status"] = "approved"
    payload["inspection_required"] = True
    payload["approved_by"] = actor
    payload["approved_at"] = datetime.utcnow().isoformat()
    payload["approved_snapshot"] = dict(payload)
    return payload


def apply_profile_exemption(
    current: Optional[dict[str, Any]],
    *,
    expected_revision: int,
    actor: str,
    actor_roles: Iterable[str] | str | None = None,
    plant_id: Optional[str] = None,
    item_id: Optional[str] = None,
    effective_from: Optional[date] = None,
    effective_to: Optional[date] = None,
) -> dict[str, Any]:
    roles = _roles(actor_roles)
    if roles and not roles.intersection(APPROVER_ROLES):
        raise ProfileLifecycleError(
            "Only Owner/Admin can approve a no-inspection exemption.",
            code="FORBIDDEN_APPROVAL",
            status_code=403,
        )
    payload = dict(current or {})
    if not payload:
        raise ProfileLifecycleError("There is no profile to exempt.", code="MISSING_PROFILE")
    revision = int(payload.get("revision") or 1)
    if int(expected_revision) != revision:
        raise ProfileLifecycleError(
            "Profile revision changed since preview. Reload and review again.",
            code="STALE_REVISION",
            status_code=409,
        )
    payload["status"] = "approved_exemption"
    payload["setup_status"] = "approved_exemption"
    payload["inspection_required"] = False
    payload["exemption_scope"] = {
        "plant_id": str(plant_id).strip() if plant_id else None,
        "item_id": str(item_id).strip() if item_id else None,
        "effective_from": effective_from.isoformat() if isinstance(effective_from, date) else (str(effective_from) if effective_from else None),
        "effective_to": effective_to.isoformat() if isinstance(effective_to, date) else (str(effective_to) if effective_to else None),
    }
    payload["approved_by"] = actor
    payload["approved_at"] = datetime.utcnow().isoformat()
    payload["approved_snapshot"] = dict(payload)
    return payload
