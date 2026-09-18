# Hari Om ERP — Functional audit and full-cycle Quality Control delivery plan · V2

**Client change request · 17 September 2026 · Revised with dedicated full-cycle Quality Control**  
**Repository:** `dev2495/hari-om-paper-2-local-recovery`  
**Reviewed revision:** `44cf9950850f70de040f6d09d51dcf22495ce8d3` — `main`, commit dated 10 September 2026. [S01]  
**Delivery status:** Revised audit and implementation plan. Main was rechecked at the same SHA. This V2 update performed no repository edits, database changes, production writes, deployment or application acceptance tests.

**Version precedence:** This document replaces the previous implementation handoff. R01–R20 remain in scope. Expanded §11 and phases P00–P13 replace the old narrow QC phase; `QUALITY_CONTROL_BLUEPRINT.md`, `PHASE_TRACKER.json`, `REQUIREMENTS_V2.json` and `ACCEPTANCE_TESTS_V2.json` are synchronized companions. The original package is preserved unchanged under `baseline/` for evidence, not execution precedence.

> **Decision:** Extend the existing ERP, do not replace it. Deliver the client’s named functional changes alongside the Porcelain / Graphite UI, but fix release replay, QC validation and quantity integrity before relying on a whole-order calendar. The inspected source and limited tests do not justify production sign-off today.

## 1. Scope, evidence and how to use this handoff

This document supersedes the earlier **UI-only** restriction only for the functional changes explicitly requested in the latest messages: simplified release-to-winder queue admission; customer/internal order handling; date rules; three-day delivery priorities; stage drill-down; parchment persistence; whole-order scheduling; pending-demand material requirements; supplier schedules; dedicated QC access and stage-specific QC measurements. The prior visual redesign remains the presentation reference. The latest user request additionally authorizes a dedicated Quality Control workspace with item-level inward profiles, pre-save specification tolerance setup, existing-spec quality actions, updated job-card fields/print, mandatory deviation explanations, controlled disposition, reports, relevant-user notifications and full-cycle traceability. These expanded requirements are QCR-01 through QCR-36. Unrelated manufacturing formulas, approval controls, stock posting, period locks and historical records are not approved for redesign.

The evidence comprises the five attached WhatsApp screenshot collages, the one-page `#34 UPPM.pdf`, the sheet inventory, parsed excerpts and selected XML cell/formula ranges of `Book.xlsx`, and the repository files/ranges listed in §22. The screenshots are client requirements and a reported incident, not proof of the currently deployed version. In particular, the current user-creation route renders a different, dynamic role editor from the older role-card screen pictured in the messages. [S10]

The following distinctions apply throughout:

| Evidence category | Meaning |
|---|---|
| Source-verified | A behavior, field or control visible in the inspected pinned source. It is not automatically a live production observation. |
| Reproduced helper behavior | Eight local cases executed against a small reproduction of the inspected QC helpers; no HTTP, authentication, database or production server involved. |
| Source-level risk | Code supports a credible failure path, but concurrent requests or full lifecycle behavior have not been reproduced against the deployed system. |
| Requested change | Explicitly present in the client screenshots or your release/scheduling instruction. |
| Proposed design | Recommended implementation, not a claim that a table, endpoint or workflow already exists. |
| Acceptance gate | Evidence the implementing agent must produce before the change is declared ready. |

The repository connector was used to inspect source. A local full-repository clone was not available because the container could not resolve GitHub. Consequently the full frontend/backend suites, deployed UI, migrations, production data and browser-to-service flows were **not** tested in this audit. No current production pending-order count or material balance has been inferred from the screenshots or workbook. Compare deployed SHA, current HEAD and uncommitted work before implementing; “newly done” local changes may not be in the reviewed commit.

## 2. Executive findings

The stack contains useful real foundations: sales orders have separate lines and release lots; there is a release-to-job-card synchronization path; planning uses stage segments; production quality has inspection and hold entities; procurement supports multi-line API payloads, receipts and incoming QC. Preserve these rather than rebuilding another disconnected application. [S02–S08, S11–S12]

The principal gaps are not just missing screens:

| Priority | Finding | Evidence / consequence | Required response |
|---|---|---|---|
| P0 | Replaying release synchronization can overwrite existing job state | The existing-job branch rebuilds snapshots and invokes the helper that resets winding into the release queue. [S06] | Make unchanged replay a no-op; protect started, split, scheduled and completed work. |
| P0 | Some invalid QC input can be classified as PASS | Non-numeric/blank values and incomplete bounds are skipped by the range checker; status is PASS when no failures are collected. [S07] | One typed, finite-number validator; distinguish incomplete, invalid and passed. |
| P0 | Concurrent sales releases need stronger protection | The inspected sales line release performs read/check/insert without an explicit row lock. [S04] | Lock quantity ownership, preserve stable request identity, and test concurrent releases. |
| P0 | Sales order numbering is count-based | `_next_order_no` uses matching-row count plus one. [S03] | Atomic number allocation and conflict handling; do not attribute the screenshot crash to this without reproduction. |
| P1 | Parchment checkbox does not round-trip as a field | UI sends `parchment_required`; inspected sales schema/model store color but not that boolean. [S02], [S05] | Persist explicit requirement and master-linked variant consistently. |
| P1 | Current MRP is a reorder-policy screen | It compares inventory to reorder/safety levels, not all open sales lines and their BOMs. [S08] | Add authoritative demand/BOM/time-phased coverage, retain reorder policy as a separate view. |
| P1 | Whole-PO scheduling needs explicit delivery/supply allocations | Sales lines have one due date; purchase has one header expected date in the inspected contracts. [S02], [S11] | Add dated quantity schedules and stable links, not another unconnected calendar. |
| P1 | Dedicated QC identity is incomplete in the UI | Backend endpoints accept QC; workspace mapping aliases QC to PlantManager. [S07], [S09], [S12] | Dedicated QC landing/navigation plus tested permissions and plant access. |
| P1 | Job-card priorities and tiles are not the requested behavior | Counts derive from a limited loaded list; stage tiles are plain elements; due predicate and label differ. [S13] | Server-backed aggregates, exact three-day rule and URL-driven stage filtering. |
| P0 | Incoming QC trusts supplied verdict/failure data in the inspected command | Required-field presence is checked, but the new item-specific evaluator is absent from that path. [Q04] | Compute verdicts from owned lot + frozen rules; separate permissioned disposition and remove legacy shortcuts. |
| P1 | Notification helper does not itself take/filter plant scope | Role/user routing exists but its inspected helper has no explicit plant argument. [Q06] | Resolve current authorized plant/resource recipients, deduplicate and log durable delivery. |
| Incident | Client-side exception during “ID creation” is unresolved | Screenshot reports the exception but contains no usable stack trace or reproduction. | Reproduce on the deployed build and fix the actual failing action, not a guessed cause. |

P0 is the proposed rollout priority, not a claim that each risk has caused a recorded production incident. These findings should be resolved before the new functionality becomes the operational source of truth.

## 3. Client requirement register

| ID | Client request | Scope | Current evidence and implementation instruction |
|---|---|---|---|
| R01 | Remove the Sales PO Entry / explanatory queue hero | UI | The large hero is present in the inspected form. Replace it with a compact “New sales order” header. Do not delete the actual planning queue. [S05] |
| R02 | Remove Release Readiness | UI | Remove the side card; retain field errors, permission checks and server approval prerequisites. [S05] |
| R03 | “Customer PO Date” label | UI / contract semantics | Keep the existing date meaning; do not overwrite creation timestamps. [S02], [S05] |
| R04 | “Delivery Date” label | UI / contract semantics | It is the customer commitment, not winding start, oven completion or supplier receipt date. |
| R05 | Delivery date greater than Customer PO Date | Functional | Strictly later; implement on create, edit, delivery schedules, bulk imports and approval validation. Existing inspected inputs do not enforce that relationship. [S02], [S05] |
| R06 | Priority delivery for next three days | Functional | One explicit plant-local calendar rule, same predicate in tile, list, report and export. Keep overdue separate. [S13] |
| R07 | Clicking Winder opens relevant job cards | Navigation / query | Add stage filter to the canonical job-card route, support direct links and browser back. Same for other stage tiles. [S13] |
| R08 | Parchment checkbox/color behavior | Functional repair | Preserve checkbox interaction, require the chosen variant when applicable and persist the boolean; remove stale hidden values when unchecked. [S02], [S05] |
| R09 | Remove repeated Line 1 banner | UI | Remove the decorative banner and filler. Retain accessible line number, add/remove actions and stable row identity. |
| R10 | Internal order without customer PO | Functional | Nullable external PO fields and internal SO numbers already exist. Add explicit origin, understandable form and complete downstream display; retain customer for customer-specific orders. [S02], [S03] |
| R11 | Resolve error during ID creation | Bug investigation | Treat as an unresolved incident. Capture exact route, action, deployed SHA, browser stack and corresponding request. |
| R12 | Add QC role | Authorization + UI | Do not merely add a tile; extend role registration, landing, menu, reads, mutations and negative permission tests. Backend QC hooks already exist. [S07, S09–S10, S12] |
| R13 | Winding QC: I.D., O.D., Height, Weight, C.S. | Functional | Stage-specific approved limits and sample basis, not unconditional reuse of finished-product dimensions. |
| R14 | Oven QC: pre/post weight and pre/post moisture | Functional | Paired readings on the same identified sample/batch; per-stage units, limits and evidence. |
| R15 | Process QC: Height, Weight, C.S., notch distance/depth, moisture | Functional | Conditional notch requirements for applicable products; configure approved numeric ranges. |
| R16 | Sales release asks only for winder queue | Functional policy change | Remove mandrel/geometry/capacity compatibility as release-admission vetoes, including backend sync. Keep identity, permission and quantity integrity. [S06] |
| R17 | All pending orders and total material requirements | Functional | Build full-scope server aggregation and BOM expansion, not totals from the visible page. [S02], [S08], [S13] |
| R18 | Easily schedule an entire PO on calendar | Functional | Whole-order action creates a reviewable multi-line schedule; no loss of partial releases, already started work or prior commitments. |
| R19 | Material/vendor PO scheduling represented in workbook/PDF | Functional expansion | Extend current purchase/GRN system with line-level dated deliveries and incoming evidence. Do not build a second receipt ledger. [A1–A2, S11–S12] |
| R20 | Production-ready end-to-end system | Delivery gates | Require reconciled quantities, tests, operational recovery, client UAT and signed cutover checklist. A visual or compile check is not sign-off. |

## 4. Preserve one connected commercial-to-stock flow

The intended end state is:

`Customer PO or internal sales order → stable order lines → delivery schedule quantities → explicit release lots → selected winder’s queue → dated production segments → stage execution and QC → accepted finished goods → dispatch → fulfillment and close`

Material planning is a connected side of that flow:

`Pending demand + frozen remaining production needs → time-phased material coverage → supplier PO lines and delivery schedules → actual GRN → incoming QC → usable stock → material issue to production`

There must not be three independently editable copies of quantities in Sales, Calendar and MRP. Every projected demand links back to an order line and a source revision. Every issued material movement links to its authoritative job/release or approved allocation. Every fulfillment links back to the correct line; supplier PO numbers never become customer PO numbers.

### Quantity definitions

| Display | Meaning |
|---|---|
| Ordered | Current approved commercial quantity, with amendments/short close shown separately. |
| Customer outstanding | Quantity still owed to customer after fulfilled and authorized cancelled/short-closed quantities. |
| Unreleased | Quantity not yet assigned to an active release lot. The existing `release_remaining_qty` is different from outstanding delivery. [S02] |
| Queued | Released quantity waiting in a winder queue, not necessarily assigned a date or capacity slot. |
| Scheduled | Quantity assigned to a planning segment/calendar slot. This can overlap the released quantity and must not be added to it. |
| In process | Identified quantity currently in production, with current stage and residual needs. |
| QC-held | A separately visible blocked subset of stock or production; not freely usable supply. |
| Accepted FG allocated | Finished goods specifically committed to this demand and not already dispatched. |
| Unscheduled delivery remainder | Commercial commitment not yet split across delivery dates. |

The current sales serialization already distinguishes released and fulfilled quantities; retain that distinction throughout the new screens. [S02] Do not make a donut or dashboard sum released + WIP + scheduled as though those were disjoint populations.

## 5. Sales entry, internal orders, dates and parchment

### 5.1 Compact form and typed origin

Proposed header: **Order source** (`Customer PO` or `Internal sales order`), customer, external PO number when applicable, Customer PO Date when applicable, internal order date and notes. Show the system-generated sales-order reference after save. “Internal” means there is no external customer PO document; it does not automatically authorize make-to-stock, remove the customer, or bypass approval.

For a customer PO, require the client-agreed external reference/date policy and the strict delivery rule. For an internal customer order, hide external PO fields rather than filling them with “NA”, random text or today’s date. Use a separate internal order date. Whether same-day internal delivery is allowed is a client policy decision; do not apply the external-PO rule to a nonexistent date.

Preserve existing order UUIDs and document numbers. Add an explicit origin field with a safe historical migration classification. Blank historical PO numbers are **not sufficient evidence** to label every record as internal: mark ambiguous rows for review. A later customer document should be linked as a controlled amendment, not silently rewrite already released snapshots.

Backend support for optional PO fields already exists, so this is not a new commercial service. The missing work is an explicit contract, visible mode, validation, migration and consistent displays/prints. [S02], [S03]

### 5.2 Date rule

For customer-PO-origin orders, enforce `delivery_date > customer_po_date` as calendar dates. Both equal and earlier dates fail. Keep values as date-only values; do not parse them through UTC timestamps and accidentally shift the displayed day.

A useful error is: **“Delivery date must be after the Customer PO Date (24 Sep 2026).”** Mark the particular line and retain all other entered values. Updating the header date must revalidate every line and schedule row. Validate on the server, not only through an HTML `min` attribute. Validate bulk imports and subsequent approval as well, so an old client cannot bypass the rule.

Do not silently move an existing commitment when it becomes invalid. Drafts need correction; already approved/released orders need a controlled amendment or a documented exception policy. Historical invalid dates should be audited before adding a database constraint that could fail migration.

### 5.3 Stable line identity

Current draft/submitted order updates clear and recreate the line collection. [S04] That behavior becomes dangerous once calendars and demand allocations reference line UUIDs. Implement update-by-ID and explicit add/remove operations before attaching long-lived schedules to draft lines, or restrict schedules to approved immutable lines until that work is done. Never rely on “line 1” as the database identity.

When removing the visual row header, move the Remove control to a compact row action. Retain accessible “Remove line 2” labels, disabled behavior for the last required line and a clear add-line action. Do not remove any field merely because the screenshot only circles the banner.

### 5.4 Parchment is a persistent variant, not a temporary checkbox

The inspected form sends `parchment_required`, but the inspected sales input/model persist `parchment_color` without that boolean. [S02], [S05] Add an explicit persisted flag plus master linkage where a specific parchment variant is needed. Keep a readable color/description snapshot for historic documents; do not identify material solely by the displayed color string.

When checked, enable the variant selector and require a valid selection if the product’s approved policy requires one. When unchecked, clear current draft selection and submit an explicit false/null contract. Reading and editing the saved order must reconstruct the same choice. Carry that value through release snapshots, material planning, job cards, labels, QC and dispatch.

A no-parchment commercial line cannot silently remove parchment from an approved manufacturing recipe. Where commercial choice conflicts with the approved spec, expose the conflict and resolve it through the existing spec/revision process. This repair does not authorize changing the canonical material math. For old records, backfill from reliable evidence; use an explicit unknown/review state when the boolean cannot be reconstructed.

## 6. Sales release: select the winder, then add to its queue

### 6.1 Exact intended interaction

The user selects the approved order/lines and established release quantities, chooses **“Release to planning”**, selects **“Winder queue”**, and confirms. For a whole-remaining-order action, default to the remaining unreleased quantities and show them read-only before confirmation. Preserve the existing partial-release option as a secondary path; do not force the user to schedule a shift or perform a mandrel check just to release.

On success show the released quantities, release reference and **“Open this winder queue.”** While synchronization is incomplete, show “Release recorded — planning synchronization pending,” not a false success or a second fresh release button.

| At queue admission | Required policy |
|---|---|
| Mandrel size / diameter / geometry compatibility | Not a hard blocker. No mandatory override dialog merely to bypass it. |
| Machine shift/day capacity or chosen production date | Not required to join an unscheduled queue. |
| Temporary machine maintenance | May be visible as useful context; not a silent change to the client’s queue-only rule. Execution still respects maintenance controls. |
| Real machine identity, correct plant and WINDER department | Validate; otherwise the reference is not a valid winder queue. |
| Authorization and current session | Preserve. |
| Approved commercial state and allowed release action | Preserve unless separately changed by the owner. |
| Positive finite quantity within unreleased balance | Preserve. |
| Stable idempotency/release identity and completed-operation replay | Preserve and strengthen. |

A queued job does **not** certify that the machine can physically run it. Physical work instructions and true execution safety remain separate. Do not change machine calibration, approved recipes or stage order under this request. Any continued compatibility advisory in planning should be informational and must not be reused as a backdoor release-admission veto.

### 6.2 Change every authoritative release path

The current production sync path explicitly invokes `_validate_machine_compatibility` for the selected winder before creating or syncing the job. [S06] Removing a frontend preflight message alone will not deliver the requested behavior.

Trace the existing sales screen, detail screen, preflight endpoint, line-release mutation, sync endpoint and any legacy direct release route. Separate a small **queue identity/integrity validator** from the existing physical/scheduling compatibility validator. Preserve the latter only at deliberately defined downstream boundaries. Add a regression case in which a mandrel mismatch is accepted into the chosen queue and arrives there unchanged.

Keep the original selected queue as release intent; allow authorized planner reassignment through the planner with a recorded reason/history if the established workflow requires it. Do not change a planner-linked lot’s winder by replaying its release mutation; the existing sales endpoint already guards that distinction. [S04]

### 6.3 Fix replay before changing admission policy

In the inspected `_create_or_sync_job_card_for_line`, an existing release-linked job receives newly rebuilt spec, routing and material snapshots. The subsequent reset helper changes winding stage/segment placement back to a queue anchored to today, including resetting the first open segment to full job quantity. [S06] That is a source-verified mutation path; its exact reachable live effects still need lifecycle tests.

Proposed behavior:

- A replay with the same release identity and payload returns the existing job reference without changing snapshots, segment quantities, dates, status or actuals.
- A request with the same key but a different quantity/spec identity fails with a structured conflict.
- A legitimate change to an unstarted release uses a named amendment/replan command and a version check, never an ordinary retry.
- A started or completed job retains the approved snapshots under which it was executed. Rework or balance carry-forward is explicit and quantity-conserving.

A linked retry must not reset a date, unsplit a job, revive a completed stage or create a second active segment. Persist payload fingerprints and a unique relationship for release lot → canonical job as appropriate to the existing database layout.

### 6.4 Concurrency and cross-service recovery

The inspected sales release path reads the remaining quantity and inserts a new lot without an explicit row lock in that path. [S04] Lock the order/line in a consistent order, re-read active releases in the transaction, validate the new quantity and persist the lot plus a durable delivery/sync intent. Database uniqueness protects identity; it does not alone protect the sum of several different release lots.

If Sales and Production own separate transactions, one local `commit()` is not an atomic two-service transaction. Use a durable outbox/recoverable operation record and idempotent consumer, or an equivalent existing mechanism whose recovery is tested. A browser must be able to close after the sales commit without leaving an unrepairable release. Retry only missing synchronization; do not create fresh lots. Show partial failure for multi-line batches per line, with one stable overall operation reference.

The existing procurement GRN implementation is a useful local pattern: it locks the PO, requires a stable receipt reference, uses a payload fingerprint and returns an existing receipt on matching replay. Preserve that behavior and use the principles, not a blind copy into a different service boundary. [S12] PostgreSQL row locks hold conflicting writers until transaction end; use consistent lock order and bounded retry handling to manage deadlocks. [T1]

## 7. One all-pending-orders workspace

Add a server-backed **Pending orders** workspace covering every eligible order in the authorized plant/scope. Columns should include customer, source, external PO/internal SO reference, line/product, approved spec revision, parchment variant, ordered/fulfilled/outstanding/unreleased quantities, released-not-scheduled quantity, current WIP, QC-held quantity, allocated FG, delivery commitments, shortages and last synchronization state.

Use grouped order rows expandable to lines and call-offs. Filters: plant, customer, source, date window, status, product, missing schedule, material shortage and delivery priority. Keep user search and filters in the URL. A click on a total opens the underlying records with that exact predicate.

**All pending** must not mean the first 100, 250 or 500 records loaded in the browser. The inspected sales list is paginated, purchase list capped, and job-card metrics use a 250-row loaded set. [S03], [S11], [S13] Add aggregate endpoints/read models with explicit total count, pagination/cursor and coverage status. Export must apply the same filters to the full result, not the current page.

A summary returns an `as_of` time, plant scope and source-watermark/version information. If sales or inventory is unavailable, show partial/unavailable data and suppress false “all covered” conclusions. Cross-plant views show separate quantities and units; one plant’s stock does not cover another without an approved transfer.

## 8. Whole-PO calendar scheduling

### 8.1 Three linked calendars, not one overloaded date

| Calendar | Question it answers | Owns |
|---|---|---|
| Customer delivery | What quantity has been promised to this customer on each date? | Commercial delivery/call-off allocations. |
| Production | Which machine/stage/shift will execute which part of the released demand? | Planning segments and their capacity/time allocation. |
| Supplier receipts | What material is the supplier expected to deliver and when will it become usable? | Purchase-line schedules; receipt and incoming-QC links. |

These calendars cross-highlight the same demand/supply chain but maintain distinct dates and permissions. Dragging a customer commitment must not silently alter actual production or post a goods receipt. Saving a supplier delivery schedule must not increase stock.

### 8.2 “Schedule entire PO” interaction

From an order, open a workspace with the complete line list on the left, calendar in the center and material/capacity evidence on the right. Show ordered, outstanding, already scheduled, locked/started, remaining-to-schedule, earliest feasible estimate, promised delivery, and missing information for each line.

The user chooses a date or window, optionally splits quantities, and previews all resulting call-offs/segments. A group action proposes an allocation for every eligible remaining line. The review highlights insufficient material, overload, missing routing/BOM, calendar holidays and already started work. Accepting the preview saves a versioned plan; it does not approve a draft sales order, dispatch FG or release every line automatically.

For customer commitments, allow several delivery dates per order line. Example: a 10,000-piece line can have 2,000, 3,000 and 5,000-piece commitments. For physical production, one delivery bucket may need multiple stages and shifts; one production lot may cover several buckets only through explicit quantity allocations. Do not force a one-to-one relationship that cannot represent the client’s long-horizon orders.

A committed plan must account for all quantities or show an explicit unscheduled remainder. Dragging the whole PO shifts editable future allocations, not delivered quantities, started segments or closed periods. Preserve differences in each line’s date; provide “shift by N days” separately from “make all dates equal.”

### 8.3 Scheduling policy

Support manual planning first, with an optional **Propose schedule** action. Use approved routing, plant working calendar, shift definitions, current bookings and per-stage units. Winding load, oven batches and process tubes are not interchangeable. [S06] Do not claim a feasible completion date when cycle times, yields, usable stock, stage precedence or oven batch rules are missing.

Backward planning from delivery can produce a proposal, but actual commitments remain an authorized decision. A material shortage may remain visible on a future tentative plan; physical issue/start rules continue to enforce real controls. Capacity warnings do not belong in the sales queue-admission step.

The inspected capacity code has stage-specific behavior, including a branch that uses full oven shift capacity during allocation. [S06] Review the intended batch-sharing semantics before using it for automatic whole-order promises. This audit has not proved an oven overbooking incident; it is a required model/test review.

### 8.4 Calendar persistence and interaction quality

Use date-range queries, not a client-side reconstruction from a capped list. Return server-proposed allocations with source versions. Saving a stale preview returns a conflict and the changed lines instead of overwriting another planner. Define the transaction boundary: either all rows in the selected revision commit, or the UI explicitly identifies which rows did not commit.

Retain month/week/day and machine-lane views where already supported; extend the existing planning board rather than create a parallel source of scheduling truth. Include customer/material summary tables for users who prefer the workbook layout. Keyboard-accessible date/quantity forms must do everything drag-and-drop does. Refresh, deep links, browser back, mobile editing and printing must preserve plan identity.

## 9. BOM and material requirements for all pending demand

### 9.1 Keep three measures separate

**Full-order BOM** is a visibility estimate for the whole commercial quantity using the selected approved recipe version. **Remaining manufacturing material** is what unfinished work still requires. **Net procurement requirement** is the shortage after eligible stock, allocations and confirmed time-phased supply are accounted for. They must not be displayed as the same number.

The current MRP page uses inventory and reorder/safety policy. It is useful for replenishment, but cannot answer the requested “total BOM of all pending orders” on its own. [S08] Add demand-driven material planning beside it and label the two modes clearly.

### 9.2 Calculation rules

For unreleased, unstarted production demand, derive material needs from the canonical approved spec engine and the relevant quantity. For released jobs, use their frozen material-plan/spec snapshots, not today’s edited masters. Preserve existing wet/dry bases, adhesive/parchment treatment, cut loss, bamboo choices and packing rules; no browser-only replacement arithmetic.

For existing work, subtract authoritative net material issues from its planned requirement on a consistent basis, add approved rework/additional requirements, and identify residual stages. Do not multiply every outstanding finished tube by the full BOM if its paper has already been issued and wound. Record returns/reversals consistently so material is not available and consumed simultaneously.

At material level, calculate time-phased coverage from usable, unallocated stock; confirmed receipts becoming usable before need time; authorized transfers; and residual demand allocated once. Safety-stock targets and purchasing pack/lot sizes apply as visible policy adjustments after the base requirement. Do not net restricted/QC-held stock as available, or count one receipt against several demands at full quantity.

Material identity must include the needed grade/quality and form where relevant: reel versus slit stock, width, GSM, ply bond, approved supplier/substitution policy, adhesive variety and parchment variant. Never substitute two materials merely because their descriptions contain “350.”

### 9.3 Quantity example — illustrative, not production data

Suppose an order line is 10,000 pieces: 2,000 dispatched, 1,000 accepted FG allocated, 3,000 in WIP and 4,000 not started. The customer outstanding is 8,000, but new-build demand is 4,000 if the stated FG and WIP quantities are valid and not double-allocated. Upcoming material need is the canonical requirement for the 4,000 unstarted pieces **plus residual unissued requirements for the existing 3,000-piece WIP**, not the full BOM of 8,000 fresh pieces.

If 200 WIP pieces are rejected, a disposition/rework/short-close decision determines replacement demand. Do not silently assume scrap creates new demand or that the original finished quantity is still achievable. If FG is returned, distinguish returned physical stock, QC status and reopened commercial demand.

### 9.4 Material coverage panel

Each material row should expose gross demand, already issued, remaining requirement, usable stock, reserved elsewhere, supply due before need, shortage quantity, first shortage date, lead time, suggested purchase quantity and confidence/data-completeness state. Drill-down shows contributing order lines, release lots, spec versions, stock batches and PO schedule rows.

Keep both a by-order BOM tab and a consolidated material/date matrix. Supplier grouping is a purchasing view, not permission to net dissimilar items. An incomplete recipe or missing UOM is **Unknown / needs mapping**, never zero requirement or green coverage. Flag projected shortfalls at the date they first occur; an end-of-month surplus does not cure a mid-month stock-out.

## 10. Supplier purchase orders, workbook calendar and receipts

### 10.1 What already exists and should be retained

The inspected Purchase page already offers PO creation/approval, GRN entry and incoming-QC updates. Its create handler submits a **one-element lines array**, while the purchase API accepts a multi-line list. The API supports material attributes and commercial terms, with a header expected date. [S11]

The GRN path already locks the PO, validates remaining quantities, uses stable request identity and a payload fingerprint, creates batches/movements, tracks partial receipts and puts QC-required stock into restricted status. Receipt QC updates the batch’s availability status. [S12] This is a real foundation, not a blank module. Extend it with a multi-line editor and dated receipt commitments; regression-test existing posting/replay behavior.

The inspected purchase list is limited without an exposed offset in that route. [S11] Add reliable full-dataset retrieval/aggregation for the calendar rather than hiding older still-open POs after the first page. Confirm BFF forwarding and cache keys as part of integration.

### 10.2 What the PDF actually establishes

`#34 UPPM.pdf`, page 1, is a **supplier purchase order**, issued by AMIGO INDUSTRIES UNIT-II to URVASHI PAPER & PULP MILLS PVT LTD. It shows PO 34 dated 03 Jan 2026, six kraft-board lines, each with quantity 50,000, total quantity 300,000 and printed base amount 9,975,000. It lists freight included/landed rates, GST extra, 60-day payment terms and test-report requirements. [A1]

The one-page document does **not** explicitly label the quantity UOM, and it does **not** contain actual dated delivery splits despite its instruction to follow the delivery schedule. Therefore do not import 300,000 as kilograms without confirmation, and do not invent delivery dates. Do not automatically equate that total with the workbook’s UPPM 300 through an assumed kg-to-tonne conversion.

Preserve the exact source specifications, including GSM values 350, 350, 351, 352, 353 and 354, plus PB qualifiers such as `350+`. Do not silently normalize every value to 350 GSM or discard the plus sign. The PDF’s item descriptions use COBB while the test-report text reads CORB; retain source text and request a controlled mapping instead of silently reconciling the terms. The supplier API currently models plybond numerically, so represent a minimum qualifier explicitly or preserve it in validated metadata/display; a float alone cannot represent “350+”. [A1], [S11]

The buyer on the supplied document is AMIGO, not simply the application name Hari Om. Confirm the correct legal entity, plant, document series and letterhead before reproducing a PO. No GST rate, tax jurisdiction or changed payment calculation is proposed here.

### 10.3 What Book.xlsx establishes

The workbook contains `SEP 2026` and `march 2026` sheets. The September sheet includes material/vendor columns, REEL/SLITTED forms, opening stock, daily dates, scheduled totals, requirement rows, projected closing balances, supplier pending-PO comparisons, and a lower product/color/monthly-required block. [A2]

Selected September cells, read without altering the workbook:

| Row / cells | Observed values | Interpretation boundary |
|---|---|---|
| C48 / E48 / F48 | 1,128 / 850 / −278 | Supplier scheduled-total / PENDING / SHORT PO subtotal comparison as laid out in the sheet; not live ERP totals. |
| VATSALYA row 42 | Scheduled 288; pending cell blank; short −288 | Excel formula treats the blank as zero for subtraction; blank is not proof of no open supplier PO. |
| UPPM row 43 | 300 / 300 / 0 | The workbook balances this supplier subtotal, but no source-level UOM link to PDF PO 34 is given. |
| AKHSAT row 44 | 288 / 300 / +12 | Surplus in that subtotal; not automatically interchangeable with another supplier/material. |
| BN row 45 | 252 / 250 / −2 | Shortfall in that subtotal. |
| AE40 / AF40 | −3 / −38 | Negative projected closing cells, not verified stock ledger shortages. |
| AC53 | Monthly-required total 72,000 | Lower block; the rows beneath use April 2026 dates despite the September sheet name. |

The subtotal arithmetic 850 − 1,128 = −278 is consistent. However, under the workbook’s own blank-as-zero arithmetic, supplier deficits are 288 + 2 = 290 and the separate positive difference is 12. A net −278 hides that distribution. A real material-planning engine should preserve item/supplier identity and distinguish unknown commitments; it must not treat +12 as universal substitute supply.

Several requirement cells in row 39 use constants such as `(110/30)*27`, rather than traceable live sales-order BOM contributions. Some closing-stock formulas include a different set of opening cells from the corresponding scheduled-total grouping. Treat these as **mapping/reconciliation questions**, not automatically correct or automatically wrong. The system must replace fragile column arithmetic with an explicit, approved material-family mapping and provenance. Original formulas and cached values are recorded in the accompanying workbook evidence file; the entire workbook was not recalculated.

The lower block’s April dates should be preserved and flagged at import review. Do not silently turn April into September or fabricate actual transactions from a planning worksheet. Scheduled deliveries, actual receipts and planned production are separate import categories.

### 10.4 Supplier scheduling implementation

A multi-line supplier PO should allow each line to have several dated delivery quantities, with remaining unscheduled balance, supplier confirmation, receiving plant, relevant material attributes, original promised date and current expected date. A calendar entry is a commitment, not a stock transaction.

The calendar shows material/date quantities, supplier/PO references, unit, confirmed versus tentative supply, received quantity, pending incoming QC and overdue shipments. Drill down to the actual PO and GRNs. Link a receipt quantity to the specific supplier schedule allocation; allow partial receipts and explicitly manage shortages, rejects, replacement deliveries and cancelled balances.

Store supplier test reports/challans as real document evidence linked to receipt/batch. The existing free-text test-report terms are not proof that the documents were attached or that tests were passed. Extend incoming QC readings where needed; keep “expected arrival” separate from “expected usable after QC.”

A staged import previews the sheet/tab/row/cell, raw value/formula/cache, intended record type, unit, material/vendor match and validation error before commit. Match duplicates by document and line identity plus a stable import key; re-upload must not create additional POs or inward stock. Attach the original source for audit.

## 11. Dedicated full-cycle Quality Control module

**V2 expansion — replaces the previous narrow QC section.** The standalone companion is `QUALITY_CONTROL_BLUEPRINT.md`.

### 11.1. Recommended decision and scope

Build **one Quality Control business module within the existing ERP**, not a new standalone application or a new microservice at this stage. Expand the existing Quality page into a coherent workspace, reuse existing inventory and production records, and embed the same approved requirements in inward forms, specification sheets and job cards. One measurement recorded in an embedded job-card form must appear in the Quality workspace without being entered again.

This supersedes the previous narrow QC-workflow phase. It adds item-specific incoming inspection profiles, specification-stage tolerances, the pre-save tolerance dialog, legacy-spec actions, updated job-card inputs and print, deviation reasons, controlled disposition, scoped notifications, reports and post-dispatch quality follow-up. It does not supersede the other twenty original requirements.

The protected release rule remains unchanged: **sales release asks which valid, authorized same-plant winder queue to use, with no mandrel/geometry/capacity veto.** Missing new QC setup is visible in that queue and must be resolved before the applicable manufacturing checkpoint, not used to recreate a queue-admission blocker. Recording actual production is different from authorizing its quality release.

Non-negotiable principles:

- A reason explains a failed reading; it does not turn that reading into PASS or authorize stock use.
- Tolerances belong to approved, versioned profiles. Actual readings belong to identified inspection samples. Release decisions belong to authorized dispositions for identified quantities.
- Physical inward can be recorded while quality is pending. Pending, held or rejected stock is not available-to-use stock.
- Readings and historic profiles remain interpretable after revisions, retests, returns, migration and offline/late entry. No silent retrospective rewriting.

### 11.2. Existing foundations and verified gaps

| Pinned source observation | Design consequence |
|---|---|
| The existing `/quality` UI reads production inspections/holds, inventory templates, pending inward checks and customer rejections. Its stage fields are largely a fixed generic array. [Q02] | Refactor this workspace and its hooks into focused views; do not create a competing quality ledger or a second return flow. |
| Inventory quality templates are selected by material type and plant/global scope. The inspected upsert contract contains label, input type/options, requiredness and ordering, but not the proposed item-specific approved tolerance revision. [Q03] | Preserve field definitions as migration inputs; add item bindings, units/methods, bounds, approval and immutable versions. Type presets are starting points, not approved item requirements. |
| The inspected inventory-inspection command accepts supplied status/failures; PASS checks required-field presence, and supplied disposition participates in setting stock status. [Q04] | Replace client-authored verdicts with server evaluation and a separate permissioned disposition command. Audit every old direct PASS/ACCEPT path, including the purchase desk. This is a source finding, not a reproduced live incident. |
| Specifications already have final/general dimensional, weight, C.S. and moisture bounds and a version/status model. [Q05] | Preserve those values and create one canonical final-limit representation; do not leave two independently editable final tolerance sets. |
| The existing notification helper resolves active users by role or explicit user ID but has no explicit plant-scope argument/filter within the inspected helper. [Q06] | Reuse notification storage/UI, but add authorized plant/resource resolution, deduplication and delivery history. Caller protection has not been exhaustively audited. |
| QC is mapped to PlantManager in the canonical role mapping; role seeding migrates/removes legacy role names. [Q07] | Register QC canonically before assigning it. Update seeds, permissions, landing, service allowlists and caches together so a restart does not remap/remove it. |
| The original audit found unsafe missing/invalid production-QC PASS semantics. [B1 §11] | Fix validation early across inventory, dedicated production inspections, inline job entry and all completion paths. |

The above observations support extending the stack; they do not certify that the currently deployed release has identical behavior. The exact save handler, all write callers and actual database migrations must be traced in Phase P00.

### 11.3. Workspace and service ownership

Proposed user-facing navigation:

| View | Purpose |
|---|---|
| Overview / My work | Inspections due, reasons pending, held quantities, assigned reviews, overdue actions and setup gaps. |
| Quality setup | Parameter dictionary, material/item profiles, spec-stage profiles, approved templates, methods, instruments and exemptions. |
| Incoming quality | PO/GRN/batch/reel-linked checks, supplier declarations and evidence, partial acceptance and returns. |
| Production quality | Winding, oven, process and existing applicable packing/final checks, with job/segment/shift/sample context. |
| Exceptions and holds | Nonconformances, containment, reasons, review, disposition, retests and quantity release. |
| Customer returns / corrective actions | Existing return records linked to dispatch and genealogy; root cause, actions and effectiveness verification. |
| Reports | Full-dataset filtered reports, parameter trends, supplier outcomes, first-pass results, concessions and audit trails. |

These are views of one workflow, not seven independent systems. Use the existing visual language and Porcelain / Graphite presentation. Avoid another giant hero, manual duplicate entry and badges with no underlying record.

Recommended backend ownership, subject to verifying exact current modules:

| Owner | Authoritative records and commands |
|---|---|
| Masterdata service | Shared parameter codes/display definitions, measurement methods, instrument references, reason-code taxonomy and centrally managed defaults where appropriate. |
| Inventory service | Item-specific incoming-profile revisions/bindings; GRN/reel/batch inspections; incoming/returned-stock nonconformances; physical stock restriction, partition, issue and release. Extend existing inventory quality entities rather than duplicate their ledger. |
| Spec service | Spec-stage and final QC-profile revisions, approval, spec binding and the save-spec-with-QC command. Same-database changes should commit together. |
| Production service | Frozen job QC context; process/final observations by operation/segment/sample; WIP holds, rework and production quality decisions. |
| Auth / existing notification infrastructure | QC capabilities, plant/user access, routed in-app notifications and delivery records. |
| Analytics service / BFF | Authorized cross-module read models and reports. They are not allowed to independently approve QC or set stock availability. |
| Shared domain package | Typed profile/readings contract, deterministic evaluation and golden fixtures, used by Inventory and Production. This is shared code, not a cross-service shared database. |

One reusable frontend tolerance editor and one reusable measurement renderer should serve masters, spec dialog, Quality and job-card entry. The server is authoritative; frontend feedback is only a preview. Pin shared evaluator contract versions across service deployments and reject incompatible schema/engine versions rather than allowing diverging verdicts.

Use local database transactions for measurements, local cases/holds and integration intents; use durable, idempotent coordination across services. An outbox solves the commit-and-notification dual-write problem, but consumers must still tolerate duplicates. It does not turn several databases into one transaction. [TQ02]

### 11.4. Parameter dictionary and profile design

#### 11.4.1 What one parameter defines

A parameter needs a stable internal code, client-facing name, description/help, value type, measurement unit, specimen/basis, method and instrument requirement. The dictionary defines what the parameter means; a profile defines the requirement for one item/spec and checkpoint.

Profile fields should include stage/checkpoint, parameter code, applicability, requirement timing, target, comparison rule, lower/upper bounds with inclusive/exclusive flags, displayed precision, validated storage precision, permitted categorical values, sampling rule, severity, and action when nonconforming. For text-only observations, define them as descriptive: arbitrary text cannot establish a measured PASS.

Support numeric ranges, minimum-only, maximum-only, target with asymmetric tolerance, categorical/boolean checks with explicit accepted values, descriptive evidence, and a small allowlisted set of derived comparisons. A target alone is not a tolerance. Lower/upper bounds must be normalized from target/deltas into one authoritative rule, not independently editable competing values.

Store numeric readings in a deliberate exact-decimal contract where appropriate, retaining the submitted representation and unit. Reject malformed values, NaN/infinities and booleans used as numbers before comparison. Finite validation is supported by the current Pydantic documentation, but the implementing agent must match the repository's pinned version and explicitly test boolean/coercion behavior. [TQ01]

Never use JavaScript truthiness to distinguish blank from zero. Never round a failing reading into range: compare using the approved rule precision, then display sufficient digits to explain the result. Set engineering plausibility rules separately from acceptance limits; a plausible out-of-spec reading is a valid observation, not an invalid input.

#### 11.4.2 Approved, resolved profiles

Lifecycle: **Draft → Submitted for review → Approved/effective → Superseded or retired.** Rejected drafts return to their author. Publishing a profile is not the same as saving it, and copying a template never automatically approves it.

A category template is a starting point. Approve a resolved item/plant profile or spec-version/stage profile before it governs acceptance. Show each inherited/copied value's origin. Do not dynamically merge whichever global or plant row happens to be last in a query.

If a supplier-specific or PO-specific requirement applies, resolve it explicitly against the item's approved requirements before receipt. A supplier certificate cannot override a customer or item requirement. Combine compatible constraints only when unit, method and specimen match; conflicting requirements block profile approval for review. An authorized contractual exception is a recorded concession or revision, not a hidden weakening of the comparison.

A profile snapshot includes the full normalized rules, parameter labels/help, units/methods, applicability, sample/aggregation policy, approval/effective metadata, profile hash and evaluator version. This enables meaningful historic displays even after the shared dictionary changes.

#### 11.4.3 Sampling and timing

Configure how many samples, which sampling occasion and what unit/lot the result covers. Options may include each inward lot, a reel, first-off setup, defined intervals, shift, segment, oven batch, after adjustment, and final release. These are supported policy types, not invented frequencies or a claim of compliance with a sampling standard.

Sample count, specimen size and affected production/stock quantity are different quantities. One failed sample does not automatically prove the entire lot is scrap; the approved containment/disposition policy decides what must be held or tested further. A configured whole-lot hold is nevertheless binding until released.

Averaging must not conceal an individual failure unless an approved method explicitly evaluates an aggregate. Preserve all specimen values and the stated aggregation rule. Do not assemble a fake passing inspection by selecting favorable values from different retest rounds.

For oven pre/post tests, use the same specimen or traceable batch basis and a `pair_id`. At pre-entry, post-values are **not yet due**; at the post checkpoint they may become required. A post reading without valid pre-context is not a complete paired test. Derived weight/moisture change is additional calculated evidence, not a replacement for the four requested measured fields.

### 11.5. Incoming master-item quality

#### 11.5.1 Master UI

Every inward-capable master item exposes **Quality setup**. Show item code/name, material type, plant, procurement/stock UOM, reel/slit/form/grade details where relevant, supplier context and applicable profile status.

Required setting: **Inspection required**, **Approved exemption / not required**, or **Setup incomplete**. A default blank is not an exemption. Exemptions need authority, reason, scope and review/effective dates where applicable; they display NOT REQUIRED, not PASS.

Support appropriate profiles for raw paper/reels/slit stock, adhesives, parchment, packaging, purchased finished goods, tools and other inward categories. Do not force GSM into a tool-receipt form, and do not reuse the existing customer-rejection “reject reason” preset as mandatory acceptance criteria for all new finished goods.

Existing raw-paper presets include GSM, BS/BF, caliper, bulk, ply bond, RCT, COBB, moisture and clear-for-slitting; adhesive and parchment presets also exist. Preserve those as source-derived candidate fields, not universal required tests. [Q03] The supplied PO page requests supplier test evidence and describes widths, GSM, PB/bulk and COBB. It does not establish complete tolerances, sampling plans or measurement units for every quality field. [A1]

Preserve raw contract strings such as `350+ PB` until the comparator, method and unit have an approved mapping. A nominal GSM, target weight or printed material description must never silently become an invented ± tolerance.

#### 11.5.2 Full inward flow

**PO requirement snapshot → physical GRN/reel inward → restricted received stock → inspection task → sample readings/evidence → server evaluation → authorized quantity disposition → stock availability → production issue.**

On an actual receipt, bind the applicable approved requirements and create one inspection task for each approved inspection unit/lot. Preserve partial deliveries, reel identity, supplier lots and multiple batches within a GRN. Receiving quantities is not conditioned on having passed QC: the system must represent material that physically arrived but cannot yet be used.

The GRN transaction records physical receipt and any applicable restriction plus durable task/notification intent. Quality-task generation must be idempotent on receipt retry. Missing required setup produces restricted **Awaiting quality setup**, not a blank screen or freely usable stock. Supplier certificates, photos and lab files attach to the actual receipt/lot; “test report required” text is not proof of attachment.

The inspector records local readings separately from supplier-declared readings. Document inspection or supplier-certificate acceptance may be an explicitly approved policy for a particular item, with its evidence source shown. It must not fabricate locally measured values or quietly count as a laboratory-measured PASS.

#### 11.5.3 Quantity and inventory behavior

Separate physical receipt quantity, inspection coverage, sample quantity, unrestricted quantity, concession-restricted quantity, held quantity, rework quantity and returned/scrapped quantity. Quantity partitions must reconcile in their own UOM. A partial PASS must not set an entire parent batch unrestricted.

Example, illustrative only: 1,000 units received; 600 accepted and 400 held. Available stock is at most the 600 accepted units less other commitments. The 400 remains identifiable and restricted. Implement true batch/sub-lot partitioning or quantity-based restrictions that all balance/reservation/issue endpoints understand; a UI-only split is insufficient.

A disposition such as REWORK/REHEAT does not make material unrestricted merely because an existing enum maps it to WIP. Preserve physical location, quality eligibility and allocated quantity separately. Returns and scrap use existing authoritative movement/voucher logic and period protections; they do not delete the receipt or manufacture a second receipt on retry.

Purchasing sees supplier rejection, replacement required and revised usable-date risk. A supplier replacement promise is scheduled supply, not actual unrestricted stock. MRP excludes held/rejected/pending portions and avoids counting a returned lot and its replacement twice.

### 11.6. Spec sheet: pre-save Quality tolerance dialog

#### 11.6.1 New-spec interaction

The visible flow should be **Fill spec → Save specification → Review quality tolerances → Save draft or submit the spec/QC bundle for approval**. The dialog appears on the deliberate save action, before final save/submission; do not open it repeatedly on autosave or each field change.

Use a large modal with stage tabs on desktop and a full-page drawer/workspace on smaller screens. Keep a read-only context panel visible: customer, product/spec reference or draft reference, plant, I.D./O.D./Height or length description, target weight, required C.S., recipe/ply summary, parchment condition, notching applicability and relevant manufacturing context. Label targets as targets and existing contractual limits as limits.

Show the client-named fields for Winding, Oven and Process, plus existing applicable final-QC requirements. Slitting/packing checks may be supported by approved profiles but are not automatically added as mandatory tests merely because the routing has those stages.

Each row exposes parameter, method/basis, unit, target, lower/upper or one-sided rule, requiredness/timing, sampling and help. Reuse verified final tolerance values when their meaning matches; do not copy final finished-product limits into winding merely because names are similar. Never auto-fill measured results with nominal targets.

Buttons: **Back to specification**, **Save draft — QC incomplete**, and **Save specification + QC / Submit for approval** according to the user's capabilities and the existing spec workflow. Draft save preserves work without approving anything. Blocking configuration issues prevent approval/readiness, not retention of a draft. Closing/back keeps all entered specification and tolerance values; discard requires explicit confirmation.

Do not let a successful modal save silently publish the spec or authorize production. Required measurement definitions, actual thresholds and approval remain configured business controls.

#### 11.6.2 Persistence and synchronization

Use a single spec-service command to validate and save the spec draft and its QC-profile draft atomically when they share a database. Keep a stable save-operation key, payload fingerprint and optimistic version. Double-click or a lost response must return the same spec/profile, not create duplicates. Where the existing recipe save is a separate operation, either include it in a validated same-service aggregate or show a durable incomplete-save state; do not falsely claim multi-call atomicity.

Bind the profile to the specific spec version. After the user changes dimensions, recipe, weight, parchment or notching, show which QC rules need review. Do not silently recalculate tolerances from the new target. A stale dialog based on an older spec revision cannot overwrite a concurrent edit.

Final dimensional/weight/C.S. limits must have one owner. During migration, import existing final limit fields through an explicit adapter. After cutover, the approved final profile is canonical and old fields are read-only compatibility projections updated by the same spec command. Until this is implemented, preserve the existing canonical final fields rather than exposing two independent editors. Contractual final-limit changes require the normal spec/customer approval process; a routine process-QC-only revision need not unnecessarily rewrite the commercial recipe.

#### 11.6.3 Existing-spec list action

| Current state | Row action and badge |
|---|---|
| No configured profile | **Add quality parameters** · Missing setup |
| Draft/incomplete profile | **Complete quality setup** · Draft / Missing fields |
| Pending review | **Review quality parameters** for approvers; **View pending** for others |
| Approved profile | **View quality parameters**; authorized **Create QC revision** |
| Superseded/retired spec | Read historical profile; no silent reactivation |

The action opens the same context-rich editor, preloaded with real existing values. Preserve existing spec IDs, recipe links, approvals and issued job snapshots. Adding a QC revision to an approved existing spec requires its own controlled approval/effective scope, not an unnoticed edit to the approved record.

A bulk **Assign profile to selected specs** operation is useful only with a compatibility preview, per-spec unresolved fields, explicit scope and approvals. It must not publish one guessed tolerance range to every product.

### 11.7. Exact client-stage field set

| Stage | Fields to implement | Required interpretation controls |
|---|---|---|
| Winding | **I.D., O.D., Height, Weight, C.S.** | Confirm Height at winding, weight specimen, C.S. unit/method; do not assume finished-tube limits. |
| Oven | **Pre-weight, Post-weight, Pre-moisture, Post-moisture** | Pair readings with specimen/batch identity, phase times and common basis; post-values become due at the right checkpoint. |
| Process | **Height, Weight, C.S., Notch distance, Notch depth, Moisture** | Use approved applicability for non-notched products; NOT APPLICABLE is not zero. |
| Existing final acceptance | Existing approved final dimensions, weight/C.S. and other applicable checks | Preserve and reconcile current final-release policy; no duplication or weakening by the new process templates. |

The measurement names are the client's requested names carried forward from the original requirement register. The business must supply/approve the actual tolerances, methods, units and sample frequencies. The design supports them without inventing manufacturing specifications.

### 11.8. Job-card entry, printed card and full-card submission

#### 11.8.1 One inspection record, multiple entry surfaces

Update the canonical `JobCardDocument.tsx` renderer and the actual interactive input components, entry routes, supervisor/EOD entry, stage completion payloads, hooks and print paths. Merely adding tolerance text to a PDF or job preview is not completion.

Beneath every QC input show **approved acceptable range/rule + unit**, **target when present**, **sample/method help**, **checkpoint timing** and **QC revision**. For example, a design-only field may show `Allowed: 76.00–76.20 mm; inclusive. Sample: tube cross-section. QC rev 3.` These numbers are illustrative and must not seed live requirements.

Show readable status text and an icon, not color alone. On a failing entry show the measured value, nearest breached limit and difference in the correct unit. Display the reason section adjacent to the field. On mobile, no horizontal scrolling should be required to enter a measurement and its reason. A per-stage summary links to each issue.

The printed job card repeats the applicable frozen tolerances directly below/alongside each blank reading row, with sample columns, paired oven readings, reason/containment area, operator/inspector, measured date/time, stage/machine/shift, approval status, profile revision and QR/reference to the authoritative record. Print submitted cards with real readings and statuses; never render missing values as 0 or blank space as PASS. Handle page breaks/repeated table headings and both blank and completed forms.

#### 11.8.2 Save observations without hiding failure

Typing and preview are side-effect free. **Save readings** durably records the observed values; an out-of-range value is legitimate evidence and should not be rejected just because it fails the specification. On durable save, create/update the visible exception and configured local hold even when explanatory details are still incomplete. Mark the case **Reason pending**. Preserve observations through lost connections or validation errors.

Final submission requires a reason code and useful explanation for each failed parameter, or one explicitly linked common-cause explanation for several failures. Capture immediate containment, affected quantity/scope and responsible person. Where the cause is not known, permit **Cause under investigation** plus facts/containment/owner; do not force workers to invent a root cause to save a genuine failure. The completed root-cause analysis is a later controlled action.

Changing a saved reading to an in-range value cannot erase the original result or automatically clear its hold. A correction includes who, when, prior value, replacement value, reason and review requirement. Published/signed measurements are immutable; corrections or retests create linked records.

#### 11.8.3 Complete job-card entry

The server validates all applicable due readings for every recorded stage occurrence, sample and segment—not only the currently visible tab. Return a structured exception summary with stage, parameter, sample, actual, approved rule, outcome, missing reason and permitted next actions. The UI preserves the full entered card on any failure.

Keep **physical actuals recorded**, **production stage finished**, **quality review pending**, **quality released**, and **job closed** distinct. A failing batch may physically have been produced; hiding that output would corrupt stock/WIP. Record its actual output as restricted/held under the established posting logic, while withholding applicable release/close/dispatch authority. Neither an exception reason nor the act of saving a complete card makes rejected pieces good output.

Apply the same contract to dedicated Quality entry, job-card inline entry, EOD/supervisor entry, imports, direct APIs, legacy clients and any stage-complete/FG-inward shortcuts. The browser cannot supply a trusted aggregate PASS, failure list, quality waiver or arbitrary stock status.

#### 11.8.4 Timing, offline and retrospective entry

Store `measured_at`, `recorded_at`, operator/inspector, source device/form and entry mode separately. For retrospective paper-card entry, detect a failure discovered after downstream work or dispatch and label it **Late quality exception**. Trace affected surviving material/WIP/FG and alert owners. Do not claim that the ERP prevented a movement that occurred before the measurement was entered.

Offline drafts are not authoritative releases. On reconnect, validate against the frozen context, reject stale writes safely and retain all observations. Do not embed login tokens or sensitive full records in QR codes/local storage. Provide a documented site procedure for unresolved quality/network outages; software cannot retrospectively control unrecorded physical movement.

### 11.9. Results, reasons, holds and dispositions are separate

Use separate state dimensions rather than one overloaded status:

| Dimension | Proposed examples | Meaning |
|---|---|---|
| Workflow | DRAFT, SUBMITTED, REVIEWED, SUPERSEDED | Whether the inspection is prepared, signed/reviewed or replaced by an auditable correction. |
| Evaluation | PASS, FAIL, INCOMPLETE, INVALID, NOT_APPLICABLE, OBSERVATION_ONLY | What the measurements prove under the frozen approved rules. |
| Eligibility/disposition | PENDING, RELEASED, RELEASED_BY_CONCESSION, REWORK, RETURN, SCRAP, BLOCKED | What an authorized quantity may do next. |
| Task | OPEN, ASSIGNED, ACKNOWLEDGED, RESOLVED | Work ownership; notification acknowledgement does not release quality. |

These labels require an explicit schema/legacy mapping; do not insert them into existing enums without migration. An empty test set is not 100% PASS. NOT REQUIRED, NOT APPLICABLE and supplier-certificate acceptance must remain distinguishable from measured PASS.

A nonconformance groups related failed results on a defined lot/checkpoint/inspection round while retaining each failed parameter and reason. It records severity, containment, affected quantity, linked orders/jobs/receipts, assignee, due policy, evidence and timeline. Grouping reduces notification noise, not evidence detail.

Recommended default policy for approval during rollout: QC-required inward stays unavailable until cleared; required final acceptance blocks FG availability/dispatch; required process checkpoints enforce their configured transition policy. All durable failures create a case/reason requirement. Whether an individual routine process failure blocks its next stage or is a formally accepted advisory is an approved profile-level policy, not an accidental UI default. Missing profile setup never becomes a measured PASS.

Keep routine work simple: when an authorized QC user signs a complete conforming inspection, an approved policy may accept its covered quantity in the same owner-local workflow, provided there are no other holds or required reviews. Do not impose a second approval on every ordinary PASS by accident. Separate review is for the checkpoints/severities/dispositions that actually require it; operator entry alone is not QC sign-off.

Disposition options must be explicit and quantity-scoped: accept conforming material, authorize a constrained concession, rework/reheat, segregate/inspect further, return to supplier or scrap. A concession records authority, reason, exact quantity, permitted use/customer/order where relevant, expiry and customer approval evidence when contractually required. Concession stock must not become universally interchangeable unrestricted supply if its authorization is restricted to one use.

Critical/safety-designated criteria can be configured as non-waivable under the approved policy. QC inspectors do not gain automatic power to approve their own major failure, modify inventory quantities, authorize commercial concessions or change user access. Use capabilities with a configured second-person requirement for designated dispositions, not a meaningless universal override textbox.

### 11.10. Retest, rework, final acceptance and customer feedback

A retest references the original case, affected material, intervention/correction, new sample round, approved method and unchanged applicable limit snapshot. Preserve both results. A retest PASS supports a review; it does not automatically erase the original FAIL or close unrelated holds. Acceptance requires the applicable evidence to cover the exact requested quantity and the latest relevant unresolved cases to be addressed.

Rework/reheat creates a linked task/routing segment using the established production and stock mechanisms. Quantity and material additions are explicit. Do not duplicate the entire original order's material demand simply because one portion needs rework. After rework, complete the required retest and authorized release before downstream availability.

At final quality/FG inward, require current accepted evidence or an authorized scoped concession, plus no conflicting unresolved hold. Preserve packing and dispatch's existing checks. Acceptance of one stage does not waive the next applicable stage. Partial acceptance yields a partial dispatchable quantity, not whole-job clearance.

For customer complaints/returns, extend the existing CustomerRejection workflow. Link customer/dispatch/invoice where known, returned quantity, affected product, job/spec/quality revision, material/reel genealogy, failure evidence and replacement/credit reference. A complaint without physical return is not an inward movement. A returned physical lot starts restricted and has its own disposition; never rewrite the original shipment's measured result or delivery history.

Corrective-action cycle: **Contain → investigate cause → approve action → implement → verify effectiveness → close**. Store owners, due dates, evidence and linked recurrence. Label initial suspected cause separately from verified cause. Closing a corrective-action task must not release a stock hold by itself, and a closed quality case must not automatically issue a commercial credit or create replacement production without the established authorization.

### 11.11. Versioning, legacy data and activation policy

Approved profiles are immutable revisions. A job freezes its applicable profile when it is created/released with complete QC setup. A queued job that lacks setup gets an explicit missing-profile marker; an authorized **Attach approved QC profile** command may complete an unstarted job's setup, recording before/after context. Ordinary release replay never attaches a different revision or resets a job.

Later profile changes apply prospectively to their stated scope. They do not re-evaluate yesterday's signed result or modify started/completed job snapshots. A controlled amendment to unstarted work records impact, version check, approval and changed print revision. Rebaselining a future checkpoint on already started work needs a deliberate reviewed amendment, with already recorded stages preserved.

Legacy specifications without QC profiles should be filterable and assigned to setup owners. Import actual existing final bounds with provenance; mark missing stage thresholds, methods and units unresolved. Do not fill them with zero, copied final values or a universal ± percentage. Do not fabricate completed historic inspections from a status badge.

Preserve previously stored PASS/FAIL as legacy recorded outcomes and annotate provenance/verification gaps. Where unsafe historic evaluation may have affected stock still in circulation, produce a targeted exposure-review list by plant/lot/job. Do not silently convert all old passes to fails or unrestricted stock to accepted-under-new-policy. Physical containment of exposed current stock requires a recorded operational decision.

Each plant needs a reviewed activation plan: required new profiles, named approvers, active/WIP exceptions, evidence gaps, pilot items, checkpoints becoming enforced, and treatment of existing unrestricted stock. Receipt/task creation and future checkpoint readiness rules can be enabled per approved scope. Disabling a frontend feature flag must never release an existing hold or make the old bypass endpoint valid again.

### 11.12. Transaction safety and cross-service movement barriers

#### 11.12.1 Owner-local enforcement

Inventory is authoritative for batch/reel/physical-FG eligibility. Production is authoritative for unposted WIP/stage eligibility. Every inventory issue/reservation/transfer/dispatch command and every production stage transition must read the relevant owner's current restrictions inside its committing transaction, not a cached analytics badge. Use consistent row-lock ordering and conflict handling; PostgreSQL's documented row locking provides the relevant local concurrency mechanism. [TQ04]

Persist result, local case/hold, quality epoch/version and outgoing event intent in the same owner transaction. New write APIs do not trust `status`, `failures`, `disposition` or `stock_status` from a general measurement payload. Validate resource ownership and derive item/material type from the referenced stock identity rather than allowing callers to choose a weaker template category.

All restrictions combine conservatively: clearing one case does not clear another newer or independent hold. Duplicate events cannot create repeated movements/notifications. Older release events cannot override a newer restriction epoch. A hold-change and simultaneous issue/dispatch must have a tested serialization outcome.

#### 11.12.2 Production decisions affecting stock already in Inventory

An asynchronous event alone is not a sufficient movement gate: it leaves a period during which Inventory may still think stock is clear. For reinspection or changed QC clearance on a physical lot already owned by Inventory, acquire an **Inventory-owned review barrier** first. Under a stable operation ID, the inventory transaction restricts the target lot/quantity and increments its quality epoch before the new quality decision is finalized. Production then stores its evidence and sends the matching decision/application command. A crash after the barrier leaves material blocked and recoverable, not accidentally available.

Applying a release requires matching operation ID, current epoch, evidence/profile reference, approved quantity, disposition authority and absence of competing holds. If scope expansion discovers further affected lots, acquire their barriers before claiming they are contained. A concurrent dispatch that commits before a newly imposed barrier is a defined earlier movement and is included in exposure review; do not pretend a later flag reversed history.

Do not hold a database transaction open across arbitrary slow network calls. Model the barrier and decision as short, durable steps with expiry/review behavior that never auto-releases material. The UI shows **Containment/application pending** until the stock owner confirms; no green release badge on intent alone. If a required authority is unreachable, do not authorize a new quality-sensitive movement using a stale positive cache. Late, previously unrecorded failures are handled as exposure incidents, not a guarantee of retroactive prevention.

This protocol is a proposed design to validate against the actual dispatch/FG architecture. Phase P06 cannot pass on an outbox-only demonstration; it must test the real stock-owner race and failure cases.

### 11.13. Permissions and QC role

Make **QC** a canonical role with its own landing/workspace. Give finer capabilities to named users within that role instead of adding broad Owner/Admin access to make a screen load.

| Actor/capability | Recommended permitted behavior | Explicit boundary |
|---|---|---|
| QC inspector | Read assigned authorized item/spec/job/receipt context; enter/sign inspections; create holds; propose disposition; run permitted reports. | No implicit major-concession approval, stock adjustment, sales approval, user administration or other-plant access. |
| QC approver capability | Approve profiles, review failures/retests, authorize allowed dispositions. | Enforce second-person and severity/quantity limits; not automatic merely from having QC. |
| Store | Physical receipt, sampling support and readings where existing authorization permits; view release state and supplier-return instructions. | No direct PASS/UNRESTRICTED shortcut around approved quality policy. |
| Operator / PlantManager | Assigned job measurements, reasons and containment; view frozen tolerances; permitted workflow actions. | Recording actuals is not authority to rewrite tolerance or release a major failure. |
| Planner | View held WIP/materials and expected release risk; reschedule through normal planning. | No clearance by drag-and-drop or scheduling. |
| Sales / purchasing users | Relevant customer/supplier quality consequences, approved complaint/claim actions and scoped reports. | No raw unrelated confidential measurements or inventory disposition beyond assigned capability. |
| Dispatch | View eligible quantity and release evidence; use existing dispatch controls. | No sealing against an unresolved mandatory hold. |
| Owner / Admin | Oversight and configuration per current authority; explicitly delegated approval as configured. | Administrative access is not an unaudited quality bypass. |

Apply permissions and plant/resource authorization on every request, including direct APIs, exports, attachments, deep links and notifications, consistent with OWASP's request-level guidance. [TQ03] Read-only ALL-plants views aggregate only allowed plants; writes require a concrete plant. Do not default an unresolved plant to Plant A.

Update both canonical backend role mapping and seeding before assigning QC; update UI landing/sidebar/role switcher and each service's actual role/capability checks. Preserve existing business rights unless a separately recorded policy changes them. Test sign-in, session revocation, restart/reseed, legacy role migration and removal of access while a task/report is open.

### 11.14. Notifications, assignment and escalation

Use the existing notification center as the main delivery surface. Add a durable event-to-recipient pipeline, per-task assignee, acknowledgement, due policy, escalation level and delivery log. Optional email/external messaging is an adapter with approved recipients, provider configuration and consent; it is not assumed to be connected or needed for the initial release.

| Event | Primary recipients | Additional recipients only when relevant |
|---|---|---|
| Inward inspection due / missing setup | Assigned plant QC; Store for sampling/setup owner | Authorized purchasing owner for supplier delay |
| Incoming FAIL or certificate mismatch | QC reviewer and Store | Purchasing owner; Planner when committed material is affected |
| Winding/process/oven deviation saved | Assigned QC and responsible PlantManager | Recording supervisor; Planner when the affected quantity becomes held |
| Final-QC/FG restriction | QC reviewer, PlantManager and relevant Dispatch users | Sales/Planner for impacted delivery commitments |
| Profile awaiting approval | Users with profile-approval capability for that plant/scope | Author receives decision/rework request |
| Concession requested | Authorized disposition approver | Commercial/customer-approval owner only for their scoped decision |
| Retest due / rework finished | Assigned QC inspector and rework owner | Supervisor for sample readiness |
| Hold released/applied | Store or Production owner and affected Planner/Dispatch | Original case owner |
| Customer complaint/return | QC, relevant Sales/customer owner and PlantManager | Store for returned stock; supplier owner when linked cause is supported |
| Overdue unacknowledged critical case | Configured escalation owner | PlantManager / Owner according to severity and approved policy |
| No eligible assignee / failed delivery | Authorized fallback duty owner | Admin for routing failure, without unnecessary sensitive payload |

Filter recipients by active account, current allowed plant, resource visibility, action capability and assignment. Resolve overlapping roles once. A global QC-role broadcast is not safe: the inspected helper itself has no explicit plant filter, so protection must be added and tested. [Q06]

Emit after durable commit via a local outbox. Deduplicate by event ID, recipient and channel; use retry/backoff and a visible dead-letter/error queue. Do not claim exactly-once external delivery. Use entity version and event type to suppress obsolete pending/pass messages after a newer failure or release. Every message includes plant, material/job reference, failed parameter summary, severity, owner/due context and a permission-checked deep link.

Do not send a notification for every keystroke or one Owner alert per failing field. One case update can summarize several failures; significant state changes and critical escalations remain immediate according to approved policy. Routine summaries can be batched. Configure severity-specific SLAs, working calendars, timezone, substitutes/on-leave handling and escalation recipients; no invented response time becomes a live SLA by default.

Acknowledgement means “seen/taken ownership,” not “quality cleared.” Reassignment, revised due dates and escalation are audited. Revoked users must not retain sensitive unread notifications, export links or attachment access. Historical notification delivery/read times are evidence of message handling, not proof that an inspection was performed.

### 11.15. Reports, filters and metrics

#### 11.15.1 Report catalogue

Provide incoming inspection register; job/stage/sample results; full job quality dossier; deviations and hold aging; reasons/causes and recurrence; supplier quality; rework/retest/concessions; final acceptance and dispatch trace; customer-return/corrective-action status; missing/expired setup; instrument/calibration due; and immutable configuration/approval audit.

The job dossier joins supplier receipt/reel/batch evidence, material issues, frozen spec/quality revisions, each stage's samples, deviations, dispositions, FG acceptance, dispatch and any complaint/return. Every join shows scope/completeness; incomplete genealogy is a visible gap, not an invented parent.

#### 11.15.2 Shared filters

Filter by authorized plant/legal entity; incoming/production/final/return source; customer/supplier; material type; item code/grade/form/width/GSM where applicable; PO/SO/GRN; supplier batch/reel; product/spec/recipe and QC revision; job/release/segment; stage/machine/shift; measurement parameter; method/unit/specimen; measured date/time versus recorded date/time; inspector/approver/assignee; outcome; severity; reason/cause; disposition; open/overdue/acknowledgement status; retest/rework; concession; evidence presence; legacy/unverified status; and affected delivery window.

Use server-side filter predicates with full-dataset aggregates and pagination. Save filter sets and URL state. The same filters/counts must apply to tiles, lists, exports and drill-down. Support exact numeric min/max filters and breached-limit direction for parameter-level investigation without mixing different methods/units.

Return `as_of`, timezone, filter definition, total matching records, source watermarks and completeness. Unavailable dependencies must show partial/unavailable reports, never an empty successful report or “100% quality.” Large exports use the existing report-job mechanism if suitable, enforce access when generated/downloaded and expire signed links.

#### 11.15.3 Metric definitions

| Metric | Definition / guard |
|---|---|
| Inspection pass rate | PASS divided by PASS + FAIL among valid, complete applicable measured inspections in the chosen scope. Show counts/denominator and sample basis. Exclude invalid/incomplete/NA/legacy unverified rows; show those separately. |
| First-pass acceptance | For the defined eligible lot/checkpoint population, accepted on its first completed evaluation without rework/retest/concession divided by that population. State whether count- or quantity-based. |
| Held quantity/value | Distinct currently restricted physical/WIP portions; avoid counting the same stock again for each open case. Separate UOM/currency and protect costs by permission. |
| Failure frequency | Failed measured inspections or failed samples per defined denominator—not an arbitrary number of JSON fields. |
| Retest recovery | Originally failed covered quantity/rounds subsequently accepted after the defined retest/review, with original FAIL retained. |
| Concessions | Accepted-by-concession counts/quantities separate from measured PASS. |
| Hold aging / resolution time | State start/end events, timezone and business/calendar duration; reopened cases remain traceable. |
| Supplier rejection | Compare like items/methods and distinguish quantity-, receipt- and sample-based rates. Missing evidence is not proof of poor measured quality. |
| Late entry | Measured-to-recorded delay and exceptions discovered after subsequent stages/dispatch, separately from real-time detection. |

An empty denominator displays **No completed measured inspections**, not 100%. Never average millimeters, percent, force and mass in one “quality score.” Parameter trend charts carry the actual historic limit bands/revision changes; targets/specification limits must not be labelled statistical control limits. Statistical capability or control-chart extensions require approved methods and suitable data and are not a promise of the initial module.

Reports are operational evidence and audit support, not a statement of ISO certification or industry-standard sampling compliance. No external certification requirement has been supplied.

### 11.16. Data contracts and API command boundaries

Proposed entities: **ParameterDefinition**, **MeasurementMethod**, **InstrumentReference**, **QualityProfileRevision**, **ItemQualityBinding**, **SpecQualityBinding**, **JobQualitySnapshot**, **InspectionTask**, **InspectionRound**, **InspectionSample**, **MeasurementRevision**, **EvaluationResult**, **Nonconformance**, **QualityRestriction**, **DispositionDecision/Allocation**, **Retest/ReworkLink**, **CorrectiveAction**, **QualityIntegrationOperation**, **EventOutbox**, **NotificationDelivery** and report projections. Extend matching existing entities rather than blindly creating every proposed table.

Important fields include plant/owner-service, subject type and ID, stable document/line/segment/lot references, profile revision/hash, schema/evaluator version, sample/pair, raw and normalized values/units, observed and recorded timestamps, state, evidence, actor, optimistic revision and idempotency key/fingerprint. An ID stored across databases is an external reference requiring service validation, not an actual cross-database foreign key.

Use typed measurement rows for filtering/trends and a complete immutable profile/result snapshot for historic reconstruction. Do not rely solely on an unvalidated JSON `readings` dictionary for acceptance. Do not allow arbitrary uploaded expressions or `eval` in formulas/applicability: use a validated rule DSL/allowlist with cycle and dimensional checks.

Proposed command families, matched to repository routing conventions during implementation:

- Read/edit/submit/approve profile; resolve a proposed profile; view revision/impact history.
- Save specification with QC draft; attach/create QC revision on an existing spec; approve binding.
- Create task/sample round; preview evaluation; save readings; submit/sign inspection; record an auditable correction.
- Open case/hold; request/review disposition; allocate accepted/held/rework/return/scrap quantities; begin/reconcile stock review barrier.
- Create retest/rework/corrective action; record effectiveness review; close eligible case/task.
- Read scoped overview/register/dossier/metrics; start export; acknowledge/reassign task/notification.

All state-changing commands carry subject/version and stable operation identity. General inspection writes cannot directly set unrestricted stock. A matching replay returns the original result; the same idempotency key with a different payload is a conflict. A stale version returns a recoverable 409-style conflict with current revision and affected fields. Invalid input returns structured field/sample errors; forbidden access reveals no other-plant data. Domain refusal to release quality is distinct from failure to save the observation.

Suggested event envelope: event ID, event type, owner-service, aggregate type/ID, monotonic aggregate version, plant, occurred-at, correlation/causation IDs, schema version and necessary data. Outbox/consumer/restriction changes must survive process restarts and reordered delivery. Audit values and evidence retention must be configured; attachment limits, malware checks, signed access and secret redaction are part of acceptance.

### 11.17. Code integration map

| Existing file / area | Required integration |
|---|---|
| `apps/web-ui/app/(dashboard)/quality/page.tsx` | Refactor into scoped views and data-driven forms; replace client-authored status and capped-list metrics. |
| `apps/web-ui/components/specs/SpecSheetDocument.tsx` and spec list route | Pre-save context-rich QC editor; existing-spec Add/Complete/View/Revise actions; dirty-state, approval and snapshot display. |
| `apps/web-ui/components/production/JobCardDocument.tsx` | Shared stage inputs, tolerance help, result/reason summaries and printable frozen requirements. |
| Production entry, supervisor/EOD routes and stage actions | Whole-card/occurrence validation, late-entry evidence, preservation of actuals and no shortcut clearance. |
| `hooks/use-inventory.ts`, `hooks/use-production.ts`, `hooks/use-specs.ts`, `lib/api.ts` | Typed commands/read models, operation identity, scoping, consistent cache invalidation and conflict/error handling. |
| Existing BFF inventory/spec/production routes | Forward context/version/error details; validate access; aggregate read-only quality views without owning disposition. |
| Inventory `routers/quality.py`, `routers/purchase.py`, inward/reels/FG-inward/issue/dispatch/reservations | Server verdicts, versioned incoming profiles, controlled disposition, barriers and all physical movement restrictions. |
| Production `routers/quality.py`, `routers/planning.py`, operations, reconciliation and dispatch | Shared evaluator, pinned job profiles, local WIP holds, all stage/FG/dispatch gates, no destructive release replay. |
| Spec `models.py`, `routers/specs.py`, approval and calculation adapters | Immutable QC revisions, transactional spec/QC save and one canonical final-limit representation. |
| Masterdata models/routers and reason-code UI | Stable parameter/method/instrument definitions and classified reason codes without changing unrelated manufacturing math. |
| Auth `workspace.py`, `main.py` seeds, role/user/notification routes, `notification_service.py`; frontend workspace/landing | Canonical QC, capabilities, tested legacy migration and scoped notification delivery. |
| Analytics quality/reports/export routes and existing workers | Full-scope metrics, dossier joins, filtered asynchronous exports, source freshness and delivery/error monitoring. |
| Shared audit/outbox code | Assess before reuse; business-quality event delivery needs appropriate schema, dedupe and recovery, not just best-effort audit calls. |

This map identifies inspected/discovered locations and proposed responsibility. It is not a claim that every file or caller has been read in full. The agent records actual discovered symbols/paths in P00; no guessed production migration script should be run.

### 11.18. Delivery phases and anti-forgetting protocol

The integrated plan and `PHASE_TRACKER.json` define fourteen phases, P00–P13. Each has a separate brief with prerequisites, bounded tasks, expected evidence, tests, invariants and handoff requirements. Quality is no longer one late catch-all phase.

Every agent session starts by reading `AGENT_FUNCTIONAL_START_HERE_V2.md`, `AGENT_STATE.json`, the active phase brief and the relevant requirement/test rows. It checks branch/HEAD/dirty files, states its bounded goal in the session log, and resumes the next unfinished task. It does not infer completion from a prior conversation summary.

At each checkpoint update task status, changed files, migration revision, commands/results, evidence paths, unresolved decisions, risk/rollback and the exact next task. A phase marked COMPLETE requires all assigned release-blocking scenarios to have real passing evidence and an explicit reviewer decision; implementation or static build alone is not completion. Keep test output and report-render checks separate.

The original R01–R20 and their 66 acceptance scenarios remain in the integrated register. New QCR requirements and QCT scenarios add full-cycle quality coverage. All implementation tests in this planning package remain NOT RUN. Phase manifests describe how to implement; no application code or production configuration was changed here.

### 11.19. Configuration decisions and rollout evidence

Record approved answers for stage Height/weight/C.S. meaning and units; inward item/PO requirements; actual bounds and inclusive/exclusive qualifiers; approved sample policies; stage timing/gates/severity; concession authority/non-waivable criteria; profile approval separation; partial-lot representation; retrospective-entry handling; active legacy exceptions; notification SLAs and duty cover; document/corrective-action retention; and realistic report performance targets. Do not block planning/design on these numbers, but do not activate unknown acceptance rules in production.

Rollout: **additive schema and compatibility readers → validator/authorization fixes → profile drafts and evidence backfill → end-to-end staging → approved pilot plant/items/specs → migration/physical reconciliation → owner-approved production release**. Lock down unsafe legacy mutation paths before activating the new UI. Off switches disable new actions, not existing holds or audit history.

Release evidence must name deployed SHA, migrations, engine/schema versions, seeded roles, approved profiles, actual test commands/results, source-data reconciliation by plant, replay/concurrency/failure-injection results, browser/input/print/export checks, notifications to permitted users only, backup/restore exercise, client UAT and operational ownership. A phase checklist and an attractive dashboard cannot replace those results.

### 11.20. Sources and verification boundary

New source observations are pinned to the reviewed commit; findings are source-level, not newly executed API tests. The original helper reproductions and workbook evidence are retained in `baseline/` and are not presented as new application verification. The current pass did recheck main and read targeted quality/spec/notification source, then revised the planning artifacts. No repository write, deployment, migration, logged-in ERP workflow or live stock mutation was performed.

| ID | Source | What it supports |
|---|---|---|
| Q01 | GitHub `branches/main` read 17 Sep 2026 | Main returned reviewed SHA, not deployed SHA. |
| Q02 | Quality UI `page.tsx` lines 1–210 | Existing mixed quality workspace, fixed fields, incoming and customer-return hooks, capped metrics and empty pass-rate default. |
| Q03 | Inventory `routers/quality.py` lines 1–260 | Existing material presets/type/plant templates and inspected input contracts. |
| Q04 | Inventory `routers/quality.py` lines 430–700 | Template upsert/pending lists, supplied status/failures path and stock disposition updates. |
| Q05 | Spec `models.py` lines 1–240 | Existing spec tolerance/version fields and dynamic-field model. |
| Q06 | Auth `notification_service.py`, full | Existing active-user role/user selection without explicit plant filtering in that helper. |
| Q07 | Auth `workspace.py` and `main.py` lines 1–150, retained pinned-source evidence | QC legacy mapping and role seeding behavior. |
| B1 | Original `HARI_OM_FUNCTIONAL_AUDIT_AND_PLAN.md` | Original requirements, findings, exact client QC fields, release rule, gates and verification limits. |
| A1 | Supplied `#34 UPPM.pdf`, page 1 | Material descriptions and supplier test-report request; not complete QC policies. |
| TQ01 | Pydantic types documentation, accessed 17 Sep 2026 | Finite-value validation support; not deployed library-version evidence. |
| TQ02 | AWS Prescriptive Guidance, transactional outbox | Dual-write recovery and duplicate/idempotency considerations. |
| TQ03 | OWASP Authorization Cheat Sheet | Request-level authorization guidance. |
| TQ04 | PostgreSQL 17 explicit-locking documentation | Local row-lock semantics, not deployed database-version evidence. |

## 12. Priority delivery and stage drill-down

In the inspected job-card page, the due-risk predicate means **before tomorrow at day precision**, while the label says “Due today or tomorrow.” It therefore also picks up overdue records and does not faithfully describe the stated window. Stage tiles are non-interactive `div` elements and counts derive from the loaded 250-row set. [S13]

Proposed default: **Priority delivery — 3 calendar dates: today through today + 2, in the selected plant’s timezone.** Show the actual date range in the interface. Keep Overdue as a separate category. This is a documented interpretation of “next three days”; confirm whether the client instead intends tomorrow through day + 3 before sign-off. Do not conceal that boundary in code.

Base customer delivery priorities on outstanding delivery allocations, including unreleased orders. A job-card-only calculation misses orders that have not yet become jobs. Exclude fully fulfilled/cancelled commitments. Show card count, order count and outstanding pieces separately where needed; a split job should not multiply the customer’s delivery quantity.

Make each stage tile a keyboard-accessible link to the canonical job-card page with a stage parameter and preserved authorized plant context. Add the corresponding server query filter and a visible filter chip. Do not only filter the first loaded page in JavaScript. Define whether the tile means “current stage” or “open segment at this stage”; use the same definition for the tile count and list. Recommended initial behavior is current-stage, not-completed cards, with hold status visible rather than silently treating held cards as executable.

## 13. Investigate the reported ID-creation crash

The screenshot is a generic client-side exception. It does not prove whether “ID creation” refers to a user, job, spec or another record, nor the cause. The current user route uses `UserEditor`, which dynamically loads roles/plants and catches save failures; it is not the older role-card form pictured. [S10] Establish the deployed revision first.

Reproduction record: exact action/route, role/plant, entered non-secret values, browser version, deployed SHA, console exception, failing request/response and correlation ID. Do not capture passwords/tokens in the report. Test both successful and rejected create requests, then reload the created record and verify its access/identity.

Inspect response-shape assumptions such as `.map`, `.filter` and `.trim` only as hypotheses until a stack identifies the failing line. Validate response contracts and handle nullable legacy records, loading states, expired sessions, duplicate identities, validation failures and network timeouts without a blank page or a false success.

Provide a route-level recovery UI for render failures and explicit handling for asynchronous form submissions. Neither should silently retry a mutating create with a new identity. Restore safe form state and give the user a useful recovery action. A successful create followed by a lost response must be distinguishable from a failed create.

The count-based sales number allocator is a separate verified concurrency risk, not the demonstrated cause of this screenshot. Replace it with a tested atomic allocator; preserve existing references. [S03] Do not “fix” either problem by deleting users, resetting the database or stripping authorization checks.

## 14. Proposed data contracts and API boundaries

These are **proposals to fit into the existing services**, not a claim that the named tables/endpoints already exist. Reconcile them against current migrations before implementation.

| Proposed contract | Minimum purpose | Integrity rule |
|---|---|---|
| Sales order origin and internal date | Distinguish customer PO from internal customer order | External reference stays optional only for the relevant origin; ambiguous legacy rows flagged. |
| Stable sales line variant | Explicit parchment requirement/master/snapshot | Variant survives create/read/edit/release; no silent approved-recipe change. |
| Delivery schedule row | Line ID, date, quantity, status, revision, plant | Sum of active allocations cannot exceed allocatable line quantity; delivered/locked allocation immutable. |
| Schedule-to-release allocation | Delivery-row ID, release-lot ID, quantity | No duplicate demand; sums bounded by both parents. |
| Planning revision / operation | Preview sources, segment changes, version, actor | Stale preview conflict; replay does not reset actuals. |
| Supplier delivery schedule | Purchase-line ID, scheduled quantity, promised/current date, confirmation | Separate from GRN and QC; partial receipts explicitly allocated. |
| Receipt-to-schedule allocation | Receipt line and schedule row, allocated quantity | Receipt replay cannot allocate twice. |
| QC template revision | Stage, metrics, units, applicability, bounds | Approved version frozen on relevant job/batch; invalid template cannot pass. |
| QC measurement and disposition | Sample/segment/batch, readings, outcome, evidence | Finite typed measurements; clear hold/retest lineage. |
| Demand/coverage read model | Source IDs/versions, quantities, time buckets, completeness | Rebuildable from authoritative data; never becomes an independent stock ledger. |
| Durable integration operation | Stable key, fingerprint, per-line outcome, retry status | Cross-service retry is idempotent and observable. |

For full-cycle quality, §11.3 and §11.16 refine ownership: Masterdata owns shared definitions, Inventory owns incoming profiles and physical restrictions, Spec owns spec-stage profiles/final-limit authority, Production owns WIP inspections and frozen job context; the BFF/Analytics only aggregate. §11.12 requires current owner-local eligibility and review barriers rather than asynchronous release badges.

Suggested service responsibilities: Sales owns commercial orders/delivery promises; Production owns release execution, segments, planner revisions and process QC; Inventory/Purchase owns supplier commitments, receipts, stock restrictions and issues; the existing gateway aggregates authorized views. The material-demand calculation can be a dedicated module/read service inside the current stack, but must read canonical recipes and frozen production snapshots rather than duplicate manufacturing math.

Suggested endpoint families: delivery-schedule preview/commit; pending-order summary/detail; demand/material coverage; whole-order plan preview/commit; supplier schedule preview/commit; stage QC template/readings/disposition. Exact URL naming should follow the repository conventions. Return structured errors with code, affected line/field, current version and retryability. Pagination and aggregate counts are part of the contract.

## 15. Targeted code work map

All entries below exist in inspected source except the explicitly proposed modules. Source range details are in §22.

| Existing location | Change responsibility |
|---|---|
| `apps/web-ui/components/sales/sales-order-create-form.tsx` | Compact form, renamed dates, origin mode, line validation, parchment round-trip and persistent errors. |
| `hariom-erp/services/sales-service/src/models.py` | Add compatible origin/variant/schedule relationships through migrations; preserve UUIDs. |
| `hariom-erp/services/sales-service/src/routers/sales_orders.py` | Server date validation, safe numbering, bounded concurrent releases, stable-line updates and full pending aggregates. |
| `hariom-erp/services/production-service/src/routers/planning.py` | Split queue validation from compatibility; make replay non-destructive; preserve snapshots; integrate plan revision/coverage and shared QC validator. |
| `hariom-erp/services/production-service/src/routers/quality.py` | Typed required/finite validation, stage templates and inspection outcomes; preserve audit/holds. |
| `apps/web-ui/app/(dashboard)/production/job-cards/page.tsx` | Three-day priorities, full-scope counts, URL stage filtering and accessible tiles. |
| `apps/web-ui/app/(dashboard)/analytics/mrp/page.tsx` | Keep reorder view; add demand-driven views backed by canonical calculations rather than client-only arithmetic. |
| `apps/web-ui/app/(dashboard)/purchase/page.tsx` | Multi-line PO editor, supplier schedule calendar, evidence and incoming-QC UI. |
| `hariom-erp/services/inventory-service/src/routers/purchase.py` | Supplier line schedules and allocation links; retain GRN locking, fingerprint/replay and stock posting. |
| `apps/web-ui/lib/workspace.ts` | Dedicated QC landing/switcher without PlantManager alias for new canonical QC users. |
| `apps/web-ui/components/auth/user-editor.tsx` | Diagnose actual create failure; robust role/plant contracts and correct QC assignment. |
| Existing `SpecSheetDocument.tsx`, hooks, BFF routes, role seeds, migrations and tests | Trace these integrations in the target checkout before edits; no broad rewrite or guessed schema. |
| Proposed focused domain modules | Delivery allocations, demand/coverage calculation, shared QC validation and recoverable integration operations; names chosen in implementation. |

The expanded quality code work map is in §11.17, including master-item inward setup, canonical spec dialog/list actions, JobCardDocument input/print, full-card/EOD paths, Inventory quality/FG/dispatch, auth seeds, notification routing and analytics/exports. No file should be labelled implemented without its corresponding direct/alternate-path tests.

Avoid turning the already large planning router into an even larger catch-all. Extract tested pure calculations and transactional commands in small steps, preserving public contracts. Do not combine this project with a framework upgrade unless needed for a separately justified fix.

## 16. Migration and cutover without corrupting history

Apply the quality-specific legacy/activation rules in §11.11 and current-eligibility barriers in §11.12. A missing historic stage tolerance is not zero; an old PASS is not verified under a newly invented profile. Preserve old snapshots and create targeted exposure reviews for stock still circulating. Missing new QC setup must not become a sales queue-admission veto.

Use an additive rollout. First add nullable/new columns and versioned tables with compatible readers. Backfill in reviewable batches, then enable stricter writes once historical exceptions are understood. Preserve old UUIDs, external references, release identities, job/segment links and signed inspection evidence.

For existing sales lines with one due date, a proposed initial delivery allocation can be created for the appropriate outstanding quantity, but reconcile prior dispatch/release allocations first. Do not schedule the original full ordered quantity as fresh demand. For supplier lines, derive remaining supply from actual received quantities and explicit cancellations; a past expected date cannot be silently treated as a future confirmed receipt.

Record pre/post migration totals by plant: order quantity, fulfilled quantity, released quantity, active planned quantities, stock by item/status, open purchase balance, held stock and period locks. Require reconciliation explanations for every difference. Do not mutate manufacturing spec snapshots merely to populate new UI fields.

Keep the old write path behind a controlled compatibility adapter only while needed. Do not allow old and new clients to independently create two schedules for the same remainder. Feature flags should isolate queue policy, calendar writes and new QC contract; turning off a UI flag does not roll back already posted stock or measurements.

Before cutover: test migration on a restored copy, test the rollback/forward-fix path, verify external integration replays, and confirm backups can actually be restored. Observe pending sync operations and reconcile them before opening new release/calendars to all users.

## 17. Implementation sequence and independent acceptance gates

The previous phases 0–8 are superseded by the following fourteen phases. Detailed bounded briefs are in `phases/`; the persisted authoritative execution tracker is `PHASE_TRACKER.json`. All start NOT_STARTED. Do not collapse quality into one late catch-all task.

| Phase | Work | Depends on | Independent exit gate |
|---|---|---|---|
| P00 | Baseline and contract inventory | — | A reviewed baseline, complete write-path map and executable verification plan; unresolved policy values are recorded, not invented. |
| P01 | Integrity and unsafe-verdict fixes | P00 | Focused unit, database and API tests demonstrate safe verdicts, immutable release replay and bounded quantities; UI success is not evidence. |
| P02 | Quality contracts, versions and access | P01 | Both service owners evaluate the same fixtures identically; schema/authorization/reseed and rollback-compatible readers are tested. |
| P03 | Item profiles and incoming quality | P02 | A representative receipt retains physical quantities while only properly accepted portions become eligible; activation awaits full P06 controls. |
| P04 | Spec dialog and existing-spec actions | P02, P03 | New and existing specs round-trip correctly; cancellation, duplicate save and revision changes preserve IDs/history and never auto-approve. |
| P05 | Job-card entry and print | P04 | One inspection appears across entry surfaces without duplicate measurements; full-card and print match frozen requirements and retain failing actuals. |
| P06 | Exceptions and authoritative movement gates | P03, P05 | Real database/API lifecycle and hold-versus-dispatch race tests pass; an outbox-only test or frontend-disabled button cannot pass this phase. |
| P07 | Assignments and notifications | P06 | Expected recipients receive one actionable event and forbidden users receive neither sensitive text nor working links; stock clearance is independent. |
| P08 | Reports, returns and corrective actions | P07 | Counts/drilldowns/exports reconcile beyond page limits; empty/partial data stays explicit and returns/CAPA do not create unauthorized stock/credit. |
| P09 | Original commercial changes | P08 | All mapped original COMM/NAV/INC scenarios pass on the current contract; QC work does not replace this requirement set. |
| P10 | Original queue-only release | P09 | A mismatch queues correctly while invalid plant/quantity remains denied; missing QC is not a hidden release veto and replay is a no-op. |
| P11 | Original demand and three calendars | P10 | Original DEM/PLAN/PUR cases pass, including QC-restricted stock and time-to-usable supply; no calendar action bypasses quality or posts stock. |
| P12 | Legacy migration, pilot and UAT | P11 | Named business owners accept the migrated/pilot outcomes and the physical/system reconciliations; unresolved critical configuration blocks activation. |
| P13 | Release evidence and operational handoff | P12 | Release evidence and owner approval are recorded. No claim of production readiness follows from plan generation or report rendering. |

Prepare compatible work in parallel only behind the approved contract boundaries. New quality-changing workflows cannot activate before the authoritative movement and permission gates are proven. Actual thresholds, sampling and business SLAs need approved configuration, not agent guesses.

## 18. Acceptance test catalogue

`ACCEPTANCE_TESTS_V2.json` and `.md` contain **192 detailed cases**: all 66 original scenarios plus 126 full-cycle quality cases. `baseline/ACCEPTANCE_TESTS.csv` preserves the original register. Every implementation gate is initially **NOT_RUN — implementation acceptance**. `REQUIREMENTS_V2.json` links all 56 requirements to tests; phase briefs assign test IDs and required evidence. The package validator checks handoff consistency only, not the ERP. The eight QC helper reproductions are separately recorded and must not be counted as passing these integration gates.

The test set must cover commercial dates/origin/variant round-trip, line identities, queue-only admission, replay and concurrency, calendar allocation conservation, residual material demand, supplier receipt/QC linkage, role and plant isolation, exact QC parameters, final acceptance, incident recovery, imports, month-close and stock/dispatch regression. Essential examples follow:

| Gate | Must prove |
|---|---|
| Same release retried after scheduling | Same job, same frozen snapshot, same split quantities/dates; no new production demand. |
| Two users release against one remaining balance | Combined accepted releases never exceed the balance; clear conflict/retry behavior. |
| Customer delivery equal to/before PO date | Field-specific rejection from both UI and direct API; draft preserved. |
| Internal order with no external PO | Valid order identity, approval/release/dispatch trace, no fake customer PO field. |
| Mandrel mismatch at release | Successful admission to selected winder queue without a compatibility veto. |
| 501+ open orders / more than 250 job cards | Full totals and filters remain correct beyond first page. |
| WIP already consumed its paper | Remaining material calculation does not buy/issue that paper a second time. |
| Receipt arrives but incoming QC is pending | Expected stock is not presented as freely usable physical stock. |
| Whole-order move after partial delivery/start | Only editable remainder moves; original fulfilled/started history stays fixed. |
| NaN, blank, text or missing QC readings | Not PASS; consistent result across dedicated form and inline stage endpoint. |
| QC user guesses administration/other-plant endpoint | Denied without data leakage; route hiding is not the test. |
| Posted GRN / sealed dispatch retried after lost response | No duplicate inward/outward movement or fulfillment. |

## 19. Production readiness: evidence, not a percentage

This audit does not certify 100% readiness. A meaningful release statement is: **“All agreed release-blocking scenarios passed against the identified build and migrated data set, with a tested recovery procedure and named sign-off.”** It is not a promise that no future bug can occur.

Required release package: deployed build SHA; schema/migration version; test commands and logs; reconciled data totals; performance results on an agreed realistic workload; role/plant negative tests; browser results; screenshots of empty/error/blocked states; rollback/restore evidence; monitoring/alert routing; and client UAT for both plants and relevant roles.

Set measurable response-time and data-volume targets with the client’s actual workload. Test long-horizon plans, multiple concurrent planners, service interruption during release, large exports and stale data. Do not report a latency target as achieved merely because a small local fixture is fast. Verify period-lock enforcement and booking boundaries in Asia/Kolkata or the actual configured plant timezone.

Monitor duplicate/conflicting operations, stalled sync/outbox entries, material coverage completeness, invalid QC submissions, active holds, failed receipts, dispatch inconsistencies and client exceptions by build. Prefer a visible recoverable pending state over a success toast whose backend transaction is incomplete. An unavailable dependency is not a zero balance or empty result.

Use a limited pilot, reconcile physical and system results over complete order/receipt/production/dispatch cycles, then broaden access after approval. Never bypass final QC, authorization or books locks to obtain a superficially green test run.

## 20. Decisions needed before final configuration

The plan is actionable now, but these details need recorded client confirmation rather than invented defaults:

| Decision | Proposed working position |
|---|---|
| “Next three days” boundary | Today plus two more plant-local calendar dates; display range. Confirm before sign-off. |
| Internal order type | Customer-specific internal sales order without external PO; make-to-stock is separate scope. |
| Internal delivery-date rule | Use internal order date; same-day policy explicitly chosen rather than applying a nonexistent Customer PO Date. |
| QC Height / C.S. / weight basis | Preserve names; confirm per-stage meaning, test method, units and specimen size. |
| QC limits and frequency | Approved client/spec values only; no fabricated thresholds. |
| Routine stage hard gates | Configure required checkpoints and severity explicitly. All durable failures require reasons/cases; required inward/final release stays restricted until authorized. Queue admission is unchanged. Preserve actual physical output while withholding applicable release. |
| Parchment/spec conflict | Resolve via approved spec variant/revision, not hidden BOM editing. |
| Whole-PO schedule meaning | Expose customer, production and supplier views separately so all three needs are represented. |
| Workbook and PDF UOM / supplier identity | Confirm before import or cross-document arithmetic; blank pending cells remain review items. |
| Legacy records and cancelled/short-closed balances | Approve mapping and conservation rules before backfill. |
| Procurement legal entity and print terms | Confirm AMIGO/Hari Om entity/plant and preserve actual source terms. |

## 21. Coding-agent operating instruction

**V2 session protocol:** Read `AGENT_FUNCTIONAL_START_HERE_V2.md`, `AGENT_STATE.json`, the active phase brief, relevant requirements/tests and `DECISIONS_REQUIRED.md` before edits. Update state and a phase evidence record at every session boundary. All P00–P13 gates require actual test/evidence/reviewer results. `validate_handoff.py` checks only manifest consistency.

Implement on a dedicated branch, with the client-approved functional changes explicitly separated from UI-only work. Start at Phase 0 and the P0 findings, not a bulk CSS rewrite or a new app scaffold. Use existing services, hooks and canonical manufacturing math. Do not delete original data or regenerate spec/job identities to fit the mockup.

For every phase, report changed files/routes/contracts, migrations, actual tests run and results, screenshots where relevant, remaining unknowns and rollback notes. A running page, a successful build, a mocked success toast or an old “production ready” report is not evidence that these flows now work.

The earlier UI handoff’s “preserve compatible-machine checks” must be read with the current explicit exception: **no mandrel/geometry/capacity compatibility veto for sales release into the selected winder queue.** All unrelated authorization, quantity, transaction and historical-integrity protections remain. Do not widen this exception to dispatch, actual stock posting or QC.

No merge or deployment is authorized by this report alone. Follow the owner’s normal approval and production-access process.

## 22. Source register and verification limits

Repository sources below are pinned to `44cf9950850f70de040f6d09d51dcf22495ce8d3`. Ranges describe the source-code ranges fetched, not fabricated line numbers in a tool citation. The report does not claim every file or every caller in the repository was inspected.

| ID | Source and inspected range | Supports |
|---|---|---|
| S01 | GitHub `commits/main`, fetched during this audit | Current reviewed main SHA/date, not deployment SHA. |
| S02 | Sales `models.py`, full; `sales_orders.py` 1–240 | Order/line/release fields, optional PO fields, parchment mismatch, separate balances. |
| S03 | Sales `sales_orders.py` 240–400 | Count-based numbering, creation, status and list cap. |
| S04 | Sales `sales_orders.py` 400–850 | Draft line recreation, approval separation, release identities and concurrency path. |
| S05 | `sales-order-create-form.tsx` 1–245 and 250–465 | Submitted boolean, UI/date/line/header/readiness behavior. |
| S06 | Production `planning.py` 1–180 and 2760–3240 | Stage model, release sync/reset, snapshot mutation, capacity branch and duplicated QC logic. |
| S07 | Production `quality.py` 1–260 | Validation, missing-field checks, PASS selection and permitted roles. |
| S08 | Frontend `analytics/mrp/page.tsx` 1–150 | Reorder-policy calculation, not pending-order BOM engine. |
| S09 | `lib/workspace.ts` 1–200 | QC mapped to PlantManager; no dedicated QC landing type. |
| S10 | User new route; `user-editor.tsx` full; users page 1–175 | Current dynamic role editor, not screenshot’s older role-card form. |
| S11 | Purchase page 1–230; inventory `purchase.py` 1–270 | Existing PO interface, one-line UI payload, multi-line API, fields, header expected date, list cap. |
| S12 | Inventory `purchase.py` 360–650 | Existing receipt locking/fingerprint/replay, stock/QC lifecycle and role checks. |
| S13 | Job-cards page 1–210 | Loaded-list metrics, due predicate, non-clickable stage tiles. |
| S14 | Production `utils/auth.py` 1–210 | Role/plant helper behavior; broader BFF/allowed-plant reconciliation remains a gate. |
| A1 | Attached `#34 UPPM.pdf`, page 1 | Exact supplier PO particulars, totals, terms and missing explicit UOM/date splits. |
| A2 | Attached `Book.xlsx`, both sheets; selected SEP cells/formulas | Workbook layout, cached subtotals, copied-date/mapping concerns. |
| T1 | PostgreSQL 17 explicit-locking documentation | Row locks and deadlock considerations; not proof of deployed database version. |
| T2 | OWASP Authorization Cheat Sheet | Request-level authorization guidance. |

### Verification performed in the original audit

The following paragraph is retained original-audit evidence, not a claim those checks were rerun in V2. New V2 source reads are documented in §11.20; only planning-artifact checks were executed for this update.

Source reads were completed through the GitHub connector. Attachment PDF text/page image and screenshot content were reviewed; workbook parsed values and selected original XML formulas/caches were inspected. Eight isolated QC-helper cases were executed and their results saved. The report package itself was generated and checked separately from any application testing.

### Not performed

No production sign-in, mutation, full repo clone/build, database migration, complete unit suite, API integration test, concurrent database test, full workbook recalculation, actual deployment audit, or client UAT was performed. The client-side crash was not reproduced. No unknown was converted to a claim of success.

[S01]: https://github.com/dev2495/hari-om-paper-2-local-recovery/commit/44cf9950850f70de040f6d09d51dcf22495ce8d3
[S02]: https://github.com/dev2495/hari-om-paper-2-local-recovery/blob/44cf9950850f70de040f6d09d51dcf22495ce8d3/hariom-erp/services/sales-service/src/models.py
[S03]: https://github.com/dev2495/hari-om-paper-2-local-recovery/blob/44cf9950850f70de040f6d09d51dcf22495ce8d3/hariom-erp/services/sales-service/src/routers/sales_orders.py#L240-L400
[S04]: https://github.com/dev2495/hari-om-paper-2-local-recovery/blob/44cf9950850f70de040f6d09d51dcf22495ce8d3/hariom-erp/services/sales-service/src/routers/sales_orders.py#L400-L850
[S05]: https://github.com/dev2495/hari-om-paper-2-local-recovery/blob/44cf9950850f70de040f6d09d51dcf22495ce8d3/apps/web-ui/components/sales/sales-order-create-form.tsx
[S06]: https://github.com/dev2495/hari-om-paper-2-local-recovery/blob/44cf9950850f70de040f6d09d51dcf22495ce8d3/hariom-erp/services/production-service/src/routers/planning.py#L2760-L3240
[S07]: https://github.com/dev2495/hari-om-paper-2-local-recovery/blob/44cf9950850f70de040f6d09d51dcf22495ce8d3/hariom-erp/services/production-service/src/routers/quality.py#L1-L260
[S08]: https://github.com/dev2495/hari-om-paper-2-local-recovery/blob/44cf9950850f70de040f6d09d51dcf22495ce8d3/apps/web-ui/app/(dashboard)/analytics/mrp/page.tsx
[S09]: https://github.com/dev2495/hari-om-paper-2-local-recovery/blob/44cf9950850f70de040f6d09d51dcf22495ce8d3/apps/web-ui/lib/workspace.ts
[S10]: https://github.com/dev2495/hari-om-paper-2-local-recovery/blob/44cf9950850f70de040f6d09d51dcf22495ce8d3/apps/web-ui/components/auth/user-editor.tsx
[S11]: https://github.com/dev2495/hari-om-paper-2-local-recovery/blob/44cf9950850f70de040f6d09d51dcf22495ce8d3/hariom-erp/services/inventory-service/src/routers/purchase.py#L1-L270
[S12]: https://github.com/dev2495/hari-om-paper-2-local-recovery/blob/44cf9950850f70de040f6d09d51dcf22495ce8d3/hariom-erp/services/inventory-service/src/routers/purchase.py#L360-L650
[S13]: https://github.com/dev2495/hari-om-paper-2-local-recovery/blob/44cf9950850f70de040f6d09d51dcf22495ce8d3/apps/web-ui/app/(dashboard)/production/job-cards/page.tsx
[S14]: https://github.com/dev2495/hari-om-paper-2-local-recovery/blob/44cf9950850f70de040f6d09d51dcf22495ce8d3/hariom-erp/services/production-service/src/utils/auth.py
[T1]: https://www.postgresql.org/docs/17/explicit-locking.html
[T2]: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

[Q01]: https://github.com/dev2495/hari-om-paper-2-local-recovery/commit/44cf9950850f70de040f6d09d51dcf22495ce8d3
[Q02]: https://github.com/dev2495/hari-om-paper-2-local-recovery/blob/44cf9950850f70de040f6d09d51dcf22495ce8d3/apps/web-ui/app/(dashboard)/quality/page.tsx#L1-L210
[Q03]: https://github.com/dev2495/hari-om-paper-2-local-recovery/blob/44cf9950850f70de040f6d09d51dcf22495ce8d3/hariom-erp/services/inventory-service/src/routers/quality.py#L1-L260
[Q04]: https://github.com/dev2495/hari-om-paper-2-local-recovery/blob/44cf9950850f70de040f6d09d51dcf22495ce8d3/hariom-erp/services/inventory-service/src/routers/quality.py#L430-L700
[Q05]: https://github.com/dev2495/hari-om-paper-2-local-recovery/blob/44cf9950850f70de040f6d09d51dcf22495ce8d3/hariom-erp/services/spec-service/src/models.py
[Q06]: https://github.com/dev2495/hari-om-paper-2-local-recovery/blob/44cf9950850f70de040f6d09d51dcf22495ce8d3/hariom-erp/services/auth-service/src/notification_service.py
[Q07]: https://github.com/dev2495/hari-om-paper-2-local-recovery/blob/44cf9950850f70de040f6d09d51dcf22495ce8d3/hariom-erp/services/auth-service/src/workspace.py
[TQ01]: https://pydantic.dev/docs/validation/latest/api/pydantic/types/
[TQ02]: https://docs.aws.amazon.com/en_en/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html
[TQ03]: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
[TQ04]: https://www.postgresql.org/docs/17/explicit-locking.html

[B1]: baseline/HARI_OM_FUNCTIONAL_AUDIT_AND_PLAN.md
