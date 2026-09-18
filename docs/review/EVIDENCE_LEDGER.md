# Evidence ledger — Hari Om correction pass

Date: 2026-09-18  
Branch: `cursor/ui-polish-nav-c5f9`  
Base SHA: `30263a4ef6592c7bf6e672ca3c2a9b411f39f63f`  
Remote PR10 HEAD: `74f5b45300ce1f121b5efd89f319b0d4e1027b33`  
Chromium / harness SHA: `5dd8b9b35ba647fe06fac2758609886bb4bf8e67`  
Local HEAD before this follow-up: `83e0b54634fa90bf89bd57f0e5dd10238367afc9`

## Compact evidence index

| Identity | Value |
| --- | --- |
| Local branch | `cursor/ui-polish-nav-c5f9` |
| Remote PR10 | `74f5b45300ce1f121b5efd89f319b0d4e1027b33` (**not pushed** since) |
| Served product SHA | `d071d122ae8725431195804cc33779c4ff1e75a6` |
| Served BUILD_ID | `Yz4l4-NEecxcN4k1Xtf_H` at `http://127.0.0.1:23000` |
| Test-harness SHA | `5dd8b9b35ba647fe06fac2758609886bb4bf8e67` (e2e only vs product SHA) |
| Ancestry | `30263a4` ⊂ `74f5b45` ⊂ `faee2ab` ⊂ `d071d12` ⊂ `5dd8b9b` ⊂ `83e0b54` ⊂ this follow-up |
| Path-scoped product after `d071d12` | e2e harness only (`apps/web-ui/e2e/*`); Next inputs unchanged |
| Inventory/production/shared after `faee2ab` | **empty diff** — evaluator image boot evidence remains valid |
| Schema | create_all, no `alembic_version`. Column MD5: auth `6e1a0fb8…`, master `3a17e392…`, spec `685d8ed8…`, sales `ece79600…`, production `7977a259…`, inventory `9f88e793…`, analytics `735e355c…`. Tables 10/23/8/8/22/32/1. `hariom_nverify_hardening_test` matches auth. |
| Images | `hariom-nverify-inventory:faee2ab` id `sha256:eef5d9c383457d8a4d5314317422d7c936a0510b1e3c75f5b6612b242b04e842`; `hariom-nverify-production:faee2ab` id `sha256:e17529ec1aa42e4ef30df53b7c134eb4a6839fa8800b1baae35ed24e8eebd546` |
| Browser | Playwright 1.59.1, `PLAYWRIGHT_CHROME_CHANNEL=chrome`, 15 passed / 0 failed / 76.6s |
| Provider push-safety | GitHub Actions empty, repo hooks `0`, Environments empty. `railway.toml` + `hariom-erp/render.yaml` still present (includes owner-pack cron). Auto-deploy **not proven disconnected**. |
| Original 56/192 | Restored; overlay PASS 2 / NOT_RUN 190 |
| Release recommendation | **Do not go live.** AWS cutover blocked by remaining gates below. Not Render/Railway. |

## Runtime identity

- Isolated UI `http://127.0.0.1:23000` Next 15.5.25 release, BUILD_ID `Yz4l4-NEecxcN4k1Xtf_H`
- BFF `http://127.0.0.1:24000`, services `28001–28008`
- Foreign `127.0.0.1:13000` pid 69663 left running
- node v26.5.0, npm 11.17.0, Playwright 1.59.1, python 3.11.15
- `PLAYWRIGHT_CHROME_CHANNEL=chrome`
- Manifest: `hariom-erp/runtime-verify/runtime_manifest.json` consistency PASS 29/29 (generated 2026-09-18T17:11:38)
- Docker mounts for RR35 boot remain `[]` from prior evidence

## Live Postgres (venv-verify, `HARI_OM_LIVE_PG=1`) this follow-up

Commands and raw outcomes:

```text
cd hariom-erp/services/inventory-service
HARI_OM_LIVE_PG=1 DATABASE_URL=postgresql://$USER@127.0.0.1:5432/hariom_nverify_inventorydb PYTHONPATH=src \
  ../venv-verify/bin/python -m pytest tests/test_live_postgres_rr.py -vv --tb=short
# 5 passed in 0.56s
# test_partial_concession_keeps_residual_hold_and_blocks_issue PASSED
# test_overlapping_concessions_cannot_double_release PASSED
# test_receipt_pin_survives_later_master_edit PASSED
# test_fail_without_reason_persists_pending PASSED
# test_zero_unspecified_and_excess_concession_rejected PASSED

cd hariom-erp/services/sales-service
HARI_OM_LIVE_PG=1 DATABASE_URL=postgresql://$USER@127.0.0.1:5432/hariom_nverify_salesdb PYTHONPATH=src \
  ../venv-verify/bin/python -m pytest tests/test_live_postgres_rr.py tests/test_sales_commercial.py -vv --tb=short
# 15 passed in 0.35s
# includes test_equal_or_earlier_delivery_date_is_rejected PASSED
# includes test_header_date_change_revalidates_every_line PASSED

cd hariom-erp/services/production-service
HARI_OM_LIVE_PG=1 DATABASE_URL=postgresql://$USER@127.0.0.1:5432/hariom_nverify_productiondb PYTHONPATH=src \
  ../venv-verify/bin/python -m pytest tests/test_live_postgres_rr.py -vv --tb=short
# 3 passed in 2.30s
# test_every_winding_sample_persists_and_later_fail_matters PASSED
# test_client_hold_flag_ignored_and_fail_without_reason_persists PASSED
# test_export_includes_more_than_500_job_cards PASSED
```

Logs: `reports/nverify-83e0-followup/inventory_live.txt`, `sales_live.txt`, `production_live.txt` (gitignored `reports/`).

Prior retained (not re-claimed as a new 61-count): inventory live+QC 17, production live+typed+planning+eval 61, auth live+notifications 9, auth lifecycle 7 on `hariom_nverify_hardening_test`, analytics 8.

## Isolated dump/restore rehearsal (not production)

```text
pg_dump --format=custom --no-owner --no-privileges hariom_nverify_salesdb
createdb hariom_nverify_restore_drill_sales && pg_restore ...
# 8/8 public tables row-count match (audit_outbox=135, sales_orders=62, lines=62, schedules=47, release_lots=21, …)
# RESULT PASS; dropdb hariom_nverify_restore_drill_sales
```

This is **not** REG-03 / QCT-123 (cross-service pending holds/outbox/barriers) and **not** QCT-119 plant-level production migration reconciliation.

## Playwright

```text
PLAYWRIGHT_BASE_URL=http://127.0.0.1:23000 PLAYWRIGHT_CHROME_CHANNEL=chrome PLAYWRIGHT_VIDEO=off PLAYWRIGHT_TRACE=retain-on-failure
./node_modules/.bin/playwright test --config playwright.config.cjs --project=chromium --workers=1
# 15 passed, 0 failed, 0 skipped (76.572s)
# output/playwright/5dd8b9b35ba647fe06fac2758609886bb4bf8e67-full/junit.xml
```

Exact names (all PASS):

- login page keeps credentials private and contextual guide pages work
- admin shell, plant switching, and reports load cleanly
- admin can load all critical ERP workspaces without route errors
- sales queue, approval, release, planning, and dispatch workspace are operable with real role users
- Plant II sales release resolves its active winder masters and creates the planner cut
- real seeded users enforce route separation and role guards
- spec sheet keeps recipe, totals, and matrices in sync
- spec sheet keeps target weight explicit and applies the combined 15 percent rule
- premium sales and planner surfaces load with animated interactive elements
- tooling master and physical ledger expose the production workflow
- spec sheet uses searchable mandrel and tube controls and has no suggestions
- supervisor job card uses physical tool assignment controls
- sidebar approval card is removed and reconciliation actual rows are live
- keyboard focus, modal escape, and narrow viewport keep the shell usable
- blank and completed job-card prints keep samples and kg vs g labels

## Intentionally not claimed

| Gate | Status |
| --- | --- |
| Original 192 overlay except QCT-027 and QCT-052 | NOT_RUN |
| BJ13 Safari / dual theme | NOT_RUN (human) |
| QCT-120 full client cycle UAT | NOT_RUN |
| QCT-125 / RR36 release sign-off, main merge, deploy | NOT_RUN |
| GROSS_ESTIMATE / PARTIAL_REJECTION_UNSUPPORTED | limitations, not PASS |
| RR12 live allocation parents / RR16–RR20 live / RR27 calendar UI | CODE |
| Production-like 7-DB restore with pending holds | NOT_RUN |
| git push of this branch | blocked (Railway/Render GitHub-app unproven) |
| AWS live cutover | not done |

## Push blocker

Repo contains `railway.toml` and `hariom-erp/render.yaml` (web service plus `hariom-owner-pack-daily` cron). GitHub Actions, repo hooks, and Environments are empty; `main` is unprotected. That is not enough to prove a push of `cursor/ui-polish-nav-c5f9` will not trigger Railway/Render production. Local commits only.

## AWS inventory (no cutover)

- Repo path: `deploy/aws-ec2/` (`release_verified.sh` pulls a **GitHub** tarball of a 40-char SHA, rebuilds `erp-app`, runs backup + restore drill). Without a GitHub push that SHA is not fetchable that way; SSH rsync of the local tree would be the alternative after gates pass.
- `~/.ssh/known_hosts` has `3.6.77.159` and `13.232.191.84` (likely ap-south-1). Not probed; no production mutation.
- Operator public key under Downloads was not located in this sandbox (directory listing denied; guessed filenames absent). `~/.ssh/id_ed25519.pub` and `aios_imac_ed25519.pub` exist locally; private key material is not recorded here.
