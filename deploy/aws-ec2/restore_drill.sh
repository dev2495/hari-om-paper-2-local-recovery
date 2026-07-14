#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/hariom/app/deploy/aws-ec2}"
ENV_FILE="${ENV_FILE:-${DEPLOY_DIR}/.env}"
RESTORE_IMAGE="${RESTORE_IMAGE:-postgres:16-alpine}"

dotenv_get() {
  local key="$1"
  sed -n "s/^${key}=//p" "${ENV_FILE}" | tail -n 1
}

BACKUP_S3_BUCKET="$(dotenv_get BACKUP_S3_BUCKET)"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"

work_dir="$(mktemp -d /tmp/hariom-restore-drill.XXXXXX)"
container_name="hariom-restore-drill-$$"

finish() {
  local exit_code="$?"
  trap - EXIT
  docker rm -f "${container_name}" >/dev/null 2>&1 || true
  rm -rf "${work_dir}"
  local value="1"
  if [[ "${exit_code}" -ne 0 ]]; then
    value="0"
  fi
  aws cloudwatch put-metric-data \
    --namespace HariOmERP \
    --metric-name DatabaseRestoreDrillSuccess \
    --value "${value}" \
    --unit Count >/dev/null 2>&1 || true
  exit "${exit_code}"
}
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
(cd "${work_dir}" && sha256sum --check SHA256SUMS)

docker run -d --rm \
  --name "${container_name}" \
  -e POSTGRES_PASSWORD=restore-drill-only \
  "${RESTORE_IMAGE}" >/dev/null

for _attempt in $(seq 1 30); do
  if docker exec "${container_name}" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "${container_name}" pg_isready -U postgres >/dev/null

for db_name in authdb masterdb specdb salesdb productiondb inventorydb analyticsdb; do
  dump_path="${work_dir}/${db_name}.dump"
  [[ -s "${dump_path}" ]]
  docker exec "${container_name}" createdb -U postgres "${db_name}"
  docker exec -i "${container_name}" pg_restore \
    -U postgres \
    -d "${db_name}" \
    --no-owner \
    --no-privileges < "${dump_path}"
  table_count="$(docker exec "${container_name}" psql -U postgres -d "${db_name}" -Atc \
    "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public';")"
  if [[ "${table_count}" -lt 1 ]]; then
    echo "Restore drill produced no public tables for ${db_name}" >&2
    exit 1
  fi
done

echo "Restore drill passed for ${latest_key}"
