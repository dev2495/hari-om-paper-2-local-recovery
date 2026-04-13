from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import httpx
import os

from src.middleware.auth import extract_token

router = APIRouter()
AUTH_SERVICE_URL = os.getenv("AUTH_SERVICE_URL", "http://localhost:28001")
http_client = httpx.AsyncClient(timeout=15.0)


class LoginPayload(BaseModel):
    email: str
    password: str


@router.post("/register")
async def register(request: Request):
    body = await request.body()
    response = await http_client.post(
        f"{AUTH_SERVICE_URL}/auth/register",
        content=body,
        headers={"content-type": "application/json"},
    )
    return JSONResponse(status_code=response.status_code, content=response.json())


@router.post("/login")
async def login(payload: LoginPayload):
    form_data = {
        "username": payload.email,
        "password": payload.password,
    }
    response = await http_client.post(
        f"{AUTH_SERVICE_URL}/auth/login",
        data=form_data,
    )

    if response.status_code != 200:
        return JSONResponse(status_code=response.status_code, content=response.json())

    data = response.json()
    token = data.get("access_token")

    resp = JSONResponse(content=data)
    resp.set_cookie(
        key="token",
        value=token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=86400,
    )
    return resp


@router.post("/logout")
async def logout():
    resp = JSONResponse(content={"message": "Logged out"})
    resp.delete_cookie(key="token")
    return resp


@router.get("/me")
async def get_current_user(request: Request):
    token = extract_token(request)
    if not token:
        return JSONResponse(content={"detail": "Not authenticated"}, status_code=401)

    response = await http_client.get(
        f"{AUTH_SERVICE_URL}/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    return JSONResponse(status_code=response.status_code, content=response.json())


@router.get("/users")
async def list_users(request: Request):
    token = extract_token(request)
    response = await http_client.get(
        f"{AUTH_SERVICE_URL}/users/",
        headers={"Authorization": f"Bearer {token}"},
    )
    return JSONResponse(status_code=response.status_code, content=response.json())


@router.post("/users")
async def create_user(request: Request):
    token = extract_token(request)
    body = await request.body()
    response = await http_client.post(
        f"{AUTH_SERVICE_URL}/users/",
        content=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        },
    )
    return JSONResponse(status_code=response.status_code, content=response.json())


@router.get("/roles")
async def list_roles(request: Request):
    token = extract_token(request)
    response = await http_client.get(
        f"{AUTH_SERVICE_URL}/roles",
        headers={"Authorization": f"Bearer {token}"},
    )
    return JSONResponse(status_code=response.status_code, content=response.json())


@router.get("/plants")
async def list_plants(request: Request):
    token = extract_token(request)
    if not token:
        return JSONResponse(content={"detail": "Not authenticated"}, status_code=401)
    response = await http_client.get(
        f"{AUTH_SERVICE_URL}/plants",
        headers={"Authorization": f"Bearer {token}"},
    )
    return JSONResponse(status_code=response.status_code, content=response.json())
