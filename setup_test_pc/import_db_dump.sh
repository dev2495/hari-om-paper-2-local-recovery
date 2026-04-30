#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP_DIR="${ROOT_DIR}/setup_test_pc"
DUMP_FILE="${DUMP_FILE:-${SETUP_DIR}/db_dumps/hariom_erp_latest.dump}"
DB_NAMES_FILE="${SETUP_DIR}/db_names.txt"

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-${USER:-postgres}}"
DB_ADMIN_DB="${DB_ADMIN_DB:-postgres}"

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "Dump file not found: ${DUMP_FILE}"
  echo "Copy setup_test_pc/db_dumps/hariom_erp_latest.dump from the source machine or set DUMP_FILE."
  exit 1
fi

for required in psql pg_restore dropdb createdb tar; do
  if ! command -v "$required" >/dev/null 2>&1; then
    echo "${required} is required. Install PostgreSQL client tools first."
    exit 1
  fi
done

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
tar -xzf "$DUMP_FILE" -C "$tmp_dir"

echo "[import] stopping app services if running"
bash "${ROOT_DIR}/stop_all.sh" >/dev/null 2>&1 || true

echo "[import] replacing local ERP databases from ${DUMP_FILE}"
while IFS= read -r db_name; do
  [[ -n "$db_name" ]] || continue
  dump_path="${tmp_dir}/${db_name}.dump"
  if [[ ! -f "$dump_path" ]]; then
    echo "Missing dump inside archive: ${db_name}.dump"
    exit 1
  fi
  echo "[import] ${db_name}"
  psql --host "$DB_HOST" --port "$DB_PORT" --username "$DB_USER" --dbname "$DB_ADMIN_DB" --command "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${db_name}' AND pid <> pg_backend_pid();" >/dev/null
  dropdb --if-exists --host "$DB_HOST" --port "$DB_PORT" --username "$DB_USER" "$db_name"
  createdb --host "$DB_HOST" --port "$DB_PORT" --username "$DB_USER" "$db_name"
  pg_restore --host "$DB_HOST" --port "$DB_PORT" --username "$DB_USER" --dbname "$db_name" --clean --if-exists "$dump_path"
done < "$DB_NAMES_FILE"

echo "[import] complete. Start with: bash setup_test_pc/start_for_tester.sh"
