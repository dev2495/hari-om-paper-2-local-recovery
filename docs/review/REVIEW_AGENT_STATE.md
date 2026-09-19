# Review agent state

- Branch: `cursor/ui-polish-nav-c5f9`
- Audited PR10 remote before correction publish: `30263a4ef6592c7bf6e672ca3c2a9b411f39f63f`
- Published correction (still the remote PR10 HEAD): `74f5b45300ce1f121b5efd89f319b0d4e1027b33`
- Local product this wave: QCT-064 advisory vs blocking movement gate and QCT-065 inspector/store concession denial on parents overlay `4e22c5b` / product `3c086b3`. No force-push, no discarded work.
- Served Next on 23000: BUILD_ID `fhU-eojOBt4PFHRjxMete` (npm parent **47888**, next **47918**). UI gained `quality-stage-gating-policy` / `quality-stage-movement-gate`.
- Focused Chromium on `fhU-eojOBt4PFHRjxMete`: QCT-064+065 **2 passed / 0 failed** in 10.6s. Uncontended full Chromium **51 passed / 0 failed** in 2.4m; auth `:28001` pid **42087** stayed up. One uninterrupted 51/51. This is the Chromium project suite, **not** original COMM/REL pack PASS.
- Group E (Docker audit_outbox + plant-prefixed masters): `faee2ab11cbeb181e663a3a54b0d5b2c6078a8f4`
- Isolated stack: `hariom-erp/runtime-verify`, ports `23000/24000/28001–28008` (28006 unused), DBs `hariom_nverify_*` (left running; foreign `13000` pid 69663 not killed)
- Original 56/192 restored at `docs/review/baseline-v2/`. Overlay this cycle: **PASS 98 / PARTIAL 21 / LIMITATION 3 / NOT_RUN 70**.
- Requirements overlay PASS: `R12`, `R13`, `R14`, `R15`, `R19`, `QCR-03`, `QCR-04`, `QCR-06`, `QCR-07`, `QCR-08`, `QCR-09`, `QCR-10`, `QCR-12`, `QCR-13`, `QCR-14`, `QCR-17`, `QCR-19`. `QCR-34` stays PARTIAL (`QCT-110` still NOT_RUN). `QCR-16` stays PARTIAL (`QCT-102`/`QCT-116` still NOT_RUN). `QCR-32` stays PARTIAL. `QCR-24` is PARTIAL (`QCT-084`/`QCT-105` still NOT_RUN). `QCR-21` and `QCR-29` are PARTIAL. `QCR-11` is PARTIAL (`QCT-126` still NOT_RUN). `QCR-05` stays PARTIAL. `QCR-18` is PARTIAL (`QCT-065` PASS; `QCT-085`/`QCT-093`/`QCT-104`/`QCT-111`/`QCT-112`/`QCT-113`/`QCT-125` still NOT_RUN). `QCR-20` stays PARTIAL (`QCT-066`/`QCT-067`/`QCT-068`/`QCT-083` still NOT_RUN; `QCT-107` limitation). `QCR-31` stays PARTIAL. CODE is not PASS. GROSS_ESTIMATE and PARTIAL_REJECTION_UNSUPPORTED remain honest limitations (`DEM-02`, `DEM-06`, `QCT-107`).
- BJ13 Safari UAT **NOT_RUN**. Playwright WebKit **BLOCKED**. Safari.app **BLOCKED**. QCT-120 / QCT-125 / RR36 **NOT_RUN**.
- Isolated 7-DB dump/restore into `hariom_nverify_restore_*` PASS for rowcounts/holds/outbox. That is **not** production-backup proof and **not** interrupted pending-op replay.
- Push: blocked. `railway.toml` and `hariom-erp/render.yaml` exist; Railway/Render GitHub-app production auto-deploy is not proven disconnected.
- AWS live: **not deployed**. Do not guess hosts from known_hosts `3.6.77.159` / `13.232.191.84`. Downloads key listing denied.
- Isolated pids this wave: Next **47918** :23000 (npm parent **47888**), BFF **75339** :24000, production **47263** :28004 (venv-verify, JWT_SECRET len 23, MASTERDATA_SERVICE_URL `http://127.0.0.1:28002`, SALES_SERVICE_URL `http://127.0.0.1:28008`), inventory **2331** :28005, sales **2337** :28008, auth **42087** :28001 (stayed up through 51/51), master **90295** :28002, spec **47261** :28003, analytics **13483** :28007. Foreign 13000 pid 69663 left running.
- Schema: no new tables. Approved QC profile may persist explicit `gating` on a stage/parameter. Evaluator default remains blocking when gating is omitted. Missing-setup flag remains on existing `job_cards.spec_snapshot` JSONB.
- Images `hariom-nverify-inventory:faee2ab` / `hariom-nverify-production:faee2ab` still **STALE**.
- Merge/deploy/PR retarget: not authorized
- Not 100% production-ready.

## QCT-064 this wave

- Original QCT-064 (not the title): Fail a declared advisory and a mandatory blocking checkpoint in separate fixtures. Expected: Both preserve reason/case/FAIL; only approved policy determines movement gate, never an incidental default.
- Product: approved-profile `gating` (`advisory` | `blocking`; omitted = blocking). Inspection evaluation stamps `gating`, `movement_gate`, `gating_source=approved_profile`. Client shortcut keys (`gating`/`movement_gate`/…) are stripped. Advancement 409 `JOB_HAS_ACTIVE_QC_HOLD` uses movement-blocking holds only. Restricted-stock labeling still uses any HOLD so FAIL is not labelled good.
- Live + unit: advisory FAIL/HOLD/reason, OVEN 200; blocking FAIL/HOLD/reason, client advisory shortcut ignored, OVEN 409. Omitted gating is blocking. QCT-057 still 409 on blocking.
- Chromium QCT-064: **1 passed** focused and again as test 27 of the uninterrupted 51/51 full run on BUILD_ID `fhU-eojOBt4PFHRjxMete`.
- Overlay: **PASS**. `QCR-19` is now PASS (`QCT-055`/`QCT-063`/`QCT-064`).

## QCT-065 this wave

- Original QCT-065 (not the title): Inspector or Store tries major concession/clearance through direct API. Expected: Denied; measurement save permission does not grant disposition authority.
- Product already denied FAIL-hold release without `qc:disposition:approve` / Owner/Admin; inspector cannot self-release. Store is 403. Roles were not broadened.
- Live + Chromium: QC can save FAIL; inspector and store `POST /holds/{id}/release` are 403; hold stays HOLD.
- Overlay: **PASS**. `QCR-20` stays PARTIAL. `QCR-18` is PARTIAL (only `QCT-065` of its pack is PASS).

## Owner permission requests (exact wording)

1. Please provide the exact authorized AWS SSH private-key path or approved access method. Do not ask the agent to guess `3.6.77.159` / `13.232.191.84`. Key contents must not be printed.
2. Please enable Safari Remote Automation (`Develop > Allow Remote Automation` and `safaridriver --enable`) so actual Safari.app can be labeled separately from Playwright WebKit.

## NEXT ACTION

Do **not** wait for the owner to run the 192-case suite. Continue the isolated execution-and-fix cycle:

1. Pack-order **QCT-066+** (approve a limited quantity for one customer/order then try other use or expired authorization — only scoped eligible use permitted; result stays FAIL and concession is visibly separate). Prove the original procedure, not the title.
2. Do not stall on WebKit extract hang or Safari. Keep the exact owner asks above.
3. Keep GROSS_ESTIMATE and PARTIAL_REJECTION_UNSUPPORTED as limitations. `INC-01` stays NOT_RUN. `REG-02` stays NOT_RUN. `REG-04` stays PARTIAL.
4. Remaining PARTIALs only when the full original procedure is proven: `COMM-01`–`COMM-07`/`COMM-09`/`COMM-10`/`COMM-12`, `REL-01`–`REL-03`, `NAV-01`, `INC-02` browser 422/409/malformed-body and post-commit response-loss, `REG-03`, `REG-04`, `QCT-005`/`QCT-006`/`QCT-008`/`QCT-123`.
5. If time: rebuild stale RR34/RR35 images; pending-op recovery replay on NEW disposable DBs only.
6. No AWS inspect/deploy, no main merge, no PR retarget, no force-push.
