#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/hariom/app/deploy/aws-ec2}"

chmod 0755 "${DEPLOY_DIR}/backup_databases.sh"
chmod 0755 "${DEPLOY_DIR}/restore_drill.sh"
chmod 0755 "${DEPLOY_DIR}/publish_health_metrics.sh"
chmod 0755 "${DEPLOY_DIR}/install_cloudwatch_agent.sh"
install -m 0644 "${DEPLOY_DIR}/hariom-backup.service" /etc/systemd/system/hariom-backup.service
install -m 0644 "${DEPLOY_DIR}/hariom-backup.timer" /etc/systemd/system/hariom-backup.timer
install -m 0644 "${DEPLOY_DIR}/hariom-restore-drill.service" /etc/systemd/system/hariom-restore-drill.service
install -m 0644 "${DEPLOY_DIR}/hariom-restore-drill.timer" /etc/systemd/system/hariom-restore-drill.timer
install -m 0644 "${DEPLOY_DIR}/hariom-health-metrics.service" /etc/systemd/system/hariom-health-metrics.service
install -m 0644 "${DEPLOY_DIR}/hariom-health-metrics.timer" /etc/systemd/system/hariom-health-metrics.timer
systemctl daemon-reload
systemctl enable --now hariom-backup.timer hariom-restore-drill.timer hariom-health-metrics.timer
"${DEPLOY_DIR}/install_cloudwatch_agent.sh"
