# Review agent state

- Branch: `cursor/ui-polish-nav-c5f9`
- Audited PR10 remote before correction publish: `30263a4ef6592c7bf6e672ca3c2a9b411f39f63f`
- Published correction (still the remote PR10 HEAD): `74f5b45300ce1f121b5efd89f319b0d4e1027b33`
- Local product HEAD: `34e116d913a51fd511fdc6e7e52d01901e5d7c3f` (inward categories, scoped exemption, PO plus qualifier, GRN notify skip). Overlay docs `379ac8a`. Started from `9976b73fbe4a43d654ffaf656667271f145a114a`; previous product `b69edb6a84d1dc18e5fb71998f72ddf083d5dd3b`. No force-push, no discarded work.
- Chromium 15/15 ran at `5dd8b9b35ba647fe06fac2758609886bb4bf8e67` (e2e harness only after product `d071d12`; not re-run against this UI rebuild)
- Group E (Docker audit_outbox + plant-prefixed masters): `faee2ab11cbeb181e663a3a54b0d5b2c6078a8f4`
- Served Next on 23000: product `34e116d913a51fd511fdc6e7e52d01901e5d7c3f`, BUILD_ID `awiH7moM5zoX5eoSsbe1T`
- Isolated stack: `hariom-erp/runtime-verify`, ports `23000/24000/28001–28008` (28006 unused), DBs `hariom_nverify_*` (left running; foreign `13000` pid 69663 not killed)
- Original 56/192 restored at `docs/review/baseline-v2/`. Overlay this cycle: **PASS 50 / PARTIAL 32 / LIMITATION 3 / NOT_RUN 107**.
- Requirements overlay PASS: `R13`, `R14`, `R15`, `QCR-03`, `QCR-06`. CODE is not PASS. GROSS_ESTIMATE and PARTIAL_REJECTION_UNSUPPORTED remain honest limitations (`DEM-02`, `DEM-06`, `QCT-107`).
- BJ13 Safari UAT **NOT_RUN**. Playwright WebKit **BLOCKED** (install incomplete). Safari.app **BLOCKED** (`safaridriver --enable` needs owner admin password). QCT-120 / QCT-125 / RR36 **NOT_RUN**.
- Isolated 7-DB dump/restore into `hariom_nverify_restore_*` PASS for rowcounts/holds/outbox (11.06s). That is **not** production-backup proof and **not** interrupted pending-op replay. See `docs/review/RECOVERY_REHEARSAL.md`.
- Push: blocked. `railway.toml` and `hariom-erp/render.yaml` exist; Railway/Render GitHub-app production auto-deploy is not proven disconnected.
- AWS live: **not deployed**. Do not guess hosts from known_hosts `3.6.77.159` / `13.232.191.84`. Downloads key listing denied.
- Isolated production HTTP pid **83265** on 28004, inventory pid **83222** on 28005, BFF pid **83284** on 24000, Next pid **83651** on 23000 after this wave (venv-verify). Foreign 13000 left running.
- Merge/deploy/PR retarget: not authorized
- Not 100% production-ready.

## Owner permission requests (exact wording)

1. Please provide the exact authorized AWS SSH private-key path or approved access method. Do not ask the agent to guess `3.6.77.159` / `13.232.191.84`. Key contents must not be printed.
2. Please enable Safari Remote Automation (`Develop > Allow Remote Automation` and `safaridriver --enable`) so actual Safari.app can be labeled separately from Playwright WebKit.

## NEXT ACTION

Do **not** wait for the owner to run the 192-case suite. Continue the isolated execution-and-fix cycle:

1. Close remaining PARTIAL only when the full original procedure is proven (`COMM-08` live order+UI, `REL-11` list/detail/bulk/legacy, `PLAN-04` group-move of started/dispatched, `PLAN-05` supplier+inventory, `PLAN-07` live holiday placement, `PLAN-08` live two-then-third oven jobs, `PUR-05` rejected remainder, `QC-01` sign-in landing, `QC-02` full token matrix, `REG-01` closed-period writes, `QCT-026` first-class task-queue retry). Then `INC-01` with the original ID-creation incident (recorded build/console/request), `REG-02` migrated production data (not nverify dump), then `QCT-028+` in pack order.
2. Do not stall on WebKit extract hang or Safari. Keep the exact owner asks above.
3. Keep GROSS_ESTIMATE and PARTIAL_REJECTION_UNSUPPORTED as limitations until owner changes scope.
4. If time: rebuild stale RR34/RR35 images; pending-op recovery replay on NEW disposable DBs only.
5. No AWS inspect/deploy, no main merge, no PR retarget, no force-push.
