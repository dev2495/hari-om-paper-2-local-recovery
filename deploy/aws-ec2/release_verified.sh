#!/usr/bin/env bash
# Run on the existing host only. Preserve volumes, credentials and rollback image.
set -Eeuo pipefail
umask 077
release="${1:?exact 40-character Git commit required}"
expected="${2:?expected currently deployed Git commit required}"
[[ "$release" =~ ^[a-f0-9]{40}$ && "$expected" =~ ^[a-f0-9]{40}$ ]]
exec 8>/opt/hariom/release.lock
flock -n 8 || { echo 'A release is already running'; exit 1; }
[[ "$(cat /opt/hariom/DEPLOYED_COMMIT)" == "$expected" ]] || { echo 'Live release changed; stop and review'; exit 1; }
# Older scheduled backups do not know release.lock. Exclude them before source
# changes and keep their lock through build, cutover and rollback. Nested backup
# calls inherit this exact locked descriptor rather than opening it again.
mkdir -p /opt/hariom/backups
exec 9>/opt/hariom/backups/backup.lock
flock -n 9 || { echo 'A backup is already running; wait before releasing'; exit 1; }
app=/opt/hariom/app
deploy="$app/deploy/aws-ec2"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
work="/opt/hariom/releases/$stamp-$release"
mkdir -p "$work/source"
compose() { docker compose --env-file "$deploy/.env" --project-directory "$deploy" "$@"; }
old_container="$(compose ps -q erp-app)"
old_image="$(docker inspect --format '{{.Image}}' "$old_container")"
# The repository:tag compose runs erp-app under (e.g. hariom-release:<tag>); rollback must retag this name.
app_image_ref="$(docker inspect --format '{{.Config.Image}}' "$old_container")"
docker image tag "$old_image" "hariom-rollback:$stamp"
printf '%s\n' "$old_image" > "$work/previous-image"
cp /opt/hariom/DEPLOYED_COMMIT "$work/previous-commit"
tar --exclude='./.git' --exclude='./apps/web-ui/node_modules' --exclude='./apps/web-ui/.next' --exclude='./hariom-erp/venv-runtime' --exclude='./output' --exclude='./deploy/aws-ec2/.env' -C "$app" -czf "$work/previous-source.tar.gz" .
curl --fail --location --retry 3 --max-time 120 "https://github.com/dev2495/hari-om-paper-2-local-recovery/archive/$release.tar.gz" -o "$work/release.tar.gz"
tar -xzf "$work/release.tar.gz" --strip-components=1 -C "$work/source"
[[ -f "$work/source/deploy/aws-ec2/migrations/20260910-production.sql" ]]
activated=0
maintenance_started=0
backup_timer_active=0
restore_timer_active=0
systemctl is-active --quiet hariom-backup.timer && backup_timer_active=1
systemctl is-active --quiet hariom-restore-drill.timer && restore_timer_active=1
record_maintenance() {
  python3 - "$work/maintenance-state.json" "$1" "$backup_timer_active" "$restore_timer_active" <<'PY'
import json, os, sys
from pathlib import Path
target=Path(sys.argv[1]);temporary=target.with_name(target.name+'.tmp')
with temporary.open('w') as stream:
    json.dump({'phase':sys.argv[2],'backup_timer_active':int(sys.argv[3]),'restore_timer_active':int(sys.argv[4])},stream)
    stream.flush();os.fsync(stream.fileno())
os.replace(temporary,target)
directory=os.open(target.parent,os.O_RDONLY)
try:os.fsync(directory)
finally:os.close(directory)
PY
}
restore_schedules() {
  [[ "$backup_timer_active" == 0 ]] || systemctl start hariom-backup.timer
  [[ "$restore_timer_active" == 0 ]] || systemctl start hariom-restore-drill.timer
  record_maintenance RESUMED
}
wait_runtime() {
  local attempt
  for attempt in $(seq 1 60); do
    if compose exec -T erp-app curl -fsS --max-time 10 http://127.0.0.1:14000/health/ready >/dev/null 2>&1 \
       && compose exec -T erp-app curl -fsS --max-time 10 http://127.0.0.1:13000/login >/dev/null 2>&1; then return 0; fi
    sleep 5
  done
  return 1
}
rollback() {
  code="${1:-$?}"
  trap - ERR INT TERM
  if [[ "$activated" == 1 ]]; then
    current_ref="$(docker inspect --format '{{.Config.Image}}' "$(compose ps -q erp-app)" 2>/dev/null || echo "$app_image_ref")"
    for ref in "$app_image_ref" "$current_ref"; do docker image tag "$old_image" "$ref" || true; done
    compose up -d --no-deps --no-build --force-recreate erp-app || true
    [[ "$(docker inspect --format '{{.Image}}' "$(compose ps -q erp-app)")" == "$old_image" ]] \
      && echo "Rollback: erp-app is running the previous image $old_image" >&2 \
      || echo "Rollback WARNING: erp-app is not on the previous image; run: docker image tag $old_image <compose image> && docker compose up -d --no-build erp-app" >&2
  fi
  tar -xzf "$work/previous-source.tar.gz" -C "$app"
  compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile || true
  if [[ "$maintenance_started" == 1 ]]; then
    if wait_runtime; then
      restore_schedules
    else
      record_maintenance RECOVERY_REQUIRED
      echo "Rollback readiness failed. Backup timers remain stopped; original states are in $work/maintenance-state.json" >&2
    fi
  fi
  echo "Release failed ($code). Previous image/source retained in $work. Inspect health before further action." >&2
  exit "$code"
}
trap rollback ERR
trap 'rollback 130' INT
trap 'rollback 143' TERM
record_maintenance PREPARING
maintenance_started=1
systemctl stop hariom-backup.timer hariom-restore-drill.timer
record_maintenance STOPPED
# No delete option: production .env and runtime state remain in place.
cp -a "$work/source/." "$app/"
compose build erp-app
# New backup format records exact table counts while the app is quiet.
ERP_BACKUP_LOCK_HELD=1 BACKUP_RESULT_FILE="$work/pre-activation-backup.json" bash "$deploy/backup_databases.sh"
db_user="$(sed -n 's/^DB_USER=//p' "$deploy/.env" | tail -n 1)"
compose exec -T postgres psql -U "$db_user" -d productiondb -v ON_ERROR_STOP=1 < "$deploy/migrations/20260910-production.sql"
# Refuse cutover if stock was created using the old reversed section mapping.
# Resolve those physical records explicitly instead of silently relabelling stock.
compose stop -t 90 erp-app
activated=1
compose exec -T postgres psql -U "$db_user" -d inventorydb -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM paper_reels WHERE parent_reel_id IS NOT NULL AND physical_form = 'REEL') OR
     EXISTS (SELECT 1 FROM reel_issues i JOIN paper_reels r ON r.id=i.reel_id
             WHERE i.status='OPEN' AND ((r.physical_form='COIL' AND i.issue_section='SLITTING_SECTION') OR
                                       (r.physical_form='REEL' AND i.issue_section='WINDER_SECTION'))) THEN
    RAISE EXCEPTION 'Legacy paper routing needs reviewed reconciliation before this release';
  END IF;
END $$;
SQL
compose exec -T postgres psql -U "$db_user" -d inventorydb -v ON_ERROR_STOP=1 < "$deploy/migrations/20260928-procurement.sql"
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
ERP_BACKUP_LOCK_HELD=1 BACKUP_RESULT_FILE="$work/post-activation-backup.json" bash "$deploy/backup_databases.sh"
restore_key="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["s3_key"])' "$work/post-activation-backup.json")"
restore_sha="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sha256"])' "$work/post-activation-backup.json")"
RESTORE_BACKUP_KEY="$restore_key" RESTORE_ARCHIVE_SHA256="$restore_sha" bash "$deploy/restore_drill.sh" > "$work/restore-result.txt"
wait_public
bash "$deploy/publish_health_metrics.sh"
restore_schedules
printf '%s\n' "$release" > /opt/hariom/DEPLOYED_COMMIT
trap - ERR INT TERM
echo "Release accepted: $release; evidence=$work; rollback=hariom-rollback:$stamp"
