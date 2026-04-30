#!/usr/bin/env bash
set -euo pipefail

export DB_USER="${DB_USER:-hariom}"
export DB_PASSWORD="${DB_PASSWORD:-hariom_staging_change_me}"
export DB_HOST="${DB_HOST:-127.0.0.1}"
export DB_PORT="${DB_PORT:-5432}"
export DB_ADMIN_DB="${DB_ADMIN_DB:-postgres}"

start_postgres() {
  if command -v pg_ctlcluster >/dev/null 2>&1; then
    local version
    version="$(ls /etc/postgresql | sort -V | tail -1)"
    pg_ctlcluster "$version" main start
    return
  fi
  service postgresql start
}

ensure_role_and_databases() {
  su postgres -c "psql -v ON_ERROR_STOP=1 --dbname=postgres" <<SQL
DO
\$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;
SQL

  for db_name in authdb masterdb specdb salesdb productiondb inventorydb analyticsdb; do
    if ! su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='${db_name}'\"" | grep -q 1; then
      su postgres -c "createdb -O ${DB_USER} ${db_name}"
    fi
  done
}

start_postgres
ensure_role_and_databases

exec python deploy/tinypod/start_erp.py

