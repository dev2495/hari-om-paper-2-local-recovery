#!/usr/bin/env bash
# Run from AWS CloudShell (ap-south-1). Finds the ERP host by its Elastic IP and
# runs release_verified.sh on it through SSM Run Command, then reports health.
# Usage: bash cloudshell_release.sh <40-char release sha>
set -euo pipefail
release="${1:?exact 40-character Git commit required}"
[[ "$release" =~ ^[a-f0-9]{40}$ ]]
region="${AWS_REGION:-ap-south-1}"
ip="${ERP_ELASTIC_IP:-35.154.224.14}"
site="${ERP_SITE_HOST:-35-154-224-14.sslip.io}"
# Commit that snapshots the tree the host was last deployed from (used only
# when the host has no DEPLOYED_COMMIT marker yet).
snapshot="f2d248b05b58b4ca0194a18d92c22db62a476258"
repo="https://raw.githubusercontent.com/dev2495/hari-om-paper-2-local-recovery"

iid="$(aws ec2 describe-instances --region "$region" --filters "Name=ip-address,Values=$ip" \
  --query 'Reservations[].Instances[].InstanceId' --output text)"
[[ "$iid" == i-* ]] || { echo "No EC2 instance owns $ip in $region"; exit 1; }
ping="$(aws ssm describe-instance-information --region "$region" --filters "Key=InstanceIds,Values=$iid" \
  --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || true)"
echo "Host $iid · SSM agent: ${ping:-unknown}"
[[ "$ping" == "Online" ]] || { echo "SSM agent is not Online on $iid; start it (or use EC2 Instance Connect) and retry."; exit 1; }

host_script=$(cat <<EOF
set -euo pipefail
app=/opt/hariom/app
if [[ ! -f \$app/deploy/aws-ec2/docker-compose.yml ]]; then
  echo "APP_DIR_MISSING: \$app"; docker ps --format '{{.Names}} {{.Label "com.docker.compose.project.working_dir"}}'; exit 3
fi
if [[ ! -s /opt/hariom/DEPLOYED_COMMIT ]]; then
  echo "$snapshot" > /opt/hariom/DEPLOYED_COMMIT
  echo "Initialised /opt/hariom/DEPLOYED_COMMIT with live snapshot $snapshot"
fi
echo "Currently deployed: \$(cat /opt/hariom/DEPLOYED_COMMIT)"
curl -fsSL "$repo/$release/deploy/aws-ec2/release_verified.sh" -o /opt/hariom/release_verified.sh
set +e
bash /opt/hariom/release_verified.sh "$release" "\$(cat /opt/hariom/DEPLOYED_COMMIT)" > "/opt/hariom/release-$release.log" 2>&1
code=\$?
set -e
tail -n 40 "/opt/hariom/release-$release.log"
echo "RELEASE_EXIT=\$code DEPLOYED_COMMIT=\$(cat /opt/hariom/DEPLOYED_COMMIT)"
exit \$code
EOF
)
encoded="$(printf '%s' "$host_script" | base64 -w0)"
cmd_id="$(aws ssm send-command --region "$region" --instance-ids "$iid" --document-name AWS-RunShellScript \
  --comment "Hari Om release ${release:0:12}" --timeout-seconds 600 \
  --parameters "{\"commands\":[\"echo $encoded | base64 -d > /tmp/hariom_release.sh && sudo bash /tmp/hariom_release.sh\"],\"executionTimeout\":[\"3600\"]}" \
  --query 'Command.CommandId' --output text)"
echo "SSM command $cmd_id started; the release takes several minutes (build, backup, restore drill)."

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
echo "--- public health"
curl -fsS --max-time 20 "https://$site/healthz" && echo || echo "healthz FAILED"
[[ "$status" == "Success" ]]
