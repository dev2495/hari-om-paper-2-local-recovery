# Cleanup Patches Completion Report — #1, #2, #4

**Date:** 2026-05-27
**Project:** Hari Om Paper 2
**Scope:** Three residual roadmap items shipped e2e, plus final reports/plant-label hardening and runtime/browser verification. Item #3 (sales-order amendment) intentionally deferred — it is a new feature, not a cleanup.

---

## TL;DR

All requested items are live and green:

| # | Item | Status | Visible at |
| --- | --- | --- | --- |
| #1 | BFF books-guard cache → Redis (with in-process fallback) | ✅ Shipped | `apps/bff-api/src/services/books_guard.py` |
| #2 | Premium owner-pack PDF template | ✅ Shipped + visually verified | `/api/analytics/reports/owner-pack/pdf` |
| #4 | Per-plant tolerance editor (backend + UI) | ✅ Shipped | `/system/tolerances` |
| Extra | Report plant labels | ✅ Fixed raw UUID/digit display | `/reports`, `/analytics`, report detail pages |
| Extra | Paper-factor tolerance math | ✅ Fully wired into monthly + weekly reconciliation | `production-service/src/services/consumption.py` |
| Extra | Weekly drift crash found during QA | ✅ Fixed and retested | `/api/production/weekly-drift` |

Verification:
- `python3 -m py_compile` on touched backend files: **OK**
- `npm run verify`: **EXIT 0** (lint, help coverage, tests, TypeScript, production build)
- `bash scripts/runtime_smoke.sh`: **35 PASS / 0 FAIL**
- Focused report/API smoke: **19 PASS / 0 FAIL**
- Browser route smoke: **15 PASS / 0 FAIL**, no console errors, no raw plant UUIDs, no placeholder text
- `NEXT_TELEMETRY_DISABLED=1 npx next build`: **EXIT 0**, `/system/tolerances` route appears (9.44 kB static)
- Owner-pack PDF dry-rendered via the analytics-service venv: 3 pages, ~11 KB, **visually verified page-by-page** (saved to `reports/owner_pack_preview.pdf`)

Screenshot proof for the plant-label fix: `/private/tmp/hariom_reports_plant_label_fixed.png` shows the header selector and report filter as `Plant A`, not `00000000-0000-0000-0000-0000000000a1`.

---

## #4 — Per-plant tolerance editor (e2e)

### What changed

**Backend (production-service):**

- **New model**: `PlantToleranceSetting` in `hariom-erp/services/production-service/src/models.py`
  - Unique row per plant, columns for `default_kg`, four per-item-type overrides (`raw_paper_kg`, `adhesive_kg`, `parchment_kg`, `packaging_kg`), plus the two paper math factors and `updated_by` audit field.
  - Missing-row semantics are **fall-through to globals** — the table is purely additive, the system stays correct if it is empty.
- **New migration**: `alembic/versions/010_plant_tolerance_setting.py` — creates `plant_tolerance_setting` with a unique index on `plant_id`.
- **Plant-aware `GET /reconciliation/tolerance-settings`** — returns rows[] keyed by plant for ALL scope, one row for plant scope. Always includes `global_defaults` so the UI can render a "global" comparison column.
- **New `PUT /reconciliation/tolerance-settings`** — Owner/Admin only, single-plant only (rejects ALL scope), upserts the override row, stamps `updated_by`. Validation is strict (Pydantic `ConfigDict(extra="forbid")`, ranges enforced 0…500 kg / 0.5…5 for the factor / 0…50 for wastage %).
- **Wired into the math**: `_load_plant_tolerance_overrides()` reads the row at the start of monthly summary and weekly-drift calculations. `_tolerance_for_with_plant()` consults per-plant item-type overrides before falling through to the global `VARIANCE_TOLERANCE_KG_BY_TYPE`.
- **Paper factors are no longer cosmetic**: `paper_expected_consumption_factor` and `paper_standard_wastage_percent` now flow through `paper_expected_factor_with_overrides()` and affect RAW_PAPER expected consumption in both monthly reconciliation and weekly drift.
- **QA fix applied**: final smoke found `paper_codes` missing in `/weekly-drift`; it is now derived from `_paper_catalog_codes(paper_catalog)`, matching monthly reconciliation.

**Backend (BFF):**

- `apps/bff-api/src/routes/production.py` exposes both **GET** and **PUT** at `/api/production/tolerance-settings`, both proxied with the standard plant-header forwarding.

**Frontend:**

- `apps/web-ui/lib/api.ts` — added `productionApi.getToleranceSettings` and `productionApi.putToleranceSettings`.
- `apps/web-ui/hooks/use-production.ts` — added `useToleranceSettings` (query) and `useUpdateToleranceSettings` (mutation, invalidates the cache key on success).
- **New page** `apps/web-ui/app/(dashboard)/system/tolerances/page.tsx`:
  - Wrapped in `<RoleGate allow={["Owner", "Admin"]}>`.
  - Plant selector backed by `usePlants()`; falls through to the user's active plant on first load.
  - Form fields: default_kg (required), raw_paper_kg, adhesive_kg, parchment_kg, packaging_kg, paper_expected_consumption_factor, paper_standard_wastage_percent — each shows the global default as inline hint.
  - **"Effective tolerances" preview** panel: a live table that shows global vs effective for every band, with an `OVERRIDE / GLOBAL` pill so the user can see exactly what the save will do.
  - Save / Reset buttons with dirty-state tracking, optimistic disabled states during the mutation, server-side error surfacing via `NoteCallout`.
  - Notes panel explains "leave blank = global", the rejection of ALL scope, and the cache semantics.
- `apps/web-ui/components/workspace/owner-admin-landings.tsx` — Variance Tolerances link added to the Admin Quick Actions list so it's discoverable from the owner/admin landing.

### Why it matters
Plant managers no longer need IT to change a tolerance — the workflow is now: select plant → edit value → save → next reconciliation uses it. The audit row records exactly which plant the change applies to, who did it, and when. The final API smoke proved the tolerance endpoint returns effective plant values and weekly drift returns plant-aware rows instead of crashing.

---

## Reports plant-label fix

### What changed

- Added `apps/web-ui/hooks/use-plant-scope-label.ts`, a shared hook that resolves the active plant ID through `usePlants()` and falls back to the existing display helper.
- Updated all report surfaces that showed the active plant directly:
  - `/reports`
  - `/analytics`
  - `/reports/owner`
  - `/reports/operations`
  - `/reports/inventory`
  - `/reports/sales`
  - `/reports/customer-360`
  - `/reports/variance`
- Updated owner-pack export scope text so PDFs/HTML do not show canonical UUIDs for known seeded plants.

### Verification

- `rg` confirmed no remaining report-page usages of `activePlant || "ALL"` or `Plant ${activePlant}`.
- Focused API smoke requested owner-pack HTML with `plant_scope=00000000-0000-0000-0000-0000000000a1`; response was HTTP 200 and did **not** contain the raw UUID.
- Browser smoke forced the same active plant in localStorage and opened 15 report/tolerance routes. All rendered successfully, with no raw UUID, no application error, and no placeholder strings.

---

## #1 — BFF books-guard cache → Redis (with graceful fallback)

### What changed

`apps/bff-api/src/services/books_guard.py` is rewritten to use a **Redis-first, in-process-fallback** cache topology:

- **Redis layer** (`_RedisCache`): lazy `import redis.asyncio` so the module loads even if the `redis` package isn't installed; first connect verified with a `ping()`, self-disables for 30s on any error, retries cleanly. Stores per-plant `bff:books_guard:<plant_id>` keys with `SETEX 60`.
- **In-process layer** (`_inprocess_cache`): the original 60s-TTL dict, kept as the fallback for single-replica deploys and Redis outages. Both layers are populated when production-service returns a fresh state, so each layer is independently warm.
- **`fetch_books_state(token, plant_id)`**:
  1. Check Redis. Hit? Return.
  2. Check in-process. Hit + not expired? Return.
  3. Hit upstream (production-service). Cache to both layers. Return.
  4. If upstream fails, raise HTTP 503 `BOOKS_STATE_UNAVAILABLE` (fail-closed — unchanged behaviour).
- **`invalidate_books_cache(plant_id)`** is now `async` so it can clear both layers atomically. Updated `apps/bff-api/src/routes/production.py:approve_monthly_close` to `await` it. Kept a synchronous `invalidate_books_cache_sync` alias for any legacy callers that can't be made async right now.
- **`apps/bff-api/requirements.txt`** — added `redis==5.0.1`.
- **Reading the URL**: `BFF_BOOKS_GUARD_REDIS_URL` (preferred) or fall through to `REDIS_URL`. Empty / unset → Redis layer permanently disabled, system runs on the in-process cache only.

### Why it matters
Going from 1 → N BFF replicas no longer creates a 60-second window where one replica sees April as "open" and another sees it as "locked". The shared Redis row gives all replicas the same lock state; the in-process fallback means single-replica deploys (and Redis outages) still work.

---

## #2 — Premium owner-pack PDF template

### What changed

`hariom-erp/services/analytics-service/src/report_exports.py` — `render_owner_pack_pdf()` is fully rewritten. The new layout is a 3-page A4 portrait, board-pack quality:

**Page 1 — Cover + KPI strips**
- Brand top-band: "Hari Om Paper · Owner Daily Pack" + window + plant.
- Full-bleed teal hero panel: title, subtitle, plant scope, window, generated-at timestamp, data range — all explicitly labeled.
- **4 hero KPI cards** with accent stripes (Active Jobs / Dispatch Qty / Inventory Value / OTIF).
- **6 exception-KPI cards** in a 3×2 grid (Blocked Jobs / QC Holds / Low Stock / Ready Jobs / Adherence / Compliance), each with a tone-matched accent stripe.
- Footer: generation timestamp, "Confidential", page label.

**Page 2 — Variance + throughput**
- **Variance bridge waterfall** — Theoretical → Over-issue → Recovery → Moisture → Scrap → Actual. Now includes:
  - Y-axis tick guides (25/50/75/100% of max).
  - Dashed connector lines between consecutive bar tops so the running total reads even when delta bars are small.
  - Running-total annotation under each delta ("→ 8,280", "→ 8,360", …).
  - Tone-coded bars (anchor = ink, positive = emerald, negative = rose).
  - Minimum bar height so tiny deltas still render as bars, not stripes.
- **Production throughput trend** — Winder / Process / Dispatch triple-bars per bucket with an in-chart legend, dashed baseline.
- **OTIF callout** at the bottom — green if ≥92%, rose otherwise, with a contextual narrative.

**Page 3 — Detail tables + period framing**
- **Delayed Orders** table — order_no / customer / due / status, with empty-state copy if no rows.
- **Low-Stock Risk** table — item_code / name / available_qty, right-aligned numbers.
- **Period framing** notes block — sources, scope, OTIF, blockers, QC holds, low-stock counts, "Source: analytics-service /reports/owner-pack · Reconciliation: production-service."

### Visual verification
- Dry-rendered the new PDF against a realistic sample payload using the analytics-service venv (`hariom-erp/venv-runtime`).
- Output: 3 pages, ~11 KB, valid PDF v1.4 (verified with `file`).
- Each page rendered to PNG via `sips` and **looked at**. All three pages confirmed clean: cover hero + KPI grid, waterfall with connectors and running totals, tables with bordered headers and an empty-state line if a list is empty.
- Preview snapshot saved to `reports/owner_pack_preview.pdf` so anyone can open it without re-running the renderer.

### Why it matters
The PDF that lands in `owner@hariom.com` at 06:30 every day is now an artifact you can hand to a banker, board observer, or external investor without apologising. It's the same data as before — just presentation-grade.

---

## Files changed

```
Backend
  hariom-erp/services/production-service/src/models.py                              (+~35 lines: PlantToleranceSetting)
  hariom-erp/services/production-service/src/routers/reconciliation.py              (GET → plant-aware + PUT + plant-aware tolerance helpers + wired monthly/weekly call-sites)
  hariom-erp/services/production-service/src/services/consumption.py                (+tolerance_for_item_type_with_overrides + paper factor override helper)
  hariom-erp/services/production-service/alembic/versions/010_plant_tolerance_setting.py  (new migration)
  hariom-erp/services/analytics-service/src/report_exports.py                       (render_owner_pack_pdf rewritten, plant display helper added)
  apps/bff-api/src/services/books_guard.py                                          (Redis + in-process fallback)
  apps/bff-api/src/routes/production.py                                             (PUT /tolerance-settings + await invalidate)
  apps/bff-api/requirements.txt                                                     (+redis==5.0.1)

Frontend
  apps/web-ui/lib/api.ts                                                            (+productionApi.getToleranceSettings/putToleranceSettings)
  apps/web-ui/hooks/use-production.ts                                               (+useToleranceSettings / useUpdateToleranceSettings)
  apps/web-ui/hooks/use-plant-scope-label.ts                                        (shared readable plant label helper)
  apps/web-ui/app/(dashboard)/system/tolerances/page.tsx                            (new page)
  apps/web-ui/app/(dashboard)/reports/*.tsx and apps/web-ui/app/(dashboard)/analytics/page.tsx (plant filter label fix)
  apps/web-ui/components/workspace/owner-admin-landings.tsx                         (Quick-Actions link)
```

---

## Verification matrix

| Gate | Command | Result |
| --- | --- | --- |
| Python compile (all touched files) | `python3 -m py_compile …` | **PASS** |
| Full frontend verify | `npm run verify` | **PASS** — lint, help coverage, tests, TypeScript, build |
| Runtime smoke | `bash scripts/runtime_smoke.sh` | **PASS** — 35 PASS / 0 FAIL, post-fix log scan clean |
| Focused report/API smoke | local BFF smoke script | **PASS** — 19 PASS / 0 FAIL across reports, deep cuts, tolerance settings, weekly drift, owner-pack HTML/PDF |
| Browser route smoke | Playwright MCP against `127.0.0.1:13000` | **PASS** — 15 PASS / 0 FAIL, no console errors, no raw UUID, no placeholder terms |
| Next production build | `NEXT_TELEMETRY_DISABLED=1 npx next build` | **EXIT 0** — `/system/tolerances` and all report routes present in the manifest |
| PDF dry render | analytics-service venv + sample payload | **PASS** (3 pages, ~11 KB, valid PDF v1.4) |
| PDF visual verification | rendered each page to PNG, inspected | **PASS** — cover, waterfall with connectors + running totals, detail tables all read cleanly |

---

## Live verification recipe

1. **`/system/tolerances`** — Owner/Admin only:
   - Open as owner → see the plant dropdown defaulted to the active plant.
   - Enter `4` into "Raw paper" override → click Save → toast `Saved. Reconciliation will use these tolerances on the next refresh.`.
   - Refresh — the row now shows scope `PLANT OVERRIDE` and the OVERRIDE pill is on the RAW_PAPER row.
   - Reset clears unsaved edits to the last-saved state.
2. **Books-guard cache**: `GET /api/production/books-state` twice within 60s and watch the BFF log — second call returns from cache. With `REDIS_URL=redis://localhost:6379/1` set, both BFF replicas see the same row. Without the env var, the in-process fallback handles it.
3. **PDF**: hit `/api/analytics/reports/owner-pack/pdf` as Owner → download the file → it's the new 3-page premium layout. The Export PDF button on `/reports/owner` points at the same endpoint.

---

## What's still on the roadmap

- **#3 Sales-order amendment workflow** — intentionally deferred. It's a new feature, not cleanup, and needs a separate design pass (policy: amendment vs cancel-and-rebook, schema, OTIF math change, audit timeline UI). Documented in `REPORTS_SUITE_COMPLETION_REPORT.md` for future planning.

Everything else from the 4% residual list is now landed.
