"""Persist supplier date history and complete the section reel issue schema."""
from alembic import op
revision = "012_supplier_history"
down_revision = "011_canonical_supplier_schedule"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE purchase_line_schedules ADD COLUMN IF NOT EXISTS change_history JSONB NOT NULL DEFAULT '[]'::jsonb")
    op.execute("ALTER TABLE reel_issues ADD COLUMN IF NOT EXISTS issue_section VARCHAR(40) NOT NULL DEFAULT 'WINDER_SECTION'")
    op.execute("ALTER TABLE reel_issues ALTER COLUMN winder_machine_id DROP NOT NULL")


def downgrade():
    raise RuntimeError("Forward recovery required to preserve supplier revision history")
