# Hari Om ERP Codebase Review and Business Audit

Date: 2026-04-25
Repo: `/Users/devarshthakkar/local_repos/yash hari on/Hari Om Paper 2 Local`
Scope: local dirty workspace, CodeRabbit review of current changes, and repo-grounded business logic audit.

## Executive Summary

CodeRabbit completed one successful agent review and raised 118 issues: 3 critical, 58 major, and 57 minor. The highest engineering risks are hardcoded demo credentials, a React Rules of Hooks violation in report detail pages, incomplete RBAC/report design specification, release/dispatch role regressions, and inventory/reporting correctness bugs.

The independent business audit found a larger product risk: the UI now describes a mature sales-release-to-planner flow, but the sales service does not persist line-level release lots. The frontend creates release lot IDs and sends them straight to production sync, so commercial truth, planner truth, and analytics can diverge. This should be treated as a P0 business-contract gap before more UI polish.

No code fixes were applied in this pass. This is a review and report artifact.

## CodeRabbit Run Evidence

- Command run: `/Users/devarshthakkar/.local/bin/coderabbit review --agent`
- Review context: `reviewType=all`, branch `main`, base `main`
- Result: `review_completed`, `findings=118`
- Local persisted review data: `/Users/devarshthakkar/.coderabbit/reviews/bd20637e/2d6ad78f/reviews/1777068868224`
- A second rerun to save raw NDJSON hit CodeRabbit rate limiting: `Rate limit exceeded`, retry wait was about 55 minutes. The full successful review was recovered from the persisted local review data above.

## CodeRabbit Issue Counts

| Severity | Count |
| --- | ---: |
| Critical | 3 |
| Major | 58 |
| Minor | 57 |
| Total | 118 |

## Critical CodeRabbit Issues

### CR-1: Hardcoded demo credentials seed in all environments

- File: `hariom-erp/services/auth-service/src/main.py:176`
- Impact: `seed_canonical_demo_users()` runs at startup and creates known credentials such as `owner123`, `sales123`, and `planner123`. If this stack is deployed beyond local/dev, those accounts become a direct production access risk.
- Fix: guard demo seeding behind an explicit environment flag such as `SEED_DEMO_USERS=true`, or allow it only for `development`, `test`, and `local`. Production should require owner-created users and secrets.

### CR-2: Report detail page violates React Rules of Hooks

- File: `apps/web-ui/components/analytics/ReportDetailPage.tsx:216`
- Impact: `useMemo` is called inside conditional JSX after loading/error branches. A loading-to-success transition can change hook order and crash the page or produce unpredictable UI state.
- Fix: move the table-column `useMemo` to the component top level before `return`, then pass `tableColumns` to `CompactTable`.

### CR-3: Reports suite design has P0 gaps before implementation

- File: `REPORTS_SUITE_DESIGN.md:1`
- Impact: the design is broad but does not fully define report RBAC, mobile behavior, URL state validation, scheduled-delivery audit behavior, single-plant variants, and PDF export security limits.
- Fix: complete these sections before treating reports as implementation-ready, especially API authorization, export timeouts/resource limits, scheduling audit schema, and per-report role permissions.

## Major CodeRabbit Themes

### Security and RBAC

- `hariom-erp/services/auth-service/src/routers/roles.py:92` has a PUT endpoint that ignores the submitted role matrix payload.
- `hariom-erp/services/auth-service/src/routers/roles.py:78` can raise `KeyError` if role capabilities drift from the business role order.
- `hariom-erp/services/sales-service/src/routers/sales_orders.py:447` changed dispatch access to `Admin` and `Dispatch`, removing maker/approver segregation.
- `hariom-erp/services/inventory-service/src/routers/fg_inward.py:43` removes `Production` and `SupervisorEntry` from FG inward access.

### Inventory Correctness and Performance

- `apps/web-ui/app/(dashboard)/inventory/page.tsx:113` mixes incompatible units in load calculation.
- `hariom-erp/services/inventory-service/src/routers/ledger.py:100` and `:136` can raise `ValueError` during unconditional date parsing.
- `hariom-erp/services/inventory-service/src/services/stock_control.py:79` loads unbounded data and aggregates in memory.
- `hariom-erp/services/inventory-service/src/services/stock_control.py:203` and `stock_calc.py:91` have N+1 query patterns.
- `hariom-erp/services/inventory-service/src/services/stock_control.py:188` compares a boolean-like field as a string.

### Sales, Dispatch, and Planning

- `hariom-erp/services/sales-service/src/routers/sales_orders.py:447` weakens dispatch governance.
- `apps/web-ui/app/(dashboard)/planning/board/page.tsx:882` has an incorrect empty-state condition.
- `apps/web-ui/app/(dashboard)/planning/tracker/page.tsx:79` uses `||` fallback, so a valid zero planned quantity can be overwritten.

### UI and Report Reliability

- `apps/web-ui/app/(dashboard)/inventory/ledger/page.tsx:17` lacks loading/error states.
- `apps/web-ui/app/(dashboard)/analytics/dashboard/page.tsx:69` shows synthetic/fabricated sparkline trend data.
- `apps/web-ui/app/(dashboard)/system/users/new/page.tsx:120` has a `plantid` bug that prevents updates from loaded plants.
- `apps/web-ui/app/(dashboard)/master/suppliers/page.tsx:130` has unhandled delete failures.

### Design Specs Need Hardening

- `ANALYTICS_DESIGN.md` needs loading/error states, KPI direction rules, downsample rules, cache strategy, refresh strategy, anomaly comparison definitions, drilldown KPI content, and ARIA-live specs.
- `MRP_DESIGN.md` needs stale inventory definition, error responses, cache invalidation, timezone rules, projection base case, and lot-size rounding behavior.
- `OWNER_LANDING_DESIGN.md` needs explicit route authorization, settings behavior, KPI order persistence, exception show-more behavior, API schema, timezone choice, missing-prior fallback, loading states, WCAG target, phone priority, plan-table prerequisites, and a precise Cash-ish formula.
- `REPORTS_SUITE_DESIGN.md` needs single-plant behavior, RBAC matrix, per-recipient report formats, extensible report scope, PDF export limits, URL state edge cases, scheduled-delivery errors/audit, reduced-motion behavior, and mobile layout.

## Business Logic Audit

### P0-1: Sales release lots are not owned by the sales service

- Evidence:
  - `hariom-erp/services/sales-service/src/routers/sales_orders.py:64` to `:75` defines line responses with quantity, fulfilled quantity, and remaining quantity, but no release lot fields.
  - `hariom-erp/services/sales-service/src/routers/sales_orders.py:349` to `:369` releases the whole order only.
  - `apps/web-ui/app/(dashboard)/sales-orders/page.tsx:73` to `:84` generates `release_lot_id` with `crypto.randomUUID()` on the client.
  - `apps/web-ui/app/(dashboard)/sales-orders/page.tsx:261` to `:271` sends those release rows straight to production sync.
  - `hariom-erp/services/production-service/src/routers/planning.py:2575` to `:2773` stores the release lot only on production job cards.
- Impact: sales can say a line is unreleased while production has a job card for a client-generated lot. Repeated partial releases cannot be audited from the commercial source of truth, and reports may understate released quantity.
- Fix: add `sales_order_release_lots` in the sales service with `line_id`, `release_qty`, `winder_machine_id`, `release_status`, `created_by`, `approved_by`, `job_card_id`, and timestamps. Production should sync only persisted release lots and write back `job_card_id`.

### P0-2: BFF exposes a line-release route that the sales service does not implement

- Evidence:
  - `apps/bff-api/src/routes/sales.py:95` to `:97` proxies `/api/sales/orders/lines/{line_id}/release`.
  - `hariom-erp/services/sales-service/src/routers/sales_orders.py` ends with `/record-dispatch`; there is no `/lines/{line_id}/release` route.
- Impact: any UI or client using the BFF line-release endpoint will hit a backend 404/405. This also signals that the intended line-level release contract is unfinished.
- Fix: implement the sales-service line-release endpoint and persist release lots, or remove the BFF proxy until the backend exists.

### P0-3: Dispatch completion is not tied to production dispatch proof

- Evidence:
  - `hariom-erp/services/sales-service/src/routers/sales_orders.py:441` to `:486` directly increments `fulfilled_qty` from a `dispatch_line_ref`.
  - `hariom-erp/services/production-service/src/routers/dispatch.py:26` to `:59` seals dispatch and only marks a job card completed in the production DB.
  - `hariom-erp/services/inventory-service/src/routers/reservations.py:190` to `:259` consumes reservations separately and does not update sales.
- Impact: commercial fulfillment, FG movement, dispatch sealing, and stock allocation can each be updated independently. That creates over-dispatch, false OTIF, and reconciliation risk.
- Fix: make dispatch sealing the single event that records FG movement, consumes any allocation, and posts a sales dispatch log transactionally or through an idempotent workflow event.

### P0-4: Inventory reservations exist but are disabled in stock availability

- Evidence:
  - `hariom-erp/services/inventory-service/src/routers/reservations.py:81` to `:259` implements reservation create/list/release/consume.
  - `hariom-erp/services/inventory-service/src/services/stock_calc.py:35` to `:42` ignores reservations and always returns `0.0` reserved quantity.
- Impact: the UI and data model suggest stock can be reserved, but availability calculations do not subtract reservations. Store and dispatch users can trust a quantity that is already promised elsewhere.
- Fix: either remove the reservation UX/endpoint from the operating model, or wire active reservations back into `get_reserved_qty` and make dispatch consume them.

### P0-5: MRP is not a purchasing workflow yet

- Evidence:
  - `apps/bff-api/src/routes/inventory.py:375` to `:388` only emits an `MRP_SHORTAGE_DRAFTED` notification.
  - Repo search shows item reorder/safety/lead-time fields and supplier masters, but no persisted purchase order, requisition, approval, supplier quotation, goods receipt, or invoice lifecycle.
- Impact: the MRP page can point at shortages but cannot create a controlled procurement action. Users will still use spreadsheets/WhatsApp outside the ERP for buying.
- Fix: add a purchasing service or module with purchase requisitions, purchase orders, supplier selection, approval, expected receipt date, goods receipt, and link receipts back into inventory inward.

### P0-6: Quality holds are created after stage completion but do not block next-stage movement

- Evidence:
  - `hariom-erp/services/production-service/src/routers/planning.py:2861` to `:2900` creates a `QualityHold` when stage quality checks fail.
  - `hariom-erp/services/production-service/src/routers/planning.py:5243` to `:5250` syncs holds after completing the segment.
  - `hariom-erp/services/production-service/src/routers/planning.py:5277` to `:5317` then advances/open-prepares the next stage when open segments are finished.
- Impact: a failed WINDER/OVEN/PROCESS quality result can still move the job forward unless later UI discipline catches it. The hold protects packing stock status but not every upstream flow.
- Fix: when `quality_holds` is non-empty, prevent next-stage queue creation or set the next stage to blocked until the hold is released.

### P0-7: Dispatch ready list can expose jobs before true dispatch readiness

- Evidence:
  - `hariom-erp/services/production-service/src/routers/dispatch.py:86` to `:95` says ready jobs include `PROCESS`, `PACKING`, or `DONE`.
  - The same route still uses legacy roles `Supervisor`, `Logistics`, and `Store` at `:30` and `:65`, while the canonical role matrix uses `PlantManager`, `Dispatch`, `Store`, etc.
- Impact: jobs at PROCESS can appear in dispatch workflows before packing/FG inward is complete. Role drift can also hide dispatch from the intended users.
- Fix: restrict ready dispatch jobs to sealed packing/FG-ready states and align dispatch roles to the canonical matrix.

### P1-1: RBAC matrix is not a real admin-controlled contract

- Evidence:
  - `hariom-erp/services/auth-service/src/routers/roles.py:86` to `:108` accepts a PUT body but deletes it and returns the current static matrix.
  - `apps/web-ui/context/AuthContext.tsx:96` to `:103` persists active role in localStorage, which is useful for navigation but not authorization.
  - `apps/web-ui/lib/workspace.ts:30` to `:46` maps legacy roles to canonical landing roles, while services still contain several role lists that do not match.
- Impact: the admin role switcher and matrix UI can give a false sense of access control. Real authorization is still scattered in service route decorators.
- Fix: make a canonical server-side permission matrix and enforce it through shared backend middleware/service helpers; keep the role switcher as navigation only.

### P1-2: Analytics/reporting data lineage depends on incomplete upstream truth

- Evidence:
  - `hariom-erp/services/analytics-service/src/routers/reports.py:641` to `:703` builds owner, sales, production, inventory, quality, dispatch, plant, and exception reports from service snapshots.
  - `hariom-erp/services/analytics-service/src/routers/reports.py:28` to `:29` defaults daily report credentials to owner demo credentials if env vars are missing.
  - Sales release quantity and release lots are not persisted in the sales service, so reports cannot prove release discipline from sales truth.
- Impact: analytics can look live and polished while still calculating from incomplete or fallback data. Owner reports may be operationally persuasive but not financially/audit reliable.
- Fix: document metric lineage and freshness; remove credential defaults; block report KPIs that depend on release lots until sales release persistence is implemented.

### P1-3: Spec defaults and spec math verification still have unfinished items

- Evidence:
  - `TASKS.md:24` to `:42` still lists missing `RecipeLayer.gsm_snapshot` migration, `GlobalSpecDefaults`, defaults endpoints, and BFF proxy for spec defaults.
  - `TASKS.md:86` to `:112` still lists missing spec math tests and browser release gate rerun.
- Impact: spec calculations are core manufacturing truth. Without completed defaults and cross-language fixtures, future changes can silently break job-card math.
- Fix: finish the defaults table/endpoints, migrate snapshots, and make Python/TypeScript math fixtures part of the release gate.

## Missing Feature Inventory

### Highest Priority Missing Capabilities

1. Sales release-lot ledger owned by sales service.
2. Purchasing/procurement lifecycle from MRP shortage to PO to goods receipt.
3. Dispatch/challan workflow that is the only way to update sales fulfillment and FG movement.
4. Inventory allocation/reservation policy that is either fully active or fully removed from UI/API.
5. Server-side RBAC matrix with route-level enforcement and audit.
6. Quality hold blocking across all stages, not only FG stock status.
7. Report scheduling with RBAC, per-recipient formats, audit logs, retries, and export limits.
8. Finance truth for AR/AP/cash metrics instead of assumed "Cash-ish" definitions.
9. Supplier performance metrics tied to purchase receipts, reel loss, and quality outcomes.
10. Browser release gate for the redesigned role landings, analytics, MRP, reports, sales release, planner board, and dispatch flows.

### Medium Priority Missing Capabilities

1. URL-state validation and shared filter contract for analytics/reports.
2. Mobile-specific layouts for owner/admin/reports/MRP surfaces.
3. Accessibility audit for dashboards, forms, and modal-heavy flows.
4. Formal data freshness indicators across reports and owner/admin pages.
5. Cross-service idempotency keys for release sync, dispatch posting, inward posting, and report sends.
6. Central workflow audit viewer that links sales order, release lot, job card, inventory movement, quality hold, dispatch, and report event.

## Recommended Fix Order

1. Fix the critical production risks: demo credential seeding and `ReportDetailPage` hook order.
2. Implement sales-owned release lots and remove the client-generated release-lot source of truth.
3. Tie dispatch sealing to sales fulfillment and inventory movement through one idempotent workflow.
4. Decide the inventory reservation policy and wire or remove it consistently.
5. Align RBAC across auth-service, all service route decorators, BFF, and UI navigation.
6. Make quality holds block progression until release.
7. Build procurement/PO lifecycle behind MRP.
8. Harden analytics/report definitions, RBAC, export safety, and schedule audit behavior.
9. Finish spec defaults and math fixture gates.
10. Rerun build, Python compile, service smoke checks, and focused browser flows.

## Full CodeRabbit Issue Appendix

### Critical

| File | Line | Issue |
| --- | ---: | --- |
| `REPORTS_SUITE_DESIGN.md` | 1 | Strong foundation with critical gaps to address before implementation. |
| `apps/web-ui/components/analytics/ReportDetailPage.tsx` | 216 | Critical: `useMemo` called inside conditional rendering violates Rules of Hooks. |
| `hariom-erp/services/auth-service/src/main.py` | 176 | Critical: Hardcoded demo credentials will be seeded in all environments including production. |

### Major

| File | Line | Issue |
| --- | ---: | --- |
| `ADMIN_LANDING_DESIGN.md` | 139 | Strongly emphasize the diff-preview requirement for auto-fix safety. |
| `ADMIN_LANDING_DESIGN.md` | 178 | Specify complete request/response schemas for API endpoints. |
| `ANALYTICS_DESIGN.md` | 1 | Document loading and error states. |
| `ANALYTICS_DESIGN.md` | 119 | Specify the "meaningful direction" mapping for each KPI. |
| `ANALYTICS_DESIGN.md` | 120 | Specify the downsample algorithm for sparklines. |
| `ANALYTICS_DESIGN.md` | 124 | Define insight card priority and ordering logic. |
| `ANALYTICS_DESIGN.md` | 136 | Add caching strategy details. |
| `ANALYTICS_DESIGN.md` | 140 | Add API error handling and status code specifications. |
| `ANALYTICS_DESIGN.md` | 153 | Specify the refresh strategy for live WIP data. |
| `ANALYTICS_DESIGN.md` | 159 | Define "comparable periods" for anomaly detection. |
| `ANALYTICS_DESIGN.md` | 167 | Specify filter conflict resolution and limits. |
| `ANALYTICS_DESIGN.md` | 178 | Define the drilldown drawer's "mini KPI rail" content. |
| `ANALYTICS_DESIGN.md` | 199 | Add ARIA live region specifications for dynamic updates. |
| `MRP_DESIGN.md` | 113 | Define the "stale" inventory KPI. |
| `MRP_DESIGN.md` | 122 | Document error responses and validation rules for POST endpoints. |
| `MRP_DESIGN.md` | 131 | Specify cache invalidation strategy and timezone handling. |
| `MRP_DESIGN.md` | 136 | Specify the initial condition for the projection. |
| `MRP_DESIGN.md` | 140 | Clarify the lot-size rounding behavior. |
| `OWNER_LANDING_DESIGN.md` | 108 | Specify the persistence layer for KPI reordering. |
| `OWNER_LANDING_DESIGN.md` | 121 | Define the behavior of "show more" for exception groups. |
| `OWNER_LANDING_DESIGN.md` | 138 | Complete the API schema with missing parameters and field definitions. |
| `OWNER_LANDING_DESIGN.md` | 157 | Validate the 800ms response target against aggregation complexity. |
| `OWNER_LANDING_DESIGN.md` | 166 | Specify the fallback when prior period data is unavailable. |
| `OWNER_LANDING_DESIGN.md` | 175 | Specify loading states during the initial 800ms data fetch. |
| `OWNER_LANDING_DESIGN.md` | 188 | Declare the target WCAG conformance level. |
| `OWNER_LANDING_DESIGN.md` | 199 | Clarify which charts are deprioritized on phone. |
| `OWNER_LANDING_DESIGN.md` | 227 | Elevate the `salesplan` table requirement from "assumed default" to explicit prerequisite. |
| `OWNER_LANDING_DESIGN.md` | 228 | Define "Cash-ish variance" precisely. |
| `OWNER_LANDING_DESIGN.md` | 28 | Define the behavior of the settings icon. |
| `OWNER_LANDING_DESIGN.md` | 3 | Specify the role-check and redirect mechanism. |
| `OWNER_LANDING_DESIGN.md` | 99 | Specify the timezone for "Good morning/afternoon/evening" logic. |
| `REPORTS_SUITE_DESIGN.md` | 240 | Specify the single-plant variant behavior. |
| `REPORTS_SUITE_DESIGN.md` | 291 | Define role-based access control requirements. |
| `REPORTS_SUITE_DESIGN.md` | 327 | Scheduling API does not support per-recipient format preferences. |
| `REPORTS_SUITE_DESIGN.md` | 335 | Extend ReportPayload scope to match filter requirements. |
| `REPORTS_SUITE_DESIGN.md` | 353 | Add resource limits and security controls for PDF export. |
| `REPORTS_SUITE_DESIGN.md` | 359 | Expand URL state specification with edge cases and defaults. |
| `REPORTS_SUITE_DESIGN.md` | 365 | Specify error handling and audit trail schema for scheduled deliveries. |
| `REPORTS_SUITE_DESIGN.md` | 373 | Respect `prefers-reduced-motion` for accessibility. |
| `REPORTS_SUITE_DESIGN.md` | 452 | Add mobile layout specification to main document. |
| `apps/bff-api/src/routes/inventory.py` | 378 | TypeError when `lines` is not a list. |
| `apps/web-ui/app/(dashboard)/inventory/ledger/page.tsx` | 17 | Missing loading and error states. |
| `apps/web-ui/app/(dashboard)/inventory/page.tsx` | 113 | Mixing incompatible units in `load` calculation. |
| `apps/web-ui/app/(dashboard)/inventory/production-issue/page.tsx` | 206 | Stale checkbox state when item type changes. |
| `apps/web-ui/app/(dashboard)/master/suppliers/page.tsx` | 130 | Missing error handling for delete operation. |
| `apps/web-ui/app/(dashboard)/system/users/new/page.tsx` | 120 | Bug: `plantid` will never update to loaded plants. |
| `hariom-erp/services/auth-service/src/routers/roles.py` | 78 | Potential `KeyError` if `ROLECAPABILITIES` is out of sync with `BUSINESSROLEORDER`. |
| `hariom-erp/services/auth-service/src/routers/roles.py` | 92 | PUT endpoint ignores payload entirely. |
| `hariom-erp/services/inventory-service/src/routers/fg_inward.py` | 43 | Breaking change: Roles `Production` and `SupervisorEntry` will lose access. |
| `hariom-erp/services/inventory-service/src/routers/items.py` | 88 | Breaking change: `plantid` type changed from `uuid.UUID` to `str`. |
| `hariom-erp/services/inventory-service/src/routers/ledger.py` | 100 | Date parsing executes unconditionally and may raise `ValueError`. |
| `hariom-erp/services/inventory-service/src/routers/ledger.py` | 136 | Same date parsing issue as item ledger path. |
| `hariom-erp/services/inventory-service/src/services/stock_calc.py` | 91 | N+1 query issue: `issue.reel` triggers lazy loads inside loop. |
| `hariom-erp/services/inventory-service/src/services/stock_control.py` | 188 | String comparison for boolean field looks suspicious. |
| `hariom-erp/services/inventory-service/src/services/stock_control.py` | 203 | N+1 query pattern causes severe performance degradation. |
| `hariom-erp/services/inventory-service/src/services/stock_control.py` | 79 | Performance: Unbounded data loading and in-memory aggregation. |
| `hariom-erp/services/masterdata-service/src/routers/supplier.py` | 143 | Setting `suppliercode` or `name` to `None` bypasses validation. |
| `hariom-erp/services/sales-service/src/routers/sales_orders.py` | 447 | Dispatch role consolidation removes maker/approver segregation. |

### Minor

| File | Line | Issue |
| --- | ---: | --- |
| `ADMIN_LANDING_DESIGN.md` | 87 | Clarify phasing for Active Sessions component. |
| `ANALYTICS_DESIGN.md` | 234 | Resolve the multi-plant comparison question. |
| `MRP_DESIGN.md` | 111 | Inconsistent scope parameter format. |
| `MRP_DESIGN.md` | 139 | Inconsistent variable naming: `firststockout` vs `stockoutdate`. |
| `OWNER_LANDING_DESIGN.md` | 169 | Verify the technical feasibility of conditional WhatsApp Web linking. |
| `OWNER_LANDING_DESIGN.md` | 205 | Validate the P0 time estimate against scope. |
| `REPORTS_SUITE_DESIGN.md` | 55 | Clarify data freshness display in hub tiles. |
| `apps/web-ui/app/(dashboard)/analytics/dashboard/page.tsx` | 26 | Missing loading and error state handling. |
| `apps/web-ui/app/(dashboard)/analytics/dashboard/page.tsx` | 69 | Sparklines display synthetic/fabricated trend data. |
| `apps/web-ui/app/(dashboard)/analytics/mrp/page.tsx` | 61 | Status computed twice with different logic. |
| `apps/web-ui/app/(dashboard)/dashboard/page.tsx` | 15 | Prevent flash of content before redirect. |
| `apps/web-ui/app/(dashboard)/inventory/items/page.tsx` | 22 | Type mismatch risk between `item.id` and `selectedItemId`. |
| `apps/web-ui/app/(dashboard)/inventory/items/page.tsx` | 83 | Missing error feedback for policy update. |
| `apps/web-ui/app/(dashboard)/inventory/ledger/page.tsx` | 141 | Consider adding a fallback index for row keys. |
| `apps/web-ui/app/(dashboard)/inventory/ledger/page.tsx` | 209 | Same key stability concern as balances table. |
| `apps/web-ui/app/(dashboard)/inventory/ledger/page.tsx` | 211 | Date parsing may produce "Invalid Date" in UI. |
| `apps/web-ui/app/(dashboard)/inventory/page.tsx` | 326 | Date parsing may display "Invalid Date" for malformed inputs. |
| `apps/web-ui/app/(dashboard)/inventory/production-issue/page.tsx` | 58 | Quantity validation allows zero. |
| `apps/web-ui/app/(dashboard)/inventory/raw-material-inward/page.tsx` | 95 | Disable submit button while mutation is pending. |
| `apps/web-ui/app/(dashboard)/inventory/raw-material-inward/page.tsx` | 97 | Add error handling and consider success message timing. |
| `apps/web-ui/app/(dashboard)/inventory/reels/inward/page.tsx` | 165 | Required dropdown with potentially empty options creates confusing UX. |
| `apps/web-ui/app/(dashboard)/inventory/stock-control/page.tsx` | 296 | Form inputs lack accessible labels. |
| `apps/web-ui/app/(dashboard)/planning/board/page.tsx` | 882 | Incorrect empty state condition. |
| `apps/web-ui/app/(dashboard)/planning/print/page.tsx` | 160 | Potential key collision if `segmentid` is undefined. |
| `apps/web-ui/app/(dashboard)/planning/tracker/page.tsx` | 79 | Potential issue with `||` fallback when `plannedqty` is `0`. |
| `apps/web-ui/app/(dashboard)/production/entry/[jobCardId]/page.tsx` | 49 | Minor inconsistency between role display formats. |
| `apps/web-ui/app/(dashboard)/production/eod-entry/page.tsx` | 180 | Empty state message may be misleading when filters are applied. |
| `apps/web-ui/app/(dashboard)/production/job-cards/page.tsx` | 147 | Missing null check for `specid` unlike `salesorderid`. |
| `apps/web-ui/app/(dashboard)/production/reconciliation/page.tsx` | 282 | Add accessible labeling for the close notes textarea. |
| `apps/web-ui/app/(dashboard)/production/reconciliation/page.tsx` | 447 | Add accessible labeling for the search input. |
| `apps/web-ui/app/(dashboard)/production/reconciliation/page.tsx` | 81 | Query key includes `selectedPlant` but API call does not filter by it. |
| `apps/web-ui/app/(dashboard)/system/locations/page.tsx` | 34 | Handle `mutateAsync` rejection to avoid unhandled promise errors. |
| `apps/web-ui/app/(dashboard)/system/machines/page.tsx` | 20 | Handle null/undefined values consistently in capacity rendering. |
| `apps/web-ui/app/(dashboard)/system/users/new/page.tsx` | 202 | Add `minLength` to enforce password requirement. |
| `apps/web-ui/app/(dashboard)/system/users/new/page.tsx` | 87 | Fallback may return a role not present in `availableRoles`. |
| `apps/web-ui/components/workspace/owner-admin-landings.tsx` | 209 | `dataKey` as a function returning a constant may not render the threshold line correctly. |
| `apps/web-ui/components/workspace/owner-admin-landings.tsx` | 343 | Formatter logic incorrectly applies "%" suffix based on value magnitude. |
| `apps/web-ui/context/AuthContext.tsx` | 53 | Role check is case-sensitive. |
| `apps/web-ui/lib/plant-scope.ts` | 9 | Case-insensitive lookup may fail for UUIDs with different casing. |
| `hariom-erp/scripts/direct/launch_detached.py` | 28 | Misleading error message. |
| `hariom-erp/services/auth-service/src/main.py` | 192 | `plantb` may be `None` if PLANTB does not exist, silently skipping the Plant Manager B user. |
| `hariom-erp/services/auth-service/src/main.py` | 56 | Broad pattern matching may inadvertently affect legitimate users. |
| `hariom-erp/services/auth-service/src/routers/roles.py` | 29 | Potential inconsistency with `createrole` endpoint. |
| `hariom-erp/services/auth-service/src/routers/users.py` | 41 | Potential logic issue: asymmetric handling of users with no roles vs. invalid roles. |
| `hariom-erp/services/inventory-service/src/main.py` | 245 | Use boolean literal instead of string `'true'` for the `active` column. |
| `hariom-erp/services/inventory-service/src/models.py` | 376 | Add check constraint to ensure `periodend >= periodstart`. |
| `hariom-erp/services/inventory-service/src/routers/items.py` | 108 | Error message is misleading for `unitcost`. |
| `hariom-erp/services/inventory-service/src/routers/stock_control.py` | 354 | Type mismatch in `costsource` fallback chain may cause errors. |
| `hariom-erp/services/inventory-service/src/routers/stock_control.py` | 652 | Inconsistent response schemas for existing vs new carry-forward. |
| `hariom-erp/services/inventory-service/src/routers/valuation.py` | 61 | Filters in response do not reflect actual query parameters. |
| `hariom-erp/services/inventory-service/src/services/stock_calc.py` | 211 | Potential `AttributeError` if `trackingmode` is `None`. |
| `hariom-erp/services/inventory-service/src/services/stock_calc.py` | 69 | Potential `AttributeError` if `inwarddate` is `None`. |
| `hariom-erp/services/inventory-service/src/services/stock_control.py` | 149 | Potential `TypeError` if `reel.inwarddate` is `None`. |
| `hariom-erp/services/inventory-service/src/services/stock_control.py` | 23 | Potential `KeyError` when `scopeall` is `False` and `selectedplantid` is missing. |
| `hariom-erp/services/masterdata-service/src/main.py` | 314 | Upsert forces `active = TRUE`, which may unintentionally re-activate deactivated suppliers. |
| `hariom-erp/services/masterdata-service/src/routers/supplier.py` | 91 | Race condition between duplicate check and insert. |
| `hariom-erp/services/production-service/src/routers/reel_issue.py` | 34 | Docstring is inconsistent with the role change. |

## Verification Notes

- CodeRabbit review completed successfully once and persisted 118 issue JSON files.
- No build, test, or browser gates were run as part of this report-generation pass.
- The audit reviewed docs, backend service routes/models, BFF proxies, web UI hooks/pages, and the persisted CodeRabbit review data.
