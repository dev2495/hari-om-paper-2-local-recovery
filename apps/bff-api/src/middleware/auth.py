"""Authentication helpers for cookie or bearer-token extraction."""

from typing import Optional

from fastapi import HTTPException, Request, status


def extract_token(request: Request) -> Optional[str]:
    """Extract a JWT token from the auth cookie or Authorization header."""
    token = request.cookies.get("token")
    if token:
        return token

    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        bearer = auth_header.split(" ", 1)[1].strip()
        if bearer:
            return bearer

    return None


async def get_token(request: Request) -> str:
    """FastAPI dependency wrapper that enforces authentication."""
    token = extract_token(request)
    if token:
        return token

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
    )
