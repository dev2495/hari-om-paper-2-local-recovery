"""Inward QC by bill (6 Nov 2026): actual weight on reels and lots, the bill weight check, plant settings.

Stock stays on the bill weight (owner decision): ``actual_qty`` is a record for the weight check only. The
same statements run at service start (``src/main.py`` INCOMING_BILL_QC_SCHEMA_STATEMENTS, create_all) and the
data part (optional checks, retired weight checks, copied readings) in ``src/schema_incoming_bill.py``.
"""
from alembic import op

revision = "013_incoming_bill_qc"
down_revision = "012_supplier_history"
branch_labels = None
depends_on = None


def upgrade():
    for table in ("paper_reels", "stock_batch"):
        op.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS actual_qty NUMERIC(14,3)")
        op.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS weighed_at TIMESTAMP")
        op.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS weighed_by VARCHAR(200)")
        op.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS weigh_note TEXT")
    op.execute("ALTER TABLE stock_batch ADD COLUMN IF NOT EXISTS billed_qty NUMERIC(14,3)")
    op.execute("UPDATE stock_batch SET billed_qty = received_qty WHERE billed_qty IS NULL")
    op.execute("ALTER TABLE purchase_discrepancies ADD COLUMN IF NOT EXISTS case_source VARCHAR(20) NOT NULL DEFAULT 'GRN'")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_discrepancy_allocation_type_source "
               "ON purchase_discrepancies (allocation_id, discrepancy_type, case_source)")
    op.execute("ALTER TABLE purchase_discrepancies DROP CONSTRAINT IF EXISTS uq_purchase_discrepancy_allocation_type")
    from src.schema_incoming_bill import DROP_OLD_DISCREPANCY_KEY_SQL  # drops the old pair key whatever it is named
    op.execute(DROP_OLD_DISCREPANCY_KEY_SQL)
    op.execute("""CREATE TABLE IF NOT EXISTS plant_settings (
	plant_id VARCHAR(50) NOT NULL, 
	weight_short_notify_kg NUMERIC(14, 3) DEFAULT '20' NOT NULL, 
	weight_short_auto_kg NUMERIC(14, 3) DEFAULT '50' NOT NULL, 
	version INTEGER DEFAULT '1' NOT NULL, 
	updated_by VARCHAR(200), 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (plant_id), 
	CONSTRAINT ck_plant_settings_notify_nonnegative CHECK (weight_short_notify_kg >= 0), 
	CONSTRAINT ck_plant_settings_auto_gte_notify CHECK (weight_short_auto_kg >= weight_short_notify_kg)
)""")
    op.execute("""CREATE TABLE IF NOT EXISTS purchase_weight_variances (
	id UUID NOT NULL, 
	plant_id VARCHAR(50) NOT NULL, 
	bill_key VARCHAR(120) NOT NULL, 
	receipt_id UUID, 
	supplier_invoice_id UUID, 
	receipt_ids JSON NOT NULL, 
	supplier_id UUID, 
	supplier_name VARCHAR(200), 
	purchase_order_id UUID, 
	po_no VARCHAR(80), 
	po_raiser VARCHAR(200), 
	uom VARCHAR(12) NOT NULL, 
	bill_total NUMERIC(14, 3) NOT NULL, 
	actual_total NUMERIC(14, 3) NOT NULL, 
	lots_total INTEGER NOT NULL, 
	lots_weighed INTEGER NOT NULL, 
	lots_excluded INTEGER NOT NULL, 
	short_qty NUMERIC(14, 3) NOT NULL, 
	excess_qty NUMERIC(14, 3) NOT NULL, 
	rate_basis VARCHAR(20), 
	claim_amount NUMERIC(18, 2) NOT NULL, 
	band VARCHAR(20), 
	status VARCHAR(30) NOT NULL, 
	is_final BOOLEAN DEFAULT 'false' NOT NULL, 
	notify_kg NUMERIC(14, 3) NOT NULL, 
	auto_kg NUMERIC(14, 3) NOT NULL, 
	decision VARCHAR(20), 
	decided_by VARCHAR(200), 
	decided_at TIMESTAMP WITHOUT TIME ZONE, 
	reason_code VARCHAR(80), 
	reason_label VARCHAR(200), 
	note TEXT, 
	discrepancy_id UUID, 
	discrepancy_ids JSON NOT NULL, 
	debit_note_id UUID, 
	lines_json JSON NOT NULL, 
	lots_json JSON NOT NULL, 
	final_at TIMESTAMP WITHOUT TIME ZONE, 
	notified_status VARCHAR(30), 
	notified_at TIMESTAMP WITHOUT TIME ZONE, 
	reminder_sent_at TIMESTAMP WITHOUT TIME ZONE, 
	claim_cycle INTEGER NOT NULL, 
	last_error TEXT, 
	history JSON NOT NULL, 
	version INTEGER NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_purchase_weight_variance_bill UNIQUE (plant_id, bill_key), 
	CONSTRAINT ck_purchase_weight_variance_status CHECK (status IN ('PROVISIONAL','WITHIN','INFO_SENT','AWAITING_OWNER','SKIPPED','CLAIM_RAISED','WAITING_INVOICE','DN_DRAFTED','CLOSED')), 
	CONSTRAINT ck_purchase_weight_variance_band CHECK (band IS NULL OR band IN ('WITHIN','EXCESS','OWNER_DECIDES','AUTO_DEBIT','OWNER_INFO'))
)""")
    op.execute("""CREATE INDEX IF NOT EXISTS ix_purchase_weight_variances_debit_note_id ON purchase_weight_variances (debit_note_id)""")
    op.execute("""CREATE INDEX IF NOT EXISTS ix_purchase_weight_variances_discrepancy_id ON purchase_weight_variances (discrepancy_id)""")
    op.execute("""CREATE INDEX IF NOT EXISTS ix_purchase_weight_variances_plant_id ON purchase_weight_variances (plant_id)""")
    op.execute("""CREATE INDEX IF NOT EXISTS ix_purchase_weight_variances_plant_status ON purchase_weight_variances (plant_id, status)""")
    op.execute("""CREATE INDEX IF NOT EXISTS ix_purchase_weight_variances_purchase_order_id ON purchase_weight_variances (purchase_order_id)""")
    op.execute("""CREATE INDEX IF NOT EXISTS ix_purchase_weight_variances_receipt_id ON purchase_weight_variances (receipt_id)""")
    op.execute("""CREATE INDEX IF NOT EXISTS ix_purchase_weight_variances_supplier_id ON purchase_weight_variances (supplier_id)""")
    op.execute("""CREATE INDEX IF NOT EXISTS ix_purchase_weight_variances_supplier_invoice_id ON purchase_weight_variances (supplier_invoice_id)""")
    op.execute("""CREATE TABLE IF NOT EXISTS incoming_qc_entry_keys (
	id UUID NOT NULL, 
	plant_id VARCHAR(50) NOT NULL, 
	idempotency_key VARCHAR(120) NOT NULL, 
	kind VARCHAR(20) NOT NULL, 
	entity_type VARCHAR(20) NOT NULL, 
	entity_id UUID NOT NULL, 
	fingerprint VARCHAR(64) NOT NULL, 
	result JSON NOT NULL, 
	created_by VARCHAR(200), 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_incoming_qc_entry_key UNIQUE (plant_id, idempotency_key)
)""")
    op.execute("""CREATE INDEX IF NOT EXISTS ix_incoming_qc_entry_keys_entity_id ON incoming_qc_entry_keys (entity_id)""")
    op.execute("""CREATE INDEX IF NOT EXISTS ix_incoming_qc_entry_keys_plant_id ON incoming_qc_entry_keys (plant_id)""")
    from src.schema_incoming_bill import migrate_incoming_bill_qc_data
    migrate_incoming_bill_qc_data(op.get_bind())


def downgrade():
    raise RuntimeError("Forward recovery required: weighed actual quantities and weight cases are audit records")
