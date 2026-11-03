#!/usr/bin/env bash
# Go-live data steps (owner decisions 2 Nov 2026), run from AWS CloudShell (ap-south-1) after the
# release that carries data/client_import_2026-11-02/ is live. One step per call, in this order:
#
#   reset-preview  <reset-id>      stops the app (maintenance window starts) and writes the reviewed
#                                  reset manifest; nothing is deleted. The app STAYS STOPPED so the
#                                  data cannot change before apply (the reset refuses changed data).
#   reset-apply    <reset-id>      verified backup of all 7 DBs, clears transactions, restarts the app
#   reset-cancel                   restarts the app without resetting (abandon a reviewed preview)
#   cleanup-preview                list of test specs to delete and test masters to deactivate
#   cleanup-apply  <fingerprint>   backup, then applies exactly the reviewed list (fingerprint from the preview)
#   packing-preview | packing-apply   spec packing from the client's SPECS sheet (apply takes a backup first)
#   orders-preview  | orders-apply    outstanding Tally sales orders, approved (apply takes a backup first)
#   reels-preview   | reels-apply     paper reel register (closing 31 Oct 2026) as opening stock dated 1 Nov 2026,
#                                     each reel keeping its AIT number (apply takes a backup first)
#
# Usage: bash cloudshell_golive_data.sh <40-char deployed sha> <step> [reset-id | fingerprint]
# Options (export before running): ERP_IMPORT_PLANT (default PLANT_A), ERP_IMPORT_AS (Owner/Admin
# e-mail the imports run as; default the bootstrap admin), ERP_CLEANUP_KEEP_USERS ("a@x b@y" accounts
# that must stay active), ERP_ORDERS_NO_CONFIRM_ALIASES=1 (leave out party aliases marked "confirm").
# Reports: printed here and saved under ./golive-reports/ in CloudShell; full JSON on the host in
# /opt/hariom/imports/<stamp>-<step>/ (resets: /opt/hariom/testing-resets/<reset-id>/).
set -euo pipefail
deployed="${1:?exact 40-character deployed Git commit required}"
step="${2:?step required: reset-preview|reset-apply|reset-cancel|cleanup-preview|cleanup-apply|packing-preview|packing-apply|orders-preview|orders-apply|reels-preview|reels-apply}"
arg="${3:-}"
[[ "$deployed" =~ ^[a-f0-9]{40}$ ]] || { echo "Deployed commit must be the full 40-character sha"; exit 1; }
[[ "$step" =~ ^(reset-preview|reset-apply|reset-cancel|cleanup-preview|cleanup-apply|packing-preview|packing-apply|orders-preview|orders-apply|reels-preview|reels-apply)$ ]] || { echo "Unknown step $step"; exit 1; }
if [[ "$step" == reset-preview || "$step" == reset-apply ]]; then
  [[ "$arg" =~ ^[a-zA-Z0-9_-]{8,100}$ ]] || { echo "reset steps need a reset id (8-100 letters, digits, - or _), the same for preview and apply"; exit 1; }
fi
if [[ "$step" == cleanup-apply ]]; then
  [[ "$arg" =~ ^[a-f0-9]{64}$ ]] || { echo "cleanup-apply needs the 64-character fingerprint printed by cleanup-preview"; exit 1; }
fi
plant="${ERP_IMPORT_PLANT:-PLANT_A}"
[[ "$plant" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "ERP_IMPORT_PLANT must be a plant code"; exit 1; }
as_user="${ERP_IMPORT_AS:-}"
[[ -z "$as_user" || "$as_user" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$ ]] || { echo "ERP_IMPORT_AS must be an e-mail address"; exit 1; }
keep_users="${ERP_CLEANUP_KEEP_USERS:-}"
[[ -z "$keep_users" || "$keep_users" =~ ^[A-Za-z0-9._%+@\ -]+$ ]] || { echo "ERP_CLEANUP_KEEP_USERS must be e-mail addresses separated by spaces"; exit 1; }
no_confirm="${ERP_ORDERS_NO_CONFIRM_ALIASES:-0}"
region="${AWS_REGION:-ap-south-1}"
ip="${ERP_ELASTIC_IP:-35.154.224.14}"
data="data/client_import_2026-11-02"

iid="$(aws ec2 describe-instances --region "$region" --filters "Name=ip-address,Values=$ip" \
  --query 'Reservations[].Instances[].InstanceId' --output text)"
[[ "$iid" == i-* ]] || { echo "No EC2 instance owns $ip in $region"; exit 1; }
ping="$(aws ssm describe-instance-information --region "$region" --filters "Key=InstanceIds,Values=$iid" \
  --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || true)"
echo "Host $iid · SSM agent: ${ping:-unknown} · step $step"
[[ "$ping" == "Online" ]] || { echo "SSM agent is not Online on $iid; start it and retry."; exit 1; }

# read (not $(cat ...)): case patterns in the host script would close a command substitution.
IFS= read -r -d '' host_script <<EOF || true
set -euo pipefail
app=/opt/hariom/app
deploy=\$app/deploy/aws-ec2
[[ "\$(cat /opt/hariom/DEPLOYED_COMMIT)" == "$deployed" ]] || { echo "Deployed commit is \$(cat /opt/hariom/DEPLOYED_COMMIT), not $deployed; release first"; exit 3; }
compose() { docker compose --env-file "\$deploy/.env" --project-directory "\$deploy" "\$@"; }
emit() { # name file: the report travels gzip+base64 so CloudShell can save it whole
  [[ -s "\$2" ]] || return 0
  echo "REPORT_BEGIN \$1"; gzip -c "\$2" | base64 -w0; echo; echo "REPORT_END \$1"
}
ready() {
  for attempt in \$(seq 1 60); do
    compose exec -T erp-app curl -fsS --max-time 10 http://127.0.0.1:14000/health/ready >/dev/null 2>&1 && return 0
    sleep 5
  done
  echo "Application is not ready"; return 1
}
step="$step"
if [[ "\$step" == reset-cancel ]]; then
  compose up -d --no-deps --no-build erp-app
  ready
  echo "Application restarted; no data was reset. STEP_EXIT=0"
  exit 0
fi
if [[ "\$step" == reset-* ]]; then
  mode="\${step#reset-}"
  if [[ "\$mode" == preview ]]; then
    # The reset compares the apply-time data with this preview and refuses any difference
    # (logins, notifications, jobs). Keep the app stopped until reset-apply or reset-cancel.
    echo "Stopping the application for the go-live maintenance window"
    compose stop -t 90 erp-app
  fi
  set +e
  bash "\$deploy/reset_testing_operations.sh" "\$mode" "$deployed" "$arg"
  code=\$?
  set -e
  manifest="/opt/hariom/testing-resets/$arg/reset-manifest.json"
  if [[ -f "\$manifest" ]]; then
    python3 - "\$manifest" > "/opt/hariom/testing-resets/$arg/reset-summary.txt" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
print(f"Reset {m['reset_id']} status {m['status']} release {m.get('release_commit')}")
print(f"REVIEW_FINGERPRINT={m.get('review_fingerprint')}")
for name, d in m["databases"].items():
    rows = {t: d["before"][t] for t in d["clear"] if d["before"].get(t)}
    print(f"\n{name}: CLEAR {len(d['clear'])} tables ({sum(rows.values())} rows), KEEP {len(d['keep'])} tables")
    print("  clear (rows): " + ", ".join(f"{t} {n}" for t, n in sorted(rows.items())))
    print("  clear (empty): " + ", ".join(t for t in d["clear"] if not d["before"].get(t)))
    print("  keep (rows): " + ", ".join(f"{t} {d['before'].get(t, 0)}" for t in d["keep"]))
PY
    emit reset-$arg-\$mode "/opt/hariom/testing-resets/$arg/reset-summary.txt"
  fi
  echo "STEP_EXIT=\$code"
  exit \$code
fi
compose exec -T erp-app test -f "$data/sales_orders.json" || { echo "This release has no $data"; exit 3; }
if [[ "\$step" == reels-* ]]; then
  compose exec -T erp-app test -f data/client_import_2026-11-03/reel_stock.json || { echo "This release has no data/client_import_2026-11-03"; exit 3; }
fi
stamp="\$(date -u +%Y%m%dT%H%M%SZ)"
work="/opt/hariom/imports/\$stamp-\$step"
mkdir -p "\$work"
if [[ "\$step" == *-apply ]]; then
  echo "Backup before \$step"
  BACKUP_RESULT_FILE="\$work/pre-step-backup.json" bash "\$deploy/backup_databases.sh"
fi
ready
login=()
[[ -z "$as_user" ]] || login=(-e "ERP_IMPORT_AS=$as_user")
case "\$step" in
  cleanup-*)
    keep=()
    for email in $keep_users; do keep+=(--keep-user "\$email"); done
    extra=()
    [[ "\$step" == cleanup-apply ]] && extra=(--apply --expect-fingerprint "$arg")
    cmd=(python scripts/season/cleanup_test_masters.py --out /tmp/golive-\$step "\${keep[@]}" "\${extra[@]}")
    out_dir=/tmp/golive-\$step
    report_name=\$([[ "\$step" == cleanup-apply ]] && echo cleanup-applied || echo cleanup-preview)
    ;;
  packing-*)
    extra=(); [[ "\$step" == packing-apply ]] && extra=(--apply)
    cmd=(python scripts/client_import/apply_spec_packing.py --plant "$plant" --report /tmp/golive-\$step/report.json "\${extra[@]}")
    out_dir=/tmp/golive-\$step; report_name=report
    ;;
  orders-*)
    extra=(); [[ "\$step" == orders-apply ]] && extra=(--apply)
    [[ "$no_confirm" == 1 ]] && extra+=(--no-confirm-aliases)
    cmd=(python scripts/client_import/import_sales_orders.py --plant "$plant" --report /tmp/golive-\$step/report.json "\${extra[@]}")
    out_dir=/tmp/golive-\$step; report_name=report
    ;;
  reels-*)
    extra=(); [[ "\$step" == reels-apply ]] && extra=(--apply)
    cmd=(python scripts/client_import/import_opening_reels.py --plant "$plant" --report /tmp/golive-\$step/report.json "\${extra[@]}")
    out_dir=/tmp/golive-\$step; report_name=report
    ;;
esac
set +e
compose exec -T "\${login[@]}" erp-app "\${cmd[@]}" > "\$work/run.log" 2>&1
code=\$?
set -e
compose cp "erp-app:\$out_dir/." "\$work/" >/dev/null 2>&1 || true
grep -E '^(Signed in|Spec packing|Tally sales|Reel register|POSTED|NOT POSTED|CLEANUP_FINGERPRINT|Nothing left|\{)' "\$work/run.log" || true
if [[ "\$code" != 0 ]]; then
  echo "--- \$step stopped (exit \$code); last lines of its log:"
  tail -n 25 "\$work/run.log"
fi
emit "\$step" "\$work/\$report_name.txt"
echo "STEP_EXIT=\$code evidence=\$work"
exit \$code
EOF
encoded="$(printf '%s' "$host_script" | base64 -w0)"
cmd_id="$(aws ssm send-command --region "$region" --instance-ids "$iid" --document-name AWS-RunShellScript \
  --comment "Hari Om go-live data $step ${deployed:0:12}" --timeout-seconds 600 \
  --parameters "{\"commands\":[\"echo $encoded | base64 -d > /tmp/hariom_golive_data.sh && sudo bash /tmp/hariom_golive_data.sh\"],\"executionTimeout\":[\"3600\"]}" \
  --query 'Command.CommandId' --output text)"
echo "SSM command $cmd_id started ($step)."
status=Pending
for _ in $(seq 1 240); do
  sleep 15
  status="$(aws ssm get-command-invocation --region "$region" --command-id "$cmd_id" --instance-id "$iid" \
    --query Status --output text 2>/dev/null || echo Pending)"
  case "$status" in Pending|InProgress|Delayed) printf '.';; *) break;; esac
done
echo
echo "SSM status: $status"
output="$(aws ssm get-command-invocation --region "$region" --command-id "$cmd_id" --instance-id "$iid" \
  --query StandardOutputContent --output text)"
mkdir -p golive-reports
printf '%s\n' "$output" | awk '/^REPORT_BEGIN /{name=$2; getline; print > ("golive-reports/" name ".b64"); next} {print}' | grep -v '^REPORT_END ' || true
for encoded_report in golive-reports/*.b64; do
  [[ -e "$encoded_report" ]] || continue
  target="${encoded_report%.b64}.txt"
  base64 -d < "$encoded_report" | gunzip > "$target" && rm -f "$encoded_report"
  echo "===== $target ====="
  cat "$target"
done
aws ssm get-command-invocation --region "$region" --command-id "$cmd_id" --instance-id "$iid" \
  --query StandardErrorContent --output text | tail -n 20
[[ "$status" == "Success" ]]
