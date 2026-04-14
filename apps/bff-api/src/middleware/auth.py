"""Authentication helpers for cookie or bearer-token extraction."""

from typing import Optional

from fastapi import HTTPException, Request, status


def extract_base_token(request: Request) -> Optional[str]:
    """Extract the base (non-acting) token from cookie or Authorization header."""
    token = request.cookies.get("token")
    if token:
        return token

    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        bearer = auth_header.split(" ", 1)[1].strip()
        if bearer:
            return bearer

    return None


def extract_token(request: Request) -> Optional[str]:
    """Extract acting-token first, then fall back to base token."""
    acting_token = request.cookies.get("acting_token")
    if acting_token:
        return acting_token
    return extract_base_token(request)


async def get_token(request: Request) -> str:
    """FastAPI dependency wrapper that enforces authentication."""
    token = extract_token(request)
    if token:
        return token

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
    )
