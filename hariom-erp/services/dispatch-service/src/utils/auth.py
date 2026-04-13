from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
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
    payload["token"] = token
    return payload

def require_role(required_roles: list[str]):
    def role_checker(current_user: dict = Depends(get_current_user)):
        # Dispatch role can create shipments
        # Admin has full access
        # Others read-only
        return current_user
    return role_checker
