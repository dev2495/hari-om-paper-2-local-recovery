from fastapi import FastAPI
from sqlalchemy import text

from . import models
from .database import engine
from .routers import adhesive, contact_directory, customer, machine, mandrel, packaging, paper, parchment, supplier, tool, tube_size

app = FastAPI(
    title="Hari Om Paper ERP - Master Data Service",
    description="Manages all static reference data for the ERP system",
    version="1.0.0",
)

app.include_router(paper.router)
app.include_router(adhesive.router)
app.include_router(parchment.router)
app.include_router(tube_size.router)
app.include_router(mandrel.router)
app.include_router(customer.router)
app.include_router(supplier.router)
app.include_router(contact_directory.router)
app.include_router(machine.router)
app.include_router(packaging.router)
app.include_router(tool.router)

# Base table creation for fresh environments.
models.Base.metadata.create_all(bind=engine)


def _ensure_schema_compatibility() -> None:
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE customer ADD COLUMN IF NOT EXISTS billing_address VARCHAR(500)"))
        connection.execute(text("ALTER TABLE customer ADD COLUMN IF NOT EXISTS shipping_address VARCHAR(500)"))
        connection.execute(text("ALTER TABLE customer ADD COLUMN IF NOT EXISTS tax_id VARCHAR(100)"))
        connection.execute(text("ALTER TABLE customer ADD COLUMN IF NOT EXISTS dispatch_contact_name VARCHAR(200)"))
        connection.execute(text("ALTER TABLE customer ADD COLUMN IF NOT EXISTS dispatch_contact_phone VARCHAR(50)"))
        connection.execute(text("ALTER TABLE customer ADD COLUMN IF NOT EXISTS address VARCHAR(500)"))
        connection.execute(text("ALTER TABLE customer ADD COLUMN IF NOT EXISTS pan_no VARCHAR(50)"))
        connection.execute(text("ALTER TABLE customer ADD COLUMN IF NOT EXISTS gst_no VARCHAR(50)"))
        connection.execute(text("ALTER TABLE customer ADD COLUMN IF NOT EXISTS primary_contact_name VARCHAR(200)"))
        connection.execute(text("ALTER TABLE customer ADD COLUMN IF NOT EXISTS primary_contact_phone VARCHAR(50)"))
        connection.execute(text("ALTER TABLE customer ADD COLUMN IF NOT EXISTS primary_contact_email VARCHAR(200)"))

        connection.execute(text("UPDATE customer SET address = COALESCE(address, billing_address, shipping_address)"))
        connection.execute(text("UPDATE customer SET gst_no = COALESCE(gst_no, tax_id)"))
        connection.execute(text("UPDATE customer SET primary_contact_name = COALESCE(primary_contact_name, dispatch_contact_name)"))
        connection.execute(text("UPDATE customer SET primary_contact_phone = COALESCE(primary_contact_phone, dispatch_contact_phone, contact_phone)"))
        connection.execute(text("UPDATE customer SET primary_contact_email = COALESCE(primary_contact_email, contact_email)"))

        connection.execute(text("ALTER TABLE customer DROP CONSTRAINT IF EXISTS customer_customer_code_key"))
        connection.execute(text("ALTER TABLE customer DROP CONSTRAINT IF EXISTS customer_name_key"))
        connection.execute(text("DROP INDEX IF EXISTS customer_customer_code_key"))
        connection.execute(text("DROP INDEX IF EXISTS customer_name_key"))
        connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_plant_code ON customer (plant_id, customer_code)"))
        connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_plant_name ON customer (plant_id, name)"))

        connection.execute(text("ALTER TABLE adhesive_master DROP CONSTRAINT IF EXISTS adhesive_master_name_key"))
        connection.execute(text("ALTER TABLE adhesive_master DROP CONSTRAINT IF EXISTS adhesive_master_internal_code_key"))
        connection.execute(text("DROP INDEX IF EXISTS adhesive_master_name_key"))
        connection.execute(text("DROP INDEX IF EXISTS adhesive_master_internal_code_key"))
        connection.execute(text("ALTER TABLE adhesive_master ADD COLUMN IF NOT EXISTS variety VARCHAR(100)"))
        connection.execute(text("ALTER TABLE adhesive_master ADD COLUMN IF NOT EXISTS solid_content_percent DOUBLE PRECISION"))
        connection.execute(text("ALTER TABLE adhesive_master ADD COLUMN IF NOT EXISTS viscosity DOUBLE PRECISION"))
        connection.execute(text("ALTER TABLE adhesive_master ADD COLUMN IF NOT EXISTS ph DOUBLE PRECISION"))
        connection.execute(text("ALTER TABLE adhesive_master ADD COLUMN IF NOT EXISTS color VARCHAR(50)"))
        connection.execute(text("ALTER TABLE adhesive_master ADD COLUMN IF NOT EXISTS recipe_text TEXT"))
        connection.execute(text("UPDATE adhesive_master SET variety = COALESCE(variety, name)"))
        connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_adhesive_plant_name ON adhesive_master (plant_id, name)"))
        connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_adhesive_plant_code ON adhesive_master (plant_id, internal_code)"))

        connection.execute(text("ALTER TABLE paper_master DROP CONSTRAINT IF EXISTS uq_paper_plant_code"))
        connection.execute(text("DROP INDEX IF EXISTS uq_paper_plant_code"))
        connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_paper_plant_code ON paper_master (plant_id, code) WHERE code IS NOT NULL"))

        # Paper master: allow decimal GSM (previously Integer). Safe if already DOUBLE PRECISION.
        connection.execute(
            text("ALTER TABLE paper_master ALTER COLUMN gsm TYPE DOUBLE PRECISION USING gsm::double precision")
        )

        # Mandrel OD tolerance (±0.1 mm default) — needed by spec-sheet ID readout.
        connection.execute(text("ALTER TABLE mandrel ADD COLUMN IF NOT EXISTS od_tolerance_mm DOUBLE PRECISION DEFAULT 0.1"))
        connection.execute(text("UPDATE mandrel SET od_tolerance_mm = 0.1 WHERE od_tolerance_mm IS NULL"))
        connection.execute(text("ALTER TABLE mandrel ALTER COLUMN od_tolerance_mm SET NOT NULL"))
        connection.execute(text("ALTER TABLE mandrel DROP CONSTRAINT IF EXISTS mandrel_mandrel_code_key"))
        connection.execute(text("ALTER TABLE mandrel DROP CONSTRAINT IF EXISTS uq_mandrel_plant_code"))
        connection.execute(text("DROP INDEX IF EXISTS uq_mandrel_plant_code"))
        connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_mandrel_plant_code ON mandrel (plant_id, mandrel_code)"))

        connection.execute(text("ALTER TABLE machine ADD COLUMN IF NOT EXISTS code VARCHAR(50)"))
        connection.execute(text("ALTER TABLE machine ADD COLUMN IF NOT EXISTS capacity_type VARCHAR(40)"))
        connection.execute(text("ALTER TABLE machine ADD COLUMN IF NOT EXISTS capacity_value DOUBLE PRECISION"))
        connection.execute(text("ALTER TABLE machine ADD COLUMN IF NOT EXISTS batch_bamboo_capacity DOUBLE PRECISION"))
        connection.execute(text("ALTER TABLE machine ADD COLUMN IF NOT EXISTS cycle_time_hours DOUBLE PRECISION"))
        connection.execute(text("ALTER TABLE machine ADD COLUMN IF NOT EXISTS id_min_mm DOUBLE PRECISION"))
        connection.execute(text("ALTER TABLE machine ADD COLUMN IF NOT EXISTS id_max_mm DOUBLE PRECISION"))
        connection.execute(text("ALTER TABLE machine ADD COLUMN IF NOT EXISTS od_min_mm DOUBLE PRECISION"))
        connection.execute(text("ALTER TABLE machine ADD COLUMN IF NOT EXISTS od_max_mm DOUBLE PRECISION"))
        connection.execute(text("ALTER TABLE machine ADD COLUMN IF NOT EXISTS length_min_mm DOUBLE PRECISION"))
        connection.execute(text("ALTER TABLE machine ADD COLUMN IF NOT EXISTS length_max_mm DOUBLE PRECISION"))
        connection.execute(text("ALTER TABLE machine ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE"))
        connection.execute(text("ALTER TABLE machine ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE"))
        connection.execute(
            text(
                "UPDATE machine SET code = COALESCE(code, regexp_replace(upper(COALESCE(name, 'MACHINE')), '\\s+', '_', 'g'))"
            )
        )
        connection.execute(text("UPDATE machine SET capacity_type = COALESCE(capacity_type, 'TUBES_PER_DAY')"))
        connection.execute(text("UPDATE machine SET capacity_value = COALESCE(capacity_value, 0.0)"))
        connection.execute(text("UPDATE machine SET batch_bamboo_capacity = COALESCE(batch_bamboo_capacity, 500.0) WHERE department = 'OVEN'"))
        connection.execute(text("UPDATE machine SET cycle_time_hours = COALESCE(cycle_time_hours, 5.5) WHERE department = 'OVEN'"))
        connection.execute(text("UPDATE machine SET id_min_mm = COALESCE(id_min_mm, 0.0)"))
        connection.execute(text("UPDATE machine SET id_max_mm = COALESCE(id_max_mm, 0.0)"))
        connection.execute(text("UPDATE machine SET od_min_mm = COALESCE(od_min_mm, 0.0)"))
        connection.execute(text("UPDATE machine SET od_max_mm = COALESCE(od_max_mm, 0.0)"))
        connection.execute(text("UPDATE machine SET length_min_mm = COALESCE(length_min_mm, 0.0)"))
        connection.execute(text("UPDATE machine SET length_max_mm = COALESCE(length_max_mm, 0.0)"))
        connection.execute(text("UPDATE machine SET is_active = COALESCE(is_active, active, TRUE)"))
        connection.execute(text("UPDATE machine SET active = COALESCE(active, is_active, TRUE)"))
        connection.execute(text("ALTER TABLE machine DROP CONSTRAINT IF EXISTS machine_name_key"))
        connection.execute(text("DROP INDEX IF EXISTS machine_name_key"))
        connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_machine_plant_code ON machine (plant_id, code)"))
        connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_machine_plant_name ON machine (plant_id, name)"))
        connection.execute(text("ALTER TABLE machine DROP CONSTRAINT IF EXISTS ck_machine_capacity_type"))
        connection.execute(
            text(
                "UPDATE machine "
                "SET capacity_value = capacity_value * 1.56, capacity_type = 'METERS_PER_DAY' "
                "WHERE department = 'WINDER' AND capacity_type = 'BAMBOOS_PER_DAY'"
            )
        )
        connection.execute(
            text(
                "ALTER TABLE machine ADD CONSTRAINT ck_machine_capacity_type "
                "CHECK (capacity_type IN ('REELS_PER_DAY','BAMBOOS_PER_DAY','METERS_PER_DAY','BATCHES_PER_DAY','TUBES_PER_DAY'))"
            )
        )

        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS machine_supported_mandrel (
                    id UUID PRIMARY KEY,
                    machine_id UUID NOT NULL REFERENCES machine(id) ON DELETE CASCADE,
                    mandrel_id UUID NOT NULL REFERENCES mandrel(id) ON DELETE CASCADE,
                    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
                )
                """
            )
        )
        connection.execute(
            text("CREATE UNIQUE INDEX IF NOT EXISTS uq_machine_supported_mandrel_pair ON machine_supported_mandrel (machine_id, mandrel_id)")
        )
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_machine_supported_mandrel_machine_id ON machine_supported_mandrel (machine_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_machine_supported_mandrel_mandrel_id ON machine_supported_mandrel (mandrel_id)"))

        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS customer_contact (
                    id UUID PRIMARY KEY,
                    customer_id UUID NOT NULL REFERENCES customer(id),
                    department VARCHAR(100) NOT NULL,
                    contact_name VARCHAR(200) NOT NULL,
                    contact_phone VARCHAR(50),
                    contact_email VARCHAR(200),
                    notes TEXT,
                    plant_id VARCHAR(50) NOT NULL,
                    active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
                )
                """
            )
        )
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_customer_contact_customer_id ON customer_contact (customer_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_customer_contact_plant_id ON customer_contact (plant_id)"))
        connection.execute(
            text(
                """
                INSERT INTO customer_contact (
                    id, customer_id, department, contact_name, contact_phone, contact_email,
                    notes, plant_id, active, created_at
                )
                SELECT
                    (
                        substr(md5(customer.id::text || '-primary'), 1, 8) || '-' ||
                        substr(md5(customer.id::text || '-primary'), 9, 4) || '-' ||
                        substr(md5(customer.id::text || '-primary'), 13, 4) || '-' ||
                        substr(md5(customer.id::text || '-primary'), 17, 4) || '-' ||
                        substr(md5(customer.id::text || '-primary'), 21, 12)
                    )::uuid,
                    customer.id,
                    'General',
                    COALESCE(NULLIF(customer.primary_contact_name, ''), customer.name),
                    COALESCE(NULLIF(customer.primary_contact_phone, ''), NULLIF(customer.contact_phone, '')),
                    COALESCE(NULLIF(customer.primary_contact_email, ''), NULLIF(customer.contact_email, '')),
                    NULL,
                    customer.plant_id,
                    TRUE,
                    NOW()
                FROM customer
                WHERE NOT EXISTS (
                    SELECT 1 FROM customer_contact
                    WHERE customer_contact.customer_id = customer.id
                    AND customer_contact.active = TRUE
                )
                AND (
                    NULLIF(customer.primary_contact_name, '') IS NOT NULL
                    OR NULLIF(customer.primary_contact_phone, '') IS NOT NULL
                    OR NULLIF(customer.primary_contact_email, '') IS NOT NULL
                    OR NULLIF(customer.contact_phone, '') IS NOT NULL
                    OR NULLIF(customer.contact_email, '') IS NOT NULL
                )
                ON CONFLICT (id) DO NOTHING
                """
            )
        )

        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS supplier (
                    id UUID PRIMARY KEY,
                    supplier_code VARCHAR(50) NOT NULL,
                    name VARCHAR(200) NOT NULL,
                    category VARCHAR(80) NOT NULL DEFAULT 'RAW_MATERIAL',
                    contact_name VARCHAR(200),
                    contact_phone VARCHAR(50),
                    contact_email VARCHAR(200),
                    gst_no VARCHAR(50),
                    pan_no VARCHAR(50),
                    address VARCHAR(500),
                    plant_id VARCHAR(50) NOT NULL,
                    active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
                )
                """
            )
        )
        connection.execute(text("ALTER TABLE supplier ADD COLUMN IF NOT EXISTS pan_no VARCHAR(50)"))
        connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_plant_code ON supplier (plant_id, supplier_code)"))
        connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_plant_name ON supplier (plant_id, name)"))
        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS supplier_contact (
                    id UUID PRIMARY KEY,
                    supplier_id UUID NOT NULL REFERENCES supplier(id),
                    department VARCHAR(100) NOT NULL DEFAULT 'General',
                    contact_name VARCHAR(200) NOT NULL,
                    contact_phone VARCHAR(50),
                    contact_email VARCHAR(200),
                    notes TEXT,
                    plant_id VARCHAR(50) NOT NULL,
                    active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
                )
                """
            )
        )
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_supplier_contact_supplier_id ON supplier_contact (supplier_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_supplier_contact_plant_id ON supplier_contact (plant_id)"))
        connection.execute(
            text(
                """
                INSERT INTO supplier_contact (
                    id, supplier_id, department, contact_name, contact_phone, contact_email,
                    notes, plant_id, active, created_at
                )
                SELECT
                    (
                        substr(md5(supplier.id::text || '-primary'), 1, 8) || '-' ||
                        substr(md5(supplier.id::text || '-primary'), 9, 4) || '-' ||
                        substr(md5(supplier.id::text || '-primary'), 13, 4) || '-' ||
                        substr(md5(supplier.id::text || '-primary'), 17, 4) || '-' ||
                        substr(md5(supplier.id::text || '-primary'), 21, 12)
                    )::uuid,
                    supplier.id,
                    'General',
                    COALESCE(NULLIF(supplier.contact_name, ''), supplier.name),
                    NULLIF(supplier.contact_phone, ''),
                    NULLIF(supplier.contact_email, ''),
                    NULL,
                    supplier.plant_id,
                    TRUE,
                    NOW()
                FROM supplier
                WHERE NOT EXISTS (
                    SELECT 1 FROM supplier_contact
                    WHERE supplier_contact.supplier_id = supplier.id
                    AND supplier_contact.active = TRUE
                )
                AND (
                    NULLIF(supplier.contact_name, '') IS NOT NULL
                    OR NULLIF(supplier.contact_phone, '') IS NOT NULL
                    OR NULLIF(supplier.contact_email, '') IS NOT NULL
                )
                ON CONFLICT (id) DO NOTHING
                """
            )
        )

        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS packaging_box (
                    id UUID PRIMARY KEY,
                    code VARCHAR(50) NOT NULL,
                    length_mm DOUBLE PRECISION NOT NULL,
                    width_mm DOUBLE PRECISION NOT NULL,
                    height_mm DOUBLE PRECISION NOT NULL,
                    size_label VARCHAR(120) NOT NULL,
                    weight_kg DOUBLE PRECISION,
                    rate_per_piece DOUBLE PRECISION,
                    plant_id VARCHAR(50) NOT NULL,
                    active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS packaging_plastic_sheet (
                    id UUID PRIMARY KEY,
                    sku VARCHAR(50) NOT NULL,
                    size_label VARCHAR(120) NOT NULL,
                    weight_kg DOUBLE PRECISION,
                    rate_per_kg DOUBLE PRECISION,
                    rate_per_piece DOUBLE PRECISION,
                    plant_id VARCHAR(50) NOT NULL,
                    active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS packaging_fadda (
                    id UUID PRIMARY KEY,
                    sku VARCHAR(50) NOT NULL,
                    weight_kg DOUBLE PRECISION,
                    rate_per_kg DOUBLE PRECISION,
                    rate_per_piece DOUBLE PRECISION,
                    plant_id VARCHAR(50) NOT NULL,
                    active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
                )
                """
            )
        )
        connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_packaging_box_plant_code ON packaging_box (plant_id, code)"))
        connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_packaging_plastic_plant_sku ON packaging_plastic_sheet (plant_id, sku)"))
        connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_packaging_fadda_plant_sku ON packaging_fadda (plant_id, sku)"))


_ensure_schema_compatibility()


def _seed_default_suppliers() -> None:
    """Keep raw-material inward usable after a fresh reset without manual typing."""
    default_suppliers = (
        {
            "id": "00000000-0000-0000-0000-00000000a101",
            "plant_id": "00000000-0000-0000-0000-0000000000a1",
            "supplier_code": "RM-SEED-A",
            "name": "RM Seed Supplier",
            "category": "RAW_MATERIAL",
            "contact_name": "Stores Desk",
            "contact_phone": "+91 00000 00001",
            "contact_email": "store-a@hariom.local",
            "gst_no": None,
            "pan_no": None,
            "address": "Plant A approved raw material supplier",
        },
        {
            "id": "00000000-0000-0000-0000-00000000a102",
            "plant_id": "00000000-0000-0000-0000-0000000000a1",
            "supplier_code": "PARCH-SEED-A",
            "name": "Parchment Seed Supplier",
            "category": "PARCHMENT",
            "contact_name": "Procurement Desk",
            "contact_phone": "+91 00000 00002",
            "contact_email": "parchment-a@hariom.local",
            "gst_no": None,
            "pan_no": None,
            "address": "Plant A approved parchment supplier",
        },
        {
            "id": "00000000-0000-0000-0000-00000000b101",
            "plant_id": "00000000-0000-0000-0000-0000000000b2",
            "supplier_code": "RM-SEED-B",
            "name": "RM Seed Supplier",
            "category": "RAW_MATERIAL",
            "contact_name": "Stores Desk",
            "contact_phone": "+91 00000 00003",
            "contact_email": "store-b@hariom.local",
            "gst_no": None,
            "pan_no": None,
            "address": "Plant B approved raw material supplier",
        },
        {
            "id": "00000000-0000-0000-0000-00000000b102",
            "plant_id": "00000000-0000-0000-0000-0000000000b2",
            "supplier_code": "PARCH-SEED-B",
            "name": "Parchment Seed Supplier",
            "category": "PARCHMENT",
            "contact_name": "Procurement Desk",
            "contact_phone": "+91 00000 00004",
            "contact_email": "parchment-b@hariom.local",
            "gst_no": None,
            "pan_no": None,
            "address": "Plant B approved parchment supplier",
        },
    )
    upsert_sql = text(
        """
        INSERT INTO supplier (
            id, plant_id, supplier_code, name, category, contact_name, contact_phone,
            contact_email, gst_no, pan_no, address, active, created_at
        )
        VALUES (
            :id, :plant_id, :supplier_code, :name, :category, :contact_name, :contact_phone,
            :contact_email, :gst_no, :pan_no, :address, TRUE, NOW()
        )
        ON CONFLICT (plant_id, supplier_code) DO UPDATE SET
            name = EXCLUDED.name,
            category = EXCLUDED.category,
            contact_name = EXCLUDED.contact_name,
            contact_phone = EXCLUDED.contact_phone,
            contact_email = EXCLUDED.contact_email,
            gst_no = EXCLUDED.gst_no,
            pan_no = EXCLUDED.pan_no,
            address = EXCLUDED.address,
            active = TRUE
        """
    )
    with engine.begin() as connection:
        for supplier in default_suppliers:
            connection.execute(upsert_sql, supplier)


_seed_default_suppliers()


@app.get("/")
def health_check():
    return {
        "status": "healthy",
        "service": "masterdata-service",
        "version": "1.0.0",
        "endpoints": [
            "/master/papers",
            "/master/adhesives",
            "/master/parchment/vendors",
            "/master/parchment/colors",
            "/master/tube-sizes",
            "/master/mandrels",
            "/master/customers",
            "/master/suppliers",
            "/master/machines",
            "/master/packaging/boxes",
            "/master/packaging/plastic-sheets",
            "/master/packaging/fadda",
            "/master/tools",
        ],
    }


@app.get("/health")
def detailed_health():
    return {
        "status": "healthy",
        "service": "masterdata-service",
        "database": "connected" if engine else "disconnected",
    }
