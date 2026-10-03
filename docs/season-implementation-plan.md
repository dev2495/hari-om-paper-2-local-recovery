# Seasonal recipes, stage QC, continuous entries and specification list — implementation plan v2

Reviewed 3 October 2026, including the user's subsequent instruction to reset current testing data. This document replaces the attached v1 plan as the implementation handoff; do not combine conflicting instructions from the two documents.

Review basis: user requirements and source at `/Users/devarshthakkar/Downloads/hari om/hari-om-paper-2-local-recovery`, branch `release/2026-09-25-paper-reel-po`, commit `9ada1ffb00ac9c7e58cf3b09cc83281b4cbc5158`. The attached plan is untracked there. The chat workspace contains release evidence, not a Git checkout. All repository paths below are relative to the verified source checkout.

Verdict: v1 is not ready to implement unchanged. This revision is ready for engineering implementation, with the explicit configuration/activation gates below. This is a design and source review, not implemented-feature testing or production acceptance. No application source, business records, deployments or live settings were changed in this review.

## 1. Requirements and decisions

### Confirmed by the user

- One specification supports Rest of year (`ROY`) and Monsoon (`MONSOON`) paper recipes. The recipe editor has a season selector. Monsoon initially copies ROY and needs explicit confirmation.
- Each season recipe has independent revisions, approval, history, diff and audit. Editing one never silently edits or increments the other.
- Two global seasonal stage-QC rule stacks; Monsoon starts with the same rules as ROY. Assigned QC users can edit and publish new rule versions. Customer quality overlays are supported.
- Owner switches the active production season. Subsequent releases freeze that season's approved recipe and effective QC rules. Existing released cards retain their snapshots.
- Continuous entries and one total entry are both supported. Reaching quantity makes closure available; it does not automatically close or prohibit further production.
- Accepted quantity may equal produced quantity: `produced >= accepted >= 0`; rejected is their difference.
- Winding bamboo length is the specification's selected bamboo length ±15 mm. Winding CS is `[customer CS / 2.5, customer CS / 2.5 + 10]`.
- Shift A/B and produced/accepted quantities are mandatory on submitted production entries. Start/end time are optional. Supervisor name and minimum two readings per applicable required parameter are mandatory before stage close.
- Winding and Oven can overlap. The previous *entry/batch quantity* must be submitted before downstream consumes it; the entire upstream stage need not be closed for continuous pairs.
- Improve the specification list screen. Incoming-material QC behavior remains unchanged.
- Before real use, reset current testing data across specifications, sales orders, job cards and the dependent operational system. The user says the current data is testing data with no business use and will enter new data. Section 10 defines the coordinated reset; this review itself performs no deletion.

### Explicit design choices, not additional claimed client confirmations

| Topic | Implementation decision / activation gate |
|---|---|
| Meaning of global | One organization/installation-wide pair of seasonal rule stacks and one active-season state, shared by both plants. Plant authorization still governs specs, cards and entries. Do not silently make independent plant switches. Use an explicit configuration-scope key even if this deployment has one organization. |
| Process length `±0.2/2` | Confirmed by the user on 3 October 2026: lower offset −0.2 mm, upper offset +0.2 mm. |
| Customer ID basis | Default to saved customer minimum ID; use an explicit saved nominal only if no minimum exists. Show the chosen basis in preview and first publication. No fabricated midpoint from incomplete bounds. |
| Oven reference | Use measured oven pre-weight from the same physical sample; show the client phrase “winding/pre-oven weight.” Paired pre/post sample basis confirmed by the user on 3 October 2026. Never pair unrelated winding and oven samples. |
| Continuous pairs | Enable Winding→Oven and Oven→Process. The latter is a design interpretation of continuous batch flow, exposed in the activation preview. Preserve the actual existing route for all other pairs and optional stages. |
| QC name | Optional attribution unless configured mandatory. Authenticated QC author identity is always captured. This is distinct from supervisor closure approval. |
| Supervisor | Can be omitted from a draft/submitted quantity entry; must be a validated assigned employee at close. An optional entry supervisor can be recorded. Do not add the v1 requirement of a supervisor on every submit. |
| Mandatory readings | At least two distinct samples per applicable mandatory parameter over the stage, including a single total-entry workflow. No Owner/Admin shortcut around this minimum. |
| Unconfirmed Monsoon on migrated specs | Show readiness blocker immediately, but retain existing ROY release behavior during staged migration. New/revised V2 specs need both recipes confirmed before approval. Active-season release always checks its approved recipe. |
| Re-freezing cards | Excluded from this delivery. Released snapshots remain immutable; use the existing governed cancel/re-release path for untouched cards if a season change is necessary. |

## 2. QC rules and reference contract

### Reference values

Resolve from authoritative saved values and freeze them with their provenance:

- `CUSTOMER_ID`: saved `id_min_mm`, otherwise explicit nominal. `CUSTOMER_ID_MAX` is the actual saved maximum, never the minimum copied into both fields.
- `CUSTOMER_OD`, `CUSTOMER_LENGTH`: explicit saved customer nominal, else midpoint only when both finite bounds exist. Carry the customer min/max independently.
- `CUSTOMER_WEIGHT`: positive saved `target_tube_weight`, otherwise explicit weight nominal or midpoint of two valid bounds. Zero placeholders are missing, not actual targets.
- `CUSTOMER_CS`: positive `cs_min_n`, else positive `required_cs`. Existing customer upper limits remain enforceable at the relevant final/process checkpoint.
- `MANDREL_DIAMETER`: masterdata mandrel `outer_diameter_mm`, the diameter forming tube ID. The existing UI uses this field. Do not invent a mandrel bore/“average ID” field. Persist source ID, diameter, unit and fetched revision/timestamp on the draft; validate server-side at save/approval. Changes after approval require explicit refresh/reapproval, never refresh historical snapshots silently.
- `WINDING_LENGTH`: server-calculated `selected_bamboo_length_mm` using the same geometry and yield basis as the card and BOM. Release blocks if missing; no fallback to finished cut-tube height.
- `SAMPLE.pre_weight`: positive measured pre-weight for this oven sample, in grams and on the same measurement basis as its post-weight. Sample identity survives partial entry and later completion.
- Notch applicability comes from the frozen routing/spec flags. Moisture values are percent; validate physical range 0–100.

### Initial rule rows for both seasons

All endpoints inclusive. `required=true`, `min_readings=2` for applicable rows. Record-only means a valid observation is mandatory but no invented tolerance is imposed.

| Stage / parameter | Lower | Upper | Notes |
|---|---|---|---|
| Winding ID, mm | max(mandrel diameter−0.2, customer ID) | mandrel diameter+0.2 | Empty intersection blocks release. |
| Winding OD, mm | customer OD+0.8 | customer OD+1.2 | Customer finished OD maximum must NOT cap a deliberately oversized winding tube. |
| Winding bamboo length, mm | selected bamboo length−15 | selected bamboo length+15 | Keep internal code `height`; display “Bamboo length.” |
| Winding weight, g | — | — | Record-only. Clearly distinguish tube/sample weight from bamboo/batch weight. |
| Winding CS, N | customer CS/2.5 | customer CS/2.5+10 | Confirmed band, not an unlimited lower threshold. |
| Oven pre-weight, g | — | — | Record-only, positive, paired sample. |
| Oven post-weight, g | pre-weight×0.90 | pre-weight×0.92 | 8–10% loss; also enforce post≤pre. |
| Oven pre/post moisture, % | — | — | Two separate required record-only parameters. |
| Oven CS, N | customer CS | — | Add missing parameter. |
| Process ID, mm | customer ID+0.2 | applicable customer maximum, if provided | Report conflicting bounds; never silently ignore customer maximum. |
| Process OD, mm | applicable customer minimum, if provided | applicable customer maximum, if provided | Record-only only where no approved customer tolerance exists. |
| Process height, mm | nominal−0.2 proposed | nominal+0.2 proposed | Initial numeric confirmation gate above; intersect approved customer limits. |
| Process weight, g | target−5 | target+5 | Intersect approved customer weight limits. |
| Process CS, N | customer CS | applicable customer maximum, if provided | Preserve customer constraints. |
| Process notch distance/depth, mm | approved overlay bounds, if any | approved overlay bounds, if any | Otherwise record-only; N/A with provenance when no notching. |
| Process moisture, % | saved minimum, if any | saved maximum, if any | One-sided valid bands supported; record-only if neither exists. |

Final product constraints and existing incoming-material QC remain separate from stage-manufacturing tolerances. Do not apply finished-product dimensions wholesale to Winding or Oven. Preserve existing final-QC gates and signed-profile/instrument readiness checks.

### Rule engine

Use structured, validated rule data; never eval strings. Each row includes stable rule ID, stage, parameter, unit, mode, lower/upper term arrays, required, applicability, minimum samples, blocking/advisory policy, non-waivable flag, missing-reference policy, explanation and change reason. Terms have enum reference, finite decimal factor and offset. Bounds combine by MAX for lower and MIN for upper. At least one bound is required for BAND; neither for RECORD_ONLY.

Persist quantities/measurements using a documented decimal precision. Use Decimal for calculations/comparisons and fixed-scale DB numeric values where introduced. Round only for display; do not turn an out-of-range value into a pass by rounding to two decimals. Include exact and human-readable limits in the API. Reject NaN/Infinity, wrong units, negative quantities and malformed samples.

Dynamic bound evaluation preserves the complete lower AND upper term lists, offsets and composition. V1's single `relative` example loses information. Allow only same-sample, earlier-checkpoint references, reject cycles/self-reference and evaluate dependencies deterministically. `pre=100, post=90..92` passes; `92.01` fails at supported precision; missing pre is incomplete. Missing required static reference or lower>upper blocks approval/release. Optional moisture fallback is explicit and audited, not a generic fallback for missing setup.

The evaluator distinguishes missing, invalid, out-of-band, observation-only and pass. An entry with no readings is `NOT_MEASURED`; this is not PASS. An entry may contain only one parameter; omitted parameters do not permanently poison the aggregate stage verdict. Stage readiness recomputes from all effective submitted observations and the frozen required-parameter set, counting distinct sample IDs per parameter. Two edits to one sample count once. Two distinct samples may legitimately have the same value. Superseded/void observations do not count. Blocking failures and unresolved dispositions remain visible even after later passing samples; averaging must never hide a failure.

### Global rules and overlays

Model `QcRuleSet(scope_id, season, version, status, rules, fingerprint, row_version, supersedes_id, created/published actor/time, change_note)`. One published head and at most one draft per `(scope_id,season)`, enforced with unique indexes and locks. Published content is immutable; publication-head/status metadata may change in an audited transaction. Allocate versions under the head lock, not unlocked MAX+1.

Model `QcRuleOverlay(scope_id, target_type, target_id, applicability_plant_id?, season, version, status, rows, reason, fingerprint, row_version, approval_basis)`. Targets are authoritative customer ID or spec lineage ID. CHECK constraints require exactly the appropriate target. Stable unique target keys avoid NULL uniqueness holes. Scope `BOTH` is permitted with explicit precedence:

1. Global active-season rules.
2. Customer BOTH, then customer exact-season overlay.
3. Spec BOTH, then spec exact-season overlay.
4. Intersect applicable contractual customer constraints at Process/final QC.

Each overlay replaces its selected stage/parameter row as a whole. Preserve all uncovered rows. A missing/wider bound, removed required flag, reduced reading minimum, weakened gating, disabled applicability or removal of non-waivable protection counts as loosening. Compare against the complete effective parent stack for BOTH seasons, not just a nominal global sample. If general containment cannot be proved for formula rows, classify conservatively as potentially loosening and require Owner approval. Never waive contractual limits merely by publishing an overlay; change the approved customer/spec requirement through its governed workflow.

Publishing a changed base re-evaluates affected overlay stacks and invalidates stale approval/impact fingerprints. Clearly identify newly conflicting specs. Release blocks affected specs until resolved. QC can publish normal global rule revisions; hard mandatory parameters and minimum two readings cannot be disabled through a generic builder in this delivery. Owner approval applies to potentially loosening overlays. Assigned QC capability is checked server-side; do not rely only on visible navigation or a client-provided employee name.

Seed both rule sets as identical DRAFTS, with the confirmation flags above. Publication is an explicit attributed action; no automatic production adoption on service startup.

## 3. Independent recipe versions and specification approval

### Data model

Separate recipe CONTENT revisions from their approval against a specific spec revision:

- `SpecLineage(id, plant_id)` and `SpecificationSheet.lineage_id/supersedes_spec_id`. Backfill unknown historical ancestry as separate lineages rather than guessing.
- `RecipeRevision(id, lineage_id, season, revision_no, predecessor_id, copied_from_id, content_hash, status, layer snapshots, grouped sheet rows, notes, created actor/time)`. Unique `(lineage_id,season,revision_no)`. At most one editable draft per lineage/season for this delivery. Approved layer snapshots and grouped rows live on this revision, not mutable spec-level dynamic JSON.
- `SpecRecipeBinding(spec_id, season, recipe_revision_id, confirmation_hash, confirmed_by/at, approval_status, approved_by/at, approval_context_hash)`. Unique `(spec_id,season)` for the selected binding. Keep binding-change history append-only.
- `RecipeApprovalEvent` / draft edit audit capture authors, content before/after, reason, state and expected revision. A `RecipeSeasonHead` row serializes allocation and selection.

The implementor may evolve `recipe_header` into RecipeRevision rather than create a second content table, but must preserve these invariants. Existing recipe IDs remain resolvable for historical BOMs/trials. The old `(spec_id,version)` constraint cannot remain the identity for lineage-wide seasonal content. Migration introduces the new uniqueness only after duplicate/data checks. Legacy read adapters return ROY explicitly.

### Commands

- New spec: two real draft revisions, Monsoon copied from ROY. “Copy ROY” is an explicit one-time copy. Subsequent ROY edits do not modify Monsoon automatically, even if unconfirmed. UI shows “ROY has changed since this copy” with an explicit recopy action. Confirmation covers the current Monsoon content hash and spec calculation context; changing either invalidates confirmation.
- Saving a draft edits only supplied season patches. Omitted season means unchanged, not empty. Validate each changed season independently.
- A recipe-only revision of an approved spec creates a draft only for that season. Its approval switches only that spec's season binding/head; it does not approve the other season or mutate the parent spec's general approval/CS fields. Existing released cards, trials and material snapshots remain immutable.
- A spec re-version creates new bindings to the same immutable recipe revisions. Unchanged recipe content retains the same revision number. Revalidate both bindings against the new geometry/customer requirements and require reapproval. Edited recipe content creates a new revision for that season only. This removes v1's ambiguous duplicated content versions.
- New/revised spec approval checks both bindings, Monsoon confirmation, both recipes' math, both resolved QC profiles, current reference fingerprints, existing duplicate checks and existing spec footer/trial rules, in one transaction.
- A recipe approval service must not commit midway or approve the whole specification implicitly. Refactor the current `ApprovalService.approve_recipe`, which does both. Separate recipe-content approval from spec approval; command boundary owns commit.
- Trials stay linked to the recipe revision/season. Copying a recipe never copies measured trial results as if they were new observations. Show that a copied trial is historical reference only. Preserve the existing trial policy; do not invent a new compulsory seasonal trial without a business decision.

Each seasonal recipe uses existing min/max distinct paper constants, max plies, unique ply numbers, valid master IDs, modelled dry-weight delta and unit constraints. Adhesive/parchment remain spec-level for this delivery as requested paper-selection scope; changes to those shared fields trigger both seasonal validation contexts. Preserve commercial parchment overrides and frozen release calculations.

### Atomic document API

`POST /specs/document` and `PUT /specs/{id}/document` accept spec changes, per-season recipe patches, confirmations, trial intent, `request_id`, payload fingerprint and expected spec/recipe revisions. Fetch/validate external masterdata before opening the write transaction; then check reference versions inside the command. One transaction saves spec, binding changes, draft layers, sheet rows, save-operation record and audit. Extract domain helpers that flush without internal commits; do not call existing HTTP handlers in a loop.

Idempotency key is unique within authorized scope and operation; equal payload replays the stored result, a different payload with the same key returns 409. Historical retry result remains stable even if the spec later changes. Any invalid Monsoon layer rolls back the entire command. Explicit errors identify season, field and reason. Legacy write endpoints cannot bypass new checks: route through the same service or return an actionable version-required 409 for V2-managed specs.

Read endpoints expose selected approved binding and open draft separately, per-season content revision and approval context, history/diff across lineage, and computed comparison between the two seasons. Never use “latest recipe” without filtering approved season and binding.

## 4. Season switching, release and material planning

### Global season state

`ProductionSeasonState(scope_id PK, active_season, epoch, row_version, switched_actor/time)` and append-only `ProductionSeasonEvent`. Owner-only switch; Admin is not implicitly allowed. Only a global Owner capability can view cross-plant impact details. Plant-only users see the global season but only authorized specs/cards.

Preview returns target readiness, unconfirmed/invalid specs, affected unreleased demand, and released-card counts retaining their old season. A switch may proceed with listed unready specs after explicit acknowledgement; those specs cannot release until fixed. Require note, expected epoch, preview fingerprint and idempotency key. The backend recomputes/validates impact; a stale preview returns 409.

### Race-safe release contract

A standalone GET of season followed by production insert has a race with switching. Add a durable release authorization command in spec-service, serialized on the same global season-state row as the switch:

`POST /specs/{id}/release-authorizations` receives release operation ID, expected sales-line/spec revision, quantity and authorized plant. In one consistent DB transaction it reads the active season, selected approved binding, published rule/overlay heads and immutable reference data, validates them, and persists a complete immutable release bundle with `authorization_id`, `authorized_at`, `season_epoch`, input hashes and bundle hash. Include recipe layers/grouped rows, effective QC with provenance, geometry/yield, BOM, routing policy and all units. Use the same server calculation helpers, never a later mutable-recipe fetch.

**Ordering definition:** season is fixed at durable release authorization. A request authorized before the switch may finish creating its card afterwards and remains in the old season; the switch preview/history shows pending authorizations. A request authorized after the switch must use the new epoch. An abandoned authorization is cancelled/audited; a new release operation uses the new season. A retry of an already authorized operation keeps its original bundle. Expose this ordering in audit rather than pretending separate databases commit at one instant.

Production persists a unique `(plant_id,release_operation_id)` receipt/card set and the bundle hash in its transaction. Sales release synchronization uses durable pending/succeeded/failed states and retries; failed synchronization must not silently mark a line released or create a duplicate card. Existing release-lot reconciliation must be reused or extended explicitly. Authorization validates authenticated ownership of spec, customer and release context; clients cannot submit their own approved bundle.

Release fails closed on missing approval, missing references, customer conflicts, unresolved overlay migration, invalid yield or unavailable authoritative service. Never fall back to the first recipe or empty BOM. Return a structured `SEASON_NOT_READY` error with spec, season and fix links. Print/reprint uses only the saved bundle and displays season, recipe revision, QC version and applicable overlay revisions.

Split/carry-forward children of an existing card inherit its bundle, with quantity-specific totals recalculated from frozen per-unit factors. Do not blindly copy the parent's absolute material quantities. Rework inherits unless an explicit approved rework instruction changes the route/recipe; that change is a separately audited workflow, not automatic re-resolution to today's season. Genuinely new sales releases use current season.

### MRP / procurement and other consumers

Every unreleased-demand query resolves active season and approved recipe by scope once, then batches specs. Released demand uses frozen bundles. Define a disjoint quantity partition between unreleased sales demand, authorized pending releases and released cards so they are neither omitted nor counted twice. Version the demand calculation basis and invalidate caches after season, recipe or rule publication.

Existing reservations, requisitions, purchase orders and issued materials are not silently rewritten after a toggle. Show demand delta and follow the existing amend/cancel workflow. A missing Monsoon recipe appears as blocked demand, never zero demand or “covered.” Check shared material calculations across web UI, BFF procurement demand and analytics; editing only `lib/material-schedule.ts` is insufficient.

## 5. Continuous entries, quantity ledger and close rules

### Data model and quantities

New V2 tables:

- `JobCardStageEntry`: plant/card/stage/entry number; DRAFT/SUBMITTED/VOID; production or QC_ONLY kind; business date; shift; validated operator ID and name/code snapshot; optional supervisor/QC attribution; machine and optional segment; optional times; produced/accepted/rejected; remarks; row version; immutable submission revision and audit links.
- `StageEntryRevision`: append-only corrected submitted payloads with actor/time/reason and predecessor. “Void-and-replace in the audit” alone is insufficient; retain retrievable original revisions and reference the current effective one.
- `StageInputAllocation`: upstream submitted entry/revision, downstream entry/revision, quantity in upstream unit and quantity in downstream equivalent, frozen conversion, disposition. Unique logical allocation keys prevent duplicate consumption.
- `StageQualityObservation`: stable physical sample ID, stage/card/entry, parameter/value/unit, measured/recorded times, author, instrument where existing policy requires it, revision and inspection links. Unique effective `(card,stage,sample_id,parameter)`; append corrections instead of overwriting history.
- Stage aggregates: produced/accepted/rejected/consumed totals, effective entry count, open draft count, row version, closure actor/time/reason/type, QC readiness, pending external effects. Totals derive from effective submitted revisions, never drafts or voids.
- `CommandReceipt` stores all mutation idempotency keys, request hashes and responses; `OperationalOutbox` stores durable external effects.

New quantity columns use integer counts for bamboos/pcs (or fixed-scale Numeric with integral checks), not unconstrained floats. Legacy float fields get validated adapters. Winding/Oven quantities are bamboos; Process and later stages pcs. Freeze a positive integer pieces-per-bamboo and the selected bamboo length. Winding/Oven target is `ceil(planned pcs / pieces-per-bamboo)`; Process retains the sales target. Do not invent a unit for optional Slitting; preserve its existing contract.

### Input conservation

- Winding creates new output under its existing reel/material issue controls.
- Oven: allocate input bamboos from submitted Winding entries. For a completed production entry `input_bamboos = produced_bamboos = accepted + rejected`. A rejection consumes input too.
- Process: allocate whole input bamboos from Oven; `input_equivalent_pcs = input_bamboos × frozen pieces_per_bamboo`. Require `produced_pcs = accepted_pcs + rejected_pcs <= input_equivalent_pcs`. The remainder must be explicitly recorded as cutting loss or held carryover, with reason. Carryover is a separate ledger balance consumed once by later entries, not silently discarded or rounded into fractional bamboos.
- One-to-one later stages consume pcs with explicit loss/hold balance where applicable. QC-only entries consume/produce zero and have validated QC author attribution; do not require an invented machine operator.
- Ordinary zero-output/no-observation submission is rejected. Reject-only production (`produced>0, accepted=0`) is valid and consumes input. Drafts may be incomplete and never affect totals/availability.
- Enforce server equations and all nonnegative finite/integer checks. An `input_qty` field that defaults to produced but accepts arbitrary lower client values is forbidden.

Availability = effective submitted upstream accepted quantity, minus allocations and unreleased hold quantities, converted explicitly. Downstream allocation is FIFO by default, with source entries shown and selection permitted when physically appropriate. All referenced rows must belong to the same authorized card/plant and valid route relationship. No cross-card reuse without a dedicated transfer/rework record.

Use actual `routing_snapshot.stages` to select previous stage; do not hardcode Process→QC→Packing or reorder the current route. Enable only the named continuous pairs. Sequential edges require upstream closed plus available accepted quantity. Preserve optional Slitting gates and current final-QC/Packing order.

### Commands, locks and authorization

All card-local mutations lock the parent JobCard first, then stages in frozen route order, then entries/allocations in stable order. One card lock is an acceptable simple concurrency boundary; unrelated cards proceed concurrently. Recheck availability, holds, expected revisions and authorization under the lock. External network calls must not run while these locks are held.

Endpoints under `/job-cards/{id}`:

| Endpoint | Contract |
|---|---|
| `GET /flow` | Small per-stage totals, own unit, available input with unit, active stages, can-close and structured blockers; card version and frozen-season summary. |
| `GET /entries?stage=&cursor=&limit=` | Cursor-paginated entries and QC summaries; detail/samples lazy. |
| `POST /entries`, `PATCH /entries/{id}` | Draft create/edit; submit intent optional. Expected version on edit. |
| `POST /entries/{id}/submit` | Validate quantities, shift/operator, route and availability; allocate input, evaluate supplied observations, update totals and audit atomically. |
| `POST /entries/{id}/correct`, `/void` | Reason and expected version; reject reducing already-consumed upstream availability. Preserve revisions, inspections and hold evidence. |
| `POST /entries/{id}/observations` | Assigned QC can add/correct observations with no permission to alter quantities. Require correction reason/version when replacing readings. |
| `POST /stages/{stage}/close` | Supervisor employee, expected stage/card version, short-close reason where relevant. All close checks execute in one transaction. |
| `POST /stages/{stage}/reopen` | Owner/Admin, reason, dependency and side-effect checks. |
| `POST /entries/batch` | Whole-card entry in route order, atomic transaction. Each item can submit and optionally close. One batch request key; any failed item rolls back all local changes/effects. |

Every mutation, including submit/close/reopen/correct/publish/switch, requires an idempotency key and payload hash. Retry uses the same key; a changed payload requires a new one. The server owns accepted/rejected totals, evaluations, author identity and scope. Permissions are operation-specific, not just “PlantManager+.” Operator can edit own drafts and submit within assigned stages when granted submit capability; default that capability off until configured. PlantManager/Admin/Owner submit/correct production; QC edits observations only. Supervisor closure attribution must resolve to an authorized active employee; selecting a name does not grant the acting user permission.

### Target, close and reopening

Reaching accepted target shows “Target reached — close stage” but leaves it open. Record real excess output; beyond the existing 10% advisory threshold require a reason, never fake smaller quantities. Threshold compares actual produced total to planned production target; rejected output does not disappear from the capacity/variance view. Accepted quantity controls target fulfilment. Keep valid scheduling capacity/cycle checks separate from whether physical production can be recorded.

A normal close requires:

1. Upstream stage closed where one exists; continuous entries may still overlap before closure.
2. Validated supervisor name, submitted quantity totals, and zero unresolved drafts (submit/discard explicitly).
3. At least two valid distinct samples for every applicable required parameter, and no unresolved invalid measurements or blocking QC holds. Record-only observations count as observations, never fabricated PASS.
4. Upstream/input/carryover reconciliation, existing winding reel-issue requirements and any stage-specific tools/packing checks.
5. Accepted target reached, or authorized short-close reason and downstream target reconciliation.

Neither short close, force close nor an Owner override may manufacture missing readings or waive a non-waivable rule. A safety/cancellation workflow may stop work with incomplete QC, but records CANCELLED/ABORTED or QC_HOLD rather than a successful production close or released stock. Numeric deviation disposition uses the existing assigned QC/Owner workflow; retains the original FAIL and disposition, and does not convert it to a raw PASS.

Short closure records original target, effective downstream target, unmade quantity and sales-balance reconciliation separately. Reducing a target does not hide rejects or excess. Residual upstream accepted stock after downstream closes must have an explicit WIP/rework/scrap disposition. Example: Winding closes 105 accepted, Oven consumes 100 and closes; the remaining five bamboos remain visible and prevent card-level reconciliation until dispositioned.

Closed stages reject new production entries until reopened. Reopening a stage whose downstream is closed requires an explicit affected-stage preview and authorized reopening in dependency order. Once FG/dispatch effects exist, use governed correction/reversal records; do not naively replay close. Extra production after final posting uses a linked additional-production card or approved correction workflow. Reopen/close cycles must never double-count FG, tool usage, packing or monthly theory.

### QC holds during overlap

Submitted quantity with no readings can flow, explicitly labelled “QC pending,” as required by close-time QC. A known blocking failure immediately blocks new downstream allocation. V2 initially uses the existing conservative card-level hold scope; entry allocations provide traceability for later finer-grained holds. Do not pretend to isolate a failing sample's quantity without a defined lot mapping.

If failure is entered after downstream production, mark affected WIP/FG as held and use existing late-exception/exposure handling. Preserve earlier dispatch history and alert the responsible QC/Owner through existing in-app workflows. Final stock release/dispatch checks all upstream required QC/dispositions, not merely the latest stage's PASS. Correcting/voiding an entry does not auto-release an existing hold; authorized disposition is explicit.

### Durable completion effects and compatibility

Close transaction updates local stage/inspection/packing/audit state and inserts durable outbox events with stable effect keys. Worker retries FG inward, tool usage and sales synchronization using receiver-side idempotency; record attempt count, last error and acknowledgement. UI distinguishes “Stage closed · inventory posting pending” from fully posted completion. A process crash after commit must not lose effects. The existing `_DEFERRED_EXTERNAL` ContextVar is only an in-memory list and is insufficient for this contract.

Keep `JobCardStage.output_qty = accepted_total` and `scrap_qty = rejected_total`, but do not claim all consumers work unchanged. Also update input totals, segment totals/status, open-stage projections, lifecycle/current-stage filters, floor log, planning handovers, time reconciliation, cost/reel theory, quality metrics and stock posting. `current_stage` becomes the earliest unfinished route stage for legacy display; provide `active_stages` so concurrent Oven work is discoverable. Persist explicit segment links when multiple planned segments share date/shift/machine; never auto-match ambiguously.

Legacy endpoints keep legacy semantics for legacy cards. For V2 cards, adapt the old payload through the V2 command with an explicit stable command identity and cumulative-vs-incremental mode; never turn a resent old cumulative total into a new additive entry. If the caller cannot provide the required semantics, return `CLIENT_UPGRADE_REQUIRED` instead of double-counting. Existing whole-card batching must remain atomic; use the shared domain service and durable outbox, not nested committing handlers.

## 6. UI specification

### Specification editor

Season selector changes the recipe being edited; it never changes the production season. Separate form state and dirty indicators per season. Show version, draft/approved status, confirmation and history. Explicit Copy ROY→Monsoon replaces only the target draft after a visible diff/overwrite confirmation. Confirmation invalidates on subsequent edits. A bottom blocker area links to each missing confirmation, recipe calculation error or QC reference conflict.

On approved specs, “Revise ROY recipe” and “Revise Monsoon recipe” have independent change note, draft, comparison and approval flows. Show affected unreleased demand and preserve released-card counts. Read-only effective QC panel shows season, global rule version, overlay chain, customer constraints, actual resolved bounds and units. No hidden manual QC editor competing with global rules; “Create customer/spec override” opens the governed overlay editor.

Print both seasonal recipes when printing a spec, with continuation pages for any number of plies. Job-card print shows the frozen selected recipe only. Include version/source labels on all pages. Reprints cannot read today's recipe headers.

### QC rules screen

Quality → Stage rules: ROY/Monsoon tabs, published version, draft, Copy, History, Impact, Publish. Three stage sections with plain-language formulas and an expandable structured builder. Show proposed numeric process-height endpoints with a required first-publication acknowledgement. Builder explains record-only, required readings and observation vs PASS. Customer/spec overlays have target, season, reason, effective-parent diff and loosening classification. Impact is paginated and scoped; unauthorized users get read-only views with no mutation affordances.

### Owner season screen

One global switch with explicit “Applies to both plants” scope text, current epoch and history. Preview lists readiness and material-demand changes; released cards and pending authorizations retain their shown season. Top bar gives the global season, while every card gives its own frozen season. Never substitute a cached top-bar value for server release authorization.

### Floor entry

Extract components from `JobCardDocument.tsx`: StageFlowStrip, StageEntryList, StageEntryForm, StageCloseDialog and StageQcReadiness. Stage strip follows frozen route and shows multiple active stages, produced/accepted/target, unit, upstream available and hold state. Entry list shows date, A/B, operator name + employee code, quantities, QC pending/fail/pass/observation, supervisor attribution and status.

Provide “Add shift/batch entry” and “Enter total for stage.” The latter explicitly means either first-and-only total or a server-calculated remaining delta from the current recorded total, with preview and expected version. Default to incremental entry; label it “This entry quantity,” and show the resulting stage total. Never add a cumulative total as a new increment silently.

QC grid supports separate sample rows and parameter columns; stage-wide counters show `1/2`, units and frozen bands. Oven pre/post pair on the same row/sample ID; additional samples are explicit. QC-only entry has zero quantities and a QC author. Optional times are collapsed, support overnight Shift B with explicit dates, and validate end≥start only when both are present. Missing times remain unknown for runtime/OEE rather than treating entry timestamp as actual production time.

Close dialog lists all blockers, required supervisor, pending drafts, target/shortfall/excess, QC sample counts and remaining WIP. Renames: WINDER display → Winding; Ready for floor → Winding when that is actually the ready stage, otherwise the real stage; Meters produced → Quantity produced; Supervisor/QC sign → Supervisor/QC name on screen and print. Retain planner's internal metre calculations. Operator picker displays and snapshots `name · employee_code`.

Keyboard: standard Tab order; Enter submits only the intended action, never jumps unpredictably from multiline/select controls. Focus error summary, restore focus after closing dialogs, support Escape, unsaved-change prompts and readable touch targets. Check narrow mobile widths and nested-picker z-index. Pending network state locks duplicate actions; retry retains request key. Never optimistically show accepted stock as available before server confirmation. Successful mutation updates only relevant flow/entry caches; 409 preserves form data and offers refresh/diff.

Print includes all entries/readings via continuation pages, totals and sample IDs. A condensed signed floor summary may show fewer rows only if clearly labelled and accompanied by the complete annex; do not silently truncate to the latest three/four entries.

### Specification list

`GET /specs/summary` supports authorized plant, search, customer, status, recipe/QC readiness, stable sort, cursor/page and bounded limit (default 50). One row per current lineage/spec, with older revisions under history. Fields: customer/code, size with units, mandrel, CS, target weight, spec revision, each season recipe revision/approval/confirmation, readiness reason count, updated timestamp and row version. Add an actual maintained `updated_at`; the current model only has `created_at`.

Global filter counts and readiness filters must apply before pagination, not just to fifty rows resolved afterward. Maintain a version-stamped readiness projection keyed by spec revision, both recipe bindings, global rule heads, overlay heads and reference hash. Publication enqueues affected recomputation. A stale projection shows “Rechecking” and cannot falsely claim ready; release always resolves authoritatively. Small sets may resolve in a bounded batch; no all-spec in-process scan per page or per-row service requests. Define facets over all authorized matching rows, with the current chip excluded where needed for useful counts.

Dense desktop table with sticky header; mobile uses concise rows/cards. Chips: All, Draft, In review, Live, Monsoon unconfirmed, QC blocked, Obsolete. Search/customer/sort/state are URL-synced. Recipe chips show each season independently; QC icons include text/tooltips, not color alone. Drawer loads on open and shows both recipes, effective rules, blockers, history and batched usage. Paginate history and entries. Preserve prior data while loading with visible loading state; cancel stale searches.

Bulk “Confirm existing Monsoon copy” is a bounded, resumable job with per-row expected content/spec hashes, authorization and results. It confirms the displayed copy; it never overwrites a custom Monsoon recipe with ROY. Changed rows return conflict. CSV export is authorized and spreadsheet-formula-safe. Print selected supports continuation pages and progress.

## 7. Migration and staged activation

**Updated rollout choice:** the user subsequently requested a clean test-data reset. Section 10 is therefore the primary cutover path: rehearse on a restored copy, archive the existing test dataset, reset it coherently, then enter fresh specs/orders/cards. The preservation/migration steps below apply to rehearsal, compatibility and any explicitly retained records; they are not a requirement to carry unwanted test transactions into the fresh system. Build and validate migration/compatibility helpers only to the extent needed by the chosen cutover and supported legacy readers; avoid unnecessary bulk migration followed by deletion.

Do not run business-data backfills or remote masterdata fetches in every API worker's startup. Use versioned, resumable one-shot migration commands with dry-run reports, row counts, checkpoints, locking and reconciliation. Additive schema creation is separate from data migration and feature activation. Choose unused Alembic IDs after checking current HEAD; keep any runtime schema compatibility bridge aligned.

1. Back up and restore-test a representative isolated copy. Inventory legacy specs, approved profiles, recipe duplicates, open cards, segment quantities, holds, reservations, pending FG and historical snapshots.
2. Expand schema; introduce nullable fields, ledger/receipt/outbox tables and indexes. Deploy backward-compatible readers with V2 flags OFF. Seed draft global templates and scope state at ROY without changing current release selection.
3. Backfill recipe lineages/bindings and independent Monsoon copies idempotently. Existing approved ROY recipe content and historical IDs stay intact. Report ambiguous multiple approved recipes and block their V2 activation pending resolution.
4. Import existing approved per-spec QC profiles as proposed legacy-preservation overlays, including all constraints, applicability and gating. Keep the current approved profile effective until an authorized comparison is approved. Never switch to the new global rules while a differing approved legacy overlay is merely draft. Report differences and migrate each spec atomically to its approved effective V2 stack.
5. Review/approve initial rule endpoints, scope and overlay changes; complete recipe confirmations for rollout specs. Rules and recipes may be configured without activating them for releases.
6. Release bundle/card model is pinned per card: `entry_model=LEGACY|V2`, `snapshot_schema_version`, evaluator version and immutable hashes. New V2 releases are enabled for a controlled trial only after the full release/entry/evaluator path is deployed.
7. Default existing in-flight cards to LEGACY and finish them normally. Optional migration runs per-card under lock after dry-run reconciliation. Use actual segment/entry evidence, not `output>0` alone; preserve reject-only, QC-only and hold-only records. Never fabricate missing shifts, employees or QC readings. Any ambiguous totals, external posting or missing attribution keep the card LEGACY and appear in an exception report. Completed cards remain unchanged.
8. Cut over the specification list and remove legacy manual QC write paths for migrated specs only. Verify behavior in both plants before broader activation.

Migration reconciliation proves produced/accepted/rejected/input totals, source allocations, sample counts, active holds, packed/FG quantities and sales balances are unchanged unless an explicit approved correction exists. Startup/re-run cannot duplicate entries, Monsoon recipes, audit history or postings.

Rollback before V2 writes disables flags and keeps the expanded schema. After V2 writes, do not deploy an old binary that cannot understand them. Keep a compatible reader/worker release available, pause affected commands and roll forward or restore through a rehearsed reconciliation procedure. A feature flag is not a data rollback. Do not drop populated new tables or delete audit to “undo.”

## 8. Implementation work packages and file map

Relative paths below are grounded in the reviewed checkout; verify HEAD and local changes before editing. No instruction here authorizes this review agent to deploy. The implementor follows the user's actual implementation/release authorization.

| Package | Main files / work | Completion gate |
|---|---|---|
| A — contracts and schema | `hariom-erp/services/spec-service/src/models.py`, `main.py`, `schemas/` or existing schema modules; production `models.py`, `main.py`, Alembic; new migration commands | Schema constraints, draft seeds, scope mapping, data dry-run and restore fixture. |
| B — rule engine | `hariom-erp/shared/hariom_quality_eval.py`, spec `qc_profile.py`, new `qc_rules/{refs,validate,resolve,seed}.py`; web `lib/qc-measurement.ts` | Numeric boundary, dynamic pair, overlay and legacy/incoming QC regressions. |
| C — recipe/document service | spec `routers/specs.py`, `routers/recipes.py`, `services/approval.py`, new domain services; web `hooks/use-specs.ts`, `lib/spec-sheet.ts`, `components/specs/SpecSheetDocument.tsx` | Independent content/binding versions, atomic save/approval and no old endpoint bypass. |
| D — release and demand | spec new season/release authorization routers; production `routers/planning.py`, sales release sync; `apps/bff-api/src/services/procurement_demand.py`, analytics demand code, web `lib/material-schedule.ts` | Switch/release races, immutable complete bundles, demand partition and failures/retries. |
| E — entries and effects | production new entries domain/router, `lifecycle_rules.py`, `routers/planning.py`, `quality.py`, `lifecycle.py`, `missed_slots.py`; operational outbox worker; inventory idempotent receiver | Conservation, holds, atomic batch, close/reopen and crash recovery. |
| F — user interfaces | new `quality/stage-rules`, Owner season settings, extracted recipe/entry components, `lib/job-card-display.ts`, spec/card print components, top-bar season chip | Authenticated roles, mobile/keyboard/error/retry paths and complete printed output. |
| G — list and rollout | spec summary/readiness projection, batch usage in sales/production, `app/(dashboard)/specifications/page.tsx`; BFF proxies in `routes/{spec,production,sales}.py` | Correct filtered totals, bounded query counts, migration reports, controlled floor acceptance. |

Important source integration details:

- `production-service/src/quality_eval.py` searches service-local `shared/` before the canonical tree; production/inventory Dockerfiles copy their service-local shared directories. Build must package the exact canonical evaluator into both services, or remove drift-prone copies and change the build context. CI asserts loaded module path, schema version and file hash in the built images. Editing only `hariom-erp/shared` is insufficient.
- `shared/audit_outbox.py` captures ORM flush changes. Raw SQL migrations/bulk updates and in-place JSON mutation need explicit audit or tracked assignment; no claim that “every write” is automatically covered. Confirm authenticated actor, reason, before/after values, plant/scope and outbox replay. Store business event types for publish/confirm/switch/close in addition to row changes.
- Register static endpoints such as `/summary`, `/document`, `/diff` before parameterized `/{id}` routes where matching would otherwise conflict. Replace v1's placeholder overlay APIs with typed, tested draft/get/publish/archive/history/diff/impact endpoints. Authorize reads/history/export/preview as well as mutations.
- Existing `ApprovalService.approve_recipe` commits and updates `spec.approved_cs`; extracting transaction ownership and seasonal trial semantics is compulsory.
- Existing snapshot builder selects first approved recipe (or first recipe fallback) and fetches yield/BOM separately. Replace this for V2; preserve a tested legacy adapter.
- Existing batch handler already has a transaction wrapper at this HEAD. Preserve that behavior while replacing in-memory external effects; older audit findings are not evidence that today's batch remains non-atomic.

## 9. Verification and acceptance contract

Use isolated PostgreSQL databases whose names meet existing test safeguards; never point migrations or tests at production. Reuse repository verification scripts only after checking environment names/ports. Run Python service suites relevant to edits, shared evaluator tests, frontend typecheck/lint/unit tests and browser acceptance against an isolated stack. Do not claim a browser pass from source inspection.

### Required automated cases

1. Every formula at lower, upper, just-inside/outside boundaries; missing/zero/invalid refs, asymmetric customer bounds, conflicting process ID, positive oven pair, partial moisture bands, units and decimal precision.
2. Min readings across different entries and one total entry; partial samples; repeat same sample; corrected/void observations; record-only required; notching N/A; FAIL followed by PASS; non-waivable and instrument readiness regressions.
3. Global scope applies to both plants, but plant A user cannot read/edit plant B objects or supply an unauthorized overlay/spec/employee ID. QC cannot switch season; Admin alone cannot switch; Operator cannot publish or close; QC-only mutation cannot edit quantity.
4. Seasonal recipe independence under concurrent edits/approval; spec re-version retains unchanged content revisions; stale confirmation hash; custom Monsoon not overwritten by copy/bulk; trial linkage; atomic rollback on bad second-season payload.
5. Publication concurrency, overlay BOTH vs seasonal precedence, weakened required/gating detection, base publication invalidating stale impact, cache invalidation across workers, immutable legacy cards.
6. Release concurrent with switch on either side of the authorization lock; service timeout/crash/retry; stale spec/sales context; identical versus changed idempotency payload; immutable BOM/geometry/rule refs; child quantities use frozen per-unit math.
7. Oven consumes 40 from Winding accepted 60 while Winding open; additional 21 denied when only 20 remain. Draft upstream contributes zero. Input=0/produced=100 rejected. Reject-only entry consumes its input. Process whole-bamboo conversion and carryover cannot be spent twice.
8. Two tablets submit against the same available input; exactly one wins when insufficient for both. Stale correction/void cannot reduce already consumed upstream quantity. Lock ordering is deterministic for whole-card batch and single-stage edits.
9. Known QC fail blocks new allocation; late failure holds downstream WIP/FG; original failure remains after correction; insufficient readings cannot be bypassed by short close/Owner; supervisor required only at close. Pending drafts block close.
10. Target reached but extra entries allowed while open; beyond tolerance reason; short close and residual WIP; closed-stage edit denied; reopen with downstream closure and FG posting does not duplicate effects. Force-close preserves made quantity through the remaining route.
11. One total-entry card and multi-entry card yield identical totals for the same physical production. Cumulative old client resubmit cannot add twice. Atomic whole-card invalid later stage rolls back every local row/outbox effect.
12. Crash after close DB commit before external send; send succeeds but acknowledgement lost; repeated close/reopen; duplicate inventory receipt. Exactly one net FG effect, tool count and sales reconciliation; pending/errors remain visible and retryable.
13. Migration rerun and multi-worker startup; approved legacy QC preserved; reject-only and partially completed segments; missing old shift/operator; completed-card immutability; total/hold/stock reconciliation.
14. List search/filter/facets against the full dataset, including readiness changes outside first page; stale projection; unauthorized export; customer grouping; lazy drawer; 20-row bulk operation with 18 success/2 explained conflicts.
15. Incoming-material QC fixtures unchanged; packaged production/inventory evaluator identity; historical snapshot/reprint semantics; no regression in packing, dispatch and quality metrics. First-pass yield derives from quantity and original inspection cohort, not an inspection count inflated by corrections.

### Browser and floor scenarios

- QC publishes Monsoon OD +0.9..+1.3, ROY unchanged, diff/audit visible; customer tightening overlay resolves correctly and a loosening request is gated.
- Owner switches global season; both authorized plants show the new state. Newly authorized cards carry the matching recipe/QC versions; old cards and pending pre-switch authorizations remain visibly old.
- Spec Monsoon recipe revision changes one ply while ROY and base spec content revision remain unchanged; historical reprint reproduces old content.
- A 1,000-pc card at 10 pcs/bamboo: Winding entry A produced 62/accepted 60; Oven consumes 40 while Winding open; later Winding B produced 45/accepted 45. Winding close requires two samples per mandatory parameter and supervisor. After closing at 105, Oven processes another 60, closes at 100 accepted and explicitly dispositions remaining five upstream bamboos. Process allocates 100 bamboos, produces/accepts 1,000 pcs, supplies required QC, and finishes through the existing route. Totals and material/stock effects reconcile.
- Same scenario using one total entry where no incremental entries exist. Enter cumulative totals after partial entries and confirm only the displayed remaining delta is posted.
- Run mobile and desktop with actual QC, Operator, PlantManager and Owner sessions; verify A/B, operator code, optional overnight times, keyboard traversal, exact blockers, lost-network retry, concurrent stale form and print continuation pages.

### Performance, instrumentation and release gates

Baseline query counts and latencies before changes on a documented representative environment. Target p95 server time: paginated 50-row spec summary ≤300 ms over at least 500 specs; small flow read ≤200 ms; local submit/close command ≤500 ms excluding asynchronous external effects. These are acceptance targets, not measurements from this review. Exercise simultaneous tablets and publication/release races, not only a single warm request.

List queries and request counts must remain bounded as page size/data grows: batch overlay/reference reads, no per-row HTTP calls, paginated histories/entries, cached immutable rule content keyed by scope/version/hash, authoritative head-version reads, and indexes supporting actual filter/sort/ledger predicates. Impact calculations, migration, bulk confirmation and export use bounded background jobs where needed. Index allocations by upstream source and active downstream entry; observation/entry pagination includes stable ID tie-breakers. Add query-plan evidence.

Record request IDs, authorization/bundle hashes, evaluator version, lock/retry conflicts, outbox age/errors and migration exception counts without credentials or sensitive payload dumps. Include independent checks for conservation and aggregate-vs-ledger reconciliation.

Implementation acceptance requires the above tests and authenticated isolated browser evidence. Production activation additionally requires approved configuration, migration comparison sign-off, deployed commit/image identity, backup/restore evidence, a controlled floor shift, actual printer verification if physical output is in scope, and a compatible rollback/roll-forward rehearsal. Deploying dormant schema/code is not permission to auto-enable new rules, rewrite existing cards or publish defaults.

## 10. Fresh-start reset of current testing data — requested addon

### Objective and boundary

Provide a genuinely clean operational starting point after the changed system is installed and verified. Users will create fresh specifications, recipes, sales orders and job cards. This is a planned one-time maintenance operation, not a routine user-facing Delete All button and not a deletion during this review.

The reset covers the current test dataset across both plants and every dependent service. It must not stop at deleting three parent tables. Customer/order links, schedules, reservations, QC holds and generated inventory must not survive as orphaned or misleading balances. Produce a source-derived reset manifest and exact counts before execution. The user's instruction establishes the intent to discard the test business data; the implementor must still identify the exact deployment/database scope and rehearse the concrete command before applying it. Do not guess environment identity from a database name or the chat working directory.

### Retention and deletion matrix

| Data group | Fresh-start handling |
|---|---|
| Specifications and recipes | Remove current test specs, dynamic values, trials, approvals, seasonal bindings/revisions, overlays attached to old specs/customers, save-operation receipts and operational readiness projections. Preserve required field definitions and application schema. Users enter new specs and both recipes afterwards. |
| Sales | Reset test orders, lines, release lots/authorizations, fulfilment allocations, amendments, attached operational documents and linked sales transaction history from active business views. Include test quotes/customer PO transaction records where present and linked; enumerate actual tables first. |
| Production and planning | Reset cards, parent/child links, stages, segments, entries/revisions, input/carryover allocations, observations/inspections/holds/dispositions, planned slots, queue assignments, machine workload, missed-slot events, production reports and job-linked tools/reel usage. Preserve machine definitions, shift definitions and plant calendars unless explicitly marked test master data. |
| Inventory and dispatch | Reset test issues/returns/reservations, WIP/FG receipts, packing, dispatch, inward/GRN and movement records that contribute to the reset dataset. Rebuild derived balances from the retained ledger, or to zero when the ledger is fully reset. Never delete only stock movements while leaving positive on-hand/cache balances, or reset balance without the matching ledger. |
| Procurement and commercial dependants | Include generated demands, requisitions, test POs, GRNs, invoice discrepancies, debit notes, payment/accounting/export links where these modules exist. Determine FK and logical links from source/schema. Reset the connected test transaction set together; do not leave liabilities or reserved procurement against deleted orders/specs. |
| Material/reel/coil/FG batches | Remove test lots and serialized stock records with their movements. Record real physical opening stock only through fresh governed opening/inward transactions after reset; do not silently carry test quantities into production. |
| Customer/material/tool/employee and other business masters | Inventory all current masters and identify which are reusable setup versus test business data. Default full-test reset removes test customers/products/material catalog entries and dependent test master data included in the reviewed manifest; users can rebuild them. Retain explicitly vetted real masters only by an ID allowlist with an explained dependency closure. Never assume every master is real, or delete employees backing retained user identities without an approved replacement mapping. |
| Essential setup and access | Preserve authentication accounts, password hashes, roles, permissions, plant identity, organization/scope keys, technical configuration, units, required enums, shift A/B structure and vetted machines/calendars. No credential or security reset is implied. These are infrastructure needed to log in and rebuild the business dataset. |
| New seasonal QC templates and feature configuration | Keep the newly delivered versioned ROY/Monsoon draft templates, schema and feature configuration; reset stale test publications/overlays via the manifest. Active season starts ROY. Owner/QC reviews and publishes the fresh templates before real release. Do not seed production sample specs/orders/cards. |
| Audit and backups | Preserve an immutable archive of the pre-reset business/audit state and all backup/recovery evidence. Existing audit records remain in an archive/read-only history namespace or retained append-only tables with archived-entity labels. Record one attributed reset event with manifest hash, counts, time and backup reference. User-facing active business lists start empty without erasing the reset's evidence. |
| Caches, queues, files and reports | Clear only affected operational cache keys, readiness/search projections, analytics snapshots, notification references and generated test reports. Quarantine stale retry jobs and undelivered effects so they cannot recreate stock/cards. Archive/remove active links to test uploads/PDFs/labels using an exact file manifest and retention policy; never broad-delete storage buckets or unrelated filesystem trees. |

If inventory/procurement/accounting source dependencies are not yet known, the reset runner must stop with a named unresolved dependency, not use `TRUNCATE ... CASCADE` to discover the scope destructively. There is no promise in this plan that these modules share one database or one transaction.

### Reset tooling

Add a maintenance CLI/service command, for example `scripts/reset_test_business_data.py`, with separate `plan`, `validate`, `apply`, `verify` and `restore-guide` modes. This is a proposed new file, not a claim it already exists. Required inputs: exact environment ID, service/database fingerprints, both-plant scope, reset run ID, backup manifest, manifest hash, explicit retention allowlist and expected row counts/data revisions.

The manifest lists each table/model/service, dependency order, predicate or exact record IDs, deletion/reconciliation strategy, expected counts, retained IDs, outbox/queue actions and affected object-storage files. Review logical links in JSON snapshots and external-reference fields in addition to FKs. No wildcard environment targeting, broad home-directory deletion, blind schema drop or unreviewed cascading truncation. Commands redact credentials from logs.

`apply` validates that the reviewed manifest still matches the frozen dataset; drift returns a safe error requiring a new plan. A completed run ID replays its receipt rather than wiping newly entered records. Store reset state outside the cleared business tables. Use a new operational data epoch/namespace so old idempotency receipts, external retries, scanned QR codes or recycled card numbers cannot target new records. Keep fresh IDs globally unique; do not reset counters in a way that reuses historical document identifiers without an explicit new prefix/fiscal sequence policy.

### Execution sequence

1. **Rehearsal:** on an isolated restored copy, generate the full manifest, apply reset and verify emptiness/retention/rebuild. Exercise the restore procedure across all involved databases and file manifests. Record duration and row/balance reconciliation. The reset program is tested before scheduling the real maintenance window.
2. **Prepare:** verify deployed environment and source/image identity, publish maintenance notice in the app, stop new sales/releases/entries/master edits and prevent scheduler/background jobs from mutating data. Drain or pause workers, durable outboxes, external stock retries and periodic missed-slot reconciliation. Block stale browser/API clients with maintenance/epoch checks.
3. **Backup:** take consistent backups of every involved database plus required attachment indexes/files and config references. Record checksums, snapshot times and successful restore evidence. Archive the pre-reset operational reports and test-state counts. A lone backup file without a tested restore is insufficient.
4. **Finalize manifest:** recheck counts and hashes while writes are paused; surface retained masters/access/config and deleted test data. Capture an attributed maintenance execution record. Approval of this concrete reset follows the implementor's applicable release permissions; the original attached document itself is not authority to delete an unidentified environment.
5. **Apply:** execute dependency-ordered deletions/reconciliations, normally child records before parents, within transactions per database. Use a persisted coordinator checkpoint for multi-service progress. Keep every service in maintenance until all databases, queues and projections are consistent. No external callbacks during reset. Any failure leaves maintenance ON; resume deterministically or restore the entire compatible snapshot set, never just one mismatched database.
6. **Initialize:** preserve/recreate required technical defaults without sample business data; global season ROY, new draft QC templates, valid A/B shifts, counters/namespaces and feature flags. Only explicit vetted masters are carried forward. All stock is zero unless there are deliberately retained, reconciled real opening transactions.
7. **Verify:** run the checks below, clear affected caches and confirm old jobs/receipts cannot replay. Re-enable readers, then writers and workers in controlled order. Run a labelled end-to-end smoke dataset; remove that exact dataset with the same dependency-safe tooling before handover, or explicitly identify it as retained acceptance data. Do not leave unexplained smoke quantities in real stock.
8. **Handover:** show empty active specs, sales orders, job cards, planning and operational QC queues; provide the retained-master/setup list. Users rebuild customer/material masters as needed, publish the reviewed seasonal QC templates, create new specs with confirmed Monsoon recipes, then enter new orders and release new cards.

### Reset acceptance checks

- Both plants' active spec/order/card lists and all corresponding search, facets, reports, queues and workload indicators reflect the fresh state.
- No active FK or logical reference to deleted records; no pending release authorization, retry, notification action or cached response can resurrect an old card or stock transaction.
- Inventory on-hand, reserved, available, WIP and FG reconcile exactly to the retained ledger (zero when no business movements are retained). Procurement demand, pending releases, shipments and commercial balances have no residual test values.
- No old QC hold blocks a new card, and no archived PASS approves a new card. New cards cannot resolve deleted specs/recipes or reuse an old snapshot based on a stale client cache.
- Authentication, assigned roles, cross-plant isolation, essential machine/shift setup and audit/archive retrieval still work. Previously issued technical credentials remain protected.
- Running the completed reset command again is a no-op with its original receipt; it does not delete newly entered business data. A changed manifest requires a new reset run and explicit reviewed scope.
- Simulated failure between service resets, failure during cache cleanup, stale worker restart and database restore are tested. The maintenance gate prevents users seeing/using a half-reset system.
- New clean flow passes: customer/master setup → new spec with two seasonal recipes → QC publication → sales order → release → continuous stage entries → required QC/supervisor closure → packing/FG/dispatch through the actual route.
- Owner switches to Monsoon and releases another clean card; correct recipe/QC versions freeze, no pre-reset IDs appear, and the original new ROY card remains unchanged.

### Delivery dependency

Add **Package H — coordinated test-data reset and clean-start acceptance** after the new feature path passes isolated verification, before real business entry. It touches the maintenance runner, schema/dependency manifest, service maintenance gates and queue controls, scoped cache/report cleanup and operational runbook. The fresh-start reset replaces bulk carry-forward of unwanted testing transactions; it does not replace backup, reference integrity, QC publication or full workflow verification.
