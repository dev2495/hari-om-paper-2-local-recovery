from fastapi import Depends, HTTPException, status, Header
from fastapi.security import OAuth2PasswordBearer
from typing import Optional
from ..security import jwt_handler

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")


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

    permissions = payload.get("permissions", [])
    if not isinstance(permissions, list):
        permissions = [permissions] if permissions else []

    payload["roles"] = roles
    payload["permissions"] = permissions
    payload["token"] = token
    return payload


def get_current_plant(
    current_user: dict = Depends(get_current_user),
    x_plant_id: Optional[str] = Header(None, alias="X-Plant-ID")
) -> str:
    user_roles = set(current_user.get("roles", []))
    
    # Owner can override plant via header
    if "Owner" in user_roles and x_plant_id:
        return x_plant_id
        
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

    requested = (x_plant_id or default_plant).strip()
    elevated_roles = {"Owner", "Admin", "Planner"}

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

    selected = requested if user_roles.intersection(elevated_roles) else default_plant
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
