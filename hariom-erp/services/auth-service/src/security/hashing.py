from __future__ import annotations

import hashlib

try:
    from passlib.context import CryptContext
except Exception:  # pragma: no cover - fallback only
    CryptContext = None


pwd_context = CryptContext(schemes=["bcrypt", "pbkdf2_sha256"], deprecated="auto") if CryptContext else None


def _sha256_hash(password: str) -> str:
    return f"sha256${hashlib.sha256(password.encode('utf-8')).hexdigest()}"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not hashed_password:
        return False
    if pwd_context is not None:
        try:
            return pwd_context.verify(plain_password, hashed_password)
        except Exception:
            pass
    if hashed_password.startswith("sha256$"):
        return _sha256_hash(plain_password) == hashed_password
    return plain_password == hashed_password


def get_password_hash(password: str) -> str:
    if pwd_context is not None:
        try:
            return pwd_context.hash(password)
        except Exception:
            pass
    return _sha256_hash(password)
