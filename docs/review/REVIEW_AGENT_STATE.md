# Review agent state

- Branch: `cursor/ui-polish-nav-c5f9`
- Audited PR10 remote before correction publish: `30263a4ef6592c7bf6e672ca3c2a9b411f39f63f`
- Published correction (still the remote PR10 HEAD): `74f5b45300ce1f121b5efd89f319b0d4e1027b33`
- Local HEAD: `69ef79d4b82de0465819eaa7b506c97b30351829` (wave2: `b2f0b16` COMM-08, `04b2948` tests, `69ef79d` overlay). Started from `c53b1f5`; no force-push, no discarded work.
- Chromium 15/15 ran at `5dd8b9b35ba647fe06fac2758609886bb4bf8e67` (e2e harness only after product `d071d12`)
- Group E (Docker audit_outbox + plant-prefixed masters): `faee2ab11cbeb181e663a3a54b0d5b2c6078a8f4`
- Served Next on 23000: product `d071d122ae8725431195804cc33779c4ff1e75a6`, BUILD_ID `Yz4l4-NEecxcN4k1Xtf_H`
- Isolated stack: `hariom-erp/runtime-verify`, ports `23000/24000/28001–28008` (28006 unused), DBs `hariom_nverify_*` (left running; foreign `13000` pid 69663 not killed)
- Original 56/192 restored at `docs/review/baseline-v2/`. Overlay this cycle: **PASS 23 / PARTIAL 23 / LIMITATION 3 / NOT_RUN 143**.
- CODE is not PASS. GROSS_ESTIMATE and PARTIAL_REJECTION_UNSUPPORTED remain honest limitations (`DEM-02`, `DEM-06`, `QCT-107`).
- BJ13 Safari UAT **NOT_RUN**. Playwright WebKit **BLOCKED** (install incomplete). Safari.app **BLOCKED** (`safaridriver --enable` needs owner admin password). QCT-120 / QCT-125 / RR36 **NOT_RUN**.
- Isolated 7-DB dump/restore into `hariom_nverify_restore_*` PASS for rowcounts/holds/outbox (11.06s). That is **not** production-backup proof and **not** interrupted pending-op replay. See `docs/review/RECOVERY_REHEARSAL.md`.
- Push: blocked. `railway.toml` and `hariom-erp/render.yaml` exist; Railway/Render GitHub-app production auto-deploy is not proven disconnected.
- AWS live: **not deployed**. Do not guess hosts from known_hosts `3.6.77.159` / `13.232.191.84`. Downloads key listing denied.
- Isolated production HTTP restarted after COMM-08 snapshot helper (pid 66036 on 28004). Foreign 13000 left running. Next BUILD_ID still `Yz4l4-NEecxcN4k1Xtf_H`.
- Merge/deploy/PR retarget: not authorized
- Not 100% production-ready.

## Owner permission requests (exact wording)

1. Please provide the exact authorized AWS SSH private-key path or approved access method. Do not ask the agent to guess `3.6.77.159` / `13.232.191.84`. Key contents must not be printed.
2. Please enable Safari Remote Automation (`Develop > Allow Remote Automation` and `safaridriver --enable`) so actual Safari.app can be labeled separately from Playwright WebKit.

## NEXT ACTION

Do **not** wait for the owner to run the 192-case suite. Continue the isolated execution-and-fix cycle:

1. Continue isolated execution: `PLAN-06`–`PLAN-09`, `PUR-01`/`PUR-02`/`PUR-04`+, `QC-01`–`QC-10`, then `QCT-015+` / `INC-*` / `REG-01`. Close remaining PARTIAL only when the full original procedure is proven.
2. Complete `npx playwright install webkit` (extract still hangs after `libwebrtc.dylib`) and rerun theme spec `--project=webkit`. Do not stall other cases for Safari.
3. Keep GROSS_ESTIMATE and PARTIAL_REJECTION_UNSUPPORTED as limitations until owner changes scope.
4. No AWS inspect/deploy, no main merge, no PR retarget, no force-push.
