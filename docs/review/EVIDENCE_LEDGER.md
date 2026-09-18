# Evidence ledger — Hari Om correction pass

Date: 2026-09-18  
Branch: `cursor/ui-polish-nav-c5f9`  
Base SHA: `30263a4ef6592c7bf6e672ca3c2a9b411f39f63f`  
Remote PR10 HEAD: `74f5b45300ce1f121b5efd89f319b0d4e1027b33`  
Chromium / harness SHA: `5dd8b9b35ba647fe06fac2758609886bb4bf8e67`  
Local HEAD before this execution cycle: `6f50a76d65b5715427b57ec05e53b0ce12d4ea8f`

## Compact evidence index

| Identity | Value |
| --- | --- |
| Local branch | `cursor/ui-polish-nav-c5f9` |
| Remote PR10 | `74f5b45300ce1f121b5efd89f319b0d4e1027b33` (**not pushed** since) |
| Served product SHA | `d071d122ae8725431195804cc33779c4ff1e75a6` |
| Served BUILD_ID | `Yz4l4-NEecxcN4k1Xtf_H` at `http://127.0.0.1:23000` |
| Test-harness SHA | `5dd8b9b35ba647fe06fac2758609886bb4bf8e67` (e2e only vs product SHA) |
| Ancestry | `30263a4` ⊂ `74f5b45` ⊂ `faee2ab` ⊂ `d071d12` ⊂ `5dd8b9b` ⊂ `83e0b54` ⊂ `6f50a76` ⊂ this follow-up |
| Path-scoped product after `d071d12` | e2e harness + this cycle’s backend/evaluator/sales/production/spec source |
| Inventory/production/shared after `faee2ab` | **changed this cycle** (evaluator + production release replay). `faee2ab` images are stale vs current source. |
| Schema | create_all, no `alembic_version`. Tables 10/23/8/8/22/32/1. Column MD5 from prior nverify fingerprint: auth `6e1a0fb8…`, master `3a17e392…`, spec `685d8ed8…`, sales `ece79600…`, production `7977a259…`, inventory `9f88e793…`, analytics `735e355c…`. No migration this cycle. |
| Images | `hariom-nverify-inventory:faee2ab` id `sha256:eef5d9c383457d8a4d5314317422d7c936a0510b1e3c75f5b6612b242b04e842`; `hariom-nverify-production:faee2ab` id `sha256:e17529ec1aa42e4ef30df53b7c134eb4a6839fa8800b1baae35ed24e8eebd546` — **not rebuilt** after evaluator change |
| Browser | Playwright 1.59.1, Chrome channel: BJ 15/15 plus theme 6/6. WebKit BLOCKED. Safari.app BLOCKED. |
| Provider push-safety | `railway.toml` + `hariom-erp/render.yaml` still present. Auto-deploy **not proven disconnected**. |
| Original 56/192 overlay | PASS 18 / PARTIAL 19 / LIMITATION 3 / NOT_RUN 152 |
| Release recommendation | **Do not go live.** Not 100% production-ready. |

## Runtime identity

- Isolated UI `http://127.0.0.1:23000` Next 15.5.25 release, BUILD_ID `Yz4l4-NEecxcN4k1Xtf_H`
- BFF `http://127.0.0.1:24000`, services `28001–28008` (28006 unused)
- Foreign `127.0.0.1:13000` pid 69663 left running
- node v26.5.0, Playwright 1.59.1, python 3.11.15
- `PLAYWRIGHT_CHROME_CHANNEL=chrome`
- Manifest: `hariom-erp/runtime-verify/runtime_manifest.json` last consistency PASS 29/29 at 2026-09-18T17:11:38 (harness SHA `5dd8b9b`)

## This cycle — executable original cases

Raw logs: `reports/nverify-6f50a-exec/` (gitignored).

| Suite | Result | Log |
| --- | --- | --- |
| shared original QCT evaluator | 12 passed | `shared_eval2.txt` |
| spec `test_qc_profile.py` | 6 passed | `spec_profile.txt` |
| sales commercial + pending unit | 25 passed | `sales_unit.txt` |
| sales live original COMM/REL/PLAN | 27 passed | `sales_live3.txt` |
| production due_risk + planning + quality_eval | 52 then 58 with replay | `prod_unit.txt` / `prod_live2.txt` |
| production REL replay live | 3 passed | `prod_live2.txt` |
| inventory live RR | 5 passed | `inv_live.txt` |
| Chromium theme-a11y-print light+dark | 6 passed ~7.3s | `playwright_chromium_theme.txt` |
| Playwright WebKit | BLOCKED, executable missing | `playwright_webkit.txt` |

First-failure causes that were patched before retest:

1. QCT-009 allow-listed `FAIL` token treated as categorical PASS → `DENIED_CATEGORICAL_TOKENS` so approved FAIL/REJECT tokens are measured FAIL; unknown BLEED is INVALID.
2. Live sales tests treated `create_sales_order` dict as ORM → `_obj` wrapper.
3. REL replay 400 “Sales order customer is missing” because `_sync_local_sales_order` ran before existing-job no-op → lookup existing release-lot job first.
4. COMM-03 header PO date applied then validation failed, in-memory date still new → validate commercial payload before ORM mutate.
5. `inf` release_qty passed pydantic `gt=0` → `isfinite` validators.
6. Blank historical PO classified INTERNAL → REVIEW origin.

## Isolated 7-DB restore rehearsal (not production)

See `docs/review/RECOVERY_REHEARSAL.md`. Repeat at `20260918T140252Z`: rowcount PASS, open holds 33/12160 and 16 matched source, wall clock 11.06s, artifacts `reports/nverify-restore-20260918T140252Z/`. Synthetic nverify dump/restore only.

## Playwright

Retained BJ01–BJ12 Chromium 15 passed (`output/playwright/5dd8b9b35ba647fe06fac2758609886bb4bf8e67-full/`).

Theme add-on Chromium + chromium-dark 6 passed (`output/playwright/6f50a76d65b5715427b57ec05e53b0ce12d4ea8f-theme/`).

WebKit BLOCKED (incomplete browser install). Safari.app BLOCKED (`safaridriver --enable` needs owner password).

## Intentionally not claimed

| Gate | Status |
| --- | --- |
| Original 192 overlay PASS | 18 of 192; 152 still NOT_RUN |
| BJ13 Safari / dual product theme | NOT_RUN / BLOCKED |
| QCT-120 full client cycle UAT | NOT_RUN |
| QCT-125 / RR36 release sign-off, main merge, deploy | NOT_RUN |
| GROSS_ESTIMATE / PARTIAL_REJECTION_UNSUPPORTED | limitations, not PASS |
| Production-backup restore or pending-op replay on restored DBs | NOT_RUN (synthetic dump/restore only) |
| git push of this branch | blocked (Railway/Render GitHub-app unproven) |
| AWS live cutover | not done; key path not authorized |

## Push blocker

Repo contains `railway.toml` and `hariom-erp/render.yaml`. GitHub Actions, repo hooks, and Environments are empty; `main` is unprotected. Local commits only.

## AWS inventory (no cutover, no host probe)

- Repo path: `deploy/aws-ec2/`
- `~/.ssh/known_hosts` has `3.6.77.159` and `13.232.191.84`. **Not probed.** Do not guess production identity from those IPs.
- Downloads public-key listing was denied. **Request:** exact authorized private-key path or approved access method. Key contents will not be printed.
