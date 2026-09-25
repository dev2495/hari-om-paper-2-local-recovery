"""Pin incoming QC requirements onto the receipt identity.

Later master-profile edits must not silently change a historical lot's
acceptance contract. A missing approved profile is pinned as missing; it is
never invented as PASS.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional


PINNABLE_STATUSES = frozenset({"approved", "approved_exemption", "exemption", "not_required"})


def approved_profile_payload(profile: Any) -> Optional[dict[str, Any]]:
    if not isinstance(profile, dict) or not profile:
        return None
    status = str(profile.get("status") or profile.get("setup_status") or "").strip().lower()
    if status in PINNABLE_STATUSES:
        return dict(profile)
    snapshot = profile.get("approved_snapshot")
    if isinstance(snapshot, dict):
        snap_status = str(snapshot.get("status") or snapshot.get("setup_status") or "").strip().lower()
        if snap_status in PINNABLE_STATUSES:
            return dict(snapshot)
    return None


def _is_missing_placeholder(pinned: dict[str, Any]) -> bool:
    status = str(pinned.get("status") or pinned.get("setup_status") or "").strip().lower()
    return status == "missing" and not pinned.get("parameters")


def is_missing_profile_pin(pinned: Any) -> bool:
    return isinstance(pinned, dict) and _is_missing_placeholder(pinned)


def pin_quality_profile_metadata(metadata: Optional[dict[str, Any]], profile: Any) -> dict[str, Any]:
    meta = dict(metadata or {})
    existing = meta.get("quality_profile")
    approved = approved_profile_payload(profile)
    if isinstance(existing, dict) and existing:
        # An approved pin is frozen: later master edits are never retroactive.
        # A "missing" placeholder is not a profile, only the absence of one, so
        # lots received before approval attach the approved profile once
        # (audited) instead of being stuck on QC hold forever.
        if not (_is_missing_placeholder(existing) and approved is not None):
            return meta
        meta["quality_profile_attached_after_receipt"] = {
            "attached_at": datetime.utcnow().isoformat(),
            "revision": approved.get("revision"),
            "previous_status": existing.get("status") or existing.get("setup_status"),
        }
    payload = (
        approved
        if approved is not None
        else {
            "status": "missing",
            "setup_status": "missing",
            "inspection_required": True,
            "parameters": [],
        }
    )
    meta["quality_profile"] = payload
    meta["quality_profile_revision"] = payload.get("revision")
    meta["quality_profile_status"] = payload.get("status") or payload.get("setup_status")
    meta["quality_profile_pinned_at"] = datetime.utcnow().isoformat()
    return meta
