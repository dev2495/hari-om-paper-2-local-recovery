"""Pin incoming QC requirements onto the receipt identity.

Later master-profile edits must not silently change a historical lot's
acceptance contract. A missing approved profile is pinned as missing; it is
never invented as PASS.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional


def approved_profile_payload(profile: Any) -> Optional[dict[str, Any]]:
    if not isinstance(profile, dict) or not profile:
        return None
    status = str(profile.get("status") or profile.get("setup_status") or "").strip().lower()
    if status == "approved":
        return dict(profile)
    snapshot = profile.get("approved_snapshot")
    if isinstance(snapshot, dict):
        snap_status = str(snapshot.get("status") or snapshot.get("setup_status") or "").strip().lower()
        if snap_status == "approved":
            return dict(snapshot)
    return None


def pin_quality_profile_metadata(metadata: Optional[dict[str, Any]], profile: Any) -> dict[str, Any]:
    meta = dict(metadata or {})
    existing = meta.get("quality_profile")
    if isinstance(existing, dict) and existing:
        return meta
    approved = approved_profile_payload(profile)
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
