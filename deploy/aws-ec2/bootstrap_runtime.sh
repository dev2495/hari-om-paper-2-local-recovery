#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/hariom/app/deploy/aws-ec2}"
ENV_FILE="${ENV_FILE:-${DEPLOY_DIR}/.env}"

: "${SITE_HOST:?SITE_HOST is required}"
: "${ELASTIC_IP:?ELASTIC_IP is required}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"

if [[ -e "${ENV_FILE}" ]]; then
  echo "Refusing to replace existing environment file: ${ENV_FILE}" >&2
  exit 1
fi

umask 077
db_password="$(openssl rand -base64 36 | tr -d '\n')"
jwt_secret="$(openssl rand -hex 48)"
internal_event_token="$(openssl rand -hex 48)"
bootstrap_admin_password="$(openssl rand -base64 36 | tr -d '\n')"
bootstrap_owner_password="$(openssl rand -base64 36 | tr -d '\n')"

install -d -m 0755 "${DEPLOY_DIR}"
{
  printf 'DB_USER=hariom\n'
  printf 'DB_PASSWORD=%s\n' "${db_password}"
  printf 'JWT_SECRET=%s\n' "${jwt_secret}"
  printf 'INTERNAL_EVENT_TOKEN=%s\n' "${internal_event_token}"
  printf 'BOOTSTRAP_ADMIN_EMAIL=devarsh@hariom.com\n'
  printf 'BOOTSTRAP_ADMIN_PASSWORD=%s\n' "${bootstrap_admin_password}"
  printf 'BOOTSTRAP_OWNER_EMAIL=yash@hariom.com\n'
  printf 'BOOTSTRAP_OWNER_PASSWORD=%s\n' "${bootstrap_owner_password}"
  printf 'SITE_HOST=%s\n' "${SITE_HOST}"
  printf 'ELASTIC_IP=%s\n' "${ELASTIC_IP}"
  printf 'BACKUP_S3_BUCKET=%s\n' "${BACKUP_S3_BUCKET}"
} > "${ENV_FILE}"
chmod 0600 "${ENV_FILE}"

echo "Runtime environment created with generated secrets at ${ENV_FILE}."
