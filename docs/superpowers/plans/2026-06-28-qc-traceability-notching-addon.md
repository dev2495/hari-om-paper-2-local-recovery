# QC Traceability and Notching Add-On Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-ready quality add-on that blocks unapproved inward material, captures non-blocking stage QC, records customer rejection disposition, and presents clean notching/spec tooling in spec sheets, printouts, and job cards.

**Architecture:** Inventory remains the hard material gate through `QC_HOLD`, `BLOCKED`, `UNRESTRICTED`, and `SCRAP` stock statuses. Production QC remains job-card/stage evidence, with active holds as the blocking mechanism and routine after-step readings as non-blocking traceability. Spec notching stays master-driven through tooling categories and dynamic spec fields, with only useful fields shown.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic-style runtime schema guards, Next.js 15, React Query, Tailwind, existing BFF proxy routes.

---

## Visual / UI Direction

**Visual thesis:** Calm shop-floor quality desk: dense, scan-first production UI with clear status rails, restrained amber/emerald/rose state color, and no marketing-style hero clutter.

**Content plan:** Quality dashboard summary, inward QC queue, customer rejection intake/disposition, stage QC capture, and traceability drill-down.

**Interaction thesis:** Status filters should feel instant, QC forms should reveal only fields relevant to selected material/stage, and disposition actions should clearly change stock availability state.

---

## Decisions

- Inward QC is a hard gate: new bulk inward and reel inward default to `QC_HOLD`, so production issue and WIP issue cannot consume them until QC releases them.
- Process/stage QC is non-blocking unless a QC user opens an active hold. Captured readings become traceability evidence; missing readings should not stop normal stage completion.
- Final QC remains a hard gate before FG handoff when spec measurements are configured.
- Customer rejected FG comes back as stock under `QC_HOLD`; disposition moves it to `UNRESTRICTED`, `WIP`, `SCRAP`, or `BLOCKED`.
- QC parameter lists are data-driven templates in code and persisted QC records, not hard-coded one-off form labels.
- Notching fields shown in the spec sheet are limited to fields that appear in the client note and existing job-card requirements: blade, holder, V+Flat, punch, notch wider, notch patti, notch direction, notch type, notch distance, and notch depth.
- Tooling dropdowns continue to use the existing Tool master categories so users can edit lists without code changes.

---

## Files

- Modify: `hariom-erp/services/inventory-service/src/models.py`
- Modify: `hariom-erp/services/inventory-service/src/main.py`
- Modify: `hariom-erp/services/inventory-service/src/routers/inward.py`
- Modify: `hariom-erp/services/inventory-service/src/routers/reels.py`
- Modify: `hariom-erp/services/inventory-service/src/routers/reel_issues.py`
- Modify: `hariom-erp/services/inventory-service/src/routers/__init__.py`
- Create: `hariom-erp/services/inventory-service/src/routers/quality.py`
- Create: `hariom-erp/services/inventory-service/tests/test_quality_control.py`
- Modify: `hariom-erp/services/production-service/src/routers/planning.py`
- Modify: `hariom-erp/services/production-service/tests/test_quality_enforcement.py`
- Modify: `apps/bff-api/src/routes/inventory.py`
- Modify: `apps/web-ui/lib/api.ts`
- Modify: `apps/web-ui/hooks/use-inventory.ts`
- Modify: `apps/web-ui/app/(dashboard)/quality/page.tsx`
- Modify: `apps/web-ui/app/(dashboard)/inventory/raw-material-inward/page.tsx`
- Modify: `apps/web-ui/app/(dashboard)/inventory/reels/inward/page.tsx`
- Modify: `apps/web-ui/lib/spec-sheet.ts`
- Modify: `apps/web-ui/components/specs/SpecSheetDocument.tsx`
- Modify: `apps/web-ui/components/production/JobCardDocument.tsx`
- Create: `apps/web-ui/__tests__/quality-addon-contracts.test.ts`
- Update: `docs/superpowers/plans/2026-06-28-qc-traceability-notching-addon.md`

---

## Checklist

### Task 1: Backend Inward QC Foundation

- [x] Add inventory QC models for templates, inspections, and customer rejections.
- [x] Add runtime schema guard for new inventory quality tables.
- [x] Add `/inventory/quality/templates`, `/inventory/quality/inspections`, `/inventory/quality/pending`, `/inventory/quality/customer-rejections`, and disposition endpoints.
- [x] Default bulk inward and reel inward to `QC_HOLD`.
- [x] Reject reel issue when reel `stock_status` is not `UNRESTRICTED` or `WIP`.
- [x] Add tests proving QC-held batch/reel cannot be issued, QC pass releases, fail blocks, and rejected FG disposition can scrap or rework.

### Task 2: Production Stage QC Behavior

- [x] Change routine process stage QC to non-blocking.
- [x] Keep active quality holds blocking stage advancement.
- [x] Keep final QC hard gate for configured final measurements.
- [x] Update production quality tests to reflect non-blocking process QC and hard final QC.

### Task 3: BFF and Frontend API Hooks

- [x] Proxy new inventory quality routes through BFF.
- [x] Add client API functions and React Query hooks.
- [x] Invalidate inventory, reel, transaction, and quality query keys after QC actions.

### Task 4: Quality Desk and Inward UI

- [x] Update raw material inward UI to default to incoming QC hold.
- [x] Update reel inward UI to default to incoming QC hold and explain release requirement.
- [x] Expand quality page with inward QC queue, customer rejection inward, disposition, stage QC entry, and traceability panels.
- [x] Keep the UI utility-first: compact state rail, no decorative dashboard clutter, clear action buttons.

### Task 5: Spec Notching and Job Card Mapping

- [x] Remove useless notch/spec fields from the primary spec notching UI.
- [x] Ensure editable dropdown values use Tool master categories and inline fallback options.
- [x] Show client-requested fields in spec UI and printout.
- [x] Map notching fields into job-card setup and process print sections.
- [x] Add/update frontend contract tests for notching field definitions.

### Task 6: Verification

- [x] Baseline: `npm run test:unit` in `apps/web-ui` -> 21/21, 3/3, 2/2 passed before edits.
- [x] Baseline: production-service tests using quoted repo venv -> 79 passed before edits.
- [x] Baseline: inventory-service tests using quoted repo venv -> 11 passed before edits.
- [x] Run focused inventory QC tests.
- [x] Run focused production QC tests.
- [x] Run web unit/static tests.
- [x] Run TypeScript check.
- [x] Run web production build.
- [x] Run local runtime/browser verification for quality and spec/notching pages.

---

## Verification Log

- 2026-06-28: Baseline web unit tests passed with `npm run test:unit`.
- 2026-06-28: Baseline production-service tests passed with `'/Users/devarshthakkar/local_repos/yash hari on/Hari Om Paper 2 Local/hariom-erp/venv-runtime/bin/python3' -m pytest tests -q`.
- 2026-06-28: Baseline inventory-service tests passed with `'/Users/devarshthakkar/local_repos/yash hari on/Hari Om Paper 2 Local/hariom-erp/venv-runtime/bin/python3' -m pytest tests -q`.
- 2026-06-28: Focused inventory QC tests passed with `tests/test_quality_control.py tests/test_stock_truth_contracts.py` -> 10 passed.
- 2026-06-28: Focused production QC tests passed with `tests/test_quality_enforcement.py` -> 9 passed.
- 2026-06-28: Full inventory-service test suite passed -> 16 passed.
- 2026-06-28: Full production-service test suite passed -> 79 passed.
- 2026-06-28: Full spec-service test suite passed -> 28 passed.
- 2026-06-28: Web static validation passed: help coverage, spec canonical, route canonical.
- 2026-06-28: Web unit tests passed -> 21/21, 3/3, 2/2, 3/3.
- 2026-06-28: TypeScript passed with `npx tsc --noEmit --pretty false`.
- 2026-06-28: Web production build passed with `npm run build`; `./start_all.sh` also rebuilt and launched production web UI.
- 2026-06-28: Runtime health passed with all direct services running; BFF `http://127.0.0.1:14000/health` and inventory `http://127.0.0.1:18005/health` returned healthy.
- 2026-06-28: Browser verification passed after login: `/quality` loaded with inventory QC/customer rejection APIs returning 200 and no console errors.
- 2026-06-28: Browser verification passed for `/inventory/raw-material-inward`: incoming stock status defaults to `QC_HOLD`, only Incoming QC hold/Blocked stock options are visible, no console errors.
- 2026-06-28: Browser verification passed for `/inventory/reels/inward`: receipt stock status defaults to Incoming QC hold, no console errors.
- 2026-06-28: Browser verification passed for `/specifications/new`: spec editor no longer attempts all-plants spec-field writes; Notch + Tooling shows Notch Type, Notch Direction, Notch Distance, Notch Depth, Blade, Holder, V + Flat, Punch, Notch Wider, and Notch Patti, with no legacy Groove/Tochha/Die/Height primary labels and no console errors.
- 2026-06-28: `git diff --check` passed.
- 2026-06-28: Completion audit rerun passed: inventory-service 16 passed, production-service 79 passed, spec-service 28 passed, and `npm run verify` completed lint, static validation, unit tests, TypeScript, and production build.
- 2026-06-28: Final live browser audit passed after restarting the web process from the current build: `/quality`, `/inventory/raw-material-inward`, `/inventory/reels/inward`, and expanded `/specifications/new` notching UI all rendered as expected with no console errors on the target pages.
- 2026-06-28: Final UI polish verified: mobile dashboard header fits without horizontal overflow, compact notching placeholders no longer clip, and `npm run verify` passed again after the UI polish.
- 2026-06-28: Client PDF report generated at `output/pdf/hari-om-qc-traceability-client-report.pdf` and visually inspected after Poppler rendering. Cover, flow, guide, screenshot, and verification pages are readable with no text overlap.
