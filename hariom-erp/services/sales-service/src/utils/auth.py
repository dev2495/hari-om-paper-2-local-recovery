import uuid
from typing import Optional

from fastapi import Depends, Header, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer

from ..security import jwt_handler

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")
SUPER_ROLES = {"Owner", "Admin"}

PLANT_ALIAS_GROUPS = (
    {
        "PLANT_A",
        "PLANT-1",
        "PLANT1",
        "00000000-0000-0000-0000-0000000000A1",
        "00000000-0000-0000-0000-0000000000a1",
    },
    {
        "PLANT_B",
        "PLANT-2",
        "PLANT2",
        "00000000-0000-0000-0000-0000000000B2",
        "00000000-0000-0000-0000-0000000000b2",
    },
)


def get_current_user(token: str = Depends(oauth2_scheme)):
    payload = jwt_handler.decode_access_token(token)
    if not payload or payload.get("sub") is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    roles = payload.get("roles", [])
    if not isinstance(roles, list):
        roles = [roles] if roles else []
    if payload.get("role"):
        roles = sorted({*roles, str(payload.get("role"))})

    permissions = payload.get("permissions", [])
    if not isinstance(permissions, list):
        permissions = [permissions] if permissions else []

    allowed_plants = payload.get("allowed_plants") or payload.get("allowed_plant_ids") or []
    if not isinstance(allowed_plants, list):
        allowed_plants = [allowed_plants] if allowed_plants else []

    payload["roles"] = roles
    payload["permissions"] = permissions
    payload["allowed_plants"] = [str(plant).strip() for plant in allowed_plants if str(plant).strip()]
    payload["token"] = token
    return payload


def get_plant_aliases(plant_id: str) -> list[str]:
    normalized = str(plant_id or "").strip()
    if not normalized:
        return []

    uppercase = normalized.upper()
    for group in PLANT_ALIAS_GROUPS:
        if uppercase in group:
            aliases = set(group)
            aliases.update({value.lower() for value in group})
            aliases.update({value.upper() for value in group})
            aliases.add(normalized)
            aliases.add(normalized.lower())
            aliases.add(normalized.upper())
            return sorted(aliases)
    return sorted({normalized, normalized.lower(), normalized.upper()})


def _looks_like_uuid(value: str) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except (TypeError, ValueError, AttributeError):
        return False


def _uuid_plant_aliases(value: str) -> list[str]:
    return sorted({alias for alias in get_plant_aliases(value) if _looks_like_uuid(alias)})


def canonical_persisted_plant_id(value: Optional[str]) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        return ""
    uuid_aliases = _uuid_plant_aliases(normalized)
    if uuid_aliases:
        return uuid_aliases[0]
    return normalized


def accepted_persisted_plant_ids(value: Optional[str]) -> list[str]:
    normalized = str(value or "").strip()
    if not normalized:
        return []
    if normalized.upper() == "ALL":
        aliases: set[str] = set()
        for group in PLANT_ALIAS_GROUPS:
            uuid_aliases = {item for item in group if _looks_like_uuid(item)}
            aliases.update(uuid_aliases)
            aliases.update({item.lower() for item in uuid_aliases})
            aliases.update({item.upper() for item in uuid_aliases})
        return sorted(aliases)
    uuid_aliases = _uuid_plant_aliases(normalized)
    if uuid_aliases:
        return uuid_aliases
    return get_plant_aliases(normalized)


def _is_plant_allowed(requested: str, allowed: list[str]) -> bool:
    requested_aliases = set(get_plant_aliases(requested))
    for plant in allowed:
        if requested_aliases.intersection(get_plant_aliases(plant)):
            return True
    return False


def _resolve_scope(current_user: dict, requested_plant_id: Optional[str], allow_all: bool) -> dict:
    roles = set(current_user.get("roles", []))
    is_owner = bool(roles.intersection(SUPER_ROLES))

    token_plant = str(current_user.get("plant_id") or "").strip()
    allowed_plants = [str(plant or "").strip() for plant in current_user.get("allowed_plants", []) if str(plant or "").strip()]
    if not allowed_plants and token_plant:
        allowed_plants = [token_plant]

    requested = str(requested_plant_id or "").strip()
    if requested.upper() == "ALL":
        if not is_owner:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="ALL scope is only allowed for owner/admin")
        if not allow_all:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Select one concrete plant for this write action")
        return {
            "selected_plant_id": None,
            "scope_all": True,
            "allowed_plants": allowed_plants,
            "is_owner": is_owner,
        }

    if not requested:
        if token_plant:
            requested = token_plant
        elif allowed_plants:
            requested = allowed_plants[0]
        elif is_owner and allow_all:
            return {
                "selected_plant_id": None,
                "scope_all": True,
                "allowed_plants": [],
                "is_owner": is_owner,
            }

    if not requested:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User has no assigned plant context")

    if not is_owner and token_plant:
        token_aliases = set(get_plant_aliases(token_plant))
        if requested not in token_aliases:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cross-plant access is not permitted")

    if is_owner and allowed_plants and not _is_plant_allowed(requested, allowed_plants):
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
    x_plant_id: Optional[str] = Header(None, alias="X-Plant-ID"),
) -> str:
    scope = _resolve_scope(current_user=current_user, requested_plant_id=(plant_id or x_plant_id), allow_all=False)
    return canonical_persisted_plant_id(scope.get("selected_plant_id"))


def get_current_plant_scope(
    current_user: dict = Depends(get_current_user),
    plant_id: Optional[str] = Query(None),
    x_plant_id: Optional[str] = Header(None, alias="X-Plant-ID"),
) -> dict:
    return _resolve_scope(current_user=current_user, requested_plant_id=(plant_id or x_plant_id), allow_all=True)


def apply_plant_scope(query, plant_column, plant_scope: dict):
    if not plant_scope:
        return query

    if plant_scope.get("scope_all"):
        allowed = [str(plant).strip() for plant in plant_scope.get("allowed_plants", []) if str(plant).strip()]
        if not allowed:
            return query
        allowed_aliases: set[str] = set()
        for plant in allowed:
            allowed_aliases.update(accepted_persisted_plant_ids(plant))
        return query.filter(plant_column.in_(sorted(allowed_aliases)))

    selected = str(plant_scope.get("selected_plant_id") or "").strip()
    if not selected:
        return query
    return query.filter(plant_column.in_(accepted_persisted_plant_ids(selected)))


def require_role(required_roles: list[str]):
    def role_checker(current_user: dict = Depends(get_current_user)):
        user_roles = set(current_user.get("roles", []))
        if user_roles & SUPER_ROLES:
            return current_user
        if not any(role in user_roles for role in required_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Operation not permitted for your role",
            )
        return current_user

    return role_checker
