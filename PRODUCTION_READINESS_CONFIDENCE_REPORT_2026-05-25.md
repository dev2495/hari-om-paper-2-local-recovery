# Hari Om ERP Production Readiness Confidence Report

Generated: 2026-05-25  
Repo: `/Users/devarshthakkar/local_repos/yash hari on/Hari Om Paper 2 Local`  
Branch: `staging`  
Last production-readiness code commit reviewed: `9f7b2c6 Harden Hari Om production readiness`

## Executive Confidence

My confidence in the current verified local production stack is high: **92/100**.

That score means the application is not just building; the live direct runtime is up, authenticated flows work, canonical routes redirect correctly, hard-cutover API/business checks passed, and browser release gates passed. I would be comfortable using this as the current company pilot/live stack for controlled operations.

I would not call it 100/100 because the repo still intentionally carries some unfinished design/refactor tasks in `TASKS.md`, and because a real company launch still needs operational readiness outside code: final master-data review, opening stock entry, user training, backup/restore drill, and owner sign-off on live data.

## Verification Evidence

Latest checks observed in this workspace:

- Git state: `staging...origin/staging`, clean.
- Runtime status: all direct services running.
- Web UI: `http://127.0.0.1:13000/login`.
- BFF health: `{"status":"healthy","service":"bff-api"}`.
- Runtime consistency report: `PASS=18 FAIL=0 TOTAL=18`.
- Hard cutover validation: `PASS=114 FAIL=0 TOTAL=114`.
- Browser release gate: `8 passed`.
- Single verification command: `./scripts/run_verification.sh` passed end to end.
- Post-restart browser smoke: legacy redirects `7/7`, browser console errors `0`.

The hard-cutover suite covered auth, role switching, sales-order creation/approval/release, job cards, planner scheduling, raw-material guardrails, QC holds/releases, dispatch replay, multi-plant access separation, owner reports, analytics, inventory health, notifications, and master-data audit signals.

## What Is Production-Ready Now

- Core services start together and report healthy.
- Production web build serves from the verified runtime, not dev-only state.
- Auth, admin, owner, plant scoping, acting role, and route guards are working.
- Sales to production flow is proven through release validation.
- Planner and dispatch canonical flows are browser-tested.
- Inventory health no longer hides degraded service state behind successful-looking fallback data.
- Spec preview fallback is visibly marked degraded if backend preview fails.
- Spec defaults are now per-plant and backed by `global_spec_defaults`.
- Old paths like `/planning`, `/production/planner`, `/dispatch`, `/specs`, `/masters`, and inventory/analytics aliases redirect to canonical routes instead of rendering duplicate old pages.
- User-facing role navigation is canonical; legacy role names remain only as compatibility aliases.
- Docs and verification scripts now match the current runtime instead of stale Docker/port assumptions.

## Remaining Items From `TASKS.md`

These are still open or marked in progress:

- `[~] 1.5` Keep the TypeScript spec math mirror aligned with the current bamboo usable-length rule.
  - Current risk: low, because existing TS math tests pass.
  - Improvement: add explicit cross-language fixture comparison for the same fixture set.

- `[~] 4.2` Preview/state still lives in `hooks/use-specs.ts`.
  - Current risk: low to medium. It works, but the hook is still carrying too much responsibility.
  - Improvement: split preview state, defaults fetch, degraded handling, and mutation calls into smaller hooks.

- `[ ] 4.3` Shared decimal-safe `NumericInput`.
  - Current risk: low. Existing UI works, but repeated numeric input behavior is harder to audit.
  - Improvement: centralize decimal, unit suffix, min/max, and formatting behavior.

- `[ ] 4.4` Shared searchable `PaperPicker`.
  - Current risk: medium as paper master grows.
  - Improvement: searchable picker will reduce operator mistakes and long dropdown friction.

- `[ ] 4.5` Shared `DeltaPill`.
  - Current risk: low. Existing delta display works, but common display semantics would reduce UI drift.

- `[ ] 4.6` to `[ ] 4.14` Spec-sheet component split.
  - Current risk: medium for maintainability, low for current runtime behavior.
  - The live editor is still `SpecSheetDocument.tsx`; it passes tests, but it is still too large.
  - Improvement: split into `ClientReqCard`, `RecipeMixCard`, `TubeCalcCard`, `NotchingCard`, `PackingCard`, `ValidationFooter`, `SpecSheetWorkspace`, and print component.

- `[~] 4.15` `SpecSheetDocument.tsx` remains the live editor.
  - Current risk: medium for future edits.
  - Improvement: continue extracting sections after the launch-critical code paths stabilize.

- `[~] 4.16` Suggestion engine is data-driven and constrained but still marked in progress.
  - Current risk: low. Covered by tests and browser flow.
  - Improvement: add more workbook fixture coverage and expose why a suggestion was chosen.

- `[~] 4.17` Spec editor plant/role enforcement is live but still marked in progress.
  - Current risk: low to medium.
  - Improvement: add explicit browser tests for non-owner/non-admin blocked edit states.

- `[ ] 5.4` Cross-check Python/TypeScript outputs for 5 fixtures to <= 3 dp.
  - Current risk: medium for future formula edits.
  - This is the most important remaining verification task.

## Explicitly Out Of Scope In `TASKS.md`

These are not blockers unless the business changes scope:

- Separate bamboo raw-material master with density per species.
- Multi-plant admin UI for global defaults.
- Changes to notching/packing field sets beyond the current ported fields.

## System Design Alignment

The current implementation is aligned with the major `SYSTEM_DESIGN.md` model:

- Sales orders can have multiple line items.
- Partial releases create production demand.
- Release lots drive job-card-level production truth.
- Planning uses stage-level segments and target winder assignment.
- Reports and analytics consume service truth.
- Spec sheet math uses global adhesive/parchment/moisture defaults, 9% drying loss, and the canonical wet/dry divisor.
- Master data drives customers, tube sizes, mandrels, papers, parchments, adhesives, packaging, and tooling.
- Reports and analytics now share the same reporting product direction.

No direct system-design contradiction was found in the current files. The main gap is not conceptual; it is implementation polish around spec-sheet component boundaries and fixture parity.

## Highest-Value Improvements Next

1. Add the 5-fixture Python/TypeScript parity test (`TASKS.md` 5.4).
2. Extract the spec sheet into smaller components without changing behavior.
3. Add browser tests for blocked spec edits by Store/Dispatch/Sales roles.
4. Add a backup/restore and data-export runbook for launch day.
5. Create an owner-facing day-0 checklist: users, plants, opening stock, active orders, master-data lock, backup, and support contact.
6. Add monitoring around degraded responses so service fallback warnings show up outside the UI.
7. Do a short UAT pass with real operators on Sales Order, Planner, Store Issue, Production Entry, QC Hold, Dispatch, and Owner Reports.

## Launch Recommendation

Use the current system for a controlled live/pilot start, with owner/admin supervision and the verified local stack kept as the source of truth.

Before full company-wide dependency, complete:

- final master-data review,
- opening stock/load verification,
- backup/restore drill,
- user login/role review,
- one operator UAT pass,
- and the Python/TypeScript 5-fixture math parity check.

My practical confidence:

- Current verified local production stack: **92%**.
- Controlled pilot/live start with owner oversight: **88%**.
- Full unsupervised company-wide rollout tomorrow: **78%**, mainly due to operational launch readiness and the remaining fixture/component/refactor tasks, not because the current verified flows are failing.
