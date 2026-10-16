#!/usr/bin/env bash
# Run from AWS CloudShell (ap-south-1) after cloudshell_release.sh has deployed a
# release that contains data/client_specs/. Takes a backup, then loads the client's
# specification workbook as approved specs through the app's own APIs (inside the
# erp-app container, as the bootstrap Owner/Admin). Idempotent: a re-run reports
# "already approved" and creates nothing.
# Usage: bash cloudshell_import_client_specs.sh <40-char deployed sha> [PLANT_A PLANT_B]
set -euo pipefail
deployed="${1:?exact 40-character deployed Git commit required}"
shift
[[ "$deployed" =~ ^[a-f0-9]{40}$ ]]
plants="${*:-PLANT_A PLANT_B}"
[[ "$plants" =~ ^[A-Za-z0-9_\ -]+$ ]] || { echo "Plants must be plant codes such as PLANT_A PLANT_B"; exit 1; }
region="${AWS_REGION:-ap-south-1}"
ip="${ERP_ELASTIC_IP:-35.154.224.14}"
data="data/client_specs/specification_sheet_completed.json"

iid="$(aws ec2 describe-instances --region "$region" --filters "Name=ip-address,Values=$ip" \
  --query 'Reservations[].Instances[].InstanceId' --output text)"
[[ "$iid" == i-* ]] || { echo "No EC2 instance owns $ip in $region"; exit 1; }
ping="$(aws ssm describe-instance-information --region "$region" --filters "Key=InstanceIds,Values=$iid" \
  --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || true)"
echo "Host $iid · SSM agent: ${ping:-unknown}"
[[ "$ping" == "Online" ]] || { echo "SSM agent is not Online on $iid; start it and retry."; exit 1; }

host_script=$(cat <<EOF
set -euo pipefail
app=/opt/hariom/app
deploy=\$app/deploy/aws-ec2
[[ "\$(cat /opt/hariom/DEPLOYED_COMMIT)" == "$deployed" ]] || { echo "Deployed commit is \$(cat /opt/hariom/DEPLOYED_COMMIT), not $deployed; release first"; exit 3; }
compose() { docker compose --env-file "\$deploy/.env" --project-directory "\$deploy" "\$@"; }
compose exec -T erp-app test -f "$data" || { echo "This release has no $data"; exit 3; }
stamp="\$(date -u +%Y%m%dT%H%M%SZ)"
work="/opt/hariom/imports/\$stamp-client-specs"
mkdir -p "\$work"
echo "Backup before import"
BACKUP_RESULT_FILE="\$work/pre-import-backup.json" bash "\$deploy/backup_databases.sh"
for attempt in \$(seq 1 60); do
  compose exec -T erp-app curl -fsS --max-time 10 http://127.0.0.1:14000/health/ready >/dev/null 2>&1 && break
  sleep 5
done
compose exec -T erp-app curl -fsS --max-time 10 http://127.0.0.1:14000/health/ready >/dev/null
status=0
for plant in $plants; do
  echo "=== Importing into \$plant"
  set +e
  compose exec -T erp-app python scripts/client_specs/import_client_specs.py --data "$data" --plant "\$plant" --report "/tmp/client-specs-\$plant.json" > "\$work/import-\$plant.log" 2>&1
  code=\$?
  set -e
  compose cp "erp-app:/tmp/client-specs-\$plant.json" "\$work/report-\$plant.json" >/dev/null 2>&1 || true
  grep -E '^(Importing|Summary|Recipe pending|WARNING)' "\$work/import-\$plant.log" || true
  grep -E '^✗' "\$work/import-\$plant.log" | head -n 20 || true
  [[ "\$code" == 0 ]] || status=\$code
done
echo "IMPORT_EXIT=\$status evidence=\$work"
exit \$status
EOF
)
encoded="$(printf '%s' "$host_script" | base64 -w0)"
cmd_id="$(aws ssm send-command --region "$region" --instance-ids "$iid" --document-name AWS-RunShellScript \
  --comment "Hari Om client spec import ${deployed:0:12}" --timeout-seconds 600 \
  --parameters "{\"commands\":[\"echo $encoded | base64 -d > /tmp/hariom_import.sh && sudo bash /tmp/hariom_import.sh\"],\"executionTimeout\":[\"3600\"]}" \
  --query 'Command.CommandId' --output text)"
echo "SSM command $cmd_id started (backup, then import)."
status=Pending
for _ in $(seq 1 240); do
  sleep 15
  status="$(aws ssm get-command-invocation --region "$region" --command-id "$cmd_id" --instance-id "$iid" \
    --query Status --output text 2>/dev/null || echo Pending)"
  case "$status" in Pending|InProgress|Delayed) printf '.';; *) break;; esac
done
echo
echo "SSM status: $status"
aws ssm get-command-invocation --region "$region" --command-id "$cmd_id" --instance-id "$iid" \
  --query '[StandardOutputContent,StandardErrorContent]' --output text | tail -n 60
[[ "$status" == "Success" ]]
