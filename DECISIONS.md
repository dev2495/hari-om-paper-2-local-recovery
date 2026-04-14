# Hari Om ERP Decisions

## Decision Log

### 2026-04-06: Spec sheet is master-driven by default

- Most spec fields should be selected from masters, not typed manually.
- Manual entry remains only where the business rule requires a measurement or quantity.

### 2026-04-06: Adhesive rule is global

- Adhesive stays fixed at `15%` total base.
- Operators and spec users only choose the adhesive mix components and internal ratio split.
- Legacy adhesive percentage fields may remain in compatibility payloads, but the visible UX should not expose them as separate truths.

### 2026-04-06: Parchment rule is fixed

- Parchment stays fixed at `1.5%` of tube weight.
- Parchment family selection is allowed, but parchment percentage is not treated as a free business variable in the main flow.

### 2026-04-06: Wet weight comes from drying rule

- Wet tube weight is derived from dry tube weight and the single drying-loss rule.
- Default drying loss is `9.5%`.
- The sheet should not repeat wet-weight entry in multiple sections.

### 2026-04-06: Mandrel and paper recipe define manufacturing truth

- Mandrel drives the manufacturing ID band.
- Paper recipe thickness is the only OD/thickness source.
- Manufacturing bamboo math stays single-source and feeds job cards.

### 2026-04-08: Best-mix suggestion is the recipe entry path

- The spec sheet should not start from free-typed recipe rows.
- Users first choose candidate papers from masters.
- The sheet then surfaces best-mix suggestions and applies one into the saved recipe.
- Manual tuning is limited to ply count and positions on the applied recipe rows.

### 2026-04-08: Sample-family workbook rule is fixed for the current demo specs

- The three workbook sample specs use the rule `2 x 250gsm + 1 x 300gsm + best 350+ remainder`.
- The verifier, sample report, and seeded paper whitelist all need to honor that rule together.
- The generated report lives under `reports/spec_sheet_sample_combo_report_*.md`.

### 2026-04-08: Adhesive entry is ratio-only

- Users select 2 or more adhesive masters.
- The only editable glue variable in the main sheet is the ratio split between selected adhesive masters.
- Total ratio must equal `100%`.
- Absolute glue quantity is always derived from the fixed `15%` base.

### 2026-04-08: Job-card manufacturing cues come from the spec preview snapshot

- The spec sheet must persist:
  - recipe rows
  - adhesive components
  - bamboo plan
  - manufacturing OD
  - weight-per-mm and bamboo wet-weight cues
- Job cards and planner should read those saved values instead of recomputing ad hoc UI-only math.

### 2026-04-08: Suggestion OD and preview OD are intentionally different stages

- Before a recipe is applied, best-mix suggestion should size against the client OD.
- After recipe thickness exists, manufacturing preview should switch to manufacturing OD.
- This keeps suggestions stable before recipe selection and keeps saved manufacturing truth accurate after recipe selection.

### 2026-04-06: Packaging is master-led

- `box_code`, `plastic_sku`, and `fadda_sku` come from packaging masters.
- `box_size` is auto-filled from selected box master.
- Packaging should not rely on free-typed names in the primary workflow.

### 2026-04-06: Create flow is lighter than approval flow

- Initial create mode should focus on controlled input and calculation.
- Validation, sign-off, and trial capture unlock after the first saved draft.

### 2026-04-06: Reports and analytics are one product

- `/reports` and `/analytics` should not diverge into separate experiences.
- The reports hub is the shared KPI and navigation surface.

### 2026-04-06: Sales order is a PO, release is operational demand

- Sales orders represent customer PO horizon.
- Repeated partial releases create actual production demand.
- Each release must select quantity and target winder.

### 2026-04-06: One job card is release truth, scheduling is segment truth

- One release lot maps to one job-card business record.
- Scheduling may split stage work into multiple shift/day segments.
