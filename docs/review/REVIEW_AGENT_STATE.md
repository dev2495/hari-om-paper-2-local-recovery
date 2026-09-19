# Review agent state

- Branch: `cursor/ui-polish-nav-c5f9`
- Audited PR10 remote before correction publish: `30263a4ef6592c7bf6e672ca3c2a9b411f39f63f`
- Published correction (still the remote PR10 HEAD): `74f5b45300ce1f121b5efd89f319b0d4e1027b33`
- Local product this wave: QCT-063 durable multi-field FAIL replay (one case/hold per scope/round, no duplicated quantity) on parents overlay `886abd3` / product `1943b30`. No force-push, no discarded work.
- Served Next on 23000: BUILD_ID `EYFrs5GhOyHNGtioE2__r` (npm parent **32080**, next **32109**). UI bundle unchanged this wave; Chromium gained QCT-063 in `original-partials.spec.cjs`.
- Focused Chromium on `EYFrs5GhOyHNGtioE2__r`: QCT-063 **1 passed / 0 failed** in 4.1s (after list-hold repair). Uncontended full Chromium **49 passed / 0 failed** in 2.2m after isolated auth restore; auth `:28001` stayed up for that run. One uninterrupted 49/49. An earlier 49-test attempt aborted when auth `:28001` pid **9821** died at QCT-048; that run is not the Chromium result. This is the Chromium project suite, **not** original COMM/REL pack PASS.
- Group E (Docker audit_outbox + plant-prefixed masters): `faee2ab11cbeb181e663a3a54b0d5b2c6078a8f4`
- Isolated stack: `hariom-erp/runtime-verify`, ports `23000/24000/28001–28008` (28006 unused), DBs `hariom_nverify_*` (left running; foreign `13000` pid 69663 not killed)
- Original 56/192 restored at `docs/review/baseline-v2/`. Overlay this cycle: **PASS 96 / PARTIAL 21 / LIMITATION 3 / NOT_RUN 72**.
- Requirements overlay PASS: `R12`, `R13`, `R14`, `R15`, `R19`, `QCR-03`, `QCR-04`, `QCR-06`, `QCR-07`, `QCR-08`, `QCR-09`, `QCR-10`, `QCR-12`, `QCR-13`, `QCR-14`, `QCR-17`. `QCR-34` stays PARTIAL (`QCT-110` still NOT_RUN). `QCR-16` stays PARTIAL (`QCT-102`/`QCT-116` still NOT_RUN). `QCR-32` stays PARTIAL. `QCR-24` is PARTIAL (`QCT-084`/`QCT-105` still NOT_RUN). `QCR-21` and `QCR-29` are PARTIAL. `QCR-11` is PARTIAL (`QCT-126` still NOT_RUN). `QCR-05` stays PARTIAL. `QCR-19` stays PARTIAL (`QCT-064` still NOT_RUN; `QCT-055`/`QCT-063` PASS). `QCR-31` stays PARTIAL. CODE is not PASS. GROSS_ESTIMATE and PARTIAL_REJECTION_UNSUPPORTED remain honest limitations (`DEM-02`, `DEM-06`, `QCT-107`).
- BJ13 Safari UAT **NOT_RUN**. Playwright WebKit **BLOCKED**. Safari.app **BLOCKED**. QCT-120 / QCT-125 / RR36 **NOT_RUN**.
- Isolated 7-DB dump/restore into `hariom_nverify_restore_*` PASS for rowcounts/holds/outbox. That is **not** production-backup proof and **not** interrupted pending-op replay.
- Push: blocked. `railway.toml` and `hariom-erp/render.yaml` exist; Railway/Render GitHub-app production auto-deploy is not proven disconnected.
- AWS live: **not deployed**. Do not guess hosts from known_hosts `3.6.77.159` / `13.232.191.84`. Downloads key listing denied.
- Isolated pids this wave: Next **32109** :23000 (npm parent **32080**), BFF **75339** :24000, production **39306** :28004 (venv-verify, JWT_SECRET len 23, MASTERDATA_SERVICE_URL `http://127.0.0.1:28002`, SALES_SERVICE_URL `http://127.0.0.1:28008`), inventory **2331** :28005, sales **2337** :28008, auth **42087** :28001 (restored after pid **9821** died during the aborted Chromium run), master **90295** :28002, spec **31660** :28003, analytics **13483** :28007. Foreign 13000 pid 69663 left running.
- Schema: no new tables. Unique index `uq_quality_inspections_observation_fingerprint` on existing `quality_inspections.observation_fingerprint`. Affected quantity and case scope live on inspection evaluation JSON. Missing-setup flag remains on existing `job_cards.spec_snapshot` JSONB.
- Images `hariom-nverify-inventory:faee2ab` / `hariom-nverify-production:faee2ab` still **STALE**.
- Merge/deploy/PR retarget: not authorized
- Not 100% production-ready.

## QCT-063 this wave

- Original QCT-063 (not the title): Save a signed/recorded sample with multiple failures and retry the request. Expected: One appropriate case/hold per scope/round, retaining all failures; no duplicated quantities/cases on replay.
- Product: transaction lock on observation fingerprint, unique fingerprint index, IntegrityError reuse, one HOLD per sample scope/round, `affected_quantity` stamped from planned_qty and not summed on replay. List inspections now attach the source hold. QCT-055 grouping is unchanged and is not title-matched as QCT-063.
- Live + unit: signed three-field FAIL, retry reused=true, inspection_count 1, hold_count 1, three FAIL codes retained, planned_qty 10 not doubled. QCT-055/QCT-048/QCT-062 live still green.
- Chromium QCT-063: **1 passed** focused and again as test 26 of the uninterrupted 49/49 full run on BUILD_ID `EYFrs5GhOyHNGtioE2__r`.
- Overlay: **PASS**. `QCR-19` stays PARTIAL until `QCT-064`.
- QCT-064 not executed this wave (advisory vs blocking movement gate).

## Owner permission requests (exact wording)

1. Please provide the exact authorized AWS SSH private-key path or approved access method. Do not ask the agent to guess `3.6.77.159` / `13.232.191.84`. Key contents must not be printed.
2. Please enable Safari Remote Automation (`Develop > Allow Remote Automation` and `safaridriver --enable`) so actual Safari.app can be labeled separately from Playwright WebKit.

## NEXT ACTION

Do **not** wait for the owner to run the 192-case suite. Continue the isolated execution-and-fix cycle:

1. Pack-order **QCT-064+** (fail a declared advisory and a mandatory blocking checkpoint in separate fixtures — both preserve reason/case/FAIL; only approved policy determines movement gate, never an incidental default). Prove the original procedure, not the title.
2. Do not stall on WebKit extract hang or Safari. Keep the exact owner asks above.
3. Keep GROSS_ESTIMATE and PARTIAL_REJECTION_UNSUPPORTED as limitations. `INC-01` stays NOT_RUN. `REG-02` stays NOT_RUN. `REG-04` stays PARTIAL.
4. Remaining PARTIALs only when the full original procedure is proven: `COMM-01`–`COMM-07`/`COMM-09`/`COMM-10`/`COMM-12`, `REL-01`–`REL-03`, `NAV-01`, `INC-02` browser 422/409/malformed-body and post-commit response-loss, `REG-03`, `REG-04`, `QCT-005`/`QCT-006`/`QCT-008`/`QCT-123`.
5. If time: rebuild stale RR34/RR35 images; pending-op recovery replay on NEW disposable DBs only.
6. No AWS inspect/deploy, no main merge, no PR retarget, no force-push.
