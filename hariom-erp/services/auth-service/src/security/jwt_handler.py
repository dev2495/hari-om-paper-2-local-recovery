import os
import hashlib
import hmac
import json
from datetime import datetime, timedelta
import jwt
from jwt import InvalidTokenError as JWTError
from typing import Optional
from .. import models
from ..plant_service import resolve_allowed_plant_ids

_INSECURE_DEFAULTS = {"hariom-secret-key-123", "change_me_in_production"}
_IS_PRODUCTION = os.getenv("APP_ENV", os.getenv("ENVIRONMENT", "development")).strip().lower() in {"prod", "production"}
SECRET_KEY = os.getenv("JWT_SECRET", "hariom-secret-key-123")
if _IS_PRODUCTION and SECRET_KEY in _INSECURE_DEFAULTS:
    raise RuntimeError("JWT_SECRET must be set to a non-default value in production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRES_MINUTES", "1440"))
LEGACY_SECRETS = [] if _IS_PRODUCTION else sorted(_INSECURE_DEFAULTS)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "iat": datetime.utcnow()})
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
    allowed_plants = sorted(resolve_allowed_plant_ids(None, user))
    resolved_plant = str(user.plant_id) if user.plant_id else (allowed_plants[0] if allowed_plants else None)
    claims = {
        "sub": user.email,
        "user_id": str(user.id),
        "role": roles[0] if roles else "",
        "roles": roles,
        "permissions": permissions,
        "plant_id": resolved_plant,
        "allowed_plants": allowed_plants,
        "is_owner_all_plants": bool(getattr(user, "is_owner_all_plants", False)),
    }

    # A keyed revision changes with access or password changes. No password hash
    # or secret is disclosed in the JWT. Existing sessions then fail immediately.
    revision = {**claims, "active": user.is_active, "credential": user.hashed_password}
    claims["authz_version"] = hmac.new(SECRET_KEY.encode(), json.dumps(revision, sort_keys=True).encode(), hashlib.sha256).hexdigest()
    return claims
