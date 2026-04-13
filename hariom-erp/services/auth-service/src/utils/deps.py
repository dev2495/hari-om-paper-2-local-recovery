import uuid
from typing import Callable, Iterable

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..security.jwt_handler import decode_access_token


def _extract_token(request: Request) -> str | None:
    token = request.cookies.get("token")
    if token:
        return token
    header = request.headers.get("Authorization")
    if header and header.startswith("Bearer "):
        return header.split(" ", 1)[1].strip() or None
    return None


def get_current_user(request: Request, db: Session = Depends(get_db)) -> models.User:
    token = _extract_token(request)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = None
    raw_user_id = payload.get("user_id")
    if raw_user_id:
        try:
            user = db.query(models.User).filter(models.User.id == uuid.UUID(str(raw_user_id))).first()
        except ValueError:
            user = None
    if user is None and payload.get("sub"):
        user = db.query(models.User).filter(models.User.email == payload["sub"]).first()

    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    setattr(user, "token", token)
    return user


def get_current_plant(request: Request, current_user: models.User = Depends(get_current_user)) -> str:
    requested_plant = request.headers.get("X-Plant-ID")
    if requested_plant:
        return requested_plant
    if getattr(current_user, "plant", None) and current_user.plant and current_user.plant.code:
        return current_user.plant.code
    return str(current_user.plant_id) if current_user.plant_id else "PLANT_A"


def require_role(allowed_roles: Iterable[str]) -> Callable[..., models.User]:
    allowed = set(allowed_roles)

    def dependency(current_user: models.User = Depends(get_current_user)) -> models.User:
        if not allowed:
            return current_user
        user_roles = {role.name for role in current_user.roles}
        if user_roles.intersection(allowed):
            return current_user
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")

    return dependency
