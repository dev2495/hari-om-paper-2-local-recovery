from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.routers import dashboard, production, loss, inventory, dispatch, quality

app = FastAPI(title="Hari Om Paper ERP - Analytics Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dashboard.router)
app.include_router(production.router)
app.include_router(loss.router)
app.include_router(inventory.router)
app.include_router(dispatch.router)
app.include_router(quality.router)

@app.get("/")
def health_check():
    return {
        "status": "healthy",
        "service": "analytics-service",
        "version": "1.0.0",
        "endpoints": [
            "/dashboard/overview",
            "/production/trends",
            "/production/shrink",
            "/production/scrap",
            "/production/winder",
            "/production/oven",
            "/production/process",
            "/inventory/valuation",
            "/dispatch/sales-trends",
            "/loss/supplier-loss",
            "/loss/gsm-bf-loss",
            "/quality/compliance"
        ],
    }

@app.get("/health")
def detailed_health():
    return {"status": "healthy", "service": "analytics-service"}
