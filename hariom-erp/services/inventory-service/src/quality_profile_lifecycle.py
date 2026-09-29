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


def _validate_waiver_policy(payload: dict[str, Any]) -> None:
    for row in payload.get("parameters") or []:
        if isinstance(row, dict) and not isinstance(row.get("non_waivable", False), bool):
            raise ProfileLifecycleError("non_waivable must be true or false.", code="INVALID_WAIVER_POLICY")


def apply_profile_save(
    current: Optional[dict[str, Any]],
    incoming: dict[str, Any],
    *,
    requested_status: Optional[str] = None,
    actor_roles: Iterable[str] | str | None = None,
) -> dict[str, Any]:
    del actor_roles
    payload = dict(incoming or {})
    _validate_waiver_policy(payload)
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
    if current and incoming.get("revision") is not None and int(incoming["revision"]) != int(current.get("revision") or 1):
        raise ProfileLifecycleError("The QC profile changed. Reload before saving.", code="STALE_REVISION", status_code=409)
    payload.pop("history", None)
    # Approval provenance belongs to the server. A draft cannot forge or erase
    # the approved revision used by receipts arriving while review is pending.
    payload.pop("approved_snapshot", None)
    if isinstance(current.get("approved_snapshot"), dict):
        payload["approved_snapshot"] = dict(current["approved_snapshot"])
    current_status = str(current.get("status") or current.get("setup_status") or "").strip().lower()
    revision = int(current.get("revision") or 1)
    if current_status in {"approved", "approved_exemption", "exemption", "not_required"}:
        snapshot = current.get("approved_snapshot") or {
            key: value for key, value in current.items() if key not in {"approved_snapshot", "history"}
        }
        payload["approved_snapshot"] = snapshot
        payload["supersedes_revision"] = revision
        revision = revision + 1
    elif not current:
        revision = 1
    else:
        revision += 1
    payload["status"] = status
    payload["setup_status"] = status
    payload["revision"] = revision
    payload.pop("approved_by", None)
    payload.pop("approved_at", None)
    return payload


_CATEGORICAL_TYPES = frozenset({"select", "categorical", "enum", "boolean"})


def _finite(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number and number not in (float("inf"), float("-inf")) else None


def profile_approval_blockers(payload: dict[str, Any]) -> list[str]:
    """Reasons an incoming profile cannot be approved: an approved profile that can never
    produce PASS would leave every receipt INCOMPLETE and blocked indefinitely."""
    rows = [row for row in (payload.get("parameters") or []) if isinstance(row, dict)]
    if not rows:
        return ["add at least one parameter"]
    blockers: list[str] = []
    seen: set[str] = set()
    for row in rows:
        code = str(row.get("code") or row.get("parameter_key") or "").strip()
        label = str(row.get("label") or code or "parameter").strip()
        if not code:
            blockers.append(f"{label}: missing parameter code")
            continue
        if code in seen:
            blockers.append(f"{label}: duplicate parameter code {code}")
        seen.add(code)
        if row.get("applicable") is False:
            continue
        input_type = str(row.get("input_type") or "number").strip().lower() or "number"
        if input_type == "text":
            continue  # recorded observation; never decides PASS/FAIL on its own
        if input_type in _CATEGORICAL_TYPES:
            options = [str(item).strip() for item in (row.get("options") or []) if str(item).strip()]
            if not options and row.get("required", True) is not False:
                blockers.append(f"{label}: list the accepted outcomes (e.g. OK / NOT OK)")
            continue
        lower = _finite(row.get("min") if "min" in row else row.get("lower"))
        upper = _finite(row.get("max") if "max" in row else row.get("upper"))
        if lower is None and upper is None:
            blockers.append(f"{label}: set a min and/or max")
        elif lower is not None and upper is not None and lower > upper:
            blockers.append(f"{label}: min {lower:g} is above max {upper:g}")
    return blockers


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
    _validate_waiver_policy(payload)
    blockers = profile_approval_blockers(payload)
    if blockers:
        raise ProfileLifecycleError(
            "Profile cannot be approved yet: " + "; ".join(blockers),
            code="PROFILE_INCOMPLETE",
        )
    payload["status"] = "approved"
    payload["setup_status"] = "approved"
    payload["inspection_required"] = True
    payload["approved_by"] = actor
    payload["approved_at"] = datetime.utcnow().isoformat()
    payload["approved_snapshot"] = {key: value for key, value in payload.items() if key not in {"approved_snapshot", "history"}}
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
    payload["approved_snapshot"] = {key: value for key, value in payload.items() if key not in {"approved_snapshot", "history"}}
    return payload
