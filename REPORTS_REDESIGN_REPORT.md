# Reports & Analytics Suite — Redesign Report

_Hari Om Paper 2 ERP · Generated 2026-05-25 · historical design plan._

> Current implementation evidence now lives in `REPORTS_SUITE_COMPLETION_REPORT.md`. This file is retained as the original design critique and roadmap, not as current go-live status.

---

## 0. TL;DR

The current `/reports/*` and `/analytics/*` surfaces are **mostly empty stubs** (10 of 17 pages are < 10 lines) and the few real pages are KPI-only without drill paths. We rebuild them as **a single unified Reports & Analytics Suite** with:

- **One bookmarkable hub** (`/reports`) listing every report in a clean, role-tagged grid.
- **12 deep reports**, organized by audience: Executive · Operations · Commercial · Inventory · Quality · Dispatch · Finance-ready.
- **A shared spine**: hero, filter bar with saved-views, KPI strip with sparklines + deltas, drill-down on every chart, export + email-on-schedule, books-locked posture, plant scope.
- **9 reusable chart primitives** beyond what we have today: waterfall, funnel, calendar heatmap, location heatmap, Pareto bar, donut with center stat, mini-ladder, scatter-quadrant, lead-time anatomy.
- **6 screenshot-grade HTML mockups** at `mockups/reports-suite/` showing the end state for the most-used reports.

The redesign reuses the existing data hooks (`useOwnerPack`, `useDashboardOverview`, `useSalesReport`, `useExceptionReport`, etc.) — **no new backend** is required for Phase 1. Phase 2 adds 4 new endpoints to fill data gaps (margin, customer cohort, lead-time anatomy, scrap-cost ladder).

---

## 1. Critique of the current state

### 1.1 Inventory

| Surface | Pages with real content | Pages that are stubs / re-exports | Notes |
|---|---:|---:|---|
| `/reports/*` | 1 (owner, 30 lines) | 8 of 9 (7 lines each) | Mostly 7-line passthrough shells |
| `/analytics/*` | 7 (165, 117, 67, 301, 96, 130, …) | 6 of 13 stubs | Dashboard + MRP + sales are the only deep pages |
| `/analytics-*` (top-level) | 0 | 4 (5 lines each) | Legacy redirects to `/analytics/*` — should be deleted |

### 1.2 What's broken

1. **No clear hub.** `/reports/page.tsx` is a card grid that links to 5 reports; `/analytics/page.tsx` redirects to a single dashboard. There are two front doors and neither lists everything.
2. **10+ pages are 7-line shells** that just re-export a thin component or import a stub. They render but show almost no information.
3. **Sales analytics is one of the deepest** at 130 lines — and even that uses MetricCard / ChartPanel from the OLD design system, while `/analytics/dashboard` uses the NEW one (KpiCard / ChartCard). Two different design systems are live simultaneously.
4. **No drill-down.** Every chart is a dead-end. Clicking a customer-revenue bar doesn't open that customer; clicking a stage doesn't show job-cards parked there.
5. **No saved views or scheduled email.** Reports re-load filter defaults every visit. Owner asks for "the same view as yesterday" and there's no way to give it.
6. **No comparison.** Almost every chart shows "this period" alone. No "vs prior", "vs same period last year", "vs target".
7. **No exception narrative.** Charts are descriptive; nothing tells the operator *why* OTIF dropped, or *which* 5 customers explain 60% of the backlog.
8. **No print/PDF discipline.** The print routes exist on individual modules (challan, spec) but the reports themselves have no print stylesheet.
9. **No standup brief.** The most common Owner ask is "what should I ask in standup today?" — no surface answers that.
10. **No variance bridge / cascade visibility.** The reconciliation work from prior passes produces variance numbers, but no report visualizes the **theoretical → ledger → actual → variance** narrative.
11. **No location heatmap, no calendar heatmap, no waterfall, no funnel.** All "advanced" chart types are missing — only bar / line / pie are used.
12. **MRP is 301 lines and lives at `/analytics/mrp`** — that's the *deepest* page in the system and it's an analytics page, not a report. It belongs in the suite.

### 1.3 What works (and should be preserved)

- **`useOwnerPack`** returns a rich payload (headline + production + sales + inventory + exceptions + reconciliation). One call, lots of signal.
- **Premium-dashboard components** (`KpiCard`, `ChartCard`, `InsightStrip`, `MiniBarList`, `CompactTable`) are well-designed primitives — they just aren't used consistently.
- **MRP page** has real PO-draft generation logic — port that pattern into Inventory Intelligence (mockup 4).
- **The variance / books-locked / period-state plumbing** from the recent close work is the data spine the Variance Bridge mockup (6) leans on.

---

## 2. System design

### 2.1 Information architecture

```
/reports                         ← THE HUB (renamed from "/reports landing")
├─ executive/
│   ├─ owner-daily-pack          ← mockup 02
│   ├─ board-pack-monthly        ← print-first variant of daily pack
│   └─ period-close-workbook     ← reconciliation + cert audit-grade
├─ operations/
│   ├─ operations-command        ← mockup 03
│   ├─ stage-machine-throughput
│   └─ cross-plant-comparator
├─ commercial/
│   ├─ sales-pulse               ← mockup 05
│   ├─ customer-360
│   └─ release-leadtime-anatomy
├─ inventory/
│   ├─ inventory-intelligence    ← mockup 04
│   ├─ mrp-shortage-planner      ← migrated from /analytics/mrp
│   └─ supplier-reel-performance
├─ quality/
│   ├─ variance-bridge           ← mockup 06
│   └─ qc-holds-pareto
└─ dispatch/
    ├─ dispatch-customer-sla
    └─ challan-throughput
```

**Deprecate**:
- `/analytics-loss`, `/analytics-overview`, `/analytics-supplier-reels`, `/analytics-winder-variance` — already redirects, delete after 30 d.
- `/analytics/*` becomes a thin alias to `/reports/*` (saved-views shared).

### 2.2 Shared spine — every report inherits

| Element | Component | Purpose |
|---|---|---|
| **Hero** | `<ReportHero/>` extending `ExecutiveHero` | Title, eyebrow, lead copy, status chips, primary CTA |
| **Books-locked chip** | `BooksLockedChip` (already shipped) | Locked-through date in top bar |
| **Filter bar** | `<ReportFilterBar/>` | Period · compare · plant · category · status + 3-button right (Save view · Schedule · Export) |
| **KPI rail** | `<KpiRail/>` of `KpiCard` | 6 sparkline-bearing tiles · period/delta/sub |
| **Sub-tabs** | `<ReportTabs/>` | Inside-report cuts (e.g. Funnel · Cohort · SKU mix) |
| **Drill chip** | `<DrillLink/>` | Every row / cell has one |
| **Note callouts** | `<NoteCallout/>` | success/info/warn/danger; the "human-readable" explanation under every chart |
| **Saved views** | `<SavedViewsManager/>` | URL-state encoder + named bookmarks + email schedule |
| **Print stylesheet** | `print.css` | A4 portrait, page-break-after on each section, hides filters + actions |

### 2.3 KPI taxonomy

12 KPIs cover every operational question. Each must have: **definition · target · refresh cadence · drill destination**.

| Domain | KPI | Target | Refresh | Drill into |
|---|---|---|---|---|
| Commercial | Backlog value (₹) | ≤ ₹100L | 15 min | Sales orders filtered to open |
| Commercial | OTIF % | ≥ 92% | hourly | Delayed-orders table |
| Commercial | AOV | n/a | daily | Customer 360 |
| Commercial | Release → dispatch days | ≤ 14 d | daily | Lead-time anatomy |
| Production | Active job cards | informational | 5 min | Job-cards list |
| Production | Schedule adherence % | ≥ 88% | hourly | Operations command stage ladder |
| Production | Yield (winder) % | ≥ 96% | hourly | Stage-machine throughput |
| Inventory | Stock value (₹) | informational | hourly | Inventory intelligence |
| Inventory | Days-on-hand (RM) | 20–35 d | daily | Item by item ladder |
| Inventory | Low-stock items | ≤ 5 | hourly | MRP shortage planner |
| Quality | QC holds active | = 0 | 5 min | Operations blockers |
| Finance-ready | Variance % (monthly) | within ±5% | end of month | Variance bridge |

### 2.4 Chart palette — 9 new types

| Type | Where used | Library |
|---|---|---|
| Waterfall | Variance bridge | Recharts BarChart + custom stacked bars |
| Funnel (horizontal bars) | Sales lifecycle | Plain SVG + animated transitions |
| Calendar 7×24 heatmap | Operations machine util | Plain CSS grid + colour scale |
| Location heatmap (8×8 tile grid) | Inventory intelligence | Plain CSS grid + opacity scale |
| Pareto bar | QC holds, scrap ladder | Recharts BarChart sorted desc |
| Donut with center stat | Inventory composition | Recharts PieChart with custom Label component |
| Mini-ladder bar list | Top customers, top SKUs, top movers | Already exists as `MiniBarList` — extend with two-tone gradient + drill chip |
| Quadrant scatter | Customer health (revenue × OTIF) | Recharts ScatterChart |
| Lead-time anatomy | Where the days go | `MiniBarList` variant with cumulative |

### 2.5 Drill-down architecture

Every report has 3 layers:

```
KPI tile ──► Drill 1: same-page chart filtered to that KPI
                │
                ▼
            Drill 2: list/table (e.g. orders, items, holds)
                │
                ▼
            Drill 3: detail page (existing module — order detail, item ledger, hold record)
```

Implementation: each KPI / chart bar / table row has a `<DrillLink href="..."/>`. Drill href is a function of the filter state — preserves period + compare + plant when navigating.

### 2.6 Saved views

Filter state = URL search params (already true). A "Save view" button POSTs `{ name, path, query_string, owner, schedule? }` to a new endpoint `/api/workspace/saved-views`. Schedule is optional (`daily 06:30`, `Mon 09:00`, `Wed close-1`, `on-demand`). A nightly worker re-renders scheduled views to PDF and emails them.

### 2.7 Comparison + period model

Single mental model: every report has **`{ period, compare }`** where:

- `period` = `today | this_week | this_month | this_quarter | last_30_days | custom`
- `compare` = `none | vs_prior_period | vs_same_period_last_year | vs_target`

When `compare` is set, every KPI tile shows the delta chip (`▲ 1.4 pp WoW`), every line chart shows a faint comparison line, every bar shows a comparison bar (lighter shade).

### 2.8 Print model

- Reports print at A4 portrait, two columns collapsed to one.
- Hero shrinks to a 60-pt header with eyebrow + title + date stamp + filter summary.
- Filter bar + action buttons + saved-views manager are `display: none` in print.
- Every section starts with a page-break.
- Tables get borders + 11pt font.
- Owner Daily Pack and Period Close Workbook are designed print-first.

### 2.9 Role gates

| Report | Roles |
|---|---|
| Owner Daily Pack · Board Pack · Period Close Workbook | Owner · Admin |
| Operations Command · Stage-Machine Throughput · Cross-Plant Comparator | Owner · Admin · PlantManager · Planner |
| Sales Pulse · Customer 360 · Release Lead-time Anatomy | Owner · Admin · Sales · Planner |
| Inventory Intelligence · MRP Shortage Planner · Supplier-Reel Performance | Owner · Admin · Store · Planner |
| Variance Bridge · QC Holds Pareto | Owner · Admin · PlantManager · Quality |
| Dispatch SLA · Challan Throughput | Owner · Admin · Dispatch · Sales |

All wrapped with the existing `<RoleGate/>` component.

---

## 3. Mockup walkthrough

Open `mockups/reports-suite/index.html` in a browser. Read in order:

| # | Mockup | What to look at | Anchored data hook |
|---|---|---|---|
| 1 | `01-hub.html` | The 12-tile report library, KPI snapshot strip, filter spine, saved-views table | `useOwnerPack`, `useDashboardOverview`, `useExceptionReport` |
| 2 | `02-owner-pack.html` | 6 hero KPIs · 3-card standup brief · dispatch trend · stage pressure mini-ladder · variance bridge mini · top-customer Pareto · live exceptions feed | `useOwnerPack` + `useExceptionReport` |
| 3 | `03-operations-command.html` | 7×24 hourly heatmap (per-machine) · stage throughput · adherence ladder · operator productivity table · blockers list | `usePlanningBoard` + `useProductionTrends` + new `/api/production/machine-utilization` |
| 4 | `04-inventory-intelligence.html` | Composition donut · aging waterfall · location 8×8 heatmap · top movers · MRP shortage table with one-click PO drafts | `useInventoryValuation` + `useInventoryAging` + `useInventoryLocationOccupancy` + MRP draft API |
| 5 | `05-sales-pulse.html` | 5-stage funnel with drop-percentages · OTIF area trend · customer-360 ladder with risk pill · top SKU mix · lead-time anatomy | `useSalesReport` + new `/api/sales/customer-360` |
| 6 | `06-variance-bridge.html` | Waterfall (theoretical → ledger → recovery → moisture → scrap → actual) · 3-stream item table · QC Pareto · scrap cost ladder · spec→recipe cascade health | `useMonthlyMaterialSummary` (already live) + `useQualityHolds` |

### Notable design choices in the mockups

- **Mockup 2 — "three things to ask in standup"**: explicit operator-action cards above the chart layer. This is the single most important new pattern; it converts a dashboard into a brief.
- **Mockup 3 — heatmap-first**: machine utilization is the question PMs actually ask. Putting the heatmap above the throughput chart inverts the prior priority.
- **Mockup 4 — waterfall aging**: standard "0-30/30-60/60+" tables don't show the magnitude of stale stock. A waterfall in ₹ makes it impossible to miss.
- **Mockup 5 — funnel with drop-percentages**: showing where orders leak (released → dispatched lost 21.3% of value) makes the meeting agenda for sales review obvious.
- **Mockup 6 — 6-bar waterfall instead of 4**: separating "operator over-issue · RM returned · moisture & trim · scrap recovery" lets you see *which* lever to pull.

---

## 4. Implementation plan

### Phase 1 — Foundation (1 sprint, no new backend)

| Day | Work | Files |
|---|---|---|
| 1 | New `<ReportHero/>`, `<ReportFilterBar/>`, `<KpiRail/>`, `<DrillLink/>`, `<NoteCallout/>` primitives | `apps/web-ui/components/reports/*` (new dir) |
| 2 | Add `<Waterfall/>`, `<Funnel/>`, `<CalendarHeatmap/>`, `<LocationHeatmap/>`, `<DonutWithCenter/>` chart primitives | same |
| 3 | Saved-views URL encoder + named-view selector (frontend-only, localStorage) | `apps/web-ui/hooks/use-saved-views.ts` |
| 4 | Rebuild `/reports` hub from mockup 01 | `apps/web-ui/app/(dashboard)/reports/page.tsx` |
| 5 | Rebuild `/reports/owner` from mockup 02 (move `OwnerIntelligenceSuite` content in) | `apps/web-ui/app/(dashboard)/reports/owner/page.tsx` |
| 6 | Rebuild `/reports/inventory` from mockup 04 (use existing inventory hooks) | `apps/web-ui/app/(dashboard)/reports/inventory/page.tsx` |
| 7 | Rebuild `/reports/quality` from mockup 06 (use existing variance hooks) | `apps/web-ui/app/(dashboard)/reports/quality/page.tsx` |

**End of phase 1:** Hub + Owner Pack + Inventory + Variance Bridge live, on a shared design system, no backend changes.

### Phase 2 — Deep cuts (1 sprint, 4 new backend endpoints)

| Day | Work | Backend |
|---|---|---|
| 1 | `/api/production/machine-utilization?stage=&start=&end=` returning 7×24 grid per machine | production-service |
| 2 | `/api/sales/customer-360?customer_id=` returning per-customer rollup (orders, OTIF, returns, complaints, payment-cycle) | sales-service + bff |
| 3 | `/api/sales/leadtime-anatomy?period_start=&period_end=` returning median per stage | sales-service |
| 4 | `/api/inventory/scrap-cost-ladder?period_start=&period_end=` returning item × reason × ₹ | production-service |
| 5 | Rebuild `/reports/operations-command` (mockup 03) | `apps/web-ui/app/(dashboard)/reports/operations-command/page.tsx` |
| 6 | Rebuild `/reports/sales` (mockup 05) | `apps/web-ui/app/(dashboard)/reports/sales/page.tsx` |
| 7 | Migrate `/analytics/mrp` → `/reports/inventory/mrp-shortage-planner` (canonical) | rename + redirect |

### Phase 3 — Schedule + email (1 sprint, infra add)

| Day | Work |
|---|---|
| 1–2 | Saved-views server-side: new `saved_views` table (id, owner, name, path, params, schedule) + endpoints |
| 3–4 | Nightly worker: render scheduled views to PDF via headless Chrome, email recipients |
| 5 | Email template + delivery logs in workspace |
| 6 | Per-report print stylesheets (Owner Pack + Board Pack first) |
| 7 | QA + readiness check |

### Phase 4 — Cleanup (½ sprint)

- Delete `/analytics-loss`, `/analytics-overview`, `/analytics-supplier-reels`, `/analytics-winder-variance`.
- Migrate `/analytics/*` to redirect to `/reports/*` equivalents.
- Drop 7-line stub `/reports/*` and `/analytics/*` files that are not redirects.

---

## 5. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Two design systems (`MetricCard` vs `KpiCard`) confusing during transition | High | Phase 1 settles on `KpiCard` family. `MetricCard` deprecated to a 1-week sunset window with codemod. |
| `useOwnerPack` payload doesn't include all KPIs needed | Medium | Augment in Phase 1 — owner-pack already has 80% coverage; add `headline.aov`, `headline.release_to_dispatch_days` server-side (5 lines) |
| Calendar + location heatmaps perform poorly on large datasets | Low | Aggregate server-side. 7×24 = 168 cells, fine. Locations capped at 64 tiles. |
| Saved-views state encoding breaks bookmarks | Low | Keep URL params backward-compatible; saved view is a name pointer to a query string |
| Variance bridge needs Apr data to look real | Low | Mockup is illustrative. Real data is already in `useMonthlyMaterialSummary`. |
| Phase 3 PDF rendering needs headless Chrome | Medium | Use existing Railway service or schedule worker on Docker side; not on critical path |

---

## 6. Decision points (need owner input before Phase 1 kickoff)

1. **Default landing**: When a user clicks "Reports" in the sidebar, do they land on the hub (mockup 01) or on their most-recently-viewed report? — _Recommend: hub for first-time, last-viewed thereafter (localStorage)._
2. **Saved-views ownership**: Are views personal (only the creator sees them) or sharable team views? — _Recommend: personal in Phase 1, sharable in Phase 3 alongside scheduling._
3. **Email schedule transport**: Use Hari Om's existing report-dispatch infra (you mentioned `report_runs` table) or build a new scheduler? — _Recommend: extend the existing infra._
4. **Sunset window for `/analytics/*`**: 30 days, 60 days, or permanent alias? — _Recommend: 30 days with redirect; permanent alias is technical debt._
5. **Print orientation**: A4 portrait everywhere or A3 landscape for board-pack? — _Recommend: A4 portrait default; A3 landscape only for cross-plant comparator._

---

## 7. Deliverables in this drop

```
mockups/reports-suite/
├─ shared.css                       (design tokens + components)
├─ index.html                       (mockup walkthrough)
├─ 01-hub.html                      (Reports & Analytics Hub)
├─ 02-owner-pack.html               (Owner Daily Pack)
├─ 03-operations-command.html       (Operations Command)
├─ 04-inventory-intelligence.html   (Inventory Intelligence)
├─ 05-sales-pulse.html              (Sales & Commercial Pulse)
└─ 06-variance-bridge.html          (Quality & Variance Bridge)

REPORTS_REDESIGN_REPORT.md          (this file)
```

To view: open `mockups/reports-suite/index.html` in any modern browser. Every link inside the mockups goes back to the index. No build step.

---

## 8. Recommendation

**Approve Phase 1.** It's a one-sprint scope, requires zero backend work, and unlocks 4 of the 6 mockup pages (hub, owner pack, inventory, variance bridge) using data hooks that already exist. Phases 2–4 follow once the foundation is in.

If the mockups align with the operator intent, I can start Phase 1 the moment you green-light. If anything in the layout / KPI choice / drill paths needs to change, please mark it on the mockup HTML (browser screenshot + annotation works) and we iterate before any code.

—

_Design phase only. No code touched outside the mockups directory. Existing reports remain functional in their current state until Phase 1 lands._
