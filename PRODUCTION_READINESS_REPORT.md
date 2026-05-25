# Production Readiness Report - Hari Om Paper ERP

Generated: 2026-05-25

## Verdict

Hari Om Paper ERP is code-ready for go-live after the final Railway deployment step.

The live-user access issue was checked first: the public Railway login page returned HTTP 200 and an authenticated Railway smoke using the stored production login variables returned:

- `login_status=200`
- `me_status=200`
- `roles_status=200`

That means the current live stack is reachable and login works with the production credentials stored in Railway. If a user still cannot access it, the most likely cause is incorrect credentials, stale browser state, or using an old URL.

## Fixes Completed In This Pass

1. Items master is no longer create-only.
   - Added soft-delete through BFF and inventory-service.
   - Delete is blocked with HTTP 409 when stock-on-hand exists unless `force=true`.
   - `/master/items` and `/inventory/items` both expose usable item management.

2. Plant scope is enforced at the BFF.
   - Added `plant_guard.py`.
   - JWT now includes `allowed_plants` and `is_owner_all_plants`.
   - Requests with an unauthorized `X-Plant-ID` return HTTP 403 `PLANT_SCOPE_DENIED`.
   - Fixed a discovered bypass bug where `/` in the bypass prefix list would have skipped every route.

3. Backdated dated inventory writes are guarded.
   - Added `books_guard.py`.
   - Wired it to inward, issue, FG inward, manual FG inward, and opening loads.
   - Missing concrete plant returns HTTP 422 `PLANT_REQUIRED_FOR_DATED_WRITE`.
   - Locked periods return HTTP 422 `BOOKS_LOCKED`.
   - Books-state service failures now fail closed with HTTP 503 instead of silently allowing risky writes.

4. QC hold now blocks stage advancement.
   - `capture_stage_output()` returns HTTP 409 `JOB_HAS_ACTIVE_QC_HOLD`.
   - Only Owner, Admin, or PlantManager can override with an explicit `override_reason`.

5. Job-card state is clearer for users.
   - Added `lifecycle_label` to job-card responses:
     `DRAFT`, `RELEASED`, `SCHEDULED`, `IN_PROGRESS`, `COMPLETED`, `CLOSED`, `CANCELLED`.

6. Audit events are real.
   - Added `audit_events` table/model.
   - Added authenticated POST/GET endpoint with filters and pagination.
   - Added BFF proxy at `/api/auth/audit-events`.
   - Added frontend `useAuditEvents()` hook.

7. Notifications support operating filters.
   - Added `limit`, `offset`, `role`, `event_type`, `search`, `unread_only`, `total_count`, and `has_more`.

8. Report and lifecycle pages now have page-level role gates.
   - Added reusable `RoleGate`.
   - Wrapped `/reports` and `/inventory/lifecycle`.

9. Spec-to-recipe cascade risk is visible.
   - `/specifications` now shows an amber banner when an approved spec has no approved recipe.

10. Misleading MES stub folders were removed.
    - Removed README-only `mes-winding`, `mes-slitting`, `mes-oven`, and `mes-finish` stubs.
    - Stage capture remains in production-service, which is the actual live path.

## Verification Evidence

Commands run on the final local code and runtime:

- `git diff --check`: pass
- `py_compile` on all changed backend Python files: pass
- Targeted plant/books guard Python checks: pass
- `./scripts/run_verification.sh`: pass
  - spec-service pytest: 28 passed
  - Python/TypeScript spec math parity: pass
  - Next lint: no warnings or errors
  - help coverage: 113 routes mapped
  - web tests: 21/21, 3/3, 2/2 passed
  - TypeScript check: pass
  - Next production build: pass
- `bash scripts/start_verified_runtime.sh`: pass
  - all services healthy
  - runtime consistency failed: 0
- `scripts/e2e_hard_cutover_validation.py`: pass
  - 114 passed, 0 failed
  - report: `reports/hard_cutover_validation_20260525_171125.md`
- `bash scripts/browser_release_gate.sh`: pass
  - 8 browser tests passed
- `bash scripts/runtime_smoke.sh`: pass
  - 35 passed, 0 failed
  - includes auth, acting role, masters, spec, planning, inventory, notifications, reports, HTML/PDF exports, and log scan
- Targeted local API probes: pass
  - audit events GET/POST: 200
  - tolerance settings: 200
  - missing plant dated write: 422
  - unauthorized plant request: 403
- `scripts/opening_stock_live_smoke.py`: pass
  - opening load id: `d191e22b-0234-4f4a-b07a-9c7232fb67bc`
  - report: `reports/opening_stock_live_smoke_20260525_114548.md`

## Day-One Operating Readiness

Ready for tomorrow:

- Login works with valid production credentials.
- Master data entry is available for core masters, including item CRUD.
- Opening stock flow has been exercised locally through the BFF.
- Sales order -> approval -> release -> planning -> dispatch path passed hard-cutover and browser gates.
- Job-card and planning surfaces load in browser tests.
- Reports, owner pack, HTML export, and PDF export pass runtime smoke.
- Plant scope, books lock, QC hold, and role gates are enforced server-side.

## Remaining Non-Blocking Improvements

These do not block day-one production use:

1. Multi-instance BFF cache invalidation.
   - Current books-state cache is in-process. Use Redis before horizontally scaling BFF replicas.

2. Premium print templates.
   - Existing PDFs work. Visual polish can improve after go-live.

3. Sales-order amendment workflow.
   - This is a new feature, not a missing go-live dependency. Current path is cancel/recreate or controlled forward flow.

4. Per-plant tolerance editor UI.
   - Read endpoint is live. Editing can be added later if policy needs per-plant overrides.

## Final Deployment Checklist

Before marking complete:

1. Commit the verified code.
2. Push the branch.
3. Deploy the committed stack to Railway service `hariom-erp`.
4. Verify public `/login`.
5. Verify authenticated public `/api/auth/login`, `/api/auth/me`, and `/api/auth/roles`.
6. Verify no stale old route leaks on public URL.
