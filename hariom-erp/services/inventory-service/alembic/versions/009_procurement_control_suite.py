"""Add governed procurement, paper lots, costing, scheduling and alerts.

Revision ID: 009_procurement_control_suite
Revises: 008_physical_tooling_lifecycle
"""
from alembic import op


revision = "009_procurement_control_suite"
down_revision = "008_physical_tooling_lifecycle"
branch_labels = None
depends_on = None


def _execute(statements: list[str]) -> None:
    for statement in statements:
        op.execute(statement)


def upgrade() -> None:
    _execute([
        """CREATE TABLE IF NOT EXISTS audit_outbox (
          id VARCHAR(36) PRIMARY KEY, occurred_at TIMESTAMP NOT NULL, body TEXT NOT NULL,
          delivered_at TIMESTAMP, attempts INTEGER NOT NULL DEFAULT 0)""",
        "CREATE INDEX IF NOT EXISTS ix_audit_outbox_delivered_at ON audit_outbox(delivered_at)",
        """DO $$ BEGIN CREATE TYPE reservationstatus AS ENUM ('ACTIVE','RELEASED','CONSUMED');
          EXCEPTION WHEN duplicate_object THEN NULL; END $$""",
        """CREATE TABLE IF NOT EXISTS reservations (
          id UUID PRIMARY KEY, sales_order_id UUID NOT NULL, sales_order_line_id UUID NOT NULL,
          item_id UUID NOT NULL REFERENCES item_master(id), batch_id UUID REFERENCES stock_batch(id), spec_id UUID,
          reserved_qty DOUBLE PRECISION NOT NULL, consumed_qty DOUBLE PRECISION NOT NULL DEFAULT 0,
          status reservationstatus NOT NULL DEFAULT 'ACTIVE', plant_id UUID NOT NULL,
          created_by VARCHAR(200) NOT NULL, created_at TIMESTAMP DEFAULT NOW(), released_at TIMESTAMP)""",
        "CREATE INDEX IF NOT EXISTS ix_reservations_plant_id ON reservations(plant_id)",
        # Complete the inventory columns that older deployments obtained from
        # SQLAlchemy create_all.  Keeping them here makes Alembic sufficient on
        # a blank database and guarantees the stock projections used below.
        "ALTER TABLE item_master ADD COLUMN IF NOT EXISTS reorder_level DOUBLE PRECISION NOT NULL DEFAULT 0",
        "ALTER TABLE item_master ADD COLUMN IF NOT EXISTS safety_stock DOUBLE PRECISION NOT NULL DEFAULT 0",
        "ALTER TABLE item_master ADD COLUMN IF NOT EXISTS lead_time_days DOUBLE PRECISION NOT NULL DEFAULT 0",
        "ALTER TABLE stock_batch ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES inventory_locations(id)",
        "ALTER TABLE stock_batch ADD COLUMN IF NOT EXISTS stock_status VARCHAR(20) NOT NULL DEFAULT 'UNRESTRICTED'",
        "ALTER TABLE stock_batch ADD COLUMN IF NOT EXISTS unit_cost DOUBLE PRECISION",
        "ALTER TABLE stock_batch ADD COLUMN IF NOT EXISTS cost_source VARCHAR(20)",
        "ALTER TABLE stock_batch ADD COLUMN IF NOT EXISTS supplier_id UUID",
        "ALTER TABLE stock_batch ADD COLUMN IF NOT EXISTS supplier_name_snapshot VARCHAR(200)",
        "ALTER TABLE stock_batch ADD COLUMN IF NOT EXISTS spec_id UUID",
        "ALTER TABLE stock_transaction ADD COLUMN IF NOT EXISTS external_ref VARCHAR(120)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_transaction_external_ref ON stock_transaction(external_ref) WHERE external_ref IS NOT NULL",
        "ALTER TABLE stock_transaction ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES inventory_locations(id)",
        "ALTER TABLE stock_transaction ADD COLUMN IF NOT EXISTS stock_status VARCHAR(20) NOT NULL DEFAULT 'UNRESTRICTED'",
        "ALTER TABLE stock_transaction ADD COLUMN IF NOT EXISTS movement_metadata JSON",
        "ALTER TABLE stock_transaction ADD COLUMN IF NOT EXISTS effective_date DATE",
        "ALTER TABLE stock_transaction ADD COLUMN IF NOT EXISTS effective_at TIMESTAMP",
        """DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='reel_scan_events' AND column_name='metadata')
             AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='reel_scan_events' AND column_name='event_metadata')
          THEN ALTER TABLE reel_scan_events RENAME COLUMN metadata TO event_metadata; END IF;
        END $$""",
        """DO $$ BEGIN ALTER TABLE stock_batch ADD CONSTRAINT ck_stock_batch_stock_status
          CHECK (stock_status IN ('UNRESTRICTED','WIP','QC_HOLD','BLOCKED','DISPATCH_STAGING','SCRAP'));
          EXCEPTION WHEN duplicate_object THEN NULL; END $$""",
        """DO $$ BEGIN ALTER TABLE stock_transaction ADD CONSTRAINT ck_stock_transaction_stock_status
          CHECK (stock_status IN ('UNRESTRICTED','WIP','QC_HOLD','BLOCKED','DISPATCH_STAGING','SCRAP'));
          EXCEPTION WHEN duplicate_object THEN NULL; END $$""",
        """CREATE TABLE IF NOT EXISTS document_series (
          id UUID PRIMARY KEY, plant_id VARCHAR(50) NOT NULL, document_type VARCHAR(30) NOT NULL,
          category VARCHAR(20) NOT NULL, prefix VARCHAR(30) NOT NULL, next_value INTEGER NOT NULL DEFAULT 1,
          version INTEGER NOT NULL DEFAULT 1, active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_document_series_scope UNIQUE (plant_id, document_type, category),
          CONSTRAINT ck_document_series_next_positive CHECK (next_value > 0))""",
        """CREATE TABLE IF NOT EXISTS purchase_order_revisions (
          id UUID PRIMARY KEY, purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id), revision_no INTEGER NOT NULL, request_id UUID NOT NULL,
          approval_state VARCHAR(30) NOT NULL DEFAULT 'DRAFT', content_hash VARCHAR(64) NOT NULL,
          snapshot_json JSON NOT NULL DEFAULT '{}', change_reason TEXT, version INTEGER NOT NULL DEFAULT 1,
          created_by VARCHAR(200) NOT NULL, submitted_by VARCHAR(200), submitted_at TIMESTAMP,
          approved_by VARCHAR(200), approved_at TIMESTAMP, rejected_by VARCHAR(200), rejected_at TIMESTAMP,
          rejection_reason TEXT, created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_purchase_order_revision_no UNIQUE (purchase_order_id, revision_no),
          CONSTRAINT uq_purchase_order_revision_request UNIQUE (purchase_order_id, request_id),
          CONSTRAINT ck_purchase_order_revision_state CHECK (approval_state IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','WITHDRAWN')))""",
        """CREATE TABLE IF NOT EXISTS purchase_order_revision_lines (
          id UUID PRIMARY KEY, revision_id UUID NOT NULL REFERENCES purchase_order_revisions(id), logical_line_id UUID NOT NULL,
          source_order_line_id UUID REFERENCES purchase_order_lines(id), item_id UUID NOT NULL REFERENCES item_master(id),
          qty_ordered NUMERIC(18,3) NOT NULL, unit_rate NUMERIC(18,6) NOT NULL, uom VARCHAR(12) NOT NULL DEFAULT 'KG',
          expected_unit_count INTEGER, count_basis VARCHAR(20), specification_json JSON NOT NULL DEFAULT '{}',
          delivery_date DATE, created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_purchase_revision_logical_line UNIQUE (revision_id, logical_line_id),
          CONSTRAINT ck_purchase_revision_line_qty_positive CHECK (qty_ordered > 0),
          CONSTRAINT ck_purchase_revision_line_rate_nonnegative CHECK (unit_rate >= 0),
          CONSTRAINT ck_purchase_revision_expected_count CHECK (expected_unit_count IS NULL OR expected_unit_count > 0),
          CONSTRAINT ck_purchase_revision_count_basis CHECK (count_basis IS NULL OR count_basis IN ('ESTIMATED','CONTRACTUAL')))""",
        """CREATE TABLE IF NOT EXISTS purchase_approval_decisions (
          id UUID PRIMARY KEY, revision_id UUID NOT NULL REFERENCES purchase_order_revisions(id),
          decision VARCHAR(20) NOT NULL, reason TEXT, content_hash VARCHAR(64) NOT NULL,
          actor VARCHAR(200) NOT NULL, actor_role VARCHAR(80), decided_at TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT ck_purchase_approval_decision CHECK (decision IN ('SUBMITTED','APPROVED','REJECTED','WITHDRAWN')))""",
        """CREATE TABLE IF NOT EXISTS purchase_delivery_schedules (
          id UUID PRIMARY KEY, revision_line_id UUID NOT NULL REFERENCES purchase_order_revision_lines(id),
          delivery_date DATE NOT NULL, planned_qty NUMERIC(18,3) NOT NULL,
          received_qty NUMERIC(18,3) NOT NULL DEFAULT 0, cancelled_qty NUMERIC(18,3) NOT NULL DEFAULT 0,
          vendor_confirmation VARCHAR(30) NOT NULL DEFAULT 'PENDING', source_plan_entry_id UUID,
          version INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT ck_purchase_delivery_qty_positive CHECK (planned_qty > 0),
          CONSTRAINT ck_purchase_delivery_balances CHECK (received_qty >= 0 AND cancelled_qty >= 0))""",
        """CREATE TABLE IF NOT EXISTS supplier_invoices (
          id UUID PRIMARY KEY, plant_id VARCHAR(50) NOT NULL, supplier_id UUID NOT NULL,
          invoice_no VARCHAR(120) NOT NULL, normalized_invoice_no VARCHAR(120) NOT NULL, invoice_date DATE NOT NULL,
          currency VARCHAR(3) NOT NULL DEFAULT 'INR', status VARCHAR(30) NOT NULL DEFAULT 'RECORDED',
          document_ref VARCHAR(500), version INTEGER NOT NULL DEFAULT 1, created_by VARCHAR(200) NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_supplier_invoice_namespace UNIQUE (plant_id, supplier_id, normalized_invoice_no))""",
        """CREATE TABLE IF NOT EXISTS supplier_invoice_lines (
          id UUID PRIMARY KEY, invoice_id UUID NOT NULL REFERENCES supplier_invoices(id), item_id UUID NOT NULL REFERENCES item_master(id),
          qty NUMERIC(18,3) NOT NULL, rate NUMERIC(18,6) NOT NULL, uom VARCHAR(12) NOT NULL DEFAULT 'KG',
          tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0, charge_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT ck_supplier_invoice_line_qty_positive CHECK (qty > 0),
          CONSTRAINT ck_supplier_invoice_line_rate_nonnegative CHECK (rate >= 0))""",
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS category VARCHAR(20) NOT NULL DEFAULT 'RM_PM'",
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS request_id UUID",
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS request_fingerprint VARCHAR(64)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_orders_plant_request ON purchase_orders(plant_id, request_id) WHERE request_id IS NOT NULL",
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS current_revision_no INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS submitted_by VARCHAR(200)",
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP",
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()",
        "ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS ck_purchase_orders_status",
        "ALTER TABLE purchase_orders ADD CONSTRAINT ck_purchase_orders_status CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','REVISION_REQUIRED','PARTIALLY_RECEIVED','RECEIVED','SHORT_CLOSED','CANCELLED'))",
        "ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS logical_line_id UUID",
        "UPDATE purchase_order_lines SET logical_line_id = id WHERE logical_line_id IS NULL",
        "ALTER TABLE purchase_order_lines ALTER COLUMN logical_line_id SET NOT NULL",
        "ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS uom VARCHAR(12) NOT NULL DEFAULT 'KG'",
        "ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS expected_unit_count INTEGER",
        "ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS received_unit_count INTEGER",
        "ALTER TABLE purchase_order_lines DROP CONSTRAINT IF EXISTS ck_purchase_order_line_received_unit_count",
        "ALTER TABLE purchase_order_lines ADD CONSTRAINT ck_purchase_order_line_received_unit_count CHECK (received_unit_count IS NULL OR received_unit_count >= 0)",
        "ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS count_basis VARCHAR(20)",
        "ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS qty_short_closed DOUBLE PRECISION NOT NULL DEFAULT 0",
        "ALTER TABLE purchase_receipts ADD COLUMN IF NOT EXISTS request_id UUID",
        "ALTER TABLE purchase_receipts ADD COLUMN IF NOT EXISTS request_fingerprint VARCHAR(64)",
        "ALTER TABLE purchase_receipts ADD COLUMN IF NOT EXISTS supplier_invoice_id UUID REFERENCES supplier_invoices(id)",
        "ALTER TABLE purchase_receipts ADD COLUMN IF NOT EXISTS invoice_pending BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE purchase_receipts ADD COLUMN IF NOT EXISTS commercial_status VARCHAR(30) NOT NULL DEFAULT 'CLEAR'",
        "ALTER TABLE purchase_receipts ADD COLUMN IF NOT EXISTS posting_version INTEGER NOT NULL DEFAULT 1",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_receipts_plant_request ON purchase_receipts(plant_id, request_id) WHERE request_id IS NOT NULL",
        "ALTER TABLE purchase_receipt_lines ADD COLUMN IF NOT EXISTS approved_revision_line_id UUID REFERENCES purchase_order_revision_lines(id)",
        "ALTER TABLE purchase_receipt_lines ADD COLUMN IF NOT EXISTS po_rate NUMERIC(18,6)",
        "ALTER TABLE purchase_receipt_lines ADD COLUMN IF NOT EXISTS invoice_rate NUMERIC(18,6)",
        "ALTER TABLE purchase_receipt_lines ADD COLUMN IF NOT EXISTS tracking_mode VARCHAR(20) NOT NULL DEFAULT 'BULK'",
        "ALTER TABLE purchase_receipt_lines ADD COLUMN IF NOT EXISTS commercial_status VARCHAR(30) NOT NULL DEFAULT 'CLEAR'",
        "ALTER TABLE paper_reels ADD COLUMN IF NOT EXISTS purchase_receipt_line_id UUID REFERENCES purchase_receipt_lines(id)",
        "ALTER TABLE paper_reels ADD COLUMN IF NOT EXISTS supplier_id UUID",
        "ALTER TABLE paper_reels ADD COLUMN IF NOT EXISTS supplier_name_snapshot VARCHAR(200)",
        "ALTER TABLE paper_reels ADD COLUMN IF NOT EXISTS gross_weight_kg DOUBLE PRECISION",
        "ALTER TABLE paper_reels ADD COLUMN IF NOT EXISTS tare_weight_kg DOUBLE PRECISION",
        "ALTER TABLE paper_reels ADD COLUMN IF NOT EXISTS net_weight_kg DOUBLE PRECISION",
        "ALTER TABLE paper_reels ADD COLUMN IF NOT EXISTS physical_form VARCHAR(20) NOT NULL DEFAULT 'REEL'",
        "ALTER TABLE paper_reels ADD COLUMN IF NOT EXISTS source_reel_no VARCHAR(120)",
        "ALTER TABLE paper_reels ADD COLUMN IF NOT EXISTS vendor_batch_no VARCHAR(120)",
        "ALTER TABLE paper_reels ADD COLUMN IF NOT EXISTS width_mm DOUBLE PRECISION",
        "ALTER TABLE paper_reels ADD COLUMN IF NOT EXISTS commercial_status VARCHAR(30) NOT NULL DEFAULT 'CLEAR'",
        "ALTER TABLE paper_reels ADD COLUMN IF NOT EXISTS stock_status VARCHAR(20) NOT NULL DEFAULT 'UNRESTRICTED'",
        "ALTER TABLE paper_reels ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES inventory_locations(id)",
        "ALTER TABLE paper_reels ADD COLUMN IF NOT EXISTS parent_reel_id UUID REFERENCES paper_reels(id)",
        "ALTER TABLE paper_reels ADD COLUMN IF NOT EXISTS genealogy_metadata JSON",
        "CREATE INDEX IF NOT EXISTS ix_paper_reels_purchase_receipt_line_id ON paper_reels(purchase_receipt_line_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_paper_reels_supplier_source ON paper_reels(plant_id,supplier_id,source_reel_no) WHERE supplier_id IS NOT NULL AND source_reel_no IS NOT NULL",
        """DO $$ BEGIN ALTER TABLE paper_reels ADD CONSTRAINT ck_paper_reels_stock_status
          CHECK (stock_status IN ('UNRESTRICTED','WIP','QC_HOLD','BLOCKED','DISPATCH_STAGING','SCRAP'));
          EXCEPTION WHEN duplicate_object THEN NULL; END $$""",
        """CREATE TABLE IF NOT EXISTS receipt_invoice_allocations (
          id UUID PRIMARY KEY, receipt_line_id UUID NOT NULL REFERENCES purchase_receipt_lines(id),
          invoice_line_id UUID NOT NULL REFERENCES supplier_invoice_lines(id), revision_line_id UUID REFERENCES purchase_order_revision_lines(id),
          allocated_qty NUMERIC(18,3) NOT NULL, po_rate NUMERIC(18,6) NOT NULL, invoice_rate NUMERIC(18,6) NOT NULL,
          rate_delta NUMERIC(18,6) NOT NULL, claimable_amount NUMERIC(18,2) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_receipt_invoice_allocation UNIQUE (receipt_line_id, invoice_line_id),
          CONSTRAINT ck_receipt_invoice_allocation_qty CHECK (allocated_qty > 0))""",
        """CREATE TABLE IF NOT EXISTS receipt_stock_allocations (
          id UUID PRIMARY KEY, receipt_line_id UUID NOT NULL REFERENCES purchase_receipt_lines(id),
          reel_id UUID REFERENCES paper_reels(id), batch_id UUID REFERENCES stock_batch(id),
          allocated_qty NUMERIC(18,3) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT ck_receipt_stock_exactly_one_target CHECK ((reel_id IS NOT NULL) <> (batch_id IS NOT NULL)),
          CONSTRAINT ck_receipt_stock_allocation_qty CHECK (allocated_qty > 0))""",
        """CREATE TABLE IF NOT EXISTS purchase_discrepancies (
          id UUID PRIMARY KEY, plant_id VARCHAR(50) NOT NULL,
          allocation_id UUID NOT NULL REFERENCES receipt_invoice_allocations(id), discrepancy_type VARCHAR(30) NOT NULL DEFAULT 'RATE',
          quantity NUMERIC(18,3) NOT NULL, po_rate NUMERIC(18,6) NOT NULL, invoice_rate NUMERIC(18,6) NOT NULL,
          delta NUMERIC(18,6) NOT NULL, claimable_amount NUMERIC(18,2) NOT NULL, evidence_json JSON NOT NULL DEFAULT '{}',
          status VARCHAR(30) NOT NULL DEFAULT 'OPEN', assignee VARCHAR(200), resolution_reason TEXT,
          version INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMP NOT NULL DEFAULT NOW(), resolved_at TIMESTAMP,
          CONSTRAINT uq_purchase_discrepancy_allocation_type UNIQUE (allocation_id, discrepancy_type),
          CONSTRAINT ck_purchase_discrepancy_status CHECK (status IN ('OPEN','UNDER_REVIEW','ACCEPTED','CLAIM_DRAFTED','CLAIMED','RESOLVED','REJECTED')))""",
        """CREATE TABLE IF NOT EXISTS purchase_debit_notes (
          id UUID PRIMARY KEY, plant_id VARCHAR(50) NOT NULL, debit_note_no VARCHAR(80) NOT NULL, request_id UUID NOT NULL, request_fingerprint VARCHAR(64) NOT NULL,
          supplier_id UUID NOT NULL, supplier_name_snapshot VARCHAR(200) NOT NULL, note_date DATE NOT NULL,
          reason TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'DRAFT', total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
          settled_amount NUMERIC(18,2) NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
          created_by VARCHAR(200) NOT NULL, approved_by VARCHAR(200), issued_at TIMESTAMP, created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_purchase_debit_note_no UNIQUE (plant_id, debit_note_no), CONSTRAINT uq_purchase_debit_note_request UNIQUE (plant_id, request_id),
          CONSTRAINT ck_purchase_debit_note_status CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','ISSUED','PARTIALLY_SETTLED','SETTLED','VOID')))""",
        """CREATE TABLE IF NOT EXISTS purchase_debit_note_lines (
          id UUID PRIMARY KEY, debit_note_id UUID NOT NULL REFERENCES purchase_debit_notes(id),
          discrepancy_id UUID NOT NULL REFERENCES purchase_discrepancies(id), claimed_amount NUMERIC(18,2) NOT NULL,
          tax_adjustment NUMERIC(18,2) NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_purchase_debit_note_discrepancy UNIQUE (discrepancy_id),
          CONSTRAINT ck_purchase_debit_note_claim_positive CHECK (claimed_amount > 0))""",
        """CREATE TABLE IF NOT EXISTS purchase_debit_note_settlements (
          id UUID PRIMARY KEY, debit_note_id UUID NOT NULL REFERENCES purchase_debit_notes(id), amount NUMERIC(18,2) NOT NULL,
          settlement_date DATE NOT NULL, reference VARCHAR(160) NOT NULL, created_by VARCHAR(200) NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(), CONSTRAINT ck_purchase_debit_note_settlement_positive CHECK (amount > 0))""",
        """CREATE TABLE IF NOT EXISTS lot_label_records (
          id UUID PRIMARY KEY, plant_id VARCHAR(50) NOT NULL, reel_id UUID NOT NULL UNIQUE REFERENCES paper_reels(id),
          label_code VARCHAR(100) NOT NULL, content_snapshot JSON NOT NULL DEFAULT '{}', created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_lot_label_code UNIQUE (plant_id, label_code))""",
        """CREATE TABLE IF NOT EXISTS label_print_jobs (
          id UUID PRIMARY KEY, plant_id VARCHAR(50) NOT NULL, request_id UUID NOT NULL, request_fingerprint VARCHAR(64) NOT NULL, profile VARCHAR(40) NOT NULL DEFAULT 'PAPER_LOT_4X2',
          lot_ids JSON NOT NULL DEFAULT '[]', copies INTEGER NOT NULL DEFAULT 1, status VARCHAR(30) NOT NULL DEFAULT 'GENERATED',
          reprint_reason TEXT, created_by VARCHAR(200) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_label_print_job_request UNIQUE (plant_id, request_id), CONSTRAINT ck_label_print_job_copies CHECK (copies > 0))""",
        """CREATE TABLE IF NOT EXISTS procurement_plans (
          id UUID PRIMARY KEY, plant_id VARCHAR(50) NOT NULL, month DATE NOT NULL, request_id UUID NOT NULL, request_fingerprint VARCHAR(64) NOT NULL, name VARCHAR(160) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'DRAFT', target_mode VARCHAR(30) NOT NULL DEFAULT 'ARRIVAL',
          source_hash VARCHAR(64), working_calendar JSON NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1,
          created_by VARCHAR(200) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_procurement_plan_month_name UNIQUE (plant_id, month, name),
          CONSTRAINT uq_procurement_plan_request UNIQUE (plant_id, request_id))""",
        """CREATE TABLE IF NOT EXISTS procurement_plan_entries (
          id UUID PRIMARY KEY, plan_id UUID NOT NULL REFERENCES procurement_plans(id), entry_date DATE NOT NULL,
          item_id UUID NOT NULL REFERENCES item_master(id), supplier_id UUID, supplier_name_snapshot VARCHAR(200),
          material_form VARCHAR(20) NOT NULL DEFAULT 'REEL', qty_kg NUMERIC(18,3) NOT NULL,
          expected_unit_count INTEGER, status VARCHAR(20) NOT NULL DEFAULT 'PLANNED', notes TEXT,
          converted_qty_kg NUMERIC(18,3) NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT ck_procurement_plan_entry_qty CHECK (qty_kg >= 0),
          CONSTRAINT ck_procurement_plan_entry_count CHECK (expected_unit_count IS NULL OR expected_unit_count > 0))""",
        """CREATE TABLE IF NOT EXISTS procurement_plan_conversions (
          id UUID PRIMARY KEY, plant_id VARCHAR(50) NOT NULL, request_id UUID NOT NULL,
          plan_id UUID NOT NULL REFERENCES procurement_plans(id), entry_ids JSON NOT NULL DEFAULT '[]',
          purchase_order_ids JSON NOT NULL DEFAULT '[]', payload_hash VARCHAR(64) NOT NULL,
          created_by VARCHAR(200) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_plan_conversion_request UNIQUE (plant_id, request_id))""",
        """CREATE TABLE IF NOT EXISTS mrp_runs (
          id UUID PRIMARY KEY, plant_id VARCHAR(50) NOT NULL, as_of_date DATE NOT NULL, horizon_end DATE NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED', source_versions JSON NOT NULL DEFAULT '{}',
          results_json JSON NOT NULL DEFAULT '[]', created_by VARCHAR(200) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW())""",
        """CREATE TABLE IF NOT EXISTS stock_alert_policies (
          id UUID PRIMARY KEY, plant_id VARCHAR(50) NOT NULL, item_id UUID REFERENCES item_master(id), request_id UUID NOT NULL, request_fingerprint VARCHAR(64) NOT NULL,
          scope_type VARCHAR(20) NOT NULL DEFAULT 'ITEM', status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
          stock_basis VARCHAR(30) NOT NULL DEFAULT 'FREE_STOCK', safety_stock_kg NUMERIC(18,3) NOT NULL DEFAULT 0,
          reorder_point_kg NUMERIC(18,3) NOT NULL DEFAULT 0, target_stock_kg NUMERIC(18,3) NOT NULL DEFAULT 0,
          recovery_margin_kg NUMERIC(18,3) NOT NULL DEFAULT 0, lead_time_days INTEGER NOT NULL DEFAULT 0,
          minimum_order_kg NUMERIC(18,3) NOT NULL DEFAULT 0, order_multiple_kg NUMERIC(18,3) NOT NULL DEFAULT 0,
          recipients JSON NOT NULL DEFAULT '[]', cooldown_hours INTEGER NOT NULL DEFAULT 24,
          change_reason TEXT NOT NULL, activation_reason TEXT, version INTEGER NOT NULL DEFAULT 1,
          created_by VARCHAR(200) NOT NULL, activated_by VARCHAR(200), activated_at TIMESTAMP,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(), CONSTRAINT uq_stock_alert_policy_version UNIQUE (plant_id,item_id,version),
          CONSTRAINT uq_stock_alert_policy_request UNIQUE (plant_id,request_id),
          CONSTRAINT ck_stock_alert_policy_thresholds CHECK (safety_stock_kg >= 0 AND reorder_point_kg >= 0 AND target_stock_kg >= 0),
          CONSTRAINT ck_stock_alert_policy_order CHECK (target_stock_kg >= reorder_point_kg AND reorder_point_kg >= safety_stock_kg))""",
        """CREATE TABLE IF NOT EXISTS stock_alert_episodes (
          id UUID PRIMARY KEY, plant_id VARCHAR(50) NOT NULL, policy_id UUID NOT NULL REFERENCES stock_alert_policies(id),
          item_id UUID NOT NULL REFERENCES item_master(id), status VARCHAR(20) NOT NULL DEFAULT 'OPEN', severity VARCHAR(20) NOT NULL,
          stock_qty_kg NUMERIC(18,3) NOT NULL, threshold_qty_kg NUMERIC(18,3) NOT NULL, assignee VARCHAR(200),
          acknowledged_by VARCHAR(200), acknowledged_at TIMESTAMP, snoozed_until TIMESTAMP,
          breached_at TIMESTAMP NOT NULL DEFAULT NOW(), recovered_at TIMESTAMP,
          CONSTRAINT ck_stock_alert_episode_status CHECK (status IN ('OPEN','ACKNOWLEDGED','SNOOZED','RECOVERED')))""",
        """CREATE TABLE IF NOT EXISTS rm_cost_sheets (
          id UUID PRIMARY KEY, plant_id VARCHAR(50) NOT NULL, item_id UUID NOT NULL REFERENCES item_master(id),
          currency VARCHAR(3) NOT NULL DEFAULT 'INR', base_uom VARCHAR(12) NOT NULL DEFAULT 'KG', current_version_id UUID,
          version INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_rm_cost_sheet_scope UNIQUE (plant_id,item_id,currency))""",
        """CREATE TABLE IF NOT EXISTS rm_cost_versions (
          id UUID PRIMARY KEY, sheet_id UUID NOT NULL REFERENCES rm_cost_sheets(id), version_no INTEGER NOT NULL, request_id UUID NOT NULL, request_fingerprint VARCHAR(64) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'DRAFT', base_cost NUMERIC(18,6) NOT NULL, landed_cost NUMERIC(18,6) NOT NULL,
          effective_from DATE NOT NULL, effective_to DATE, change_reason TEXT NOT NULL, activation_reason TEXT,
          source VARCHAR(80), content_hash VARCHAR(64) NOT NULL,
          created_by VARCHAR(200) NOT NULL, activated_by VARCHAR(200), activated_at TIMESTAMP, created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_rm_cost_version_no UNIQUE (sheet_id,version_no), CONSTRAINT uq_rm_cost_version_request UNIQUE (sheet_id,request_id),
          CONSTRAINT ck_rm_cost_nonnegative CHECK (base_cost >= 0 AND landed_cost >= 0),
          CONSTRAINT ck_rm_cost_version_status CHECK (status IN ('DRAFT','SCHEDULED','ACTIVE','SUPERSEDED','CANCELLED')))""",
        """CREATE TABLE IF NOT EXISTS rm_cost_components (
          id UUID PRIMARY KEY, version_id UUID NOT NULL REFERENCES rm_cost_versions(id), component_type VARCHAR(30) NOT NULL,
          label VARCHAR(120) NOT NULL, calculation_mode VARCHAR(20) NOT NULL DEFAULT 'PER_KG',
          entered_value NUMERIC(18,6) NOT NULL, normalized_per_kg NUMERIC(18,6) NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0, metadata_json JSON NOT NULL DEFAULT '{}',
          CONSTRAINT ck_rm_cost_component_nonnegative CHECK (normalized_per_kg >= 0))""",
        "CREATE INDEX IF NOT EXISTS ix_po_revision_po ON purchase_order_revisions(purchase_order_id)",
        "CREATE INDEX IF NOT EXISTS ix_po_revision_line_revision ON purchase_order_revision_lines(revision_id)",
        "CREATE INDEX IF NOT EXISTS ix_discrepancy_plant_status ON purchase_discrepancies(plant_id,status)",
        "CREATE INDEX IF NOT EXISTS ix_plan_entry_plan_date ON procurement_plan_entries(plan_id,entry_date)",
        "CREATE INDEX IF NOT EXISTS ix_alert_episode_plant_status ON stock_alert_episodes(plant_id,status)",
        "CREATE INDEX IF NOT EXISTS ix_cost_version_sheet_effective ON rm_cost_versions(sheet_id,effective_from)",
    ])


def downgrade() -> None:
    raise RuntimeError(
        "Procurement control migration is forward-only because issued POs, receipts, claims, labels and cost history must be preserved."
    )
