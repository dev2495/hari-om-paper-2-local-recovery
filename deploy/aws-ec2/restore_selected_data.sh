#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/hariom/app/deploy/aws-ec2}"
IMPORT_DIR="${IMPORT_DIR:-/opt/hariom/import}"
ENV_FILE="${ENV_FILE:-${DEPLOY_DIR}/.env}"

dotenv_get() {
  local key="$1"
  sed -n "s/^${key}=//p" "${ENV_FILE}" | tail -n 1
}

DB_USER="$(dotenv_get DB_USER)"
: "${DB_USER:?DB_USER is required}"

compose=(docker compose --env-file "${ENV_FILE}" --project-directory "${DEPLOY_DIR}")

for dump_name in authdb-selected.dump masterdb-selected.dump specdb-selected.dump inventorydb-selected.dump; do
  if [[ ! -s "${IMPORT_DIR}/${dump_name}" ]]; then
    echo "Missing selected-data dump: ${IMPORT_DIR}/${dump_name}" >&2
    exit 1
  fi
  pg_restore --list "${IMPORT_DIR}/${dump_name}" >/dev/null
done

"${compose[@]}" stop erp-app caddy

psql_in_db() {
  local db_name="$1"
  local sql="$2"
  "${compose[@]}" exec -T postgres psql --username "${DB_USER}" --dbname "${db_name}" --set ON_ERROR_STOP=1 --command "${sql}"
}

restore_dump() {
  local db_name="$1"
  local dump_path="$2"
  "${compose[@]}" exec -T postgres pg_restore \
    --username "${DB_USER}" \
    --dbname "${db_name}" \
    --data-only \
    --no-owner \
    --no-privileges \
    --disable-triggers \
    < "${dump_path}"
}

psql_in_db authdb "TRUNCATE TABLE user_allowed_plants, user_roles, role_permissions, users, roles, permissions, plants CASCADE;"
restore_dump authdb "${IMPORT_DIR}/authdb-selected.dump"

psql_in_db masterdb "TRUNCATE TABLE machine_supported_mandrel, customer_contact, supplier_contact, parchment_color, paper_master, adhesive_master, parchment_vendor, tube_size, mandrel, machine, customer, supplier, packaging_box, packaging_plastic_sheet, packaging_fadda, tool_master, employee, shift_definition, plant_holiday, reason_code CASCADE;"
psql_in_db masterdb "
  ALTER TABLE tool_master ADD COLUMN IF NOT EXISTS code VARCHAR(50);
  ALTER TABLE tool_master ADD COLUMN IF NOT EXISTS location VARCHAR(120);
  ALTER TABLE tool_master ADD COLUMN IF NOT EXISTS condition_notes TEXT;
  ALTER TABLE tool_master ADD COLUMN IF NOT EXISTS last_maintenance_at TIMESTAMP WITHOUT TIME ZONE;
  ALTER TABLE tool_master ADD COLUMN IF NOT EXISTS next_maintenance_due TIMESTAMP WITHOUT TIME ZONE;
  ALTER TABLE tool_master ADD COLUMN IF NOT EXISTS scrapped_at TIMESTAMP WITHOUT TIME ZONE;
  ALTER TABLE tool_master ALTER COLUMN attribute_values SET DEFAULT '{}'::json;
  ALTER TABLE tool_master DROP CONSTRAINT IF EXISTS ck_tool_master_status;
"
restore_dump masterdb "${IMPORT_DIR}/masterdb-selected.dump"
psql_in_db masterdb "
  UPDATE tool_master SET attribute_values = '{}'::json WHERE attribute_values IS NULL;
  UPDATE tool_master SET status = 'DISCONTINUED' WHERE status IN ('MAINTENANCE', 'SCRAP');
  UPDATE tool_master SET status = 'ACTIVE' WHERE status IS NULL OR status NOT IN ('ACTIVE', 'DISCONTINUED');
  ALTER TABLE tool_master ADD CONSTRAINT ck_tool_master_status CHECK (status IN ('ACTIVE', 'DISCONTINUED'));
"

psql_in_db specdb "TRUNCATE TABLE spec_dynamic_field_values, trial_results, recipe_layers, recipe_header, specification_sheet, spec_dynamic_fields, global_spec_defaults CASCADE;"
restore_dump specdb "${IMPORT_DIR}/specdb-selected.dump"

psql_in_db inventorydb "TRUNCATE TABLE inventory_quality_templates, item_master, inventory_locations CASCADE;"
restore_dump inventorydb "${IMPORT_DIR}/inventorydb-selected.dump"

"${compose[@]}" up -d erp-app caddy
echo "Selected Railway master and user data restored."
