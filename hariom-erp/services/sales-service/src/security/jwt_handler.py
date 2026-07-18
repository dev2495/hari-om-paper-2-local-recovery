import os
from datetime import datetime, timedelta
from typing import Optional

import jwt
from jwt import InvalidTokenError as JWTError

_INSECURE_DEFAULTS = {"hariom-secret-key-123", "change_me_in_production"}
_IS_PRODUCTION = os.getenv("APP_ENV", os.getenv("ENVIRONMENT", "development")).strip().lower() in {"prod", "production"}
SECRET_KEY = os.getenv("JWT_SECRET", "hariom-secret-key-123")
if _IS_PRODUCTION and SECRET_KEY in _INSECURE_DEFAULTS:
  raise RuntimeError("JWT_SECRET must be set to a non-default value in production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRES_MINUTES", "1440"))


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
  to_encode = data.copy()
  expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
  to_encode.update({"exp": expire})
  return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str):
  try:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
  except JWTError:
    return None
