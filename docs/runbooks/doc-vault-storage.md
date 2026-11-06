# Doc Vault storage (6 Nov 2026)

The Doc Vault keeps bill, challan and visitor photos, and the PDFs the system makes (issued debit
notes). Code: `hariom-erp/services/inventory-service/src/services/doc_storage.py` (backends) and
`services/doc_vault.py` (rules). Nothing is ever deleted; void keeps the file.

## Where files are today: local volume (default)

| Setting | Live value |
| --- | --- |
| `DOCS_STORAGE_BACKEND` | `local` (default) |
| `DOCS_STORAGE_DIR` | `/data/documents` inside `erp-app` |
| Docker volume | `erp_documents` (`hariom-erp-production_erp_documents`), see `deploy/aws-ec2/docker-compose.yml` |

The files are on a named volume, not inside the container, so a release (new image, container
recreated) keeps them. Keys are `{plant}/{yyyy}/{mm}/{doc_id}.{ext}`, thumbnails `thumbs/...jpg`.

Size budget. The phone shrinks every photo before sending (longest edge 2000 px, JPEG 0.8: about
300-600 KB). The server re-saves any photo still above 2400 px or 1.5 MB, and makes a ~30 KB
thumbnail. At 80 photos a day that is about 1.2 GB a month. The live root disk is 38 GB and filled up
once (27 Oct), so check it monthly and move to S3 (below) before the vault passes about 5 GB:

```bash
docker system df -v | grep erp_documents
df -h /
```

Backups. `backup_databases.sh` (daily timer, and every release) now also runs
`aws s3 sync <volume> s3://$BACKUP_S3_BUCKET/documents/` after the database dump. It is incremental
and uses no local disk; a failure is logged and sent as the CloudWatch metric
`DocumentBackupSuccess=0` but does not fail the database backup. The daily AWS Backup snapshot of the
instance (7 days) also contains the volume. The backup bucket expires objects after 90 days; the next
sync copies an expired file again, so the copy stays complete.

Restore files from the backup bucket (on the host, as root):

```bash
dir="$(docker volume inspect --format '{{ .Mountpoint }}' hariom-erp-production_erp_documents)"
aws s3 sync "s3://$(sed -n 's/^BACKUP_S3_BUCKET=//p' /opt/hariom/app/deploy/aws-ec2/.env)/documents/" "$dir/"
```

Upload limit. Caddy `request_body max_size 15MB` (Caddyfile), the BFF refuses bodies over 15 MB,
and the service refuses any file over 10 MB.

## Moving to S3 (owner runs this once, in AWS CloudShell, region ap-south-1)

Replace `ACCOUNT` by the 12-digit account id (`aws sts get-caller-identity --query Account --output text`).

```bash
REGION=ap-south-1
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="hariom-erp-documents-${ACCOUNT}-${REGION}"

# 1. Private bucket
aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION"
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-ownership-controls --bucket "$BUCKET" \
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'

# 2. Encryption at rest (SSE-S3) and versioning
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled

# 3. Lifecycle: Standard-IA after 90 days (nothing is ever expired; old versions go after 365 days)
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{
  "Rules":[{"ID":"documents-to-ia","Status":"Enabled","Filter":{"Prefix":""},
    "Transitions":[{"Days":90,"StorageClass":"STANDARD_IA"}],
    "NoncurrentVersionExpiration":{"NoncurrentDays":365},
    "AbortIncompleteMultipartUpload":{"DaysAfterInitiation":7}}]}'

# 4. Let the EC2 instance role read and write only this bucket's live prefix
ROLE="$(aws ec2 describe-instances --region "$REGION" \
  --filters "Name=tag:Name,Values=hariom-erp-production" "Name=instance-state-name,Values=running" \
  --query 'Reservations[0].Instances[0].IamInstanceProfile.Arn' --output text | awk -F/ '{print $NF}' \
  | xargs -I{} aws iam get-instance-profile --instance-profile-name {} --query 'InstanceProfile.Roles[0].RoleName' --output text)"
echo "Instance role: $ROLE"
aws iam put-role-policy --role-name "$ROLE" --policy-name HariOmDocVault --policy-document "{
  \"Version\":\"2012-10-17\",
  \"Statement\":[
    {\"Effect\":\"Allow\",\"Action\":[\"s3:ListBucket\"],\"Resource\":\"arn:aws:s3:::${BUCKET}\",
     \"Condition\":{\"StringLike\":{\"s3:prefix\":[\"live/*\"]}}},
    {\"Effect\":\"Allow\",\"Action\":[\"s3:PutObject\",\"s3:GetObject\",\"s3:AbortMultipartUpload\"],
     \"Resource\":\"arn:aws:s3:::${BUCKET}/live/*\"}
  ]}"
```

There is no `s3:DeleteObject` in the policy: the app never deletes, so the instance cannot either.

5. On the host (SSM session), add to `/opt/hariom/app/deploy/aws-ec2/.env`, then recreate the app:

```bash
DOCS_STORAGE_BACKEND=s3
DOCS_S3_BUCKET=hariom-erp-documents-ACCOUNT-ap-south-1
DOCS_S3_REGION=ap-south-1
DOCS_S3_PREFIX=live
DOCS_S3_DELIVERY=proxy
```

```bash
cd /opt/hariom/app/deploy/aws-ec2
docker compose --env-file .env up -d --no-deps --no-build erp-app
```

New files now go to S3 with SSE (AES256). Files already on the volume keep working: each page row
records the backend it was written to (`document_pages.storage_backend`).

6. Optional, to move the old files across and free the disk:

```bash
dir="$(docker volume inspect --format '{{ .Mountpoint }}' hariom-erp-production_erp_documents)"
aws s3 sync "$dir/" "s3://${BUCKET}/live/" --sse AES256 --exclude '*.part'
docker compose --env-file .env exec -T postgres psql -U "$(sed -n 's/^DB_USER=//p' .env)" -d inventorydb \
  -c "UPDATE document_pages SET storage_backend = 's3' WHERE storage_backend = 'local';"
```

Open a few old documents in the vault, then the volume can be cleared later.

### Delivery: proxy (default) or presigned redirect

`DOCS_S3_DELIVERY=proxy` streams the file through the service. It works with the site's
Content-Security-Policy (`img-src 'self'`, frames from `'self'`) as it is.
`DOCS_S3_DELIVERY=redirect` sends the browser a 5-minute presigned GET instead (less load on the
instance). Only use it after adding `https://BUCKET.s3.ap-south-1.amazonaws.com` to `img-src`,
`frame-src` and `connect-src` in the Caddyfile CSP, or photos and PDFs will not show.

If S3 is selected but the bucket or boto3 is missing, uploads answer 503 "Document storage is not
set up" and the rest of the ERP is unaffected; set `DOCS_STORAGE_BACKEND=local` to go back.
