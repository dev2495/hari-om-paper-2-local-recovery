"""Hari Om Paper ERP BFF API."""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.routes import analytics, auth, dispatch, inventory, master, production, sales, spec, workspace

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

app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(master.router, prefix="/api/master", tags=["Master Data"])
app.include_router(spec.router, prefix="/api/spec", tags=["Specifications"])
app.include_router(sales.router, prefix="/api/sales", tags=["Sales"])
app.include_router(production.router, prefix="/api/production", tags=["Production"])
app.include_router(inventory.router, prefix="/api/inventory", tags=["Inventory"])
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
