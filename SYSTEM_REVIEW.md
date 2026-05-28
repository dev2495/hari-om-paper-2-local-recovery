# Hari Om Paper 2 ERP — Full System Review

**Date:** 2026-05-28 (revised)
**Scope:** End-to-end audit of the codebase, business flows, UI surfaces, backend services, RBAC, observability, and master data. The goal is a candid map of *what's working*, *what's missing*, and *what's worth fixing next*, ranked by impact.

This review reads against the current `main`/local-working tree, not against any external roadmap doc.

**Out of scope (explicitly):** accounting / invoicing / GST tax engine / e-invoice IRN / payment receipts / credit notes / AR aging / TDS / TCS. Tally remains the system of record for the cash cycle. The ERP tracks **revenue** (dispatched value), **inventory cost** (stock value × rate), and **basic operating cost** (consumption × rate). No double-entry bookkeeping.

---

## 0. TL;DR

The ERP is **operationally complete for the make-and-ship loop**: customer master → sales order → planning → job-card execution → QC → FG inward → dispatch → reconciliation → reports. Clean code, well-typed, RBAC-gated; the recent reports + master + tolerance rebuilds turned the analytics + relationship + admin surfaces into proper cockpits.

The five biggest gaps that prevent the system from telling the truth about a real shift:

1. **Short-close + carry-forward not wired** — when 90,000 planned tubes finish as 50,000, the 40,000 gap silently goes nowhere. No reason captured, no top-up JC suggested.
2. **No downtime logging** — when 1 winder of 4 sits idle for a shift, the system shows reduced output but can't say *why*.
3. **Data-entry-lag invisibility** — supervisor enters Tuesday's Winder run on Wednesday morning. The reports plot it on Wednesday, the planner board shows the stage "RUNNING for 16 hours". No backdating UX, no late-entry surface.
4. **Audit coverage is fragmented** — only `production-service` writes audit rows. Sales, inventory, masterdata, spec mutations slip past silently.
5. **Automation is manual-only** — owner-pack email exists as an endpoint, but no scheduler fires it. Exception alerts are visual, not push.

Underneath those: **no shop-floor masters** (Employee, Shift, Holiday/Calendar, Reason Codes), which is what unlocks honest accounting of the four above.

The five empty service folders (`bom-service`, `mrp-service`, `planning-service`, `qc-service`, `dispatch-service`) are architectural dead weight — should be deleted.

**Recommended next-30-days punch list (in order):**
1. P1 → Reason Codes master (half a day) + shop-floor masters: Employee, Shift, Holiday (1 wk)
2. P1 → Short-close-with-reason + carry-forward JC (3–4 d)
3. P1 → Downtime event logging + reschedule-suggest on planner board (4–5 d)
4. P1 → Backdating UX + late-entry pill + books-guard on stage entries (3 d)
5. P1 → Audit coverage uplift across all mutation handlers (1–2 wk)
6. P1 → APScheduler + scheduled owner-pack delivery (3 d)
7. P2 → Delete empty service folders (1 h)
8. P3 → Mobile floor-entry expansion (3–4 d)

---

## 1. What's working well

| Area | Status |
| --- | --- |
| **Reports + Analytics surface** | Two cockpits (`/reports`, `/analytics`) with 7 detail pages, 6 deep-cut backend endpoints. All gated, no fake metrics. |
| **Vendor + Customer master** | Just rebuilt as relationship cockpits with multi-contact, primary promotion, drawer-with-tabs, modal create. |
| **Per-plant tolerances** | Backend table + plant-aware math + Owner/Admin-only UI editor at `/system/tolerances`. |
| **BFF books-guard** | Redis-backed cache with in-process fallback; protects against backdated **inventory** writes after monthly close. (Doesn't yet protect stage-entry — see §3.) |
| **Plant-scope enforcement** | BFF middleware validates `X-Plant-ID` against the JWT's allowed plants list. |
| **Owner-pack PDF** | 3-page premium layout (cover + KPI rail, variance waterfall with connectors, detail tables). |
| **QC hold gate** | Stage advancement rejects when an active QC hold exists (HTTP 409). |
| **Master/items canonical** | Single source for FG/RM SKUs with soft-delete + open-balance check. |
| **Reconciliation lifecycle** | Theoretical → ledger → actual is fully wired, with tolerance gating. Variance bridge is a real artifact. |
| **Audit centre** | `/system/audit` reads audit events with role-filtered access (but only the production-service writes to it — see §3). |

---

## 2. The five operational gaps (P1)

### 2.1 Short-close + carry-forward [**effort: 4 d**]

**Scenario:** Planner schedules 90,000 tubes across 3 job cards. Operators produce 50,000.

**Today:**
- Job-card close (`production-service/src/routers/jobs.py:504`) accepts `finished_weight` and posts FG inward. No `gap_qty`, no `short_close_reason`.
- A helper `_line_remaining_qty` (`planning.py:2326`) detects the gap and returns `{ suggested: true, remaining_qty: 40000 }` — but no UI surfaces this.
- SO line stays open at `remaining_qty=40000`. OTIF math marks it as a slip. Nobody is prompted.

**Should be:**
- Close dialog forces a reason code: `SHORT-RM`, `SHORT-QC`, `SHORT-BREAKDOWN`, `SHORT-PRIORITY`, `SHORT-SPEC-CHANGE`, `SHORT-MATERIAL-QUALITY`.
- Gap-decision UI: **Carry forward** (auto-create top-up JC) · **Short-close SO line** (Sales role only) · **Hold** (defer).
- Carry-forward JCs flagged on the planner board with a "Top-up of SO-1042" pill.
- Audit row captures `gap_qty`, `reason_code`, `decision`, `actor`. Now you can ask "where did our 40,000 tubes go this week?" with confidence.

### 2.2 Downtime event logging [**effort: 5 d**]

**Scenario:** Winder L4 doesn't run at all in Shift B. Other 3 winders produced ~36,700 of the planned 50,000 — gap of ~12,500.

**Today:**
- No `machine_downtime` table.
- Heatmap (`/deep/machine-utilization`) shows L4 column for that shift as empty cells — indistinguishable from "no shift was scheduled".
- Adherence KPI silently drops; reason is unknown.

**Should be:**
- `POST /production/downtime` with `machine_id`, `started_at`, `ended_at`, `reason_code`, `notes`.
- Planner board: one-click "Log downtime" chip per machine row. When logged on a machine with planned segments, prompts "Reschedule 12,500 tubes? Move / push to next shift / split".
- Heatmap distinguishes 3 states: `RUNNING` (cyan), `PLANNED DOWN` (slate stripe), `UNPLANNED DOWN` (rose stripe).
- Real Availability math = `run_time / (scheduled_time − planned_downtime)` instead of the dishonest `run_time / clock_time`.

### 2.3 Data-entry-lag handling [**effort: 3 d**]

**Scenario:** Tuesday's Shift B (14:00–22:00) Winder run gets entered Wednesday morning at 06:14 — 16 hours late.

**Today (verified in `planning.py:5919-5924`):**
- Schema *has* both `actual_start`/`actual_end` (work time) and `entered_at` (server `utcnow`).
- Stage entry form doesn't surface the date/shift picker — supervisor clicks Save, `actual_end` falls back to `now`.
- Consequence chain:
  - **Dispatch trend chart** plots the 12,400 tubes on Wednesday, not Tuesday.
  - **Planner board** shows the stage `RUNNING` for 16 hours straight.
  - **Inventory ledger postings** (reel issue, FG inward) stamp `created_at = now`, so RM consumption clock starts Wed even though reels were issued Tue.
  - **Books-locked guard** doesn't apply to stage entries — backdated writes into a closed month go through silently.
  - **OTIF math** can misread an on-time dispatch as a slip if the dispatch entry is delayed.
  - **Shift attribution** is NULL unless the form explicitly sends `shift_code`.
- No "data-entry lag" KPI exists anywhere.

**Should be:**
- Entry form pre-fills `actual_end = now`, `shift_code = current_shift`, but lets the user backdate. If `now − actual_end > 6h`, an inline warning appears with a shift selector.
- Books-locked guard fires on `actual_end`, not on `entered_at`. Same 422 `BOOKS_LOCKED` shape.
- Downstream ledger postings stamp `effective_date = actual_end.date()`. The schema already has `effective_date` on most ledger tables — pass-through fix.
- "Late entry" pill on the planner board for any stage with `entered_at − actual_end > 6h`.
- New `data_entry_lag` KPI on Operations Command report: median + p90 of `entered_at − actual_end` over the window.
- Audit event captures `subject_event_at` (the work-time the row claims to be for) alongside the existing `created_at`.

### 2.4 Audit coverage [**effort: 1–2 wk**]

**Scenario:** "Who deactivated this customer?" "Who released this PO line after Apr was locked?"

**Today:** only `production-service/src/routers/quality.py` and `planning.py` call `_record_audit_event`. The other services (sales, inventory, masterdata, spec, analytics) mutate state without writing to `audit_events`. `/system/audit` shows a partial timeline.

**Should be:** a shared `record_audit_event(actor_id, plant_id, event_type, target_id, before, after, source)` helper, wired into every mutation handler (~25 sites). Backfill isn't possible but going forward is enough.

### 2.5 Scheduled delivery [**effort: 3 d**]

**Today:** `POST /reports/owner-pack/send-daily` works. **Nothing fires it.** No APScheduler / Celery / cron / GitHub Action / Railway scheduler. Exception alerts on `/reports/exceptions` are visual-only.

**Should be:**
- APScheduler in analytics-service with a `cron_jobs` table (last-run, next-run, status, recipients).
- Owner-pack 06:30 daily, exceptions hourly, weekly board pack Sun 18:00, monthly close reminder.
- A panel on `/system` showing scheduled-job health: "Last sent 06:32 today ✓".

---

## 3. Shop-floor masters (P1 prerequisite)

Both §2.1, §2.2, and §2.3 above depend on real masters that don't exist today. Without them, the fixes are unstable.

| Master | Why | Effort |
| --- | --- | --- |
| **Employee** | `operator_name` is a free-text 100-char string (`production-service/src/models.py:41`). "Rajesh"/"rajesh"/"R Kumar" all become different operators. Per-operator metrics are unreliable. | 1 d |
| **Shift definition** | Today the planner board, heatmap, and adherence math hardcode shift structure. Per-plant shift rosters are implicit Python constants. Night-premium / OEE Availability / "show me Sat night staff" all need this. | 1 d |
| **Holiday / Plant Calendar** | OTIF currently punishes Diwali deliveries; anomaly band falsely alerts on planned holidays; maintenance days greyed-out doesn't work. | 1 d |
| **Reason codes** | Scrap reasons today are free-text → unusable Pareto. Downtime reasons don't exist. Short-close reasons don't exist. All three need this master. | 0.5 d |

Plus a migration to move `operator_name` (string) to `operator_id` (FK), keeping the string as a denormalized cache for legacy callers. ~2 days.

**Total: ~1 week** for all four masters + the operator migration.

---

## 4. P2 / P3 items

### 4.1 Five empty service folders [**effort: 1 h**]
`bom-service`, `mrp-service`, `planning-service`, `qc-service`, `dispatch-service` are README-only / stubs. Their domains live elsewhere. Delete them.

### 4.2 Master delete leaves orphans [**effort: 1 d**]
Customer/spec/mandrel/paper deactivation has no in-use FK check. Add 409-on-conflict pre-check.

### 4.3 CSV import [**effort: 2 d**]
Export ships; import wiring is the follow-up. Plant onboarding currently means typing every row.

### 4.4 Mobile floor-entry expansion [**effort: 3–4 d**]
Stage output entry is mobile-optimized. Reel inward scan / FG count / breakdown logging / QC reject capture all desktop-only today.

### 4.5 Notification push [**effort: 2 d**]
Notifications are poll-only. Add SSE endpoint; existing notification dropdown subscribes.

### 4.6 9 older report/analytics pages [**effort: 1 wk**]
`/reports/{dispatch,exceptions,loss,plants,production}` + `/analytics/{quality,dispatch,inventory,production}` still use the older `ReportDetailPage` shell. Port to the cockpit shell for visual consistency.

---

## 5. Cross-cutting infrastructure

| Concern | State | Gap |
| --- | --- | --- |
| Authn | JWT (HS256), 12-hour expiry | OK |
| Authz / RBAC | `<RoleGate>` on UI, `require_role` on backend, `apply_plant_scope` on queries | OK |
| Plant scope | BFF middleware validates `X-Plant-ID` | OK |
| Books-locked guard (inventory) | Redis + in-process fallback, fail-closed | OK |
| Books-locked guard (stage entries) | **Not wired** | P1 — see §2.3 |
| QC hold gate | HTTP 409 on stage advance | OK |
| Audit | Partial (production-service only) | P1 — see §2.4 |
| Email scheduling | Owner-pack send works manually | P1 — no scheduler (§2.5) |
| Notifications | Poll-only | P3 — add SSE |
| Logging | `logger` used in 7+ services | OK; no structured aggregation |
| Observability | No Datadog / Sentry / OTLP wiring | P3 — pick one when scaling |
| Tests | 3 frontend + 16 backend test files | Light. Critical math (consumption, reconciliation, spec) covered; flows not. |
| Migrations | Alembic + `_ensure_schema_compatibility` bootstrap | Mixed but works. |
| Currency | INR hardcoded | OK (single market by design) |

---

## 6. Backend service inventory

| Service | Status | LOC | Endpoints | Notes |
| --- | --- | --- | --- | --- |
| auth-service | Live | 2,370 | 6 routers | JWT, users, roles, plants, audit, notifications |
| masterdata-service | Live | 4,358 | 13 routers | All masters; well-developed |
| sales-service | Live | 1,368 | 1 router · 12 endpoints | Lean |
| spec-service | Live | 3,235 | (many) | Spec sheets, BOM, recipe cascade |
| production-service | Live | 11,853 | 7 routers · 52 endpoints | The monolith — does planning + jobs + QC + reconciliation + reel-issue |
| inventory-service | Live | 6,754 | 16 routers · ~55 endpoints | Items, ledger, balances, reels, locations |
| analytics-service | Live | 4,370 | 7 routers · ~30 endpoints | Dashboard + reports + deep-cuts + PDF |
| bom-service | **Empty** | 0 | — | README only — delete |
| mrp-service | **Empty** | 0 | — | README only — delete |
| planning-service | **Empty** | 0 | — | README only — delete |
| qc-service | **Empty** | 0 | — | README only — delete |
| dispatch-service | **Stub** | ~50 | 0 | Config + utils + service client only — delete |

The production-service is a monolith of ~12k LOC. Not yet at "must split" weight, but worth watching. The planning + QC + reconciliation responsibilities will eventually want to peel off into their own services — at which point those empty folders may come back. For now, dead weight.

---

## 7. Frontend route inventory

The dashboard has ~80 routes. Of those:

- **45 real pages** with 100+ lines of substantive UI.
- **15 thin shells** (≤15 lines) that delegate to a component (`SpecSheetDocument`, `SalesOrderCreateForm`, `ReportDetailPage`). Correctly small — presentational shells.
- **12 redirect-only** stubs (e.g. `/dispatch` → `/logistics/dispatch`). URL-stability aliases.
- **6 alias re-exports** (`/master/vendors` → `/master/suppliers/page`).

**Truly broken stubs:** zero. Every nav-reachable page has content.

### Routes that are great
`/reports/{owner,operations,inventory,sales,customer-360,variance}`, `/analytics`, `/master/{vendors,suppliers,customers}`, `/system/tolerances`, `/inventory/{lifecycle,genealogy,stock-control}`, `/production/reconciliation`, `/planning/board`.

### Routes that still feel weak
`/reports/{dispatch,exceptions,loss,plants,production}` and `/analytics/{quality,dispatch,inventory,production}` use the older `ReportDetailPage` shell. They work; they just look different. Worth porting to the cockpit shell.

---

## 8. Business-flow walkthrough

Tracing one real "customer → ship" cycle through the system, marking what works ✅ and what's broken ❌:

```
Customer (master)                   ✅ create / edit / multi-contact / GST captured
Customer 360 risk feed              ✅ wired
Sales order — create                ✅ /sales-orders/new
Sales order — line items, spec link ✅ approved_spec_id wired
Approve                             ✅ /api/sales/orders/{id}/approve
Release                             ✅ release-sync → job cards
Books-locked guard (dated writes)   ✅ HTTP 422 on backdated inventory mutations
Books-locked guard (stage entries)  ❌ NOT enforced — see §2.3
Job cards — planner board           ✅ /planning/board
Stage execution (winder/oven/...)   ✅ desktop + mobile entry
Backdated stage entry handling      ❌ silent — see §2.3
QC hold (active blocks advance)     ✅ HTTP 409 gate
Short-close with reason             ❌ silent — see §2.1
Carry-forward of unmade qty         ❌ helper exists, no UI — see §2.1
Downtime logging                    ❌ no table, no UI — see §2.2
FG inward                           ✅ /inventory/fg-inward
Dispatch validation                 ✅ /api/sales/orders/lines/{id}/validate-dispatch
Dispatch record                     ✅ /api/sales/orders/lines/{id}/record-dispatch
Reconciliation (period close)       ✅ theoretical → ledger → actual
Owner daily pack PDF                ✅ generates; manual trigger only
Owner pack email                    ✅ wired; not scheduled — see §2.5
Audit trail                         🟡 partial (production-service only) — see §2.4
```

**Out of scope by explicit decision (Tally handles these):**
- Invoice / e-way bill / IRN
- Payment receipt
- AR aging
- Credit note / TDS / TCS
- Returns / replacements (separate decision needed)

---

## 9. Recommended sequence

1. **Day 1 morning** — delete the 5 empty service folders.
2. **Day 1–7** — build the 4 shop-floor masters (Employee, Shift, Holiday, Reason). Use the cockpit primitives we just shipped — it's another cockpit per master.
3. **Day 8–12** — short-close + carry-forward flow on job-card close. Uses Reason Codes from step 2.
4. **Day 13–17** — downtime event logging + reschedule-suggest on planner board. Uses Machines + Reason Codes.
5. **Day 18–20** — data-entry-lag handling: backdating UX + books-guard on stage entries + late-entry pill. Uses Shift Definitions.
6. **Day 21–32** — audit coverage uplift across the remaining ~25 mutation handlers.
7. **Day 33–35** — APScheduler + scheduled owner-pack delivery + status panel.

After this 5-week block, the system goes from "operationally complete" to "operationally honest" — every shift, every downtime, every short-close has a clean audit story behind it.

---

## 10. Out of scope for this review

- Performance / load testing.
- Security deep audit (TLS, secret storage, rate-limiting, SQL injection surface).
- Backup / DR posture.
- Data migration tooling (legacy Tally / Excel imports).
- Mobile native app.
- Customer-facing portal.

Each is its own review.

---

## Appendix · Evidence files

| Finding | File / line |
| --- | --- |
| Stage entry captures both timestamps but doesn't validate | `hariom-erp/services/production-service/src/routers/planning.py:5919-5924` |
| Remainder-qty helper exists but no UI | `hariom-erp/services/production-service/src/routers/planning.py:2326-2347` |
| Job-card close has no gap reason | `hariom-erp/services/production-service/src/routers/jobs.py:504` |
| Audit only in production | `hariom-erp/services/production-service/src/routers/quality.py:66` only call site of `_record_audit_event` outside planning |
| No scheduler | grep `APScheduler\|BackgroundScheduler\|crontab` in `hariom-erp/services/` returns nothing |
| Owner pack endpoint | `hariom-erp/services/analytics-service/src/routers/reports.py:791` |
| Operator as string | `hariom-erp/services/production-service/src/models.py:41` |
| Empty services | `hariom-erp/services/{bom,mrp,planning,qc}-service/` — README only |
| Dispatch service stub | `hariom-erp/services/dispatch-service/src/` — no routers/main.py |
| Masters in scope | `hariom-erp/services/masterdata-service/src/models.py` — no Employee / Shift / Holiday / Reason |
| Plant-scope guard | `apps/bff-api/src/main.py:47` |
| Books-guard | `apps/bff-api/src/services/books_guard.py` |
