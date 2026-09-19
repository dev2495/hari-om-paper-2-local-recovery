# Review agent state

- Branch: `cursor/ui-polish-nav-c5f9`
- Audited PR10 remote before correction publish: `30263a4ef6592c7bf6e672ca3c2a9b411f39f63f`
- Published correction (still the remote PR10 HEAD): `74f5b45300ce1f121b5efd89f319b0d4e1027b33`
- Local product: `e060c56` QCT-056 correction audit (tab-order + original FAIL retained). Overlay parent `b1958f5`. Parents `a43e2d1` QCT-054/055 / `5306970` QCT-051/053. No force-push, no discarded work.
- Served Next on 23000: BUILD_ID `Jsi64h520Xs_8mFfUP9Qr` pid **90619**. Prior `peLxekyXOJkjRqV0nc9oN` / `AOG_OtZsA38lwPCoQOXkx` / `RuDVwRuPutn9QGHEBn6so` do **not** bind this bundle.
- Focused Chromium QCT-056 on `Jsi64h520Xs_8mFfUP9Qr`: original-procedure asserts passed (FAIL 90 retained, 400 without reason, PASS correction revision 2, hold HOLD). Playwright listed FAIL on unrelated `/api/production/books-state` 500 after a production restart lacked `MASTERDATA_SERVICE_URL`; that URL is restored and books-state is **200**. Not looped. peLxeky focused 5/5; combined 42/42 was two process groups after auth death.
- Group E (Docker audit_outbox + plant-prefixed masters): `faee2ab11cbeb181e663a3a54b0d5b2c6078a8f4`
- Isolated stack: `hariom-erp/runtime-verify`, ports `23000/24000/28001–28008` (28006 unused), DBs `hariom_nverify_*` (left running; foreign `13000` pid 69663 not killed)
- Original 56/192 restored at `docs/review/baseline-v2/`. Overlay this cycle: **PASS 89 / PARTIAL 21 / LIMITATION 3 / NOT_RUN 79**.
- Requirements overlay PASS: `R12`, `R13`, `R14`, `R15`, `R19`, `QCR-03`, `QCR-04`, `QCR-06`, `QCR-07`, `QCR-08`, `QCR-09`, `QCR-10`, `QCR-12`, `QCR-14`. `QCR-21` and `QCR-29` are PARTIAL (`QCT-069`/`QCT-070`/`QCT-071` and `QCT-105`/`QCT-114` still NOT_RUN). `QCR-13` is PARTIAL (`QCT-057` still NOT_RUN). `QCR-11` is PARTIAL (`QCT-126` still NOT_RUN). `QCR-05` stays PARTIAL (`QCT-012`/`QCT-068` still NOT_RUN). `QCR-19` is PARTIAL (`QCT-063`/`QCT-064` NOT_RUN). `QCR-17`/`QCR-31` stay PARTIAL. CODE is not PASS. GROSS_ESTIMATE and PARTIAL_REJECTION_UNSUPPORTED remain honest limitations (`DEM-02`, `DEM-06`, `QCT-107`).
- BJ13 Safari UAT **NOT_RUN**. Playwright WebKit **BLOCKED**. Safari.app **BLOCKED**. QCT-120 / QCT-125 / RR36 **NOT_RUN**.
- Isolated 7-DB dump/restore into `hariom_nverify_restore_*` PASS for rowcounts/holds/outbox. That is **not** production-backup proof and **not** interrupted pending-op replay.
- Push: blocked. `railway.toml` and `hariom-erp/render.yaml` exist; Railway/Render GitHub-app production auto-deploy is not proven disconnected.
- AWS live: **not deployed**. Do not guess hosts from known_hosts `3.6.77.159` / `13.232.191.84`. Downloads key listing denied.
- Isolated pids this wave: Next **90619** :23000, BFF **75339** :24000, production **93154** :28004, inventory **2331** :28005, sales **2337** :28008, auth **89325** :28001, master **90295** :28002, spec **31405** :28003, analytics **13483** :28007. Foreign 13000 pid 69663 left running.
- Schema: no new tables. Correction lineage lives on existing `parent_inspection_id` plus evaluation JSONB (`correction_reason` / actor / time / revision / prior_values). Original FAIL readings stay on the original row.
- Images `hariom-nverify-inventory:faee2ab` / `hariom-nverify-production:faee2ab` still **STALE**.
- Merge/deploy/PR retarget: not authorized
- Not 100% production-ready.

## QCT-056 this wave

- Original procedure (not the title): Change a previously recorded failing number to a passing one. Expected: original value/result retained; correction reason/actor/time/revision required; hold not silently cleared.
- Live + unit + oven/retest regression: **4 passed**.
- Chromium: original asserts passed on BUILD_ID `Jsi64h520Xs_8mFfUP9Qr`. Playwright process FAIL was books-state 500; repaired; not looped.
- Overlay: **PASS**. QCR-21 and QCR-29 overlay **PARTIAL**.

## Owner permission requests (exact wording)

1. Please provide the exact authorized AWS SSH private-key path or approved access method. Do not ask the agent to guess `3.6.77.159` / `13.232.191.84`. Key contents must not be printed.
2. Please enable Safari Remote Automation (`Develop > Allow Remote Automation` and `safaridriver --enable`) so actual Safari.app can be labeled separately from Playwright WebKit.

## NEXT ACTION

Do **not** wait for the owner to run the 192-case suite. Continue the isolated execution-and-fix cycle:

1. Pack-order **QCT-057+** (record physically completed output that fails QC — actual production/WIP/FG retained as restricted; failed quantity is not labelled good or hidden by form rejection). Prove the original procedure, not the title.
2. One full Chromium `--workers=1` on BUILD_ID `Jsi64h520Xs_8mFfUP9Qr` **only if no other Playwright suite is running**. If a test hangs >180s, kill hung pids and stop; do not loop.
3. Do not stall on WebKit extract hang or Safari. Keep the exact owner asks above.
4. Keep GROSS_ESTIMATE and PARTIAL_REJECTION_UNSUPPORTED as limitations. `INC-01` stays NOT_RUN. `REG-02` stays NOT_RUN. `REG-04` stays PARTIAL.
5. Remaining PARTIALs only when the full original procedure is proven: `COMM-01`–`COMM-07`/`COMM-09`/`COMM-10`/`COMM-12`, `REL-01`–`REL-03`, `NAV-01`, `INC-02` browser 422/409/malformed-body and post-commit response-loss, `REG-03`, `REG-04`, `QCT-005`/`QCT-006`/`QCT-008`/`QCT-123`.
6. If time: rebuild stale RR34/RR35 images; pending-op recovery replay on NEW disposable DBs only.
7. No AWS inspect/deploy, no main merge, no PR retarget, no force-push.
