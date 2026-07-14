# Hari Om ERP — Full-Stack Health, Flow, and Gap Review

**Review date:** 14 July 2026 (Asia/Kolkata)  
**Reviewed commit:** `e7343b0` (`main`, matching `origin/main` before this report)  
**Live AWS stack:** `https://35-154-224-14.sslip.io`  
**Deployment shape:** one AWS EC2 `t4g.medium`, Docker Compose, PostgreSQL 16, application container, Caddy TLS proxy  
**Scope:** existing master data, sales, specifications, purchase/GRN, inventory, planning, production, quality, reconciliation, dispatch, analytics, users/roles, scheduler, stack health, backup, and UI journeys  
**Explicitly excluded:** full Tally/accounting implementation, payroll, attendance, and a full HR module

## Executive verdict

The AWS machine and containers are healthy at the time of review, and the repository passes its present automated verification suite. The stack is **not yet defensible as “perfect/no gaps” for business operations** because two critical gates remain:

1. Plant administration has a confirmed authentication/authorization bypass.
2. Sealing a dispatch can partially commit inventory before sales/production completes, and the frontend does not send the backend's idempotency key.

There are also broken or misleading user flows: Purchase fails for the default Owner/Admin `ALL` plant scope, the FG reservation quick action leads to a soft 404, two analytics flows call a nonexistent sales endpoint, and the Admin “system health” surface displays hardcoded numbers rather than live infrastructure health.

**Sign-off status: RED — do not call the product gap-free or fully production-safe until the P0 gates below pass.** The current AWS runtime itself is green; the red status is driven by security and transaction-integrity behavior in the application.

## Scorecard

| Area | Status | Evidence-based assessment |
|---|---:|---|
| AWS compute and containers | Green | Application and PostgreSQL containers healthy; Caddy running; 2.3 GiB RAM available; root disk 28% used |
| Master/user migration | Green for intended scope | Six users and master records are present; transactional history is intentionally absent |
| Build and unit verification | Green with coverage gaps | Production build, lint, TypeScript, dependency audit, 151 backend tests and 34 web tests pass |
| Authentication and authorization | Red | Forged nonempty cookie can read plants; mutation routes are also unprotected in code |
| Dispatch integrity | Red | Cross-service writes are not atomic; roles disagree; UI omits idempotency key |
| Purchase/GRN landing | Red for Owner/Admin default | Both read calls return HTTP 400 in `ALL` scope |
| Sales/spec/planning/production/QC core | Amber | Implemented and well covered in parts, but no transaction data was imported for non-destructive live E2E proof |
| Inventory | Amber | Core lifecycle tests pass; reservation API/UI/BFF path is incomplete |
| Analytics and owner reporting | Red | Wrong internal sales URLs and synthetic fallback executive figures |
| Admin stack-health page | Red | Hardcoded health, CPU, memory, storage, latency and error values |
| Backup | Amber/Green | Scheduled encrypted S3 backup succeeds and archive validates; no automated restore drill or failure alarm |
| Desktop UI polish | Green/Amber | Consistent and usable on reviewed desktop routes; broken-state messaging exists |
| Mobile polish | Amber/Red | Purchase, stock control, and admin surfaces horizontally overflow at 390 px |
| Rebuild/deploy reproducibility | Amber/Red | Production infrastructure and a compatibility change are not committed; first bootstrap ended in cloud-init error and required recovery |

## P0 — must fix before normal business use

### 1. Plant administration authentication/authorization bypass

**Impact:** An unauthenticated or non-admin caller can reach plant data and, based on the active code path, can create, edit, or delete plants. Plant deletion or alteration can corrupt the scoping foundation used throughout the ERP.

**Live proof:**

- `GET /api/auth/me` with a forged cookie correctly returned 401.
- The same request context with `Cookie: token=not-a-valid-jwt` returned HTTP 200 from `GET /api/auth/plants` and exposed plant details.
- No write was attempted during this review. Write exposure is established by the code paths, not by mutating production.

**Code proof:**

- `hariom-erp/services/auth-service/src/main.py:10-20` imports/includes auth, role, user, notification, and audit routers, but not the authenticated plants router.
- `hariom-erp/services/auth-service/src/main.py:356-428` implements direct plant GET/POST/PATCH/DELETE handlers without a user or role dependency.
- A safer authenticated list implementation exists in `hariom-erp/services/auth-service/src/routers/plants.py:14-39`, but is not mounted.
- `apps/bff-api/src/routes/auth.py:333-400` checks only whether the cookie string is nonempty and then proxies it; it does not validate the JWT or enforce Admin/Owner before plant operations.

**Required acceptance gate:** A forged, expired, or ordinary non-admin token must receive 401/403 for every plant operation. Only explicitly authorized roles may mutate plants, and auth/BFF tests must cover all four verbs.

### 2. Dispatch sealing can create partial, duplicate, or role-dependent stock movement

**Impact:** A sealed dispatch can decrement finished-goods inventory while sales fulfillment and the production dispatch record fail. Retrying from the UI can then post stock again. This is a stock-truth and customer-fulfillment integrity risk.

**Code proof:**

- Production permits `Admin`, `Owner`, `Dispatch`, `Store`, `PlantManager`, `Supervisor`, and `Logistics`: `production-service/src/routers/dispatch.py:21`.
- Inventory permits `Store`, `Admin`, `Dispatch`, `PlantManager`, `Logistics`, and `Supervisor`, but not Owner: `inventory-service/src/routers/dispatch.py:91-97`.
- Sales fulfillment permits only `Admin` and `Dispatch`: `sales-service/src/routers/sales_orders.py:1070-1077`.
- Production posts to inventory first, then sales, then commits its local database: `production-service/src/routers/dispatch.py:272-301`.
- Therefore Store/PlantManager/Supervisor/Logistics can pass production and inventory authorization and fail at sales after inventory has committed. Owner can fail at inventory. Network or timeout failure after inventory produces the same partial-state class.
- The backend supports `dispatch_request_id` and tests its idempotency (`production-service/src/routers/dispatch.py:45,192-233`), but the live frontend payload omits that field: `apps/web-ui/app/(dashboard)/logistics/dispatch/new/page.tsx:94-100`.
- When no stable request ID exists, the fallback reference contains the newly created dispatch ID (`PROD-DISPATCH-{dispatch.id}`), so a rolled-back production row can generate a new reference on retry.

**Required acceptance gate:** Align the role matrix before any write, generate and persist a client request ID, and make the cross-service operation recoverable through an outbox/saga or equivalent durable state machine. Failure-injection tests must prove that inventory, sales fulfillment, and the production dispatch converge exactly once after timeouts and retries.

## P1 — broken or misleading operational flows

### 3. Purchase page fails in the default Owner/Admin scope

Owners/Admins default to `ALL` plant scope. Both live page queries then return HTTP 400 with `ALL scope is read-only`:

- `GET /api/purchase/orders`
- `GET /api/purchase/receipts`

The page catches the failures and shows `Purchase orders: pending (400)` and `GRNs: pending (400)`, while also displaying stale text that purchase routes are not fully connected (`apps/web-ui/app/(dashboard)/purchase/page.tsx:40,69,88-95,277`). The endpoints exist, but depend on a concrete plant (`inventory-service/src/routers/purchase.py:234-246,529-535`).

**Required behavior:** Prompt for a concrete plant before loading/mutating purchase records, or support an authorized aggregated read for `ALL`. Do not describe an available endpoint as pending.

### 4. FG reservation capability is implemented only in disconnected pieces

- Frontend API functions call `/api/inventory/reservations`: `apps/web-ui/lib/api.ts:499-501`.
- Inventory implements create/list/release/consume handlers: `inventory-service/src/routers/reservations.py:85-271`.
- The BFF inventory router exposes no reservation path.
- Dispatch workspace navigation links to `/inventory/reservations`: `apps/web-ui/lib/workspace.ts:98-105`.
- That live URL is a soft 404: HTTP 200 with the rendered title `404: This page could not be found`.

**Required behavior:** Add BFF proxy coverage and a real reservations screen, or remove the action until the workflow exists. Route monitoring must detect rendered soft 404 pages, not only HTTP status.

### 5. Customer 360 and lead-time analytics call a nonexistent sales URL

The analytics service calls `/orders?limit=500` and `/orders?limit=500&status=CLOSED` at `analytics-service/src/routers/deep_cuts.py:159-165,373-379`. Sales is mounted at `/sales-orders` (`sales-service/src/routers/sales_orders.py:29`). Live application logs confirm repeated internal `/orders...` 404 responses.

The analytics client degrades these upstream errors to empty data, so the public report can still return HTTP 200 with zero rows instead of exposing the contract failure. Once transactions exist, valid business activity could silently disappear from these views.

**Required behavior:** Use the canonical sales endpoint, validate response schemas, and surface upstream contract failure separately from a legitimate empty result.

### 6. Admin “system health” is not connected to system health

The admin dashboard presents fixed service status/latency/RPS/error data, synthetic spark lines, a fallback of eight active users, and hardcoded CPU 38%, memory 71%, and storage 21% (`apps/web-ui/components/workspace/owner-admin-landings.tsx:279-397`). It also claims FK integrity and no orphaned rows without running such database checks.

At the review snapshot, the host actually had roughly 1.5 GiB used out of 3.7 GiB RAM and 28% disk used, proving the displayed resource figures are not measurements. The page can say “System green” while Purchase is returning 400, a quick action is a 404, and analytics upstream calls are failing.

**Required behavior:** Connect the view to real container/process readiness, host metrics, database checks, queue/scheduler freshness, backup age, and contract probes. Unknown data must render as unknown, never a healthy-looking fallback.

### 7. Owner dashboard invents executive business results in no-data states

`fallbackSeries` fabricates ten days of winder/oven/process/dispatch/OTIF values, the order waterfall guesses proportions, and Revenue MTD/Cash-ish Variance use guessed percentages and fixed deltas (`apps/web-ui/components/workspace/owner-admin-landings.tsx:76-90,125-131,179-185`).

The migrated production environment intentionally contains no transactions, yet the page renders trend-like values. This makes an executive view look active when the source data is empty.

**Required behavior:** Render an explicit no-data/onboarding state. Demonstration data must be opt-in, clearly labelled, and impossible to confuse with live KPIs.

### 8. Printed dispatch document contains placeholder legal identity

The dispatch document hardcodes `HARI OM PAPER`, `GIDC Vapi, Gujarat, India`, and `GSTIN: 24XXXXXXXXXX1Z5` (`apps/web-ui/components/dispatch/dispatch-document.tsx:49-54`). It does not derive the legal identity from plant/company master data.

**Required behavior:** Resolve legal name, complete address, GSTIN, consignee/tax details, document numbering, and other applicable dispatch fields from controlled masters. This is an operational dispatch requirement, not a request for full accounting.

## P2 — reliability, recovery, security hardening, and polish

### 9. Short-close carry-forward can create an unallocated orphan

When sales lot reallocation fails, production deliberately creates a carry-forward job with `release_lot_id=None` and emits `carry_forward_orphan_release_lot` (`production-service/src/routers/operations.py:361-431,693-720`). Comments say a callback must allocate a new lot later, but no callback/repair worker was found. Reason-code validation also proceeds during network/upstream/parse failure (`operations.py:141-197,562-569`).

**Required behavior:** Persist a visible exception queue with retry/assignment ownership, block downstream release where appropriate, and alert until every orphan is linked or explicitly cancelled.

### 10. Authentication and edge security need hardening

- BFF auth and acting-role cookies use `secure=False` despite production HTTPS: `apps/bff-api/src/routes/auth.py:73-81,113-123`.
- No login rate limiter or lockout path was found.
- Backend user-create accepts an unconstrained password string: `auth-service/src/routers/auth.py:15-22`.
- Admin/Owner can assume any seeded role, even unassigned, under a “Local runtime compatibility” branch that is not environment-gated: `auth-service/src/routers/auth.py:171-196`.
- Caddy enables HSTS, nosniff, frame denial, and referrer policy, but no CSP/Permissions-Policy or edge rate limiting is configured.
- Public logs already show automated scanning for `/api/.env`.

**Required behavior:** Secure cookies in production, rate-limit auth, enforce a password policy, environment-gate development compatibility behavior, add security response headers appropriate to the app, and alarm on suspicious request patterns.

### 11. Backup runs, but recovery is not proven end to end

Positive controls verified:

- `hariom-backup.timer` is active.
- The scheduled backup service completed successfully.
- The archive contains all seven service database dumps plus checksums.
- Dump listings validated and the object exists in encrypted, versioned, public-blocked S3 storage with retention.
- EBS is encrypted and IMDSv2 is required.

Remaining gaps:

- No automated restore into a clean PostgreSQL environment was found.
- No alarm/notification proves operators will know when backup stops succeeding.
- The EC2 host and PostgreSQL are a single failure domain.
- The root data volume is configured `DeleteOnTermination: true` (`deploy/aws-ec2/infrastructure.yaml:138-144`) and no independent snapshot/AWS Backup policy was found.
- No centralized application log retention, CloudWatch host/container alarms, or synthetic route monitor was found. Docker logs rotate locally.

For this low-cost deployment, a single node is a reasonable budget decision only if S3 restore is routinely tested and failure is alerted.

### 12. Deploy and schema state are not fully reproducible

- `deploy/aws-ec2/` is currently untracked by Git.
- `hariom-erp/services/masterdata-service/src/main.py` has an uncommitted compatibility change.
- The first AWS cloud-init run ended in an error and deployment was manually recovered. The live stack works, but a clean rebuild has not been demonstrated from the current repository state.
- Several services rely on startup `metadata.create_all`/ad-hoc compatibility DDL while only parts of the stack use Alembic, increasing schema-drift risk.
- Base images use moving tags (`postgres:16-alpine`, `caddy:2-alpine`) instead of immutable digests.
- The public proxy does not expose a dependency-aware health endpoint; the app container health check probes only `/login` (`deploy/aws-ec2/docker-compose.yml:74-79`).

**Required behavior:** Commit/review infrastructure and production fixes, pin deploy artifacts, formalize migrations, and prove a clean replacement-host rebuild plus restore.

### 13. Responsive polish is incomplete

Authenticated browser checks at 390 px found:

| Route | Viewport | Document width | Result |
|---|---:|---:|---|
| Admin landing | 390 px | 429 px | Horizontal overflow |
| Owner landing | 390 px | 390 px | Pass |
| Sales orders | 390 px | 390 px | Pass |
| Planning board | 390 px | 390 px | Pass |
| Inventory stock control | 390 px | 606 px | Significant overflow |
| Purchase | 390 px | 780 px | Severe overflow/cropped forms |
| Reconciliation | 390 px | 390 px | Pass |
| Dispatch | 390 px | 390 px | Pass |

Desktop visual language is generally coherent and polished: navigation, cards, typography, empty states, and most reviewed page layouts are consistent. The mobile failures are localized but material for tablet/phone use on the shop floor.

### 14. Automated coverage misses the riskiest contracts

Passing verification:

- 151 backend tests: BFF 5, master 5, inventory 31, production 80, analytics 2, specification 28.
- 34 web tests.
- Web lint and TypeScript checks pass.
- Next.js production build compiles 101 pages.
- Web dependency audit reports zero known vulnerabilities.

Coverage gaps:

- No auth-service or sales-service tests were found.
- No test covers forged plant tokens or plant mutation authorization.
- Existing BFF contract tests did not detect the missing reservation routes.
- No full dispatch failure-injection test covers production → inventory → sales with the full role matrix and the actual frontend payload.
- No browser test covers Owner/Admin `ALL` scope on Purchase or workspace quick-action links.
- No restore drill test exists.
- Pydantic v2 deprecation warnings remain in service tests.

## End-to-end flow assessment

| Business flow | Assessment | Main remaining gate |
|---|---|---|
| Login and role workspace | Amber/Red | Core login works; plant admin authorization and acting-role behavior are unsafe |
| Master data and specifications | Green/Amber | Services and spec math tests pass; deploy compatibility change must be committed/rebuilt |
| Sales order → release → release lot | Amber | Code shape aligns with design; sales has no dedicated tests and no imported live transaction for read-only E2E proof |
| Purchase order → GRN → stock | Red | Default Owner/Admin page cannot read in `ALL` scope |
| Planning → job card → production stages | Amber/Green | Production suite is strong; live transactional proof is unavailable by migration design |
| QC/holds → reconciliation | Amber/Green | Unit coverage and routes pass; no live transaction was mutated during audit |
| Short close → carry-forward | Amber/Red | Orphan carry jobs have no repair worker/exception owner |
| Packing → dispatch → inventory → sales fulfillment | Red | Non-atomic cross-service write, role mismatch, missing client idempotency key |
| FG reservation → dispatch allocation | Red | Backend fragment exists but BFF/page/quick action are incomplete |
| Operational analytics | Red | Wrong internal sales URL and silent empty fallback |
| Owner decision dashboard | Red | Synthetic live-looking KPIs |
| Admin stack health | Red | Hardcoded telemetry and data-integrity claims |
| Scheduler | Green at snapshot | Processes active and scheduler route loads; should feed real health/alerts |
| Backup and recovery | Amber | Backup succeeds; restore and failure notification not proven |

## Live AWS snapshot

At the final verification snapshot:

- Application container: running and healthy.
- PostgreSQL container: running and healthy.
- Caddy: running and serving HTTPS.
- Host memory: 3.7 GiB total, 1.5 GiB used, 2.3 GiB available; 2 GiB swap essentially unused.
- Root disk: 38 GiB total, 11 GiB used, 28 GiB available (28%).
- Backup timer: active.
- Recent application-log sweep: no 500/traceback burst; observed errors were the known Purchase 400s, analytics internal 404s, expected authorization failures, and public scanner traffic.
- Transaction counts are intentionally empty after the master/user-only migration: active job cards 0, dispatches 0, backlog 0, inventory value 0, OTIF 0. Eight low-stock items are a consequence of master items existing without migrated stock balances.

This proves that the current node is healthy and lightly loaded. It does **not** prove business-flow correctness; that requires the acceptance gates below.

## Required closure plan

### Immediate release blockers

1. Mount one authenticated plant router, remove/bind the unprotected handlers, validate tokens in the BFF, and add negative auth tests.
2. Redesign dispatch sealing as an exactly-once recoverable workflow; align roles and send a stable idempotency key from the UI.
3. Fix Purchase plant-scope handling and remove stale “endpoint pending” messaging.
4. Complete or remove the reservations route/API/UI flow.
5. Correct analytics sales paths and distinguish upstream failure from empty data.
6. Remove all synthetic production KPIs and hardcoded system-health claims.
7. Replace placeholder dispatch legal data with controlled plant/company master fields.

### Next hardening pass

1. Add auth/sales tests, BFF route inventory tests, browser critical-path checks, and dispatch failure injection.
2. Add real readiness/telemetry, central alarms, backup-failure notification, and external synthetic probes.
3. Run and document a clean S3 restore drill and replacement-host rebuild.
4. Commit and review the AWS infrastructure and masterdata compatibility work; formalize schema migrations and pin images.
5. Close carry-forward orphan handling and mobile overflow defects.
6. Harden cookies, role assumption, login rate limits, passwords, and response policies.

## “Perfect/no gaps” acceptance checklist

The stack should receive a green sign-off only after all of these are evidenced:

- [ ] Forged/expired tokens receive 401 and non-admins receive 403 on every plant operation.
- [ ] Dispatch failure after each service boundary produces no lost or duplicate stock and converges exactly once on retry.
- [ ] Every role shown a dispatch action is authorized end to end, or is blocked before any write.
- [ ] Owner/Admin Purchase shows a plant selector or valid aggregate read—never two 400 chips.
- [ ] Reservation quick action, page, BFF, and inventory service complete one tested reserve/release/consume lifecycle.
- [ ] Seeded sales data appears in Customer 360 and lead-time reports with no internal 404.
- [ ] Owner and Admin dashboards show source timestamps and measured values; empty sources show no-data.
- [ ] Dispatch output contains verified legal/company/customer details from masters.
- [ ] Carry-forward allocation failure appears in a retryable, owned exception queue and cannot disappear.
- [ ] A clean database is restored from S3 and the restored stack passes smoke tests.
- [ ] CloudWatch/synthetic alarms fire for container failure, backup failure, disk pressure, and critical route failure.
- [ ] Critical pages fit a 390 px viewport without horizontal document overflow.
- [ ] Auth, sales, cross-service dispatch, and frontend/BFF contract tests are part of the release gate.
- [ ] The production host can be rebuilt from committed, reviewed, immutable deployment inputs.

## Review limitations

The audit was intentionally non-destructive. Because only master and user data were migrated, no production sales order, stock movement, dispatch, or approval record was created merely to prove the review. Those flows were assessed through code, contracts, automated tests, live read-only APIs, production logs, and UI navigation. A controlled staging dataset is still required for the final mutating end-to-end acceptance run.

## Final conclusion

The migration has produced a healthy, low-cost AWS runtime with a clean build, strong production/inventory/spec unit coverage, working TLS, and functioning scheduled backups. The product surface is broad and desktop presentation is mostly polished.

However, **the application is not yet gap-free**. The plant API bypass and dispatch partial-commit design are release blockers. Purchase scope, reservations, analytics contracts, synthetic dashboards, placeholder dispatch identity, recovery proof, and targeted responsive/security/test gaps must be closed before the stack can truthfully be signed off as fully production-safe.
