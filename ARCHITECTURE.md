# Hari Om ERP Architecture

## Purpose

This repository runs the Hari Om Paper ERP stack for specification design, commercial order intake, production release, planning, shop-floor execution, reconciliation, and reporting.

This file is the quick pickup map for the system structure. Use it together with `SYSTEM_DESIGN.md` and `DECISIONS.md`.

## Service Topology

### Frontend

- `apps/web-ui`
  - Next.js operational UI
  - shared shell, master pages, specs, sales, planner, tracker, reconciliation, reports

### Backend Gateway

- `apps/bff-api`
  - browser-facing API aggregation layer
  - normalizes frontend contracts across services

### Core Services

- `hariom-erp/services/auth-service`
  - authentication and role access
- `hariom-erp/services/masterdata-service`
  - adhesives, papers, parchments, customers, packaging, tools, mandrels, tube sizes
- `hariom-erp/services/spec-service`
  - specification sheets, recipe calculations, preview math, trials, approval
- `hariom-erp/services/sales-service`
  - sales POs, multi-line order items, releases to production
- `hariom-erp/services/inventory-service`
  - inventory and reconciliation support data
- `hariom-erp/services/production-service`
  - release lots, job cards, planner scheduling, stage execution, tracker
- `hariom-erp/services/analytics-service`
  - reports, KPI dashboards, production analytics, reconciliation rollups

## Browser Flow Map

### Commercial to production

1. Customer PO becomes a sales order with multiple line items.
2. Each line item can be released multiple times.
3. Each release selects a target winder and quantity.
4. Each release lot becomes production truth for planner and job card generation.
5. Planner schedules stage segments across winder, oven, and process.
6. Job cards and scan-entry capture actual stage execution.
7. Tracker and reports read the same execution truth.

### Master-data truth

1. Paper master is the source for code, variety, gsm, bf, ply bond, bulk factor, derived thickness, and price.
2. Adhesive master is the source for variety, internal code, solid %, viscosity, ph, color, and recipe notes.
3. Customer master stores commercial code, address, billing/shipping addresses, PAN, GST, and dispatch contacts.
4. Packaging master stores box, plastic-sheet, and fadda selections used in spec packing and dispatch output.
5. Spec, sales, planner, and job-card pages should read those same master payloads instead of maintaining page-local substitutes.

### Specification flow

1. Select customer, tube size, mandrel, parchment families, papers, adhesives, and packaging from masters.
2. Select a candidate paper pool, then apply a best-mix suggestion into the recipe rows.
3. Split the fixed `15%` adhesive base across 2+ adhesive masters by ratio.
4. Derive manufacturing math from mandrel plus recipe thickness through the spec preview engine.
5. Persist bamboo plan, recipe rows, adhesive mix, notch cues, and packing into the profile snapshot.
6. Save draft, then approve and capture trial data later.

### Current sample-spec rule

- The workbook demo specs are validated against `2 x 250gsm + 1 x 300gsm + best 350+ remainder`.
- The current generated sample evidence is written to `reports/spec_sheet_sample_combo_report_*.md`.

## Spec Sheet Runtime Map

- `apps/web-ui/components/specs/SpecSheetDocument.tsx`
  - primary spec-sheet UI
  - master-driven candidate selection
  - best-mix application
  - manufacturing matrix and preview rail
- `apps/web-ui/components/specs/NotchDiagramPanel.tsx`
  - notch geometry preview/edit surface
- `apps/web-ui/hooks/use-specs.ts`
  - spec preview and suggestion hooks
- `apps/web-ui/lib/spec-math.ts`
  - TypeScript mirror of the canonical spec-sheet math
- `hariom-erp/services/spec-service/src/spec_math.py`
  - authoritative Python spec-sheet math, recipe validation, and bamboo min/max/increment/cut-loss enforcement
- `hariom-erp/services/spec-service/src/calculators.py`
  - compatibility wrapper that delegates preview math to `spec_math.compute_preview`
- `hariom-erp/services/production-service/src/routers/planning.py`
  - consumes saved spec snapshot to generate planner and job-card manufacturing truth

## Current UI Workspaces

- `/dashboard`
- `/sales-orders`
- `/sales-orders/new`
- `/specifications/new`
- `/planning/board`
- `/planning/tracker`
- `/production/job-cards`
- `/production/reconciliation`
- `/operations/control`
- `/logistics/dispatch`
- `/masters`
- `/reports`

## Canonical Runtime Commands

```bash
bash '/Users/devarshthakkar/local_repos/yash hari on/Hari Om Paper 2 Local/start_all.sh'
```

```bash
bash '/Users/devarshthakkar/local_repos/yash hari on/Hari Om Paper 2 Local/status_all.sh'
```

```bash
bash '/Users/devarshthakkar/local_repos/yash hari on/Hari Om Paper 2 Local/stop_all.sh'
```

## Canonical Verification Commands

```bash
bash '/Users/devarshthakkar/local_repos/yash hari on/Hari Om Paper 2 Local/scripts/run_verification.sh'
```

```bash
bash '/Users/devarshthakkar/local_repos/yash hari on/Hari Om Paper 2 Local/scripts/browser_release_gate.sh'
```

```bash
node '/Users/devarshthakkar/local_repos/yash hari on/Hari Om Paper 2 Local/scripts/manual_polish_review.js'
```
