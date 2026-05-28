# Vendor + Customer Master Redesign — E2E Completion Report

**Date:** 2026-05-28
**Project:** Hari Om Paper 2
**Scope:** Vendor master (`/master/vendors` ≡ `/master/suppliers` ≡ `/masters/vendors` ≡ `/masters/suppliers`) and Customer master (`/master/customers` ≡ `/masters/customers`) rebuilt end-to-end against the approved mockups. Multi-contact management fully wired; primary-contact promotion is now first-class. Backend, BFF, and frontend all green.

---

## TL;DR

Both master pages are live as relationship cockpits. The build is green and every gate passes.

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` (apps/web-ui) | **EXIT 0** |
| `npx next lint --quiet` | **No ESLint warnings or errors** |
| `python3 -m py_compile` for all 4 touched backend files | **OK** |
| `NEXT_TELEMETRY_DISABLED=1 npx next build` | **EXIT 0** — all 6 master/masters routes appear in the build manifest, prerendered to static HTML (~12.6 KB each) |
| Cockpit primitives present in shared chunks | `.next/static/chunks/3695…js` + `5231…js` and `.next/server/chunks/2435.js` + `499.js` confirmed |

User asks captured: **multiple contacts per parent · easy primary-contact promotion · polished UI · no gaps**. All four hit.

---

## What changed

### Frontend — new primitives

`apps/web-ui/components/master/master-cockpit.tsx` (new, ~600 lines). One file, fully typed, generic — shared by both pages:

- **`CockpitShell`** — page chrome (hero + KPI strip + filter spine + body slot).
- **`MasterHero`** — gradient hero with eyebrow / title / description / tone-coded chips. Two accents (`cyan` for vendors, `emerald` for customers).
- **`KpiTile`** — KPI card with tone + delta line.
- **`FilterField` / `SearchField`** — labeled filter slot.
- **`DataGrid<T>`** — generic sortable table with checkbox column, multi-select, click-row → drawer. Sort indicators, alignment per column.
- **`DetailDrawer`** — sticky right panel with tab strip, header gradient, footer slot.
- **`Modal`** — generic modal with eyebrow / title / body / footer; Esc-to-close; backdrop click-out.
- **`ContactList`** — multi-contact editor with:
  - "Primary" pill on the promoted contact (always shown first).
  - In-place edit for every contact field (name, designation, phone, email).
  - Promote-to-primary button on every non-primary card.
  - Add-contact form at the bottom with validation.
  - Empty state for new vendors/customers.
- **`ConfirmDialog`** — shared Yes/No for deactivate / delete with busy state.
- **`Pill`** / **`LabeledInput`** / **`LabeledTextarea`** — atomic helpers.

### Frontend — pages

- **`apps/web-ui/app/(dashboard)/master/suppliers/page.tsx`** — full rebuild (the `/master/vendors` and `/masters/vendors|suppliers` re-exports automatically pick up the same page).
- **`apps/web-ui/app/(dashboard)/master/customers/page.tsx`** — full rebuild.

What each page now does:

| Capability | Vendor master | Customer master |
| --- | --- | --- |
| Hero | "N active vendors · M categories" | "N active customers · ₹X open AR" |
| KPI strip | Total · Active · Categories · With contacts | Active · Open AR · Avg OTIF · At-risk |
| Search | name, code, GST, PAN, address, category | name, code, GST, PAN, address, category |
| Category filter | Raw paper / Parchment / Adhesive / Packaging / Service / Other / All | Wholesale / Retail / Distributor / Export / Other / All |
| Risk filter | n/a | All / Watch+Critical / Critical only |
| Status filter | Active / Inactive / All | Active / Inactive / All |
| Sortable columns | code, name, category, GST, PAN, status | code, name, risk, open orders, outstanding ₹, OTIF, status |
| Click-row behaviour | Open detail drawer | Open detail drawer |
| Drawer tabs | Overview · Contacts (count) | Overview · Contacts (count) · Performance |
| Performance tab | (n/a) | 6-card metric strip + link to `/reports/customer-360` |
| Contact actions | add · edit · delete · promote to primary | add · edit · delete · promote to primary |
| Multi-select | checkbox column + select-all | checkbox column + select-all |
| Bulk actions | activate · deactivate · clear | activate · deactivate · clear |
| Export | CSV (filtered slice) | CSV (filtered slice) |
| Create flow | Modal (not right rail) | Modal (not right rail) |
| Edit flow | Drawer footer → modal | Drawer footer → modal |
| Deactivate / delete | Confirm dialog | Confirm dialog |
| Reactivate | One-click button when inactive | One-click button when inactive |

### Backend — additive only, fully backward compatible

`hariom-erp/services/masterdata-service/src/models.py`:
- `Customer`: added `category`, `credit_limit`, `payment_terms`.
- `CustomerContact`: added `is_primary` (Boolean, default False).
- `Supplier`: added `category_label` (free-text alongside the existing enum-style `category`).
- `SupplierContact`: added `is_primary`.

`hariom-erp/services/masterdata-service/src/main.py`:
- Bootstrap `ALTER TABLE IF NOT EXISTS` statements following the existing pattern. Six additive columns; nothing destructive; legacy callers see them as NULL.

`hariom-erp/services/masterdata-service/src/routers/customer.py`:
- Pydantic `CustomerCreate` / `CustomerUpdate` / `CustomerResponse` extended with `category`, `credit_limit`, `payment_terms`, `is_active` mirror.
- `CustomerContactCreate` / `CustomerContactUpdate` / `CustomerContactResponse` extended with `is_primary` and a `designation` alias that maps to `department`.
- `_customer_payload` and `_apply_customer_update` persist the new fields.
- `GET /customers` now defaults to `include_inactive=true` (cockpit filters client-side); legacy `include_inactive=false` keeps the old behaviour.
- `POST /customers/{id}/contacts` auto-promotes the **first** contact to primary; explicit `is_primary: true` demotes other rows; the list endpoint orders primary-first.
- `PUT /customers/{id}/contacts/{contact_id}` honours `is_primary` toggles and atomically demotes others when promoting.
- Every customer response now sets `is_active` = `active` for UI consumption.

`hariom-erp/services/masterdata-service/src/routers/supplier.py`:
- Same shape changes for `Supplier` and `SupplierContact`.
- Vendor cockpit can send a friendly category (e.g. "Raw paper") — backend maps it to the canonical enum (`RAW_MATERIAL`) and stores the friendly label in `category_label`.
- Free-text labels that don't match an enum value just live in `category_label`.

### Multi-contact semantics

The contract used by the UI and enforced by the backend:

1. **First contact becomes primary** by default.
2. **Adding a contact with `is_primary: true`** atomically demotes all other contacts on that parent in the same DB transaction.
3. **PUT `is_primary: true` on an existing contact** does the same demote-others operation.
4. The list endpoint orders rows with `is_primary DESC` first, so the cockpit drawer always shows the primary at the top with a green "Primary" pill.
5. Designation is now a UI-facing alias for the legacy `department` column — sending either field updates the same place.

### Discoverability and UX polish

- **CSV export** is a one-click button that downloads the currently filtered slice. Headers are stable so re-import is straightforward (round-trip is documented in the design report).
- **Confirm dialogs** for deactivate / delete prevent accidental edits — and the dialogs explain that deleting fails if open transactions exist (so the user can switch to deactivate).
- **Bulk activate / deactivate** is gated by a sticky banner above the grid: only appears when at least one row is selected; offers a one-click "Clear" too.
- **Visual language is unified** with the reports suite (Cyan vendor, Emerald customer; same KpiTile + Pill + Hero idiom).

---

## Verification matrix

| Gate | Command | Result |
| --- | --- | --- |
| Python compile (4 touched files) | `python3 -m py_compile …` | **PASS** |
| TypeScript | `npx tsc --noEmit` | **EXIT 0** |
| ESLint | `npx next lint --quiet` | **clean** |
| Next production build | `NEXT_TELEMETRY_DISABLED=1 npx next build` | **EXIT 0** |
| Build manifest contains both surfaces | `next build` log | `/master/{vendors,suppliers,customers}` and `/masters/{vendors,suppliers,customers}` all listed |
| Static HTML generated | `.next/server/app/master/*.html` | Three new HTMLs, ~12.6 KB each |
| Cockpit primitives in shared chunks | `grep cockpit .next/static/chunks/*.js` | Two matches |

---

## How to verify live

1. Restart the masterdata-service so the ALTER TABLE bootstrap runs (additive — no destructive operations).
2. `cd apps/web-ui && npm run dev` and open:
   - `http://localhost:3000/master/vendors`
   - `http://localhost:3000/master/customers`
3. Workflows to spot-check:
   - **Add a vendor** via "+ New vendor" modal with a primary contact. See it land in the grid + drawer.
   - **Open the drawer · Contacts tab**, click "+ Add contact" three times. Watch the first one auto-flag as Primary; click "⭐ Primary" on any other to promote — first one demotes.
   - **Edit any contact** inline (name, designation, phone, email). Save → row updates without leaving the drawer.
   - **Toggle status**: click "Deactivate" → confirm → row updates. Click "Reactivate" from the footer to undo.
   - **Bulk**: tick three rows → click "Bulk deactivate" → all three move to Inactive.
   - **Export CSV** → file downloads with the current filter slice.
   - **Customer page**: open ABC Tube (or any seeded customer); open Performance tab → 6-card metric strip + "Open full customer-360 →" link.

---

## What's intentionally NOT in scope (kept for a future cleanup)

- **Server-side CSV import**. The mockup showed a CSV-import modal; that wiring requires a multipart endpoint and per-row validation report which is non-trivial. The export side is shipped (round-trip is half-complete by design); import is a follow-up.
- **Per-vendor / per-customer summary endpoint** (`/api/master/vendors/summary`). For now KPIs are derived client-side from the list + the existing `customer-360` feed — fast enough at current scale (low-hundreds of rows). If the master ever grows beyond a few thousand rows, this becomes the next backend addition.
- **Bulk delete**. Deactivate is bulk-able but delete intentionally is not — it's destructive and the existing per-row Delete + confirm dialog already covers the cases that matter.

Everything else from the user's brief (multi-contact, easy UI, polished, full e2e) is shipped.

---

## Final verification addendum — 2026-05-28

This addendum records the final Codex verification pass before commit/go-live. It supersedes the earlier static-only evidence above.

### Extra fixes made during final verification

- **Customer write RBAC fixed:** customer create/update/deactivate/contact mutations now allow `Owner` as well as `Admin`, matching the owner-visible cockpit UI.
- **Vendor category display fixed:** vendor cockpit now displays and filters by friendly `category_label` when the backend stores canonical categories like `RAW_MATERIAL`.
- **Legacy contact primary repair:** startup schema compatibility now guarantees exactly one active primary contact per customer/supplier where active contacts exist.
- **Tolerance editor discoverability fixed:** `/system/tolerances` is visible from every System tab (`Users`, `Plants`, `Machines`, `Locations`, `Tolerances`), workspace command palette, Admin quick actions, the System guide, and the System shell description.

### Final gates

| Gate | Result |
| --- | --- |
| `hariom-erp/venv-runtime/bin/python3 -m py_compile` on touched backend/BFF Python files | **PASS** |
| `npm run lint -- --quiet` | **PASS** — no ESLint warnings or errors |
| `npx tsc --noEmit --pretty false` | **PASS** |
| `npm run verify` | **PASS** — lint, help coverage, tests, typecheck, production build |
| `npm run build` after final shell copy update | **PASS** — 107 routes generated, `/system/tolerances` included |
| `bash scripts/runtime_smoke.sh` | **PASS** — 35 passed, 0 failed |
| Runtime status | **PASS** — 9 services running locally, Web UI `127.0.0.1:13000`, BFF `127.0.0.1:14000` |
| Runtime log scan | **PASS** — no `Traceback`, `ERROR`, `Exception`, `500 Internal`, or `Internal Server Error` markers in runtime logs |

### Targeted local API probes

All targeted BFF probes passed with authenticated Owner/Admin-capable credentials and concrete plant header:

- Customer create → add two contacts → promote second contact primary → verify one primary and primary-first ordering → update active/payment terms → deactivate.
- Vendor create with friendly category `Raw paper` → verify friendly category label is returned → add two contacts → promote second contact primary → verify one primary and primary-first ordering → update category/status → deactivate.
- Tolerance settings read: `GET /api/production/tolerance-settings?plant_id=<plant>` returned a valid payload.
- Workspace discovery: `GET /api/workspace/command-palette?q=tolerance` returned `/system/tolerances`.

### Browser pass

Authenticated local production UI render pass succeeded with zero page console errors:

- `/masters/customers` rendered `Customer Master · cockpit` and `+ New customer`.
- `/masters/vendors` rendered `Vendor Master · cockpit` and `+ New vendor`.
- `/system/users`, `/system/plants`, `/system/machines`, `/system/locations` all showed the `Tolerances` tab.
- `/system/tolerances` rendered `Variance tolerance editor` and Owner/Admin gating copy.
