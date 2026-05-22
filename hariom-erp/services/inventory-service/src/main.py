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
    ledger,
    locations,
    purchase,
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
app.include_router(inward.router)
app.include_router(issue.router)
app.include_router(balance.router)
app.include_router(ledger.router)
app.include_router(fg_inward.router)
app.include_router(dispatch.router)
app.include_router(reservations.router)
app.include_router(locations.router)
app.include_router(purchase.router)
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
