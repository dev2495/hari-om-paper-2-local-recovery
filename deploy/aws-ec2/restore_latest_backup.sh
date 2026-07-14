#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/hariom/app/deploy/aws-ec2}"
ENV_FILE="${ENV_FILE:-${DEPLOY_DIR}/.env}"

dotenv_get() {
  local key="$1"
  sed -n "s/^${key}=//p" "${ENV_FILE}" | tail -n 1
}

DB_USER="$(dotenv_get DB_USER)"
BACKUP_S3_BUCKET="$(dotenv_get BACKUP_S3_BUCKET)"
: "${DB_USER:?DB_USER is required}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"

compose=(docker compose --env-file "${ENV_FILE}" --project-directory "${DEPLOY_DIR}")
work_dir="$(mktemp -d /tmp/hariom-production-restore.XXXXXX)"
finish() { rm -rf "${work_dir}"; }
trap finish EXIT

latest_key="$(aws s3api list-objects-v2 \
  --bucket "${BACKUP_S3_BUCKET}" \
  --prefix database/ \
  --query 'reverse(sort_by(Contents,&LastModified))[0].Key' \
  --output text)"
if [[ -z "${latest_key}" || "${latest_key}" == "None" ]]; then
  echo "No database backup found in s3://${BACKUP_S3_BUCKET}/database/" >&2
  exit 1
fi

archive_path="${work_dir}/backup.tar.gz"
aws s3 cp "s3://${BACKUP_S3_BUCKET}/${latest_key}" "${archive_path}" --only-show-errors
tar -xzf "${archive_path}" -C "${work_dir}"
(cd "${work_dir}" && sed 's#  .*/#  #' SHA256SUMS | sha256sum --check -)

"${compose[@]}" up -d postgres
for _attempt in $(seq 1 60); do
  if "${compose[@]}" exec -T postgres pg_isready -U "${DB_USER}" -d postgres >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
"${compose[@]}" exec -T postgres pg_isready -U "${DB_USER}" -d postgres >/dev/null
"${compose[@]}" stop erp-app caddy >/dev/null 2>&1 || true

for db_name in authdb masterdb specdb salesdb productiondb inventorydb analyticsdb; do
  dump_path="${work_dir}/${db_name}.dump"
  pg_restore --list "${dump_path}" >/dev/null
  "${compose[@]}" exec -T postgres dropdb -U "${DB_USER}" --if-exists "${db_name}"
  "${compose[@]}" exec -T postgres createdb -U "${DB_USER}" "${db_name}"
  "${compose[@]}" exec -T postgres pg_restore \
    -U "${DB_USER}" -d "${db_name}" --no-owner --no-privileges < "${dump_path}"
  table_count="$("${compose[@]}" exec -T postgres psql -U "${DB_USER}" -d "${db_name}" -Atc \
    "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public';")"
  if [[ "${table_count}" -lt 1 ]]; then
    echo "Restore produced no public tables for ${db_name}" >&2
    exit 1
  fi
done

echo "Production restore passed for ${latest_key}."
