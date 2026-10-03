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
reset_script="${ERP_RESET_SCRIPT:-$app/scripts/season/reset_testing_data.py}"
[[ -f "$reset_script" && ! -L "$reset_script" ]] || { echo 'Reviewed reset script is missing or is a symlink' >&2; exit 1; }
if [[ -n "${ERP_RESET_SCRIPT:-}" ]]; then
  # A routing-guard reset may be required before the new app can be deployed.
  # Stage ONLY the reviewed tooling under /opt/hariom; keep live source intact.
  canonical_reset_script="$(python3 -c 'from pathlib import Path; import sys; print(Path(sys.argv[1]).resolve(strict=True))' "$reset_script")"
  [[ "$canonical_reset_script" == "$reset_script" && "$reset_script" == /opt/hariom/* && "$reset_script" != *'/../'* \
     && "$reset_script" != *'/./'* && "${ERP_RESET_SCRIPT_SHA256:-}" =~ ^[a-f0-9]{64}$ ]] \
    || { echo 'Staged reset override requires an absolute /opt/hariom path and exact SHA-256' >&2; exit 1; }
  [[ "$(sha256sum "$reset_script" | cut -d ' ' -f 1)" == "$ERP_RESET_SCRIPT_SHA256" ]] \
    || { echo 'Staged reset script checksum differs; stop and review' >&2; exit 1; }
fi
maintenance="$archive/maintenance-state.json"
compose() { docker compose --env-file "$deploy/.env" --project-directory "$deploy" "$@"; }
postgres="$(compose ps -q postgres)"
[[ -n "$postgres" ]]
if [[ ! -x /opt/hariom/reset-venv/bin/python ]]; then
  python3 -m venv /opt/hariom/reset-venv
  /opt/hariom/reset-venv/bin/python -m pip install --disable-pip-version-check sqlalchemy==2.0.23 psycopg2-binary==2.9.9
fi
mutating=1
if [[ "$mode" == preview ]]; then
  mutating=0
elif [[ "$mode" == apply && -f "$archive/reset-manifest.json" && -f "$maintenance" ]]; then
  replay_complete="$(python3 - "$archive/reset-manifest.json" "$maintenance" <<'PY'
import json, sys
manifest=json.load(open(sys.argv[1]));maintenance=json.load(open(sys.argv[2]))
print(int(manifest.get('status')=='COMPLETE' and maintenance.get('phase')=='RESUMED'))
PY
)"
  [[ "$replay_complete" != 1 ]] || mutating=0
fi
record_phase() {
  python3 - "$maintenance" "$1" <<'PY'
import json, os, sys
from pathlib import Path
target=Path(sys.argv[1]);state=json.loads(target.read_text());state['phase']=sys.argv[2]
temporary=target.with_name(target.name+'.tmp')
with temporary.open('w') as stream:
    os.chmod(temporary,0o600);json.dump(state,stream);stream.flush();os.fsync(stream.fileno())
os.replace(temporary,target)
directory=os.open(target.parent,os.O_RDONLY)
try:os.fsync(directory)
finally:os.close(directory)
PY
}
if [[ "$mutating" == 1 ]]; then
  # A running backup can restart the app. Share its lock before stopping the
  # timers or runtime, and preserve timers that were deliberately paused.
  mkdir -p /opt/hariom/backups
  exec 9>/opt/hariom/backups/backup.lock
  flock -n 9 || { echo 'A backup is running; wait for it to finish before resetting'; exit 1; }
  backup_timer_active=0
  restore_timer_active=0
  systemctl is-active --quiet hariom-backup.timer && backup_timer_active=1
  systemctl is-active --quiet hariom-restore-drill.timer && restore_timer_active=1
  mkdir -p "$archive"
  chmod 0700 "$archive"
  # A failed apply deliberately leaves timers stopped. Recovery must restore
  # their ORIGINAL states, not interpret that temporary stop as an admin pause.
  timer_states="$(python3 - "$maintenance" "$expected" "$reset_id" "$backup_timer_active" "$restore_timer_active" <<'PY'
import json, os, sys
from datetime import datetime, timezone
from pathlib import Path
target=Path(sys.argv[1]);state=None
if target.exists():
    state=json.loads(target.read_text())
    if state.get('release_commit')!=sys.argv[2] or state.get('reset_id')!=sys.argv[3]:
        raise RuntimeError('Maintenance state belongs to another reviewed reset/release')
    if state.get('phase')=='RESUMED':state=None
if state is None:
    state={'release_commit':sys.argv[2],'reset_id':sys.argv[3],
           'backup_timer_active':int(sys.argv[4]),'restore_timer_active':int(sys.argv[5]),
           'captured_at':datetime.now(timezone.utc).isoformat()}
if state.get('backup_timer_active') not in (0,1) or state.get('restore_timer_active') not in (0,1):
    raise RuntimeError('Invalid original timer state; inspect before recovery')
state['phase']='PREPARING';temporary=target.with_name(target.name+'.tmp')
with temporary.open('w') as stream:
    os.chmod(temporary,0o600);json.dump(state,stream);stream.flush();os.fsync(stream.fileno())
os.replace(temporary,target)
directory=os.open(target.parent,os.O_RDONLY)
try:os.fsync(directory)
finally:os.close(directory)
print(state['backup_timer_active'],state['restore_timer_active'])
PY
)"
  read -r backup_timer_active restore_timer_active <<< "$timer_states"
  systemctl stop hariom-backup.timer hariom-restore-drill.timer
  compose stop -t 90 erp-app
  record_phase OFFLINE
fi
export RESET_MODE="$mode" RESET_ARCHIVE="$archive" RESET_ID="$reset_id" RESET_ENV="$deploy/.env" ERP_RELEASE_COMMIT="$expected" ERP_PG_CONTAINER="$postgres" RESET_SCRIPT="$reset_script"
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
runpy.run_path(os.environ['RESET_SCRIPT'],run_name='__main__')
PY
code=$?
set -e
echo "RESET_EXIT=$code ARCHIVE=$archive"
if [[ "$code" == 0 && "$mutating" == 1 ]]; then
  record_phase STARTING
  compose up -d --no-deps --no-build erp-app
  ready=0
  for attempt in $(seq 1 60); do
    if compose exec -T erp-app curl -fsS --max-time 10 http://127.0.0.1:14000/health/ready > "$archive/post-reset-readiness.json" 2>/dev/null; then ready=1; break; fi
    sleep 5
  done
  if [[ "$ready" != 1 ]]; then
    compose stop -t 90 erp-app
    record_phase RECOVERY_REQUIRED
    echo 'Recovery/reset succeeded, but application readiness failed. Runtime and timers remain stopped; inspect the archive.' >&2
    exit 1
  fi
  [[ "$backup_timer_active" == 0 ]] || systemctl start hariom-backup.timer
  [[ "$restore_timer_active" == 0 ]] || systemctl start hariom-restore-drill.timer
  record_phase RESUMED
elif [[ "$code" != 0 && "$mutating" == 1 ]]; then
  record_phase RECOVERY_REQUIRED
  echo 'Runtime and backup timers remain stopped. Inspect the manifest; recover all seven databases before restart.' >&2
fi
exit "$code"
