import json
import uuid

from fastapi import FastAPI
from sqlalchemy import text

from .database import Base, engine
from .quality_templates import QC_TEMPLATE_PRESETS
from .routers import (
    balance,
    dispatch,
    fg_inward,
    health,
    inward,
    issue,
    items,
    labels,
    ledger,
    locations,
    purchase,
    quality,
    reel_issues,
    reels,
    reservations,
    stock_control,
    tool_assets,
    stock_moves,
    valuation,
)

Base.metadata.create_all(bind=engine)


def ensure_runtime_schema() -> None:
  with engine.begin() as connection:
    connection.execute(
      text(
        "DO $$ BEGIN "
        "IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'itemtype') THEN "
        "BEGIN ALTER TYPE itemtype ADD VALUE IF NOT EXISTS 'PACKAGING'; EXCEPTION WHEN duplicate_object THEN NULL; END; "
        "BEGIN ALTER TYPE itemtype ADD VALUE IF NOT EXISTS 'TOOL'; EXCEPTION WHEN duplicate_object THEN NULL; END; "
        "BEGIN ALTER TYPE itemtype ADD VALUE IF NOT EXISTS 'OTHER'; EXCEPTION WHEN duplicate_object THEN NULL; END; "
        "END IF; "
        "END $$;"
      )
    )
    connection.execute(
      text(
        "DO $$ BEGIN "
        "IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transactiontype') THEN "
        "BEGIN ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'MOVE'; EXCEPTION WHEN duplicate_object THEN NULL; END; "
        "BEGIN ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'OPENING'; EXCEPTION WHEN duplicate_object THEN NULL; END; "
        "BEGIN ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'ADJUSTMENT'; EXCEPTION WHEN duplicate_object THEN NULL; END; "
        "END IF; "
        "END $$;"
      )
    )
    connection.execute(
      text(
        "DO $$ BEGIN "
        "IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'referencetype') THEN "
        "BEGIN ALTER TYPE referencetype ADD VALUE IF NOT EXISTS 'PURCHASE'; EXCEPTION WHEN duplicate_object THEN NULL; END; "
        "BEGIN ALTER TYPE referencetype ADD VALUE IF NOT EXISTS 'PRODUCTION_JOB'; EXCEPTION WHEN duplicate_object THEN NULL; END; "
        "BEGIN ALTER TYPE referencetype ADD VALUE IF NOT EXISTS 'DISPATCH'; EXCEPTION WHEN duplicate_object THEN NULL; END; "
        "BEGIN ALTER TYPE referencetype ADD VALUE IF NOT EXISTS 'SALES_ORDER'; EXCEPTION WHEN duplicate_object THEN NULL; END; "
        "BEGIN ALTER TYPE referencetype ADD VALUE IF NOT EXISTS 'INTERNAL'; EXCEPTION WHEN duplicate_object THEN NULL; END; "
        "BEGIN ALTER TYPE referencetype ADD VALUE IF NOT EXISTS 'ADJUSTMENT'; EXCEPTION WHEN duplicate_object THEN NULL; END; "
        "END IF; "
        "END $$;"
      )
    )
    for table_name in ("item_master", "stock_batch", "stock_transaction", "reservations"):
      connection.execute(text(f"ALTER TABLE IF EXISTS {table_name} ALTER COLUMN plant_id DROP DEFAULT"))
      connection.execute(
        text(
          f"ALTER TABLE IF EXISTS {table_name} "
          "ALTER COLUMN plant_id TYPE VARCHAR(50) USING plant_id::text"
        )
      )
      connection.execute(text(f"ALTER TABLE IF EXISTS {table_name} ALTER COLUMN plant_id SET DEFAULT 'PLANT_A'"))

    connection.execute(
      text(
        "ALTER TABLE IF EXISTS stock_batch "
        "ADD COLUMN IF NOT EXISTS location_id UUID"
      )
    )
    connection.execute(
      text(
        "ALTER TABLE IF EXISTS stock_batch "
        "ADD COLUMN IF NOT EXISTS stock_status VARCHAR(20) DEFAULT 'UNRESTRICTED'"
      )
    )
    connection.execute(
      text(
        "ALTER TABLE IF EXISTS stock_batch "
        "ADD COLUMN IF NOT EXISTS unit_cost DOUBLE PRECISION"
      )
    )
    connection.execute(
      text(
        "ALTER TABLE IF EXISTS stock_batch "
        "ADD COLUMN IF NOT EXISTS cost_source VARCHAR(20)"
      )
    )
    connection.execute(
      text(
        "ALTER TABLE IF EXISTS stock_batch "
        "ADD COLUMN IF NOT EXISTS supplier_id UUID"
      )
    )
    connection.execute(
      text(
        "ALTER TABLE IF EXISTS stock_batch "
        "ADD COLUMN IF NOT EXISTS supplier_name_snapshot VARCHAR(200)"
      )
    )
    connection.execute(
      text("UPDATE stock_batch SET stock_status = 'UNRESTRICTED' WHERE stock_status IS NULL")
    )
    connection.execute(
      text(
        "ALTER TABLE IF EXISTS stock_batch "
        "ADD COLUMN IF NOT EXISTS inward_metadata JSONB"
      )
    )

    connection.execute(
      text("ALTER TABLE IF EXISTS item_master ADD COLUMN IF NOT EXISTS unit_cost DOUBLE PRECISION")
    )
    connection.execute(
      text("ALTER TABLE IF EXISTS item_master ADD COLUMN IF NOT EXISTS cost_source VARCHAR(20)")
    )
    connection.execute(
      text("ALTER TABLE IF EXISTS item_master ADD COLUMN IF NOT EXISTS reorder_level DOUBLE PRECISION DEFAULT 0")
    )
    connection.execute(
      text("ALTER TABLE IF EXISTS item_master ADD COLUMN IF NOT EXISTS safety_stock DOUBLE PRECISION DEFAULT 0")
    )
    connection.execute(
      text("ALTER TABLE IF EXISTS item_master ADD COLUMN IF NOT EXISTS lead_time_days DOUBLE PRECISION DEFAULT 0")
    )
    connection.execute(
      text(
        "UPDATE item_master "
        "SET reorder_level = COALESCE(reorder_level, 0), "
        "safety_stock = COALESCE(safety_stock, 0), "
        "lead_time_days = COALESCE(lead_time_days, 0)"
      )
    )

    connection.execute(
      text(
        "ALTER TABLE IF EXISTS stock_transaction "
        "ADD COLUMN IF NOT EXISTS location_id UUID"
      )
    )
    connection.execute(
      text(
        "ALTER TABLE IF EXISTS stock_transaction "
        "ADD COLUMN IF NOT EXISTS stock_status VARCHAR(20) DEFAULT 'UNRESTRICTED'"
      )
    )
    connection.execute(
      text(
        "ALTER TABLE IF EXISTS stock_transaction "
        "ADD COLUMN IF NOT EXISTS movement_metadata JSONB"
      )
    )
    connection.execute(
      text(
        "ALTER TABLE IF EXISTS stock_transaction "
        "ADD COLUMN IF NOT EXISTS effective_date DATE"
      )
    )
    connection.execute(
      text(
        "ALTER TABLE IF EXISTS stock_transaction "
        "ADD COLUMN IF NOT EXISTS effective_at TIMESTAMP"
      )
    )
    connection.execute(
      text(
        "CREATE INDEX IF NOT EXISTS ix_stock_transaction_effective_date "
        "ON stock_transaction (effective_date)"
      )
    )
    connection.execute(
      text(
        "CREATE INDEX IF NOT EXISTS ix_stock_transaction_effective_at "
        "ON stock_transaction (effective_at)"
      )
    )
    connection.execute(
      text("UPDATE stock_transaction SET stock_status = 'UNRESTRICTED' WHERE stock_status IS NULL")
    )
    connection.execute(
      text(
        "UPDATE stock_transaction "
        "SET effective_at = COALESCE(effective_at, effective_date::timestamp + interval '23 hours 59 minutes 59 seconds', created_at) "
        "WHERE effective_at IS NULL"
      )
    )

    connection.execute(
      text(
        "ALTER TABLE IF EXISTS paper_reels "
        "ADD COLUMN IF NOT EXISTS stock_status VARCHAR(20) DEFAULT 'UNRESTRICTED'"
      )
    )
    connection.execute(
      text(
        "ALTER TABLE IF EXISTS paper_reels "
        "ADD COLUMN IF NOT EXISTS location_id UUID"
      )
    )
    connection.execute(
      text(
        "ALTER TABLE IF EXISTS paper_reels "
        "ADD COLUMN IF NOT EXISTS parent_reel_id UUID"
      )
    )
    connection.execute(
      text(
        "ALTER TABLE IF EXISTS paper_reels "
        "ADD COLUMN IF NOT EXISTS genealogy_metadata JSONB"
      )
    )
    connection.execute(
      text(
        "ALTER TABLE IF EXISTS paper_reels "
        "ADD COLUMN IF NOT EXISTS inward_metadata JSONB"
      )
    )
    connection.execute(
      text(
        "ALTER TABLE IF EXISTS paper_reels "
        "ADD COLUMN IF NOT EXISTS unit_cost DOUBLE PRECISION"
      )
    )
    connection.execute(
      text(
        "ALTER TABLE IF EXISTS paper_reels "
        "ADD COLUMN IF NOT EXISTS cost_source VARCHAR(20)"
      )
    )
    connection.execute(
      text(
        "ALTER TABLE IF EXISTS paper_reels "
        "ADD COLUMN IF NOT EXISTS supplier_id UUID"
      )
    )
    connection.execute(
      text(
        "ALTER TABLE IF EXISTS paper_reels "
        "ADD COLUMN IF NOT EXISTS supplier_name_snapshot VARCHAR(200)"
      )
    )
    connection.execute(
      text("UPDATE paper_reels SET stock_status = 'UNRESTRICTED' WHERE stock_status IS NULL")
    )
    connection.execute(
      text(
        "ALTER TABLE IF EXISTS reel_scan_events "
        "ADD COLUMN IF NOT EXISTS event_metadata JSONB"
      )
    )
    connection.execute(
      text(
        "ALTER TABLE IF EXISTS reel_issues "
        "ADD COLUMN IF NOT EXISTS consumed_weight_kg DOUBLE PRECISION DEFAULT 0"
      )
    )
    connection.execute(
      text(
        "ALTER TABLE IF EXISTS reel_issues "
        "ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP"
      )
    )
    connection.execute(
      text(
        "UPDATE reel_issues "
        "SET consumed_weight_kg = GREATEST(0, COALESCE(issued_weight_kg, 0) - COALESCE(remaining_weight_kg, 0)) "
        "WHERE status = 'CLOSED' AND (consumed_weight_kg IS NULL OR consumed_weight_kg = 0)"
      )
    )
    connection.execute(
      text(
        "UPDATE reel_issues "
        "SET closed_at = COALESCE(closed_at, created_at) "
        "WHERE status = 'CLOSED'"
      )
    )
    for ddl in (
      "ALTER TABLE IF EXISTS purchase_orders ADD COLUMN IF NOT EXISTS metadata_json JSONB",
      "ALTER TABLE IF EXISTS purchase_order_lines ADD COLUMN IF NOT EXISTS metadata_json JSONB",
      "ALTER TABLE IF EXISTS inventory_certifications ADD COLUMN IF NOT EXISTS count_session_no VARCHAR(80)",
      "ALTER TABLE IF EXISTS inventory_certifications ADD COLUMN IF NOT EXISTS count_location_scope VARCHAR(200)",
      "ALTER TABLE IF EXISTS inventory_certifications ADD COLUMN IF NOT EXISTS count_state VARCHAR(30) DEFAULT 'DRAFT'",
      "ALTER TABLE IF EXISTS inventory_certifications ADD COLUMN IF NOT EXISTS attachment_refs JSONB DEFAULT '[]'::jsonb",
      "ALTER TABLE IF EXISTS inventory_certifications ADD COLUMN IF NOT EXISTS counted_by VARCHAR(200)",
      "ALTER TABLE IF EXISTS inventory_certifications ADD COLUMN IF NOT EXISTS checked_by VARCHAR(200)",
      "ALTER TABLE IF EXISTS inventory_certifications ADD COLUMN IF NOT EXISTS stock_as_of_at TIMESTAMP",
      "ALTER TABLE IF EXISTS inventory_certifications ADD COLUMN IF NOT EXISTS count_taken_at TIMESTAMP",
      "ALTER TABLE IF EXISTS inventory_certifications ADD COLUMN IF NOT EXISTS counted_at TIMESTAMP",
      "ALTER TABLE IF EXISTS inventory_certifications ADD COLUMN IF NOT EXISTS checked_at TIMESTAMP",
      "ALTER TABLE IF EXISTS inventory_certification_lines ADD COLUMN IF NOT EXISTS batch_id UUID",
      "ALTER TABLE IF EXISTS inventory_certification_lines ADD COLUMN IF NOT EXISTS reel_id UUID",
      "ALTER TABLE IF EXISTS inventory_certification_lines ADD COLUMN IF NOT EXISTS stock_status VARCHAR(20) DEFAULT 'UNRESTRICTED'",
      "ALTER TABLE IF EXISTS inventory_certification_lines ADD COLUMN IF NOT EXISTS location_id UUID",
      "ALTER TABLE IF EXISTS inventory_certification_lines ADD COLUMN IF NOT EXISTS bin_code VARCHAR(120)",
      "ALTER TABLE IF EXISTS inventory_certification_lines ADD COLUMN IF NOT EXISTS count_state VARCHAR(30) DEFAULT 'DRAFT'",
      "ALTER TABLE IF EXISTS inventory_certification_lines ADD COLUMN IF NOT EXISTS counted_by VARCHAR(200)",
      "ALTER TABLE IF EXISTS inventory_certification_lines ADD COLUMN IF NOT EXISTS checked_by VARCHAR(200)",
      "ALTER TABLE IF EXISTS inventory_certification_lines ADD COLUMN IF NOT EXISTS counted_at TIMESTAMP",
      "ALTER TABLE IF EXISTS inventory_certification_lines ADD COLUMN IF NOT EXISTS checked_at TIMESTAMP",
      "ALTER TABLE IF EXISTS inventory_certification_lines ADD COLUMN IF NOT EXISTS recount_required BOOLEAN DEFAULT FALSE",
      "ALTER TABLE IF EXISTS inventory_certification_lines ADD COLUMN IF NOT EXISTS recount_qty DOUBLE PRECISION",
      "ALTER TABLE IF EXISTS inventory_certification_lines ADD COLUMN IF NOT EXISTS recount_notes VARCHAR(500)",
      "ALTER TABLE IF EXISTS inventory_certification_lines ADD COLUMN IF NOT EXISTS attachment_refs JSONB DEFAULT '[]'::jsonb",
      "ALTER TABLE IF EXISTS stock_adjustment_vouchers ADD COLUMN IF NOT EXISTS attachment_refs JSONB DEFAULT '[]'::jsonb",
      "ALTER TABLE IF EXISTS stock_adjustment_vouchers ADD COLUMN IF NOT EXISTS effective_at TIMESTAMP",
      "ALTER TABLE IF EXISTS customer_rejections ADD COLUMN IF NOT EXISTS effective_date DATE",
      "ALTER TABLE IF EXISTS customer_rejections ADD COLUMN IF NOT EXISTS root_cause_department VARCHAR(80)",
      "ALTER TABLE IF EXISTS customer_rejections ADD COLUMN IF NOT EXISTS owner_department VARCHAR(80)",
      "ALTER TABLE IF EXISTS customer_rejections ADD COLUMN IF NOT EXISTS corrective_action TEXT",
      "ALTER TABLE IF EXISTS customer_rejections ADD COLUMN IF NOT EXISTS closure_due_date DATE",
      "ALTER TABLE IF EXISTS customer_rejections ADD COLUMN IF NOT EXISTS closure_status VARCHAR(30) DEFAULT 'OPEN'",
      "ALTER TABLE IF EXISTS customer_rejections ADD COLUMN IF NOT EXISTS rework_cost DOUBLE PRECISION DEFAULT 0",
      "ALTER TABLE IF EXISTS customer_rejections ADD COLUMN IF NOT EXISTS scrap_cost DOUBLE PRECISION DEFAULT 0",
      "ALTER TABLE IF EXISTS customer_rejections ADD COLUMN IF NOT EXISTS cost_impact DOUBLE PRECISION DEFAULT 0",
      "ALTER TABLE IF EXISTS customer_rejections ADD COLUMN IF NOT EXISTS attachment_refs JSONB DEFAULT '[]'::jsonb",
    ):
      connection.execute(text(ddl))
    connection.execute(
      text(
        "UPDATE inventory_certifications "
        "SET count_state = COALESCE(count_state, status, 'DRAFT')"
      )
    )
    connection.execute(
      text("UPDATE inventory_certifications SET attachment_refs = '[]' WHERE attachment_refs IS NULL")
    )
    connection.execute(
      text(
        "UPDATE inventory_certifications "
        "SET stock_as_of_at = COALESCE(stock_as_of_at, period_end::timestamp + interval '23 hours 59 minutes 59 seconds') "
        "WHERE stock_as_of_at IS NULL"
      )
    )
    connection.execute(
      text(
        "UPDATE inventory_certifications "
        "SET count_taken_at = COALESCE(count_taken_at, counted_at, created_at, stock_as_of_at) "
        "WHERE count_taken_at IS NULL"
      )
    )
    connection.execute(
      text(
        "UPDATE inventory_certification_lines "
        "SET stock_status = COALESCE(stock_status, 'UNRESTRICTED'), "
        "count_state = COALESCE(count_state, 'DRAFT'), "
        "recount_required = COALESCE(recount_required, FALSE)"
      )
    )
    connection.execute(
      text("UPDATE inventory_certification_lines SET attachment_refs = '[]' WHERE attachment_refs IS NULL")
    )
    connection.execute(
      text("UPDATE stock_adjustment_vouchers SET attachment_refs = '[]' WHERE attachment_refs IS NULL")
    )
    connection.execute(
      text(
        "UPDATE stock_adjustment_vouchers "
        "SET effective_at = COALESCE(effective_at, effective_date::timestamp + interval '23 hours 59 minutes 59 seconds', created_at) "
        "WHERE effective_at IS NULL"
      )
    )
    connection.execute(
      text(
        "UPDATE customer_rejections "
        "SET effective_date = COALESCE(effective_date, created_at::date), "
        "closure_status = COALESCE(closure_status, CASE WHEN closed_at IS NULL THEN 'OPEN' ELSE 'CLOSED' END), "
        "rework_cost = COALESCE(rework_cost, 0), "
        "scrap_cost = COALESCE(scrap_cost, 0), "
        "cost_impact = COALESCE(cost_impact, 0)"
      )
    )
    connection.execute(
      text("UPDATE customer_rejections SET attachment_refs = '[]' WHERE attachment_refs IS NULL")
    )
    connection.execute(
      text("ALTER TABLE IF EXISTS inventory_quality_inspections ADD COLUMN IF NOT EXISTS eligibility_status VARCHAR(40)")
    )
    connection.execute(
      text("ALTER TABLE IF EXISTS inventory_quality_inspections ADD COLUMN IF NOT EXISTS concession_reason TEXT")
    )
    connection.execute(
      text("ALTER TABLE IF EXISTS inventory_quality_inspections ADD COLUMN IF NOT EXISTS concession_approved_by VARCHAR(200)")
    )
    connection.execute(
      text("ALTER TABLE IF EXISTS inventory_quality_inspections ADD COLUMN IF NOT EXISTS concession_approved_at TIMESTAMP")
    )
    connection.execute(
      text("ALTER TABLE IF EXISTS item_master ADD COLUMN IF NOT EXISTS quality_profile JSONB")
    )
    connection.execute(text("ALTER TABLE IF EXISTS item_master DROP CONSTRAINT IF EXISTS item_master_item_code_key"))
    connection.execute(text("DROP INDEX IF EXISTS item_master_item_code_key"))
    connection.execute(
      text("CREATE UNIQUE INDEX IF NOT EXISTS uq_item_master_plant_code ON item_master (plant_id, item_code)")
    )
    connection.execute(
      text(
        "CREATE TABLE IF NOT EXISTS purchase_workbook_imports ("
        "id UUID PRIMARY KEY, "
        "plant_id VARCHAR(50) NOT NULL, "
        "source_name VARCHAR(120) NOT NULL, "
        "sheet_name VARCHAR(120) NOT NULL, "
        "fingerprint VARCHAR(64) NOT NULL, "
        "preview_json JSONB NOT NULL DEFAULT '{}'::jsonb, "
        "commit_json JSONB, "
        "posted_po_ids JSONB, "
        "ledger_posted BOOLEAN NOT NULL DEFAULT FALSE, "
        "created_by VARCHAR(200) NOT NULL, "
        "created_at TIMESTAMP, "
        "CONSTRAINT uq_purchase_workbook_plant_fingerprint UNIQUE (plant_id, fingerprint)"
        ")"
      )
    )
    connection.execute(
      text("ALTER TABLE IF EXISTS inventory_quality_inspections ADD COLUMN IF NOT EXISTS reasons JSONB DEFAULT '{}'::jsonb")
    )
    connection.execute(
      text("ALTER TABLE IF EXISTS inventory_quality_inspections ADD COLUMN IF NOT EXISTS evaluation JSONB DEFAULT '{}'::jsonb")
    )
    connection.execute(text("ALTER TABLE IF EXISTS inventory_quality_inspections DROP CONSTRAINT IF EXISTS ck_inventory_qc_status"))
    connection.execute(
      text(
        "ALTER TABLE IF EXISTS inventory_quality_inspections "
        "ADD CONSTRAINT ck_inventory_qc_status "
        "CHECK (status IN ('PENDING','PASS','FAIL','SKIPPED','INCOMPLETE','INVALID','NOT_REQUIRED'))"
      )
    )
    connection.execute(text("ALTER TABLE IF EXISTS purchase_receipt_lines DROP CONSTRAINT IF EXISTS ck_purchase_receipt_lines_qc_status"))
    connection.execute(
      text(
        "ALTER TABLE IF EXISTS purchase_receipt_lines "
        "ADD CONSTRAINT ck_purchase_receipt_lines_qc_status "
        "CHECK (qc_status IN ('PENDING','PASS','HOLD','NOT_REQUIRED'))"
      )
    )
    connection.execute(
      text(
        "CREATE TABLE IF NOT EXISTS purchase_line_schedules ("
        "id UUID PRIMARY KEY, "
        "plant_id VARCHAR(50) NOT NULL, "
        "purchase_order_line_id UUID NOT NULL REFERENCES purchase_order_lines(id), "
        "scheduled_qty DOUBLE PRECISION NOT NULL, "
        "promised_date DATE NOT NULL, "
        "current_expected_date DATE NOT NULL, "
        "confirmation_status VARCHAR(20) NOT NULL DEFAULT 'TENTATIVE', "
        "notes VARCHAR(500), "
        "created_by VARCHAR(200) NOT NULL, "
        "created_at TIMESTAMP, "
        "cancelled_at TIMESTAMP"
        ")"
      )
    )
    connection.execute(
      text(
        "CREATE TABLE IF NOT EXISTS receipt_schedule_allocations ("
        "id UUID PRIMARY KEY, "
        "plant_id VARCHAR(50) NOT NULL, "
        "receipt_line_id UUID NOT NULL REFERENCES purchase_receipt_lines(id), "
        "schedule_id UUID NOT NULL REFERENCES purchase_line_schedules(id), "
        "allocated_qty DOUBLE PRECISION NOT NULL, "
        "created_at TIMESTAMP"
        ")"
      )
    )
    connection.execute(
      text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_receipt_schedule_alloc_receipt_line "
        "ON receipt_schedule_allocations (receipt_line_id)"
      )
    )
    connection.execute(
      text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_receipt_schedule_alloc_pair "
        "ON receipt_schedule_allocations (receipt_line_id, schedule_id)"
      )
    )
    connection.execute(
      text("CREATE INDEX IF NOT EXISTS ix_purchase_line_schedules_line ON purchase_line_schedules (purchase_order_line_id)")
    )
    connection.execute(
      text("ALTER TABLE IF EXISTS purchase_line_schedules ADD COLUMN IF NOT EXISTS current_expected_date DATE")
    )
    connection.execute(
      text(
        "DO $$ BEGIN "
        "IF EXISTS ("
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name = 'purchase_line_schedules' AND column_name = 'current_date'"
        ") THEN "
        "UPDATE purchase_line_schedules "
        "SET current_expected_date = COALESCE(current_expected_date, \"current_date\", promised_date) "
        "WHERE current_expected_date IS NULL; "
        "END IF; "
        "END $$;"
      )
    )
    connection.execute(
      text(
        "UPDATE purchase_line_schedules "
        "SET current_expected_date = COALESCE(current_expected_date, promised_date) "
        "WHERE current_expected_date IS NULL"
      )
    )
    connection.execute(text('ALTER TABLE IF EXISTS purchase_line_schedules DROP COLUMN IF EXISTS "current_date"'))
    connection.execute(
      text("ALTER TABLE IF EXISTS inventory_quality_concessions ADD COLUMN IF NOT EXISTS released_entity_id UUID")
    )
    connection.execute(
      text("ALTER TABLE IF EXISTS inventory_quality_concessions ADD COLUMN IF NOT EXISTS residual_entity_id UUID")
    )
    connection.execute(
      text("ALTER TABLE IF EXISTS inventory_quality_concessions ADD COLUMN IF NOT EXISTS operation_id VARCHAR(120)")
    )
    connection.execute(
      text("CREATE INDEX IF NOT EXISTS ix_inventory_quality_concessions_operation ON inventory_quality_concessions (operation_id)")
    )
    connection.execute(
      text(
        "CREATE TABLE IF NOT EXISTS inventory_quality_holds ("
        "id UUID PRIMARY KEY, "
        "plant_id VARCHAR(50) NOT NULL, "
        "entity_type VARCHAR(40) NOT NULL, "
        "entity_id UUID NOT NULL, "
        "source_inspection_id UUID, "
        "quantity DOUBLE PRECISION NOT NULL DEFAULT 0, "
        "reason TEXT NOT NULL, "
        "status VARCHAR(20) NOT NULL DEFAULT 'HOLD', "
        "hold_kind VARCHAR(40) NOT NULL DEFAULT 'INSPECTION', "
        "created_by VARCHAR(200), "
        "released_by VARCHAR(200), "
        "created_at TIMESTAMP, "
        "released_at TIMESTAMP"
        ")"
      )
    )
    connection.execute(
      text("CREATE INDEX IF NOT EXISTS ix_inventory_quality_holds_entity ON inventory_quality_holds (entity_type, entity_id, status)")
    )


ensure_runtime_schema()


def backfill_fail_accept_concession_eligibility() -> dict[str, int]:
    """Classify pre-existing FAIL+ACCEPT inspections that never got a concession.

    Historical rows could be FAIL with disposition=ACCEPT and unrestricted stock
    because the inspection write path used to honor that shortcut. The concession
    model forbids rewriting those to PASS. This backfill is idempotent: it only
    touches rows whose eligibility_status is still null, marks them
    NEEDS_CONCESSION_REVIEW, and blocks linked UNRESTRICTED stock.
    """
    counts = {
        "inspections_marked": 0,
        "batches_blocked": 0,
        "reels_blocked": 0,
        "rejections_blocked": 0,
    }
    statements = [
        (
            "inspections_marked",
            """
            UPDATE inventory_quality_inspections
            SET eligibility_status = 'NEEDS_CONCESSION_REVIEW'
            WHERE status = 'FAIL'
              AND UPPER(COALESCE(disposition, '')) = 'ACCEPT'
              AND eligibility_status IS NULL
              AND concession_approved_at IS NULL
            """,
        ),
        (
            "batches_blocked",
            """
            UPDATE stock_batch AS batch
            SET stock_status = 'BLOCKED'
            FROM inventory_quality_inspections AS inspection
            WHERE inspection.entity_type = 'BATCH'
              AND inspection.entity_id = batch.id
              AND inspection.status = 'FAIL'
              AND UPPER(COALESCE(inspection.disposition, '')) = 'ACCEPT'
              AND inspection.eligibility_status = 'NEEDS_CONCESSION_REVIEW'
              AND inspection.concession_approved_at IS NULL
              AND batch.stock_status = 'UNRESTRICTED'
            """,
        ),
        (
            "reels_blocked",
            """
            UPDATE paper_reels AS reel
            SET stock_status = 'BLOCKED'
            FROM inventory_quality_inspections AS inspection
            WHERE inspection.entity_type = 'REEL'
              AND inspection.entity_id = reel.id
              AND inspection.status = 'FAIL'
              AND UPPER(COALESCE(inspection.disposition, '')) = 'ACCEPT'
              AND inspection.eligibility_status = 'NEEDS_CONCESSION_REVIEW'
              AND inspection.concession_approved_at IS NULL
              AND reel.stock_status = 'UNRESTRICTED'
            """,
        ),
        (
            "rejections_blocked",
            """
            UPDATE customer_rejections AS rejection
            SET status = 'BLOCKED'
            FROM inventory_quality_inspections AS inspection
            WHERE inspection.entity_type = 'CUSTOMER_REJECTION'
              AND inspection.entity_id = rejection.id
              AND inspection.status = 'FAIL'
              AND UPPER(COALESCE(inspection.disposition, '')) = 'ACCEPT'
              AND inspection.eligibility_status = 'NEEDS_CONCESSION_REVIEW'
              AND inspection.concession_approved_at IS NULL
              AND rejection.status = 'UNRESTRICTED'
            """,
        ),
    ]
    for key, statement in statements:
        try:
            with engine.begin() as connection:
                result = connection.execute(text(statement))
                counts[key] = int(result.rowcount or 0)
        except Exception as exc:  # pragma: no cover - defensive migration guard
            print(f"[schema-compat] skipped concession backfill {key}: {exc}")
    print(
        "[schema-compat] concession eligibility backfill: "
        f"inspections={counts['inspections_marked']} "
        f"batches={counts['batches_blocked']} "
        f"reels={counts['reels_blocked']} "
        f"rejections={counts['rejections_blocked']}"
    )
    return counts


backfill_fail_accept_concession_eligibility()


def seed_default_locations() -> None:
  """Seed practical store locations so inward screens never start with blank selects."""
  default_locations = (
    {
      "id": "00000000-0000-0000-0000-00000000aa01",
      "plant_id": "00000000-0000-0000-0000-0000000000a1",
      "code": "RM-A-01",
      "warehouse": "RAW MATERIAL STORE",
      "zone": "PAPER",
      "bin": "A1",
      "purpose": "STORAGE",
    },
    {
      "id": "00000000-0000-0000-0000-00000000aa02",
      "plant_id": "00000000-0000-0000-0000-0000000000a1",
      "code": "WIP-A-01",
      "warehouse": "PRODUCTION FLOOR",
      "zone": "WINDER",
      "bin": "WIP",
      "purpose": "WIP",
    },
    {
      "id": "00000000-0000-0000-0000-00000000aa03",
      "plant_id": "00000000-0000-0000-0000-0000000000a1",
      "code": "FG-A-01",
      "warehouse": "FINISHED GOODS",
      "zone": "DISPATCH",
      "bin": "FG",
      "purpose": "DISPATCH",
    },
    {
      "id": "00000000-0000-0000-0000-00000000bb01",
      "plant_id": "00000000-0000-0000-0000-0000000000b2",
      "code": "RM-B-01",
      "warehouse": "RAW MATERIAL STORE",
      "zone": "PAPER",
      "bin": "B1",
      "purpose": "STORAGE",
    },
    {
      "id": "00000000-0000-0000-0000-00000000bb02",
      "plant_id": "00000000-0000-0000-0000-0000000000b2",
      "code": "WIP-B-01",
      "warehouse": "PRODUCTION FLOOR",
      "zone": "WINDER",
      "bin": "WIP",
      "purpose": "WIP",
    },
    {
      "id": "00000000-0000-0000-0000-00000000bb03",
      "plant_id": "00000000-0000-0000-0000-0000000000b2",
      "code": "FG-B-01",
      "warehouse": "FINISHED GOODS",
      "zone": "DISPATCH",
      "bin": "FG",
      "purpose": "DISPATCH",
    },
  )
  upsert_sql = text(
    """
    INSERT INTO inventory_locations (
      id, plant_id, code, warehouse, zone, bin, purpose, active, created_at
    )
    VALUES (
      :id, :plant_id, :code, :warehouse, :zone, :bin, :purpose, 'true', NOW()
    )
    ON CONFLICT (plant_id, code) DO UPDATE SET
      warehouse = EXCLUDED.warehouse,
      zone = EXCLUDED.zone,
      bin = EXCLUDED.bin,
      purpose = EXCLUDED.purpose,
      active = 'true'
    """
  )
  with engine.begin() as connection:
    for location in default_locations:
      connection.execute(upsert_sql, location)


seed_default_locations()


def seed_default_quality_templates() -> None:
  """Seed editable QC parameter templates from the current client QC forms."""
  upsert_sql = text(
    """
    INSERT INTO inventory_quality_templates (
      id, plant_id, material_type, parameter_key, label, input_type, options,
      required, sort_order, active, created_at
    )
    VALUES (
      :id, 'GLOBAL', :material_type, :parameter_key, :label, :input_type,
      CAST(:options AS JSON), :required, :sort_order, 'true', NOW()
    )
    ON CONFLICT (plant_id, material_type, parameter_key) DO UPDATE SET
      label = EXCLUDED.label,
      input_type = EXCLUDED.input_type,
      options = EXCLUDED.options,
      required = EXCLUDED.required,
      sort_order = EXCLUDED.sort_order,
      active = 'true'
    """
  )
  with engine.begin() as connection:
    for preset in QC_TEMPLATE_PRESETS:
      connection.execute(
        upsert_sql,
        {
          "id": str(uuid.uuid4()),
          "material_type": preset["material_type"],
          "parameter_key": preset["parameter_key"],
          "label": preset["label"],
          "input_type": preset["input_type"],
          "options": json.dumps(preset.get("options") or []),
          "required": bool(preset.get("required")),
          "sort_order": preset.get("sort_order") or 0,
        },
      )


seed_default_quality_templates()

app = FastAPI(
  title="Hari Om Paper Inventory Service",
  description="Inventory, inward, issue, reservation, and dispatch material control",
  version="1.0.0",
)

app.include_router(items.router)
app.include_router(labels.router)
app.include_router(inward.router)
app.include_router(issue.router)
app.include_router(balance.router)
app.include_router(ledger.router)
app.include_router(fg_inward.router)
app.include_router(dispatch.router)
app.include_router(reservations.router)
app.include_router(locations.router)
app.include_router(purchase.router)
app.include_router(quality.router)
app.include_router(reels.router)
app.include_router(reel_issues.router)
app.include_router(stock_moves.router)
app.include_router(health.router)
app.include_router(valuation.router)
app.include_router(stock_control.router)
app.include_router(tool_assets.router)


@app.get("/")
def root():
  return {"service": "inventory-service", "status": "healthy"}


@app.get("/health")
def health():
  return {"service": "inventory-service", "status": "healthy"}
