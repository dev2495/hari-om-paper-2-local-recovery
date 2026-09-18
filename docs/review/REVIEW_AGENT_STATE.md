# Review agent state

- Branch: `cursor/ui-polish-nav-c5f9`
- Audited PR10 remote before correction publish: `30263a4ef6592c7bf6e672ca3c2a9b411f39f63f`
- Published correction (still the remote PR10 HEAD): `74f5b45300ce1f121b5efd89f319b0d4e1027b33`
- Local product HEAD: `b69edb6a84d1dc18e5fb71998f72ddf083d5dd3b` (workbook import, PO print/evidence, QC gate, plant-scoped item_code). Started from `5a67e6791918949ba92d1759247dc1e5dfe9f563`; previous product `1e397887c5bf1d88d7d22c014f5bbd8dd1eda4ba`. No force-push, no discarded work.
- Chromium 15/15 ran at `5dd8b9b35ba647fe06fac2758609886bb4bf8e67` (e2e harness only after product `d071d12`)
- Group E (Docker audit_outbox + plant-prefixed masters): `faee2ab11cbeb181e663a3a54b0d5b2c6078a8f4`
- Served Next on 23000: product `d071d122ae8725431195804cc33779c4ff1e75a6`, BUILD_ID `Yz4l4-NEecxcN4k1Xtf_H` (UI not rebuilt this wave)
- Isolated stack: `hariom-erp/runtime-verify`, ports `23000/24000/28001–28008` (28006 unused), DBs `hariom_nverify_*` (left running; foreign `13000` pid 69663 not killed)
- Original 56/192 restored at `docs/review/baseline-v2/`. Overlay this cycle: **PASS 41 / PARTIAL 30 / LIMITATION 3 / NOT_RUN 118**.
- Requirements overlay PASS: `R13`, `R14`, `R15`. CODE is not PASS. GROSS_ESTIMATE and PARTIAL_REJECTION_UNSUPPORTED remain honest limitations (`DEM-02`, `DEM-06`, `QCT-107`).
- BJ13 Safari UAT **NOT_RUN**. Playwright WebKit **BLOCKED** (install incomplete). Safari.app **BLOCKED** (`safaridriver --enable` needs owner admin password). QCT-120 / QCT-125 / RR36 **NOT_RUN**.
- Isolated 7-DB dump/restore into `hariom_nverify_restore_*` PASS for rowcounts/holds/outbox (11.06s). That is **not** production-backup proof and **not** interrupted pending-op replay. See `docs/review/RECOVERY_REHEARSAL.md`.
- Push: blocked. `railway.toml` and `hariom-erp/render.yaml` exist; Railway/Render GitHub-app production auto-deploy is not proven disconnected.
- AWS live: **not deployed**. Do not guess hosts from known_hosts `3.6.77.159` / `13.232.191.84`. Downloads key listing denied.
- Isolated production HTTP pid **75652** on 28004, inventory pid **75654** on 28005, BFF pid **75656** on 24000 after this wave’s source change (venv-verify). Foreign 13000 left running. Next BUILD_ID still `Yz4l4-NEecxcN4k1Xtf_H`.
- Merge/deploy/PR retarget: not authorized
- Not 100% production-ready.

## Owner permission requests (exact wording)

1. Please provide the exact authorized AWS SSH private-key path or approved access method. Do not ask the agent to guess `3.6.77.159` / `13.232.191.84`. Key contents must not be printed.
2. Please enable Safari Remote Automation (`Develop > Allow Remote Automation` and `safaridriver --enable`) so actual Safari.app can be labeled separately from Playwright WebKit.

## NEXT ACTION

Do **not** wait for the owner to run the 192-case suite. Continue the isolated execution-and-fix cycle:

1. `QCT-017` / `QCT-019+`, then `INC-01`/`INC-02` with recorded build/console/request, then `REG-02` (migrated production data, not nverify dump) and `REG-04` (agreed AWS host). Close remaining PARTIAL only when the full original procedure is proven (`COMM-08` live order+UI, `REL-11` list/detail/bulk/legacy, `PLAN-04` group-move of started/dispatched, `PLAN-05` supplier+inventory, `PLAN-07` live holiday placement, `PLAN-08` live two-then-third oven jobs, `PUR-01` tool SKU, `PUR-05` rejected remainder, `QC-01` sign-in landing, `QC-02` full token matrix, `REG-01` closed-period writes).
2. Do not stall on WebKit extract hang or Safari. Keep the exact owner asks above.
3. Keep GROSS_ESTIMATE and PARTIAL_REJECTION_UNSUPPORTED as limitations until owner changes scope.
4. If time: rebuild stale RR34/RR35 images; pending-op recovery replay on NEW disposable DBs only.
5. No AWS inspect/deploy, no main merge, no PR retarget, no force-push.
