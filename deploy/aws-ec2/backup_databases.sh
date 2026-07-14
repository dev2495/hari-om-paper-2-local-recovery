#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/hariom/app/deploy/aws-ec2}"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/hariom/backups}"
ENV_FILE="${ENV_FILE:-${DEPLOY_DIR}/.env}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing environment file: ${ENV_FILE}" >&2
  exit 1
fi

dotenv_get() {
  local key="$1"
  sed -n "s/^${key}=//p" "${ENV_FILE}" | tail -n 1
}

DB_USER="$(dotenv_get DB_USER)"
BACKUP_S3_BUCKET="$(dotenv_get BACKUP_S3_BUCKET)"

: "${DB_USER:?DB_USER is required}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"

report_result() {
  local exit_code="$?"
  trap - EXIT
  local value="1"
  if [[ "${exit_code}" -ne 0 ]]; then
    value="0"
  fi
  aws cloudwatch put-metric-data \
    --namespace HariOmERP \
    --metric-name DatabaseBackupSuccess \
    --value "${value}" \
    --unit Count >/dev/null 2>&1 || true
  exit "${exit_code}"
}
trap report_result EXIT

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${BACKUP_ROOT}/${timestamp}"
archive_path="${BACKUP_ROOT}/hariom-erp-${timestamp}.tar.gz"
mkdir -p "${backup_dir}"

for db_name in authdb masterdb specdb salesdb productiondb inventorydb analyticsdb; do
  docker compose --env-file "${ENV_FILE}" --project-directory "${DEPLOY_DIR}" \
    exec -T postgres pg_dump --username "${DB_USER}" --format=custom --no-owner --no-privileges "${db_name}" \
    > "${backup_dir}/${db_name}.dump"
  pg_restore --list "${backup_dir}/${db_name}.dump" >/dev/null
done

sha256sum "${backup_dir}"/*.dump > "${backup_dir}/SHA256SUMS"
tar -C "${backup_dir}" -czf "${archive_path}" .
aws s3 cp "${archive_path}" "s3://${BACKUP_S3_BUCKET}/database/${timestamp}/$(basename "${archive_path}")" --sse AES256 --only-show-errors

rm -rf "${backup_dir}"
find "${BACKUP_ROOT}" -maxdepth 1 -type f -name 'hariom-erp-*.tar.gz' -mtime +7 -delete
echo "Backup uploaded: s3://${BACKUP_S3_BUCKET}/database/${timestamp}/$(basename "${archive_path}")"
