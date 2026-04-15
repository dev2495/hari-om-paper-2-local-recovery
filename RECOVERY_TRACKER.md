# Recovery Tracker

## Current focus

- Restore sales PO flow with multi-line release sync and planner handoff.
- Restore three-day planner board with queue, machine lanes, and tracker.
- Restore spec-sheet bridge math, manufacturing matrix, and master-driven packing.
- Restore master-data pages so downstream fields are editable again.

## Closed in this pass

- `sales-service`
  - `po_number`
  - `po_date`
  - `line_no`
  - `product_code`
  - `rate_per_pc`
- `web-ui sales`
  - sales create form includes `product_code`
  - sales list opens release dialog per selected line
  - release dialog captures target winder + quantity
  - sales detail page shows PO context and line product codes
- `web-ui planner`
  - `/planning/board` is now the main planner workspace
  - `/production/planner` redirects to `/planning/board?section=winder`
  - `/planning/tracker` shows active/completed/blocked history on one page
- `master data`
  - customer API now accepts addresses, tax, and dispatch-contact fields
  - customer, paper, adhesive, and packaging screens expose the missing fields
- `spec sheet`
  - weight bridge visible again
  - trial calibration visible again
  - glue base fixed at `15%` in the primary UI
  - recipe table no longer uses per-row adhesive as the main input path
  - packing section prioritizes box / plastic / fadda master selections

## Verification

- `apps/web-ui`: `npm run build`
- full stack: `bash scripts/runtime_smoke.sh`
- backend syntax: `python3 -m py_compile` on touched Python routers/services
