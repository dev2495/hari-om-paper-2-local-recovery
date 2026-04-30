# Design Specs — Index

One place to find every design document for the Hari Om TubeOS rebuild. All specs are written to land together and lean on the same token system + component primitives. **Read `DESIGN_CRITIQUE.md` first** — every spec below assumes the P0 foundation fixes from it are landing in parallel.

## Foundation

| Doc | Purpose | Status |
|---|---|---|
| `DESIGN_CRITIQUE.md` | System-wide critique + P0–P3 roadmap for tokens, primitives, palette, accessibility | Done |

## Page specs

| Doc | Page | Purpose |
|---|---|---|
| `PLANNER_TRACKER_DESIGN.md` | `/planning/board/*` + `/production/tracker` + printable JC | Tabbed planner (Winder/Oven/Process), tracker, print sheet |
| `ANALYTICS_DESIGN.md` | `/analytics/dashboard` | Proper analytics showcase — KPI rail w/ deltas, multi-chart grid, anomaly flags, drill-down |
| `MRP_DESIGN.md` | `/analytics/mrp` | Supply/demand curves, burn-down per item, stockout-risk heatmap, PO draft flow |
| `OWNER_LANDING_DESIGN.md` | `/` or `/landing/owner` | Owner-first landing: revenue, order book, ops health, risks, dispatch calendar |
| `ADMIN_LANDING_DESIGN.md` | `/landing/admin` | System health, quick actions (cache clear, rebuild), audit log, integrations |
| `REPORTS_SUITE_DESIGN.md` | `/reports/*` | Hub + each of 6 reports (Owner, Production, Sales, Inventory, Plant, Reconciliation) |

## Shared conventions

All specs follow the same structure so they're cross-readable:

```
1. Purpose & audience
2. Layout (ASCII wireframe)
3. Components (broken down + reuse map)
4. Data / API contract
5. Interactions
6. Motion tokens
7. Accessibility
8. Phasing (P0/P1/P2)
9. Trade-offs + what to revisit
10. Open questions
```

## Role-based landing

Landings are role-aware. After login, redirect by role:

| Role | Landing | Doc |
|---|---|---|
| Owner | `/landing/owner` | `OWNER_LANDING_DESIGN.md` |
| Admin | `/landing/admin` | `ADMIN_LANDING_DESIGN.md` |
| Planner | `/planning/board/winder` | `PLANNER_TRACKER_DESIGN.md` |
| Supervisor | `/production/tracker` | `PLANNER_TRACKER_DESIGN.md` |
| Sales | `/sales-orders` | (existing) |
| Analyst | `/analytics/dashboard` | `ANALYTICS_DESIGN.md` |

The current `/dashboard` stays as a fallback for unmapped roles but becomes de-emphasized once role landings are live.

## Ordering — what to ship first

1. **P0 foundation** from `DESIGN_CRITIQUE.md` — tokens, primitives, palette cleanup, ESLint raw-hex rule. **Nothing else lands well without this.**
2. **Planner P0** + Owner landing P0 — the two surfaces your users touch most often.
3. **Analytics** + **MRP** — the "intelligence tier" once the operational tier is cohesive.
4. **Admin landing** — can follow; it's a power-user surface.
5. **Reports suite** — the suite is a retrofit; order of tackling inside the suite is Owner → Production → Sales → Inventory → Reconciliation → Plant.

## Shared components each spec references

- `ExecutiveHero`, `MetricRail`, `MetricCard`, `Panel`, `ExceptionList`, `StickyFilterBar`, `StatusBadge`, `EmptyState` — from `components/erp/shell.tsx`
- `Tabs`, `Dialog`, `Card`, `Button`, `Input` — shadcn primitives in `components/ui/*`
- `STAGE_APPEARANCES`, `STATUS_APPEARANCES`, `MODULE_APPEARANCES`, `ERP_CHART_THEME` — semantic tone source from `lib/erp-appearance.ts`
- New primitives introduced across these specs (and centralized in `components/ui/*` once built):
  - `KpiCard` — replaces ad-hoc MetricCard variants with sparkline + delta + threshold
  - `ChartCard` — standard frame for any chart panel (title, subtitle, legend row, action menu, loading/empty states)
  - `Pill`, `FilterBar` — unified filter chip pattern
  - `DataTable` — sortable, paginated, virtualized, export-capable
  - `InsightCard` — anomaly / insight callout with trend, magnitude, jump-link
  - `DrilldownDrawer` — right-side slide-over for click-through detail

All chart work uses Recharts with the shared `ERP_CHART_THEME`. No colors outside the theme.
