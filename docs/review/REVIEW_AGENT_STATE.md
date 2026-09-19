# Review agent state

- Branch: `cursor/ui-polish-nav-c5f9`
- Audited PR10 remote before correction publish: `30263a4ef6592c7bf6e672ca3c2a9b411f39f63f`
- Published correction (still the remote PR10 HEAD): `74f5b45300ce1f121b5efd89f319b0d4e1027b33`
- Local product HEAD: `5306970a063ca286916c07960405979e0a7b9144` QCT-051/053 adapters. Overlay `ff96f7e` PASS 86, then this full-40 evidence. No force-push, no discarded work.
- Chromium **40/40 PASS** binds BUILD_ID `RuDVwRuPutn9QGHEBn6so` through QCT-053 (`output/playwright/RuDVwRuPutn9QGHEBn6so-full-after-051-053/`, `--workers=1`, 2.0m).
- Group E (Docker audit_outbox + plant-prefixed masters): `faee2ab11cbeb181e663a3a54b0d5b2c6078a8f4`
- Served Next on 23000: BUILD_ID `RuDVwRuPutn9QGHEBn6so` pid **61187**. Stage QC search/submit patches are API/BFF; UI bundle unchanged.
- Isolated stack: `hariom-erp/runtime-verify`, ports `23000/24000/28001–28008` (28006 unused), DBs `hariom_nverify_*` (left running; foreign `13000` pid 69663 not killed)
- Original 56/192 restored at `docs/review/baseline-v2/`. Overlay this cycle: **PASS 86 / PARTIAL 21 / LIMITATION 3 / NOT_RUN 82**.
- Requirements overlay PASS: `R12`, `R13`, `R14`, `R15`, `R19`, `QCR-03`, `QCR-04`, `QCR-06`, `QCR-07`, `QCR-08`, `QCR-09`, `QCR-10`, `QCR-12`. `QCR-13` is PARTIAL (`QCT-051` PASS, `QCT-057` still NOT_RUN). `QCR-11` is PARTIAL (`QCT-126` still NOT_RUN). `QCR-05` stays PARTIAL (`QCT-012`/`QCT-068` still NOT_RUN). `QCR-14` stays PARTIAL (`QCT-053` PASS, `QCT-054`/`QCT-055` NOT_RUN). `QCR-17`/`QCR-31` stay PARTIAL (other IDs NOT_RUN). CODE is not PASS. GROSS_ESTIMATE and PARTIAL_REJECTION_UNSUPPORTED remain honest limitations (`DEM-02`, `DEM-06`, `QCT-107`).
- BJ13 Safari UAT **NOT_RUN**. Playwright WebKit **BLOCKED** (install hang after zip 100% / only `libwebrtc.dylib`). Safari.app **BLOCKED** (`safaridriver --enable` needs owner admin password). QCT-120 / QCT-125 / RR36 **NOT_RUN**.
- Isolated 7-DB dump/restore into `hariom_nverify_restore_*` PASS for rowcounts/holds/outbox (11.06s). That is **not** production-backup proof and **not** interrupted pending-op replay. See `docs/review/RECOVERY_REHEARSAL.md`.
- Push: blocked. `railway.toml` and `hariom-erp/render.yaml` exist; Railway/Render GitHub-app production auto-deploy is not proven disconnected.
- AWS live: **not deployed**. Do not guess hosts from known_hosts `3.6.77.159` / `13.232.191.84`. Downloads key listing denied.
- Isolated pids this wave: Next **61187** :23000, BFF **75339** :24000 (restarted from current source with CSRF Origin allow; prior 73242 replaced), production **70492** :28004, inventory **2331** :28005, sales **2337** :28008, auth **75328** :28001 (prior 90290 was dead; restarted onto `hariom_nverify_authdb`), master **90295** :28002, spec **31405** :28003, analytics **13483** :28007. Foreign 13000 pid 69663 left running.
- Schema additive: `quality_inspections.observation_fingerprint`, `quality_inspections.entry_mode`. Prior: `specification_sheet.write_revision`; `spec_save_operations`.
- Images `hariom-nverify-inventory:faee2ab` / `hariom-nverify-production:faee2ab` still **STALE**.
- Merge/deploy/PR retarget: not authorized
- Not 100% production-ready.

## QCT-051 / QCT-053 this wave

- Original procedures (not titles): QCT-051 submit same observations via dedicated QC, inline, supervisor, EOD, import and supported legacy — same normalized evidence/verdicts, no duplicate inspection or shortcut PASS. QCT-053 add a detailed valid reason to a failing reading and submit — measured FAIL; review/disposition authority still required.
- Live pytest `test_original_qct051_live.py` + fingerprint unit: **6 passed**.
- First Chromium failure (`output/playwright/RuDVwRuPutn9QGHEBn6so-qct051/`): QCT-051 timeout, option count 0 for job `700baff9-…`; page stuck on “Loading job cards…”. BFF network: `GET /api/production/job-cards?limit=80` **504**, then search **401**.
- Focused Chromium CSRF fail (`output/playwright/RuDVwRuPutn9QGHEBn6so-qct051-053/`): UUID found, Height FAIL shown locally, submit toast **Cross-site request rejected**, `quality-stage-verdict` absent; QCT-053 hung >180s and was killed (not looped).
- CSRF probes after BFF restart **75339**: Origin `http://127.0.0.1:23000` + `sec-fetch-site: cross-site` login **200**; Origin evil **403**; Next `:23000/api/auth/login` **200**. CSRF not broadened beyond isolated UI origin.
- Focused Chromium after CSRF origin (`output/playwright/RuDVwRuPutn9QGHEBn6so-qct051-053-csrf/`): **2 passed** (QCT-051 2.5s, QCT-053 2.1s). Dedicated inspections 200; supervisor/eod/import/legacy 200; QCT-053 hold release **403**.
- Full Chromium (`output/playwright/RuDVwRuPutn9QGHEBn6so-full-after-051-053/`): **40 passed**, PLAYWRIGHT_EXIT 0, 2.0m, `--workers=1`.
- Overlay: **PASS**. Inline is live `_sync_quality_artifacts` (HTTP stage-sync), not a second Stage QC UI path. Not title-match.

## Owner permission requests (exact wording)

1. Please provide the exact authorized AWS SSH private-key path or approved access method. Do not ask the agent to guess `3.6.77.159` / `13.232.191.84`. Key contents must not be printed.
2. Please enable Safari Remote Automation (`Develop > Allow Remote Automation` and `safaridriver --enable`) so actual Safari.app can be labeled separately from Playwright WebKit.

## NEXT ACTION

Do **not** wait for the owner to run the 192-case suite. Continue the isolated execution-and-fix cycle:

1. Pack-order **QCT-054+** (unknown cause honestly recorded) on isolated nverify. Prove the original procedure, not the title. Then QCT-055+.
2. Do not stall on WebKit extract hang or Safari. Keep the exact owner asks above.
3. Keep GROSS_ESTIMATE and PARTIAL_REJECTION_UNSUPPORTED as limitations until owner changes scope. `INC-01` stays NOT_RUN until original ID-creation screenshot SHA + console + request exist. `REG-02` stays NOT_RUN unless real migrated production data is on a disposable isolated target. `REG-04` stays PARTIAL without agreed budgets/authorized AWS host.
4. Remaining PARTIALs only when the full original procedure is proven: `COMM-01`–`COMM-07`/`COMM-09`/`COMM-10`/`COMM-12`, `REL-01`–`REL-03`, `NAV-01` tile/list/export identity, `INC-02` browser 422/409/malformed-body and post-commit response-loss, `REG-03` production-backup, `REG-04`, `QCT-005`/`QCT-006`/`QCT-008`/`QCT-123`. `QCR-13` stays PARTIAL until `QCT-057`. `QCR-14` stays PARTIAL until `QCT-054`/`QCT-055`.
5. If time: rebuild stale RR34/RR35 images; pending-op recovery replay on NEW disposable DBs only.
6. No AWS inspect/deploy, no main merge, no PR retarget, no force-push.
