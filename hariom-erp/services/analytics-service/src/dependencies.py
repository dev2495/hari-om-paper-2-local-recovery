from typing import Optional
from fastapi import Depends, Header, HTTPException, Query
from jose import JWTError, jwt
from src.config import JWT_SECRET, JWT_ALGORITHM, PLANT_ALIASES, SUPER_ROLES

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
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication token")

    roles = payload.get("roles", [])
    if not isinstance(roles, list):
        roles = [roles] if roles else []

    allowed_plants = payload.get("allowed_plants", [])
    if not isinstance(allowed_plants, list):
        allowed_plants = [allowed_plants] if allowed_plants else []
    allowed_plants = [str(value) for value in allowed_plants if value]

    token_plant_id = _normalize_plant_id(payload.get("plant_id"))
    if not allowed_plants and token_plant_id:
        allowed_plants = [str(token_plant_id)]

    payload["roles"] = roles
    payload["plant_id"] = token_plant_id
    normalized_allowed = []
    for plant_value in allowed_plants:
        normalized = _normalize_plant_id(plant_value)
        if normalized:
            normalized_allowed.append(normalized)
    payload["allowed_plants"] = normalized_allowed
    payload["is_owner"] = bool(set(roles) & SUPER_ROLES)
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
