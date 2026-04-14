from fastapi import Depends, HTTPException, status, Header, Query
from fastapi.security import OAuth2PasswordBearer
from typing import Optional
from ..security import jwt_handler

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")
SUPER_ROLES = {"Owner", "Admin"}
PLANT_ALIASES = {
    "PLANT_A": "00000000-0000-0000-0000-0000000000a1",
    "PLANT-1": "00000000-0000-0000-0000-0000000000a1",
    "PLANT1": "00000000-0000-0000-0000-0000000000a1",
    "PLANT_B": "00000000-0000-0000-0000-0000000000b2",
    "PLANT-2": "00000000-0000-0000-0000-0000000000b2",
    "PLANT2": "00000000-0000-0000-0000-0000000000b2",
}


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


def get_current_user(token: str = Depends(oauth2_scheme)):
    payload = jwt_handler.decode_access_token(token)
    if not payload or payload.get("sub") is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"}
        )

    roles = _to_list(payload.get("effective_roles") or payload.get("roles"))
    primary_role = payload.get("acting_role") or payload.get("role")
    if primary_role:
        roles.append(str(primary_role))

    permissions = _to_list(payload.get("permissions"))
    allowed_plants = _to_list(payload.get("allowed_plants") or payload.get("allowed_plant_ids"))

    payload["actual_sub"] = str(payload.get("actual_sub") or payload.get("sub") or "").strip()
    payload["actor_identity"] = str(payload.get("actor_identity") or payload["actual_sub"] or payload.get("sub") or "").strip()
    payload["actual_roles"] = _dedupe(_to_list(payload.get("actual_roles")) or roles.copy())
    payload["roles"] = _dedupe(roles)
    payload["effective_roles"] = payload["roles"]
    payload["permissions"] = _dedupe(permissions)
    payload["allowed_plants"] = _dedupe(allowed_plants)
    payload["role"] = str(primary_role) if primary_role else (payload["roles"][0] if payload["roles"] else None)
    payload["is_acting_session"] = bool(payload.get("is_acting_session"))
    payload["token"] = token
    return payload


def _resolve_scope(
    current_user: dict = Depends(get_current_user),
    requested_plant_id: Optional[str] = None,
    allow_all: bool = False,
) -> dict:
    user_roles = set(current_user.get("roles", []))
    is_owner = bool(user_roles & SUPER_ROLES)
    token_plant_id = _normalize_plant_id(current_user.get("plant_id"))
    allowed_plants = [_normalize_plant_id(plant) for plant in current_user.get("allowed_plants", [])]
    allowed_plants = [plant for plant in allowed_plants if plant]

    if not allowed_plants and token_plant_id:
        allowed_plants = [token_plant_id]

    raw_requested = str(requested_plant_id).strip() if requested_plant_id is not None else None
    if raw_requested and raw_requested.upper() == "ALL":
        if not is_owner:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="ALL scope is only allowed for owner/admin")
        if not allow_all:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ALL scope is read-only")
        return {
            "selected_plant_id": None,
            "scope_all": True,
            "allowed_plants": allowed_plants,
            "is_owner": is_owner,
        }

    requested = _normalize_plant_id(raw_requested)
    if not requested:
        if is_owner:
            if allow_all:
                return {
                    "selected_plant_id": None,
                    "scope_all": True,
                    "allowed_plants": allowed_plants,
                    "is_owner": is_owner,
                }
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Select one concrete plant for this write action",
            )
        if token_plant_id:
            requested = token_plant_id
        elif allowed_plants:
            requested = allowed_plants[0]

    if not requested:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User has no assigned plant context")

    if not is_owner and token_plant_id and requested != token_plant_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cross-plant access is not permitted")

    if is_owner and allowed_plants and requested not in allowed_plants:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Requested plant is outside allowed scope")

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
    plant_id: Optional[str] = Query(None),
    x_plant_id: Optional[str] = Header(None, alias="X-Plant-ID"),
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
