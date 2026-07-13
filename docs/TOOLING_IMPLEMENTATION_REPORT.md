# Tooling Lifecycle Implementation Report

## Executive summary

The ERP tooling addon has been implemented as a controlled lifecycle from master definition to physical inward, production issue, output capture, maintenance/grinding, and trace reporting. The design keeps the five client-approved categories fixed while allowing the plant team to maintain multiple tool definitions and approved dropdown values under each category.

The specification sheet now consumes active tool masters and the option registry. It no longer renders or calculates suggestion cards. Physical usage is recorded against the exact asset assigned to the job card, which makes customer-rejection and production investigation traceable.

## Delivered scope

### Master data

- Five fixed categories only: NOTCH, BLADE, HOLDER, V_FLAT, PUNCH.
- Legacy categories are retained for history but automatically retired from active tooling use.
- Category-specific attribute snapshots.
- Editable registry for the values used by master forms and notch process fields.
- Status controls preserve discontinued records for history while removing them from active dropdowns.

### Physical inventory

- GRN-style tool receipt endpoint.
- One asset per received quantity.
- Generated asset number and QR value.
- Location Master linkage.
- Lifecycle event history.
- Searchable physical ledger.

### Production lifecycle

- Physical asset issue to job card and stage.
- Return from job card.
- Maintenance and completion.
- Blade grinding out and return with an incremented version on the same asset.
- Production output and scrap accumulation per physical asset.
- Idempotency key for retry-safe completion callbacks.

### Specification sheet

- Notch fields are limited to the eight approved client fields.
- Tool selections come from active master definitions.
- Direction, distance, and depth use maintained option values.
- Mandrel selection narrows tube choices to plus or minus 1 mm.
- Suggestions and their calculation route were removed.

### Reporting

- Tooling summary report.
- Per-category status counts.
- Physical asset output table.
- Usage count, produced quantity, scrap quantity, grinding version, and current job assignment.

## Data flow

```text
Tool category (fixed)
        |
        v
Tool definition + approved attributes
        |
        v
Physical receipt + Location Master + QR asset
        |
        +--> Issue to job card/stage --> Production completion --> Output by asset
        |
        +--> Maintenance --> Available
        |
        +--> Blade grinding out --> Grinding return --> Same asset, V1/V2/...
        |
        +--> Scrap --> Historical record retained, no future issue
```

## Example trace

| Event | Record |
| --- | --- |
| Definition | Plain Blade, BLADE |
| Receipt | 14-Jul-2026, Tool Rack A |
| Physical asset | TA-260714-001, QR value generated |
| Issue | JC-2026-014, Notching stage |
| Completion | 1,200 produced, 15 scrap |
| Return | Asset available at Tool Rack A |
| Grinding | Grinding out, then return as V1 |
| Next use | Same asset and history, new production event |

## Verification results

- Service compilation completed successfully.
- Masterdata tooling contract: 3 tests passed.
- Inventory physical lifecycle: 2 tests passed.
- Web unit/static suite: 21 spec math, 2 reconciliation, and 11 quality tests passed.
- TypeScript check passed.
- Production web build passed.
- Web lint passed with only the framework's `next lint` deprecation warning.
- `npm audit` reported 0 vulnerabilities.
- Analytics scheduler regression test passed: the scheduler status key and durable queue job ID no longer collide.
- Repository verification script passed.
- Fresh local BFF health returned `healthy`.
- Fresh local service startup reported all ERP services ready.
- Focused Playwright browser suite: 2 tests passed.

## Browser evidence

The focused browser suite covers:

1. Tooling master page, all five category values, editable registry, QR ledger, asset search, and screenshot capture.
2. Specification sheet, searchable mandrel selection, filtered tube-size selection, live builder load, and zero suggestion components.

Evidence screenshots:

- `reports/tooling-master-browser.png`
- `reports/spec-sheet-browser.png`

## Client onboarding actions

The code and flows are ready for real-data onboarding. Before plant use, the client team must:

1. Confirm the Location Master list.
2. Load approved tool definitions and options.
3. Inward the opening physical tool stock.
4. Apply QR labels.
5. Test one issue/return and one blade grinding cycle.
6. Complete one supervised job card and verify the tooling report.

These actions are data onboarding and operating acceptance; they cannot be completed accurately with placeholder test data.

## Release and deployment status

- Release commit: `8740c55`.
- Git remote: `main` branch contains the release commit.
- Linked Railway project: `hariom-paper-client-test`, production service `hariom-erp`.
- Public service: `https://hariom-erp-production.up.railway.app`.
- Existing Railway deployment remains online as deployment `4644fe4f-7913-49f1-ba3c-0d024ac5badb`.
- New upload was refused by Railway because the account trial has expired. The code is committed and pushed; after a Railway plan is selected, redeploy commit `8740c55` and rerun the authenticated production smoke test.
- A follow-up scheduler regression fix is verified locally and must be included in the next Railway deployment before production smoke verification.
