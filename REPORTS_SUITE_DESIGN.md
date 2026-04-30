# Reports Suite — Design Spec

**Routes.** `/reports` (hub) + `/reports/owner`, `/reports/production`, `/reports/sales`, `/reports/inventory`, `/reports/plant`, `/reports/reconciliation`
**Audience.** Owner (reads all), plant manager (production + plant + reconciliation), sales lead (sales), procurement (inventory), finance (reconciliation + owner).
**Promise.** Every report is a finished artifact — opens, reads, exports, prints. No "coming soon" tiles, no empty states hiding the actual answer.

---

## 1. What's wrong today

From the screenshot of `/reports`:

1. **Hub tiles are decorative.** Each tile has an arrow and a description, but no content preview. The owner can't tell which report is relevant without clicking through.
2. **KPI cards on the hub** (Total Production, Active Jobs, Dispatch Today, Reconciliation Cost) show `0 units`, `0`, `0`, `₹0`. Either the data is empty or the aggregation is broken. Either way, the hub radiates "broken" not "intelligent".
3. **"Reporting posture" + "Control note" text columns** on the right of the hub are pure marketing copy. They take real estate and add no signal.
4. **No consistency across reports.** Each linked report is a different layout with different chart styles (assumption based on existing variance across the app).
5. **No export, no schedule, no share.** Reports are read-only surfaces; the suite needs print, CSV, PDF, email-on-schedule.
6. **No cross-cutting filters.** Date range, plant, customer should be consistent across reports. Today each page has its own pattern.

---

## 2. Design goals

- **One visual grammar** across all six reports: the same hero, KPI rail, chart grammar, table grammar, export actions. You learn one; you know all.
- **Reports are finished.** If a report has a section, that section has data or an unambiguous empty state (with CTA to fix).
- **One filter bar** — date range + plant + optional report-specific facet. State persists in URL.
- **Export/print/schedule** are first-class on every report.
- **Drill-down** everywhere — no dead-ends.

---

## 3. Hub page — `/reports`

### 3.1 Layout

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Reports                                                                          │
│  Owner, production, sales, inventory, plant, reconciliation — one place.          │
│                                                                                    │
│  Range [ Apr 1 – Apr 21 ▾ ]   Scope [ All plants ▾ ]   [ + Schedule email ]      │
├─────────────────────────────────────────────────────────────────────────────────┤
│  HUB KPIs — pulled from the same aggregates each report uses                      │
│  ┌────────────┬────────────┬────────────┬────────────┬────────────┐              │
│  │ REVENUE    │ PRODUCTION │ DISPATCHES │ OTIF       │ VARIANCE ₹ │              │
│  │ ₹38.4 L    │ 24,180 kg  │ 18 today   │ 78%        │ −₹1.4 L    │              │
│  │ spark      │ spark      │ spark      │ spark      │ spark      │              │
│  └────────────┴────────────┴────────────┴────────────┴────────────┘              │
├─────────────────────────────────────────────────────────────────────────────────┤
│  REPORT CARDS — each card shows a preview of what's inside                        │
│  ┌───────────────────────────────┬───────────────────────────────┐                │
│  │ OWNER DASHBOARD               │ PRODUCTION REPORTS             │                │
│  │ Revenue posture, OTIF, risks. │ Throughput, OEE, downtime.     │                │
│  │ [mini revenue waterfall]      │ [mini throughput line]          │                │
│  │ 5 KPIs · last update 3m ago   │ 6 KPIs · last update 3m ago    │                │
│  │ [ Open report → ]             │ [ Open report → ]               │                │
│  ├───────────────────────────────┼───────────────────────────────┤                │
│  │ SALES REPORTS                 │ INVENTORY REPORTS              │                │
│  │ Bookings, backlog, customers. │ Stock, ageing, turns, ABC.     │                │
│  │ [mini top-customers bar]      │ [mini ABC pie]                  │                │
│  │ [ Open → ]                    │ [ Open → ]                      │                │
│  ├───────────────────────────────┼───────────────────────────────┤                │
│  │ PLANT REPORTS                 │ RECONCILIATION                 │                │
│  │ Plant comparison, capacity.   │ Cost variance, BOM vs actual.  │                │
│  │ [mini plant-mix stacked bar]  │ [mini variance waterfall]       │                │
│  │ [ Open → ]                    │ [ Open → ]                      │                │
│  └───────────────────────────────┴───────────────────────────────┘                │
├─────────────────────────────────────────────────────────────────────────────────┤
│  SCHEDULED DELIVERIES — reports emailed on a cadence                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐     │
│  │ Every Mon 07:00 → yash@…, priya@…   Owner dashboard · PDF     [edit]    │     │
│  │ Every 1st 06:00 → yash@…             Reconciliation · XLSX     [edit]    │     │
│  │ [ + New scheduled delivery ]                                              │     │
│  └─────────────────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- Tiles are **real previews**, not decoration. The mini-chart inside each tile is the same data the report shows, rendered at a tiny scale.
- Hub KPI rail shows the 5 cross-cutting numbers everyone asks about.
- Scheduled deliveries panel gives admins and owners one place to manage recurring exports.

---

## 4. Shared report grammar

Every report at `/reports/*` uses the same shell:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  [Report Title]                                  [Export ▾] [Schedule] [Share]│
│  [One-line description]                                                        │
│  Range [ ▾ ]   Compare [ vs prev period ▾ ]   Plant [ ▾ ]   [+ Filter]         │
├──────────────────────────────────────────────────────────────────────────────┤
│  KPI RAIL (report-specific, 4-8 cards)                                         │
├──────────────────────────────────────────────────────────────────────────────┤
│  PRIMARY VISUAL (full width, 360-420px tall)                                   │
├──────────────────────────────────────────────────────────────────────────────┤
│  TWO-UP SECONDARY VISUALS                                                       │
├──────────────────────────────────────────────────────────────────────────────┤
│  TWO-UP OR THREE-UP TERTIARY VISUALS                                            │
├──────────────────────────────────────────────────────────────────────────────┤
│  DETAIL TABLE — sortable, filterable, exportable, virtualized                   │
├──────────────────────────────────────────────────────────────────────────────┤
│  FOOTER — data freshness, report version, "last updated by …"                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

Export dropdown: `PDF · XLSX · CSV · PNG snapshot · Copy link`. Share copies the filter-preserving URL. Schedule opens a small form (cadence · recipients · format).

---

## 5. Owner report — `/reports/owner`

This is the **printable / emailable** cousin of the Owner Landing. The landing is the live surface; this is the snapshot.

### 5.1 KPI rail

Revenue MTD · Order book · OTIF · WIP value · Blocked Jobs · Variance Cost.

### 5.2 Primary visual

**Revenue waterfall** (Plan → Booked → Dispatched → Invoiced → Collected) with ₹ labels per step and Δ vs previous period.

### 5.3 Secondary

- OTIF trend (30d line + 92% target line).
- Stage load (live WIP bars).

### 5.4 Tertiary

- Top customers (bar chart, top 10, share %).
- Dispatch forecast (next 7 days bar).
- Risk register (3 cards: Sales, Ops, Supply — each shows count + value at risk).

### 5.5 Detail table

None. This is a summary report. Link out to Sales or Production reports for detail.

### 5.6 Export

PDF is the hero format. Landscape A4, branded header with plant name, timestamp, signature line. Email-schedule: every Mon 07:00 IST → owner, CFO.

---

## 6. Production report — `/reports/production`

### 6.1 KPI rail

Total Output (kg / tubes) · Active JCs · Avg Cycle Time · First-Pass Yield · OEE · Downtime Hours.

### 6.2 Primary visual

**Stage throughput trend** (multi-line, one line per stage, over selected period) with anomaly markers where daily output dropped > 2σ.

### 6.3 Secondary

- **Machine utilization** horizontal bars (one per machine, 0–100% + target line).
- **Downtime reasons** horizontal bar, stacked per machine.

### 6.4 Tertiary

- **Operator performance** — scatter (tubes/hr vs defect %) per operator, colored by shift.
- **Shift comparison** — small multiples: A/B/C, one sparkline each for key metrics.
- **Scrap pareto** — 80/20 bar with cumulative % overlay.

### 6.5 Detail table

JC-level: `JC ref · Product · Qty · Planned start/end · Actual · Variance · Operator · Machine · Status`. Row click → JC detail drawer.

### 6.6 Export

XLSX for the operations lead (they pivot in Excel anyway). PDF A4 landscape for the plant manager wall.

---

## 7. Sales report — `/reports/sales`

### 7.1 KPI rail

Bookings MTD · Backlog · Released to Prod · Dispatched · Invoiced · Collected · Avg Order Value · Conversion Rate.

### 7.2 Primary visual

**Pipeline funnel** — Enquiry → Quote → Order → Released → Dispatched → Invoiced → Collected. Each stage shows count + ₹. Conversion % between stages.

### 7.3 Secondary

- **Bookings trend** — daily line, target overlay.
- **Order status mix** — stacked bar (draft / confirmed / released / partially dispatched / completed) over time.

### 7.4 Tertiary

- **Top customers** — bar chart + table, share %, vs prior period.
- **Product mix** — treemap by family / spec.
- **Aging of open orders** — histogram of days since order.

### 7.5 Detail table

`SO ref · Customer · Value ₹ · Status · Released % · Dispatched % · Due · Aging · Owner`. Row click → SO drilldown.

### 7.6 Export

CSV for sales ops. PDF for customer review meetings. PowerBI / Looker passthrough via shared link.

---

## 8. Inventory report — `/reports/inventory`

### 8.1 KPI rail

Total Value · RM Value · WIP Value · FG Value · Stock Turns · Deadstock Value · At-Risk Items · On-Order Value.

### 8.2 Primary visual

**Inventory mix + ageing** — stacked horizontal bars by category (RM/WIP/FG), each stack colored by ageing bucket (0-30d / 31-60d / 61-90d / 90d+).

### 8.3 Secondary

- **Stock turns by category** — bar chart, with industry benchmark line.
- **Valuation trend** — line, last 90 days, break out RM/WIP/FG.

### 8.4 Tertiary

- **ABC analysis** — pareto curve: cumulative % of items vs cumulative % of value, with A/B/C zones shaded.
- **Deadstock** — table: items with zero movement > 180 days, value.
- **Ageing heatmap** — items × ageing buckets grid.

### 8.5 Detail table

`Item · Type · On hand · Reserved · Available · Value ₹ · Last movement · Days in stock · Velocity class (A/B/C)`. Row click → item detail.

### 8.6 Export

XLSX the default. Inventory people pivot.

---

## 9. Plant report — `/reports/plant`

For multi-plant installations. If only one plant, show a single-plant detail variant rather than hiding the report.

### 9.1 KPI rail (per-plant, side-by-side)

Each plant card: Output · OTIF · WIP Value · Variance ₹ · Utilization %. Up to 4 plants side-by-side; more = scroll.

### 9.2 Primary visual

**Plant comparison radar** — 6-axis radar (Output / OTIF / Utilization / Yield / On-time / Cost) with one polygon per plant, overlaid.

### 9.3 Secondary

- **Capacity vs actual** — grouped bar, one cluster per plant.
- **Output trend** — line, one per plant.

### 9.4 Tertiary

- **Product mix per plant** — small multiples: each plant gets a mini treemap.
- **Downtime reasons per plant** — small multiples of horizontal bars.

### 9.5 Detail table

Pivot: plants × metrics, with WoW delta colored in each cell.

### 9.6 Export

PDF landscape — print-to-boardroom.

---

## 10. Reconciliation report — `/reports/reconciliation`

The one finance cares about most. Close-out review of what the books expected vs what actually happened.

### 10.1 KPI rail

Total Variance ₹ · Material Variance ₹ · Labor Variance ₹ · Scrap Cost ₹ · Rework Cost ₹ · Favorable Count · Unfavorable Count.

### 10.2 Primary visual

**Variance waterfall** — planned cost → material variance → labor variance → scrap → rework → actual cost. Green bars for favorable, red for unfavorable. Each bar labeled with ₹.

### 10.3 Secondary

- **Variance by JC** — horizontal bars, top 10 unfavorable JCs, red; top 10 favorable, green.
- **Variance trend** — line by week, with a 0 axis and above/below shading.

### 10.4 Tertiary

- **By material** — table: material / planned qty / actual qty / variance % / ₹ impact / driver.
- **By stage** — bar chart of variance ₹ per stage.
- **By operator** — (P1, sensitive — behind a role check).

### 10.5 Detail table

JC-level reconciliation: `JC ref · Planned ₹ · Actual ₹ · Material var · Labor var · Scrap · Other · Total var · Status (favorable/unfavorable)`. Click → full reconciliation drill with line-item breakdown.

### 10.6 Export

XLSX (finance) + PDF (review). Email-schedule: monthly, 1st of the month 06:00 → CFO, owner.

---

## 11. Components reused across the suite

- **`ExecutiveHero`** with the shared filter strip inside.
- **`KpiCard`** for every rail.
- **`ChartCard`** wraps every chart panel; same header/menu/footer grammar.
- **`DataTable`** for every detail table — sortable, filterable, virtualized, paginated, multi-select + export.
- **`DrilldownDrawer`** for row-click detail.
- **`FilterBar`** for active filter pills with "clear all".
- **`EmptyState`** with CTA when a report has no data in the window.

---

## 12. Data & API

```
GET /api/reports/hub?range=…&scope=…          → hub KPI rail + tile previews
GET /api/reports/owner?range=…&scope=…        → full owner report payload
GET /api/reports/production?range=…&scope=…   → ...
GET /api/reports/sales?range=…&scope=…        → ...
GET /api/reports/inventory?range=…&scope=…    → ...
GET /api/reports/plant?range=…&scope=…        → ...
GET /api/reports/reconciliation?range=…&scope=… → ...

GET /api/reports/:slug/export?format=pdf|xlsx|csv|png&…  → file stream
POST /api/reports/schedules { slug, cadence, recipients, format }
GET  /api/reports/schedules
PATCH /api/reports/schedules/:id
DELETE /api/reports/schedules/:id
```

All report payloads share a common envelope so the frontend shell is identical:

```ts
type ReportPayload = {
  title: string
  description: string
  range: { from: string; to: string }
  compare: { from: string; to: string }
  scope: { plants: string[] }
  kpis: KpiSpec[]
  primary: ChartSpec
  secondary: ChartSpec[]
  tertiary: ChartSpec[]
  detail?: TableSpec
  footer: { updatedAt: string; dataFreshness: string; version: string }
}
```

The frontend has **one ReportShell component** that renders any payload shape. Adding a new report = new endpoint + payload, zero new shell code.

**PDF export** — server-side headless Chromium renders the same React tree to a PDF. Template = report + print stylesheet. Never a separate "printable version" of the report — same React, different stylesheet.

**XLSX export** — server-side via `xlsx` / `exceljs` with named sheets per section. Every chart's underlying data becomes a sheet, every table becomes a sheet.

---

## 13. Filters & URL state

Every report URL encodes: `range`, `compareRange`, `scope` (plants), any report-specific facet (customer, machine, stage…). Changing a filter pushes a new URL; the back button works; sharing a link works.

---

## 14. Scheduling

One scheduler. Cadence: daily/weekly/monthly/custom cron. Delivery: email (SMTP), WhatsApp (P1), S3 put (P2). Recipients: internal users (autocomplete) or external emails. Format per recipient (owner gets PDF, finance gets XLSX).

Implementation: cron job runs the export endpoint server-side, ships the file to the queue, worker emails it. Audit trail per delivery.

---

## 15. Motion (report grammar)

- Numbers count-up on first paint, tween on refresh (250ms).
- Charts animate with the default Recharts 400ms reveal.
- Drilldown drawer slides in from right, 240ms spring.
- Export click shows a progress pill ("Preparing PDF… 2s") until file ready, then toasts "Downloaded".

---

## 16. Accessibility

- Every chart has "View as table" in the ⋯ menu — WCAG 1.3.1.
- KPI card deltas are prefixed with arrow + sign.
- Tables use `<caption>` = report section title.
- Filter pills are `<button role="listitem">` with explicit remove aria-label.
- PDF export has proper tagged structure (headings, lists, tables) — screen readers work on the PDF too.

---

## 17. Phasing

**P0 (10–12 days across the suite):**
- Hub redesign (KPI rail + tile previews + scheduled deliveries list).
- Shared `ReportShell` component + `DataTable` + `ChartCard`.
- Owner report + Production report + Sales report (end-to-end, including exports).

**P1 (8–10 days):**
- Inventory report + Reconciliation report + Plant report.
- Server-side PDF renderer.
- Scheduler UI + cron worker + email delivery.

**P2 (4–5 days):**
- WhatsApp delivery, S3 put.
- Saved custom reports ("save filter as named report").
- Cross-report comparisons (diff two reports side-by-side).
- Dark mode print stylesheet.

---

## 18. Trade-offs & revisit

| Decision | Trade-off | Revisit when |
|---|---|---|
| One `ReportShell` for all reports | Maximum consistency, fast to add new reports | Some reports may want special layouts → extension points via slot props |
| Server-side Chromium for PDF | Visual parity with screen, but heavy | If PDF load spikes, move to a worker pool or Vercel OG-style lightweight renderer |
| XLSX separately for each section | Finance's preferred format, but more code | Auto-derive XLSX from payload metadata |
| Hub KPI = same aggregates as reports | Great consistency | If hub is hit > 50 rps, cache the response separately |
| Detail tables everywhere | Planners love detail; owners don't | Hide detail tables behind "Show details" toggle for owner report |
| Compare range always = prior period | Sensible default | Add "compare to plan / compare to last year" once the plan model exists |

---

## 19. Open questions

1. **Single currency / rounding.** Lakhs vs crores vs rupees — what does the owner prefer in report titles vs detail rows?
2. **Data freshness SLA.** How stale is too stale? Today hub says nothing.
3. **Brand on PDF export.** Company letterhead / logo / signature line?
4. **Finance report confidentiality.** Restrict `/reports/reconciliation` to role=finance+owner?
5. **Multi-plant default scope.** Owner sees all plants; plant manager sees their plant only?

Defaults assumed: lakhs for aggregates, rupees for detail; SLA = 10 minutes + "Updated 3m ago" footer; branded PDF template; finance-only for reconciliation; scope defaults from user's home plant.

---

## 20. "No gaps" checklist for each report

Use this when building each one — every row must be ✓ before marking the report done:

- [ ] Hero title + one-line description
- [ ] Range + compare + scope filter
- [ ] 4–8 KPI cards with delta + sparkline + threshold
- [ ] Primary visual that directly answers the report's question
- [ ] At least two secondary visuals
- [ ] Tertiary section (treemap / small multiples / pareto / radar / heatmap) — specific to the report's domain
- [ ] Detail table with sort / filter / export / drill
- [ ] Export: PDF + XLSX + CSV + PNG + copy-link
- [ ] Schedule setup works end-to-end
- [ ] Every "Open X" link lands on the right drill page
- [ ] Empty state on every panel with a clear next action
- [ ] Mobile layout (stacked, chart collapsed to summary card) is legible
- [ ] Screen-reader: every chart has table equivalent; labels complete
- [ ] Print stylesheet: no sidebar, no chrome, proper page breaks

This checklist is the handoff definition of done.
