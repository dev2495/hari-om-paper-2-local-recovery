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
