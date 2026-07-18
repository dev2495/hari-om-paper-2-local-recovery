from fastapi import FastAPI
from sqlalchemy import text
from .database import Base, engine
from .routers import dispatch, jobs, operations, planning, quality, reconciliation, reel_issue, reports

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
        connection.execute(
            text("ALTER TABLE machine_stage_capacity_profile DROP CONSTRAINT IF EXISTS ck_machine_stage_capacity_unit")
        )
        connection.execute(
            text(
                "UPDATE machine_stage_capacity_profile "
                "SET capacity_value = capacity_value * 1.56, capacity_unit = 'METERS_PER_DAY' "
                "WHERE stage_type = 'WINDER' AND capacity_unit = 'BAMBOOS_PER_DAY'"
            )
        )
        connection.execute(
            text(
                "ALTER TABLE machine_stage_capacity_profile ADD CONSTRAINT ck_machine_stage_capacity_unit "
                "CHECK (capacity_unit IN ('BAMBOOS_PER_DAY','METERS_PER_DAY','BATCHES_PER_DAY','TUBES_PER_DAY'))"
            )
        )
        # Operations honesty pass — short-close + downtime tables are created
        # by metadata.create_all above; the indexes here keep the lookups fast
        # for the report-time joins.
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_job_card_short_close_job_card "
                "ON job_card_short_close (job_card_id)"
            )
        )
        # NOTE: the legacy single-column idempotency guard
        # (uq_short_close_job_card on job_card_id alone) is intentionally NOT
        # (re)created here. Short-close uniqueness is now per
        # (job_card_id, stage_type) so a PROCESS-level short-close can coexist
        # with the whole-card ("JOB_CARD") one. The swap to
        # uq_short_close_job_card_stage — including dropping the old index on
        # legacy volumes — happens in the guarded migration block below.
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_machine_downtime_machine_window "
                "ON machine_downtime (machine_id, started_at)"
            )
        )

    # Carry-forward / process-level short-close + HOLD follow-up + downtime
    # reschedule columns. Each statement runs in its own transaction and is
    # guarded so that a failure on one (e.g. a constraint that no longer
    # exists) does not abort the rest of the migration.
    _short_close_downtime_migrations = [
        "ALTER TABLE job_card_short_close ADD COLUMN IF NOT EXISTS stage_type VARCHAR(20) NOT NULL DEFAULT 'JOB_CARD'",
        "ALTER TABLE job_card_short_close ADD COLUMN IF NOT EXISTS hold_status VARCHAR(20)",
        "ALTER TABLE job_card_short_close ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP",
        "ALTER TABLE job_card_short_close ADD COLUMN IF NOT EXISTS resolved_by VARCHAR(200)",
        "ALTER TABLE job_card_short_close ADD COLUMN IF NOT EXISTS resolution_decision VARCHAR(20)",
        "ALTER TABLE job_card_short_close ADD COLUMN IF NOT EXISTS resolution_note TEXT",
        "ALTER TABLE machine_downtime ADD COLUMN IF NOT EXISTS reschedule_status VARCHAR(20)",
        # Swap the uniqueness so PROCESS-level short-close is allowed alongside
        # the whole-card ("JOB_CARD") one.
        "ALTER TABLE job_card_short_close DROP CONSTRAINT IF EXISTS uq_short_close_job_card",
        "DROP INDEX IF EXISTS uq_short_close_job_card",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_short_close_job_card_stage "
        "ON job_card_short_close (job_card_id, stage_type)",
    ]
    for _statement in _short_close_downtime_migrations:
        try:
            with engine.begin() as connection:
                connection.execute(text(_statement))
        except Exception as exc:  # pragma: no cover - defensive migration guard
            print(f"[schema-compat] skipped statement: {_statement!r} ({exc})")


_ensure_schema_compatibility()

app = FastAPI(
    title="Hari Om Paper ERP - Production Tracking Service",
    description="EOD job-card production with validation and FG posting",
    version="1.0.0",
)

app.include_router(jobs.router)
app.include_router(planning.router)
app.include_router(reel_issue.router)
app.include_router(reports.router)
app.include_router(reconciliation.router)
app.include_router(dispatch.router)
app.include_router(quality.router)
app.include_router(operations.router)


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
