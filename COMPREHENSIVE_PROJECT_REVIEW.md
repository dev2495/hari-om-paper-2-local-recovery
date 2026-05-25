# Hari Om Paper 2 ERP — Comprehensive Project Review

_Read-only audit covering business flow, system logic, UX, and missing features. Scope: this stack only. Accounting e2e is explicitly out of scope._

> Final status note, 2026-05-25: the P1/P2 issues called out in this review have been implemented and verified in the current Hari Om stack. See `PRODUCTION_READINESS_REPORT.md` for the final evidence and deployment checklist.

---

## 0. Executive summary

**The good news.** The system has clean separation of concerns: BFF gateway → 8 backend services (auth, masterdata, sales, spec, production, inventory, analytics, dispatch) → Next.js workspace UI. The state machines that exist are real and enforced. Sales order lifecycle, stock certification, monthly reconciliation, planning board, and dispatch all have working backends with audit trails.

**The bad news.** The system has accumulated **route duplication** (`/master` vs `/masters`, `/specs` vs `/specifications`, `/dispatch` vs `/logistics/dispatch`, `/job-cards` vs `/production/job-cards`, `/landing/owner` vs `/dashboard`), **state machine inconsistencies** (sales uses ALL_CAPS enums, specs use lowercase, jobs use a non-standard `CREATED→PLANNED→IN_PROGRESS` flow without an explicit `RELEASED`), **orphaned masters** (the `Items` master is disconnected from sales-order lines), **role enforcement gaps** (only `/reports/owner` page checks role; the rest rely on sidebar visibility), and **stub MES services** (`mes-winding`, `mes-finish`, `mes-oven`, `mes-slitting` are README-only).

**The next priority.** Three structural fixes would unlock a lot of velocity:

1. **Consolidate duplicate routes** with explicit redirects (already done for some, not all).
2. **Define the Product/Item Master contract.** Today `master/items/page.tsx` is CREATE-only and not referenced from sales order lines. Either give it edit/delete and wire it as the FG SKU source-of-truth, or kill it and document that specs are the SKU layer.
3. **Apply role enforcement at the page or BFF layer** for every protected route, not just the sidebar. The notification feed should also filter by `role_context`.

**The recent work (Audit page + Lifecycle hub + 10 gap fixes) is structurally correct.** Verified against the discovery report — every backend endpoint exists, every hook is real, the state machines used in the hub stepper match the actual model status enums. Two minor improvements identified — see §7.

---

## 1. Architecture at a glance

```
                                  ┌───────────────────────┐
                                  │   Next.js web-ui      │
                                  │  app/(dashboard)/*    │
                                  └───────────┬───────────┘
                                              │ HTTPS + JWT
                                  ┌───────────▼───────────┐
                                  │      bff-api          │
                                  │   FastAPI gateway     │
                                  │  apps/bff-api/src     │
                                  └───────────┬───────────┘
                                              │ httpx + X-Plant-ID
                ┌────────────┬────────────┬───┴───────┬────────────┬────────────┐
                ▼            ▼            ▼            ▼            ▼            ▼
            auth        masterdata     sales       spec      production    inventory
            (JWT)       (papers,       (orders,    (specs,   (jobs,        (items,
                        customers,     lines)      recipes,  planning,     batches,
                        vendors)                   BOM)      reco)         reels)
                                              ▼
                                         analytics
                                     (reports, MRP,
                                      owner-pack)
                                              ▼
                                       dispatch / mes-*
                                       (mostly stubs)
```

**Key file roots:**
- Frontend: `apps/web-ui/`
- BFF gateway: `apps/bff-api/src/routes/`
- Backend services: `hariom-erp/services/<service>/src/`
- Reports + docs: project root `*.md`

---

## 2. Business flow — end to end

### 2.1 The canonical happy path

```
[1] CUSTOMER PO
    └─► Sales (Admin/Sales) creates Sales Order via /sales-orders/new
        Header: customer_id, po_number, po_date, notes
        Lines: approved_spec_id, product_code, qty, due_date, parchment_color, rate_per_pc
        Endpoint: POST /api/sales/orders   ·   status=DRAFT
    └─► Notification: SALES_ORDER_CREATED → Owner/Admin/Planner

[2] APPROVE
    └─► Maker-checker on /sales-orders/[id]
        Endpoint: POST /api/sales/orders/{id}/approve   ·   status=APPROVED
    └─► Notification: SALES_ORDER_APPROVED

[3] RELEASE TO PLANNING
    └─► Per-line release with winder_machine_id + release_qty
        Endpoint: POST /api/sales/orders/lines/{id}/release   ·   status=RELEASED | PARTIALLY_RELEASED
    └─► Triggers _create_or_sync_job_card_for_line() in production-service/planning.py
    └─► Creates JobCard (status=PLANNED) with material_plan_snapshot.bom_snapshot
        snapshot pulled from spec-service /calculate/bom/{recipe_id}

[4] PLAN ON THE BOARD
    └─► Planner uses /planning/board to drag/drop segments onto machines × shifts
        Endpoint: PATCH /api/production/planning/board/move
        Stage routing: SLITTING → WINDER → OVEN → PROCESS → PACKING → QC → DISPATCH

[5] OPERATOR ENTRY (per stage, per shift)
    └─► /production/entry/[jobCardId] (mobile QR)
        Endpoint: POST /api/production/job-cards/{id}/stage-output
        Captures output_qty, scrap_qty, quality_checks
        Status: PLANNED → IN_PROGRESS as first stage starts

[6] DAILY RM ISSUE (parallel to step 5)
    └─► Stores posts /inventory/production-issue against job_card_id
        Endpoint: POST /api/inventory/issue   ·   StockTransaction(ISSUE_PRODUCTION)
        This feeds the LEDGER consumption stream (Gap-1 in audit)

[7] QUALITY HOLDS (if any)
    └─► QC creates a hold via /quality, blocks dispatch readiness
        Endpoint: POST /api/production/quality/holds

[8] FG INWARD
    └─► On job close, POST /fg-inward/ creates a StockBatch + StockTransaction(FG_INWARD)
        FG is positive inventory; RM consumption is NOT auto-debited here.
        Alternate: manual FG via /inventory/fg-inward (REWORK/RETURN/ADJUSTMENT)

[9] DISPATCH
    └─► /logistics/dispatch — operator picks ready jobs, draft challan
        Status: DRAFT → SEALED
        Endpoint: POST /api/inventory/dispatch + PATCH

[10] STOCK CERTIFICATION (period close)
    └─► /inventory/stock-control — draft cert against the statement
        Enter physical_qty per item → variance_qty computed
        Endpoint: POST /api/inventory/stock-control/certifications
        Status: DRAFT → CERTIFIED (manual click) → CARRIED_FORWARD

[11] MONTHLY RECONCILIATION
    └─► /production/reconciliation — import plant-register actuals
        Three streams shown side-by-side: theoretical / ledger / actual
        Endpoint: POST /api/production/import-monthly-actuals
        Status: OPEN → DRAFT (after import) → APPROVED (after gate)
        Gates: cert must be CERTIFIED + every over-tolerance row needs notes

[12] CARRY-FORWARD POST OPENING
    └─► On the CF card, "Post opening" creates next-period OPENING ledger rows
        Endpoint: POST /api/inventory/stock-control/carry-forwards/{id}/post-opening
        Status: GENERATED → POSTED

[13] BOOKS LOCKED
    └─► reconciliation Approve sets MonthlyMaterialClose.status=APPROVED + locked_at
        BooksLockedChip appears in workspace header for all roles
        Endpoint: GET /api/production/books-state surfaces this everywhere
```

**Where it breaks today:**
- Step 4 → 5 transition is partially documented but the MES backend services (`mes-winding`, etc.) are README stubs — actual ops likely happen via the supervisor-entry page.
- Step 9 has no GL hook (out of scope per your instruction, noted here for completeness).
- Step 13's enforcement of "no backdated mutations" is only a visible chip; the BFF/services don't reject backdated writes.

### 2.2 Variant flows

- **Sales order cancellation** — supported via `cancelled_at`, `cancelled_by`. UI presence not verified.
- **Spec lifecycle** — `draft → trial → approved → obsolete`. Approval is via `POST /api/spec/specifications/{id}/approve`.
- **Recipe versioning** — `RecipeHeader` has its own `status` (`trial`, `approved`) separate from spec status. New recipes can be created against an approved spec.
- **Rework / Customer return** — supported only via `/inventory/fg-inward` manual form (added in the recent pass).
- **Year carry-forward** — same as period carry-forward; UI doesn't currently distinguish year boundary.

---

## 3. Domain reviews

### 3.1 Sales (✓ mature)

**State machine:** `DRAFT → SUBMITTED? → APPROVED → RELEASED | PARTIALLY_RELEASED → PARTIALLY_DISPATCHED → CLOSED` (or `CANCELLED`).

**Strong points:**
- Maker-checker workflow exists.
- Per-line release with winder assignment.
- Timeline fallback in the hook builds an audit chain even when the backend doesn't return one.
- BFF emits a notification on every mutation.

**Gaps:**
- **Reverting a release / unrelease** — not exposed in UI; only forward transitions.
- **Edit after approval** — no flow for amending a customer PO once approved.
- **Price master is a transactional field** (`rate_per_pc` on line), not a master. Acceptable for a paper-tube shop but documented as `PaperMaster.price` field that's deprecated — clean up needed.
- **Dispatch tie-back** — `fulfilled_qty` on line is updated by dispatch_log but the UI is not consistent about showing it on the sales-order detail.

### 3.2 Master data (⚠ partial)

**Universal CRUD:** Papers, Adhesives, Parchments, TubeSizes, Mandrels, Customers, Suppliers/Vendors, Machines, Locations.

**Confirmed gaps:**

| Master | Issue |
|---|---|
| `master/items/page.tsx` | **CREATE-only**, no UPDATE/DELETE wired. Orphan — sales order lines reference `approved_spec_id + product_code`, not `item_id`. Either wire it or remove it. |
| `master/packaging/` | UI exists but model definition not located in `masterdata-service/models.py`. May live in a different service. |
| `master/tools/` | Same — UI works via hooks but model is not in `masterdata-service`. |
| Duplicate routes | `/master/*` (canonical) and `/masters/*` (re-exports). Confusing for users navigating the URL bar. |
| Pricing master | None. `PaperMaster.price` is unused but still in the model. |

**Strong points:**
- Contact subentities (CustomerContact, VendorContact) properly modeled.
- Plant-scoped uniqueness on `(plant_id, code)` and `(plant_id, name)`.
- `master/page.tsx` is a clean switchboard.

### 3.3 Specifications (✓ mature, has subtle state-machine quirks)

**Spec status:** `draft → trial → approved → obsolete` (lowercase).
**Recipe status:** `trial → approved` (lowercase, separate enum).

**Strong points:**
- Dimensional ranges modeled as **axes** (min/max bounded): id/od/length/weight/cs/moisture. This is the correct domain model for paper tubes — variants are positional ranges, not discrete SKUs.
- BOM is computed on demand via `/calculate/bom/{recipe_id}` from spec-service; planning snapshots it onto the job card.

**Gaps:**
- Two routes exist: `/specifications` and `/specs` (redirect). Acceptable but documentable.
- No bulk-approve, no diff view between recipe versions in UI.
- Spec status uses lowercase while sales/job use ALL_CAPS. Style inconsistency only.

### 3.4 Inventory + stock lifecycle (✓ mature after recent fixes)

This is the deepest part of the system after the recent pass:

- **Daily ops:** `/inventory/raw-material-inward`, `/inventory/production-issue`, `/inventory/reels/*`.
- **Stock state machine:** Opening → daily → DRAFT cert → CERTIFIED → CARRIED_FORWARD → POSTED. All transitions enforced server-side.
- **Variance fields on cert lines:** `physical_qty`, `variance_qty = physical_qty - closing_qty`, `variance_value`.
- **Drill-down:** Variance rows in reconciliation link to the ledger filtered by item+date.
- **Lifecycle hub** `/inventory/lifecycle` shows the full stepper with real status detection.

**Gaps still alive:**
- **Cross-app backdated-mutation guard.** Books-lock chip is visible; nothing actually rejects a backdated `created_at` on a write today.
- **Reel-trace UI** (`/inventory/reel-trace`) is separate from `/inventory/genealogy`. Likely the same use case in two URLs.

### 3.5 Production + planning (⚠ partially complete)

**Planning:** drag-and-drop board (`/planning/board`), segment splits, stage backlog. Strong.

**Job cards:**
- State machine: `CREATED → PLANNED → IN_PROGRESS → COMPLETED | CANCELLED`.
- No explicit `RELEASED` state — `PLANNED` doubles as released. This works but operators expect a "released = ready to start" distinction.
- `JobCard.close` endpoint referenced from `use-production.ts` (line 490) but **the matching backend handler was NOT FOUND** in the routers scan. This is a confirmed orphan call.

**MES services (`mes-winding`, `mes-finish`, `mes-oven`, `mes-slitting`):**
- All four are **README stubs**. No src/ code.
- The actual stage capture happens via `/api/production/job-cards/{id}/stage-output` in production-service. If the MES services were intended to be separate processes, that direction was abandoned.

**Quality:**
- `/quality/page.tsx` is unified.
- `POST /quality/holds` blocks dispatch readiness via aggregation — but **the stage advancement endpoint does NOT check holds** before allowing a stage entry. Risk: an operator can post output past an active hold. (See §6.)

### 3.6 Dispatch (⚠ partial)

**State machine:** `DRAFT → SEALED`. Simple, works.

**Gaps:**
- No "RELEASED" or "INVOICED" state.
- No PDF challan template surface in the UI (the `print/page.tsx` exists but visibility tied to backend snapshot only).
- Dispatch does NOT trigger an FG outward ledger row automatically — the FG remains in DISPATCH_STAGING status. If you want true off-balance-sheet movement, that gap needs filling.

### 3.7 Analytics + reports (✓ broad, ⚠ uneven enforcement)

**10 analytics dashboards** (`/analytics/dashboard`, `/analytics/mrp`, etc.) and **6 reports** (`owner`, `production`, `sales`, `inventory`, `plants`, `exceptions`) covering most of the operational signals.

**Strong points:**
- Owner Pack endpoint aggregates everything an executive needs in one call.
- MRP page converts shortages to PO draft payloads (logic at lines 130–160 of `analytics/mrp/page.tsx`).

**Gaps:**
- Only `/reports/owner` enforces role at the page level. Other reports are visible to any logged-in user who knows the URL — sidebar visibility is the only gate.
- Notifications come back from `/api/auth/notifications?limit=12` — no role filter on the server, only role_context as advisory metadata. Users see all notifications regardless of role.

### 3.8 System + auth (✓ functional, ⚠ enforcement gaps)

- **JWT** (HS256, 1440-min expiry) with `roles[]`, `permissions[]`, `plant_id`, `is_owner_all_plants` claims.
- **Plant scope** via `X-Plant-ID` header; BFF forwards to services that filter on it.
- **8 canonical roles**: Owner · Admin · PlantManager · Planner · Store · Dispatch · Sales · Operator.
- **6 legacy role aliases** still in code (SupervisorEntry → PlantManager, Production → PlantManager, QC → PlantManager, etc.).

**Confirmed enforcement holes:**
- BFF does NOT validate that the current user is allowed on the X-Plant-ID being requested. `is_owner_all_plants` is set on the user but not consistently enforced at the gateway.
- **No audit log for permission changes** itself — the audit page surfaces logins and mutations, but role assignment changes aren't traceable.

### 3.9 Workspace shell (✓ solid)

- 6 nav groups, 20 links, role-based filtering.
- RoleSwitcher and PlantSwitcher in the header.
- The new BooksLockedChip surfaces close posture everywhere.
- RoleLanding component renders a per-role dashboard for non-owner/admin users.

**Gap:** Dashboard vs Landing duality — `/dashboard` redirects Owner/Admin to `/landing/{owner|admin}` but renders RoleLanding inline for the others. This is clever but causes URL confusion (someone could bookmark `/dashboard` and never know they're on the role landing).

---

## 4. Recent decisions — verification pass

These are the major changes from the past two sessions. Verified against the discovery output.

### 4.1 Audit center at `/system/audit` — ✅ correct

- Route is under `system/`, gated to Owner/Admin/SuperAdmin via `useAuth()`.
- 6 tabs (Overview, Feed, Users, Notifications, Sales/Production, Inventory/Stock).
- Pulls real data from `useSalesOrders`, `usePlanningJobCards`, `useInventoryTransactions`, `useReadyJobs`, `useNotifications`, `useUsers`.
- Synthesizes events from existing fields (`created_by`, `approved_by`, `released_by`) because there's no dedicated audit-log API.
- **Verified correct.** One enhancement: when the backend later adds a real audit-log table, the page will need to add it as an additional stream rather than replacing the synthesis.

### 4.2 Stock Lifecycle Hub at `/inventory/lifecycle` — ✅ correct

- 6-step stepper (Open → Daily → Cert → CF → Reco → Lock).
- "Next action" engine computes the operator's one job from real state — verified the logic chain matches the actual model status enums.
- Three-stream comparison cards + Bar chart from real summary data.
- Weekly drift + close history side-by-side.
- **Verified correct.** Minor cosmetic improvement could be: replace the 12-month history `dataKey="rows"` chart with `dataKey="approved"` to show the binary approved/not-approved pattern more clearly.

### 4.3 Ten gap fixes — ✅ all correctly implemented

Cross-checked against the audit:

| Gap | Backend ✓ | BFF ✓ | Frontend ✓ | Notes |
|---|---|---|---|---|
| 1 — Ledger ↔ reco bridge | ✓ aggregate-by-item | ✓ proxy | ✓ 3-column table | Real SQL aggregation, not a stub |
| 2 — Variance reason | ✓ `needs_explanation` flag | ✓ | ✓ amber chip + input | Tolerance per item-type |
| 3 — Threshold gate | ✓ HTTP 422 with blocker list | ✓ | ✓ blocker card + button | Same `_compute_period_state` |
| 4 — Cert ↔ reco link | ✓ `_compute_period_state` | ✓ period-state endpoint | ✓ banner + deep-link | Joins both state machines |
| 5 — Auto CF → opening | ✓ post-opening endpoint | ✓ proxy + event | ✓ button on CF card | Idempotent on document_no |
| 6 — Drill-down | ✓ existing ledger filter | ✓ | ✓ banner + back link | Uses URL params |
| 7 — Manual FG | ✓ /fg-inward/manual | ✓ proxy + event | ✓ new page + sidebar | REWORK/RETURN/ADJUSTMENT/OPENING/OTHER |
| 8 — Centralize math | ✓ new consumption.py | (n/a) | (n/a) | Service module + dataclasses |
| 9 — Weekly drift | ✓ weekly-drift endpoint | ✓ proxy | ✓ reco tab | Read-only |
| 10 — Books-locked flag | ✓ books-state endpoint | ✓ proxy | ✓ header chip + banners | 60s refetch |

**All correctly placed in the Hari Om stack.** No accounting-side wiring (out of scope as instructed). No mocks — every endpoint reads existing tables.

### 4.4 What was deferred but should be tracked

- **Cross-app backdated-mutation enforcement** (Gap 10b). Today the chip surfaces the lock; the lock isn't actually enforced as a hard reject on backdated `created_at` mutations in sales/production. Hard guard needed eventually.
- **Custom audit-log table.** All audit signals are synthesized today. A dedicated `audit_events` table with structured `(event_type, actor, entity_type, entity_id, payload, at)` would let the audit page do permission-change history, role grants, plant-scope changes, and config drift — none of which are visible today.

---

## 5. Logic correctness review — known sharp edges

Things that work but could trip an operator:

1. **Spec status vs Recipe status.** Approving a spec doesn't auto-approve all its recipes. If you approve the spec but every recipe is still in `trial`, no job card can be created. The UI doesn't surface this clearly.

2. **Job-card "PLANNED" doubles as "RELEASED".** Operators reading the status field can't distinguish "released and ready to start" from "still being scheduled". A `READY` or `RELEASED` sub-status would help.

3. **Carry-forward doesn't auto-post the next opening.** This was fixed in the last pass — a button on the CF card now does it. But the `CARRIED_FORWARD` → `POSTED` transition is still manual. Some users will forget.

4. **Stage advancement doesn't gate on QC holds.** The hold appears as a flag in the job-card detail view, but `POST /job-cards/{id}/stage-output` doesn't reject when an active hold exists. The operator UI may visually warn, but the server doesn't enforce. Real risk.

5. **`is_owner_all_plants` not always honored.** The flag exists but only some endpoints check it. For an "Owner across all plants" user, some pages still require selecting a single plant in the header.

6. **Variance tolerance is hard-coded constants.** `RAW_PAPER=5kg, ADHESIVE=0.5kg, …` — adequate today but should move to a per-plant settings table.

7. **Notifications: 12-row cap.** `useNotifications` fetches `limit=12`. Older notifications are lost. No search or pagination in the UI.

---

## 6. Missing features — prioritized

### Priority 1 (close real gaps)

| # | Feature | Why it matters |
|---|---|---|
| 1 | **Wire `master/items` as the canonical FG SKU master** (or remove it). Add UPDATE/DELETE hooks, reference it from sales order lines (item_id alongside approved_spec_id). | Items master is currently orphaned. Either it's the SKU source-of-truth or it shouldn't exist. |
| 2 | **Stage advancement should reject when an active QC hold exists.** | Today the only safeguard is UI. Backend should enforce. |
| 3 | **Backdated-mutation guard from books-locked period.** Backend rejects writes with `created_at < locked_through`. | Closes the loop the visible chip implies. |
| 4 | **Job-card `RELEASED` sub-status** (or rename `PLANNED` → `RELEASED`). | Operators need to know "ready vs scheduled". |
| 5 | **Plant-scope enforcement at the BFF.** Validate `X-Plant-ID` is in user's `allowed_plants` for every request. | Currently advisory only. |

### Priority 2 (UX + simplification)

| # | Feature | Notes |
|---|---|---|
| 6 | **Consolidate `/master` vs `/masters` and `/specs` vs `/specifications`.** Pick one canonical URL, return 301 from the other. | Reduces operator confusion. |
| 7 | **Add `/job-cards/{id}/close` handler** in production-service (currently called by UI but not handled). | Confirmed orphan endpoint. |
| 8 | **Move tolerance constants** to a per-plant settings table with UI under `/system`. | Today edits require code change. |
| 9 | **Page-level role enforcement on every `/reports/*` route.** Not just sidebar gate. | RBAC consistency. |
| 10 | **Notification pagination + role-context filter.** | Today only 12 most recent visible. |

### Priority 3 (new capability)

| # | Feature | Notes |
|---|---|---|
| 11 | **Audit_events backend table** with structured `(event_type, actor, entity_type, entity_id, payload, at)`. Replace synthesized streams with real ones. | Today audit is best-effort synthesis. |
| 12 | **Permission-change audit** — surface role grants, revokes, plant-scope changes on the audit page. | Currently invisible. |
| 13 | **MES services build-out** — `mes-winding`, `mes-finish`, `mes-oven`, `mes-slitting` are README-only. | Either implement them or delete the stub folders. |
| 14 | **Dispatch GL / outward ledger row on SEALED.** | Once SEALED, the FG should leave stock automatically. |
| 15 | **Spec → recipe approval cascade** UI. Today approving a spec doesn't auto-approve trial recipes; the bottleneck is invisible. | Workflow visualization. |
| 16 | **Sales order edit-after-approval** flow with a versioned amendment. | No edit path today. |
| 17 | **PDF challan + spec sheet** premium templates. The print routes exist; styling is basic. | Improves customer-facing artifacts. |

---

## 7. Simplification opportunities

These are quick wins where deleting code or merging routes would simplify mental load without losing capability.

1. **Delete unused master routes / re-exports.** `/masters/*` re-exports `/master/*`. Pick canonical, leave a single redirect file in `/masters/page.tsx`.

2. **Delete `/specs/page.tsx`** (or make it a redirect-only) — `/specifications/page.tsx` is the primary.

3. **Delete `/dispatch/page.tsx`** if it's redirect-only — `/logistics/dispatch` is canonical.

4. **Delete `/job-cards/page.tsx`** in favor of `/production/job-cards/page.tsx`.

5. **Delete MES stub folders** (`mes-winding`, `mes-finish`, `mes-oven`, `mes-slitting`) until they have real code. README-only services create false expectations.

6. **Delete `PaperMaster.price` column** — documented as deprecated, not used.

7. **Consolidate `analytics-loss`, `analytics-overview`, `analytics-supplier-reels`, `analytics-winder-variance`** into the `/analytics/` tree as sub-routes. They are top-level today and clutter the URL space.

8. **Remove legacy role aliases** (`SupervisorEntry`, `Production`, `QC` mapping to `PlantManager`) once you confirm no user JWT still carries those role names.

9. **`[...legacy]/page.tsx` catch-all** — has 46 hardcoded redirects. Trim once analytics confirms old URLs are no longer hit.

10. **`control-tower/page.tsx`** is a 1-line redirect to `/analytics/dashboard`. Either delete the route or document it as the planner's bookmark.

---

## 8. Recommended next-30-days punch list

If I were prioritizing the next month of work:

**Week 1 — Quality + Safety**
- Stage advancement rejects on QC holds (P1.2)
- Wire `master/items` properly OR remove (P1.1)
- Add `/job-cards/{id}/close` handler (P2.7)

**Week 2 — Lifecycle hardening**
- Backdated-mutation guard server-side (P1.3)
- Plant-scope enforcement at BFF (P1.5)
- Tolerance settings table + UI (P2.8)

**Week 3 — UX simplification**
- Consolidate duplicate routes (P2.6 + §7.1–§7.4)
- Page-level RBAC on reports (P2.9)
- Notification pagination + filter (P2.10)

**Week 4 — Capability**
- `audit_events` table + populate it from existing mutation handlers (P3.11)
- Surface permission changes on audit page (P3.12)
- Delete MES stubs or commit to building them (§7.5)

---

## 9. Closing assessment

Hari Om Paper 2 ERP is **fundamentally a sound application** with a clean service architecture, real audit chains, and a working close ritual. The pieces are mostly there. The work to make it production-grade is **predominantly cleanup** — deleting duplicate routes, enforcing what the UI advertises (RBAC, plant scope, backdated writes), and finishing the few orphan endpoints — rather than new feature construction.

The most valuable single fix you can make is **deciding what `master/items` is**. If it's the SKU source-of-truth, wire it everywhere. If it's not, delete it and document that specs are the SKU layer. Either way, the ambiguity is the biggest source of "where do I edit this thing?" friction for users.

The Audit center and the Stock Lifecycle hub from the recent work are correctly positioned. They will pay back time as new operators onboard — the flow they show is the actual flow your operators run.

---

_Generated 2026-05-21 — `COMPREHENSIVE_PROJECT_REVIEW.md` at the repo root. References: `STOCK_CONSUMPTION_RECONCILIATION_AUDIT.md`, `CLOSE_LIFECYCLE_FIX_CHECKLIST.md`._
