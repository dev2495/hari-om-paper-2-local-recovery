# Review agent state

- Branch: `cursor/ui-polish-nav-c5f9`
- Audited PR10 remote before correction publish: `30263a4ef6592c7bf6e672ca3c2a9b411f39f63f`
- Published correction (still the remote PR10 HEAD): `74f5b45300ce1f121b5efd89f319b0d4e1027b33`
- Local product HEAD: `e060c56` tab-order + correction-audit source. Overlay `fc80550` / PASS 88. Parent `a43e2d1` QCT-054/055 / `5306970` QCT-051/053. No force-push, no discarded work.
- Served Next on 23000: BUILD_ID `peLxekyXOJkjRqV0nc9oN` (unknown-cause + common-cause; Tab from FAIL reading lands on reason). Prior `RuDVwRuPutn9QGHEBn6so` 40/40 and `AOG_OtZsA38lwPCoQOXkx` do **not** bind this bundle.
- Focused Chromium QCT-045+051/053/054/055 **5/5 PASS** (12.5s). Full Chromium **34/42** after isolated auth `:28001` died (login 8 fails). After auth restore, those 8 BJ tests **8/8 PASS**. Combined bind 42/42 on this BUILD_ID across two process groups, not one uninterrupted 42/42.
- Group E (Docker audit_outbox + plant-prefixed masters): `faee2ab11cbeb181e663a3a54b0d5b2c6078a8f4`
- Isolated stack: `hariom-erp/runtime-verify`, ports `23000/24000/28001–28008` (28006 unused), DBs `hariom_nverify_*` (left running; foreign `13000` pid 69663 not killed)
- Original 56/192 restored at `docs/review/baseline-v2/`. Overlay this cycle: **PASS 88 / PARTIAL 21 / LIMITATION 3 / NOT_RUN 80**.
- Requirements overlay PASS: `R12`, `R13`, `R14`, `R15`, `R19`, `QCR-03`, `QCR-04`, `QCR-06`, `QCR-07`, `QCR-08`, `QCR-09`, `QCR-10`, `QCR-12`, `QCR-14`. `QCR-13` is PARTIAL (`QCT-057` still NOT_RUN). `QCR-11` is PARTIAL (`QCT-126` still NOT_RUN). `QCR-05` stays PARTIAL (`QCT-012`/`QCT-068` still NOT_RUN). `QCR-19` is PARTIAL (`QCT-063`/`QCT-064` NOT_RUN). `QCR-17`/`QCR-31` stay PARTIAL. CODE is not PASS. GROSS_ESTIMATE and PARTIAL_REJECTION_UNSUPPORTED remain honest limitations (`DEM-02`, `DEM-06`, `QCT-107`).
- BJ13 Safari UAT **NOT_RUN**. Playwright WebKit **BLOCKED**. Safari.app **BLOCKED**. QCT-120 / QCT-125 / RR36 **NOT_RUN**.
- Isolated 7-DB dump/restore into `hariom_nverify_restore_*` PASS for rowcounts/holds/outbox. That is **not** production-backup proof and **not** interrupted pending-op replay.
- Push: blocked. `railway.toml` and `hariom-erp/render.yaml` exist; Railway/Render GitHub-app production auto-deploy is not proven disconnected.
- AWS live: **not deployed**. Do not guess hosts from known_hosts `3.6.77.159` / `13.232.191.84`. Downloads key listing denied.
- Isolated pids this wave: Next **86178** :23000, BFF **75339** :24000, production **82189** :28004, inventory **2331** :28005, sales **2337** :28008, auth **89325** :28001 (restored after death), master **90295** :28002, spec **31405** :28003, analytics **13483** :28007. Foreign 13000 pid 69663 left running.
- Schema: no new tables. Reasons JSONB stores structured unknown-cause and `__common__` grouped-case payloads. QCT-056 correction-audit source is on disk, not overlay PASS.
- Images `hariom-nverify-inventory:faee2ab` / `hariom-nverify-production:faee2ab` still **STALE**.
- Merge/deploy/PR retarget: not authorized
- Not 100% production-ready.

## QCT-051 / QCT-053 this wave

- Original procedures (not titles): QCT-051 submit same observations via dedicated QC, inline, supervisor, EOD, import and supported legacy — same normalized evidence/verdicts, no duplicate inspection or shortcut PASS. QCT-053 add a detailed valid reason to a failing reading and submit — measured FAIL; review/disposition authority still required.
- First Chromium failure: job UUID missing; BFF `GET /job-cards?limit=80` **504**. Fix: exact UUID PK lookup. Product commit `5306970`.
- Second Chromium failure: POST inspections toast **Cross-site request rejected** (403). Fix: BFF CSRF allow `http://127.0.0.1:23000`.
- Focused Chromium after CSRF then again on BUILD_ID `peLxekyXOJkjRqV0nc9oN`: **PASS**. Overlay PASS 88 includes QCT-051 and QCT-053.

## QCT-054 / QCT-055 this wave

- QCT-054: Cause under investigation + factual note/containment/assignee; FAIL stays FAIL; investigation OPEN; fabricated root cause not required. Chromium PASS on `peLxekyXOJkjRqV0nc9oN`.
- QCT-055: three related FAILs share one common-cause explanation; each parameter remains. Chromium PASS on `peLxekyXOJkjRqV0nc9oN`.
- QCT-045 regression: Tab from height reading hit the new reason-code select. Fix: reason text remains the next tab stop. Re-run QCT-045 PASS.

## Owner permission requests (exact wording)

1. Please provide the exact authorized AWS SSH private-key path or approved access method. Do not ask the agent to guess `3.6.77.159` / `13.232.191.84`. Key contents must not be printed.
2. Please enable Safari Remote Automation (`Develop > Allow Remote Automation` and `safaridriver --enable`) so actual Safari.app can be labeled separately from Playwright WebKit.

## NEXT ACTION

Do **not** wait for the owner to run the 192-case suite. Continue the isolated execution-and-fix cycle:

1. Pack-order `QCT-056` from `docs/review/baseline-v2/` complete procedure (change a previously recorded failing number to a passing one; original value/result retained; correction reason/actor/time/revision required; hold not silently cleared). In-progress source is already on disk in production `quality.py` / planning sync / Stage QC — finish live pytest + Chromium against BUILD_ID `peLxekyXOJkjRqV0nc9oN` (rebuild served UI if source differs). Do not title-match PASS.
2. Then `QCT-057+` in pack order. Chromium: `PLAYWRIGHT_CHROME_CHANNEL=chrome --workers=1` on `http://127.0.0.1:23000`.
3. Do not stall on WebKit extract hang or Safari. Keep the exact owner asks above.
4. Keep GROSS_ESTIMATE and PARTIAL_REJECTION_UNSUPPORTED as limitations until owner changes scope. `INC-01` stays NOT_RUN until original ID-creation screenshot SHA + console + request exist. `REG-02` stays NOT_RUN unless real migrated production data is on a disposable isolated target. `REG-04` stays PARTIAL without agreed budgets/authorized AWS host.
5. Remaining PARTIALs only when the full original procedure is proven: `COMM-01`–`COMM-07`/`COMM-09`/`COMM-10`/`COMM-12`, `REL-01`–`REL-03`, `NAV-01` tile/list/export identity, `INC-02` browser 422/409/malformed-body and post-commit response-loss, `REG-03` production-backup, `REG-04`, `QCT-005`/`QCT-006`/`QCT-008`/`QCT-123`.
6. If time: rebuild stale RR34/RR35 images; pending-op recovery replay on NEW disposable DBs only.
7. No AWS inspect/deploy, no main merge, no PR retarget, no force-push.
