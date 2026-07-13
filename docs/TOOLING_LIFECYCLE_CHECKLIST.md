# Tooling Lifecycle Release Checklist

## Scope

This checklist covers the fixed five-category tooling master, editable option registry, physical inward, QR asset ledger, location assignment, issue/return, maintenance, blade grinding, job-card usage, tooling reports, and specification-sheet integration.

## Completed implementation checklist

- [x] Fixed tooling categories: Notch, Blade, Holder, V + Flat, Punch.
- [x] Legacy non-canonical tool categories retired from active use while history is preserved.
- [x] User-created tool definitions under each fixed category.
- [x] Category-specific tool points in the master.
- [x] Tool master excludes legacy code, maintenance-date, and free-text location fields.
- [x] Tool category is fixed after creation; only its approved points can be edited.
- [x] Editable dropdown registry for approved tool/process values.
- [x] Active/discontinued handling for master records.
- [x] Discontinued items excluded from active specification-sheet selections.
- [x] Physical tool receipt with quantity expansion into individual assets.
- [x] Asset number and QR value generated for every physical unit.
- [x] Location Master selection at inward.
- [x] Selected active tool master is authoritative for physical inward category, name, and attributes.
- [x] Search by QR value or asset number.
- [x] Move action uses Location Master only.
- [x] Available, issued, maintenance, grinding-out, and scrap statuses.
- [x] Issue to job card and production stage.
- [x] Return from production.
- [x] Blade-only grinding out and grinding return.
- [x] Same blade asset retained across grinding versions.
- [x] Idempotent production usage recording.
- [x] Job card stores assigned physical tool asset IDs.
- [x] Produced and scrap quantities per physical tool.
- [x] Tooling report with physical asset output table.
- [x] Exactly eight notch process fields in the specification sheet.
- [x] Mandrel selection filters tube sizes to plus or minus 1 mm.
- [x] Specification-sheet suggestions removed from UI and calculation route.
- [x] Searchable dropdown behavior verified in the browser.
- [x] Tooling master UI screenshot reviewed.
- [x] Specification-sheet UI screenshot reviewed.
- [x] Runtime start/stop uses the same selected runtime directory and clears service PID markers.

## Verification evidence

| Check | Result |
| --- | --- |
| Python service compilation | Passed |
| Master tooling contract tests | 5 passed |
| BFF inward authority contract | 4 passed |
| Physical tool lifecycle tests | 31 passed |
| Web unit/static tests | Passed: 21 spec math, 2 reconciliation, 11 quality |
| TypeScript check | Passed |
| Web build | Passed |
| Web lint | Passed; no warnings or errors |
| Dependency audit | 0 vulnerabilities |
| Verification script | Passed |
| Runtime shutdown override test | Passed |
| Analytics scheduler regression | 2 passed; scheduler key and durable queue ID are stored separately |
| Focused browser tooling/spec suite | 2 passed |
| BFF health | Healthy |
| Local service startup | All services ready |

## Browser note

The legacy broad release gate was also run against the fresh local UI. Two low-level login/reconciliation tests passed. Six older tests remain incompatible with current seeded fixture assumptions or old page copy/select contracts; their failures are not used as evidence against the changed tooling flow. The focused tooling/spec suite is the authoritative browser check for this release and is green. After the production build, the local Next server was restarted before browser QA so its chunk manifest matched the build output.

## Operational acceptance before production use

- [ ] Confirm the plant's physical locations are present in Location Master.
- [ ] Confirm the client-approved tool names and point values.
- [ ] Inward the opening physical tool stock.
- [ ] Print and apply QR labels.
- [ ] Run one supervised issue/return transaction.
- [ ] Run one supervised blade grinding-out/return transaction.
- [ ] Complete one test job card and verify produced quantity in the tooling report.
- [ ] Confirm the client approver and production operator accounts.

These are plant onboarding actions, not software defects. They require the client's real master and stock data.

## Release status

- [x] Tooling changes committed and pushed to the Git remote `main` branch.
- [x] Follow-up analytics scheduler regression fix committed as `304bd24`.
- [x] Linked Railway service confirmed online at `https://hariom-erp-production.up.railway.app`.
- [ ] New Railway deployment accepted and verified. The upload was refused because the Railway trial has expired; select a Railway plan, then redeploy the latest pushed commit.
