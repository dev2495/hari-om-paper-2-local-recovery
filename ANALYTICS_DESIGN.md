# Analytics Dashboard — Design Spec

**Route.** `/analytics/dashboard`
**Audience.** Owner, plant manager, operations analyst. Read-only drill tool.
**Tone.** Dense, comparative, insight-forward. The owner landing gives *the pulse*; this page gives *the answers*.

---

## 1. What's wrong today

From screenshot of `/analytics/dashboard`:

1. **Hero collides with the palette.** The page background is cream; the hero is dark near-black. Eye can't find the next surface. Either commit to dark across hero+page or drop the dark.
2. **Eight flat KPI cards** show a number and a line of prose. No deltas, no sparklines, no thresholds. A planner can't tell if `Blocked Jobs: 20` is normal, bad, or catastrophic.
3. **"Owner Intelligence" copy duplicates `Intelligence & Analytics`** above it. Scope pill is hidden inside the hero — it's a primary control, not a decoration.
4. **Only one real chart** below the KPI rail (`Stage throughput trend`). The chart panel is half the width and the other half is another set of bars. You lose the core view.
5. **No comparison.** The date range is a single window. Analytics without "vs what" is just a snapshot.
6. **No drill-down.** Click a card → nothing. Click a bar → nothing.
7. **No anomaly surfacing.** If scrap doubled last week, the user has to notice it themselves.

---

## 2. Design goals

- One scroll = the entire operating picture with period comparison.
- Every KPI card shows: **current value · Δ vs comparison period · sparkline · threshold color**.
- Chart panels are composable; two or three per row based on content weight.
- Every chart click filters the rest of the page (cross-filter behavior like a BI tool).
- Anomalies surface automatically — "Winder M2 throughput −22% WoW" at the top of the page.

---

## 3. Layout

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│  Intelligence & Analytics                                                          │
│  Deep-dive across production, sales, inventory, quality.                           │
│                                                                                    │
│  Range [ Apr 1 – Apr 21 ▾ ] vs [ Mar 1 – Mar 21 ▾ ]   Scope [ Plant A ▾ ]  ⋯ ⬇︎   │ ← sticky on scroll
├───────────────────────────────────────────────────────────────────────────────────┤
│  ◉ INSIGHTS (auto-surfaced, collapsible)                                           │
│  ⚠ Scrap up 38% WoW — driver: O-3 oven · 142 kg (was 103)          [Investigate →]│
│  ⚠ OTIF dropped to 78% (target 92%) — 4 overdue sales orders         [Details →] │
│  ✓ Winder utilization at 87%, highest this quarter                   [Breakdown →]│
├───────────────────────────────────────────────────────────────────────────────────┤
│  ◉ KPI RAIL — 4-up × 2 rows                                                        │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐                    │
│  │ ACTIVE JOBS  │ SALES BACKLOG│ DISPATCH QTY │ BLOCKED JOBS │                    │
│  │ 150          │ 206          │ 2,140 kg     │ 20 ⚠         │                    │
│  │ +12 (+8.7%)  │ −4 (−1.9%)   │ +180 (+9.2%) │ +6 (+42.8%)  │                    │
│  │ ▂▃▅▄▆▅▇      │ ▅▄▄▅▃▃▄     │ ▃▄▅▆▅▇▆      │ ▂▃▃▄▅▆▇      │  ← sparkline       │
│  └──────────────┴──────────────┴──────────────┴──────────────┘                    │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐                    │
│  │ INV VALUE    │ LOW STOCK    │ QC HOLDS     │ OTIF         │                    │
│  │ ₹14.2 L      │ 13           │ 0            │ 78%          │                    │
│  │ −₹0.4 L      │ +2           │ 0            │ −14pp ⚠      │                    │
│  │ ▆▆▆▅▅▄▄      │ ▂▃▄▅▄▅▆     │ ▁▁▁▁▁▁▁      │ ▇▇▆▅▅▄▃      │                    │
│  └──────────────┴──────────────┴──────────────┴──────────────┘                    │
├───────────────────────────────────────────────────────────────────────────────────┤
│  ◉ PRODUCTION — 2-up                                                               │
│  ┌─────────────────────────────────┬──────────────────────────────────────────┐   │
│  │ STAGE THROUGHPUT TREND          │ OTIF — daily, with target line            │   │
│  │ line chart, 5 series            │ line + 92% dashed target line             │   │
│  │ Winder · Oven · Process · …     │ orange shaded area = below-target days    │   │
│  │ hover = tooltip w/ all 5        │ click = drill to overdue SO list          │   │
│  └─────────────────────────────────┴──────────────────────────────────────────┘   │
│  ┌─────────────────────────────────┬──────────────────────────────────────────┐   │
│  │ VARIANCE HEATMAP                │ UTILIZATION BY MACHINE                    │   │
│  │ days × stages grid              │ horizontal bar chart, 1 row per machine   │   │
│  │ cell color = variance %         │ 0%→100% with target line                  │   │
│  │ click cell = day-stage detail   │ sorted desc, top 10 + "show all"          │   │
│  └─────────────────────────────────┴──────────────────────────────────────────┘   │
├───────────────────────────────────────────────────────────────────────────────────┤
│  ◉ COMMERCIAL — 3-up                                                               │
│  ┌──────────────┬────────────────┬───────────────────────────────────────────┐    │
│  │ TOP CUSTOMERS│ PRODUCT MIX     │ ORDER PIPELINE (funnel)                   │    │
│  │ bar, top 10  │ treemap by qty  │ stages: Enquiry → Quote → Order → Released│    │
│  │ + share %    │ drill = family  │ conversion % at each step                 │    │
│  └──────────────┴────────────────┴───────────────────────────────────────────┘    │
├───────────────────────────────────────────────────────────────────────────────────┤
│  ◉ QUALITY & DRIFT                                                                 │
│  ┌─────────────────────────────────┬──────────────────────────────────────────┐   │
│  │ SCRAP PARETO                    │ DOWNTIME REASONS                          │   │
│  │ horizontal bar, 80/20 highlight │ horizontal bar, grouped by machine        │   │
│  │ cumulative % line overlaid      │ expand row = timeline of incidents        │   │
│  └─────────────────────────────────┴──────────────────────────────────────────┘   │
├───────────────────────────────────────────────────────────────────────────────────┤
│  ◉ LIVE WIP BY STAGE (drill to /production/tracker)                                │
│  Winder   ████████████████░░░░░░░░   34 JCs · avg 1.2d                            │
│  Oven     ██████████░░░░░░░░░░░░░░   18 JCs · avg 0.9d                            │
│  Process  ██████████████░░░░░░░░░░   22 JCs · avg 1.4d                            │
│  Packing  █████░░░░░░░░░░░░░░░░░░░    9 JCs · avg 0.3d                            │
│  QC hold  ███░░░░░░░░░░░░░░░░░░░░░    3 JCs · avg 2.1d ⚠                          │
│  Dispatch █░░░░░░░░░░░░░░░░░░░░░░░    4 JCs · avg 0.4d                            │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Components

### 4.1 `KpiCard` (new primitive — lives in `components/ui/kpi-card.tsx`)

```tsx
<KpiCard
  label="Active Jobs"
  value={150}
  unit=""
  delta={{ value: 12, pct: 8.7, direction: 'up' }}
  sparkline={{ data: [...], tone: 'cyan' }}
  threshold={{ kind: 'info' }}       // info | good | warn | bad
  icon={ClipboardCheck}
  onClick={() => drill('active-jobs')}
/>
```

- **Rendering.** 160×96px card (min), label uppercase 11px, value 28px tabular-nums, delta row (value + %, up/down arrow, colored), sparkline bottom-aligned 32px tall.
- **Tone logic.** Determined by `threshold.kind`: good=emerald, warn=amber, bad=rose, info=slate. Delta color matches the **meaningful direction** (a ↓ in Blocked Jobs is good).
- **Sparkline.** 20-point downsample of the comparison window. Uses `ERP_CHART_THEME.lines[tone]`. `prefers-reduced-motion` → hide sparkline.

### 4.2 `InsightCard`

Auto-surfaced anomaly at the top. Fields: severity (info/warn/critical), headline, driver, magnitude, jump-link. Collapsible bar at the top of the page. Max 3 visible; rest in a `+ N more` drawer.

### 4.3 `ChartCard`

Shared frame for every chart panel. Header row: title, subtitle, chart-type switcher (where useful), action menu (⋯ → export PNG/CSV, view as table, open in drilldown, copy link). Footer row: legend chips. Body: chart or empty/loading state. Never a bare chart — always wrapped.

### 4.4 `CrossFilterBar`

A sticky strip that appears when any chart segment or KPI is clicked. Shows active filter pills ("Plant A · Winder · Acme"). `×` on each pill removes that facet. `Clear all` on the right.

---

## 5. Data & API

One endpoint per panel, keyed the same way so cache reuse is trivial:

```
GET /api/analytics/kpis?from=…&to=…&compareFrom=…&compareTo=…&scope=plant-a
  → { activeJobs: { value, delta, spark }, salesBacklog: {...}, ... }

GET /api/analytics/throughput?from=…&to=…&scope=…&stageIn=WINDER,OVEN,…
GET /api/analytics/otif?from=…&to=…
GET /api/analytics/variance-heatmap?from=…&to=…
GET /api/analytics/utilization?from=…&to=…
GET /api/analytics/top-customers?from=…&to=…&limit=10
GET /api/analytics/product-mix?from=…&to=…
GET /api/analytics/pipeline?from=…&to=…
GET /api/analytics/scrap-pareto?from=…&to=…
GET /api/analytics/downtime?from=…&to=…
GET /api/analytics/wip-live
GET /api/analytics/insights?from=…&to=…   // anomaly detection
```

All queries flow through the same aggregator service that reports already use — the page is a different view over the same owner-pack aggregates. No new ETL.

**Anomaly engine.** `insights` endpoint runs a simple z-score on each metric against the last 8 comparable periods; anything > 2σ becomes a candidate. Severity = |z|. Driver = dimension whose contribution swung the metric most. Start simple, evolve to Prophet/STL seasonality if noise bites.

---

## 6. Interactions

### 6.1 Cross-filtering

- **Click a KPI card** → page filter = that metric's drill slice (e.g., Blocked Jobs → filters all panels to blocked JCs).
- **Click a bar / segment / treemap cell** → page filter += that dimension value.
- **Shift-click** stacks filters (customer + product family).
- **URL reflects state**: `?filters=customer:acme,stage:OVEN` — links are shareable.

### 6.2 Comparison window

The range picker has two fields. Presets: `MTD vs last MTD`, `QTD vs last QTD`, `Last 7d vs prev 7d`, `Last 30d vs prev 30d`, `Custom`. Delta + sparkline recompute on change.

### 6.3 Drilldown drawer

Clicking any chart's "Details →" opens a right-side `DrilldownDrawer` (640px wide) with a table of underlying rows, matching the chart's slice. Drawer has its own mini KPI rail + table + export.

### 6.4 Export / share

- Export PNG of any chart (`⋯` menu). Uses `html-to-image`.
- Export CSV of drill data.
- Share link copies the full URL with filters — the recipient opens the same view.
- "Save as report" (P1) persists the current filter+range to `/reports/custom/:id`.

---

## 7. Motion

- KPI numbers tween with `useCountUp` (300ms, ease-out) on mount + refresh.
- Sparklines animate left-to-right on mount (400ms).
- Charts respect Recharts `animationDuration={400}` default; disable when `prefers-reduced-motion`.
- Drilldown drawer slides in from right, 240ms, Framer spring.
- Insight cards fade in staggered 60ms each.

---

## 8. Accessibility

- Every chart has an equivalent data-table view behind `⋯ → View as table` — reaches WCAG 2.1 AA 1.3.1.
- KPI deltas read by screen reader as "Active Jobs, 150, up 12, up 8.7 percent versus previous 21 days."
- Color is never the only signal: deltas include arrow glyph + sign; heatmap cells include percentage text ≥ 12px.
- Tab order: range → scope → insights → KPI rail (left-to-right, top-to-bottom) → chart cards.
- Focus outline on every card uses `ring-2 ring-primary`.

---

## 9. Phasing

**P0 (6–7 days):** Range + comparison controls, scope picker, KPI rail with delta + sparkline, stage throughput + OTIF + utilization + top customers charts, ChartCard primitive, insights rail (stub: curated rules, no z-score yet).

**P1 (4–5 days):** Variance heatmap, product mix, pipeline funnel, scrap pareto, downtime, WIP rail, drill drawer, cross-filter URL sync, CSV export.

**P2 (3–4 days):** Anomaly engine (real z-score), saved reports, chart-type switcher, mobile responsive variant (stacked single-column).

---

## 10. Trade-offs & revisit

| Decision | Trade-off | Revisit when |
|---|---|---|
| Recharts for all viz | Familiar, fast, good defaults — limited for heatmaps/treemaps | If users demand richer interaction → swap to Visx or Observable Plot |
| Client-side cross-filter | Snappy for ~1k rows per query; may need server filter for larger ranges | Dataset per panel >10k rows |
| One endpoint per panel | Simple to cache + replay | If page gets slow → unified `/analytics/snapshot` returning everything |
| Curated insight rules for P0 | Ships fast, gives real value | After 2 weeks of usage — measure false positive rate, switch to anomaly engine |
| Range is bounded to ≤ 400 days | Keeps queries fast | Year-over-year analysis becomes a must-have → roll to monthly aggregates server-side |

---

## 11. Open questions

1. **Currency + locale.** Is ₹ always the display? Any USD export?
2. **Multi-plant comparison.** If scope = "All plants" is picked, do we overlay lines per plant or stack them?
3. **Attribution window** for OTIF — is a ship date slip of the same day counted as on-time?
4. **Anomaly notification** — only in-page now, or also push to a Slack webhook / email?
5. **Cost dimension** — owner will eventually ask "which of these is costing me money" — do we have unit-cost data per stage today?

Defaults assumed: ₹ always, multi-plant = stacked lines, same-day = on-time, in-page only, unit cost not yet surfaced.
