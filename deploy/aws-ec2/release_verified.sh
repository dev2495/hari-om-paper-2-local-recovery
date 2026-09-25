#!/usr/bin/env bash
# Run on the existing host only. Preserve volumes, credentials and rollback image.
set -euo pipefail
umask 077
release="${1:?exact 40-character Git commit required}"
expected="${2:?expected currently deployed Git commit required}"
[[ "$release" =~ ^[a-f0-9]{40}$ && "$expected" =~ ^[a-f0-9]{40}$ ]]
[[ "$(cat /opt/hariom/DEPLOYED_COMMIT)" == "$expected" ]] || { echo 'Live release changed; stop and review'; exit 1; }
exec 8>/opt/hariom/release.lock
flock -n 8 || { echo 'A release is already running'; exit 1; }
app=/opt/hariom/app
deploy="$app/deploy/aws-ec2"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
work="/opt/hariom/releases/$stamp-$release"
mkdir -p "$work/source"
compose() { docker compose --env-file "$deploy/.env" --project-directory "$deploy" "$@"; }
old_image="$(docker inspect --format '{{.Image}}' "$(compose ps -q erp-app)")"
docker image tag "$old_image" "hariom-rollback:$stamp"
printf '%s\n' "$old_image" > "$work/previous-image"
cp /opt/hariom/DEPLOYED_COMMIT "$work/previous-commit"
tar --exclude='./.git' --exclude='./apps/web-ui/node_modules' --exclude='./apps/web-ui/.next' --exclude='./hariom-erp/venv-runtime' --exclude='./output' --exclude='./deploy/aws-ec2/.env' -C "$app" -czf "$work/previous-source.tar.gz" .
curl --fail --location --retry 3 --max-time 120 "https://github.com/dev2495/hari-om-paper-2-local-recovery/archive/$release.tar.gz" -o "$work/release.tar.gz"
tar -xzf "$work/release.tar.gz" --strip-components=1 -C "$work/source"
[[ -f "$work/source/deploy/aws-ec2/migrations/20260910-production.sql" ]]
# No delete option: production .env and runtime state remain in place.
cp -a "$work/source/." "$app/"
activated=0
rollback() {
  code=$?
  trap - ERR
  if [[ "$activated" == 1 ]]; then
    docker image tag "$old_image" hariom-erp-production-erp-app:latest
    compose up -d --no-deps erp-app || true
  fi
  tar -xzf "$work/previous-source.tar.gz" -C "$app"
  compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile || true
  echo "Release failed ($code). Previous image/source retained in $work. Inspect health before further action." >&2
  exit "$code"
}
trap rollback ERR
compose build erp-app
# New backup format records exact table counts while the app is quiet.
bash "$deploy/backup_databases.sh"
db_user="$(sed -n 's/^DB_USER=//p' "$deploy/.env" | tail -n 1)"
compose exec -T postgres psql -U "$db_user" -d productiondb -v ON_ERROR_STOP=1 < "$deploy/migrations/20260910-production.sql"
activated=1
compose up -d --no-deps erp-app
ready=0
for attempt in $(seq 1 60); do
  if compose exec -T erp-app curl -fsS --max-time 10 http://127.0.0.1:14000/health/ready > "$work/readiness.json"; then ready=1; break; fi
  sleep 5
done
[[ "$ready" == 1 ]]
compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile
compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile
site_host="$(sed -n 's/^SITE_HOST=//p' "$deploy/.env" | tail -n 1)"
# The app restarts after activation and again inside each backup; Caddy answers
# 502 until it is back. Wait for the public route instead of failing on one probe.
wait_public() {
  local attempt
  for attempt in $(seq 1 60); do
    if curl -fsS --max-time 20 "https://$site_host/healthz" > "$work/public-readiness.json" 2>/dev/null; then return 0; fi
    sleep 5
  done
  curl -fsS --max-time 20 "https://$site_host/healthz" > "$work/public-readiness.json"
}
wait_public
curl -fsS --max-time 20 "https://$site_host/login" > "$work/login.html"
install -m 0644 "$deploy/hariom-backup.service" "$deploy/hariom-health-metrics.service" "$deploy/hariom-restore-drill.service" /etc/systemd/system/
systemctl daemon-reload
# Acceptance uses a backup of the new schemas, then a separate restore container.
bash "$deploy/backup_databases.sh"
bash "$deploy/restore_drill.sh" > "$work/restore-result.txt"
wait_public
bash "$deploy/publish_health_metrics.sh"
printf '%s\n' "$release" > /opt/hariom/DEPLOYED_COMMIT
trap - ERR
echo "Release accepted: $release; evidence=$work; rollback=hariom-rollback:$stamp"
