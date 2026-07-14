"""Hari Om Paper ERP BFF API."""

import asyncio
import os
import time

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src.middleware.auth import extract_token
from src.routes import analytics, auth, dispatch, inventory, master, production, purchase, sales, spec, workspace
from src.services.books_guard import books_guard_status
from src.services.plant_guard import assert_plant_allowed

app = FastAPI(
    title="Hari Om Paper - BFF API",
    description="Backend-for-Frontend API proxy layer",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://localhost:23000", "http://127.0.0.1:13000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# P1.5 — Plant-scope enforcement at the BFF. If the request includes an
# X-Plant-ID header, the user must be allowed on that plant (or be an Owner /
# Admin / is_owner_all_plants user). Unauthenticated routes (login, health,
# docs) bypass the guard.
_PLANT_GUARD_BYPASS_PREFIXES = (
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/me",
    "/api/auth/refresh",
    "/health",
    "/docs",
    "/openapi.json",
    "/redoc",
)


# P1.4 — Books-guard error codes whose detail dicts must be surfaced raw to the
# UI (not wrapped as {"detail": {...}}) so the frontend can read .code/.message
# instead of rendering `[object Object]`.
_BOOKS_GUARD_DETAIL_CODES = frozenset(
    {
        "BOOKS_LOCKED",
        "BOOKS_STATE_UNAVAILABLE",
        "BOOKS_GUARD_SHARED_CACHE_REQUIRED",
        "PLANT_REQUIRED_FOR_DATED_WRITE",
        "FUTURE_DATE_NOT_ALLOWED",
    }
)


@app.middleware("http")
async def plant_scope_guard(request: Request, call_next):
    path = request.url.path or ""
    plant_id = request.headers.get("X-Plant-ID")
    if plant_id and path != "/" and not any(path == p or path.startswith(p) for p in _PLANT_GUARD_BYPASS_PREFIXES):
        token = extract_token(request)
        if token:
            try:
                assert_plant_allowed(token, plant_id)
            except HTTPException as exc:
                detail = exc.detail
                if isinstance(detail, dict):
                    body = detail
                else:
                    body = {"detail": detail}
                return JSONResponse(status_code=exc.status_code, content=body)
    return await call_next(request)


@app.exception_handler(HTTPException)
async def _unwrap_structured_guard_errors(request: Request, exc: HTTPException):
    """P1.4 — Surface books-guard (and other structured guard) errors as the raw
    detail dict instead of FastAPI's default {"detail": {...}} envelope.

    The UI reads ``data.detail.code`` / ``data.detail.message`` directly; wrapping
    the dict caused ``[object Object]`` to render in error banners.
    """
    detail = exc.detail
    if isinstance(detail, dict):
        code = detail.get("code")
        if isinstance(code, str) and code in _BOOKS_GUARD_DETAIL_CODES:
            return JSONResponse(status_code=exc.status_code, content=detail)
    if isinstance(detail, dict):
        body = detail
    else:
        body = {"detail": detail}
    return JSONResponse(status_code=exc.status_code, content=body)

app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(master.router, prefix="/api/master", tags=["Master Data"])
app.include_router(spec.router, prefix="/api/spec", tags=["Specifications"])
app.include_router(sales.router, prefix="/api/sales", tags=["Sales"])
app.include_router(production.router, prefix="/api/production", tags=["Production"])
app.include_router(inventory.router, prefix="/api/inventory", tags=["Inventory"])
app.include_router(purchase.router, prefix="/api/purchase", tags=["Purchase"])
app.include_router(dispatch.router, prefix="/api/dispatch", tags=["Dispatch"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["Analytics"])
app.include_router(workspace.router, prefix="/api/workspace", tags=["Workspace"])


@app.get("/")
async def root():
    host = os.getenv("ERP_HOST", "127.0.0.1")
    web_ui_port = os.getenv("WEB_UI_PORT", "13000")
    return {
        "service": "bff-api",
        "message": "API gateway is running. Open the Web UI login page to use the ERP.",
        "web_ui": f"http://{host}:{web_ui_port}/login",
        "health": "/health",
        "docs": "/docs",
    }


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "bff-api", "books_guard": books_guard_status()}


@app.get("/health/ready")
async def readiness_check():
    """Dependency-aware readiness used by the container and public monitor."""
    services = {
        "auth": os.getenv("AUTH_SERVICE_URL", "http://127.0.0.1:18001"),
        "masterdata": os.getenv("MASTER_SERVICE_URL", "http://127.0.0.1:18002"),
        "spec": os.getenv("SPEC_SERVICE_URL", "http://127.0.0.1:18003"),
        "production": os.getenv("PRODUCTION_SERVICE_URL", "http://127.0.0.1:18004"),
        "inventory": os.getenv("INVENTORY_SERVICE_URL", "http://127.0.0.1:18005"),
        "analytics": os.getenv("ANALYTICS_SERVICE_URL", "http://127.0.0.1:18007"),
        "sales": os.getenv("SALES_SERVICE_URL", "http://127.0.0.1:18008"),
    }

    async def probe(name: str, base_url: str) -> tuple[str, dict]:
        started = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                response = await client.get(f"{base_url}/health")
            return name, {
                "status": "UP" if response.status_code == 200 else "DOWN",
                "http_status": response.status_code,
                "latency_ms": round((time.perf_counter() - started) * 1000.0, 1),
            }
        except httpx.RequestError as exc:
            return name, {
                "status": "DOWN",
                "http_status": None,
                "latency_ms": round((time.perf_counter() - started) * 1000.0, 1),
                "detail": str(exc)[:200],
            }

    results = dict(await asyncio.gather(*(probe(name, url) for name, url in services.items())))
    ready = all(result["status"] == "UP" for result in results.values())
    payload = {"status": "ready" if ready else "not_ready", "service": "bff-api", "dependencies": results}
    if not ready:
        return JSONResponse(status_code=503, content=payload)
    return payload
