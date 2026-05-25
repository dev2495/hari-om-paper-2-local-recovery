# Spec Sheet Redesign — Task Tracker

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` skipped/not now

Linked plan: `/Users/devarshthakkar/.claude/plans/smooth-zooming-wirth.md`
Implementation log: `IMPLEMENTATION.md` (sibling file)

---

## 1. Canonical math (single source of truth)

- [x] 1.1 Write `hariom-erp/services/spec-service/src/spec_math.py` — authoritative pure-Python calculators
- [x] 1.2 Write `apps/web-ui/lib/spec-math.ts` — mirror of 1.1, same constants and function names
- [x] 1.3 Shared constants live as module-level in both; any change is a cross-file edit
- [x] 1.4 `spec-service/tests/test_spec_math.py` parametrised and aligned with the current usable-bamboo-length workbook rule
- [x] 1.5 `apps/web-ui/__tests__/spec-math.test.ts` mirror exists; keep aligned with current bamboo usable-length rule

## 2. Master data — allow decimals everywhere the math needs them

- [x] 2.1 `PaperMaster.gsm` `Integer → Float` (models.py)
- [x] 2.2 Idempotent raw-SQL migration inside masterdata `_ensure_schema_compatibility`
- [x] 2.3 Pydantic `PaperCreate/Update/Response.gsm: int → float`; remove `int(...)` casts in router
- [x] 2.4 Mandrel: add `od_tolerance_mm Float default 0.1` column + migration + schema
- [x] 2.5 UI `components/forms/master-forms.tsx` — `step="0.01"` on every numeric input (gsm, bulk, bf, ply_bond, price, tube/mandrel dims)
- [x] 2.6 Master CRUD dialogs now await mutations and surface backend write errors instead of closing on failed add/edit
- [x] 2.7 Tube size / mandrel write paths now honor plant alias groups on update/delete, matching the read scope behavior
- [x] 2.8 RM paper master reset script now seeds the approved kraft grades for Plant A / Plant B and removes non-approved paper codes from those plants
- [x] 2.9 RM seed script skips synthetic `ALL` scope and preserves case-sensitive tool names so the full seed can complete cleanly
- [x] 2.10 RM paper master replaced again with the handwritten plant-specific set (`221`, `231`, `301`, `350`, `351`, `352`, `353`, `354`, `355`) and non-approved rows are removed from each plant
- [x] 2.11 Mandrel master writes now validate and persist cleanly with plant-scoped uniqueness instead of the old false-error/global-conflict path
- [x] 2.10 `RecipeLayer.gsm_snapshot` `Integer → Float` + runtime migration
- [x] 2.12 Add `GlobalSpecDefaults` table (adhesive %, parchment %, moisture %) + seed row per plant

## 3. Spec-service backend

- [x] 3.1 Add `SpecificationSheet.adhesive_percent, moisture_loss_percent, parchment_allowed` columns
- [x] 3.2 Migration inside `ensure_runtime_schema`
- [x] 3.3 Rewrite `calculators.py` to call `spec_math.compute_preview`
- [x] 3.4 New endpoint `POST /calculate/preview` — in-flight editor payload now returns the canonical computation shape the UI already expects
- [x] 3.5 New endpoints `GET/PUT /specs/defaults` (Admin only for update, per-plant globals)
- [x] 3.6 Extend `specs.py` create/update to accept the three globals + `parchment_allowed`
- [x] 3.7 BFF `apps/bff-api/src/routes/spec.py` — proxy `/preview` and `/defaults`

## 4. Frontend — spec sheet full redesign

- [x] 4.1 `lib/spec-math.ts` (1.2) ready
- [x] 4.2 Preview/state still lives in `hooks/use-specs.ts`, but the preview path is now aligned to canonical math
- [x] 4.3 `components/specs/shared/NumericInput.tsx` — decimal-safe with unit suffix
- [x] 4.4 `components/specs/shared/PaperPicker.tsx` — searchable dropdown from Paper Master
- [x] 4.5 `components/specs/shared/DeltaPill.tsx` — req vs finalised indicator
- [x] 4.6 `components/specs/sections/ClientReqCard.tsx`
- [x] 4.7 `components/specs/sections/RecipeMixCard.tsx` (3–5 papers, ≤18 ply, suggestions)
- [x] 4.8 `components/specs/sections/TubeCalcCard.tsx` (all read-only math)
- [x] 4.9 `components/specs/sections/NotchingCard.tsx` (port fields + NotchDiagramPanel)
- [x] 4.10 `components/specs/sections/PackingCard.tsx` (port fields)
- [x] 4.11 `components/specs/sections/ValidationFooter.tsx` (editable globals, approval block)
- [x] 4.12 `components/specs/SpecSheetWorkspace.tsx` — composes all sections
- [x] 4.13 `components/specs/print/SpecSheetPrint.tsx`
- [x] 4.14 Swap pages — `/specifications/new`, `/[id]`, `/[id]/edit`, `/[id]/print`
- [x] 4.15 `SpecSheetDocument.tsx` remains the live editor and now delegates to the section shell components without changing the business flow.
- [x] 4.16 Suggestion engine is now data-driven off the active paper master, restricted to 3–5 distinct papers and 18 total plies, and the UI renders the first 6 suggestions in a 3-column grid
- [x] 4.17 Spec editor now enforces plant-specific writes and Owner/Admin-only editability in the live UI, with helper copy when scope or role is invalid
- [x] 4.18 Parchment master is now vendor-first: vendor directory + color rows, add-new-vendor flow, and vendor families flow through to spec-sheet parchment selection
- [x] 4.19 Packaging master is redesigned into a single-workspace switcher for boxes, plastics, and fadda instead of the old long stacked page
- [x] 4.20 Dashboard/header shell is compacted into a single-row bar with smaller centered capsule nav and tighter role/plant/logout controls
- [x] 4.21 Spec bamboo wet/dry summary now uses live recipe output for usable bamboo length instead of target-tube back-calculation
- [x] 4.22 Spec-sheet applied combo label now reflects the current recipe rows, not the first suggestion card
- [x] 4.23 Suggestion engine now ranks closest dry-delta mixes by exhaustive valid ply search across 4–18 total plies
- [x] 4.24 Material rule card now separates target wet/dry from predicted wet/dry and shows target glue/parchment split instead of borrowing values from the first suggestion
- [x] 4.25 Visible suggestion cards now diversify by total ply count instead of showing six near-identical results from the same ply bucket
- [x] 4.26 Material rule summary metrics now stay on one compact desktop row to reduce wasted vertical space
- [x] 4.27 Tube weight band now uses a fixed `±3 g` rule instead of percent-based spread, and spec validation tolerance is fixed at `3 g`
- [x] 4.28 Wet/dry formula corrected: target wet is dry/divisor, adhesive/parchment are fixed from client dry weight, and paper is the remaining wet target to match by recipe
- [x] 4.29 Job-card print converted to portrait A4 one-page layout with expanded stage tables and signature area
- [x] 4.30 Reconciliation page redesigned for month-close actuals, variance review, approval notes, and rejection flow visibility
- [x] 4.31 Reconciliation formula bridge now treats wastage as absolute kg after moisture, not a second percentage loss
- [x] 4.32 Owner analytics and reports now use live owner-pack/report endpoints for KPIs, WIP, exceptions, inventory, dispatch, quality, and plant comparison
- [x] 4.33 Spec-sheet suggestion cards now call the canonical `computePreview` math, so recipe suggestions and live preview use the same dry-target/additive formula
- [x] 4.34 Job-card print preview now stretches the winder, oven, process, packing, and signature blocks across the full portrait A4 page instead of crowding the top

## 5. Verification

- [x] 5.1 `pytest services/spec-service/tests/test_spec_math.py`
- [x] 5.2 `npm run test` in `apps/web-ui` covers spec math, suggestions, and reconciliation bridge
- [x] 5.3 Manual/browser E2E per plan §Verification
- [x] 5.4 Cross-check Python/TS outputs for 5 fixtures (≤ 3 dp)
- [x] 5.5 Live BFF role fetch fixed (`/api/auth/roles` now returns seeded roles through BFF again)
- [x] 5.6 Live guard confirmed: `X-Plant-ID: ALL` rejects spec create with `Select one concrete plant for this write action`
- [x] 5.7 Live verification confirmed parchment vendors and color rows now both surface through BFF for plant-scoped master/spec use
- [x] 5.8 Live verification confirmed temporary mandrel create/delete round-trip works on `PLANT_A`
- [x] 5.9 Client workbook replay on `/api/spec/calculate/preview` confirmed the old bamboo mismatch was a UI derivation bug; preview now returns recipe-driven bamboo paper/wet/dry weights
- [x] 5.10 Regression test added for spec-sheet suggestion ranking and current-recipe title formatting
- [x] 5.11 Workbook replay confirmed sample A remains close to the handwritten sheet, while sample B is overweight because the handwritten recipe itself predicts ~335 g dry at the current canonical formula
- [x] 5.12 Rebuilt web-ui after the chunk mismatch, re-served the live UI on `127.0.0.1:13000`, and verified all login-page JS assets return JS instead of HTML
- [x] 5.13 Workbook replay rerun after the final tolerance pass:
  - sample A: `281.33 / 256.01 g` tube, `2813.31 / 2560.11 g` bamboo
  - sample B: `341.08 / 310.39 g` tube, `3410.83 / 3103.85 g` bamboo
  - both now report `delta_tolerance_g = 3`
- [x] 5.14 Dry-target formula verification after correction:
  - `250 g dry -> 274.73 g wet -> 37.50 g adhesive + 3.75 g parchment + 233.48 g paper`
  - BFF preview returns `paper_required_g = 233.48`, `pre_moisture_target_tube_g = 274.73`, and fixed `delta_tolerance_g = 3`
  - TypeScript math tests, suggestion tests, web build, status check, and login chunk check passed
- [x] 5.15 Job-card PDF generated at `output/pdf/sample-job-card-JC-3E2EB821.pdf` and verified as 1-page A4 portrait (`594.960 × 841.920`)
- [x] 5.16 Reconciliation route returns `200` on the rebuilt local runtime
- [x] 5.17 Reconciliation bridge unit test covers the corrected `107 + 15 + 1.5`, `9%` moisture, `12 kg` wastage example
- [x] 5.18 Owner/report BFF endpoints return `200` on the live direct runtime
- [x] 5.19 Job-card PDF regenerated for tracker job `JC-96D8A5BA` after the final portrait sizing pass and verified as A4 portrait
- [x] 5.20 Spec sample replay after formula fix:
  - handwritten sample A recipe returns `282.74 / 257.29 g` tube and is not green (`+7.29 g`)
  - handwritten sample B recipe returns `341.62 / 310.87 g` tube and is not green (`+10.87 g`)
  - current best suggestions produce green alternatives for both samples within `0.01 g`
- [x] 5.21 Rebuilt web-ui and regenerated `JC-96D8A5BA` PDF after the full-page job-card spacing pass
- [x] 5.22 Browser release gate rerun after Playwright is reinstalled in this checkout
- [x] 5.23 Single-command verification runs current Python compile, spec pytest, web lint/help/tests/typecheck/build, and exits green
- [x] 5.24 Hard-cutover validation regenerated the browser fixture and passed on the live runtime
- [x] 5.25 Single-command verification now includes `scripts/verify_spec_math_parity.py`, which compares Python and TypeScript `computePreview` output across five fixtures to ≤ 3 dp.
- [x] 5.26 Live opening-stock smoke posts a real audited opening-load document through BFF and writes `reports/opening_stock_live_smoke_latest.md`.

## 6. Out of scope (flagged)

- [-] Separate bamboo raw-material master with density per species
- [-] Multi-plant admin UI for global defaults
- [-] Changes to notching/packing field sets (ported 1:1)

---

## 7. Inventory stock accounting close

- [x] 7.1 Add persisted item policy fields: unit cost, cost source, reorder level, safety stock, and lead-time days
- [x] 7.2 Make inventory balances and item ledger reel-aware so raw-paper stock includes `PaperReel.current_weight_kg` and closed reel consumption
- [x] 7.3 Add dated stock statement API: opening + receipts - issues + opening adjustments = closing
- [x] 7.4 Add auditable opening-load documents for go-live/bootstrap stock with bulk batch and reel-tracked paper posting
- [x] 7.5 Add closing stock certification header/line tables with book quantity, physical quantity, variance, value, and policy snapshot
- [x] 7.6 Add certification lifecycle: draft from book statement, edit physical counts, certify, and lock
- [x] 7.7 Add formal carry-forward documents from certified closing stock without double-posting the running ledger
- [x] 7.8 Add BFF proxies and notifications for opening load, certification draft, certified close, carry-forward, and item policy update
- [x] 7.9 Build `/inventory/stock-control` as the planner/store/owner cockpit for opening stock, certification, and year carry-forward
- [x] 7.10 Upgrade item master UI so MRP policy is governed from master data instead of hidden defaults
- [x] 7.11 Update MRP to use persisted item policy only for reorder/safety/lead-time calculations
- [x] 7.12 Add reconciliation companion link that separates production variance close from inventory stock close
- [x] 7.13 Extend the premium browser E2E to cover the stock-control workspace

## 8. Inventory, roles, and operating dashboard polish

- [x] 8.1 Condense RBAC to the canonical matrix: Owner, Admin, Sales, Planner, PlantManager, Store, Dispatch, Operator
- [x] 8.2 Hide/deactivate old release, QA, maker, and approver demo users; seed clean canonical demo users only
- [x] 8.3 Expand user overrides for sales, planner, plant floor, store, dispatch, operator, reports, and system setup
- [x] 8.4 Convert the top role switcher to a compact dropdown and replace fixed nav buttons with a live route capsule
- [x] 8.5 Fix first-login/analytics global scope so Owner/Admin see Global / All Plants instead of raw plant UUIDs
- [x] 8.6 Add Supplier master under Master data and wire raw-material/reel inward supplier fields to dropdowns
- [x] 8.7 Keep Location master in System only and wire raw-material/reel inward location fields to dropdowns
- [x] 8.8 Seed default suppliers and inventory locations for Plant A and Plant B so fresh runtime dropdowns are usable
- [x] 8.9 Rebuild inventory landing with kg/value/risk KPIs, category split, top material load, aging, MRP actions, and location-wise stock
- [x] 8.10 Rebuild ledger/balances as one working location-aware stock statement and transaction surface
- [x] 8.11 Upgrade Owner/Admin dashboards with useful charts, real customer-name fallbacks, action queues, and non-empty data fallbacks
- [x] 8.12 Document opening load, daily inward, certification close, carry-forward, and alert policy behavior in the inventory UI
- [x] 8.13 Verify with Python compile, TypeScript compile, Next build, runtime restart, live BFF smoke endpoints, and focused Chromium Playwright flow

## 9. End-client readiness polish: search, filters, job-card names, and flow contracts

- [x] 9.1 Add a shared job-card display helper so planner, production, sales, dispatch, owner, and print surfaces show readable `JC-XXXXXXXX` refs instead of raw UUID slices.
- [x] 9.2 Fix production issue UI to post the live inventory-service contract: material item, quantity, actual job-card id, reason code, raw-paper exception flag, and external reference.
- [x] 9.3 Add searchable job-card dropdowns to production issue so stores cannot type invalid job references.
- [x] 9.4 Fix EOD production entry to read the legacy production-job endpoint that its validate/close actions use, with search and state filters.
- [x] 9.5 Add server-side production-job search by job card, operator, supervisor, job id, and sales order id.
- [x] 9.6 Add planner job-card search support for display refs like `JC-43B22B6B` and prefix-only searches like `JC`.
- [x] 9.7 Add working filters to reconciliation actual rows: material search, variance-only, matched rows, and plant-scope display normalization.
- [x] 9.8 Add working filters to inventory ledger/balances: item search, item type filter, and transaction search.
- [x] 9.9 Add working filters to system users: user/email search, role filter, status filter, and visible/total count.
- [x] 9.10 Seed planner demo queue back to 10 open unscheduled winder jobs so the drag/drop planner acceptance flow is testable.
- [x] 9.11 Verify with Python compile, TypeScript compile, Next build, live BFF smoke endpoints, planner demo seed, and focused Chromium Playwright flow.

## 10. Reconciliation and tracker separation pass

- [x] 10.1 Enforce sales-release target winder as a hard scheduling gate in planner API and planner drag/drop UI.
- [x] 10.2 Add monthly close history API and BFF/web client support for month-end audit records.
- [x] 10.3 Rebuild `/production/reconciliation` as a month-end close workspace with open/read-only/locked states, save actuals, close notes, variance KPIs, formula bridge, actual-entry tab, and close-history tab.
- [x] 10.4 Split `/planning/tracker` into a sales-order-to-dispatch tracker so it is no longer a duplicate job-card grid.
- [x] 10.5 Keep `/production/job-cards` as the individual job-card register with production-card details and document links.
- [x] 10.6 Verify with Python compile, Next build, TypeScript compile after build, runtime restart, BFF live smoke, page HTTP checks, and focused Chromium Playwright.

## 11. Master-data immutability and spec versioning guardrail

- [x] 11.1 Confirm master-data delete endpoints are soft-disable flows so historical orders, job cards, inventory ledgers, and specs keep valid references.
- [x] 11.2 Change shared master-table actions from destructive delete language/icons to explicit Disable actions.
- [x] 11.3 Convert supplier, customer, customer-contact, user, and plant exposed disable actions away from hard-delete semantics.
- [x] 11.4 Fix plant update/disable lookup so UI row ids and plant codes both resolve safely.
- [x] 11.5 Make specification edit create a new active version while disabling/obsoleting the previous version.
- [x] 11.6 Preserve previous dynamic spec fields when creating the replacement version, then apply the edited payload.
- [x] 11.7 Update the spec UI copy so users create a new version instead of thinking they are overwriting the old sheet.
- [x] 11.8 Run final compile/build/runtime verification for this pass.

## 12. Railway go-live hardening and final release gate

- [x] 12.1 Remove simple staging bootstrap defaults from the production Docker image so Railway does not ship fixed demo credentials.
- [x] 12.2 Make the container startup use Railway/Postgres `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, and `PGDATABASE` variables when attached.
- [x] 12.3 Refuse embedded Postgres on Railway unless explicitly forced for a disposable demo environment, preventing accidental live-data loss on redeploy.
- [x] 12.4 Require real `JWT_SECRET`, `BOOTSTRAP_ADMIN_PASSWORD`, and `BOOTSTRAP_OWNER_PASSWORD` values before the Railway runtime can start.
- [x] 12.5 Verify no internal task remains open in `TASKS.md`, `IMPLEMENTATION.md`, or `SYSTEM_DESIGN.md`.
- [x] 12.6 Run full repo verification, verified runtime restart, runtime consistency, hard-cutover validation, browser release gate, opening-stock smoke, and legacy-route redirect checks.
- [x] 12.7 Correct Railway production variables so staging password reset is disabled and the existing `/var/lib/postgresql` volume-backed Postgres is explicit.
- [x] 12.8 Deploy commit `3eb0295` to Railway production deployment `35baf5c1-5a86-407f-b626-23e63245a40c`.
- [x] 12.9 Verify Railway `/login`, old-route redirects, and authenticated `/api/auth/login` + `/api/auth/roles` on the public URL.
