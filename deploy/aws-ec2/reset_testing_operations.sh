#!/usr/bin/env bash
# Run on the existing ERP host through SSM, after reviewing the preview.
# Usage: bash reset_testing_operations.sh preview|apply|restore <deployed-sha> <reset-id>
set -euo pipefail
umask 077
mode="${1:?preview, apply or restore required}"
expected="${2:?exact deployed commit required}"
reset_id="${3:?unique reviewed reset ID required}"
[[ "$mode" =~ ^(preview|apply|restore)$ && "$expected" =~ ^[a-f0-9]{40}$ && "$reset_id" =~ ^[a-zA-Z0-9_-]{8,100}$ ]]
exec 8>/opt/hariom/release.lock
flock -n 8 || { echo 'A release/reset is already running'; exit 1; }
[[ "$(cat /opt/hariom/DEPLOYED_COMMIT)" == "$expected" ]] || { echo 'Deployed release changed; review before resetting'; exit 1; }
app=/opt/hariom/app
deploy="$app/deploy/aws-ec2"
archive="/opt/hariom/testing-resets/$reset_id"
compose() { docker compose --env-file "$deploy/.env" --project-directory "$deploy" "$@"; }
postgres="$(compose ps -q postgres)"
[[ -n "$postgres" ]]
if [[ ! -x /opt/hariom/reset-venv/bin/python ]]; then
  python3 -m venv /opt/hariom/reset-venv
  /opt/hariom/reset-venv/bin/python -m pip install --disable-pip-version-check sqlalchemy==2.0.23 psycopg2-binary==2.9.9
fi
if [[ "$mode" != preview ]]; then
  # A running backup can restart the app. Share its lock before stopping the
  # timers or runtime, and preserve timers that were deliberately paused.
  mkdir -p /opt/hariom/backups
  exec 9>/opt/hariom/backups/backup.lock
  flock -n 9 || { echo 'A backup is running; wait for it to finish before resetting'; exit 1; }
  backup_timer_active=0
  restore_timer_active=0
  systemctl is-active --quiet hariom-backup.timer && backup_timer_active=1
  systemctl is-active --quiet hariom-restore-drill.timer && restore_timer_active=1
  systemctl stop hariom-backup.timer hariom-restore-drill.timer
  compose stop -t 90 erp-app
fi
export RESET_MODE="$mode" RESET_ARCHIVE="$archive" RESET_ID="$reset_id" RESET_ENV="$deploy/.env" ERP_RELEASE_COMMIT="$expected" ERP_PG_CONTAINER="$postgres"
export RESET_DB_HOST="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$postgres")"
set +e
/opt/hariom/reset-venv/bin/python - <<'PY'
import os, sys
from pathlib import Path
for line in Path(os.environ['RESET_ENV']).read_text().splitlines():
    key,sep,value=line.partition('=')
    if sep and key in {'DB_USER','DB_PASSWORD','DB_PORT'}:os.environ[key]=value.strip().strip('"').strip("'")
os.environ['DB_HOST']=os.environ['RESET_DB_HOST']
os.environ['ERP_DB_PREFIX']=''
mode=os.environ['RESET_MODE']
sys.argv=['reset_testing_data.py','--archive',os.environ['RESET_ARCHIVE'],'--reset-id',os.environ['RESET_ID']]
if mode=='apply':sys.argv+=['--apply','--confirm','ALL CURRENT OPERATIONS ARE TEST DATA']
if mode=='restore':sys.argv+=['--restore','--confirm','RESTORE ALL SEVEN DATABASES FROM THIS BACKUP']
import runpy
runpy.run_path('/opt/hariom/app/scripts/season/reset_testing_data.py',run_name='__main__')
PY
code=$?
set -e
echo "RESET_EXIT=$code ARCHIVE=$archive"
if [[ "$code" == 0 && "$mode" != preview ]]; then
  compose up -d --no-deps --no-build erp-app
  ready=0
  for attempt in $(seq 1 60); do
    if compose exec -T erp-app curl -fsS --max-time 10 http://127.0.0.1:14000/health/ready > "$archive/post-reset-readiness.json" 2>/dev/null; then ready=1; break; fi
    sleep 5
  done
  if [[ "$ready" != 1 ]]; then
    compose stop -t 90 erp-app
    echo 'Recovery/reset succeeded, but application readiness failed. Runtime and timers remain stopped; inspect the archive.' >&2
    exit 1
  fi
  [[ "$backup_timer_active" == 0 ]] || systemctl start hariom-backup.timer
  [[ "$restore_timer_active" == 0 ]] || systemctl start hariom-restore-drill.timer
elif [[ "$code" != 0 && "$mode" != preview ]]; then
  echo 'Runtime and backup timers remain stopped. Inspect the manifest; recover all seven databases before restart.' >&2
fi
exit "$code"
