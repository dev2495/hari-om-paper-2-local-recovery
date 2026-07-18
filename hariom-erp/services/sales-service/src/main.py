from fastapi import FastAPI
from sqlalchemy import text
from .database import engine, Base
from .routers import sales_orders

Base.metadata.create_all(bind=engine)


def _ensure_schema_compatibility():
    # Backward-compatible patch for long-lived local DB volumes.
    with engine.begin() as connection:
        connection.execute(
            text("ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS parchment_color VARCHAR(100)")
        )
        connection.execute(
            text("ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS line_no DOUBLE PRECISION DEFAULT 1")
        )
        connection.execute(
            text("ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS product_code VARCHAR(120)")
        )
        connection.execute(
            text("ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS rate_per_pc DOUBLE PRECISION")
        )
        connection.execute(
            text("ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS plant_id UUID")
        )
        connection.execute(
            text("ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS po_number VARCHAR(100)")
        )
        connection.execute(
            text("ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS po_date DATE")
        )


_ensure_schema_compatibility()

app = FastAPI(
    title="Hari Om Paper ERP - Sales Service",
    description="Sales order lifecycle and fulfillment tracking",
    version="1.0.0",
)

app.include_router(sales_orders.router)


@app.get("/")
def health_check():
    return {
        "status": "healthy",
        "service": "sales-service",
        "version": "1.0.0",
        "endpoints": [
            "/sales-orders",
            "/sales-orders/{id}",
            "/sales-orders/{id}/approve",
            "/sales-orders/{id}/release",
            "/sales-orders/lines/{line_id}/validate-dispatch",
            "/sales-orders/lines/{line_id}/record-dispatch",
        ],
    }


@app.get("/health")
def detailed_health():
    return {
        "status": "healthy",
        "service": "sales-service",
        "database": "connected",
    }
