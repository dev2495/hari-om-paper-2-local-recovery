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
    reel_issues,
    reels,
    reservations,
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
      text("UPDATE stock_batch SET stock_status = 'UNRESTRICTED' WHERE stock_status IS NULL")
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
      text("UPDATE paper_reels SET stock_status = 'UNRESTRICTED' WHERE stock_status IS NULL")
    )


ensure_runtime_schema()

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
app.include_router(reels.router)
app.include_router(reel_issues.router)
app.include_router(stock_moves.router)
app.include_router(health.router)
app.include_router(valuation.router)


@app.get("/")
def root():
  return {"service": "inventory-service", "status": "healthy"}


@app.get("/health")
def health():
  return {"service": "inventory-service", "status": "healthy"}
