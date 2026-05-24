# Hari Om ERP System Design

## Canonical Business Model

### Sales

- A sales order is a customer PO, often covering multiple weeks or months.
- A sales order contains multiple line items.
- Each line item represents one product variant and carries its own `product_code`.
- The same size can appear on multiple lines when parchment, recipe, or other product conditions differ.
- Production does not consume the whole PO at once.

### Release

- Production demand is created through repeated partial releases from sales order lines.
- Every release captures:
  - source sales-order line
  - release quantity
  - target winder
- Multiple releases can exist for the same sales-order line.

### Job cards and planning

- One release lot becomes one job-card level production truth.
- Scheduling uses stage-level segments so a stage can span multiple shifts or days.
- Planner capacity is managed per machine and shift.
- Winder and process stages can split when planned load exceeds available shift capacity.
- Planner board is a three-day machine-and-shift surface with:
  - left unscheduled queue
  - center machine cards by day and shift
  - manual split control for exceptional breaks
  - tracker page for completed and blocked history

### Execution

- Stage entry records actual start and end times, output, and scrap.
- Tracker reflects current stage and segment posture.
- Reports and analytics read the same execution truth.

## Specification Sheet Model

## Master-driven rules

- Customer, tube, mandrel, papers, parchments, adhesives, packaging, and tooling come from masters.
- Most fields in the sheet should be select-driven unless the business rule genuinely requires numeric/manual entry.
- Packaging selections are always sourced from packaging masters.
- Customer master must carry the downstream commercial fields:
  - address
  - billing/shipping address
  - PAN / GST
  - primary contact
  - dispatch contact
- Paper master must expose:
  - code
  - variety
  - gsm
  - bf
  - ply bond
  - bulk factor
  - derived thickness
  - price
- Adhesive master must expose:
  - variety
  - internal code
  - solid %
  - viscosity
  - ph
  - color
  - recipe note

## Weight model

- Dry tube target is the commercial/spec target.
- Adhesive is global at `15%`.
- Parchment is global at `1.5%`.
- Drying loss is controlled once globally and defaults to `9.0%`.
- Wet tube weight is derived from the dry target and drying divisor `1 - drying_percent / 100`, which defaults to `0.91`.
- No separate free-edit wet-weight truth should exist outside that rule.

## Manufacturing model

- Mandrel defines the manufacturing ID band.
- Recipe paper thickness is the only source for wall thickness.
- Manufacturing OD derives from ID plus double wall thickness.
- Best-mix suggestions are computed from paper masters and the target wet weight.
- Suggestions and live preview use the canonical spec math service and the same manufacturing ID/wall-thickness model.
- Applied recipe rows become the only manufacturing recipe saved into the spec.
- Bamboo length and bamboo dry/wet math come from one manufacturing matrix flow.
- Bamboo output should not be recalculated manually in separate sections.
- Bamboo planning is constrained to:
  - min length `1390 mm`
  - max length `1560 mm`
  - increment `10 mm`
  - cut loss `40 mm`

## Notch and packing model

- Notch details are a mix of master-driven tooling selectors and a small set of numeric inputs.
- Packing uses:
  - `box_code`
  - `box_size` auto-filled from box master
  - `plastic_sku`
  - `fadda_sku`
  - per-box quantities
- Bundle type, bundle code, and packing pcs remain compatibility fields, but the primary visible flow is box/plastic/fadda plus per-box counts.

## Specification sheet UX direction

- One sticky preview rail for summary, recipe, and job-card handoff cues.
- One full-width workspace for active editing.
- Candidate paper pool and best-mix engine come before the saved recipe table.
- Global adhesive mix stays outside the paper-combination table; per-row adhesive pickers should not be the main editing path.
- The current sample-family demos prefer `2 x 250gsm + 1 x 300gsm + best 350+ remainder`.
- Client and manufacturing matrices must both stay visible in the same editing session.
- Avoid repeated summaries of the same math in multiple panels.
- Heavy validation and trial capture stay outside the initial create flow.

## Reporting model

- `/reports` and `/analytics` resolve to the same reporting product.
- Hub contains KPI rail, reconciliation posture, and downstream report entry points.
- Production, inventory, sales, quality, scrap/loss, and plant views all consume shared service truth rather than page-local ad hoc payloads.
