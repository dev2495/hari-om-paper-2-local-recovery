# MRP — Design Spec

**Route.** `/analytics/mrp`
**Audience.** Procurement / purchasing planner. Secondary: plant manager, owner.
**Goal.** Answer in one screen: *what to buy, how much, by when, from whom, and why*.

---

## 1. What's wrong today

From screenshot of `/analytics/mrp`:

1. **One bar chart (Available vs reorder vs order qty) carries the whole insight.** The chart compares current stock against a static reorder point. That's a snapshot, not a plan. It tells you nothing about *time* — when will you actually run out?
2. **No supply/demand curve.** The fundamental MRP visual is a stock-level projection over the planning horizon, with reorder/safety lines crossing it. We have none of that.
3. **No lead-time visualization.** "Lead-time queue: 10" is the only hint — it doesn't tell you which items, which suppliers, or whether you can place a PO today and still get parts in time.
4. **Color overload.** Orange + red + teal bars without a legend or semantic mapping. A planner has to hover to figure out what each color means.
5. **PO Output panel is empty UX**. "No draft generated" with a hint, but no preview of what the draft would contain or which lines would land in it.
6. **Exception list is a flat table** with no priority, no supplier, no projected stockout date.
7. **No what-if.** "If I accept SO-2104, do I have enough kraft paper?" — unanswerable here.

---

## 2. Design goals

- **Time-aware MRP** — every chart and table includes the planning horizon (30 / 60 / 90 days).
- **One screen for all of MRP** — risk overview, per-item detail, PO draft, supplier view.
- **Cause-and-effect clarity** — every shortage row links to *why* (which SO/JC consumes it), and every PO link explains *which shortage it solves*.
- **Visual supply/demand** is the centerpiece, not a ribbon under a bar chart.

---

## 3. Layout

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  MRP — Material Requirements Planning                                               │
│  Plan horizon [ 30d • 60d • 90d ]   Scope [ Plant A ▾ ]   ⚙ Run settings           │
├────────────────────────────────────────────────────────────────────────────────────┤
│  KPI RAIL                                                                            │
│  ┌───────────┬───────────┬───────────┬───────────┬───────────┬───────────┐         │
│  │ AT-RISK   │ STOCKOUT  │ AVG LEAD  │ TIED-UP   │ ON-ORDER  │ STALE     │         │
│  │ ITEMS     │ ≤ 14 DAYS │ TIME      │ STOCK     │ VALUE     │ INVENTORY │         │
│  │ 23        │ 7 ⚠       │ 11.2 d    │ ₹14.2 L   │ ₹3.4 L    │ ₹0.6 L    │         │
│  │ +5 WoW    │ +3 WoW    │ −0.8 d    │ −₹0.4 L   │ +₹1.1 L   │ −₹0.1 L   │         │
│  │ ▂▃▅▄▆▆▇   │ ▁▂▃▄▅▅▇   │ ▆▆▅▄▄▄▃   │ ▆▆▆▅▅▄▄   │ ▂▃▃▄▅▅▆   │ ▆▅▅▄▄▃▃   │         │
│  └───────────┴───────────┴───────────┴───────────┴───────────┴───────────┘         │
├────────────────────────────────────────────────────────────────────────────────────┤
│  ◉ STOCK-RISK HEATMAP (items × weeks)                                               │
│  ┌────────────────┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐            │
│  │ ITEM           │W18│W19│W20│W21│W22│W23│W24│W25│W26│W27│W28│W29│W30│            │
│  │ KRAFT-120-BRWN │ ✓ │ ✓ │ ⚠ │ ⚠ │ ✗ │ ✗ │ ✗ │ ⚠ │ ⚠ │ ✓ │ ✓ │ ✓ │ ✓ │            │
│  │ KRAFT-100-WHT  │ ✓ │ ✓ │ ✓ │ ⚠ │ ⚠ │ ⚠ │ ✗ │ ✗ │ ✗ │ ⚠ │ ⚠ │ ✓ │ ✓ │            │
│  │ ADHESIVE-PVA-5%│ ✓ │ ✓ │ ✓ │ ✓ │ ✓ │ ✓ │ ⚠ │ ⚠ │ ⚠ │ ⚠ │ ⚠ │ ✗ │ ✗ │            │
│  │ … 20 more rows                                                                    │
│  └────────────────┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘            │
│  legend: ✓ above safety   ⚠ below safety   ✗ stockout                              │
├────────────────────────────────────────────────────────────────────────────────────┤
│  ◉ SUPPLY vs DEMAND — selected item: KRAFT-120-BRWN              [ Pick item ▾ ]    │
│                                                                                      │
│  2,000 ┤                  ╱╲                       ╱╲      ← projected stock        │
│  1,500 ┤               ╱─╯  ╲╲                  ╱─╯  ╲                              │
│  1,000 ┤- - - - - - -╱- - - -╲╲- - - - - - - -╱- - - - - - reorder line             │
│    500 ┤- - - - - - ╱- - - - -╲- - - - - - - ╱- - - - - - safety stock              │
│      0 ┤━━━━━━━━━━━━━━━━━━━━━━━╳━━━━━━━━━━━━━━━━━━━━━━━━━ ← shortage on May 12     │
│        │ Apr 21         May 5          May 12       May 26       Jun 9              │
│           ●─────●─────●  PO draft 1  arrives May 10                                  │
│                                       ●─────●  PO draft 2 needed May 8 → arrive 19  │
│  legend: ━ projected stock   - - reorder/safety   ● PO arrival markers              │
│  hover = day breakdown (in qty, out qty, ending stock, jobs consuming)              │
├────────────────────────────────────────────────────────────────────────────────────┤
│  ◉ MATERIAL RECOMMENDATIONS — sortable, filterable                                   │
│  filters: [Urgent only] [By supplier ▾] [By raw type ▾] [Min value ▾]               │
│                                                                                      │
│  ┌───────────────┬────────┬───────┬──────┬──────┬──────────┬──────────┬─────────┐  │
│  │ ITEM          │ AVAIL  │ DEMAND│ SAFE │ LEAD │ STOCKOUT │ PO QTY   │ STATUS  │  │
│  │ KRAFT-120-BRWN│ 1,200  │ 1,850 │  500 │ 14d  │ May 12 ⚠ │ 1,500    │ URGENT  │  │
│  │ KRAFT-100-WHT │   800  │ 1,100 │  300 │ 12d  │ May 18   │   900    │ URGENT  │  │
│  │ ADHESIVE-PVA-5│   320  │   210 │  100 │  7d  │ Jun 2    │   400    │ NORMAL  │  │
│  │ … 20 more                                                                         │
│  └───────────────┴────────┴───────┴──────┴──────┴──────────┴──────────┴─────────┘  │
│  selected: 7 items, est ₹4.2 L                                                       │
│                                              [ Generate PO draft → ] [ Export CSV ] │
├────────────────────────────────────────────────────────────────────────────────────┤
│  ◉ TWO-COL: SUPPLIER PERFORMANCE  |  WHAT-IF                                         │
│  ┌────────────────────────────────┬─────────────────────────────────────────────┐  │
│  │ SUPPLIER PERFORMANCE            │ WHAT-IF                                       │  │
│  │ box plot of lead time per       │ Add hypothetical SO ▼  [ SO-XXXX ▾ ]          │  │
│  │ supplier, last 90 days           │ Or accept new qty:   [ Item ▾ ] [ qty ]       │  │
│  │ orange dots = late deliveries    │ → recompute curve, show new stockout dates    │  │
│  │ click row = supplier detail page │ → highlight items that flip from ✓ to ⚠       │  │
│  └────────────────────────────────┴─────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Components

- **`KpiCard`** — same primitive as Analytics. Six cards total, paginated to 4 per row + 2 on next.
- **`HeatmapTable`** — items × weeks grid. Sticky first column. Cell click = filter the curve below to that item + week. Color scale via `STATUS_APPEARANCES.OK / WARN / BAD`. Cells include glyph (✓/⚠/✗) for color-blind safety.
- **`SupplyDemandChart`** — Recharts ComposedChart. Area = projected stock. Reference lines for reorder + safety. Scatter dots = inbound PO arrivals. Vertical reference line = first stockout date (rose). Hover popover shows daily in/out and which jobs consume.
- **`RecommendationsTable`** — `DataTable` primitive: sortable headers, multi-select with running selection summary, status pills (URGENT rose, NORMAL slate, OK emerald), inline action menu per row (Generate PO, Open item, Snooze).
- **`SupplierBoxPlot`** — Recharts can't do box plots natively; build with `Visx` or fallback to a scatter-with-CI custom plot.
- **`WhatIfPanel`** — tiny form: pick existing SO or hypothetical item+qty, click `Recompute`. Returns delta diffs that overlay onto the curve and re-color the heatmap with shimmer animation.

---

## 5. Data & API

```
GET /api/mrp/run?horizonDays=30&scope=plant-a
  → {
      kpis: { atRisk, stockout14d, avgLeadDays, tiedUpStockValue, onOrderValue, stale },
      heatmap: [{ item, status_by_week: [...] }, ...],
      items: [{ item, available, demand, safety, leadDays, stockoutDate, poQty, value, status }, ...],
      suppliers: [{ supplier, leadTimes: [days], onTimePct }, ...]
    }

GET /api/mrp/projection?item=KRAFT-120-BRWN&horizonDays=90
  → { dates: [...], onHand: [...], inbound: [{ date, qty, source }], outbound: [...] }

POST /api/mrp/po-draft
  { lines: [{ item, qty, supplier, expectedDate }] }
  → { draftId, total, lines: [...] }   // saved in DB; printable

POST /api/mrp/whatif
  { hypothetical: [{ item, qty, dueDate }] }
  → { newProjection: {...}, flippedItems: [...] }
```

**MRP run cadence.** On-demand button "Re-run MRP" + nightly cron at 02:00 IST. Result cached in `mrp_run` table with `created_at` so the UI shows "Last run: 2 minutes ago" + a refresh button.

**Projection math (per item, daily granularity):**

```
on_hand[d] = on_hand[d-1] + Σ(po_arrivals on day d) − Σ(consumption on day d)
consumption[d] = Σ over JCs scheduled at any stage on day d × bom[item][stage]
po_arrivals[d] = Σ open PO lines with expected_date == d
first_stockout = min { d | on_hand[d] < 0 }
needed_po_qty = max(0, target_stock − on_hand[stockout_date − lead_time]) rounded up to lot_size
target_stock = reorder + safety
```

The "PO draft 2 needed May 8 → arrive May 19" callouts under the curve are computed by walking the projection: when on-hand crosses safety, work backward by lead time, suggest a PO with arrival = crossing date.

---

## 6. Interactions

- **Pick item** in the curve panel = autocomplete combobox (top-right of curve card). Default = first URGENT item.
- **Heatmap cell click** → curve panel switches to that item, time cursor jumps to that week.
- **Recommendations row click** → curve panel + opens a `DrilldownDrawer` showing: BOM tree (which finished products use this raw), open POs, supplier history, vendor-specific lead time.
- **Multi-select rows** → "Generate PO draft" enabled; total ₹ displays. Confirming opens the PO Draft Modal with grouped-by-supplier preview.
- **What-if** → on Recompute, every heatmap cell that flips status flashes amber (1.2s) so the planner sees impact at a glance.
- **Scenario save** (P1) — name the what-if, share link.

---

## 7. PO Draft modal

Right slide-over, 720px wide:

```
┌─ Generate PO drafts (grouped by supplier) ──────────────────────────────────────┐
│                                                                                   │
│ ┌─ Supplier A ──────────────────────────────────────────────────────────────┐    │
│ │ Lead time avg 11d · On-time 87% (last 30d)                                 │    │
│ │ ┌───────────────┬───────┬─────────┬──────────────┬──────────┐              │    │
│ │ │ ITEM          │ QTY   │ UNIT ₹  │ EXPECTED     │ TOTAL ₹  │              │    │
│ │ │ KRAFT-120-BRW │ 1,500 │ 12.50   │ May 4        │ 18,750   │              │    │
│ │ │ KRAFT-100-WHT │   900 │ 11.00   │ May 4        │  9,900   │              │    │
│ │ └───────────────┴───────┴─────────┴──────────────┴──────────┘              │    │
│ │ Subtotal ₹28,650                                                            │    │
│ └─────────────────────────────────────────────────────────────────────────────┘    │
│ ┌─ Supplier B ──────────────────────────────────────────────────────────────┐    │
│ │ Lead time avg 14d · On-time 72% ⚠                                          │    │
│ │ … rows                                                                      │    │
│ └─────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                   │
│ Total ₹4.2 L · 7 items · 2 suppliers                                             │
│                                                                                   │
│ [ Edit lines ]    [ Save as draft ]    [ Save & email to suppliers ]             │
└───────────────────────────────────────────────────────────────────────────────────┘
```

Saved drafts live in `mrp_po_drafts` and surface in a Drafts tab on the Procurement section (P1 — separate page).

---

## 8. Motion

- KPI numbers count-up (300ms).
- Heatmap reveals row-by-row on first paint (30ms stagger, 80ms each).
- Curve animates left-to-right (600ms).
- What-if recompute: cells flash amber → settle to new color over 1.2s.
- PO draft modal slides in from right, 280ms spring.

---

## 9. Accessibility

- Heatmap cells have `aria-label="KRAFT-120-BRWN, week 22, stockout"`.
- Curve has a keyboard mode (`?` shortcut to jump to it, arrow keys to scrub date cursor).
- Status uses glyph (✓ ⚠ ✗) + color + label — never color alone.
- Box-plot has a fallback table when `prefers-reduced-motion` or screen-reader is detected.
- All numeric cells use `tabular-nums` so the eye can scan columns.

---

## 10. Phasing

**P0 (5–6 days):** Horizon picker, KPI rail, recommendations table with status, PO Draft modal, basic supply/demand line chart (no PO arrival markers yet), CSV export.

**P1 (4–5 days):** Heatmap, full curve with PO arrival markers + suggested PO callouts, supplier box plot, drilldown drawer with BOM tree, "Re-run MRP" button + last-run timestamp.

**P2 (3 days):** What-if panel, scenario save, supplier emailer, mobile read-only.

---

## 11. Trade-offs & revisit

| Decision | Trade-off | Revisit when |
|---|---|---|
| Daily granularity for projection | Right resolution for paper raws (lead times in days) | Move to hourly if raws ever get very fast-moving |
| First-fit-by-stockout for PO suggest | Simple, transparent | Add multi-objective (cost + lead time + supplier reliability) optimizer |
| One MRP run table, no versioning | Simple | Audit needs version history → snapshot on each run |
| Box plots in Visx (extra dep) | Better viz | If dep weight matters, fall back to a custom SVG plot |
| What-if is in-memory, not persisted | Snappy | Users want to compare scenarios → persist as `mrp_scenario` rows |

---

## 12. Open questions

1. Are unit costs in the BOM table reliable? If not, Tied-up stock value and PO totals will be off.
2. Multi-supplier per item — do we always have a preferred supplier, or does the planner pick at PO time?
3. Lot-size rounding — per-item, per-supplier, or both?
4. Is there a procurement approval flow (planner → manager → release)?
5. Does the BOM include process scrap allowance, or do we add it as a wastage % per stage?

Defaults assumed: unit cost present and trusted, preferred supplier picked automatically (override at draft), lot size per-item, no approval flow yet, scrap allowance is in BOM.
