# Master Data Immutability And Spec Versioning Report

Date: 2026-04-30

## Business Rule Implemented

- Master data is not physically deleted from product/admin flows.
- User-facing removal is now Disable, which hides inactive records from future dropdowns and active master lists.
- Historical records keep their original references so old sales orders, job cards, specs, inventory ledgers, and audit views do not break.
- Specification edit is versioned. Editing an active sheet creates the next active version and marks the previous version inactive/obsolete.

## Backend Changes

- `masterdata-service` master delete routes were verified as soft-disable routes for paper, adhesive, parchment color, tube size, mandrel, machine, customer, customer contact, supplier, packaging, and tools.
- `spec-service/src/routers/specs.py` now treats `PUT /specs/{id}` as a version replacement:
  - creates `version + 1`
  - keeps the new version active
  - marks the previous version inactive and obsolete
  - copies old dynamic fields and applies the edited payload on top
  - rejects edits to inactive versions
- `auth-service/src/routers/users.py` now disables users instead of deleting rows.
- `auth-service/src/main.py` now disables plants instead of deleting rows, and resolves both UUID ids and plant codes for update/disable actions.
- `spec-service/src/routers/spec_fields.py` was verified as deactivate-only for dynamic fields.

## Frontend Changes

- Shared master CRUD tables now show Disable language and a disable icon instead of destructive delete copy.
- Master table help text explains why records are disabled and hidden from dropdowns instead of deleted.
- Supplier, customer, and customer-contact pages now use Disable copy and non-destructive styling.
- Specification view now exposes `Create New Version` for active specs.
- Specification edit page now reads as a new-version flow:
  - header: `New Version from Spec vX`
  - action: `Save as New Version + Recipe`
  - save toast confirms the new active version id/version
- The recipe creation after spec edit now attaches to the returned replacement spec id, not the old disabled spec id.

## Verification

- Python compile passed:
  - `spec-service/src/routers/specs.py`
  - `auth-service/src/main.py`
  - `auth-service/src/routers/users.py`
- Web production build passed with `npm run build`.
- TypeScript compile passed with `npx tsc --noEmit --pretty false`.
- Runtime was reloaded for auth-service, spec-service, BFF, and web-ui.
- Live BFF smoke passed:
  - `/api/auth/plants` -> 200
  - `/api/auth/users` -> 200
  - `/api/spec/specifications` -> 200
  - `/api/spec/spec-fields` -> 200
  - `/api/master/papers` -> 200
  - `/api/master/suppliers` -> 200
  - `/api/production/machines` -> 200
- Live web page checks returned 200:
  - `/system/plants`
  - `/system/users`
  - `/specifications`
  - `/master/papers`
- Focused Chromium regression passed:
  - `npx playwright test e2e/sales-planner-premium-flow.spec.cjs --project=chromium`

## Operational Notes

- Existing disabled master rows remain queryable only where direct historical lookup is needed; active lists and dropdowns stay filtered to active records.
- No production master record was intentionally disabled during verification. The pass verified code paths, runtime health, build gates, and live read surfaces without mutating live master data.
