# Hari Om Paper 2 ERP — Full System Review

**Date:** 2026-05-28
**Scope:** End-to-end audit of the codebase, business flows, UI surfaces, backend services, RBAC, observability, and master data. The goal is a candid map of *what's working*, *what's missing*, and *what's worth fixing next*, ranked by impact.

This review reads against the current `main`/local-working tree, not against any external roadmap doc.

---

## 0. TL;DR

The ERP is **operationally complete for the make-and-ship loop**: customer master → sales order → planning → job-card execution → QC → FG inward → dispatch → reconciliation → reports. It's clean code, well-typed, RBAC-gated, and the recent reports + master redesigns turned the analytics + relationship surfaces into proper cockpits.

It is **commercially incomplete**: the moment a kilogram of paper leaves the gate, the system stops talking. There's no invoice, no GST split, no payment receipt, no credit-note, no AR aging. The dispatch event is recorded, but the cash side of the cycle is entirely outside the app.

It is also **silently incomplete in three operational dimensions**:
1. **Audit coverage** — only `production-service` writes audit rows. Sales, inventory, masterdata, spec mutations slip past.
2. **Automation** — the daily owner pack exists as an endpoint, but nothing fires it. No scheduler in the repo.
3. **Floor reality** — there's no `Employee`, no `ShiftDefinition`, no `Holiday`/calendar, no downtime reason codes. The whole production layer treats operators as free-text strings.

These three together are the **biggest gap between "running" and "production-grade"**. The audit gap is also a compliance risk.

The five empty service folders (`bom-service`, `mrp-service`, `planning-service`, `qc-service`, `dispatch-service`) are architectural dead weight — should be either deleted or quarantined.

**Recommended next-90-days punch list:**
- P1 → Audit coverage uplift (1–2 wk)
- P1 → Scheduler + scheduled report delivery (3–5 d)
- P1 → Shop-floor masters: Employee, Shift, Holiday, Reason codes (1 wk)
- P2 → Invoice + GST + payment + AR aging (4–8 wk) — the entire commercial cycle
- P2 → Service consolidation (delete empty stubs, 1 h)
- P3 → Mobile floor-entry expansion (3–4 d)

---

## 1. What's working well

It's worth grounding the critique in what's already healthy:

| Area | Status |
| --- | --- |
| **Reports + Analytics surface** | Two cockpits (`/reports`, `/analytics`) with 7 detail pages, 6 deep-cut backend endpoints. All gated, no fake metrics. |
| **Vendor + Customer master** | Just rebuilt as relationship cockpits with multi-contact, primary promotion, drawer-with-tabs, modal create. |
| **Per-plant tolerances** | Backend table + plant-aware math + Owner/Admin-only UI editor at `/system/tolerances`. |
| **BFF books-guard** | Redis-backed cache with in-process fallback; protects against backdated writes after monthly close. |
| **Plant-scope enforcement** | BFF middleware validates `X-Plant-ID` against the JWT's allowed plants list. Non-owner cross-plant attempts get 403. |
| **Owner-pack PDF** | 3-page premium layout (cover + KPI rail, variance waterfall with connectors, detail tables). |
| **QC hold gate** | Stage advancement rejects when an active QC hold exists (HTTP 409). |
| **JWT claims** | Roles, permissions, plant_id, allowed_plants, is_owner_all_plants all in the token. |
| **Master/items canonical** | Single source for FG/RM SKUs with soft-delete + open-balance check. |
| **Reconciliation lifecycle** | Theoretical → ledger → actual is fully wired, with tolerance gating. Variance bridge is a real artifact. |
| **Audit centre** | `/system/audit` reads audit events with role-filtered access. |

The codebase is also **internally consistent on the recent work** — the cockpit shell idiom (Hero + KPI strip + filter spine + grid + drawer) is reused between reports, master, and tolerance pages, so adding a new admin surface is now ~1 day of work, not 1 week.

---

## 2. What's missing — ranked by impact

### 2.1 P1 · Order-to-Cash dead-ends at "dispatch recorded" [**effort: L**]

The cycle today:

```
Customer creates SO → Approve → Release → Job-card → Produced → FG inward → Dispatch recorded → STOP
```

What's missing on the right side of STOP:

- **No invoice generation.** `record_dispatch_for_line` (`sales-service/src/routers/sales_orders.py:841`) writes a `SalesOrderDispatchLog` row and returns 200. No invoice number, no tax breakup, no PDF.
- **No GST engine.** `gst_no` is only a string column on customer/supplier masters. There's no rate table, no HSN code on items, no CGST/SGST/IGST split logic, no place-of-supply handling.
- **No e-invoice IRN adapter.** Mandatory for Indian B2B above the threshold.
- **No customer acknowledgment loop.** There's no surface where the customer sees their delivery note, signs off, or raises a claim.
- **No payment-received flow.** No payment entries, no allocations, no part-payment.
- **No AR aging report.** `/reports/customer-360` shows "open value" (which is `open_value` on the SO), but it doesn't roll up unpaid invoices over 0-30/31-60/61-90/>90 buckets because invoices don't exist.

**Why it matters:** the owner currently has to use a separate accounting tool (Tally, Excel) for the entire commercial side. The ERP is operationally a manufacturing system, not a business system.

**Recommended scope when this is tackled:**

1. `invoice`, `invoice_line`, `payment_receipt`, `credit_note` tables in a new `commerce-service` (or expand `sales-service`).
2. HSN code on `Item`, GST-rate table per HSN, place-of-supply derivation from customer's GSTIN.
3. Invoice PDF template (mirror the owner-pack ReportLab pattern).
4. AR aging report at `/reports/ar-aging` using existing report primitives.
5. e-invoice JSON producer (external IRN service is a separate integration).

### 2.2 P1 · Audit coverage is fragmented [**effort: M**]

The `/system/audit` page reads from `auth-service.audit_events`, but only **`production-service` writes to it**:

- `production-service/src/routers/quality.py` (QC holds)
- `production-service/src/routers/planning.py` (releases, sync)

No audit row is written when:

- A sales order is created / approved / released / line-released / dispatch-recorded
- An item is created / updated / soft-deleted
- A customer / supplier / contact is created / updated / deactivated
- An inventory ledger entry posts (inward, issue, manual, FG inward)
- A reel is created or issued
- A spec is created / revised / archived
- A tolerance is updated (just shipped — already a write surface)
- A user is created / role-changed / disabled (auth-service has its own pattern but doesn't go through audit_events)

**Why it matters:** "who deactivated this customer?" "who pushed this PO line through after Apr was locked?" The system can't answer either question today.

**Fix shape:**

- A shared `record_audit_event(actor_id, plant_id, event_type, target_id, before, after, source)` helper exported from `auth-service` or a tiny library.
- Wire it into every mutation handler (~25 sites). Mostly mechanical.
- Backfill: the bootstrap migration is already additive; no historical data is reconstructible, but going forward is enough.

### 2.3 P1 · "Scheduled" delivery is manual-only [**effort: S**]

The daily owner-pack endpoint exists at `POST /reports/owner-pack/send-daily`. The send logic in `analytics-service/src/daily_owner_pack.py` is real. **Nothing fires it.**

There's no:
- APScheduler / Celery / cron worker in any service.
- GitHub Action / Railway scheduled job in the repo.
- Status panel showing "last sent at 06:32 yesterday".
- Retry policy for delivery failures.

The same gap applies to exception alerts: `/reports/exceptions` and the anomaly band on `/analytics` are **visual surfaces** — they don't trigger an email, a Slack ping, or a webhook.

**Fix shape:**

- Add APScheduler to analytics-service. One cron job per scheduled artifact (owner pack 06:30, exceptions hourly, weekly board pack Sun 18:00, monthly close reminder).
- Persist a `cron_jobs` table with last-run / next-run / status, so `/system/audit` can show "did the morning pack go out?"
- Add a one-line "Last sent / next at" pill to the report tiles on `/reports`.

### 2.4 P1 · Shop-floor masters are missing [**effort: M**]

The production schema treats operators as free-text:

```python
# production-service/src/models.py:41
operator_name = Column(String(100), nullable=True)
```

No FK. No `Employee` table. No skill matrix. No shift roster. The `scheduled_stages` set in `planning.py:3425` is a hard-coded Python constant, not a master row.

**Consequences this causes today:**

- "Who's working Tuesday night?" — system doesn't know.
- "Show me my best winder operator this month" — you can group by the free-text string, but typos and aliases ruin the rollup.
- "How many shifts did the plant lose to public holidays?" — unanswerable without a `Holiday` master.
- "Why did Winder L2 stop for 3 hours?" — there's no `DowntimeReason` master and no entry point for the supervisor to log it.

**Fix shape:**

| Master | Use |
| --- | --- |
| `employee` | id, name, code, role, skills, active_shifts, plant_id |
| `shift_definition` | name, start_time, end_time, hours, is_night, plant_id |
| `holiday` / `plant_calendar` | date, plant_id, type (public/plant/maintenance), description |
| `reason_code` | code, label, category (downtime/scrap/quality/QC-reason), severity |

Once these exist, the existing `operator_name` string can be migrated to `operator_id` over a couple of weeks; the per-operator productivity panel I built on `/reports/operations` becomes real (today it's derived from blocked-job rows, which is a hack).

### 2.5 P2 · Master delete leaves orphans [**effort: S**]

Customer deactivation works — `customer.py:339-356` sets `active = False`. **But:**

- No in-use check before deactivation. If the customer has open SOs, the deactivation goes through silently and the SO list still shows them as if they were active.
- `spec` deactivation has no FK check against `sales_order_lines.approved_spec_id` (existing lines still reference an archived spec).
- `mandrel` / `paper` / `parchment` deactivation has no FK against `Item.bom_snapshot` references.

**Fix shape:** add a 409-on-conflict pre-check to each deactivate endpoint, listing the FK-holding rows. The user either reassigns first or sees the conflict.

### 2.6 P2 · Five empty service folders [**effort: S**]

`bom-service`, `mrp-service`, `planning-service`, `qc-service` are README-only. `dispatch-service` has config + utils + service client but no main, no routers, no models. The real implementations live in `production-service` (BOM, planning, QC) and `sales-service` + `inventory-service` (dispatch).

**Fix shape (pick one):**

- **Delete them.** Net loss: 5 READMEs. The architectural confusion they cause for any new dev far outweighs.
- **Quarantine under `services/_planned/`** with a single ROADMAP.md explaining "future split of production-service into BOM + MRP + QC + planning".

I'd just delete. The fact that production-service runs to ~12k LOC suggests the split isn't actually planned.

### 2.7 P2 · No CSV import (only export) [**effort: S**]

Vendor/customer cockpits ship export-CSV but not import. The mockup showed a CSV-import modal with per-row validation; the wiring is the follow-up. Onboarding a new plant means typing every row.

**Fix shape:** `POST /api/master/vendors/import` accepting multipart CSV, dry-run mode, returns per-row validation report. Wire to the existing modal in the cockpit.

### 2.8 P3 · Mobile floor-entry is single-purpose [**effort: M**]

`/production/entry/[jobCardId]` is a touch-optimized stage entry. Good. But:

- No mobile RM inward (storeman scanning reels at the dock).
- No mobile FG inward count.
- No supervisor exception flag from the floor.
- No breakdown logging from the operator's phone.
- No QC reject capture in the moment.

Operators have to use the desktop layout for everything except stage output entry. The backend already supports each of these; it's pure UI work.

### 2.9 P3 · Notifications UI exists, no in-app push [**effort: S**]

`auth-service/notifications.py` returns paginated notifications, the UI shows them, but they're poll-only — there's no WebSocket, no SSE, no FCM. A blocked job card sits there until you refresh.

**Fix shape:** SSE endpoint on auth-service (single connection per session), the existing notification dropdown subscribes. Backend writes during mutations (overlap with the audit fix above).

### 2.10 P3 · No bulk delete, no row-level history, no inline-cell edit [**effort: S each**]

The cockpit grid supports multi-select bulk activate/deactivate but not bulk delete (deactivate covers most cases). There's no per-row "history" tab — you have to go to `/system/audit` and filter manually. No inline-cell edit; everything requires opening the drawer or modal. These are polish wins that compound over hundreds of daily ops.

---

## 3. Backend service inventory

| Service | Status | LOC | Endpoints | Notes |
| --- | --- | --- | --- | --- |
| auth-service | Live | 2,370 | 6 routers | JWT, users, roles, plants, audit, notifications |
| masterdata-service | Live | 4,358 | 13 routers | All masters; well-developed |
| sales-service | Live | 1,368 | 1 router · 12 endpoints | Lean; could absorb dispatch + invoice |
| spec-service | Live | 3,235 | (many) | Spec sheets, BOM, recipe cascade |
| production-service | Live | 11,853 | 7 routers · 52 endpoints | The monolith; planning + jobs + QC + reconciliation + reel-issue |
| inventory-service | Live | 6,754 | 16 routers · ~55 endpoints | Items, ledger, balances, reels, locations |
| analytics-service | Live | 4,370 | 7 routers · ~30 endpoints | Dashboard + reports + deep-cuts + PDF |
| bom-service | **Empty** | 0 | — | README only — delete or quarantine |
| mrp-service | **Empty** | 0 | — | README only |
| planning-service | **Empty** | 0 | — | README only |
| qc-service | **Empty** | 0 | — | README only |
| dispatch-service | **Stub** | ~50 | 0 | Config + utils + service client only |

**Observation:** the production-service is doing a lot. It's not yet at "must split" weight (12k LOC is manageable), but the planning + QC + reconciliation responsibilities will eventually want to peel off. Worth keeping an eye on.

---

## 4. Frontend route inventory

The dashboard has ~80 routes. Of those:

- **45 real pages** with 100+ lines of substantive UI.
- **15 thin shells** (≤15 lines) that delegate to a component (`SpecSheetDocument`, `SalesOrderCreateForm`, `ReportDetailPage`). These are *correctly* small — they're presentational shells.
- **12 redirect-only** stubs (e.g. `/dispatch` → `/logistics/dispatch`, `/control-tower` → `/analytics/dashboard`, `/masters/papers` → `/master/papers`). These are URL-stability aliases. Could be consolidated but not broken.
- **6 alias re-exports** (`/master/vendors` → `/master/suppliers/page`). Also fine.

**Truly stub** (a redirect with no content where there should be content): **zero**. Every nav-reachable page has some content. The post-redesign cleanup landed.

### Routes that still feel weak

- `/reports/dispatch`, `/reports/exceptions`, `/reports/loss`, `/reports/plants`, `/reports/production`, `/analytics/quality`, `/analytics/dispatch`, `/analytics/inventory`, `/analytics/production`. These all use the older `ReportDetailPage` shell with real data, but they predate the cockpit-primitives rebuild. They work; they just look different from the new pages. Worth porting to the cockpit shell in a separate pass.

### Routes that are great

- `/reports/{owner,operations,inventory,sales,customer-360,variance}` — all cockpit-grade.
- `/analytics` — anomaly band + KPI rail + exception streams.
- `/master/{vendors,suppliers,customers}` — just shipped.
- `/system/tolerances` — properly gated editor.
- `/inventory/lifecycle`, `/inventory/genealogy`, `/inventory/stock-control` — substantial, audit-grade pages.

---

## 5. Cross-cutting infra

| Concern | State | Gap |
| --- | --- | --- |
| Authn | JWT (HS256), 12-hour expiry | OK |
| Authz / RBAC | `<RoleGate>` on UI, `require_role` on backend, `apply_plant_scope` on queries | OK; double-check write surfaces that don't open in the cockpit |
| Plant scope | BFF middleware validates `X-Plant-ID` | OK |
| Books-locked guard | Redis + in-process fallback, fail-closed | OK (just shipped) |
| QC hold gate | HTTP 409 on stage advance | OK |
| Audit | Partial (production-service only) | **P1 — fix coverage** |
| Email | Owner-pack send works manually | **P1 — no scheduler** |
| Notifications | Poll-only | P3 — add SSE |
| Logging | `logger` used in 7+ services | OK; no structured log aggregation though |
| Observability | No Datadog / Sentry / OTLP wiring in the repo | P3 — pick one when scaling |
| Tests | 3 frontend + 16 backend test files | Light. Critical math (consumption, reconciliation, spec) is covered; flows are not. |
| Migrations | Alembic where present + `_ensure_schema_compatibility` bootstrap patterns | Mixed but works. Consider unifying on Alembic across all services. |
| Multi-tenant | Plant scope only | No org/tenant layer; one-Hari-Om-only by design |
| Currency | INR hardcoded | OK (single market) |
| Locale / i18n | English only | OK (single market) |

---

## 6. Business-flow walkthrough

Tracing one real "customer → cash" cycle through the system, marking what works ✅ and what's missing ❌:

```
Customer (master)                   ✅ create / edit / multi-contact / GST captured
Customer 360 risk feed              ✅ wired
Sales order — create                ✅ /sales-orders/new
Sales order — line items, spec link ✅ approved_spec_id wired
Approve                             ✅ /api/sales/orders/{id}/approve
Release                             ✅ release-sync → job cards
Books-locked guard on dated writes  ✅ HTTP 422 if backdated
Job cards — planner board           ✅ /planning/board
Stage execution (winder/oven/...)   ✅ desktop + mobile entry
QC hold (active blocks advance)     ✅ HTTP 409 gate
FG inward                           ✅ /inventory/fg-inward
Dispatch validation                 ✅ /api/sales/orders/lines/{id}/validate-dispatch
Dispatch record                     ✅ /api/sales/orders/lines/{id}/record-dispatch
Reconciliation (period close)       ✅ theoretical → ledger → actual
Owner daily pack PDF                ✅ generates; manual trigger only
Owner pack email                    ✅ wired; not scheduled
                                    ❌ INVOICE — no entity, no PDF, no IRN
                                    ❌ E-WAY BILL — not generated
                                    ❌ PAYMENT RECEIPT — no entity
                                    ❌ CUSTOMER ACKNOWLEDGMENT — no surface
                                    ❌ AR AGING — depends on invoices
                                    ❌ RETURN / REPLACEMENT — no flow
                                    ❌ CREDIT NOTE — no entity
                                    ❌ TDS / TCS — no engine
                                    ❌ SO AMENDMENT — design pending (deferred)
```

The left side is mature. The right side is wholly absent. That asymmetry is the headline finding.

---

## 7. Decisions I'd take now

1. **Delete the empty service folders** today. 5-minute cleanup, removes a confusing tile from the architecture diagram.
2. **Stand up audit coverage** as a focused 1-2 week sprint. It's purely additive, ships value across compliance + ops, and unblocks meaningful "who did what" answers everywhere.
3. **Add APScheduler** to analytics-service. Single dependency, single jobs table, status panel. The owner gets the daily email she's been promised.
4. **Build the shop-floor masters** before any further OEE work. Otherwise every per-operator metric stays statistically meaningless.
5. **Start the commerce track** (invoice + GST + payment) as the next big block. This is what turns the ERP from "MES that pretends to run a business" into "system that the business runs from".

---

## 8. Out of scope for this review

- Performance / load testing.
- Security audit beyond RBAC topology (no review of TLS termination, secret storage, rate-limiting, SQL-injection surface analysis).
- Backup / DR posture.
- Data migration tooling (legacy Tally / Excel imports).
- Mobile native app (separate effort entirely).
- Customer-facing portal.

Each of these is its own review. The current document focuses on **what the codebase says it can do today, and where it falls short of a credible end-to-end ERP**.

---

## Appendix · Evidence files

| Finding | File / line |
| --- | --- |
| No invoice / payment | `hariom-erp/services/sales-service/src/routers/sales_orders.py:841` (dispatch logged and stops) |
| Audit only in production | `hariom-erp/services/production-service/src/routers/quality.py:66` is the only call site of `_record_audit_event` |
| No scheduler | grep `APScheduler\|BackgroundScheduler\|crontab` in `hariom-erp/services/` returns nothing |
| Owner pack endpoint | `hariom-erp/services/analytics-service/src/routers/reports.py:791` |
| Operator as string | `hariom-erp/services/production-service/src/models.py:41` |
| Empty services | `hariom-erp/services/{bom,mrp,planning,qc}-service/` — README only |
| Dispatch service stub | `hariom-erp/services/dispatch-service/src/` — no routers/main.py |
| Masters in scope | `hariom-erp/services/masterdata-service/src/models.py` — no Employee / Shift / Holiday / Reason |
| Plant-scope guard | `apps/bff-api/src/main.py:47` |
| Books-guard | `apps/bff-api/src/services/books_guard.py` |
