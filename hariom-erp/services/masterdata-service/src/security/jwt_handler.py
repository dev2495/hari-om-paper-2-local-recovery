import os
from jose import jwt, JWTError

SECRET_KEY = os.getenv("JWT_SECRET", "hariom-secret-key-123")
ALGORITHM = "HS256"
LEGACY_SECRETS = ["hariom-secret-key-123", "change_me_in_production"]

def decode_access_token(token: str):
    secrets = [SECRET_KEY, *[value for value in LEGACY_SECRETS if value != SECRET_KEY]]
    for secret in secrets:
        try:
            return jwt.decode(token, secret, algorithms=[ALGORITHM])
        except JWTError:
            continue
    return None
