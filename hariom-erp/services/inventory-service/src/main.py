from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .database import Base, engine
from .routers import balance, dispatch, fg_inward, inward, issue, items, ledger, reservations

Base.metadata.create_all(bind=engine)


def ensure_runtime_schema() -> None:
  with engine.begin() as connection:
    for table_name in ("item_master", "stock_batch", "stock_transaction", "reservations"):
      connection.execute(text(f"ALTER TABLE IF EXISTS {table_name} ALTER COLUMN plant_id DROP DEFAULT"))
      connection.execute(
        text(
          f"ALTER TABLE IF EXISTS {table_name} "
          "ALTER COLUMN plant_id TYPE VARCHAR(50) USING plant_id::text"
        )
      )
      connection.execute(text(f"ALTER TABLE IF EXISTS {table_name} ALTER COLUMN plant_id SET DEFAULT 'PLANT_A'"))


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


@app.get("/")
def root():
  return {"service": "inventory-service", "status": "healthy"}


@app.get("/health")
def health():
  return {"service": "inventory-service", "status": "healthy"}
