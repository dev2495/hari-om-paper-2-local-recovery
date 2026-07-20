# Production Readiness, Security, and Business-Flow Review

**Reviewed:** 18 July 2026  
**Source:** `b133a74`  
**Scope:** authentication, sales orders, specification linkage, planning, RM/FG stock, shop-floor execution, quality, reconciliation, dispatch, analytics, and the associated UI.

## Release result

The source is green for the reviewed production scope. The final two-plant hard-cutover suite passed all 114 checks, and a separate clean end-to-end transaction passed from sales order through monthly reconciliation. These are live API/database workflows using real service math, not placeholder data or UI-only mocks.

## End-to-end flow verdict

| Stage | Result | Verified behavior |
|---|---|---|
| Customer/specification | Green | Approved customer, tube, mandrel, master-paper, adhesive, parchment, recipe, trial, and spec snapshots feed the order and job. |
| Sales order | Green | Maker/checker identity, approval, line release, partial/full release, and timeline are connected. |
| Planning | Green | Release sync creates job cards and queues; Winder assignment, other-Winder warning, capacity warning, shift, and reorder controls are enforced. |
| RM inward and stock | Green | Plant-scoped inward, QC hold, QC acceptance, reel scan genealogy, issue, close, reservations, and manual raw-paper exception controls work. |
| Production floor | Green | Winder, Oven, Process, Packing, and QC gates accept the required readings, machines, reasons, and material references. Missing prerequisites hard-block. |
| FG stock | Green | Packing posts FG inward once with item/batch/transaction traceability. |
| Dispatch | Green | QC and packing prerequisites block premature sealing; sealed orchestration posts inventory and sales fulfillment exactly once and replays safely. |
| Sales fulfillment | Green | Dispatch updates the linked sales-order line and order status without the previous PostgreSQL lock failure. |
| Reconciliation | Green | Theoretical BOM, shift-ledger actuals, month-end actual import, variance, physical stock, certification, close, and carry-forward contracts pass. |
| Reports/analytics | Green | Owner pack HTML/PDF, production, sales, quality, dispatch, inventory health, plant compare, and exceptions return source-backed ranges and data. |

## Corrections made during the review

1. Replaced day-long browser login with rotating 15-minute JWTs and strict 15-minute inactivity expiry.
2. Removed bearer tokens from browser JSON/local storage, including acting-role tokens and cleanup of legacy stored tokens.
3. Removed production fallback to known public JWT secrets across all services.
4. Upgraded vulnerable/outdated Python dependencies and removed the `python-jose`/ECDSA chain.
5. Added same-origin mutation protection, trusted hosts, production documentation shutdown, non-cacheable auth responses, stronger proxy headers, and upload-size control.
6. Fixed inventory location UUID serialization that caused real location requests to return 500.
7. Fixed the sales dispatch row lock that PostgreSQL rejected after stock had already posted.
8. Fixed global dispatch-idempotency collisions that could return 500 across plants.
9. Removed the obsolete paper auto-suggestion assumption from the hard-cutover gate. Paper choice stays operator-controlled; actual selected-paper weight is compared with the target.
10. Added the missing RM reel QC acceptance step before production issue.
11. Changed the dispatch automation to use the sealed orchestrator only, eliminating double-post risk.
12. Wired active plant into dispatch, operational dashboard, role landing, and system audit queries.
13. Polished Dispatch Selection with a compact, responsive filter row, clear handoff count, accurate process language, and useful empty/filter states.

## UI review

The reviewed operational surfaces follow the existing Hari Om visual system rather than introducing a parallel design language:

- Sales orders: clear order/release metrics, customer context, release studio, and action hierarchy.
- Planning: dense production data is contained in the control-tower layout with explicit plant context and machine/shift actions.
- Stock lifecycle: the close sequence, blockers, and certification state are visible in one operating surface.
- Reconciliation: theory, actual consumption, and variance remain separated and auditable.
- Dispatch: now uses the active plant and shows packed/sealed handoffs instead of an incorrectly empty table.

Visual evidence is in `reports/security-flow-audit-2026-07-18/`.

## Evidence index

- `reports/hard_cutover_validation_20260718_214601.md` — 114/114 two-plant checks.
- `reports/full_cycle_e2e_20260425.md` — independent sales-to-reconciliation cycle.
- `security_best_practices_report.md` — security findings, fixes, and operating controls.
- `reports/security-flow-audit-2026-07-18/01-sales-orders.jpeg`
- `reports/security-flow-audit-2026-07-18/02-planner.jpeg`
- `reports/security-flow-audit-2026-07-18/03-stock-lifecycle.jpeg`
- `reports/security-flow-audit-2026-07-18/04-reconciliation.jpeg`
- `reports/security-flow-audit-2026-07-18/05-dispatch.jpeg`

## Important production interpretation

“Green” means the implemented contracts and the reviewed transaction paths pass reproducible tests and runtime checks. It does not remove the need for daily backups, restore drills, user/plant access reviews, real incoming-QC discipline, and operator training. Those controls are part of production readiness for a single-host system.

## AWS go-live verification — 20 July 2026

The reviewed release `b133a74` is live on the dedicated Yash AWS account `982503294277` at `https://35-154-224-14.sslip.io`. The public readiness probe returned HTTP 200 and reported all seven dependencies (`auth`, `masterdata`, `spec`, `production`, `inventory`, `analytics`, and `sales`) as `UP`. The rebuilt application container is healthy, while the existing PostgreSQL container remained healthy and was not recreated. Production environment data and the database volume were preserved.

The live reverse proxy serves the committed Caddy configuration, confirmed by an exact SHA-256 match, and returns CSP, HSTS, COOP, CORP, anti-framing, MIME, referrer, and permissions-policy headers. The public unauthenticated session endpoint returns HTTP 401. BFF documentation routes are disabled in production, internal service ports are not publicly exposed, and EC2 SSH ingress remains restricted to the AWS EC2 Instance Connect address range.
