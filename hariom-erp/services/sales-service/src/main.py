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
        connection.execute(
            text("ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS schedule_revision INTEGER DEFAULT 0")
        )
        connection.execute(
            text(
                "CREATE TABLE IF NOT EXISTS sales_order_delivery_schedules ("
                "id UUID PRIMARY KEY, "
                "sales_order_id UUID NOT NULL REFERENCES sales_orders(id), "
                "sales_order_line_id UUID NOT NULL REFERENCES sales_order_lines(id), "
                "plant_id VARCHAR(50) NOT NULL, "
                "delivery_date DATE NOT NULL, "
                "quantity DOUBLE PRECISION NOT NULL, "
                "status VARCHAR(30) NOT NULL DEFAULT 'committed', "
                "revision INTEGER NOT NULL DEFAULT 1, "
                "created_by VARCHAR(200), "
                "created_at TIMESTAMP, "
                "updated_at TIMESTAMP"
                ")"
            )
        )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_delivery_schedules_line_date "
                "ON sales_order_delivery_schedules (sales_order_line_id, delivery_date)"
            )
        )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_delivery_schedules_plant_status "
                "ON sales_order_delivery_schedules (plant_id, status)"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE IF NOT EXISTS sales_order_schedule_allocations ("
                "id UUID PRIMARY KEY, "
                "delivery_schedule_id UUID NOT NULL REFERENCES sales_order_delivery_schedules(id), "
                "release_lot_id UUID NOT NULL REFERENCES sales_order_release_lots(id), "
                "quantity DOUBLE PRECISION NOT NULL, "
                "created_at TIMESTAMP, "
                "CONSTRAINT uq_schedule_release_alloc UNIQUE (delivery_schedule_id, release_lot_id)"
                ")"
            )
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
            "/sales-orders/pending",
            "/sales-orders/pending/export",
            "/sales-orders/{id}/delivery-schedules",
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
