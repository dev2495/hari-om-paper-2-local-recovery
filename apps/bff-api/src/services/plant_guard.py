"""Plant-scope enforcement guard.

Validates that the X-Plant-ID on a request is in the JWT user's
allowed_plants (or that the user has is_owner_all_plants).

Decodes the JWT without verifying the signature — the BFF trusts upstream
auth-service to have already validated it; this guard only reads claims.
"""

from __future__ import annotations

from typing import Any, Optional

import jwt
from fastapi import HTTPException


def _decode_claims(token: str) -> dict[str, Any]:
    if not token:
        return {}
    try:
        return jwt.decode(token, options={"verify_signature": False, "verify_exp": False}, algorithms=["HS256"])
    except Exception:
        return {}


def assert_plant_allowed(token: str, plant_id: Optional[str]) -> None:
    """Raise HTTP 403 if X-Plant-ID is not in the user's allowed_plants.

    Rules:
      - Empty / missing plant_id → allowed (some endpoints don't need a plant).
      - plant_id == "ALL" → allowed only if user has is_owner_all_plants or Owner/Admin role.
      - else → must be in user's allowed_plants OR user has is_owner_all_plants.
    """
    if not plant_id:
        return

    claims = _decode_claims(token)
    roles = set(claims.get("roles") or [])
    is_owner = claims.get("is_owner_all_plants") is True or "Owner" in roles or "Admin" in roles

    plant_token = str(plant_id).strip()
    plant_upper = plant_token.upper()

    if plant_upper == "ALL":
        if is_owner:
            return
        raise HTTPException(
            status_code=403,
            detail={
                "code": "PLANT_SCOPE_DENIED",
                "message": "ALL-plant scope is restricted to Owner / Admin users.",
            },
        )

    if is_owner:
        return

    allowed_raw = claims.get("allowed_plants") or claims.get("allowed_plant_ids") or []
    # Sometimes claims encode it as comma-separated; normalize to a set.
    if isinstance(allowed_raw, str):
        allowed = {p.strip() for p in allowed_raw.split(",") if p.strip()}
    else:
        allowed = {str(p).strip() for p in allowed_raw if p}

    # Also honor user's primary plant_id from claims.
    primary = claims.get("plant_id")
    if primary:
        allowed.add(str(primary).strip())

    allowed_upper = {p.upper() for p in allowed}
    if plant_upper not in allowed_upper:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "PLANT_SCOPE_DENIED",
                "message": (
                    f"User is not allowed to operate on plant '{plant_token}'. "
                    "Contact admin to add this plant to your scope."
                ),
                "requested_plant": plant_token,
                "allowed_plants": sorted(allowed),
            },
        )
