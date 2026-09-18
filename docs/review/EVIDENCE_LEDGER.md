# Evidence ledger — Hari Om correction pass

Date: 2026-09-18  
Branch: `cursor/ui-polish-nav-c5f9`  
Base SHA: `30263a4ef6592c7bf6e672ca3c2a9b411f39f63f`  
Remote PR10 HEAD: `74f5b45300ce1f121b5efd89f319b0d4e1027b33`  
Chromium / harness SHA: `5dd8b9b35ba647fe06fac2758609886bb4bf8e67`  
Local HEAD before this execution cycle: `9976b73fbe4a43d654ffaf656667271f145a114a`
Product commit this cycle: `34e116d913a51fd511fdc6e7e52d01901e5d7c3f` (inward categories, scoped exemption, PO plus qualifier, GRN notify skip)

## Compact evidence index

| Identity | Value |
| --- | --- |
| Local branch | `cursor/ui-polish-nav-c5f9` |
| Remote PR10 | `74f5b45300ce1f121b5efd89f319b0d4e1027b33` (**not pushed** since) |
| Served product SHA | `34e116d913a51fd511fdc6e7e52d01901e5d7c3f` |
| Served BUILD_ID | `awiH7moM5zoX5eoSsbe1T` at `http://127.0.0.1:23000` |
| Test-harness SHA | `5dd8b9b35ba647fe06fac2758609886bb4bf8e67` (e2e only vs product SHA `d071d12`; not re-run this UI rebuild) |
| Ancestry | `30263a4` ⊂ `74f5b45` ⊂ `faee2ab` ⊂ `d071d12` ⊂ `5dd8b9b` ⊂ `5187a64` ⊂ `1e39788` ⊂ `5a67e67` ⊂ `b69edb6` ⊂ `9976b73` ⊂ `34e116d` ⊂ this overlay |
| Path-scoped product after `d071d12` | e2e harness + backend/evaluator/sales/production/spec/planning/purchase/quality/UI source |
| Inventory/production/shared after `faee2ab` | **changed** (evaluator, parchment, capacity, GRN pin, workbook, QC gate, inward types/exemption/qualifiers). `faee2ab` images are stale. |
| Schema | create_all, no `alembic_version`. Additive: `itemtype` PACKAGING/TOOL/OTHER; receipt-line `NOT_REQUIRED`; packaging/tool/OTHER templates. |
| Images | `hariom-nverify-inventory:faee2ab` / `hariom-nverify-production:faee2ab` — **not rebuilt** |
| Browser | Playwright 1.59.1 Chrome: BJ 15/15, theme 6/6, PLAN-09 1/1 vs prior BUILD_ID. This served BUILD_ID not re-journeyed. WebKit BLOCKED. Safari.app BLOCKED. |
| Provider push-safety | `railway.toml` + `hariom-erp/render.yaml` still present. Auto-deploy **not proven disconnected**. |
| Original 56/192 overlay | PASS 50 / PARTIAL 32 / LIMITATION 3 / NOT_RUN 107 |
| Release recommendation | **Do not go live.** Not 100% production-ready. |

## Runtime identity

- Isolated UI `http://127.0.0.1:23000` Next 15.5.25 release, BUILD_ID `awiH7moM5zoX5eoSsbe1T`
- BFF `http://127.0.0.1:24000` pid **83284**, services `28001–28008` (28006 unused)
- Foreign `127.0.0.1:13000` pid 69663 left running
- Isolated production HTTP pid **83265** :28004 and inventory pid **83222** :28005 after this wave (venv-verify uvicorn)
- JWT sha256 prefix `c0f8ce9c6baa035a` from prior auth identity; UI rebuilt this wave

## This cycle — executable original cases

Wave after `9976b73`:

| Suite | Result | Notes |
| --- | --- | --- |
| Shared evaluator | 13 passed | includes QCT-019 scope/date |
| PO qualifier unit | 3 passed | `test_po_qualifier.py` |
| QCT-017–026 live + PUR-01 + INC-02 + REG-04 | 13 passed | isolated `hariom_nverify_inventorydb` |
| BFF GRN notify skip + copy/approve routes | 2 passed | `test_grn_notification_idempotent` + route contract |

Fixes patched with those tests:

1. ItemType lacked PACKAGING/TOOL/OTHER so inward QC could not be configured per original category → additive enum + templates; paper GSM/slitting and FG return-defect are not required on unrelated types.
2. Exemption JSON save could be selected in UI and inspect remapped NOT_REQUIRED to SKIPPED → dedicated Owner/Admin exemption approve with plant/date scope; inspect persists NOT_REQUIRED; outside date stays QC_HOLD/INCOMPLETE.
3. PO `PB 18+` had no retained plus/unconfirmed comparator → qualifier parser keeps raw + plus; inclusive bounds are not guessed; weaker supplier bound cannot silently rewrite the item profile.
4. Supplier mill values could be confused with local readings → certificate stored separately; local FAIL still holds.
5. GRN replay could emit a second BFF notification → skip `PURCHASE_GRN_POSTED` when the inventory body is `idempotent: true`.

## Prior wave after `5a67e67`:

| Suite | Result | Notes |
| --- | --- | --- |
| PUR workbook unit | 3 passed | `test_purchase_workbook.py` |
| PUR-01–08 + QCT-015/016/018 + REG-01 live | 12 passed (`test_original_pur_live` 12 + workbook 3 = 15 with units) | isolated `hariom_nverify_inventorydb` |
| QC-03–10 unit + typed/eval/enforcement | 34 passed with retained suites | `test_original_qc_stage` + `test_quality_enforcement` + `test_quality_eval` |
| QC-03/04/06/07/08 live | 5 passed | isolated `hariom_nverify_productiondb` |

Fixes patched with those tests:

1. SEP workbook had no preview/commit path → staged import flags `DATE_SHEET_MISMATCH` / `BLANK_PENDING` / `UNKNOWN_UNIT` and never posts stock; fingerprint replay is idempotent.
2. PO print defaulted a missing issuer rather than staying unresolved → print uses explicit `legal_entity`; Hari Om is not invented.
3. Receipt evidence was free-text terms only → TEST_REPORT/CHALLAN attach to the GRN batch; wrong batch 409.
4. `item_code` was globally unique so two plants could not bind the same family → unique `(plant_id, item_code)`.
5. Final QC `override_reason` skipped the gate for any actor, and a FAIL inspection with full readings satisfied completion → Owner/Admin only; out-of-range inline and FAIL inspections cannot complete.
6. Hold 409 payload used `h.stage` (missing) instead of `stage_type`.
7. Unapproved live profile could be used when no inward_metadata existed → pin/evaluate approved-or-missing only.

## Prior wave after `5187a64`
 (logs `reports/nverify-5187a-exec/`)


| Suite | Result | Log |
| --- | --- | --- |
| PLAN-06/07/08 + capacity guardrails + COMM-08 units | 50 passed | `prod_plan_unit.txt` |
| QC-01 roles + QC-02 plant scope | 7 passed | pytest `test_original_qc_roles` / `test_qc_plant_scope` |
| inventory pin + schedules + usable unit | 8 passed | `inv_unit.txt` |
| PUR-01/02/03/04/05 + QCT-015 live | 7 passed | `pur_live.txt` |
| PLAN-09 Chromium keyboard/390px | 1 passed ~3.1s | `plan09_pw.txt` |

Fixes patched before or with those tests:

1. Missing capacity policy returned no warning (looked feasible) → `MISSING_CAPACITY_POLICY_WARNING`.
2. Oven assignment ignored used capacity (`available_capacity = full shift`, and OVEN was outside the split path) → OVEN in `CAPACITY_SPLIT_STAGES`, remaining capacity enforced.
3. Holiday dates were included in the 30-day horizon → `_future_stage_slots` skips `closed_dates`; board/move warn `CLOSED_DATE_WARNING`.
4. GRN lots did not pin the item quality profile → `pin_quality_profile_metadata` on each receipt batch.
5. Incoming QC PASS flipped the batch but left inward transactions `QC_HOLD`, so usable qty stayed 0 → inward QC_HOLD txs follow the PASS stock status.

Prior wave2 logs remain under `reports/nverify-c53b-exec/` and `reports/nverify-6f50a-exec/`.

## Prior waves

| Suite | Result | Log |
| --- | --- | --- |
| COMM-08 planning snapshot units | 3 passed | `comm08_unit.txt` |
| sales REL-07/09/11 PLAN-02..05 live | 7 passed | `sales_wave2.txt` |
| PUR-03 GRN replay + concurrent remainder | 2 passed (first concurrent run failed DetachedInstanceError, then patched) | `pur03_live.txt` after fix |

Raw logs: `reports/nverify-6f50a-exec/` (gitignored) plus `reports/nverify-c53b-exec/`.

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

PLAN-09 Chromium 1 passed (`reports/nverify-5187a-exec/plan09_pw.txt`).

WebKit BLOCKED (incomplete browser install). Safari.app BLOCKED (`safaridriver --enable` needs owner password).

## Intentionally not claimed

| Gate | Status |
| --- | --- |
| Original 192 overlay PASS | 41 of 192; 118 still NOT_RUN; 30 PARTIAL; 3 LIMITATION |
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
