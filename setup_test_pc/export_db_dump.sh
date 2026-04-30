#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP_DIR="${ROOT_DIR}/setup_test_pc"
DUMP_DIR="${SETUP_DIR}/db_dumps"
DUMP_FILE="${DUMP_FILE:-${DUMP_DIR}/hariom_erp_latest.dump}"
DB_NAMES_FILE="${SETUP_DIR}/db_names.txt"

mkdir -p "$DUMP_DIR"

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-${USER:-postgres}}"

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump is required. Install PostgreSQL client tools first."
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

echo "[export] writing per-database dumps to ${tmp_dir}"
while IFS= read -r db_name; do
  [[ -n "$db_name" ]] || continue
  echo "[export] ${db_name}"
  pg_dump --host "$DB_HOST" --port "$DB_PORT" --username "$DB_USER" --format custom --file "${tmp_dir}/${db_name}.dump" "$db_name"
done < "$DB_NAMES_FILE"

cp "$DB_NAMES_FILE" "${tmp_dir}/db_names.txt"
tar -czf "$DUMP_FILE" -C "$tmp_dir" .

echo "[export] complete: ${DUMP_FILE}"
