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
            text("ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS origin VARCHAR(20)")
        )
        connection.execute(
            text("ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS origin_review_required BOOLEAN DEFAULT FALSE")
        )
        connection.execute(
            text("ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS internal_order_date DATE")
        )
        connection.execute(
            text("ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS parchment_required BOOLEAN")
        )
        connection.execute(
            text("ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS parchment_color_id UUID")
        )
        connection.execute(
            text("ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS schedule_revision INTEGER DEFAULT 0")
        )
        # Historical origin: a blank PO number is not evidence the order was internal.
        connection.execute(
            text(
                """
                UPDATE sales_orders
                SET origin = 'CUSTOMER_PO', origin_review_required = FALSE
                WHERE origin IS NULL
                  AND po_number IS NOT NULL
                  AND btrim(po_number) <> ''
                """
            )
        )
        connection.execute(
            text(
                """
                UPDATE sales_orders
                SET origin = 'REVIEW', origin_review_required = TRUE
                WHERE origin IS NULL
                """
            )
        )
        connection.execute(
            text("ALTER TABLE sales_orders ALTER COLUMN origin SET DEFAULT 'CUSTOMER_PO'")
        )
        connection.execute(
            text(
                """
                UPDATE sales_order_lines
                SET parchment_required = TRUE
                WHERE parchment_required IS NULL
                  AND parchment_color IS NOT NULL
                  AND btrim(parchment_color) <> ''
                """
            )
        )
        connection.execute(
            text(
                """
                UPDATE sales_order_lines
                SET parchment_required = FALSE
                WHERE parchment_required IS NULL
                """
            )
        )
        connection.execute(
            text("ALTER TABLE sales_order_lines ALTER COLUMN parchment_required SET DEFAULT FALSE")
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


def backfill_order_number_counters() -> dict[str, int]:
    """Keep the atomic SO counter at or above existing ``order_no`` values.

    Pre-counter rows (and any inserts that raced a stale counter) can leave
    ``sales_order_number_counters.last_seq`` behind ``MAX(order_no)``. The next
    increment then 500s on ``sales_orders_order_no_key``. Idempotent: only
    raises last_seq, never rewrites order numbers.
    """
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS sales_order_number_counters (
                    date_key VARCHAR(8) PRIMARY KEY,
                    last_seq INTEGER NOT NULL DEFAULT 0
                )
                """
            )
        )
        result = connection.execute(
            text(
                """
                INSERT INTO sales_order_number_counters (date_key, last_seq)
                SELECT substring(order_no FROM 4 FOR 8) AS date_key,
                       MAX(CAST(substring(order_no FROM 13) AS INTEGER)) AS last_seq
                FROM sales_orders
                WHERE order_no ~ '^SO-[0-9]{8}-[0-9]{4}$'
                GROUP BY 1
                ON CONFLICT (date_key) DO UPDATE
                SET last_seq = GREATEST(
                    sales_order_number_counters.last_seq,
                    EXCLUDED.last_seq
                )
                """
            )
        )
        updated = int(result.rowcount or 0)
    print(f"[schema-compat] sales order number counter backfill rows={updated}")
    return {"counter_rows": updated}


_ensure_schema_compatibility()
backfill_order_number_counters()

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
