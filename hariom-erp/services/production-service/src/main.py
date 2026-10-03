from fastapi import FastAPI
from sqlalchemy import text
from .database import Base, engine
from . import entry_models
from .routers import dispatch, dispatch_surplus, jobs, lifecycle, operations, planning, quality, reconciliation, reel_issue, reports, entries

Base.metadata.create_all(bind=engine)


def _ensure_schema_compatibility():
    # Backward-compatible patch for persistent local docker volumes.
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE continuous_completion_outbox ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMP NOT NULL DEFAULT now()"))
        connection.execute(text("ALTER TABLE continuous_stage_entries ADD COLUMN IF NOT EXISTS carry_in_pcs INTEGER NOT NULL DEFAULT 0"))
        connection.execute(text("ALTER TABLE continuous_stage_entries ADD COLUMN IF NOT EXISTS carry_out_pcs INTEGER NOT NULL DEFAULT 0"))
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
        connection.execute(text("ALTER TABLE job_cards DROP CONSTRAINT IF EXISTS ck_job_cards_current_stage"))
        connection.execute(
            text(
                "ALTER TABLE job_cards ADD CONSTRAINT ck_job_cards_current_stage "
                "CHECK (current_stage IN ('SLITTING','WINDER','OVEN','PROCESS','PACKING','QC','DISPATCH','DONE'))"
            )
        )
        connection.execute(text("ALTER TABLE job_card_stages DROP CONSTRAINT IF EXISTS ck_job_card_stages_type"))
        connection.execute(
            text(
                "ALTER TABLE job_card_stages ADD CONSTRAINT ck_job_card_stages_type "
                "CHECK (stage_type IN ('SLITTING','WINDER','OVEN','PROCESS','PACKING','QC','DISPATCH'))"
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
        "ALTER TABLE quality_inspections ADD COLUMN IF NOT EXISTS reasons JSONB DEFAULT '{}'::jsonb",
        "ALTER TABLE quality_inspections ADD COLUMN IF NOT EXISTS evaluation JSONB DEFAULT '{}'::jsonb",
        "ALTER TABLE quality_inspections ADD COLUMN IF NOT EXISTS sample_id VARCHAR(80)",
        "ALTER TABLE quality_inspections ADD COLUMN IF NOT EXISTS parent_inspection_id UUID",
        "ALTER TABLE quality_inspections ADD COLUMN IF NOT EXISTS observation_fingerprint VARCHAR(64)",
        "ALTER TABLE quality_inspections ADD COLUMN IF NOT EXISTS entry_mode VARCHAR(40)",
        "CREATE INDEX IF NOT EXISTS ix_quality_inspections_observation_fingerprint ON quality_inspections (observation_fingerprint)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_quality_inspections_observation_fingerprint "
        "ON quality_inspections (observation_fingerprint) WHERE observation_fingerprint IS NOT NULL",
        # Scale indexes: job-card list ordering, the late-entry/time
        # reconciliation report, and the per-shift capacity check that runs on
        # every stage completion.
        "CREATE INDEX IF NOT EXISTS ix_job_cards_plant_created ON job_cards (plant_id, created_at DESC)",
        # Job card lifecycle: human number, color, split lineage, emergency, force-close.
        "ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS job_card_no VARCHAR(24)",
        "ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS parent_job_card_id UUID",
        "ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS split_kind VARCHAR(20)",
        "ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS parchment_color VARCHAR(100)",
        "ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS is_emergency BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS close_mode VARCHAR(20)",
        "ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS close_reason TEXT",
        "ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS returned_qty DOUBLE PRECISION NOT NULL DEFAULT 0",
        "ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP",
        "ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS closed_by VARCHAR(200)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_job_cards_job_card_no ON job_cards (job_card_no) WHERE job_card_no IS NOT NULL",
        "ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS missed_slot_count INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS missed_slot_open BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS last_missed_slot JSONB",
        "CREATE INDEX IF NOT EXISTS ix_segments_missed_slot_scan ON job_card_stage_segments (status, plan_date) WHERE status = 'ASSIGNED'",
        "CREATE INDEX IF NOT EXISTS ix_job_cards_parent ON job_cards (parent_job_card_id)",
        # Carry-forward cards were minted with a deterministic uuid5; link them to their source.
        "UPDATE job_cards c SET split_kind = 'CARRY_FORWARD', parent_job_card_id = s.job_card_id "
        "FROM job_card_short_close s WHERE s.carry_forward_job_card_id = c.id AND c.parent_job_card_id IS NULL",
        # Color from the frozen snapshot for cards released before colors lived on the card.
        "UPDATE job_cards SET parchment_color = NULLIF(COALESCE(spec_snapshot->>'sales_order_line_parchment_color', spec_snapshot->>'parchment_color'), '') "
        "WHERE parchment_color IS NULL AND COALESCE(spec_snapshot->>'sales_order_line_parchment_color', '') NOT IN ('', 'Multiple colors')",
        # Number existing root cards YY/MM/NN in creation order (series per month), then children ROOT-A, -B …
        "WITH ranked AS (SELECT id, to_char(created_at, 'YY/MM/') AS prefix, "
        "row_number() OVER (PARTITION BY to_char(created_at, 'YYMM') ORDER BY created_at, id) + "
        "COALESCE((SELECT MAX(substring(x.job_card_no from '^[0-9][0-9]/[0-9][0-9]/([0-9]+)$')::int) FROM job_cards x "
        "WHERE x.job_card_no LIKE to_char(j.created_at, 'YY/MM/') || '%'), 0) AS rn "
        "FROM job_cards j WHERE job_card_no IS NULL AND parent_job_card_id IS NULL) "
        "UPDATE job_cards j SET job_card_no = ranked.prefix || lpad(ranked.rn::text, GREATEST(2, length(ranked.rn::text)), '0') FROM ranked WHERE j.id = ranked.id",
        # Counters never behind a number already issued (new cards continue after the backfill).
        "INSERT INTO job_card_number_counters (month_key, last_seq) "
        "SELECT substring(job_card_no from 1 for 2) || substring(job_card_no from 4 for 2), "
        "MAX(substring(job_card_no from '^[0-9][0-9]/[0-9][0-9]/([0-9]+)$')::int) FROM job_cards "
        "WHERE job_card_no ~ '^[0-9][0-9]/[0-9][0-9]/[0-9]+$' GROUP BY 1 "
        "ON CONFLICT (month_key) DO UPDATE SET last_seq = GREATEST(job_card_number_counters.last_seq, EXCLUDED.last_seq)",
        "WITH kids AS (SELECT c.id, p.job_card_no AS root, row_number() OVER (PARTITION BY c.parent_job_card_id ORDER BY c.created_at, c.id) AS n "
        "FROM job_cards c JOIN job_cards p ON p.id = c.parent_job_card_id WHERE c.job_card_no IS NULL AND p.job_card_no IS NOT NULL) "
        "UPDATE job_cards j SET job_card_no = kids.root || '-' || chr(64 + LEAST(kids.n, 26)::int) FROM kids WHERE j.id = kids.id",
        "CREATE INDEX IF NOT EXISTS ix_job_cards_release_lot ON job_cards (release_lot_id)",
        "CREATE INDEX IF NOT EXISTS ix_job_cards_sales_order_line ON job_cards (sales_order_line_id)",
        "CREATE INDEX IF NOT EXISTS ix_job_card_stages_entered_at ON job_card_stages (entered_at)",
        "CREATE INDEX IF NOT EXISTS ix_segments_capacity_lookup "
        "ON job_card_stage_segments (stage_type, machine_id, shift_code, completed_at) "
        "WHERE status = 'COMPLETED'",
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

app.include_router(entries.router)
app.include_router(jobs.router)
app.include_router(lifecycle.router)
app.include_router(planning.router)
app.include_router(reel_issue.router)
app.include_router(reports.router)
app.include_router(reconciliation.router)
app.include_router(dispatch.router)
app.include_router(dispatch_surplus.router)
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
            "/quality/supervisor/inspections",
            "/quality/eod/inspections",
            "/quality/inspections/import",
            "/quality/legacy/inspections",
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


@app.on_event("startup")
def start_completion_postings():
    # Recover an authorization ACK if an earlier process stopped after the
    # durable card write. The receiver verifies its immutable bundle hash.
    with engine.begin() as connection:
        connection.execute(text("""INSERT INTO continuous_completion_outbox
            (id,job_card_id,effect_key,kind,payload,status,attempts,created_at,next_attempt_at)
            SELECT gen_random_uuid(),id,id::text||':release:acknowledge','release_ack',
                jsonb_build_object('stage','WINDER','authorization_id',spec_snapshot->>'release_authorization_id','bundle_hash',spec_snapshot->>'release_bundle_hash'),
                'PENDING',0,now(),now() FROM job_cards
            WHERE spec_snapshot->>'entry_model'='V2'
                AND parent_job_card_id IS NULL
                AND spec_snapshot->>'release_authorization_id' IS NOT NULL
                AND spec_snapshot->>'release_bundle_hash' IS NOT NULL
            ON CONFLICT (effect_key) DO NOTHING"""))
    from .completion_worker import start
    start()


@app.on_event("shutdown")
def stop_completion_postings():
    from .completion_worker import stop
    stop()
