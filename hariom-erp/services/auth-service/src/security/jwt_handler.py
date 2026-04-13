import os
from datetime import datetime, timedelta
from jose import jwt, JWTError
from typing import Optional
from .. import models

SECRET_KEY = os.getenv("JWT_SECRET", "hariom-secret-key-123")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRES_MINUTES", "1440"))

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
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


def build_user_claims(user: models.User) -> dict:
    """Build normalized claims for cross-service RBAC checks."""
    roles = sorted([role.name for role in user.roles])
    permissions = sorted({permission.name for role in user.roles for permission in role.permissions})
    return {
        "sub": user.email,
        "user_id": str(user.id),
        "role": roles[0] if roles else "",
        "roles": roles,
        "permissions": permissions,
        "plant_id": user.plant.code if getattr(user, "plant", None) else (str(user.plant_id) if user.plant_id else None),
    }
