# Spec Sheet Redesign — Implementation Log

Running log of what has shipped. Append-only — latest at the bottom of each section.

Linked: `TASKS.md`, `/Users/devarshthakkar/.claude/plans/smooth-zooming-wirth.md`.

---

## Canonical math reference

Everything below is implemented identically in `spec-service/src/spec_math.py` (Python, authoritative) and `apps/web-ui/lib/spec-math.ts` (TS, UI preview).

### Constants (defaults; per-spec overrides allowed in Validation footer)

| Constant | Value | Meaning |
|---|---|---|
| `GLOBAL_ADHESIVE_PERCENT` | 15.0 | % share of wet tube weight |
| `GLOBAL_PARCHMENT_PERCENT` | 1.5 | % share of wet tube weight (only if `parchment_allowed`) |
| `GLOBAL_MOISTURE_LOSS_PERCENT` | 9.0 | wet→dry loss; wet divisor = 0.91 |
| `BAMBOO_LENGTH_MIN_MM` | 1390 | |
| `BAMBOO_LENGTH_MAX_MM` | 1560 | |
| `BAMBOO_LENGTH_STEP_MM` | 10 | |
| `BAMBOO_CUT_LOSS_MM` | 40 | |
| `MANDREL_TOLERANCE_MM` | 0.1 | ID = mandrel_od ± tol |
| `RECIPE_MIN_PAPERS` | 3 | distinct papers |
| `RECIPE_MAX_PAPERS` | 5 | distinct papers |
| `RECIPE_MAX_PLIES` | 18 | total plies |
| `DELTA_ABS_G` | 3 | absolute tolerance |
| `DELTA_PCT` | 0.0 | no percent tolerance; fixed `±3 g` only |

### Formulas

**1. Paper thickness**
```
thickness_mm = GSM × bulk / 1000
```
GSM in g/m², bulk in cm³/g, thickness in mm. Derivation: 1 m² × thickness_cm cm³ = 10 000 × thickness_cm ; bulk = volume/weight → thickness_cm = GSM·bulk/10 000 → ×10 for mm.

**2. Tube geometry**
```
ID        = mandrel_od               (tolerance ±MANDREL_TOLERANCE_MM)
wall      = Σ thickness_i
OD        = ID + 2 × wall
avg_dia_i = ID + 2 × (Σ thickness_{1..i-1}) + thickness_i
```

**3. Per-mm weight (core unit)**
```
weight_per_mm_i     = GSM_i × π × avg_dia_i / 1_000_000
paper_weight_per_mm = Σ weight_per_mm_i
```

**4. Paper weight of tube / bamboo**
```
tube_paper_g   = paper_weight_per_mm × tube_length_mm
bamboo_paper_g = paper_weight_per_mm × bamboo_length_mm
```

**5. Wet → dry**

The commercial target is the finished dry tube. Wet target is derived first.
Adhesive and parchment are fixed percentages of the client dry target, and the
paper recipe must fill the remaining wet target.

```
wet_target_g     = target_dry_g ÷ (1 − M/100)
adhesive_g       = target_dry_g × A/100
parchment_g      = parchment_allowed ? target_dry_g × P/100 : 0
paper_required_g = wet_target_g − adhesive_g − parchment_g
predicted_wet_g  = paper_recipe_g + adhesive_g + parchment_g
predicted_dry_g  = predicted_wet_g × (1 − M/100)
```

**6. Reverse (target dry → required paper)**
With defaults and parchment on: `250 g dry → 274.73 g wet → 37.50 g adhesive + 3.75 g parchment + 233.48 g paper`.

**7. Bamboo plan**
Scan `L = MAX .. MIN` in `STEP`:
```
usable = L − CUT_LOSS
tubes  = usable // tube_length_mm
waste  = usable − tubes × tube_length_mm
```
Pick by `(tubes desc, waste asc, length desc)`.

**8. Recipe validity**
- `3 ≤ distinct_papers ≤ 5`
- `total_plies ≤ 18`
- `|predicted_dry − target_dry| ≤ 3 g`

---

## Shipped — chronological

### 2026-04-17 · Planning + docs seeded
- Plan saved at `/Users/devarshthakkar/.claude/plans/smooth-zooming-wirth.md`
- `TASKS.md` and this file created in repo root.
- Confirmed active stack: Next.js 14 + React 18 (`apps/web-ui`), FastAPI microservices (`hariom-erp/services/*`), no alembic for spec/masterdata — migrations run via idempotent raw-SQL in `ensure_runtime_schema()` / `_ensure_schema_compatibility()`.
- Bugs confirmed:
  - `spec-service/src/calculators.py:35,38` — divides adhesive by 10 000 instead of 100
  - Frontend (9.5 %) and backend (10 %) moisture loss mismatch
  - `PaperMaster.gsm` stored as `Integer`; UI forms without `step` silently block decimals
  - No GSM → tube-weight forward pipeline; only reverse from target
  - Mandrel tolerance (±0.1 mm) unmodeled

### 2026-04-17 · Canonical preview + worksheet cleanup pass
- The shared math path is now tighter:
  - `apps/web-ui/lib/spec-math.ts`
  - `hariom-erp/services/spec-service/src/spec_math.py`
  Both now use **usable bamboo length** (`selected length - cut loss`) for bamboo paper / wet / dry weight instead of the full bamboo stick length.
- The UI preview fallback in `apps/web-ui/hooks/use-specs.ts` no longer carries its own stale weight logic. It now maps recipe rows into `computePreview(...)`, so the fallback path and the backend route share the same wet/dry/bamboo rule.
- Added the missing FastAPI preview route at `hariom-erp/services/spec-service/src/routers/calculations.py`:
  - `POST /calculate/preview`
  - Accepts the in-flight spec editor payload, reconstructs canonical paper inputs, and returns the summary shape the current UI already expects.
- Moisture-loss defaults were normalized to **9.0%** across the current spec stack:
  - `apps/web-ui/hooks/use-specs.ts`
  - `apps/web-ui/lib/spec-sheet.ts`
  - `apps/web-ui/components/specs/spec-sheet-utils.ts`
  - `apps/web-ui/components/specs/SpecSheetDocument.tsx`
- The live worksheet in `SpecSheetDocument.tsx` was tightened rather than replaced:
  - added `parchmentAllowed` into editor state and persistence
  - save payload now writes `parchment_percent`, `parchment_allowed`, `adhesive_percent`, and `moisture_loss_percent`
  - client requirement stays first
  - top-right card is now material rules / adhesive / parchment selection, not editable global percentages
  - manufacturing output is collapsed into one matrix block instead of separate client/manufacturing/bamboo tables
  - validation footer now owns the editable global adhesive %, parchment %, and moisture-loss % controls plus reset-to-default
- Decimal master-data support was confirmed already present in the current repo snapshot:
  - paper GSM is `Float`
  - mandrel tolerance column exists with runtime compatibility SQL
  - paper / tube / mandrel forms already expose decimal `step` values

### 2026-04-17 · Master CRUD stabilization + RM paper master reset
- `apps/web-ui/components/common/crud-table.tsx`
  - add/edit dialogs now `await` the page mutation promises
  - failed writes no longer close the dialog silently
  - backend errors now render inline in the dialog body
- CRUD page callers now use `mutateAsync(...)` across the master/system workspaces so UI state matches real backend results:
  - papers
  - adhesives
  - parchments
  - tube sizes
  - mandrels
  - packaging
  - tools
  - plants
  - machines
- Plant-scope write parity fixed for `tube_size.py` and `mandrel.py`:
  - update/delete now use `accepted_persisted_plant_ids(...)`
  - this matches the alias-aware read scope, so `PLANT_A` / `PLANT_B` writes no longer miss UUID-backed rows
- RM master seed was corrected and rerun:
  - `scripts/seed_rm_master.py` now skips synthetic `ALL` from `/api/auth/plants`
  - tool upsert keys preserve case-sensitive names so `5x10mm` and `5X10mm` do not collapse into one row
  - paper payloads derive `bulk_factor = thickness_mm * 1000 / gsm`, so persisted thickness matches the approved workbook caliper
- Approved kraft paper set now seeded in both Plant A and Plant B:
  - `KRAFT-230-18BF`
  - `KRAFT-250-18BF`
  - `KRAFT-300-18BF`
  - `KRAFT-301-400PB`
  - `KRAFT-350-300PB`
  - `KRAFT-351-400PB`
  - `KRAFT-352-500PB`
  - `KRAFT-353-600PB`
  - `KRAFT-354-700PB`
  - `KRAFT-355-350PB`
  - `KRAFT-401-400PB`
- Verified live through the running ERP shell session:
  - BFF health: `{"status":"healthy","service":"bff-api"}`
  - masterdata health: `{"status":"healthy","service":"masterdata-service","database":"connected"}`
  - decimal paper write succeeded end-to-end through BFF:
    - request: `gsm=237.5`, `bulk_factor=1.3`, `ply_bond=0.55`
    - response: `thickness_mm=0.3088`
  - decimal test row was then deleted cleanly

### 2026-04-17 · Plant-isolated write guard + RM set refresh + auth-role repair
- `apps/web-ui/context/AuthContext.tsx`
  - Owner/Admin users no longer default to `ALL` when there is no stored scope.
  - Explicit stored `ALL` is still respected, but the default landing scope is now the first concrete allowed plant.
- `apps/web-ui/components/PlantSwitcher.tsx`
  - `ALL` is relabeled as `Global Analytics`.
  - The dropdown now makes the read-only nature of `ALL` explicit.
- `apps/web-ui/components/common/crud-table.tsx`
  - Add/edit/delete are blocked while the active scope is `ALL` for plant-bound datasets.
  - Inline helper message now tells the user to pick a concrete plant before writing.
- `apps/web-ui/app/(dashboard)/layout.tsx`
  - Removed the stale identity pill from the top bar.
  - Top-right controls now reduce to: role pill + plant switcher for Owner/Admin, plus logout.
  - Shortcut nav moved into a centered small capsule strip.
- `apps/web-ui/components/specs/SpecSheetDocument.tsx`
  - Spec editing is now Owner/Admin only.
  - Spec create/edit/approve are blocked when the active scope is `ALL`.
  - Helper message is shown directly in the sheet header when role/scope blocks editing.
  - Manufacturing ID band now follows the latest rule:
    - `avg = mandrel`
    - `min = mandrel - 0.1`
    - `max = mandrel + 0.1`
  - Suggestion cards now render in a compact grid (`up to 6`, `3-per-row` on wide screens) with the actual applied row mix shown on each card.
- `apps/web-ui/lib/spec-sheet.ts`
  - Removed the stale hardcoded `2x250 + 1x300` suggestion bias.
  - Suggestions are now generated from the active paper master itself.
  - Generator now:
    - dedupes by paper code
    - emits only `3–5` distinct-paper combos
    - enforces `≤18` total plies
    - keeps the lower-ply / closest-delta results at the top
- `scripts/seed_rm_master.py`
  - RM paper master was reset to the handwritten sheet values:
    - `221` → `220gsm / BF 20 / ply bond 400 / bulk 1.50`
    - `231` → `230gsm / BF 28 / ply bond 400 / bulk 1.50`
    - `301` → `300gsm / BF 20 / ply bond 400 / bulk 1.50`
    - `350` → `350gsm / BF 16 / ply bond 300 / bulk 1.55`
    - `355` → `350gsm / BF 18 / ply bond 350 / bulk 1.55`
    - `351` → `350gsm / BF 20 / ply bond 400 / bulk 1.50`
    - `352` → `350gsm / BF 24 / ply bond 500 / bulk 1.45`
    - `353` → `350gsm / BF 28 / ply bond 600 / bulk 1.40`
    - `354` → `350gsm / BF 32 / ply bond 700 / bulk 1.40`
- Auth/spec backend hardening:
  - `apps/bff-api/src/routes/auth.py`
    - `/api/auth/roles` now proxies to `AUTH_SERVICE_URL/roles/`, fixing the redirect/failure that broke user creation.
  - `hariom-erp/services/spec-service/src/routers/specs.py`
  - `hariom-erp/services/spec-service/src/routers/recipes.py`
  - `hariom-erp/services/spec-service/src/routers/trials.py`
  - `hariom-erp/services/spec-service/src/routers/spec_fields.py`
    - Mutating spec endpoints now follow the current business rule: Owner/Admin only.
- `apps/web-ui/app/(dashboard)/system/users/new/page.tsx`
  - User-create page now loads roles and plants together.
  - Seeded fallback roles are used if auth role metadata is temporarily unavailable, so the page does not dead-end.
  - Plant dropdown now hydrates from live auth plant data instead of a purely hardcoded list.

### 2026-04-17 · Verification after this pass
- `npm run build` in `apps/web-ui` passed.
- Python syntax check passed for:
  - `apps/bff-api/src/routes/auth.py`
  - `hariom-erp/services/spec-service/src/routers/specs.py`
  - `hariom-erp/services/spec-service/src/routers/recipes.py`
  - `hariom-erp/services/spec-service/src/routers/trials.py`
  - `hariom-erp/services/spec-service/src/routers/spec_fields.py`
  - `scripts/seed_rm_master.py`
- Live runtime verified from the persistent shell session:
  - `GET http://127.0.0.1:14000/api/auth/roles` now returns the seeded role list through BFF.
  - `GET http://127.0.0.1:14000/api/master/papers` with `X-Plant-ID: PLANT_A` returns the handwritten RM set (`221`, `231`, `301`, `350`, `351`, `352`, `353`, `354`, `355`).
  - `POST http://127.0.0.1:14000/api/spec/specifications` with `X-Plant-ID: ALL` fails with:
    - `Select one concrete plant for this write action`
  - This confirms the plant-isolated write rule is live on the spec flow.

### 2026-04-18 · Mandrel write fix + parchment/packaging/header cleanup + bamboo correction
- Mandrel writes were still confusing because the backend could save a row and then surface a false create error under the old uniqueness model. The fix was to make mandrel codes unique per plant instead of globally:
  - `hariom-erp/services/masterdata-service/src/models.py`
  - `hariom-erp/services/masterdata-service/src/main.py`
  - `hariom-erp/services/masterdata-service/src/routers/mandrel.py`
- The runtime compatibility path now drops the stale global mandrel unique/index if present and recreates a plant-scoped uniqueness guard (`uq_mandrel_plant_code`). The create endpoint also pre-checks duplicates within the accepted persisted plant ids and returns a clean `409` for same-plant duplicates.
- `apps/web-ui/components/forms/master-forms.tsx`
  - `MandrelForm` now sanitizes decimal inputs before submit and normalizes blank/invalid auxiliary fields, removing the front-end path that could submit values the backend then half-accepted.

- Parchment master is now vendor-first instead of one flat ambiguous row list:
  - `apps/bff-api/src/routes/master.py`
  - `apps/web-ui/lib/api.ts`
  - `apps/web-ui/hooks/use-master-data.ts`
  - `apps/web-ui/components/forms/master-forms.tsx`
  - `apps/web-ui/app/(dashboard)/master/parchments/page.tsx`
- New BFF endpoints:
  - `GET /api/master/parchment/vendors`
  - `POST /api/master/parchment/vendors`
- Existing `GET /api/master/parchments` now merges vendor-only placeholder rows into the flat response shape so the current spec-sheet family selector can see vendor families even before color rows are added.
- The new parchment workspace splits the job into:
  - left vendor directory / quick-add vendor
  - right color CRUD table tied to the selected vendor family
- `ParchmentForm` now supports either selecting an existing vendor or creating a new one inline, while still storing the actual parchment color/display rows.

- Packaging master was redesigned to reduce vertical waste:
  - `apps/web-ui/app/(dashboard)/master/packaging/page.tsx`
  - `apps/web-ui/components/common/crud-table.tsx`
- Instead of rendering all packaging datasets in one long page, the workspace now shows summary counts and one active section at a time:
  - box masters
  - plastic sheet masters
  - fadda masters
- This keeps the CRUD focus on one dataset and reduces the scroll depth on the page.

- The desktop dashboard shell/header was compressed into a single-row layout:
  - `apps/web-ui/app/(dashboard)/layout.tsx`
- Changes:
  - compact center search
  - smaller centered capsule nav
  - role pill + plant switcher + logout aligned in one row
  - `/masters/*` and `/system/*` route aliases now resolve to correct workspace labels instead of falling back to stale dashboard labeling

- The spec-sheet bamboo discrepancy against the client sample was traced to a real UI bug, not only workbook variance:
  - `apps/web-ui/components/specs/SpecSheetDocument.tsx`
  - `apps/web-ui/hooks/use-specs.ts`
  - `hariom-erp/services/spec-service/src/routers/calculations.py`
- Old behavior:
  - bamboo dry/wet numbers on the screen were derived from the target tube weight (`form.averages.weight`) and moisture divisor, effectively treating bamboo as `target tube × tubes per bamboo`
- Correct behavior now:
  - bamboo paper / wet / dry all come from the live recipe preview summary
  - bamboo uses usable bamboo length after trim loss
  - fallback path multiplies the computed live tube wet/dry by `tubes_per_bamboo`, not the target
- Added preview summary fields:
  - `paper_required_g`
  - `bamboo_required_paper_g`
  - `bamboo_required_wet_g`
  - `bamboo_required_dry_g`
- For the client replay sample (`110.65 × 122 × 150`, CS `400`, target `250 g`, recipe `231x1 + 221x2 + 301x3 + 350x3 + 351x3 + 355x2`), the corrected preview returned:
  - paper total: `241.49 g`
  - tube wet/dry: `281.33 / 256.01 g`
  - bamboo selection: `1540 mm` with `1500 mm` usable
  - tubes per bamboo: `10`
  - bamboo wet/dry: `2813.31 / 2560.11 g`
- This is materially closer to the handwritten client note (`2820 / 2565`) and explains why the old UI showed a lower stale bamboo value: it was using target-driven math, not recipe-driven output.

### 2026-04-18 · Verification after this pass
- `curl -s http://127.0.0.1:14000/health` returned healthy BFF.
- Live auth login through BFF still succeeds for the admin test account.
- Live parchment vendor verification:
  - `GET /api/master/parchment/vendors` on `PLANT_A` returned the seeded vendor families (`Amma`, `China`, `Sagar`)
  - `GET /api/master/parchments` now returns both vendor placeholder rows and actual color rows so the spec flow can source family choices from the same live dataset
- Live mandrel verification:
  - temp mandrel create on `PLANT_A` succeeded with decimal OD/tolerance payload
  - temp mandrel delete succeeded immediately after
- Build/syntax verification:
  - `npm run build` passed in `apps/web-ui`
  - `python3 -m py_compile` passed for the touched BFF/masterdata/spec-service files
- Browser gate status:
  - `scripts/browser_release_gate.sh` was attempted on 2026-04-18
  - it failed because `@playwright/test` is not installed in this local checkout, not because of a detected product regression

### 2026-04-18 · Spec suggestion ranking + applied-rule sync fix
- `apps/web-ui/lib/spec-sheet.ts`
  - added `formatRecipeRowsTitle(...)` so the sheet can label the actual current recipe mix instead of reusing the first suggestion card title
  - removed the old two-strategy suggestion heuristic (`balanced` / `heavy`)
  - suggestion generation now enumerates every valid ply distribution for each 3–5-paper set across `4..18` total plies
  - ranking is now:
    1. smallest absolute dry delta
    2. smaller total ply count
    3. smaller absolute wet delta
    4. title tie-break
- `apps/web-ui/components/specs/SpecSheetDocument.tsx`
  - the “Applied combo rule” header now reads from the current `form.recipeRows` first
  - fallback to suggestion title only happens when there is no active recipe yet
- This fixes the mismatch where:
  - the right-column suggestions could change independently of the sheet title
  - the title could stay pinned to the first suggestion even after the operator changed the recipe rows manually
  - the suggestion list missed the true closest-delta mix because it was only testing two hand-picked ply-shape heuristics instead of all valid 4–18 ply allocations

### 2026-04-18 · Verification after the suggestion fix
- Added regression test:
  - `apps/web-ui/__tests__/spec-sheet-suggestions.test.ts`
  - covers:
    - current recipe title formatting
    - suggestion ranking against a brute-force exact search on the live RM sample set
- Test run passed:
  - `node -r sucrase/register __tests__/spec-sheet-suggestions.test.ts`
  - result: `PASS 2/2`
- `npm run build` passed in `apps/web-ui`
- Runtime restarted successfully after the build:
  - Web UI: `http://127.0.0.1:13000/login`
  - BFF: `http://127.0.0.1:14000/health`

### 2026-04-18 · Target-vs-predicted formula card fix + diversified visible suggestions
- `apps/web-ui/components/specs/SpecSheetDocument.tsx`
  - removed the stale fallback where the top formula card borrowed `paper / wet / dry` numbers from the first suggestion even when no recipe had been applied
  - the material rule area now separates:
    - target wet / dry (`target dry ÷ divisor`)
    - target formula split (`required paper`, `glue`, `parchment`)
    - predicted wet / dry from the current live recipe only
    - dry delta vs target
  - this resolves the confusing state where the page could simultaneously show:
    - recipe status `-250 g` (no recipe)
    - but a non-zero wet/dry number from the first suggestion card
- `apps/web-ui/lib/spec-sheet.ts`
  - added `pickVisibleRecipeSuggestions(...)`
  - the visible six cards now choose distinct total-ply counts first, then fill remaining slots by next-best delta
  - this keeps the ranked list grounded in closest dry delta while avoiding six cards from the same ply bucket when many near-ties exist

### 2026-04-18 · Workbook replay after the target/predicted split
- Sample A replay (`110.65 mandrel`, `122 OD`, `150 length`, `250 g dry`, recipe `231x1 + 221x2 + 301x3 + 350x3 + 351x3 + 355x2`) returned:
  - tube wet/dry: `281.33 / 256.01 g`
  - bamboo wet/dry: `2813.31 / 2560.11 g`
  - selected bamboo: `1540 mm` (`1500 mm` usable, `10 pcs`)
- This remains close to the handwritten note (`2820 / 2565`) and is consistent with the canonical formula:
  - `wet = paper + glue + parchment`
  - `dry = wet × 0.91`
- Sample B replay (`125.65 mandrel`, `138 OD`, `150 length`, `300 g dry`, recipe `231x1 + 301x2 + 350x4 + 355x8`) returned:
  - tube wet/dry: `368.29 / 335.15 g`
  - bamboo wet/dry: `3682.94 / 3351.47 g`
- Conclusion on sample B:
  - the current canonical math does **not** indicate a formula bug there
  - that handwritten recipe is simply overweight for a `300 g dry` target under the live RM paper master inputs
  - if the client workbook is expecting ~`3080 g` bamboo dry for that second sample, then at least one of these differs from the current sheet inputs:
    - paper bulk/thickness
    - mandrel used
    - parchment on/off
    - moisture-loss divisor
    - recipe ply counts

### 2026-04-18 · Verification after this pass
- `node -r sucrase/register __tests__/spec-sheet-suggestions.test.ts`
  - result: `PASS 3/3`
- `npm run build` in `apps/web-ui`
  - passed
- Manual replay script on the live spec math confirmed the visible suggestion ply counts for the sample target now span:
  - `13, 14, 15, 16, 17, 18`

### 2026-04-18 · Final spec-sheet cleanup pass
- `apps/web-ui/components/specs/SpecSheetDocument.tsx`
  - compacted the material-rule summary metrics into one desktop row (`lg:grid-cols-4`) so the formula card no longer wastes a second line for the fourth tile
- `apps/web-ui/hooks/use-specs.ts`
  - removed the dead remote suggestions bootstrap call; suggestions now come directly from the local exhaustive ranker, which also removes the old `404 /api/spec/calculate/suggestions` noise during editor boot
- `apps/bff-api/src/routes/spec.py`
  - fixed `/spec-fields` proxy targets to use the service router’s trailing slash so the editor no longer starts with repeated `307` redirects when it hydrates missing catalog fields
- `apps/web-ui/lib/spec-math.ts`
  - validation tolerance is now fixed at `3 g` exactly (`delta_tolerance_g = 3`) instead of `max(3 g, 3%)`
- `hariom-erp/services/spec-service/src/spec_math.py`
  - mirrored the same fixed `3 g` tolerance on the backend
- `apps/web-ui/lib/spec-sheet.ts`
  - changed the saved/displayed tube weight min/max band from percent-based spread to `target weight ± 3 g`

### 2026-04-18 · Final verification on current runtime
- `node -r ./node_modules/sucrase/register -e "require('./__tests__/spec-math.test.ts')"`
  - result: `PASS 20/20`
- `python3 -m py_compile`
  - passed for:
    - `hariom-erp/services/spec-service/src/spec_math.py`
    - `hariom-erp/services/spec-service/src/routers/calculations.py`
- `npm run build`
  - passed in `apps/web-ui`
- login-page chunk check on live runtime
  - all referenced `/_next/static/...` assets returned JavaScript, not HTML
- current live runtime held open on:
  - Web UI: `http://127.0.0.1:13000/login`
  - BFF: `http://127.0.0.1:14000/health`

### 2026-04-18 · Workbook replay with current final math
- Sample A (`110.65 mandrel`, `110.45 × 122 × 150`, target `250 g dry`, recipe `231x1 + 221x2 + 301x3 + 350x3 + 351x3 + 355x2`)
  - tube wet/dry: `281.33 / 256.01 g`
  - bamboo wet/dry: `2813.31 / 2560.11 g`
  - result remains close to the handwritten note `2820 / 2565`
- Sample B (`125.65 mandrel`, `125 × 138 × 150`, target `300 g dry`, recipe `231x1 + 301x2 + 351x3 + 350x8`)
  - tube wet/dry: `341.08 / 310.39 g`
  - bamboo wet/dry: `3410.83 / 3103.85 g`
  - this remains overweight versus the handwritten note, which means the mismatch is in the handwritten input set versus the live canonical master values, not in the current wet/dry pipeline itself

### 2026-04-19 · Dry-target formula correction
- User clarified the workbook rule: start from required dry tube weight, compute wet weight using the moisture divisor, then take adhesive and parchment as percentages of the client dry target. Paper is the remaining wet target.
- Corrected the canonical math in both mirrors:
  - `apps/web-ui/lib/spec-math.ts`
  - `hariom-erp/services/spec-service/src/spec_math.py`
- Corrected the formula-card copy and target split in `SpecSheetDocument.tsx`; target adhesive/parchment are now shares of client dry weight, not wet-weight shares or paper-weight markups.
- Canonical example:
  - target dry: `250.00 g`
  - wet divisor: `0.91`
  - target wet: `274.73 g`
  - adhesive at `15%` of dry: `37.50 g`
  - parchment at `1.5%` of dry: `3.75 g`
  - required paper: `233.48 g`
- Focused verification:
  - `node -r ./node_modules/sucrase/register __tests__/spec-math.test.ts` → `PASS 21/21`
  - `node -r ./node_modules/sucrase/register __tests__/spec-sheet-suggestions.test.ts` → `PASS 3/3`
  - `python3 -m py_compile` passed for `spec_math.py` and `routers/calculations.py`
  - `npm run build` passed in `apps/web-ui`
  - `python3 -m pytest .../test_spec_math.py` could not run because the active system Python does not have `pytest` installed
- Runtime verification:
  - full stack is running on `http://127.0.0.1:13000/login` with BFF on `http://127.0.0.1:14000/health`
  - `bash ./status_all.sh` reports all services running
  - login-page JS chunk check returned `all-js-assets-ok`
  - BFF preview replay for sample A returned:
    - `paper_required_g: 233.48`
    - `pre_moisture_target_tube_g: 274.73`
    - `predicted_wet_tube_g: 289.2`
    - `predicted_dry_tube_g: 263.18`
    - `dry_delta_g: 13.18`
  - The sample A handwritten recipe is therefore overweight under the clarified rule because its paper total is `241.49 g`, while the corrected target paper requirement is `233.48 g`.

### 2026-04-19 · Job card and reconciliation pass
- `JobCardDocument.tsx` now prints the scheduled release job card as a portrait A4 one-page document with a larger execution grid, stage-wise rejection fields, QR lookup, and operator/QC/supervisor sign-off area.
- `production/reconciliation/page.tsx` now provides a month-close workspace: theoretical consumption, actual master-data input, variance/cost columns, approval notes, and an explicit rejection tracking flow across winder, oven, process, and month close.
- Month-end bridge formula in the UI:
  - `final_output = (paper + adhesive + parchment) × (1 - moisture%) - wastage_kg`
  - example `107 + 15 + 1.5 = 123.5 kg` wet input
  - moisture loss at `9%` is `11.115 kg`, so dry after moisture is `123.5 × 0.91 = 112.385 kg`
  - absolute process wastage `12 kg` leaves `112.385 - 12 = 100.385 kg` output
  - exact paper for `100 kg` output with `15 kg` adhesive, `1.5 kg` parchment, `9%` moisture, and `12 kg` wastage is `((100 + 12) / 0.91) - 15 - 1.5 = 106.5769 kg`
- New `apps/web-ui/lib/reconciliation-math.ts` keeps the bridge calculation testable and shared by the UI.
- `apps/web-ui/components/analytics/OwnerIntelligenceSuite.tsx` and `ReportDetailPage.tsx` now turn the existing live analytics endpoints into a practical report suite:
  - owner pack: active jobs, sales backlog, dispatch, blocked jobs, inventory value, low-stock count, QC holds, OTIF, WIP stage mix, exceptions, rejection trail, plant comparison
  - report pages: production, sales, inventory, quality, dispatch, plants, and exceptions
- Generated sample PDF:
  - `output/pdf/sample-job-card-JC-3E2EB821.pdf`
  - verified by `file` as `PDF document, version 1.4, 1 pages`
  - verified by `sips` as `594.960 × 841.920` portrait pixels
- Regenerated tracker sample PDF after the final portrait sizing pass:
  - `output/pdf/sample-job-card-JC-96D8A5BA.pdf`
  - source route: `/production/job-cards/96d8a5ba-54b2-45c9-9d68-267929d98f5d/print`
  - verified by `file` as `PDF document, version 1.4, 1 pages`
  - verified by `sips` as `594.960 × 841.920` portrait pixels
  - rendered preview: `output/pdf/sample-job-card-JC-96D8A5BA-preview.png`

### 2026-04-20 · Job-card full-page spacing and spec sample replay
- `JobCardDocument.tsx` keeps the same A4 portrait document, but the screen/print preview now stretches the execution blocks across the sheet:
  - full-page flex sheet body
  - taller winder/oven/process/packing blocks
  - taller measurement rows
  - signature block pushed to the lower sheet area instead of sitting mid-page
- `apps/web-ui/lib/spec-sheet.ts` suggestion math now calls canonical `computePreview` instead of the older paper-share approximation.
  - This keeps suggestion cards, live preview, validation delta, and the saved spec report on the same formula.
- Reconciliation month-close formula remains:
  - `final_output = (paper + adhesive + parchment) × (1 - moisture%) - wastage_kg`
  - the `12 kg` historical average is treated as absolute final process loss after the 9% moisture loss, not as `12%`.
- Spec sample replay after the dry-target formula fix:
  - Sample A handwritten recipe (`231x1 + 221x2 + 301x3 + 350x3 + 351x3 + 355x2`, target `250 g`, mandrel `110.65`, length `150`)
    - target: `274.73 g wet`, `233.48 g paper`, `37.50 g adhesive`, `3.75 g parchment`
    - actual recipe: `282.74 / 257.29 g` tube, `2827.36 / 2572.90 g` bamboo
    - result: not green because dry delta is `+7.29 g` against the fixed `±3 g` tolerance
  - Sample B handwritten recipe (`221x1 + 301x2 + 351x3 + 350x8`, target `300 g`, mandrel `125.65`, length `150`)
    - target: `329.67 g wet`, `280.17 g paper`, `45.00 g adhesive`, `4.50 g parchment`
    - actual recipe: `341.62 / 310.87 g` tube, `3416.17 / 3108.71 g` bamboo
    - result: not green because dry delta is `+10.87 g` against the fixed `±3 g` tolerance
  - Current canonical best-combo search produces green alternatives:
    - Sample A example: `221x2 + 301x1 + 350x1 + 351x1 + 353x8` gives `274.73 / 250.00 g`, delta `+0.002 g`
    - Sample B example: `221x2 + 301x3 + 350x1 + 351x6 + 355x2` gives `329.67 / 300.00 g`, delta `-0.001 g`
- Verification after this pass:
  - `node -r ./node_modules/sucrase/register __tests__/reconciliation-math.test.ts` -> `PASS 2/2`
  - `node -r ./node_modules/sucrase/register __tests__/spec-math.test.ts` -> `PASS 21/21`
  - `node -r ./node_modules/sucrase/register __tests__/spec-sheet-suggestions.test.ts` -> `PASS 3/3`
  - `npm run build` in `apps/web-ui` -> passed
  - regenerated `output/pdf/sample-job-card-JC-96D8A5BA.pdf` from the live print route and verified it as one-page A4 portrait (`594.960 × 841.920`)

### 2026-04-21 · Inventory stock accounting close and carry-forward
- Added first-class inventory accounting controls instead of treating GRN as the only way stock can enter the system.
- `hariom-erp/services/inventory-service/src/models.py`
  - item master now persists unit cost, cost source, reorder level, safety stock, and lead time
  - reel issue close now stores `consumed_weight_kg` and `closed_at` so historical raw-paper consumption is auditable
  - new opening-load, certification, and carry-forward tables freeze opening/closing/carry-forward proof
- `hariom-erp/services/inventory-service/src/services/stock_control.py`
  - computes dated stock statements from bulk stock transactions and reel-tracked paper history
  - statement formula: opening + inward - outward + opening adjustments = closing
  - exposes risk flags for missing policy, reorder breach, and safety breach
- `hariom-erp/services/inventory-service/src/routers/stock_control.py`
  - `GET /inventory/stock-control/statement`
  - `POST/GET /inventory/stock-control/opening-loads`
  - `POST/GET/PATCH /inventory/stock-control/certifications`
  - `POST /inventory/stock-control/certifications/{id}/certify`
  - `POST /inventory/stock-control/certifications/{id}/carry-forward`
  - `GET /inventory/stock-control/carry-forwards`
- `hariom-erp/services/inventory-service/src/services/stock_calc.py`
  - item balances and item ledger are now reel-aware, so raw-paper MRP and valuation no longer miss reel stock
- `apps/bff-api/src/routes/inventory.py`
  - proxies all stock-control endpoints
  - emits notifications for opening load, certification draft, certified close, carry-forward, and item policy update
- `apps/web-ui/app/(dashboard)/inventory/stock-control/page.tsx`
  - new premium cockpit for period statement, physical certification, opening loads, and carry-forward proof
  - global plant scope is read-only; write actions require one concrete plant
- `apps/web-ui/app/(dashboard)/inventory/items/page.tsx`
  - item master now governs cost, reorder, safety stock, and lead time from the UI
- `apps/web-ui/app/(dashboard)/analytics/mrp/page.tsx`
  - MRP now uses persisted item policy only, and surfaces missing policy as a data-governance problem
- `apps/web-ui/app/(dashboard)/production/reconciliation/page.tsx`
  - production reconciliation now links to inventory stock close and explains the difference between production variance and inventory certification
- Verification added:
  - Python syntax checks for the changed inventory service modules
  - TypeScript `npx tsc --noEmit --pretty false`
  - Playwright coverage for `/inventory/stock-control` added to `sales-planner-premium-flow.spec.cjs`

### 2026-04-21 · Inventory system polish, role matrix cleanup, and master-data usability
- RBAC is now aligned to the condensed business matrix only:
  - `Owner`
  - `Admin`
  - `Sales`
  - `Planner`
  - `PlantManager`
  - `Store`
  - `Dispatch`
  - `Operator`
- Legacy release, maker/checker, QA, and acceptance demo users are deactivated and hidden from `/system/users`; startup now seeds clean canonical users for the eight-role matrix.
- The user-create UI now exposes one primary business role plus practical overrides for sales, planner, plant floor, store, dispatch, operator, reports, and system setup.
- The global shell now uses:
  - compact role dropdown instead of wide role pills
  - live route capsule instead of fixed shortcut buttons
  - normalized Owner/Admin plant scope so stale UUID selections resolve back to `Global / All Plants`
- Supplier master is now a real master-data surface:
  - `masterdata-service` `Supplier` model and `/master/suppliers` router
  - BFF proxies under `/api/master/suppliers`
  - web hooks and `/master/suppliers`
  - raw-material inward and reel inward now require supplier dropdown selection instead of free typing
- Inventory location handling is now operational:
  - location master remains under System for Owner/Admin management
  - raw-material inward and reel inward require location selection
  - location occupancy API returns every active location with nested item rows
  - default Plant A / Plant B store locations are seeded on inventory-service startup (`RM`, `WIP`, `FG`)
- Fresh runtime usability is covered by startup seed data:
  - Plant A suppliers: `RM-SEED-A`, `PARCH-SEED-A`
  - Plant B suppliers: `RM-SEED-B`, `PARCH-SEED-B`
  - Plant A locations: `RM-A-01`, `WIP-A-01`, `FG-A-01`
  - Plant B locations: `RM-B-01`, `WIP-B-01`, `FG-B-01`
- Inventory landing was rebuilt as an operating dashboard:
  - stock value, usable kg, blocked/hold kg, low-stock count
  - category split chart
  - usable vs blocked status bars
  - top paper/material load
  - aging posture
  - MRP and shortage actions
  - location-wise stock table
  - inline explanation of opening load, daily inward, period certification, carry-forward, and alerts
- Ledger and balances are now one working location-aware page instead of a dead surface:
  - stock value and balance KPIs
  - item balances
  - location-wise occupancy
  - recent transaction ledger
- Owner/Admin landing dashboards were tightened:
  - real customer names where available instead of UUID labels
  - non-empty fallbacks when analytics has sparse data
  - useful charts/action queues instead of blank panels
- Live verification after this pass:
  - `python3 -m py_compile ...` passed for changed auth, masterdata, and inventory service modules
  - `npx tsc --noEmit --pretty false` passed in `apps/web-ui`
  - `npm run build` passed in `apps/web-ui`
  - `./start_all.sh` restarted the affected services and reported all runtime services ready
  - `npx playwright test e2e/sales-planner-premium-flow.spec.cjs --project=chromium` passed after restarting `web-ui` on the rebuilt bundle
  - BFF smoke as admin on Plant A:
    - roles: `8`, canonical only
    - users: `9`, no release/QA/maker/approver users visible
    - suppliers: `2`
    - locations: `3`
    - location occupancy locations: `3`
    - ledger rows: `200`
    - balances: `1`

### 2026-04-24 · End-client readiness polish for search, filters, naming, and operational contracts
- Added `apps/web-ui/lib/job-card-display.ts` as the canonical UI display helper for job-card refs, compact ids, subtitles, and search text.
- Replaced raw job-card UUID slices across planner board, planner print, production queue, sales-order detail/audit, dispatch selection/create, owner intelligence, and role landing surfaces with stable `JC-XXXXXXXX` style labels.
- Corrected `/inventory/production-issue` from the old placeholder payload to the live inventory-service issue contract:
  - `item_id`
  - `qty`
  - `production_job_id`
  - `reason_code`
  - `allow_raw_paper_exception`
  - `external_ref`
  - `notes`
- Added material search and job-card search/dropdown selection to production issue so stores issue only against real job cards.
- Corrected EOD entry to read `/api/production/jobs` because validate/close still use the legacy production-job lifecycle, and added job search plus state filters.
- Added backend production-job search in `production-service/src/routers/jobs.py`.
- Added planner display-ref search handling in `production-service/src/routers/planning.py`, including `JC-...` and prefix-only `JC` searches.
- Added working search/filter controls to:
  - `/production/reconciliation` actual material rows
  - `/inventory/ledger` balances and transactions
  - `/system/users`
- Re-seeded the local planner demo data to 10 open unscheduled winder cards for end-to-end drag/drop testing.
- Verification:
  - `python3 -m py_compile` passed for changed production routers
  - `npx tsc --noEmit --pretty false` passed
  - `npm run build` passed
  - runtime restarted with production-service and BFF reloaded
  - live BFF smoke returned `200` for job-card search, planner board, inventory items, inventory ledger, monthly material summary, monthly close state, and auth users
  - `npx playwright test e2e/sales-planner-premium-flow.spec.cjs --project=chromium` passed

### 2026-04-24 · Reconciliation close workspace, winder gate, and tracker separation
- The planner schedule API now treats the sales-release target winder as a hard gate. A WINDER-stage schedule without `assigned_winder_machine_id`, or to any other winder, returns a 400 and does not move the segment.
- The planner board drag/drop handler mirrors the same rule client-side, showing the selected winder before the API call and preventing accidental wrong-lane planning.
- Added `/reconciliation/monthly-close/history` in production-service, `/api/production/monthly-close-history` in BFF, and web client/query support.
- Rebuilt `/production/reconciliation` into a clear month-end flow:
  - select reconciliation month
  - review theory, actual, variance, and variance cost
  - save monthly actual consumption/cost rows
  - require close notes when variance exists
  - close/lock the month
  - review month-close history records
  - link inventory stock close for opening/closing/carry-forward certification
- Rebuilt `/planning/tracker` as a sales-order tracker, not a duplicate job-card table. It now tracks customer order demand, release/job-card linkage, stage mix, blocked state, due risk, dispatch readiness, and drill paths to sales orders, planner, and job-card register.
- `/production/job-cards` remains the individual production job-card register.
- Verification:
  - `python3 -m py_compile` passed for changed production and BFF routers.
  - `npm run build` passed and regenerated the production web bundle.
  - `npx tsc --noEmit --pretty false` passed after the build regenerated `.next/types`.
  - Runtime restarted production-service, BFF, and web-ui successfully.
  - Live BFF smoke returned `200` for monthly close history, monthly material summary, monthly close state, sales orders, job cards, and planner board.
  - Live web HTTP checks returned `200` for `/production/reconciliation`, `/planning/tracker`, and `/production/job-cards`.
  - `npx playwright test e2e/sales-planner-premium-flow.spec.cjs --project=chromium` passed.

### 2026-04-30 · Master-data immutability and specification versioning
- Master data now follows a no-hard-delete operating rule for exposed admin/master flows. Disable actions keep historical references valid and hide inactive rows from normal dropdown/list APIs.
- The shared `CrudTable` now labels this clearly: master records are disabled, not deleted. It uses a neutral disable action instead of a destructive trash affordance.
- Supplier, customer, customer-contact, user, machine, plant, paper, adhesive, parchment, tube-size, mandrel, packaging, and tool flows either already soft-disabled or now present/route as Disable.
- Auth plant disable no longer physically deletes plant records, and the endpoint resolves either UUID row ids or plant codes so system UI actions operate on the intended plant.
- Spec-sheet edit is version-safe:
  - editing an active spec creates `version + 1` as a new active record
  - the previous active spec is marked inactive/obsolete
  - old job cards, releases, and recipe history still point to the old spec id
  - active spec lists and dropdowns show only the latest active version
  - dynamic fields are copied from the previous version and then overwritten by the edited payload
  - any new recipe/trial payload is attached to the new version id, not the disabled old version
- The spec UI now says `Create New Version` / `Save as New Version + Recipe` so users do not assume they are overwriting an old approved sheet.

### 2026-05-25 · Production-readiness cleanup for routes, roles, defaults, and verification
- Removed duplicated BFF spec route declarations and added the missing `/api/spec/defaults` GET/PUT proxy.
- Exposed per-plant spec defaults in spec-service through `GET/PUT /specs/defaults`, backed by `global_spec_defaults` and guarded so only Owner/Admin can update.
- Spec sheet create/reset now reads plant-scoped global adhesive, parchment, and moisture defaults instead of hardcoding the editable footer values.
- Spec preview failures are now explicitly marked `degraded` in the hook and surfaced in the spec-sheet header when local math is used as a temporary fallback.
- Inventory health timeout fallback now returns a degraded `503` payload instead of a successful-looking zeroed report.
- Legacy page leaks were converted to redirects for old dashboard, analytics, inventory, dispatch, planning, and master paths instead of silently rendering duplicate full pages.
- Sidebar route policy now uses only the canonical user-facing role matrix; legacy role aliases remain only in workspace normalization for old auth/session rows.
- `apps/web-ui` now has a real `npm run test` and `npm run verify`; `scripts/run_verification.sh` now runs current Python compile, spec pytest, lint, help validation, TS tests, typecheck, and build without Docker/pip-install/old port assumptions.
- The hard-cutover and browser release gates now assert the canonical redirects introduced in this pass: `/planning` and `/production/planner` land on `/planning/board`, `/dispatch` lands on `/logistics/dispatch`, and `/specs` lands on `/specifications`.
- Verification run during this pass:
  - Python compile passed for changed BFF/spec-service modules.
  - `npm run lint` passed.
  - `npm run test` passed (`spec-math`, `spec-sheet-suggestions`, `reconciliation-math`).
  - `npx tsc --noEmit --pretty false` passed.
  - `hariom-erp/venv-runtime/bin/python -m pytest tests/test_spec_math.py` passed (`28 passed`).
  - `hariom-erp/venv-runtime/bin/python3 scripts/e2e_hard_cutover_validation.py` passed (`114/114`) and regenerated `reports/browser_e2e_fixture_latest.json`.
  - `bash scripts/browser_release_gate.sh` passed (`8/8`) against the live production web runtime.
  - `./scripts/run_verification.sh` passed end-to-end after the route/test updates.

### 2026-05-25 · Remaining spec-sheet task closure and parity gate
- Closed the remaining spec-sheet component task list without changing the workbook flow:
  - `components/specs/shared/NumericInput.tsx`
  - `components/specs/shared/PaperPicker.tsx`
  - `components/specs/shared/DeltaPill.tsx`
  - `components/specs/sections/ClientReqCard.tsx`
  - `components/specs/sections/RecipeMixCard.tsx`
  - `components/specs/sections/TubeCalcCard.tsx`
  - `components/specs/sections/NotchingCard.tsx`
  - `components/specs/sections/PackingCard.tsx`
  - `components/specs/sections/ValidationFooter.tsx`
  - `components/specs/SpecSheetWorkspace.tsx`
  - `components/specs/print/SpecSheetPrint.tsx`
- `SpecSheetDocument.tsx` remains the live create/view/edit/print editor, but it now delegates the large surfaces to the section shells so the pages are easier to maintain while preserving the same save, approval, recipe, preview, notch, packing, and validation logic.
- The paper recipe table now uses the searchable `PaperPicker`; key decimal-safe numeric fields use `NumericInput`; suggestion deltas use `DeltaPill`.
- `next.config.js` now redirects old `/master`, `/master/:path*`, `/master/items`, and `/specs/:id/edit` URLs to the canonical `/masters/*`, `/inventory/items`, and `/specifications/*` paths before those old pages can render.
- Added `scripts/verify_spec_math_parity.py` and `apps/web-ui/__tests__/spec-math-parity.ts`.
- Added `scripts/opening_stock_live_smoke.py`, which logs into the live BFF, picks an existing item/location, posts a unique auditable opening-load document, verifies the stock statement endpoint, and writes `reports/opening_stock_live_smoke_latest.md`.
- `scripts/run_verification.sh` now includes the 5-fixture Python/TypeScript parity check at `<= 3 dp` before web lint/test/typecheck/build.
- Focused verification during this pass:
  - `hariom-erp/venv-runtime/bin/python -m py_compile scripts/verify_spec_math_parity.py` passed.
  - `hariom-erp/venv-runtime/bin/python scripts/verify_spec_math_parity.py` passed (`5 fixtures <= 3 dp`).
  - `npm run test` passed (`21/21`, `3/3`, `2/2`).
  - `npx tsc --noEmit --pretty false` passed.
  - `npm run lint` passed.
  - `hariom-erp/venv-runtime/bin/python scripts/opening_stock_live_smoke.py` passed and posted an `OPEN-SMOKE-*` opening-load document.

### 2026-05-25 · Railway go-live hardening and final release gate
- Removed Docker image defaults that hardcoded staging-style bootstrap users/password reset behavior.
- `deploy/tinypod/start_single_container.sh` now:
  - reads external PostgreSQL settings from `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, and `PGDATABASE` when Railway Postgres is attached,
  - creates the seven service databases on the external Postgres server when they do not already exist,
  - allows embedded Postgres on Railway when Railway exposes `RAILWAY_VOLUME_MOUNT_PATH=/var/lib/postgresql` or `START_EMBEDDED_POSTGRES=true` is explicitly set,
  - refuses embedded Postgres on Railway when neither an external Postgres config nor a persistent volume marker is present.
- `deploy/tinypod/start_erp.py` now refuses Railway startup unless `JWT_SECRET`, `BOOTSTRAP_ADMIN_PASSWORD`, and `BOOTSTRAP_OWNER_PASSWORD` are set to non-demo values, and staging password reset flags are disabled.
- Railway deploy readiness:
  - `railway.toml` remains Dockerfile-based with `/login` as the health check.
  - The current shell does not have the Railway CLI or `RAILWAY_TOKEN`, so the actual deploy was not executed from this machine session.
  - The remaining deploy action is owner-side authentication/project linking plus attaching persistent Railway PostgreSQL and setting production secrets.
- Final verification evidence:
  - `./scripts/run_verification.sh` passed end-to-end after the spec-sheet and parity changes.
  - `bash scripts/start_verified_runtime.sh` rebuilt and restarted the production runtime; `reports/runtime_consistency_20260525_023515.md` shows `failed: 0`.
  - `hariom-erp/venv-runtime/bin/python3 scripts/e2e_hard_cutover_validation.py` passed `114/114`; report `reports/hard_cutover_validation_20260525_023714.md`.
  - `bash scripts/browser_release_gate.sh` passed `8/8` against `http://127.0.0.1:13000`.
  - `hariom-erp/venv-runtime/bin/python scripts/opening_stock_live_smoke.py` passed and wrote `reports/opening_stock_live_smoke_20260524_210756.md`.
  - Redirect checks returned `308` for `/master`, `/master/items`, and `/specs/example/edit` to their canonical routes.
