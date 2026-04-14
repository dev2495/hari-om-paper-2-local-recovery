import os
from datetime import datetime, timedelta
from jose import jwt, JWTError
from typing import Optional
from .. import models
from ..plant_service import resolve_allowed_plant_ids

SECRET_KEY = os.getenv("JWT_SECRET", "hariom-secret-key-123")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRES_MINUTES", "1440"))
LEGACY_SECRETS = ["hariom-secret-key-123", "change_me_in_production"]

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def decode_access_token(token: str):
    secrets = [SECRET_KEY, *[value for value in LEGACY_SECRETS if value != SECRET_KEY]]
    for secret in secrets:
        try:
            return jwt.decode(token, secret, algorithms=[ALGORITHM])
        except JWTError:
            continue
    return None


def build_user_claims(user: models.User) -> dict:
    """Build normalized claims for cross-service RBAC checks."""
    roles = sorted([role.name for role in user.roles])
    permissions = sorted({permission.name for role in user.roles for permission in role.permissions})
    allowed_plants = resolve_allowed_plant_ids(None, user)
    resolved_plant = str(user.plant_id) if user.plant_id else (allowed_plants[0] if allowed_plants else None)
    return {
        "sub": user.email,
        "user_id": str(user.id),
        "role": roles[0] if roles else "",
        "roles": roles,
        "permissions": permissions,
        "plant_id": resolved_plant,
        "allowed_plants": allowed_plants,
        "is_owner_all_plants": bool(getattr(user, "is_owner_all_plants", False)),
    }
