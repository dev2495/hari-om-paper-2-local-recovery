#!/usr/bin/env bash
set -euo pipefail

export DB_USER="${DB_USER:-${PGUSER:-hariom}}"
export DB_PASSWORD="${DB_PASSWORD:-${PGPASSWORD:-hariom_staging_change_me}}"
export DB_HOST="${DB_HOST:-${PGHOST:-127.0.0.1}}"
export DB_PORT="${DB_PORT:-${PGPORT:-5432}}"
export DB_ADMIN_DB="${DB_ADMIN_DB:-${PGDATABASE:-postgres}}"
export START_EMBEDDED_POSTGRES="${START_EMBEDDED_POSTGRES:-auto}"

is_local_db_host() {
  [[ "${DB_HOST}" == "127.0.0.1" || "${DB_HOST}" == "localhost" || "${DB_HOST}" == "::1" ]]
}

should_start_embedded_postgres() {
  if [[ "${START_EMBEDDED_POSTGRES}" == "true" ]]; then
    return 0
  fi
  if [[ "${START_EMBEDDED_POSTGRES}" == "false" ]]; then
    return 1
  fi
  is_local_db_host
}

guard_railway_database() {
  if [[ -z "${RAILWAY_ENVIRONMENT:-}${RAILWAY_SERVICE_ID:-}" ]]; then
    return
  fi
  if should_start_embedded_postgres; then
    cat >&2 <<'MSG'
[postgres] refusing to start embedded Postgres on Railway.
Attach a Railway PostgreSQL service and expose PGHOST, PGPORT, PGUSER, PGPASSWORD,
and PGDATABASE to this service. If this service uses a persistent Railway volume
mounted at /var/lib/postgresql, explicitly set START_EMBEDDED_POSTGRES=true.
MSG
    exit 1
  fi
}

start_postgres() {
  if command -v pg_ctlcluster >/dev/null 2>&1; then
    local version
    version="$(ls /etc/postgresql | sort -V | tail -1)"
    local data_dir="/var/lib/postgresql/${version}/main"
    if [[ ! -s "${data_dir}/PG_VERSION" ]]; then
      echo "[postgres] initializing empty data directory at ${data_dir}" >&2
      pg_dropcluster --stop "$version" main >/dev/null 2>&1 || true
      pg_createcluster "$version" main --start >/dev/null
      return
    fi
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

ensure_external_databases() {
  for db_name in authdb masterdb specdb salesdb productiondb inventorydb analyticsdb; do
    if ! PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_ADMIN_DB}" -tAc "SELECT 1 FROM pg_database WHERE datname='${db_name}'" | grep -q 1; then
      PGPASSWORD="${DB_PASSWORD}" createdb -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -O "${DB_USER}" "${db_name}"
    fi
  done
}

guard_railway_database

if should_start_embedded_postgres; then
  start_postgres
  ensure_role_and_databases
else
  echo "[postgres] using external PostgreSQL at ${DB_HOST}:${DB_PORT}" >&2
  ensure_external_databases
fi

exec python deploy/tinypod/start_erp.py
