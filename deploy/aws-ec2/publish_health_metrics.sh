#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/hariom/app/deploy/aws-ec2}"
ENV_FILE="${ENV_FILE:-${DEPLOY_DIR}/.env}"

dotenv_get() {
  local key="$1"
  sed -n "s/^${key}=//p" "${ENV_FILE}" | tail -n 1
}

SITE_HOST="$(dotenv_get SITE_HOST)"
: "${SITE_HOST:?SITE_HOST is required}"

disk_used_percent="$(df -P / | awk 'NR == 2 {gsub(/%/, "", $5); print $5}')"
memory_used_percent="$(awk '
  /MemTotal:/ {total=$2}
  /MemAvailable:/ {available=$2}
  END {if (total > 0) printf "%.1f", (total-available)*100/total; else print "0"}
' /proc/meminfo)"

route_ok="0"
if curl --fail --silent --show-error --max-time 15 "https://${SITE_HOST}/healthz" >/dev/null; then
  route_ok="1"
fi

aws cloudwatch put-metric-data --namespace HariOmERP --metric-data \
  "MetricName=DiskUsedPercent,Value=${disk_used_percent},Unit=Percent" \
  "MetricName=MemoryUsedPercent,Value=${memory_used_percent},Unit=Percent" \
  "MetricName=CriticalRouteSuccess,Value=${route_ok},Unit=Count"

if [[ "${route_ok}" != "1" ]]; then
  echo "Critical public readiness route failed: https://${SITE_HOST}/healthz" >&2
  exit 1
fi
