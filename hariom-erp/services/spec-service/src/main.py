from fastapi import FastAPI
from sqlalchemy import text

from .database import engine
from . import models, season_models
from .routers import calculations, recipes, spec_fields, specs, trials, seasonal


app = FastAPI(
    title="Hari Om Paper ERP - Spec Service",
    description="Specification sheet, recipe versioning, and approval workflows",
    version="1.0.0",
)

app.include_router(seasonal.router)
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
                "ADD COLUMN IF NOT EXISTS adhesive_percent DOUBLE PRECISION DEFAULT 12.5"
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
                "UPDATE specification_sheet SET adhesive_percent = 12.5 WHERE adhesive_percent IS NULL"
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
                "adhesive_percent DOUBLE PRECISION NOT NULL DEFAULT 12.5,"
                "parchment_percent DOUBLE PRECISION NOT NULL DEFAULT 1.5,"
                "moisture_loss_percent DOUBLE PRECISION NOT NULL DEFAULT 9.0,"
                "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
                ")"
            )
        )
        connection.execute(
            text(
                "ALTER TABLE IF EXISTS global_spec_defaults "
                "ADD COLUMN IF NOT EXISTS adhesive_percent DOUBLE PRECISION DEFAULT 12.5"
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
        connection.execute(
            text(
                "ALTER TABLE IF EXISTS specification_sheet ALTER COLUMN adhesive_percent SET DEFAULT 12.5"
            )
        )
        connection.execute(
            text(
                "ALTER TABLE IF EXISTS global_spec_defaults ALTER COLUMN adhesive_percent SET DEFAULT 12.5"
            )
        )
        connection.execute(
            text(
                "ALTER TABLE IF EXISTS specification_sheet "
                "ADD COLUMN IF NOT EXISTS qc_profile JSON"
            )
        )
        connection.execute(
            text(
                "ALTER TABLE IF EXISTS specification_sheet "
                "ADD COLUMN IF NOT EXISTS write_revision INTEGER DEFAULT 1"
            )
        )
        connection.execute(
            text(
                "UPDATE specification_sheet SET write_revision = 1 WHERE write_revision IS NULL"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE IF NOT EXISTS spec_save_operations ("
                "id UUID PRIMARY KEY,"
                "plant_id VARCHAR(50) NOT NULL,"
                "operation_key VARCHAR(120) NOT NULL,"
                "payload_fingerprint VARCHAR(64) NOT NULL,"
                "spec_id UUID NOT NULL,"
                "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,"
                "UNIQUE (plant_id, operation_key)"
                ")"
            )
        )


ensure_runtime_schema()

with engine.begin() as connection:
    for sql in (
        "ALTER TABLE season_release_authorizations ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'AUTHORIZED'",
        "ALTER TABLE season_release_authorizations ADD COLUMN IF NOT EXISTS job_card_id UUID",
        "ALTER TABLE season_release_authorizations ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMP",
        "ALTER TABLE specification_sheet ADD COLUMN IF NOT EXISTS lineage_id UUID",
        "ALTER TABLE specification_sheet ADD COLUMN IF NOT EXISTS supersedes_spec_id UUID",
        "ALTER TABLE specification_sheet ADD COLUMN IF NOT EXISTS mandrel_diameter_mm DOUBLE PRECISION",
        "ALTER TABLE specification_sheet ADD COLUMN IF NOT EXISTS seasonal_model BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE specification_sheet ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
        "ALTER TABLE recipe_header ADD COLUMN IF NOT EXISTS season VARCHAR(12) NOT NULL DEFAULT 'ROY'",
        "ALTER TABLE recipe_header ADD COLUMN IF NOT EXISTS lineage_id UUID",
        "ALTER TABLE recipe_header ADD COLUMN IF NOT EXISTS season_revision INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE recipe_header ADD COLUMN IF NOT EXISTS predecessor_id UUID",
        "ALTER TABLE recipe_header ADD COLUMN IF NOT EXISTS copied_from_id UUID",
        "ALTER TABLE recipe_header ADD COLUMN IF NOT EXISTS sheet_rows JSON",
        "ALTER TABLE recipe_header ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64)",
        "ALTER TABLE recipe_header ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE recipe_header ADD COLUMN IF NOT EXISTS change_note TEXT",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_recipe_lineage_season_revision ON recipe_header(lineage_id,season,season_revision) WHERE lineage_id IS NOT NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_qc_season_published ON season_qc_rule_versions(scope_id,season) WHERE status='PUBLISHED'",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_qc_season_draft ON season_qc_rule_versions(scope_id,season) WHERE status='DRAFT'",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_qc_overlay_published ON season_qc_overlay_versions(plant_id,target_type,target_id,season) WHERE status='PUBLISHED'",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_qc_overlay_draft ON season_qc_overlay_versions(plant_id,target_type,target_id,season) WHERE status='DRAFT'",
    ):
        connection.execute(text(sql))


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
