# Authenticated AWS acceptance and named catalogue cleanup

Use `verify_aws_acceptance.py` only after the normal release has passed its exact-image, health, backup and restore gates. It creates named test records in both production plants through real APIs. It uses the two existing bootstrap accounts inside `erp-app`; credentials, JWTs, response bodies and usernames never enter its output. It never creates users, changes roles/security settings, or changes plant/legal configuration.

The product SHA and reviewed test-helper SHA may differ. Pin both independently. The host must verify `/opt/hariom/DEPLOYED_COMMIT` against the product SHA and record the running `erp-app` image ID before running the helper. If the helper is not in that product image, download it from the exact reviewed helper commit and copy that file into the running container; do not change product source or the deployed marker.

Example command after that host verification, with non-secret values already set:

```bash
[ "$(cat /opt/hariom/DEPLOYED_COMMIT)" = "$product_sha" ]
docker compose --env-file /opt/hariom/app/deploy/aws-ec2/.env --project-directory /opt/hariom/app/deploy/aws-ec2 exec -T \
  -e ERP_AWS_DEPLOYED_SHA="$product_sha" \
  -e ERP_AWS_ACCEPTANCE=AUTHORIZED_TESTING_WORKFLOW \
  erp-app python /app/reports/verify_aws_acceptance.py --expected-sha "$product_sha" --expected-host "$site_host" --run "$run_id"
```

Do not print or inspect container environment values. The app already receives `BOOTSTRAP_ADMIN_*` and `BOOTSTRAP_OWNER_*` from the existing deployment environment. The harness preflights actual `/auth/me` responses: distinct identities, Owner capability and both-plant scope are required. Authentication failure stops; there are no demo-password defaults or automatic password resets. A missing required instrument/certification blocks the real QC flow; the harness does not create or bypass certification.

The explicit, reviewed host argument must exactly match the container's `SITE_HOST` and `PUBLIC_APP_ORIGIN=https://<host>`. The harness fetches the public HTTPS Next login page, signs in normally through `/api/auth/login`, and uses the resulting cookie jar for `/api/auth/me`. It requires a host-only, Secure, HttpOnly, SameSite=lax session cookie and a response without the bearer token. TLS certificate verification remains enabled and redirects are never followed. Created seasonal cards, their floor routes and the specification are then read through the public BFF with cookies and each concrete plant; the other concrete plant must return404. These requests never carry a bearer header or injected cookie.

Existing published global QC configurations are preserved. If initial profiles are unpublished, acceptance stops by default. The release operator may supply the separately reviewed `-e ERP_AWS_PUBLISH_CLIENT_SEED=REVIEWED_CLIENT_RULES_2026_10_03` only to initialize/publish the exact confirmed client seed. Even with that flag, version1, row_version1, the full initial rules, their fingerprint and their original client-confirmation change note must all match. Modified or unrelated preexisting drafts are refused; the harness never rewrites them. This narrow seed publication persists as the approved initial system configuration and does not belong in fixture cleanup.

For each plant it creates one 100-piece approved Sales order. A ROY card freezes 50 pieces; a separate Monsoon recipe revision freezes the remaining 50 after the global switch. The BFF demand endpoint must partition frozen ROY50 and unreleased Monsoon50 correctly. The global season returns to its original selection after the run, including failed flow acceptance.

The remaining flow verifies independent PO and incoming-material-profile approval, blocked self-approval, invoice-pending issue blocking, inward replay, 100 kg into two 49.5 kg coils plus 1 kg trim, actual winding material issues, concurrent Winding/Oven/Process entries, mandatory samples and closure, final QC before accepted FG, partial dispatch30+10, and a frozen 10-piece carry-forward remake. Each order finishes at fulfilled100 with shipment and shortage replays. The report stores business/response entity UUIDs by operation, all created catalogue UUIDs by entity/path/plant and actual API-call counts.

The harness authenticates the two existing Owner-capable accounts. Separate QC/Operator/Sales user-session acceptance needs existing credentials for those roles; it must not be claimed from these two accounts or obtained by creating new test users. Existing local role and cross-plant denial tests remain separate evidence. Concrete-plant resource isolation is exercised on the AWS cards.

## Preserve evidence before resetting

Copy `/app/reports/aws-season-<run_id_lowercase>.json` from the container to the host release evidence directory. Keep that file, the exact helper checksum, exit status, sanitized log and running image ID. A failed run leaves named fixtures and its checkpoint for inspection; rerun the same run ID only after resolving the reported blocker. The original season is saved before configuration writes, and a failed resumed preflight still attempts restoration. `season_restoration_required=true` blocks a completion claim until an authenticated restore succeeds.

Catalogue creation intent is persisted before non-idempotent POSTs. If a Master/item creation response was lost before its proven provenance checkpoint, the helper saves the exact unconfirmed UUID and stops instead of adopting it by prefix. Review that exact row and normal audit evidence on-host; any manual archive/deactivation needs a separately reviewed scope. Unconfirmed rows cannot silently pass acceptance or enter automated cleanup. A matching preexisting Inventory item is also refused before any profile write. Winder material-issue retries use their per-job pre-POST baseline plus all exact issue fields; exactly one new row may recover, and an ambiguous or absent outcome stops without another POST. All submitted bamboo/piece quantity fields are strict integers, and the frozen ten-piece conversion is checked before floor writes.

The ordinary archived operational reset retains master catalogue rows. Its preview and permanent reset remain the separate, explicitly reviewed operation, with the at-action confirmation handled by the release operator. Do not broaden its retained-table policy to remove catalogue fixtures.

## Disable only this run's created catalogue after the operational reset

Every supported catalogue `DELETE` used here is a **soft deactivation**. Master customers, suppliers, mandrels, tube sizes, papers, machines, employees and optional reason codes become inactive; Inventory items become `active=false`, without `force=true`. The helper never hard-deletes history and never deactivates a reused/preexisting master.

After the archived seven-database reset completes and its zero business-row counts are verified, copy its exact `reset-manifest.json` into the container report directory. It must say `COMPLETE`, identify the same deployed product SHA, cover the seven known databases and contain verified zero counts for cleared tables. Run a catalogue preview using the same product guard/env flags:

```bash
python /app/reports/verify_aws_acceptance.py --expected-sha "$product_sha" --expected-host "$site_host" --run "$run_id" \
  --catalogue-cleanup preview --reset-manifest /app/reports/completed-reset-manifest.json
```

Review its exact created UUIDs, plant scopes, identity prefixes, active counts and `cleanup_fingerprint`. Only this run's immediately checkpointed `created_during_run` records enter the plan. The usual fresh run creates 22 master rows and four Inventory item rows, plus at most two new shortage reason codes; actual counts come from the preview, never from that estimate. It refuses a renamed/moved record, incomplete reset, changed preview, unknown endpoint or unproven catalogue provenance.

Apply only the reviewed deactivation plan:

```bash
python /app/reports/verify_aws_acceptance.py --expected-sha "$product_sha" --expected-host "$site_host" --run "$run_id" \
  --catalogue-cleanup apply --reset-manifest /app/reports/completed-reset-manifest.json \
  --cleanup-fingerprint "$cleanup_fingerprint" --confirm 'DISABLE ONLY CREATED AWS ACCEPTANCE CATALOGUE'
```

The same exact-SHA/production/container environment flags are required for cleanup. Save the reported actual disabled UUIDs/count and verified zero active fixture counts into the final evidence. The administrative deactivations create normal audit records after the business reset; retain that audit trail. Existing plant/legal settings, global recipes/rules, users, roles and all preexisting masters stay untouched by catalogue cleanup. The operational reset's original backup remains the recovery source.

Offline guard and cleanup tests:

```bash
hariom-erp/venv-season/bin/python -m pytest scripts/season/tests/test_aws_acceptance_guard.py -q
```
