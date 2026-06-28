# Hari Om ERP Decisions

## Decision Log

### 2026-06-28: Stock counts post through adjustment vouchers

- Physical count variance posts through a formal stock adjustment voucher, not a direct edit to item balance.
- Bulk item adjustments post `StockTransaction(ADJUSTMENT)` with voucher id, line id, reason code, and effective date metadata.
- Reel item adjustments preserve reel traceability: positive variance creates a new adjustment reel, while negative variance reduces real current reels and logs scan events.
- Carry-forward posting preserves tracking mode. Reel-tracked carry-forward stock becomes opening reels with source metadata and scan events; bulk carry-forward stock remains opening batches plus ledger transactions.
- QR labels are generated at stock identity creation. Bulk inward returns a batch label payload and reel inward returns a reel label payload so stores can print immediately after inward while the item remains under QC hold.
- Stock-control UI shows count coverage as statement rows over active item masters, keeping physical count sheets complete even for zero-movement items.

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

### 2026-04-15: Sales PO header and line product code are first-class

- Sales order header keeps `po_number` and `po_date`.
- Each line keeps its own `product_code`, `line_no`, and optional `rate_per_pc`.
- Release sync consumes selected lines plus target winder and quantity per line bucket.

### 2026-04-15: Planner board is the primary scheduling surface

- `/planning/board` is the canonical planner screen.
- `/production/planner` should redirect there instead of keeping a parallel stale page.
- The board must expose unscheduled queue, machine-shift lanes for the next three days, and manual split only as an exception control.
- Winder planning must honor the winder selected during sales release. A release assigned to one winder cannot be scheduled on another winder lane.

### 2026-04-24: Tracker and job-card register are separate truths

- `/planning/tracker` tracks customer sales orders from booking through release, WIP stages, and dispatch readiness.
- `/production/job-cards` is the production job-card register and document entry point.
- `/production/reconciliation` is a monthly production variance close; inventory opening/closing/carry-forward remains in `/inventory/stock-control`.

### 2026-04-15: Master-data forms must save the full downstream payload

- Customer form must save commercial + tax + dispatch contact fields, not only basic name and phone.
- Paper form must expose the fields that drive spec math and derived thickness.
- Adhesive form must keep the recipe note alongside the physical parameters.

### 2026-04-15: Spec sheet workflow favors live bridge math over hidden compatibility blocks

- Weight bridge and trial calibration stay visible in the recovered sheet.
- Global glue base remains fixed at `15%`.
- Wet divisor remains `1 - drying_percent / 100`, default `0.905`.
- Packing primary UI is box/plastic/fadda master selection plus per-box usage counts.

### 2026-04-30: Master data is immutable after entry

- Master records are never physically deleted from exposed product flows.
- Disable is the only user-facing removal action and means hidden from future dropdowns/lists.
- Historical sales orders, job cards, specs, ledgers, and audit records keep pointing to the original disabled record.

### 2026-04-30: Spec edit creates a new active version

- Editing an active specification creates the next version as a new row.
- The previous version is disabled/obsolete instead of being overwritten.
- Old production and commercial records remain tied to the exact spec truth they were created with.

### 2026-06-28: Physical stock count is a session, not only a closing number

- Monthly/year-end physical stock count must keep a count session number, count scope, line count state, checker, recount flag, and proof references.
- Count certification can stay operationally simple, but it cannot be certified while any line requires recount.
- The Stock Control page must show every active item line for the plant so the count is complete and auditable.

### 2026-06-28: Customer rejection closure must affect stock when material is scrapped

- Customer rejection disposition must store root-cause department, owner department, corrective action, closure due date/status, cost impact, and proof references.
- Rework/reheat/segregate can remain trace actions, but scrap must post a stock adjustment voucher and remove the rejected finished-good quantity from live stock.
- Customer rejection trace must remain connectable to inward FG, batch, job card metadata, quality records, and adjustment voucher.

### 2026-06-28: Reconciliation reads stock-control through the inventory API contract

- Production reconciliation must call `/inventory/stock-control/certifications`.
- The reconciliation client must accept stock-control's object wrapper (`items`) and plain list responses.
- A bad/missing stock-control response should omit the certification reference, not crash period-state or books-state.
