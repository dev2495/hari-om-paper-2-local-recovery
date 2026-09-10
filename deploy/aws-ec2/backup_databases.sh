#!/usr/bin/env bash
set -euo pipefail
umask 077

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

app_stopped=0
resume_app() {
  if [[ "$app_stopped" == "1" ]]; then
    docker compose --env-file "${ENV_FILE}" --project-directory "${DEPLOY_DIR}" start erp-app
    app_stopped=0
  fi
}

report_result() {
  local exit_code="$?"
  trap - EXIT
  resume_app || exit_code=1
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
exec 9>"${BACKUP_ROOT}/backup.lock"
flock -n 9 || { echo "Another backup is running" >&2; exit 1; }
# A coordinated seven-database backup needs a quiet application. Graceful stop
# drains in-flight requests; PostgreSQL stays online. Restart even on failure.
if docker compose --env-file "${ENV_FILE}" --project-directory "${DEPLOY_DIR}" ps --status running --services | grep -qx erp-app; then
  app_stopped=1
  docker compose --env-file "${ENV_FILE}" --project-directory "${DEPLOY_DIR}" stop -t 90 erp-app
fi
printf 'quiesced application; seven databases; %s UTC\n' "$timestamp" > "${backup_dir}/CONSISTENCY"

for db_name in authdb masterdb specdb salesdb productiondb inventorydb analyticsdb; do
  docker compose --env-file "${ENV_FILE}" --project-directory "${DEPLOY_DIR}" \
    exec -T postgres pg_dump --username "${DB_USER}" --format=custom --no-owner --no-privileges "${db_name}" \
    > "${backup_dir}/${db_name}.dump"
  pg_restore --list "${backup_dir}/${db_name}.dump" >/dev/null
  docker compose --env-file "${ENV_FILE}" --project-directory "${DEPLOY_DIR}" exec -T postgres     psql --username "${DB_USER}" --dbname "${db_name}" -At -v ON_ERROR_STOP=1     < "${DEPLOY_DIR}/backup_row_counts.sql" > "${backup_dir}/${db_name}.counts"
done

resume_app

sha256sum "${backup_dir}"/*.dump "${backup_dir}"/*.counts "${backup_dir}/CONSISTENCY" > "${backup_dir}/SHA256SUMS"
tar -C "${backup_dir}" -czf "${archive_path}" .
aws s3 cp "${archive_path}" "s3://${BACKUP_S3_BUCKET}/database/${timestamp}/$(basename "${archive_path}")" --sse AES256 --only-show-errors

rm -rf "${backup_dir}"
find "${BACKUP_ROOT}" -maxdepth 1 -type f -name 'hariom-erp-*.tar.gz' -mtime +7 -delete
echo "Backup uploaded: s3://${BACKUP_S3_BUCKET}/database/${timestamp}/$(basename "${archive_path}")"
