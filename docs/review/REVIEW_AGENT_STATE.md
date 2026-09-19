# Review agent state

- Branch: `cursor/ui-polish-nav-c5f9`
- Audited PR10 remote before correction publish: `30263a4ef6592c7bf6e672ca3c2a9b411f39f63f`
- Published correction (still the remote PR10 HEAD): `74f5b45300ce1f121b5efd89f319b0d4e1027b33`
- Local product this wave: `279dfc0` QCT-060 missing-QC queue admission + checkpoint gate and QCT-061 explicit attach, on parents overlay `a77adbd` / product `243535a`. No force-push, no discarded work.
- Served Next on 23000: BUILD_ID `_opGJjeYOkhKoqBiWqi2C` (npm parent **24256**, next **24285**). Prior `hSNF8iFPDPUtJa-w74ao_` does **not** bind this bundle.
- Focused Chromium on `_opGJjeYOkhKoqBiWqi2C`: QCT-060 **1 passed / 0 failed** in 5.7s. Uncontended full Chromium **45 passed / 2 failed** in 6.2m; auth `:28001` stayed up. The two fails were release-gate `sales-orders:release-winder` because production lacked `SALES_SERVICE_URL` (docker DNS `sales-service:8008`). After restoring isolated `http://127.0.0.1:28008` (jwt_len 23, MASTER local), those two gates **2 passed** in 46s on the same BUILD_ID. Combined 47/47 across two process groups, not one uninterrupted 47/47. QCT-060 passed in the full run (test 30).
- Group E (Docker audit_outbox + plant-prefixed masters): `faee2ab11cbeb181e663a3a54b0d5b2c6078a8f4`
- Isolated stack: `hariom-erp/runtime-verify`, ports `23000/24000/28001–28008` (28006 unused), DBs `hariom_nverify_*` (left running; foreign `13000` pid 69663 not killed)
- Original 56/192 restored at `docs/review/baseline-v2/`. Overlay this cycle: **PASS 94 / PARTIAL 21 / LIMITATION 3 / NOT_RUN 74**.
- Requirements overlay PASS: `R12`, `R13`, `R14`, `R15`, `R19`, `QCR-03`, `QCR-04`, `QCR-06`, `QCR-07`, `QCR-08`, `QCR-09`, `QCR-10`, `QCR-12`, `QCR-13`, `QCR-14`, `QCR-17`. `QCR-16` stays PARTIAL (`QCT-102`/`QCT-116` still NOT_RUN). `QCR-32` stays PARTIAL. `QCR-24` is PARTIAL (`QCT-084`/`QCT-105` still NOT_RUN). `QCR-21` and `QCR-29` are PARTIAL (`QCT-069`/`QCT-070`/`QCT-071` and `QCT-105`/`QCT-114` still NOT_RUN). `QCR-11` is PARTIAL (`QCT-126` still NOT_RUN). `QCR-05` stays PARTIAL (`QCT-012`/`QCT-068` still NOT_RUN). `QCR-19` is PARTIAL (`QCT-063`/`QCT-064` NOT_RUN). `QCR-31` stays PARTIAL. CODE is not PASS. GROSS_ESTIMATE and PARTIAL_REJECTION_UNSUPPORTED remain honest limitations (`DEM-02`, `DEM-06`, `QCT-107`).
- BJ13 Safari UAT **NOT_RUN**. Playwright WebKit **BLOCKED**. Safari.app **BLOCKED**. QCT-120 / QCT-125 / RR36 **NOT_RUN**.
- Isolated 7-DB dump/restore into `hariom_nverify_restore_*` PASS for rowcounts/holds/outbox. That is **not** production-backup proof and **not** interrupted pending-op replay.
- Push: blocked. `railway.toml` and `hariom-erp/render.yaml` exist; Railway/Render GitHub-app production auto-deploy is not proven disconnected.
- AWS live: **not deployed**. Do not guess hosts from known_hosts `3.6.77.159` / `13.232.191.84`. Downloads key listing denied.
- Isolated pids this wave: Next **24285** :23000 (npm parent **24256**), BFF **75339** :24000, production **26874** :28004 (venv-verify, JWT_SECRET len 23, MASTERDATA_SERVICE_URL `http://127.0.0.1:28002`, SALES_SERVICE_URL `http://127.0.0.1:28008`), inventory **2331** :28005, sales **2337** :28008, auth **9821** :28001, master **90295** :28002, spec **31405** :28003, analytics **13483** :28007. Foreign 13000 pid 69663 left running.
- Schema: no new tables. Missing-setup flag and attach audit live on existing `job_cards.spec_snapshot` JSONB.
- Images `hariom-nverify-inventory:faee2ab` / `hariom-nverify-production:faee2ab` still **STALE**.
- Merge/deploy/PR retarget: not authorized
- Not 100% production-ready.

## QCT-060 / QCT-061 this wave

- Original QCT-060 (not the title): Queue a valid commercial release lacking new QC setup, then attempt actual checkpoint. Expected: Queue admission succeeds with missing-setup flag; affected execution checkpoint requires approved resolution.
- Original QCT-061: Attach an approved profile to unstarted missing-setup job then replay original release. Expected: Attachment is audited, idempotent and explicit; replay does not rebind or reset schedule/actuals.
- Live + unit: **8 passed** (QCT-060/061 live 3, quality_eval marker 4, spec snapshot 1) plus QCT-059/REL replay regressions green.
- Chromium QCT-060: **1 passed** focused and again as test 30 of the full run on BUILD_ID `_opGJjeYOkhKoqBiWqi2C`.
- Overlay: **PASS** for both. `QCR-16` stays PARTIAL. `QCR-32` stays PARTIAL.

## Owner permission requests (exact wording)

1. Please provide the exact authorized AWS SSH private-key path or approved access method. Do not ask the agent to guess `3.6.77.159` / `13.232.191.84`. Key contents must not be printed.
2. Please enable Safari Remote Automation (`Develop > Allow Remote Automation` and `safaridriver --enable`) so actual Safari.app can be labeled separately from Playwright WebKit.

## NEXT ACTION

Do **not** wait for the owner to run the 192-case suite. Continue the isolated execution-and-fix cycle:

1. Pack-order **QCT-062+** (submit readings requiring calibrated instrument using missing/expired instrument then corrected documented evidence — required instrument evidence controls readiness; no invented calibration or silent PASS). Prove the original procedure, not the title.
2. Do not stall on WebKit extract hang or Safari. Keep the exact owner asks above.
3. Keep GROSS_ESTIMATE and PARTIAL_REJECTION_UNSUPPORTED as limitations. `INC-01` stays NOT_RUN. `REG-02` stays NOT_RUN. `REG-04` stays PARTIAL.
4. Remaining PARTIALs only when the full original procedure is proven: `COMM-01`–`COMM-07`/`COMM-09`/`COMM-10`/`COMM-12`, `REL-01`–`REL-03`, `NAV-01`, `INC-02` browser 422/409/malformed-body and post-commit response-loss, `REG-03`, `REG-04`, `QCT-005`/`QCT-006`/`QCT-008`/`QCT-123`.
5. If time: rebuild stale RR34/RR35 images; pending-op recovery replay on NEW disposable DBs only.
6. No AWS inspect/deploy, no main merge, no PR retarget, no force-push.
