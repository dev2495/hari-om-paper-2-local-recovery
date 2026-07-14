# AWS EC2 production deployment

This deployment runs Hari Om ERP on one low-cost EC2 host with:

- a PostgreSQL 16 container on a private Docker network;
- the supervised ERP application container;
- Caddy providing HTTPS through an IP-derived `sslip.io` hostname;
- encrypted, private S3 database backups;
- a weekly clean-PostgreSQL restore drill for all seven service databases;
- dependency-aware readiness, host metrics, CloudWatch alarms, and 14-day centralized logs;
- a daily encrypted EC2 recovery point retained for seven days;
- a stable Elastic IP and an SSH rule restricted to the operator CIDR.

The CloudFormation stack uses `t4g.medium` (2 vCPU, 4 GiB RAM) and a 40 GiB encrypted gp3 root volume by default.

Production data migration is deliberately whitelist-based. It imports active user/access configuration, business masters, specification masters, item/location masters, and quality templates. It does not import notifications, audit history, analytics jobs, opening stock, stock movements, sales, production, purchasing, dispatch, or tool-usage history.

## Production controls

- `https://<SITE_HOST>/healthz` returns success only when the BFF and every required backend dependency are ready.
- `hariom-health-metrics.timer` publishes disk, memory, and critical-route health every five minutes.
- `hariom-backup.timer` uploads checksum-verified custom-format database dumps to the private S3 bucket every day.
- `hariom-restore-drill.timer` restores the latest archive into a temporary PostgreSQL 16 container every week and verifies that each database contains public tables.
- `install_cloudwatch_agent.sh` sends Docker JSON logs and syslog to `/hariom/erp/production-v2`, retained for 14 days.
- CloudWatch alarms cover EC2 status, CPU, disk, memory, readiness, backup freshness, and restore-drill freshness.

Install or refresh the host controls after syncing this directory:

```bash
sudo deploy/aws-ec2/install_backup_timer.sh
sudo systemctl start hariom-backup.service
sudo systemctl start hariom-restore-drill.service
sudo systemctl start hariom-health-metrics.service
```

The first manual executions are release gates: all three services must exit successfully before traffic is signed off.

## Replacement-host recovery

On a clean host, create a mode-`0600` runtime environment with generated secrets, then restore the newest checksum-verified S3 archive before starting the application:

```bash
sudo install -d -o "$USER" -g "$USER" /opt/hariom/app
SITE_HOST=<ip-with-dashes>.sslip.io \
ELASTIC_IP=<elastic-ip> \
BACKUP_S3_BUCKET=<backup-bucket> \
  deploy/aws-ec2/bootstrap_runtime.sh
deploy/aws-ec2/restore_latest_backup.sh
docker compose --env-file deploy/aws-ec2/.env --project-directory deploy/aws-ec2 up -d
```

`bootstrap_runtime.sh` refuses to overwrite an existing `.env`. `restore_latest_backup.sh` verifies every dump checksum, recreates all seven databases, restores them without ownership/privilege drift, and verifies that each database contains public tables.

## Release procedure

1. Run `bash scripts/run_verification.sh` locally.
2. Validate `infrastructure.yaml` with AWS CloudFormation and apply the stack update.
3. Sync the tested source tree without replacing the production `.env` or PostgreSQL volume.
4. Run `docker compose --env-file .env config`, validate the Caddyfile, then rebuild the application image.
5. Start the stack and wait for `erp-app`, `postgres`, and `caddy` to be healthy.
6. Run authenticated API contract probes, the browser release gate, backup, restore drill, and metrics publisher.
7. Confirm CloudWatch metrics/log streams are fresh and that the S3 backup object exists.

Never seed demonstration users or transactional sample data in production. Empty analytics must render as an explicit no-data state until real sales, stock, production, consumption, and dispatch transactions are entered.
