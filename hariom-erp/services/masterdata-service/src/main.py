from fastapi import FastAPI
from .database import engine
from . import models
from .routers import adhesive, customer, machine, mandrel, paper, parchment, tube_size

app = FastAPI(
    title="Hari Om Paper ERP - Master Data Service",
    description="Manages all static reference data for the ERP system",
    version="1.0.0"
)

app.include_router(paper.router)
app.include_router(adhesive.router)
app.include_router(parchment.router)
app.include_router(tube_size.router)
app.include_router(mandrel.router)
app.include_router(customer.router)
app.include_router(machine.router)

# Create tables
models.Base.metadata.create_all(bind=engine)

@app.get("/")
def health_check():
    return {
        "status": "healthy",
        "service": "masterdata-service",
        "version": "1.0.0",
        "endpoints": [
            "/master/papers",
            "/master/adhesives",
            "/master/parchment/vendors",
            "/master/parchment/colors",
            "/master/tube-sizes",
            "/master/mandrels",
            "/master/customers",
            "/master/machines"
        ]
    }

@app.get("/health")
def detailed_health():
    return {
        "status": "healthy",
        "service": "masterdata-service",
        "database": "connected" if engine else "disconnected"
    }
