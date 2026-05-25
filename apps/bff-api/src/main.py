"""Hari Om Paper ERP BFF API."""

import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src.middleware.auth import extract_token
from src.routes import analytics, auth, dispatch, inventory, master, production, purchase, sales, spec, workspace
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
    return {"status": "healthy", "service": "bff-api"}
