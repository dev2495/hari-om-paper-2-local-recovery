from fastapi import FastAPI
from sqlalchemy import text

from .database import engine
from . import models
from .routers import calculations, recipes, spec_fields, specs, trials


app = FastAPI(
    title="Hari Om Paper ERP - Spec Service",
    description="Specification sheet, recipe versioning, and approval workflows",
    version="1.0.0",
)

app.include_router(specs.router)
app.include_router(spec_fields.router)
app.include_router(recipes.router)
app.include_router(trials.router)
app.include_router(calculations.router)

models.Base.metadata.create_all(bind=engine)


def ensure_runtime_schema() -> None:
    with engine.begin() as connection:
        for table_name in (
            "specification_sheet",
            "recipe_header",
            "spec_dynamic_fields",
        ):
            connection.execute(text(f"ALTER TABLE IF EXISTS {table_name} ALTER COLUMN plant_id DROP DEFAULT"))
            connection.execute(
                text(
                    f"ALTER TABLE IF EXISTS {table_name} "
                    "ALTER COLUMN plant_id TYPE VARCHAR(50) USING plant_id::text"
                )
            )
            connection.execute(
                text(f"ALTER TABLE IF EXISTS {table_name} ALTER COLUMN plant_id SET DEFAULT 'PLANT_A'")
            )
        connection.execute(
            text(
                "ALTER TABLE IF EXISTS spec_dynamic_field_values "
                "ALTER COLUMN value TYPE TEXT"
            )
        )
        connection.execute(
            text(
                "ALTER TABLE IF EXISTS recipe_layers "
                "ALTER COLUMN gsm_snapshot TYPE DOUBLE PRECISION USING gsm_snapshot::double precision"
            )
        )
        connection.execute(
            text(
                "ALTER TABLE IF EXISTS recipe_layers "
                "ALTER COLUMN bf_snapshot TYPE DOUBLE PRECISION USING bf_snapshot::double precision"
            )
        )
        connection.execute(
            text(
                "ALTER TABLE IF EXISTS specification_sheet "
                "ADD COLUMN IF NOT EXISTS adhesive_percent DOUBLE PRECISION DEFAULT 15.0"
            )
        )
        connection.execute(
            text(
                "ALTER TABLE IF EXISTS specification_sheet "
                "ADD COLUMN IF NOT EXISTS moisture_loss_percent DOUBLE PRECISION DEFAULT 9.0"
            )
        )
        connection.execute(
            text(
                "ALTER TABLE IF EXISTS specification_sheet "
                "ADD COLUMN IF NOT EXISTS parchment_allowed BOOLEAN DEFAULT TRUE"
            )
        )
        connection.execute(
            text(
                "UPDATE specification_sheet SET adhesive_percent = 15.0 WHERE adhesive_percent IS NULL"
            )
        )
        connection.execute(
            text(
                "UPDATE specification_sheet SET moisture_loss_percent = 9.0 WHERE moisture_loss_percent IS NULL"
            )
        )
        connection.execute(
            text(
                "UPDATE specification_sheet SET parchment_allowed = TRUE WHERE parchment_allowed IS NULL"
            )
        )
        connection.execute(
            text(
                "ALTER TABLE IF EXISTS recipe_layers "
                "ADD COLUMN IF NOT EXISTS bulk_snapshot DOUBLE PRECISION"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE IF NOT EXISTS global_spec_defaults ("
                "id UUID PRIMARY KEY,"
                "plant_id VARCHAR(50) NOT NULL UNIQUE,"
                "adhesive_percent DOUBLE PRECISION NOT NULL DEFAULT 15.0,"
                "parchment_percent DOUBLE PRECISION NOT NULL DEFAULT 1.5,"
                "moisture_loss_percent DOUBLE PRECISION NOT NULL DEFAULT 9.0,"
                "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
                ")"
            )
        )
        connection.execute(
            text(
                "ALTER TABLE IF EXISTS global_spec_defaults "
                "ADD COLUMN IF NOT EXISTS adhesive_percent DOUBLE PRECISION DEFAULT 15.0"
            )
        )
        connection.execute(
            text(
                "ALTER TABLE IF EXISTS global_spec_defaults "
                "ADD COLUMN IF NOT EXISTS parchment_percent DOUBLE PRECISION DEFAULT 1.5"
            )
        )
        connection.execute(
            text(
                "ALTER TABLE IF EXISTS global_spec_defaults "
                "ADD COLUMN IF NOT EXISTS moisture_loss_percent DOUBLE PRECISION DEFAULT 9.0"
            )
        )


ensure_runtime_schema()


@app.get("/")
async def root() -> dict[str, object]:
    return {
        "service": "spec-service",
        "status": "healthy",
        "version": "1.0.0",
        "endpoints": [
            "/specs",
            "/spec-fields",
            "/recipes",
            "/trials",
            "/calculate",
        ],
    }


@app.get("/health")
async def health() -> dict[str, str]:
    return {"service": "spec-service", "status": "healthy"}
