from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import httpx
import os
from typing import Any

from src.middleware.auth import extract_base_token, extract_token

router = APIRouter()
AUTH_SERVICE_URL = os.getenv("AUTH_SERVICE_URL", "http://127.0.0.1:18001")
http_client = httpx.AsyncClient(timeout=15.0)


class LoginPayload(BaseModel):
    email: str
    password: str


def _safe_json(response: httpx.Response, default_detail: str) -> Any:
    try:
        payload = response.json()
    except ValueError:
        text = (response.text or "").strip()
        payload = {"detail": text or default_detail}
    if payload is None:
        payload = {"detail": default_detail}
    return payload


@router.post("/register")
async def register(request: Request):
    body = await request.body()
    try:
        response = await http_client.post(
            f"{AUTH_SERVICE_URL}/auth/register",
            content=body,
            headers={"content-type": "application/json"},
        )
    except httpx.RequestError:
        return JSONResponse(status_code=503, content={"detail": "Auth service unavailable"})
    return JSONResponse(
        status_code=response.status_code,
        content=_safe_json(response, "Unable to process registration"),
    )


@router.post("/login")
async def login(payload: LoginPayload):
    form_data = {
        "username": payload.email,
        "password": payload.password,
    }
    try:
        response = await http_client.post(
            f"{AUTH_SERVICE_URL}/auth/login",
            data=form_data,
        )
    except httpx.RequestError:
        return JSONResponse(status_code=503, content={"detail": "Auth service unavailable"})

    if response.status_code != 200:
        return JSONResponse(
            status_code=response.status_code,
            content=_safe_json(response, "Invalid credentials"),
        )

    data = _safe_json(response, "Malformed auth response")
    token = data.get("access_token")
    if not token:
        return JSONResponse(status_code=502, content={"detail": "Auth service returned no access token"})

    resp = JSONResponse(content=data)
    resp.set_cookie(
        key="token",
        value=token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=86400,
    )
    resp.delete_cookie(key="acting_token")
    return resp


@router.post("/logout")
async def logout():
    resp = JSONResponse(content={"message": "Logged out"})
    resp.delete_cookie(key="token")
    resp.delete_cookie(key="acting_token")
    return resp


@router.post("/acting-role")
async def set_acting_role(request: Request):
    token = extract_base_token(request)
    if not token:
        return JSONResponse(content={"detail": "Not authenticated"}, status_code=401)
    body = await request.body()
    try:
        response = await http_client.post(
            f"{AUTH_SERVICE_URL}/auth/acting-role",
            content=body,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )
    except httpx.RequestError:
        return JSONResponse(status_code=503, content={"detail": "Auth service unavailable"})

    data = _safe_json(response, "Unable to create acting session")
    resp = JSONResponse(status_code=response.status_code, content=data)
    acting_token = data.get("access_token")
    if response.status_code == 200 and acting_token:
        resp.set_cookie(
            key="acting_token",
            value=acting_token,
            httponly=True,
            secure=False,
            samesite="lax",
            max_age=28800,
        )
    return resp


@router.delete("/acting-role")
async def clear_acting_role():
    resp = JSONResponse(content={"message": "Acting role cleared"})
    resp.delete_cookie(key="acting_token")
    return resp


@router.get("/me")
async def get_current_user(request: Request):
    token = extract_token(request)
    if not token:
        return JSONResponse(content={"detail": "Not authenticated"}, status_code=401)

    try:
        response = await http_client.get(
            f"{AUTH_SERVICE_URL}/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
    except httpx.RequestError:
        return JSONResponse(status_code=503, content={"detail": "Auth service unavailable"})
    return JSONResponse(
        status_code=response.status_code,
        content=_safe_json(response, "Unable to fetch current user"),
    )


@router.get("/users")
async def list_users(request: Request):
    token = extract_token(request)
    try:
        response = await http_client.get(
            f"{AUTH_SERVICE_URL}/users/",
            headers={"Authorization": f"Bearer {token}"},
        )
    except httpx.RequestError:
        return JSONResponse(status_code=503, content={"detail": "Auth service unavailable"})
    return JSONResponse(
        status_code=response.status_code,
        content=_safe_json(response, "Unable to list users"),
    )


@router.post("/users")
async def create_user(request: Request):
    token = extract_token(request)
    body = await request.body()
    try:
        response = await http_client.post(
            f"{AUTH_SERVICE_URL}/users/",
            content=body,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            },
        )
    except httpx.RequestError:
        return JSONResponse(status_code=503, content={"detail": "Auth service unavailable"})
    return JSONResponse(
        status_code=response.status_code,
        content=_safe_json(response, "Unable to create user"),
    )


@router.put("/users/{user_id}")
async def update_user(user_id: str, request: Request):
    token = extract_token(request)
    body = await request.body()
    try:
        response = await http_client.put(
            f"{AUTH_SERVICE_URL}/users/{user_id}",
            content=body,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            },
        )
    except httpx.RequestError:
        return JSONResponse(status_code=503, content={"detail": "Auth service unavailable"})
    return JSONResponse(
        status_code=response.status_code,
        content=_safe_json(response, "Unable to update user"),
    )


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, request: Request):
    token = extract_token(request)
    try:
        response = await http_client.delete(
            f"{AUTH_SERVICE_URL}/users/{user_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
    except httpx.RequestError:
        return JSONResponse(status_code=503, content={"detail": "Auth service unavailable"})
    return JSONResponse(
        status_code=response.status_code,
        content=_safe_json(response, "Unable to delete user"),
    )


@router.get("/roles")
async def list_roles(request: Request):
    token = extract_token(request)
    try:
        response = await http_client.get(
            f"{AUTH_SERVICE_URL}/roles",
            headers={"Authorization": f"Bearer {token}"},
        )
    except httpx.RequestError:
        return JSONResponse(status_code=503, content={"detail": "Auth service unavailable"})
    return JSONResponse(
        status_code=response.status_code,
        content=_safe_json(response, "Unable to list roles"),
    )


@router.get("/roles/matrix")
async def get_role_matrix(request: Request):
    token = extract_token(request)
    try:
        response = await http_client.get(
            f"{AUTH_SERVICE_URL}/roles/matrix",
            headers={"Authorization": f"Bearer {token}"},
        )
    except httpx.RequestError:
        return JSONResponse(status_code=503, content={"detail": "Auth service unavailable"})
    return JSONResponse(
        status_code=response.status_code,
        content=_safe_json(response, "Unable to fetch role matrix"),
    )


@router.put("/roles/matrix")
async def update_role_matrix(request: Request):
    token = extract_token(request)
    body = await request.body()
    try:
        response = await http_client.put(
            f"{AUTH_SERVICE_URL}/roles/matrix",
            content=body,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            },
        )
    except httpx.RequestError:
        return JSONResponse(status_code=503, content={"detail": "Auth service unavailable"})
    return JSONResponse(
        status_code=response.status_code,
        content=_safe_json(response, "Unable to update role matrix"),
    )


@router.get("/notifications")
async def get_notifications(request: Request):
    token = extract_token(request)
    try:
        response = await http_client.get(
            f"{AUTH_SERVICE_URL}/notifications",
            headers={"Authorization": f"Bearer {token}"},
            params=dict(request.query_params),
        )
    except httpx.RequestError:
        return JSONResponse(status_code=503, content={"detail": "Auth service unavailable"})
    return JSONResponse(status_code=response.status_code, content=_safe_json(response, "Unable to list notifications"))


@router.get("/notifications/unread-count")
async def get_notification_unread_count(request: Request):
    token = extract_token(request)
    try:
        response = await http_client.get(
            f"{AUTH_SERVICE_URL}/notifications/unread-count",
            headers={"Authorization": f"Bearer {token}"},
        )
    except httpx.RequestError:
        return JSONResponse(status_code=503, content={"detail": "Auth service unavailable"})
    return JSONResponse(status_code=response.status_code, content=_safe_json(response, "Unable to fetch unread count"))


@router.post("/notifications/mark-all-read")
async def mark_all_notifications_read(request: Request):
    token = extract_token(request)
    try:
        response = await http_client.post(
            f"{AUTH_SERVICE_URL}/notifications/mark-all-read",
            headers={"Authorization": f"Bearer {token}"},
        )
    except httpx.RequestError:
        return JSONResponse(status_code=503, content={"detail": "Auth service unavailable"})
    return JSONResponse(status_code=response.status_code, content=_safe_json(response, "Unable to mark notifications read"))


@router.post("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, request: Request):
    token = extract_token(request)
    try:
        response = await http_client.post(
            f"{AUTH_SERVICE_URL}/notifications/{notification_id}/read",
            headers={"Authorization": f"Bearer {token}"},
        )
    except httpx.RequestError:
        return JSONResponse(status_code=503, content={"detail": "Auth service unavailable"})
    return JSONResponse(status_code=response.status_code, content=_safe_json(response, "Unable to mark notification read"))


@router.get("/plants")
async def list_plants(request: Request):
    token = extract_token(request)
    if not token:
        return JSONResponse(content={"detail": "Not authenticated"}, status_code=401)
    try:
        response = await http_client.get(
            f"{AUTH_SERVICE_URL}/plants",
            headers={"Authorization": f"Bearer {token}"},
        )
    except httpx.RequestError:
        return JSONResponse(status_code=503, content={"detail": "Auth service unavailable"})
    return JSONResponse(status_code=response.status_code, content=_safe_json(response, "Unable to list plants"))
