import os
from typing import Optional
from fastapi import Depends, Header, HTTPException, Query
import jwt
from jwt import InvalidTokenError as JWTError
from src.config import JWT_SECRET, JWT_ALGORITHM, PLANT_ALIASES, SUPER_ROLES


_INSECURE_DEFAULTS = {"hariom-secret-key-123", "change_me_in_production"}
_IS_PRODUCTION = os.getenv("APP_ENV", os.getenv("ENVIRONMENT", "development")).strip().lower() in {"prod", "production"}
if _IS_PRODUCTION and JWT_SECRET in _INSECURE_DEFAULTS:
    raise RuntimeError("JWT_SECRET must be set to a non-default value in production")
LEGACY_JWT_SECRETS = () if _IS_PRODUCTION else tuple(sorted(_INSECURE_DEFAULTS))


def _to_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if item]
    return [str(value)]


def _dedupe(values: list[str]) -> list[str]:
    seen = set()
    ordered: list[str] = []
    for value in values:
        normalized = str(value or "").strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(normalized)
    return ordered


def _normalize_plant_id(value: Optional[str]) -> Optional[str]:
    if not value:
        return value
    normalized = value.strip()
    return PLANT_ALIASES.get(normalized.upper(), normalized)

def get_token(authorization: Optional[str] = Header(None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization token missing")
    return authorization.split(" ", 1)[1]

def get_current_user_claims(token: str = Depends(get_token)) -> dict:
    candidate_secrets: list[str] = []
    for secret in (JWT_SECRET, *LEGACY_JWT_SECRETS):
        normalized = str(secret or "").strip()
        if normalized and normalized not in candidate_secrets:
            candidate_secrets.append(normalized)

    payload = None
    for secret in candidate_secrets:
        try:
            payload = jwt.decode(token, secret, algorithms=[JWT_ALGORITHM])
            break
        except JWTError:
            continue

    if payload is None:
        raise HTTPException(status_code=401, detail="Invalid authentication token")

    roles = _to_list(payload.get("effective_roles") or payload.get("roles"))
    primary_role = payload.get("acting_role") or payload.get("role")
    if primary_role:
        roles.append(str(primary_role))

    allowed_plants = _to_list(payload.get("allowed_plants") or payload.get("allowed_plant_ids"))

    token_plant_id = _normalize_plant_id(payload.get("plant_id"))
    if not allowed_plants and token_plant_id:
        allowed_plants = [str(token_plant_id)]

    payload["roles"] = _dedupe(roles)
    payload["effective_roles"] = payload["roles"]
    payload["plant_id"] = token_plant_id
    normalized_allowed = []
    for plant_value in allowed_plants:
        normalized = _normalize_plant_id(plant_value)
        if normalized:
            normalized_allowed.append(normalized)
    payload["allowed_plants"] = normalized_allowed
    payload["actual_sub"] = str(payload.get("actual_sub") or payload.get("sub") or "").strip()
    payload["actor_identity"] = str(payload.get("actor_identity") or payload["actual_sub"] or payload.get("sub") or "").strip()
    payload["actual_roles"] = _dedupe(_to_list(payload.get("actual_roles")) or payload["roles"].copy())
    payload["is_acting_session"] = bool(payload.get("is_acting_session"))
    payload["is_owner"] = bool(set(payload["roles"]) & SUPER_ROLES)
    return payload

def get_plant_scope(
    current_user: dict = Depends(get_current_user_claims),
    plant_id: Optional[str] = Query(None),
    plant: Optional[str] = Query(None),
    x_plant_id: Optional[str] = Header(None, alias="X-Plant-ID"),
) -> dict:
    requested = _normalize_plant_id(plant_id or plant or x_plant_id)
    is_owner = current_user.get("is_owner", False)
    token_plant_id = _normalize_plant_id(current_user.get("plant_id"))
    allowed_plants = [_normalize_plant_id(plant_value) for plant_value in current_user.get("allowed_plants", [])]
    allowed_plants = [value for value in allowed_plants if value]

    if requested and requested.upper() == "ALL":
        if not is_owner:
            raise HTTPException(status_code=403, detail="ALL scope is only allowed for owner/admin")
        if not allowed_plants:
            raise HTTPException(status_code=403, detail="No allowed plants in token scope")
        return {
            "scope_all": True,
            "selected_plant_id": None,
            "allowed_plants": allowed_plants,
        }

    if not requested:
        if is_owner:
            if not allowed_plants:
                raise HTTPException(status_code=403, detail="No allowed plants in token scope")
            return {
                "scope_all": True,
                "selected_plant_id": None,
                "allowed_plants": allowed_plants,
            }
        if token_plant_id:
            requested = str(token_plant_id)
        elif is_owner and allowed_plants:
            requested = allowed_plants[0]

    if not requested:
        raise HTTPException(status_code=403, detail="Missing plant context")

    if not is_owner and token_plant_id and str(requested) != str(token_plant_id):
        raise HTTPException(status_code=403, detail="Cross-plant access is not permitted")

    if is_owner and allowed_plants and requested not in allowed_plants:
        raise HTTPException(status_code=403, detail="Requested plant is outside allowed scope")

    return {
        "scope_all": False,
        "selected_plant_id": requested,
        "allowed_plants": allowed_plants,
    }
