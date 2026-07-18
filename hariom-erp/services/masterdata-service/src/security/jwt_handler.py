import os
import jwt
from jwt import InvalidTokenError as JWTError

_INSECURE_DEFAULTS = {"hariom-secret-key-123", "change_me_in_production"}
_IS_PRODUCTION = os.getenv("APP_ENV", os.getenv("ENVIRONMENT", "development")).strip().lower() in {"prod", "production"}
SECRET_KEY = os.getenv("JWT_SECRET", "hariom-secret-key-123")
if _IS_PRODUCTION and SECRET_KEY in _INSECURE_DEFAULTS:
    raise RuntimeError("JWT_SECRET must be set to a non-default value in production")
ALGORITHM = "HS256"
LEGACY_SECRETS = [] if _IS_PRODUCTION else sorted(_INSECURE_DEFAULTS)

def decode_access_token(token: str):
    secrets = [SECRET_KEY, *[value for value in LEGACY_SECRETS if value != SECRET_KEY]]
    for secret in secrets:
        try:
            return jwt.decode(token, secret, algorithms=[ALGORITHM])
        except JWTError:
            continue
    return None
