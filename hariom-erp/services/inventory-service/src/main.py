import uuid

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .database import Base, engine
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
    stock_moves,
    valuation,
)

Base.metadata.create_all(bind=engine)


def ensure_runtime_schema() -> None:
  with engine.begin() as connection:
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
        "CREATE INDEX IF NOT EXISTS ix_stock_transaction_effective_date "
        "ON stock_transaction (effective_date)"
      )
    )
    connection.execute(
      text("UPDATE stock_transaction SET stock_status = 'UNRESTRICTED' WHERE stock_status IS NULL")
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
      "ALTER TABLE IF EXISTS inventory_certifications ADD COLUMN IF NOT EXISTS count_session_no VARCHAR(80)",
      "ALTER TABLE IF EXISTS inventory_certifications ADD COLUMN IF NOT EXISTS count_location_scope VARCHAR(200)",
      "ALTER TABLE IF EXISTS inventory_certifications ADD COLUMN IF NOT EXISTS count_state VARCHAR(30) DEFAULT 'DRAFT'",
      "ALTER TABLE IF EXISTS inventory_certifications ADD COLUMN IF NOT EXISTS attachment_refs JSONB DEFAULT '[]'::jsonb",
      "ALTER TABLE IF EXISTS inventory_certifications ADD COLUMN IF NOT EXISTS counted_by VARCHAR(200)",
      "ALTER TABLE IF EXISTS inventory_certifications ADD COLUMN IF NOT EXISTS checked_by VARCHAR(200)",
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


ensure_runtime_schema()


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
  presets = (
    ("ADHESIVE", "viscosity", "Viscosity", "number", "[]", True, 10),
    ("ADHESIVE", "temperature", "Temperature", "number", "[]", True, 20),
    ("ADHESIVE", "solid_content", "Solid Content", "number", "[]", True, 30),
    ("ADHESIVE", "color", "Color", "text", "[]", True, 40),
    ("ADHESIVE", "ph", "PH", "number", "[]", True, 50),
    ("PARCHMENT", "color_bleeding", "Color Bleeding", "select", '["PASS","FAIL"]', True, 10),
    ("PARCHMENT", "gsm", "GSM", "number", "[]", True, 20),
    ("PARCHMENT", "bf", "BF", "number", "[]", True, 30),
    ("RAW_PAPER", "gsm", "GSM", "number", "[]", True, 10),
    ("RAW_PAPER", "bs", "BS", "number", "[]", False, 20),
    ("RAW_PAPER", "bf", "BF", "number", "[]", True, 30),
    ("RAW_PAPER", "caliper_mm", "Caliper (mm)", "number", "[]", False, 40),
    ("RAW_PAPER", "bulk", "Bulk", "number", "[]", False, 50),
    ("RAW_PAPER", "ply_bond", "Ply Bond", "number", "[]", False, 60),
    ("RAW_PAPER", "rct", "RCT", "number", "[]", False, 70),
    ("RAW_PAPER", "cobb", "COBB", "number", "[]", False, 80),
    ("RAW_PAPER", "moisture_pct", "Moisture %", "number", "[]", True, 90),
    ("RAW_PAPER", "clear_for_slitting", "Clear For Slitting", "select", '["YES","NO","HOLD"]', True, 100),
    ("FINISHED_GOOD", "visual_defect", "Visual Defect", "text", "[]", False, 10),
    ("FINISHED_GOOD", "reject_reason", "Reject Reason", "text", "[]", True, 20),
    ("FINISHED_GOOD", "rework_possible", "Rework Possible", "select", '["YES","NO"]', True, 30),
  )
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
    for material_type, key, label, input_type, options, required, sort_order in presets:
      connection.execute(
        upsert_sql,
        {
          "id": str(uuid.uuid4()),
          "material_type": material_type,
          "parameter_key": key,
          "label": label,
          "input_type": input_type,
          "options": options,
          "required": required,
          "sort_order": sort_order,
        },
      )


seed_default_quality_templates()

app = FastAPI(
  title="Hari Om Paper Inventory Service",
  description="Inventory, inward, issue, reservation, and dispatch material control",
  version="1.0.0",
)

app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
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


@app.get("/")
def root():
  return {"service": "inventory-service", "status": "healthy"}


@app.get("/health")
def health():
  return {"service": "inventory-service", "status": "healthy"}
