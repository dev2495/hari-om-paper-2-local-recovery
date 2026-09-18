# Review agent state

- Branch: `cursor/ui-polish-nav-c5f9`
- Audited PR10 remote before correction publish: `30263a4ef6592c7bf6e672ca3c2a9b411f39f63f`
- Published correction (still the remote PR10 HEAD): `74f5b45300ce1f121b5efd89f319b0d4e1027b33`
- Local HEAD before this wave's product/docs: `338ebedf9dcbd836fc59719cc8d3db93eb237693` (Escape listener). Product `7fba655` after docs `151889b` / overlay `379ac8a` / product `34e116d`. No force-push, no discarded work.
- Chromium **24/24 PASS** on served BUILD_ID `NvnOVx0kmQ03d9QgGA7fW` (`--project=chromium --workers=1`, 1.4m). Includes BJ01–BJ12 plus original-partials QC-01/COMM-08/INC-02/QCT-029/QCT-030. Prior `5dd8b9b` 15/15 and `RK019_Yv2Kl45fbmQXLHA` do **not** stand for this bundle.
- Group E (Docker audit_outbox + plant-prefixed masters): `faee2ab11cbeb181e663a3a54b0d5b2c6078a8f4`
- Served Next on 23000: BUILD_ID `NvnOVx0kmQ03d9QgGA7fW` (QC dialog preserve-on-Back, explicit Discard confirm, capture-phase Escape)
- Isolated stack: `hariom-erp/runtime-verify`, ports `23000/24000/28001–28008` (28006 unused), DBs `hariom_nverify_*` (left running; foreign `13000` pid 69663 not killed)
- Original 56/192 restored at `docs/review/baseline-v2/`. Overlay this cycle: **PASS 64 / PARTIAL 21 / LIMITATION 3 / NOT_RUN 104**.
- Requirements overlay PASS: `R12`, `R13`, `R14`, `R15`, `R19`, `QCR-03`, `QCR-04`, `QCR-06`. CODE is not PASS. GROSS_ESTIMATE and PARTIAL_REJECTION_UNSUPPORTED remain honest limitations (`DEM-02`, `DEM-06`, `QCT-107`).
- BJ13 Safari UAT **NOT_RUN**. Playwright WebKit **BLOCKED** (install hang after zip 100% / only `libwebrtc.dylib`). Safari.app **BLOCKED** (`safaridriver --enable` needs owner admin password). QCT-120 / QCT-125 / RR36 **NOT_RUN**.
- Isolated 7-DB dump/restore into `hariom_nverify_restore_*` PASS for rowcounts/holds/outbox (11.06s). That is **not** production-backup proof and **not** interrupted pending-op replay. See `docs/review/RECOVERY_REHEARSAL.md`.
- Push: blocked. `railway.toml` and `hariom-erp/render.yaml` exist; Railway/Render GitHub-app production auto-deploy is not proven disconnected.
- AWS live: **not deployed**. Do not guess hosts from known_hosts `3.6.77.159` / `13.232.191.84`. Downloads key listing denied.
- Isolated pids this wave: Next **4475** :23000 (launcher 4437), BFF **2340** :24000, production **2334** :28004, inventory **2331** :28005, sales **2337** :28008, auth **90290** :28001, master **90295** :28002, spec **62174** :28003, analytics **13483** :28007. Foreign 13000 left running. Earlier 143 exits were restart SIGTERMs of the isolated nverify listeners only.
- Merge/deploy/PR retarget: not authorized
- Not 100% production-ready.

## Owner permission requests (exact wording)

1. Please provide the exact authorized AWS SSH private-key path or approved access method. Do not ask the agent to guess `3.6.77.159` / `13.232.191.84`. Key contents must not be printed.
2. Please enable Safari Remote Automation (`Develop > Allow Remote Automation` and `safaridriver --enable`) so actual Safari.app can be labeled separately from Playwright WebKit.

## NEXT ACTION

Do **not** wait for the owner to run the 192-case suite. Continue the isolated execution-and-fix cycle:

1. Pack-order `QCT-031` (QC-incomplete draft save), then `QCT-032+`. Remaining PARTIALs only when the full original procedure is proven: `COMM-01`–`COMM-07`/`COMM-09`/`COMM-10`/`COMM-12`, `REL-01`–`REL-03`, `NAV-01` tile/list/export identity, `INC-02` browser 422/409/malformed-body and post-commit response-loss, `REG-03` production-backup, `REG-04` agreed budgets/authorized AWS host, `QCT-005`/`QCT-006`/`QCT-008`/`QCT-123`. `INC-01` stays NOT_RUN until the original ID-creation screenshot SHA + console + request exist (do not invent). `REG-02` stays NOT_RUN unless real migrated production data is on a disposable isolated target (nverify dump is not that).
2. Do not stall on WebKit extract hang or Safari. Keep the exact owner asks above.
3. Keep GROSS_ESTIMATE and PARTIAL_REJECTION_UNSUPPORTED as limitations until owner changes scope.
4. If time: rebuild stale RR34/RR35 images; pending-op recovery replay on NEW disposable DBs only.
5. No AWS inspect/deploy, no main merge, no PR retarget, no force-push.
