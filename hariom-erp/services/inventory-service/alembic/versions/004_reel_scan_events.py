"""reel_scan_events

Revision ID: 004_reel_scan_events
Revises: 003_reel_master_issue_foundation
Create Date: 2026-02-27
"""

from alembic import op


revision = "004_reel_scan_events"
down_revision = "003_reel_master_issue_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            CREATE TYPE reelscaneventtype AS ENUM ('INWARD_SCAN', 'ISSUE_SCAN', 'CLOSE_SCAN');
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END$$;
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            CREATE TYPE reelscansource AS ENUM ('INVENTORY', 'PRODUCTION');
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END$$;
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS reel_scan_events (
            id UUID PRIMARY KEY,
            plant_id UUID NOT NULL,
            reel_id UUID NOT NULL REFERENCES paper_reels(id),
            event_type reelscaneventtype NOT NULL,
            source reelscansource NOT NULL,
            operator_id UUID NULL,
            timestamp TIMESTAMP NOT NULL DEFAULT now(),
            metadata JSONB NULL
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_reel_scan_events_plant_id ON reel_scan_events(plant_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_reel_scan_events_reel_id ON reel_scan_events(reel_id)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_reel_scan_events_plant_reel_ts "
        "ON reel_scan_events(plant_id, reel_id, timestamp DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_reel_scan_events_plant_event_ts "
        "ON reel_scan_events(plant_id, event_type, timestamp DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_reel_scan_events_plant_event_ts")
    op.execute("DROP INDEX IF EXISTS ix_reel_scan_events_plant_reel_ts")
    op.execute("DROP INDEX IF EXISTS ix_reel_scan_events_reel_id")
    op.execute("DROP INDEX IF EXISTS ix_reel_scan_events_plant_id")
    op.execute("DROP TABLE IF EXISTS reel_scan_events")
    op.execute("DROP TYPE IF EXISTS reelscansource")
    op.execute("DROP TYPE IF EXISTS reelscaneventtype")
