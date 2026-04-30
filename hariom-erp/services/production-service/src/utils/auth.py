import uuid
from fastapi import Depends, HTTPException, status, Header, Query
from fastapi.security import OAuth2PasswordBearer
from typing import Optional
from ..security import jwt_handler

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")
PLANNER_SCOPE_ROLES = {"Owner", "Admin", "PlantManager", "Planner"}
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
    payload["token"] = token
    return payload


def get_current_plant(
    current_user: dict = Depends(get_current_user),
    plant_id: Optional[str] = Query(None),
    x_plant_id: Optional[str] = Header(None, alias="X-Plant-ID")
) -> str:
    user_roles = set(current_user.get("roles", []))

    requested = _normalize_plant_scope(str(plant_id or x_plant_id or "").strip())
    if requested:
        if requested.upper() == "ALL":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Select one concrete plant for planner write actions",
            )
        if user_roles.intersection(PLANNER_SCOPE_ROLES):
            return requested

    # Default to user's assigned plant
    plant_id = current_user.get("plant_id")
    if not plant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User has no assigned plant"
        )
    return plant_id


def get_current_plant_scope(
    current_user: dict = Depends(get_current_user),
    x_plant_id: Optional[str] = Header(None, alias="X-Plant-ID"),
) -> dict:
    user_roles = set(current_user.get("roles", []))
    default_plant = current_user.get("plant_id")
    if not default_plant:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User has no assigned plant"
        )

    requested = _normalize_plant_scope((x_plant_id or default_plant).strip())
    elevated_roles = PLANNER_SCOPE_ROLES

    if requested.upper() == "ALL":
        if user_roles.intersection(elevated_roles):
            return {
                "scope_all": True,
                "selected_plant_id": None,
                "allowed_plants": [],
            }
        return {
            "scope_all": False,
            "selected_plant_id": default_plant,
            "allowed_plants": [default_plant],
        }

    selected = requested if user_roles.intersection(elevated_roles) else _normalize_plant_scope(default_plant)
    return {
        "scope_all": False,
        "selected_plant_id": selected,
        "allowed_plants": [selected],
    }


def require_role(required_roles: list[str]):
    def role_checker(current_user: dict = Depends(get_current_user)):
        user_roles = set(current_user.get("roles", []))
        if "Admin" in user_roles:
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
        if "Admin" in user_roles:
            return current_user
        user_permissions = set(current_user.get("permissions", []))
        if not any(permission in user_permissions for permission in required_permissions):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Operation not permitted for your permissions"
            )
        return current_user
    return permission_checker
