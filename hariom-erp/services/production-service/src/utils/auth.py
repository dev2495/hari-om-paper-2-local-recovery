import uuid
from fastapi import Depends, HTTPException, status, Header, Query
from fastapi.security import OAuth2PasswordBearer
from typing import Optional
from ..security import jwt_handler

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")
SUPER_ROLES = {"Owner", "Admin"}
PLANNER_SCOPE_ROLES = SUPER_ROLES | {"PlantManager", "Planner"}
PLANT_ALIASES = {
    "PLANT_A": "00000000-0000-0000-0000-0000000000a1",
    "PLANT-1": "00000000-0000-0000-0000-0000000000a1",
    "PLANT_1": "00000000-0000-0000-0000-0000000000a1",
    "PLANT1": "00000000-0000-0000-0000-0000000000a1",
    "PLANT_B": "00000000-0000-0000-0000-0000000000b2",
    "PLANT-2": "00000000-0000-0000-0000-0000000000b2",
    "PLANT_2": "00000000-0000-0000-0000-0000000000b2",
    "PLANT2": "00000000-0000-0000-0000-0000000000b2",
}


def _normalize_plant_scope(value: str | None) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        return normalized
    upper = normalized.upper()
    if upper == "ALL":
        return "ALL"
    normalized = PLANT_ALIASES.get(upper, normalized)
    try:
        return str(uuid.UUID(str(normalized)))
    except ValueError:
        return normalized


def get_current_user(token: str = Depends(oauth2_scheme)):
    payload = jwt_handler.decode_access_token(token)
    if not payload or payload.get("sub") is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"}
        )

    roles = payload.get("roles", [])
    if not isinstance(roles, list):
        roles = [roles] if roles else []
    if payload.get("role"):
        roles = sorted({*roles, str(payload.get("role"))})

    permissions = payload.get("permissions", [])
    if not isinstance(permissions, list):
        permissions = [permissions] if permissions else []

    payload["roles"] = roles
    payload["permissions"] = permissions
    allowed_plants = payload.get("allowed_plants") or payload.get("allowed_plant_ids") or []
    if not isinstance(allowed_plants, list):
        allowed_plants = [allowed_plants] if allowed_plants else []
    allowed_plants = [str(plant).strip() for plant in allowed_plants if str(plant).strip()]
    if not allowed_plants and payload.get("plant_id"):
        allowed_plants = [str(payload.get("plant_id"))]
    payload["allowed_plants"] = [_normalize_plant_scope(plant) or plant for plant in allowed_plants]
    if payload.get("plant_id"):
        payload["plant_id"] = _normalize_plant_scope(str(payload.get("plant_id"))) or payload.get("plant_id")
    payload["token"] = token
    return payload


def _plant_in_allowed(requested: str, allowed: list[str]) -> bool:
    requested_norm = _normalize_plant_scope(requested)
    for plant in allowed:
        if requested_norm and requested_norm == _normalize_plant_scope(plant):
            return True
    return False


def _resolve_scope(
    current_user: dict,
    requested_plant_id: Optional[str],
    allow_all: bool,
) -> dict:
    user_roles = set(current_user.get("roles", []))
    is_owner = bool(user_roles & SUPER_ROLES)
    token_plant_id = _normalize_plant_scope(str(current_user.get("plant_id") or "").strip())
    allowed_plants = [
        _normalize_plant_scope(str(plant).strip())
        for plant in (current_user.get("allowed_plants") or [])
        if str(plant or "").strip()
    ]
    allowed_plants = [plant for plant in allowed_plants if plant]
    if not allowed_plants and token_plant_id:
        allowed_plants = [token_plant_id]

    raw_requested = str(requested_plant_id or "").strip()
    if raw_requested.upper() == "ALL":
        if not allow_all:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Select one concrete plant for this write action",
            )
        if not allowed_plants:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="ALL-plants views require an explicit allowed plant set; unresolved plant is not defaulted to Plant A",
            )
        return {
            "selected_plant_id": None,
            "scope_all": True,
            "allowed_plants": allowed_plants,
            "is_owner": is_owner,
        }

    requested = _normalize_plant_scope(raw_requested) if raw_requested else ""
    if not requested:
        if is_owner and allow_all:
            if not allowed_plants:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="ALL-plants views require an explicit allowed plant set; unresolved plant is not defaulted to Plant A",
                )
            return {
                "selected_plant_id": None,
                "scope_all": True,
                "allowed_plants": allowed_plants,
                "is_owner": is_owner,
            }
        requested = token_plant_id or (allowed_plants[0] if allowed_plants else "")

    if not requested:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User has no assigned plant context",
        )

    if not _plant_in_allowed(requested, allowed_plants):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cross-plant access is not permitted",
        )

    return {
        "selected_plant_id": requested,
        "scope_all": False,
        "allowed_plants": allowed_plants,
        "is_owner": is_owner,
    }


def get_current_plant(
    current_user: dict = Depends(get_current_user),
    plant_id: Optional[str] = Query(None),
    x_plant_id: Optional[str] = Header(None, alias="X-Plant-ID")
) -> str:
    requested = plant_id or x_plant_id
    scope = _resolve_scope(current_user=current_user, requested_plant_id=requested, allow_all=False)
    return scope["selected_plant_id"]


def get_current_plant_scope(
    current_user: dict = Depends(get_current_user),
    x_plant_id: Optional[str] = Header(None, alias="X-Plant-ID"),
    plant_id: Optional[str] = Query(None),
) -> dict:
    requested = plant_id or x_plant_id
    return _resolve_scope(current_user=current_user, requested_plant_id=requested, allow_all=True)


def require_role(required_roles: list[str]):
    def role_checker(current_user: dict = Depends(get_current_user)):
        user_roles = set(current_user.get("roles", []))
        if user_roles & SUPER_ROLES:
            return current_user
        if not any(role in user_roles for role in required_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Operation not permitted for your role"
            )
        return current_user
    return role_checker


def require_permission(required_permissions: list[str]):
    def permission_checker(current_user: dict = Depends(get_current_user)):
        user_roles = set(current_user.get("roles", []))
        if user_roles & SUPER_ROLES:
            return current_user
        user_permissions = set(current_user.get("permissions", []))
        if not any(permission in user_permissions for permission in required_permissions):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Operation not permitted for your permissions"
            )
        return current_user
    return permission_checker
