from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from .database import Base, engine
from .routers import dispatch, jobs, planning, quality, reconciliation, reel_issue, reports

Base.metadata.create_all(bind=engine)


def _ensure_schema_compatibility():
    # Backward-compatible patch for persistent local docker volumes.
    with engine.begin() as connection:
        connection.execute(
            text("ALTER TABLE production_job ADD COLUMN IF NOT EXISTS job_card_no VARCHAR(50)")
        )
        connection.execute(
            text("ALTER TABLE production_job ADD COLUMN IF NOT EXISTS sales_order_id UUID")
        )
        connection.execute(
            text("ALTER TABLE production_job ADD COLUMN IF NOT EXISTS sales_order_line_id UUID")
        )
        connection.execute(
            text("ALTER TABLE production_job ADD COLUMN IF NOT EXISTS planned_tubes_qty FLOAT DEFAULT 0")
        )
        connection.execute(
            text("ALTER TABLE production_job ADD COLUMN IF NOT EXISTS parchment_color VARCHAR(100)")
        )
        connection.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_production_job_job_card_no "
                "ON production_job(job_card_no) WHERE job_card_no IS NOT NULL"
            )
        )


_ensure_schema_compatibility()

app = FastAPI(
    title="Hari Om Paper ERP - Production Tracking Service",
    description="EOD job-card production with validation and FG posting",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(jobs.router)
app.include_router(planning.router)
app.include_router(reel_issue.router)
app.include_router(reports.router)
app.include_router(reconciliation.router)
app.include_router(dispatch.router)
app.include_router(quality.router)


@app.get("/")
def health_check():
    return {
        "status": "healthy",
        "service": "production-service",
        "version": "1.0.0",
        "endpoints": [
            "/jobs",
            "/jobs/{id}/print-card",
            "/jobs/{id}/validate",
            "/jobs/{id}/close",
            "/jobs/{id}/reels",
            "/jobs/{id}/loss",
            "/jobs/{id}/summary",
            "/sales-orders",
            "/job-cards",
            "/planning/queues",
            "/job-cards/{id}/assign-machine",
            "/job-cards/{id}/stage-output",
            "/reconciliation/winder-shift",
            "/reconciliation/{job_card_id}/loss-breakup",
            "/quality/inspections",
            "/quality/holds",
        ],
    }


@app.get("/health")
def detailed_health():
    return {
        "status": "healthy",
        "service": "production-service",
        "database": "connected",
    }
