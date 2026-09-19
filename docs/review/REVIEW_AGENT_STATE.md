# Review agent state

- Branch: `cursor/ui-polish-nav-c5f9`
- Audited PR10 remote before correction publish: `30263a4ef6592c7bf6e672ca3c2a9b411f39f63f`
- Published correction (still the remote PR10 HEAD): `74f5b45300ce1f121b5efd89f319b0d4e1027b33`
- Local product this wave: QCT-059 offline/paper draft, server version change, reconnect without release, on parents `494b211` / `a381b37`. No force-push, no discarded work.
- Served Next on 23000: BUILD_ID `hSNF8iFPDPUtJa-w74ao_` pid **14112** (parent **14076**). Prior `6zk33xI-C0oXl9okpNOFU` / `zBHhpAo5567LO6B9wJwqR` do **not** bind this bundle.
- Focused Chromium on `hSNF8iFPDPUtJa-w74ao_`: QCT-059 **1 passed / 0 failed** in 5.3s. Uncontended full Chromium **44 passed / 2 failed** in 6.2m; auth `:28001` pid **9821** stayed up. Failures are release-gate `sales-orders:release-winder` not visible. PLAN-09, QCT-037, QCT-057, QCT-058, QCT-059 passed in that run.
- Group E (Docker audit_outbox + plant-prefixed masters): `faee2ab11cbeb181e663a3a54b0d5b2c6078a8f4`
- Isolated stack: `hariom-erp/runtime-verify`, ports `23000/24000/28001–28008` (28006 unused), DBs `hariom_nverify_*` (left running; foreign `13000` pid 69663 not killed)
- Original 56/192 restored at `docs/review/baseline-v2/`. Overlay this cycle: **PASS 92 / PARTIAL 21 / LIMITATION 3 / NOT_RUN 76**.
- Requirements overlay PASS: `R12`, `R13`, `R14`, `R15`, `R19`, `QCR-03`, `QCR-04`, `QCR-06`, `QCR-07`, `QCR-08`, `QCR-09`, `QCR-10`, `QCR-12`, `QCR-13`, `QCR-14`, `QCR-17`. `QCR-24` is PARTIAL (`QCT-084`/`QCT-105` still NOT_RUN). `QCR-21` and `QCR-29` are PARTIAL (`QCT-069`/`QCT-070`/`QCT-071` and `QCT-105`/`QCT-114` still NOT_RUN). `QCR-11` is PARTIAL (`QCT-126` still NOT_RUN). `QCR-05` stays PARTIAL (`QCT-012`/`QCT-068` still NOT_RUN). `QCR-19` is PARTIAL (`QCT-063`/`QCT-064` NOT_RUN). `QCR-31` stays PARTIAL. CODE is not PASS. GROSS_ESTIMATE and PARTIAL_REJECTION_UNSUPPORTED remain honest limitations (`DEM-02`, `DEM-06`, `QCT-107`).
- BJ13 Safari UAT **NOT_RUN**. Playwright WebKit **BLOCKED**. Safari.app **BLOCKED**. QCT-120 / QCT-125 / RR36 **NOT_RUN**.
- Isolated 7-DB dump/restore into `hariom_nverify_restore_*` PASS for rowcounts/holds/outbox. That is **not** production-backup proof and **not** interrupted pending-op replay.
- Push: blocked. `railway.toml` and `hariom-erp/render.yaml` exist; Railway/Render GitHub-app production auto-deploy is not proven disconnected.
- AWS live: **not deployed**. Do not guess hosts from known_hosts `3.6.77.159` / `13.232.191.84`. Downloads key listing denied.
- Isolated pids this wave: Next **14112** :23000 (npm parent **14076**), BFF **75339** :24000, production **13739** :28004 (venv-verify, JWT_SECRET len 23, MASTERDATA_SERVICE_URL `http://127.0.0.1:28002`), inventory **2331** :28005, sales **2337** :28008, auth **9821** :28001, master **90295** :28002, spec **31405** :28003, analytics **13483** :28007. Foreign 13000 pid 69663 left running.
- Schema: no new tables. Offline/stale reconnect uses existing `job_cards.spec_snapshot` JSONB `quality_context_version` plus signed fingerprint.
- Images `hariom-nverify-inventory:faee2ab` / `hariom-nverify-production:faee2ab` still **STALE**.
- Merge/deploy/PR retarget: not authorized
- Not 100% production-ready.

## QCT-059 this wave

- Original procedure (not the title): Prepare offline/paper draft, change server version, reconnect and submit. Expected: No offline release; stale conflict retains observations and signed profile context.
- Live + unit + QCT-058 regression: **6 passed**.
- Chromium: **1 passed** focused and again as test 29 of the full run on BUILD_ID `hSNF8iFPDPUtJa-w74ao_`. Paper/offline draft is kept locally (not a release). OFFLINE_DRAFT POST is 409. After `quality_context_version` bump, reconnect is 409 STALE_CONTEXT with height 90 and signed fingerprint retained; inspections stay empty.
- Overlay: **PASS**. `QCR-24` overlay **PARTIAL** because `QCT-084`/`QCT-105` remain NOT_RUN. `QCR-31` stays PARTIAL.

## Owner permission requests (exact wording)

1. Please provide the exact authorized AWS SSH private-key path or approved access method. Do not ask the agent to guess `3.6.77.159` / `13.232.191.84`. Key contents must not be printed.
2. Please enable Safari Remote Automation (`Develop > Allow Remote Automation` and `safaridriver --enable`) so actual Safari.app can be labeled separately from Playwright WebKit.

## NEXT ACTION

Do **not** wait for the owner to run the 192-case suite. Continue the isolated execution-and-fix cycle:

1. Pack-order **QCT-060+** (queue a valid commercial release lacking new QC setup, then attempt actual checkpoint — queue admission succeeds with missing-setup flag; affected execution checkpoint requires approved resolution). Prove the original procedure, not the title.
2. Do not stall on WebKit extract hang or Safari. Keep the exact owner asks above.
3. Keep GROSS_ESTIMATE and PARTIAL_REJECTION_UNSUPPORTED as limitations. `INC-01` stays NOT_RUN. `REG-02` stays NOT_RUN. `REG-04` stays PARTIAL.
4. Remaining PARTIALs only when the full original procedure is proven: `COMM-01`–`COMM-07`/`COMM-09`/`COMM-10`/`COMM-12`, `REL-01`–`REL-03`, `NAV-01`, `INC-02` browser 422/409/malformed-body and post-commit response-loss, `REG-03`, `REG-04`, `QCT-005`/`QCT-006`/`QCT-008`/`QCT-123`.
5. If time: the release-gate winder picker 2 fails on this BUILD_ID; rebuild stale RR34/RR35 images; pending-op recovery replay on NEW disposable DBs only.
6. No AWS inspect/deploy, no main merge, no PR retarget, no force-push.
