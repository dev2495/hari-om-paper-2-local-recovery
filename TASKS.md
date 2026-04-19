# Spec Sheet Redesign — Task Tracker

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` skipped/not now

Linked plan: `/Users/devarshthakkar/.claude/plans/smooth-zooming-wirth.md`
Implementation log: `IMPLEMENTATION.md` (sibling file)

---

## 1. Canonical math (single source of truth)

- [x] 1.1 Write `hariom-erp/services/spec-service/src/spec_math.py` — authoritative pure-Python calculators
- [x] 1.2 Write `apps/web-ui/lib/spec-math.ts` — mirror of 1.1, same constants and function names
- [x] 1.3 Shared constants live as module-level in both; any change is a cross-file edit
- [ ] 1.4 `spec-service/tests/test_spec_math.py` parametrised, includes WhatsApp workbook fixture
- [~] 1.5 `apps/web-ui/__tests__/spec-math.test.ts` mirror exists; keep aligned with current bamboo usable-length rule

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
- [ ] 2.10 `RecipeLayer.gsm_snapshot` `Integer → Float` + migration
- [ ] 2.12 Add `GlobalSpecDefaults` table (adhesive %, parchment %, moisture %) + seed row per plant

## 3. Spec-service backend

- [x] 3.1 Add `SpecificationSheet.adhesive_percent, moisture_loss_percent, parchment_allowed` columns
- [x] 3.2 Migration inside `ensure_runtime_schema`
- [ ] 3.3 Rewrite `calculators.py` to call `spec_math.compute_preview`
- [x] 3.4 New endpoint `POST /calculate/preview` — in-flight editor payload now returns the canonical computation shape the UI already expects
- [ ] 3.5 New endpoints `GET/PUT /specs/defaults` (Admin only, per-plant globals)
- [x] 3.6 Extend `specs.py` create/update to accept the three globals + `parchment_allowed`
- [ ] 3.7 BFF `apps/bff-api/src/routes/spec.py` — proxy `/preview` and `/defaults`

## 4. Frontend — spec sheet full redesign

- [x] 4.1 `lib/spec-math.ts` (1.2) ready
- [~] 4.2 Preview/state still lives in `hooks/use-specs.ts`, but the preview path is now aligned to canonical math
- [ ] 4.3 `components/specs/shared/NumericInput.tsx` — decimal-safe with unit suffix
- [ ] 4.4 `components/specs/shared/PaperPicker.tsx` — searchable dropdown from Paper Master
- [ ] 4.5 `components/specs/shared/DeltaPill.tsx` — req vs finalised indicator
- [ ] 4.6 `components/specs/sections/ClientReqCard.tsx`
- [ ] 4.7 `components/specs/sections/RecipeMixCard.tsx` (3–5 papers, ≤18 ply, suggestions)
- [ ] 4.8 `components/specs/sections/TubeCalcCard.tsx` (all read-only math)
- [ ] 4.9 `components/specs/sections/NotchingCard.tsx` (port fields + NotchDiagramPanel)
- [ ] 4.10 `components/specs/sections/PackingCard.tsx` (port fields)
- [ ] 4.11 `components/specs/sections/ValidationFooter.tsx` (editable globals, approval block)
- [ ] 4.12 `components/specs/SpecSheetWorkspace.tsx` — composes all sections
- [ ] 4.13 `components/specs/print/SpecSheetPrint.tsx`
- [ ] 4.14 Swap pages — `/specifications/new`, `/[id]`, `/[id]/edit`, `/[id]/print`
- [~] 4.15 `SpecSheetDocument.tsx` is still the live editor, but the current pass trims redundancy inside it: client-first flow, material-rules panel, one manufacturing output block, validation-footer globals
- [~] 4.16 Suggestion engine is now data-driven off the active paper master, restricted to 3–5 distinct papers and 18 total plies, and the UI renders the first 6 suggestions in a 3-column grid
- [~] 4.17 Spec editor now enforces plant-specific writes and Owner/Admin-only editability in the live UI, with helper copy when scope or role is invalid
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

- [ ] 5.1 `pytest services/spec-service/tests/test_spec_math.py`
- [ ] 5.2 `pnpm --filter web-ui test spec-math`
- [~] 5.3 Manual E2E per plan §Verification
- [ ] 5.4 Cross-check Python/TS outputs for 5 fixtures (≤ 3 dp)
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
- [ ] 5.22 Browser release gate rerun after Playwright is reinstalled in this checkout

## 6. Out of scope (flagged)

- [-] Separate bamboo raw-material master with density per species
- [-] Multi-plant admin UI for global defaults
- [-] Changes to notching/packing field sets (ported 1:1)
