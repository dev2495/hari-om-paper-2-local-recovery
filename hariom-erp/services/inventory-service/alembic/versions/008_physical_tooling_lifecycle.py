"""physical tooling lifecycle

Revision ID: 008_physical_tooling_lifecycle
Revises: 007_purchase_inward_metadata
Create Date: 2026-07-14
"""

from alembic import op


revision = "008_physical_tooling_lifecycle"
down_revision = "007_purchase_inward_metadata"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS tool_receipts (
            id UUID PRIMARY KEY, receipt_no VARCHAR(80) NOT NULL, receipt_date DATE NOT NULL,
            supplier_name VARCHAR(200), po_reference VARCHAR(120), invoice_reference VARCHAR(120),
            location_id UUID NOT NULL REFERENCES inventory_locations(id), notes TEXT,
            plant_id VARCHAR(50) NOT NULL DEFAULT 'PLANT_A', created_by VARCHAR(200),
            created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(),
            CONSTRAINT uq_tool_receipt_plant_no UNIQUE (plant_id, receipt_no)
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS tool_assets (
            id UUID PRIMARY KEY, asset_no VARCHAR(80) NOT NULL, qr_value VARCHAR(160) NOT NULL,
            tool_definition_id UUID NOT NULL, category VARCHAR(50) NOT NULL,
            definition_name VARCHAR(200) NOT NULL, attribute_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
            status VARCHAR(30) NOT NULL DEFAULT 'AVAILABLE',
            location_id UUID NOT NULL REFERENCES inventory_locations(id),
            receipt_id UUID REFERENCES tool_receipts(id), grind_version INTEGER NOT NULL DEFAULT 0,
            usage_count INTEGER NOT NULL DEFAULT 0, produced_qty DOUBLE PRECISION NOT NULL DEFAULT 0,
            scrap_qty DOUBLE PRECISION NOT NULL DEFAULT 0, current_job_card_id VARCHAR(80),
            plant_id VARCHAR(50) NOT NULL DEFAULT 'PLANT_A', received_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(),
            retired_at TIMESTAMP WITHOUT TIME ZONE, created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(),
            updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(),
            CONSTRAINT uq_tool_asset_plant_no UNIQUE (plant_id, asset_no),
            CONSTRAINT uq_tool_asset_plant_qr UNIQUE (plant_id, qr_value)
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS tool_asset_events (
            id UUID PRIMARY KEY, asset_id UUID NOT NULL REFERENCES tool_assets(id), event_type VARCHAR(40) NOT NULL,
            from_status VARCHAR(30), to_status VARCHAR(30), source_type VARCHAR(40) NOT NULL DEFAULT 'TOOLING',
            source_id VARCHAR(100), job_card_id VARCHAR(80), stage_type VARCHAR(40),
            good_qty DOUBLE PRECISION, scrap_qty DOUBLE PRECISION, grind_version INTEGER,
            metadata_json JSONB, actor VARCHAR(200), event_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS tool_asset_assignments (
            id UUID PRIMARY KEY, asset_id UUID NOT NULL REFERENCES tool_assets(id), job_card_id VARCHAR(80) NOT NULL,
            stage_type VARCHAR(40) NOT NULL, issued_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
            returned_at TIMESTAMP WITHOUT TIME ZONE, status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
            good_qty DOUBLE PRECISION NOT NULL DEFAULT 0, scrap_qty DOUBLE PRECISION NOT NULL DEFAULT 0,
            usage_key VARCHAR(160) UNIQUE, notes TEXT
        )
    """)
    for statement in (
        "CREATE INDEX IF NOT EXISTS ix_tool_assets_plant_id ON tool_assets (plant_id)",
        "CREATE INDEX IF NOT EXISTS ix_tool_assets_category ON tool_assets (category)",
        "CREATE INDEX IF NOT EXISTS ix_tool_assets_status ON tool_assets (status)",
        "CREATE INDEX IF NOT EXISTS ix_tool_assets_current_job_card_id ON tool_assets (current_job_card_id)",
        "CREATE INDEX IF NOT EXISTS ix_tool_asset_events_asset_id ON tool_asset_events (asset_id)",
        "CREATE INDEX IF NOT EXISTS ix_tool_asset_events_job_card_id ON tool_asset_events (job_card_id)",
        "CREATE INDEX IF NOT EXISTS ix_tool_asset_events_event_at ON tool_asset_events (event_at)",
        "CREATE INDEX IF NOT EXISTS ix_tool_asset_assignments_asset_id ON tool_asset_assignments (asset_id)",
        "CREATE INDEX IF NOT EXISTS ix_tool_asset_assignments_job_card_id ON tool_asset_assignments (job_card_id)",
    ):
        op.execute(statement)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS tool_asset_assignments")
    op.execute("DROP TABLE IF EXISTS tool_asset_events")
    op.execute("DROP TABLE IF EXISTS tool_assets")
    op.execute("DROP TABLE IF EXISTS tool_receipts")
