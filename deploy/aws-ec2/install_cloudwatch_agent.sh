#!/usr/bin/env bash
set -euo pipefail

ARCH="$(uname -m)"
case "${ARCH}" in
  aarch64|arm64) PACKAGE_ARCH="arm64" ;;
  x86_64|amd64) PACKAGE_ARCH="amd64" ;;
  *) echo "Unsupported architecture: ${ARCH}" >&2; exit 1 ;;
esac

PACKAGE_URL="https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/${PACKAGE_ARCH}/latest/amazon-cloudwatch-agent.deb"
PACKAGE_PATH="$(mktemp /tmp/amazon-cloudwatch-agent.XXXXXX.deb)"
trap 'rm -f "${PACKAGE_PATH}"' EXIT

curl --fail --silent --show-error --location "${PACKAGE_URL}" --output "${PACKAGE_PATH}"
dpkg -i "${PACKAGE_PATH}"

install -d -m 0755 /opt/aws/amazon-cloudwatch-agent/etc
install -m 0644 /dev/stdin /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<'JSON'
{
  "agent": {
    "metrics_collection_interval": 60,
    "run_as_user": "root"
  },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/lib/docker/containers/*/*.log",
            "log_group_name": "/hariom/erp/production-v2",
            "log_stream_name": "{instance_id}/docker"
          },
          {
            "file_path": "/var/log/syslog",
            "log_group_name": "/hariom/erp/production-v2",
            "log_stream_name": "{instance_id}/syslog"
          }
        ]
      }
    }
  }
}
JSON

/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config \
  -m ec2 \
  -s \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json

systemctl enable amazon-cloudwatch-agent
systemctl is-active --quiet amazon-cloudwatch-agent
