import uuid

from fastapi import FastAPI
from sqlalchemy import text

from . import models
from .database import engine
from .routers import adhesive, contact_directory, customer, machine, mandrel, packaging, paper, parchment, shop_floor, supplier, tool, tube_size

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
app.include_router(shop_floor.employee_router)
app.include_router(shop_floor.shift_router)
app.include_router(shop_floor.holiday_router)
app.include_router(shop_floor.reason_router)

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
        # Master redesign columns (additive; legacy clients see them as NULL).
        connection.execute(text("ALTER TABLE tool_master ADD COLUMN IF NOT EXISTS attribute_values JSONB DEFAULT '{}'::jsonb"))
        connection.execute(text("ALTER TABLE customer ADD COLUMN IF NOT EXISTS category VARCHAR(80)"))
        connection.execute(text("ALTER TABLE customer ADD COLUMN IF NOT EXISTS credit_limit DOUBLE PRECISION"))
        connection.execute(text("ALTER TABLE customer ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(120)"))
        connection.execute(text("ALTER TABLE customer_contact ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT FALSE"))
        connection.execute(text("ALTER TABLE supplier ADD COLUMN IF NOT EXISTS category_label VARCHAR(120)"))
        connection.execute(text("ALTER TABLE supplier_contact ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT FALSE"))
        connection.execute(text("UPDATE customer_contact SET is_primary = FALSE WHERE is_primary IS NULL"))
        connection.execute(text("UPDATE supplier_contact SET is_primary = FALSE WHERE is_primary IS NULL"))

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
        connection.execute(text("ALTER TABLE machine ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'UP'"))
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
        connection.execute(text("UPDATE machine SET status = COALESCE(NULLIF(upper(status), ''), 'UP')"))
        connection.execute(text("UPDATE machine SET status = 'UP' WHERE status NOT IN ('UP','MAINT','DOWN')"))
        connection.execute(text("UPDATE machine SET is_active = COALESCE(is_active, active, TRUE)"))
        connection.execute(text("UPDATE machine SET active = COALESCE(active, is_active, TRUE)"))
        connection.execute(text("UPDATE machine SET status = 'DOWN' WHERE COALESCE(is_active, active, TRUE) = FALSE"))
        connection.execute(text("ALTER TABLE machine DROP CONSTRAINT IF EXISTS machine_name_key"))
        connection.execute(text("DROP INDEX IF EXISTS machine_name_key"))
        connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_machine_plant_code ON machine (plant_id, code)"))
        connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_machine_plant_name ON machine (plant_id, name)"))
        connection.execute(text("ALTER TABLE machine DROP CONSTRAINT IF EXISTS ck_machine_status"))
        connection.execute(
            text("ALTER TABLE machine ADD CONSTRAINT ck_machine_status CHECK (status IN ('UP','MAINT','DOWN'))")
        )
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
                    notes, plant_id, active, is_primary, created_at
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
                UPDATE customer_contact contact
                SET is_primary = TRUE
                WHERE contact.active = TRUE
                  AND NOT EXISTS (
                      SELECT 1 FROM customer_contact existing
                      WHERE existing.customer_id = contact.customer_id
                        AND existing.active = TRUE
                        AND existing.is_primary = TRUE
                  )
                  AND contact.id = (
                      SELECT chosen.id
                      FROM customer_contact chosen
                      WHERE chosen.customer_id = contact.customer_id
                        AND chosen.active = TRUE
                      ORDER BY chosen.created_at ASC NULLS LAST, chosen.contact_name ASC
                      LIMIT 1
                  )
                """
            )
        )
        connection.execute(
            text(
                """
                WITH ranked AS (
                    SELECT
                        id,
                        ROW_NUMBER() OVER (
                            PARTITION BY customer_id
                            ORDER BY is_primary DESC, created_at ASC NULLS LAST, contact_name ASC
                        ) AS rank
                    FROM customer_contact
                    WHERE active = TRUE
                )
                UPDATE customer_contact contact
                SET is_primary = (ranked.rank = 1)
                FROM ranked
                WHERE contact.id = ranked.id
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
                    notes, plant_id, active, is_primary, created_at
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
                UPDATE supplier_contact contact
                SET is_primary = TRUE
                WHERE contact.active = TRUE
                  AND NOT EXISTS (
                      SELECT 1 FROM supplier_contact existing
                      WHERE existing.supplier_id = contact.supplier_id
                        AND existing.active = TRUE
                        AND existing.is_primary = TRUE
                  )
                  AND contact.id = (
                      SELECT chosen.id
                      FROM supplier_contact chosen
                      WHERE chosen.supplier_id = contact.supplier_id
                        AND chosen.active = TRUE
                      ORDER BY chosen.created_at ASC NULLS LAST, chosen.contact_name ASC
                      LIMIT 1
                  )
                """
            )
        )
        connection.execute(
            text(
                """
                WITH ranked AS (
                    SELECT
                        id,
                        ROW_NUMBER() OVER (
                            PARTITION BY supplier_id
                            ORDER BY is_primary DESC, created_at ASC NULLS LAST, contact_name ASC
                        ) AS rank
                    FROM supplier_contact
                    WHERE active = TRUE
                )
                UPDATE supplier_contact contact
                SET is_primary = (ranked.rank = 1)
                FROM ranked
                WHERE contact.id = ranked.id
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

        connection.execute(text("ALTER TABLE tool_master ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'ACTIVE'"))
        connection.execute(text("ALTER TABLE tool_master ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0"))
        connection.execute(text("ALTER TABLE tool_master ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()"))
        connection.execute(text("ALTER TABLE tool_master DROP CONSTRAINT IF EXISTS ck_tool_master_status"))
        connection.execute(text("UPDATE tool_master SET status = COALESCE(NULLIF(upper(status), ''), 'ACTIVE')"))
        connection.execute(text("UPDATE tool_master SET status = 'DISCONTINUED' WHERE status IN ('MAINTENANCE','SCRAP')"))
        connection.execute(text("UPDATE tool_master SET status = 'ACTIVE' WHERE status NOT IN ('ACTIVE','DISCONTINUED')"))
        connection.execute(text("UPDATE tool_master SET usage_count = COALESCE(usage_count, 0)"))
        connection.execute(text("UPDATE tool_master SET updated_at = COALESCE(updated_at, created_at, NOW())"))
        connection.execute(
            text("ALTER TABLE tool_master ADD CONSTRAINT ck_tool_master_status CHECK (status IN ('ACTIVE','DISCONTINUED'))")
        )
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_tool_master_status ON tool_master (status)"))
        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS tool_usage_log (
                    id UUID PRIMARY KEY,
                    tool_id UUID REFERENCES tool_master(id),
                    category VARCHAR(50) NOT NULL,
                    tool_name VARCHAR(150) NOT NULL,
                    event_type VARCHAR(40) NOT NULL,
                    source_type VARCHAR(40) NOT NULL,
                    source_id VARCHAR(80),
                    source_ref VARCHAR(120),
                    production_qty DOUBLE PRECISION,
                    actor VARCHAR(150),
                    notes TEXT,
                    plant_id VARCHAR(50) NOT NULL,
                    metadata_json JSON,
                    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
                )
                """
            )
        )
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_tool_usage_log_tool_id ON tool_usage_log (tool_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_tool_usage_log_category ON tool_usage_log (category)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_tool_usage_log_event_type ON tool_usage_log (event_type)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_tool_usage_log_source_type ON tool_usage_log (source_type)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_tool_usage_log_source_id ON tool_usage_log (source_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_tool_usage_log_plant_id ON tool_usage_log (plant_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_tool_usage_log_created_at ON tool_usage_log (created_at)"))


_ensure_schema_compatibility()


def _retire_legacy_notch_tool_placeholders() -> None:
    """Keep legacy tool rows for history while retiring them from current tooling use."""
    legacy_codes = (
        "NOTCH-DROP-DOWN",
        "BLADE-DROP-DOWN",
        "HOLDER-DROP-DOWN",
        "VFLAT-DROP-DOWN",
        "PUNCH-SINGLE",
        "PUNCH-DOUBLE",
        "PUNCH-NA",
        "NOTCH-WIDER-YES",
        "NOTCH-WIDER-NO",
        "NOTCH-PATTI-YES",
        "NOTCH-PATTI-NO",
        "NOTCH-DIR-FORWARD",
        "NOTCH-DIR-REVERSE",
    )
    retire_sql = text(
        """
        UPDATE tool_master
        SET
            active = FALSE,
            status = 'DISCONTINUED',
            condition_notes = COALESCE(NULLIF(condition_notes, ''), 'Retired legacy seeded placeholder; recreate manually under the new field category if still required.'),
            updated_at = NOW()
        WHERE code = :legacy_code
        """
    )
    retire_category_sql = text(
        """
        UPDATE tool_master
        SET
            active = FALSE,
            status = 'DISCONTINUED',
            condition_notes = COALESCE(NULLIF(condition_notes, ''), 'Retired non-current notching tool category. Valid categories are Notch, Blade, Holder, V + Flat, and Punch.'),
            updated_at = NOW()
        WHERE category IN (
            'NOTCH_TYPE','NOTCH_THICKNESS','NOTCH_DESIGN','NOTCH_CODE','NOTCH_DEGREE',
            'BLADE_TYPE','BLADE_THICKNESS','BLADE_CODE','BLADE_HEIGHT','BLADE_LENGTH',
            'NOTCHING_BLADE','NOTCHING_HOLDER',
            'HOLDER_THICKNESS','HOLDER_CODE','HOLDER_HEIGHT','HOLDER_LENGTH',
            'V_FLAT_CODE','V_FLAT_LENGTH','V_FLAT_THICKNESS',
            'DIRECTION','NOTCH_DIRECTION','NOTCH_DISTANCE','NOTCH_DEEP',
            'NOTCH_WIDER','NOTCH_PATTI','GROOVE','GURU','WIDER_TOOL','TOCHHA','DIE'
          )
        """
    )
    retire_unknown_category_sql = text(
        """
        UPDATE tool_master
        SET
            active = FALSE,
            status = 'DISCONTINUED',
            condition_notes = COALESCE(NULLIF(condition_notes, ''), 'Retired legacy tool category. Current tooling categories are Notch, Blade, Holder, V + Flat, and Punch.'),
            updated_at = NOW()
        WHERE UPPER(COALESCE(category, '')) NOT IN ('NOTCH', 'BLADE', 'HOLDER', 'V_FLAT', 'PUNCH')
        """
    )
    with engine.begin() as connection:
        for legacy_code in legacy_codes:
            connection.execute(retire_sql, {"legacy_code": legacy_code})
        connection.execute(retire_category_sql)
        connection.execute(retire_unknown_category_sql)


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
    update_by_code_sql = text(
        """
        UPDATE supplier
        SET
            name = :name,
            category = :category,
            contact_name = :contact_name,
            contact_phone = :contact_phone,
            contact_email = :contact_email,
            gst_no = :gst_no,
            pan_no = :pan_no,
            address = :address,
            active = TRUE
        WHERE plant_id = :plant_id
          AND supplier_code = :supplier_code
        """
    )
    update_by_id_sql = text(
        """
        UPDATE supplier
        SET
            plant_id = :plant_id,
            supplier_code = :supplier_code,
            name = :name,
            category = :category,
            contact_name = :contact_name,
            contact_phone = :contact_phone,
            contact_email = :contact_email,
            gst_no = :gst_no,
            pan_no = :pan_no,
            address = :address,
            active = TRUE
        WHERE id = :id
        """
    )
    insert_sql = text(
        """
        INSERT INTO supplier (
            id, plant_id, supplier_code, name, category, contact_name, contact_phone,
            contact_email, gst_no, pan_no, address, active, created_at
        )
        VALUES (
            :id, :plant_id, :supplier_code, :name, :category, :contact_name, :contact_phone,
            :contact_email, :gst_no, :pan_no, :address, TRUE, NOW()
        )
        ON CONFLICT (id) DO NOTHING
        """
    )
    with engine.begin() as connection:
        for supplier in default_suppliers:
            updated = connection.execute(update_by_code_sql, supplier).rowcount or 0
            if updated == 0:
                updated = connection.execute(update_by_id_sql, supplier).rowcount or 0
            if updated == 0:
                connection.execute(insert_sql, supplier)


_seed_default_suppliers()
_retire_legacy_notch_tool_placeholders()


def _seed_tool_attribute_options() -> None:
    """Install client-provided defaults once; admins can edit them thereafter."""
    rows = []
    for (category, field_key), values in tool.DEFAULT_TOOL_OPTIONS.items():
        for sort_order, value in enumerate(values):
            rows.append({
                "id": str(uuid.uuid4()),
                "category": category,
                "field_key": field_key,
                "value": value,
                "sort_order": sort_order,
            })
    with engine.begin() as connection:
        for plant_id in ("PLANT_A", "PLANT-1"):
            for row in rows:
                connection.execute(
                    text(
                        "INSERT INTO tool_attribute_option "
                        "(id, category, field_key, value, plant_id, active, sort_order, created_at, updated_at) "
                        "VALUES (:id, :category, :field_key, :value, :plant_id, TRUE, :sort_order, NOW(), NOW()) "
                        "ON CONFLICT (plant_id, category, field_key, value) DO NOTHING"
                    ),
                    {**row, "id": str(uuid.uuid4()), "plant_id": plant_id},
                )


_seed_tool_attribute_options()


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
