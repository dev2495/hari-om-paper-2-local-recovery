# Owner Landing — Design Spec

**Route.** `/landing/owner` (with redirect from `/` when role = owner)
**Audience.** Company owner / founder. One person. Reads on desktop in the morning, on phone mid-day.
**Promise.** In 10 seconds, an owner knows: *is today okay, what needs my attention, what's the number vs plan, where is money sitting.*

---

## 1. Why this page exists (and doesn't today)

The current `/dashboard` is a role-generic ERP hub — Quick Actions, KPI cards, Cross-app Notifications. It's fine as a default. But the owner needs a different surface:

- The owner doesn't *do* Job Cards or Reconciliation from here. They read.
- The owner's decisions are driven by revenue, order book, WIP, OTIF, risks, cash.
- The owner opens this once or twice a day and wants **signal density, not workflow**.

So: `/landing/owner` is a reading surface. Every number carries context (vs plan, vs last period, target line). Every alert is actionable with one click.

---

## 2. Layout

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  Good morning, Yash.                                          Tue · 21 Apr 2026   │
│  Apr is tracking 6% under plan. OTIF slipped to 78% — 4 orders need eyes.         │
│  Tap a card to drill in.                                                           │
│                                        Range [ MTD ▾ ]   [ All plants ▾ ]  ⚙      │
├──────────────────────────────────────────────────────────────────────────────────┤
│  ◉ HERO KPI HONEYCOMB — 6-up, each clickable                                       │
│  ┌───────────┬───────────┬───────────┬───────────┬───────────┬───────────┐        │
│  │ REVENUE   │ ORDER BOOK│ WIP VALUE │ OTIF      │ BLOCKED   │ CASH-ISH  │        │
│  │ MTD       │ OPEN      │ LIVE      │ 30-DAY    │ JOBS      │ VARIANCE  │        │
│  │ ₹38.4 L   │ ₹62.1 L   │ ₹14.2 L   │ 78%       │ 20 ⚠      │ −₹1.4 L   │        │
│  │ vs plan   │ 206 JCs   │ 150 JCs   │ target 92%│ up 42% WoW│ last 30d  │        │
│  │ ▇▇▇▆▅▅▄   │ ▄▅▅▆▆▇▇  │ ▆▆▅▅▄▄▄  │ ▇▆▅▅▄▄▃  │ ▂▃▄▅▆▇▇  │ ▃▅▆▇▇▇▇  │        │
│  │ −6% ⚠     │ +12% ✓    │ −3%       │ −14pp ⚠   │ +6 ⚠      │ +₹0.4 L ⚠ │        │
│  └───────────┴───────────┴───────────┴───────────┴───────────┴───────────┘        │
├──────────────────────────────────────────────────────────────────────────────────┤
│  ◉ REVENUE WATERFALL — MTD vs plan                          │ ◉ TOP CUSTOMERS      │
│  ┌──────────────────────────────────────────────────────┐   │ Acme      ₹8.4 L 22%│
│  │ Plan        ████████████████████████████████ ₹41 L   │   │ Reliance  ₹6.1 L 16%│
│  │ Booked          ████████████████████████████ ₹38 L   │   │ Asian Pkg ₹4.2 L 11%│
│  │ Dispatched         ████████████████████ ₹29 L         │   │ BlueStar  ₹3.1 L  8%│
│  │ Invoiced              ██████████████ ₹21 L            │   │ … 12 more           │
│  │ Collected                 ██████████ ₹17 L            │   │                      │
│  │                                                        │   │ [ Open sales → ]   │
│  └──────────────────────────────────────────────────────┘   │                      │
├──────────────────────────────────────────────────────────────────────────────────┤
│  ◉ OPERATIONS AT A GLANCE                                                          │
│  ┌────────────────────────────────────┬─────────────────────────────────────────┐ │
│  │ STAGE LOAD (live)                   │ OTIF TREND — last 30d vs target          │ │
│  │ Winder   ████████████░░░ 34 JCs    │ line chart with 92% target line          │ │
│  │ Oven     ███████░░░░░░░░ 18 JCs    │ days below target shaded rose             │ │
│  │ Process  █████████░░░░░░ 22 JCs    │ hover = day detail w/ overdue JCs         │ │
│  │ Packing  ███░░░░░░░░░░░░  9 JCs    │                                           │ │
│  │ QC hold  ██░░░░░░░░░░░░░  3 JCs ⚠  │                                           │ │
│  │ Dispatch █░░░░░░░░░░░░░░  4 JCs    │                                           │ │
│  │ [ Tracker → ]                       │ [ Analytics → ]                           │ │
│  └────────────────────────────────────┴─────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────────────────────┤
│  ◉ NEEDS YOUR EYES                                                                 │
│  ┌──────────────────────────────────────────────────────────────────────────┐    │
│  │ ⚠ 4 sales orders overdue — ₹6.2 L at risk                                 │    │
│  │   SO-002031 Acme  due Apr 18  1 day late         [ Call ] [ Open SO → ] │    │
│  │   SO-002040 Reliance  due Apr 19  1 day late     [ Call ] [ Open SO → ] │    │
│  │   + 2 more                                                                 │    │
│  ├──────────────────────────────────────────────────────────────────────────┤    │
│  │ ⚠ 2 JCs stuck in Oven > 2 days                                            │    │
│  │   JC-00403 73×1.7×280  Acme · 3.2d at O-3         [ Open JC → ]          │    │
│  │   + 1 more                                                                 │    │
│  ├──────────────────────────────────────────────────────────────────────────┤    │
│  │ ⚠ 7 raw items below safety stock — ₹4.2 L buy proposed                    │    │
│  │   KRAFT-120-BRWN will stock out May 12                                     │    │
│  │   [ Open MRP → ]                                                           │    │
│  ├──────────────────────────────────────────────────────────────────────────┤    │
│  │ ⚠ QC hold avg dwell 2.1d — above 1d SLA                                   │    │
│  │   [ Open holds → ]                                                         │    │
│  └──────────────────────────────────────────────────────────────────────────┘    │
├──────────────────────────────────────────────────────────────────────────────────┤
│  ◉ DISPATCH CALENDAR — next 7 days                          │ ◉ PLANT MIX          │
│  Apr 22 Tue ●●● 4 dispatches · 1,820 kg                     │ Plant A ████████ 74% │
│  Apr 23 Wed ●● 2 · 980 kg                                   │ Plant B ██ 21%       │
│  Apr 24 Thu ● 1 · 410 kg                                    │ Plant C ▌ 5%         │
│  Apr 25 Fri ●●●● 6 · 2,380 kg ← peak                        │                      │
│  Apr 26 Sat —                                                │ [ Plant report → ] │
│  Apr 27 Mon ●● 3 · 1,110 kg                                 │                      │
│  Apr 28 Tue ●●● 4 · 1,650 kg                                │                      │
│  [ Open dispatch → ]                                          │                      │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Components

### 3.1 Morning brief (hero text)

- Personalized greeting (Good morning/afternoon/evening by local time).
- One-line factual summary auto-generated from the biggest delta of the day: "Apr is tracking 6% under plan. OTIF slipped to 78% — 4 orders need eyes."
- Owner can click "Refresh brief" (⋯ menu) to regenerate from latest data.
- The sentence is built on the server, not an LLM call, using a rules template — predictable and fast.

### 3.2 KPI honeycomb (6 big cards)

- Same `KpiCard` primitive as Analytics, but **larger** (min 180×140px) with the secondary line (e.g., "206 JCs") and the sparkline both visible.
- **Clicking a card** → jump to the most relevant drill page (Revenue → `/reports/sales`, OTIF → `/analytics/dashboard?filters=otif-low`, Blocked → `/production/tracker?filters=blocked`).
- Cards are **reorderable** (P1) — owner drags the ones they check most to the top.

### 3.3 Revenue waterfall + top customers

- Waterfall chart: Plan → Booked → Dispatched → Invoiced → Collected. Each bar labeled in ₹. Shows the owner exactly where revenue is *stuck* (dispatched but not invoiced = ops problem; invoiced but not collected = AR problem).
- Top customers list (right side) = bar + share % + ₹ value, top 5 by MTD revenue, click = customer drill page.

### 3.4 Operations at a glance

Stage load bars (live WIP by stage) + OTIF trend with target line. Two compact panels side-by-side. Both link out to deeper tools.

### 3.5 Needs your eyes (ExceptionList)

The action surface of this page. Grouped by theme (Sales at risk / Operations stuck / Supply / Quality). Each group has 2-3 items + "show more". Each item has inline action buttons — the owner can act from here without navigating. "Call" opens dialer (tel:) for the customer; "Open SO" jumps to the sales order.

Rule of thumb: if there's a clear owner-level action, surface it. Otherwise aggregate into a summary line with a link.

### 3.6 Dispatch calendar (compact)

Next 7 days, one row per day. Dots = number of dispatches, value = total kg. Peak day gets a subtle callout ("← peak"). Click row → `/production/dispatch?date=…`.

### 3.7 Plant mix

If multi-plant. Just a bar split. Links to the Plant report.

---

## 4. Data & API

```
GET /api/landing/owner?date=2026-04-21
  → {
      brief: { greeting, summary },
      kpis: [{ key, value, unit, secondary, delta, sparkline, threshold, drillUrl }, ...],
      revenueWaterfall: [{ stage: 'Plan', value }, ...],
      topCustomers: [{ name, revenue, share }, ...],
      stageLoad: [{ stage, count, pct }, ...],
      otifTrend: [{ date, pct }, ...], otifTarget: 0.92,
      exceptions: [
        { kind: 'sales_overdue',   items: [...], summaryValue: 620000 },
        { kind: 'jc_stuck_oven',   items: [...] },
        { kind: 'mrp_shortage',    summary: '7 raws below safety · ₹4.2 L' },
        { kind: 'qc_hold_slow',    summary: 'avg dwell 2.1d vs 1d SLA' },
      ],
      dispatchCalendar: [{ date, count, kg }, ...],
      plantMix: [{ plant, revenue, pct }, ...],
    }
```

Single endpoint, single round trip, ~800ms target. The aggregator is the same owner-pack service that already exists — we're just shaping a new response for this surface.

**Refresh.** Pull every 2 minutes while tab visible. Manual refresh button in header.

---

## 5. Interactions

- **Click anywhere** → drill. No hover-only interactions on this page — owners read, they don't hunt.
- **Range picker** changes scope of everything on the page. Comparison is implicit (vs prior period of same length).
- **Plant picker** filters to one plant or aggregates across all. Default: all plants.
- **Exception actions** are one click each. No modals, no confirmations on read actions.
- **Tel: links** open dialer on mobile. On desktop, opens WhatsApp Web if the number is a contact (nice touch for Indian SMEs).

---

## 6. Motion

- First load: stagger KPI cards in 80ms each, left-to-right, with count-up numbers.
- Brief sentence fades in after KPIs.
- Refresh: numbers tween to new values (400ms). Sparklines redraw with morph (Framer Motion `layout`).
- Exception rows slide in from right one at a time on first load; no animation on refresh to avoid noise.
- `prefers-reduced-motion` collapses to instant renders with crossfade only.

---

## 7. Accessibility

- Brief is a `<p>` with an `aria-live="polite"` region so screen readers announce it on refresh.
- KPI cards are `<button>` (the whole card is clickable), `aria-label` reads as "Revenue MTD, 38.4 lakhs, 6 percent below plan, click to drill in."
- Exception list items have explicit role buttons, tab order follows visual order.
- Color is never the only signal — every delta has arrow + sign, every exception has a prefix glyph.
- Honeycomb at small widths collapses to 3-col then 2-col; cards stay legible.

---

## 8. Responsive

- **Desktop ≥ 1280px:** 6-up KPI, 2-col operations + waterfall layout.
- **Tablet 768–1279:** 3-up KPI, operations panels stack below waterfall.
- **Phone < 768:** 2-up KPI, everything stacks. Exceptions list stays prominent. Dispatch calendar becomes horizontal-swipe pills.

Phone usage pattern: owner is in the car / at a client site, wants to glance. So phone priority order: Brief → KPIs → Exceptions → Dispatch. Charts deprioritized (collapsed accordions).

---

## 9. Phasing

**P0 (5–6 days):** Brief + 6-up KPI + Revenue waterfall + Top customers + Stage load + OTIF + Exceptions. One endpoint. Plant mix as a simple bar.

**P1 (3–4 days):** Dispatch calendar, KPI reorder, phone-optimized layout, "Call" quick action, WhatsApp integration.

**P2 (2–3 days):** Saved views (owner picks different default layouts per device), push notifications on critical exceptions, scheduled morning-brief email.

---

## 10. Trade-offs & revisit

| Decision | Trade-off | Revisit when |
|---|---|---|
| Rules-based brief generator | Predictable, fast, no LLM cost | Owner wants more nuanced language → add LLM with rule fallback |
| Single aggregator endpoint | Simple frontend, but tight coupling in backend | If any one panel gets slow, split per-panel |
| Comparison is implicit (prior period) | Owner doesn't need to pick | Add explicit compare (vs plan, vs last year) once sales forecasts exist |
| All exceptions surfaced in one list | Great for glanceable triage; can get long | If > 15 items, paginate; if persistently long, they need a separate triage page |
| Owner = one persona (India SME founder) | Hyper-focused content | As the company grows → split into CEO vs COO vs CFO surfaces |

---

## 11. Open questions

1. **Plan numbers.** Where does "Plan ₹41 L" come from today? If there's no budget system, this card needs "no plan set" empty state with CTA to configure.
2. **Cash-ish card.** Variance cost is a proxy. Does the owner want actual cash in bank (needs bank/ERP link) or this is enough?
3. **Customer drill page.** Does one exist? If not, the "Top customers" links should go to `/sales-orders?customer=…` as a fallback.
4. **Multi-language.** Hindi/Gujarati brief sentence? Owners often prefer local.
5. **"Share brief" feature.** Export the landing as a PDF to email to CFO / board?

Defaults assumed: Plan from a new `sales_plan` table to be introduced; Cash-ish = variance + AR aging; Customer drill = `/sales-orders?customer=`; English only for now; PDF export in P2.
