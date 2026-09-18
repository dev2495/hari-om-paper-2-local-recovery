# Hari Om ERP — full-cycle Quality Control blueprint

**Version 2 · 17 September 2026 · Proposed implementation, not a deployed feature**  
**Repository baseline:** `dev2495/hari-om-paper-2-local-recovery` at `44cf9950850f70de040f6d09d51dcf22495ce8d3`. Main was rechecked and returned the same SHA. Deployed/local revisions remain unverified. [Q01]

## 1. Recommended decision and scope

Build **one Quality Control business module within the existing ERP**, not a new standalone application or a new microservice at this stage. Expand the existing Quality page into a coherent workspace, reuse existing inventory and production records, and embed the same approved requirements in inward forms, specification sheets and job cards. One measurement recorded in an embedded job-card form must appear in the Quality workspace without being entered again.

This supersedes the previous narrow QC-workflow phase. It adds item-specific incoming inspection profiles, specification-stage tolerances, the pre-save tolerance dialog, legacy-spec actions, updated job-card inputs and print, deviation reasons, controlled disposition, scoped notifications, reports and post-dispatch quality follow-up. It does not supersede the other twenty original requirements.

The protected release rule remains unchanged: **sales release asks which valid, authorized same-plant winder queue to use, with no mandrel/geometry/capacity veto.** Missing new QC setup is visible in that queue and must be resolved before the applicable manufacturing checkpoint, not used to recreate a queue-admission blocker. Recording actual production is different from authorizing its quality release.

Non-negotiable principles:

- A reason explains a failed reading; it does not turn that reading into PASS or authorize stock use.
- Tolerances belong to approved, versioned profiles. Actual readings belong to identified inspection samples. Release decisions belong to authorized dispositions for identified quantities.
- Physical inward can be recorded while quality is pending. Pending, held or rejected stock is not available-to-use stock.
- Readings and historic profiles remain interpretable after revisions, retests, returns, migration and offline/late entry. No silent retrospective rewriting.

## 2. Existing foundations and verified gaps

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

## 3. Workspace and service ownership

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

## 4. Parameter dictionary and profile design

### 4.1 What one parameter defines

A parameter needs a stable internal code, client-facing name, description/help, value type, measurement unit, specimen/basis, method and instrument requirement. The dictionary defines what the parameter means; a profile defines the requirement for one item/spec and checkpoint.

Profile fields should include stage/checkpoint, parameter code, applicability, requirement timing, target, comparison rule, lower/upper bounds with inclusive/exclusive flags, displayed precision, validated storage precision, permitted categorical values, sampling rule, severity, and action when nonconforming. For text-only observations, define them as descriptive: arbitrary text cannot establish a measured PASS.

Support numeric ranges, minimum-only, maximum-only, target with asymmetric tolerance, categorical/boolean checks with explicit accepted values, descriptive evidence, and a small allowlisted set of derived comparisons. A target alone is not a tolerance. Lower/upper bounds must be normalized from target/deltas into one authoritative rule, not independently editable competing values.

Store numeric readings in a deliberate exact-decimal contract where appropriate, retaining the submitted representation and unit. Reject malformed values, NaN/infinities and booleans used as numbers before comparison. Finite validation is supported by the current Pydantic documentation, but the implementing agent must match the repository's pinned version and explicitly test boolean/coercion behavior. [TQ01]

Never use JavaScript truthiness to distinguish blank from zero. Never round a failing reading into range: compare using the approved rule precision, then display sufficient digits to explain the result. Set engineering plausibility rules separately from acceptance limits; a plausible out-of-spec reading is a valid observation, not an invalid input.

### 4.2 Approved, resolved profiles

Lifecycle: **Draft → Submitted for review → Approved/effective → Superseded or retired.** Rejected drafts return to their author. Publishing a profile is not the same as saving it, and copying a template never automatically approves it.

A category template is a starting point. Approve a resolved item/plant profile or spec-version/stage profile before it governs acceptance. Show each inherited/copied value's origin. Do not dynamically merge whichever global or plant row happens to be last in a query.

If a supplier-specific or PO-specific requirement applies, resolve it explicitly against the item's approved requirements before receipt. A supplier certificate cannot override a customer or item requirement. Combine compatible constraints only when unit, method and specimen match; conflicting requirements block profile approval for review. An authorized contractual exception is a recorded concession or revision, not a hidden weakening of the comparison.

A profile snapshot includes the full normalized rules, parameter labels/help, units/methods, applicability, sample/aggregation policy, approval/effective metadata, profile hash and evaluator version. This enables meaningful historic displays even after the shared dictionary changes.

### 4.3 Sampling and timing

Configure how many samples, which sampling occasion and what unit/lot the result covers. Options may include each inward lot, a reel, first-off setup, defined intervals, shift, segment, oven batch, after adjustment, and final release. These are supported policy types, not invented frequencies or a claim of compliance with a sampling standard.

Sample count, specimen size and affected production/stock quantity are different quantities. One failed sample does not automatically prove the entire lot is scrap; the approved containment/disposition policy decides what must be held or tested further. A configured whole-lot hold is nevertheless binding until released.

Averaging must not conceal an individual failure unless an approved method explicitly evaluates an aggregate. Preserve all specimen values and the stated aggregation rule. Do not assemble a fake passing inspection by selecting favorable values from different retest rounds.

For oven pre/post tests, use the same specimen or traceable batch basis and a `pair_id`. At pre-entry, post-values are **not yet due**; at the post checkpoint they may become required. A post reading without valid pre-context is not a complete paired test. Derived weight/moisture change is additional calculated evidence, not a replacement for the four requested measured fields.

## 5. Incoming master-item quality

### 5.1 Master UI

Every inward-capable master item exposes **Quality setup**. Show item code/name, material type, plant, procurement/stock UOM, reel/slit/form/grade details where relevant, supplier context and applicable profile status.

Required setting: **Inspection required**, **Approved exemption / not required**, or **Setup incomplete**. A default blank is not an exemption. Exemptions need authority, reason, scope and review/effective dates where applicable; they display NOT REQUIRED, not PASS.

Support appropriate profiles for raw paper/reels/slit stock, adhesives, parchment, packaging, purchased finished goods, tools and other inward categories. Do not force GSM into a tool-receipt form, and do not reuse the existing customer-rejection “reject reason” preset as mandatory acceptance criteria for all new finished goods.

Existing raw-paper presets include GSM, BS/BF, caliper, bulk, ply bond, RCT, COBB, moisture and clear-for-slitting; adhesive and parchment presets also exist. Preserve those as source-derived candidate fields, not universal required tests. [Q03] The supplied PO page requests supplier test evidence and describes widths, GSM, PB/bulk and COBB. It does not establish complete tolerances, sampling plans or measurement units for every quality field. [A1]

Preserve raw contract strings such as `350+ PB` until the comparator, method and unit have an approved mapping. A nominal GSM, target weight or printed material description must never silently become an invented ± tolerance.

### 5.2 Full inward flow

**PO requirement snapshot → physical GRN/reel inward → restricted received stock → inspection task → sample readings/evidence → server evaluation → authorized quantity disposition → stock availability → production issue.**

On an actual receipt, bind the applicable approved requirements and create one inspection task for each approved inspection unit/lot. Preserve partial deliveries, reel identity, supplier lots and multiple batches within a GRN. Receiving quantities is not conditioned on having passed QC: the system must represent material that physically arrived but cannot yet be used.

The GRN transaction records physical receipt and any applicable restriction plus durable task/notification intent. Quality-task generation must be idempotent on receipt retry. Missing required setup produces restricted **Awaiting quality setup**, not a blank screen or freely usable stock. Supplier certificates, photos and lab files attach to the actual receipt/lot; “test report required” text is not proof of attachment.

The inspector records local readings separately from supplier-declared readings. Document inspection or supplier-certificate acceptance may be an explicitly approved policy for a particular item, with its evidence source shown. It must not fabricate locally measured values or quietly count as a laboratory-measured PASS.

### 5.3 Quantity and inventory behavior

Separate physical receipt quantity, inspection coverage, sample quantity, unrestricted quantity, concession-restricted quantity, held quantity, rework quantity and returned/scrapped quantity. Quantity partitions must reconcile in their own UOM. A partial PASS must not set an entire parent batch unrestricted.

Example, illustrative only: 1,000 units received; 600 accepted and 400 held. Available stock is at most the 600 accepted units less other commitments. The 400 remains identifiable and restricted. Implement true batch/sub-lot partitioning or quantity-based restrictions that all balance/reservation/issue endpoints understand; a UI-only split is insufficient.

A disposition such as REWORK/REHEAT does not make material unrestricted merely because an existing enum maps it to WIP. Preserve physical location, quality eligibility and allocated quantity separately. Returns and scrap use existing authoritative movement/voucher logic and period protections; they do not delete the receipt or manufacture a second receipt on retry.

Purchasing sees supplier rejection, replacement required and revised usable-date risk. A supplier replacement promise is scheduled supply, not actual unrestricted stock. MRP excludes held/rejected/pending portions and avoids counting a returned lot and its replacement twice.

## 6. Spec sheet: pre-save Quality tolerance dialog

### 6.1 New-spec interaction

The visible flow should be **Fill spec → Save specification → Review quality tolerances → Save draft or submit the spec/QC bundle for approval**. The dialog appears on the deliberate save action, before final save/submission; do not open it repeatedly on autosave or each field change.

Use a large modal with stage tabs on desktop and a full-page drawer/workspace on smaller screens. Keep a read-only context panel visible: customer, product/spec reference or draft reference, plant, I.D./O.D./Height or length description, target weight, required C.S., recipe/ply summary, parchment condition, notching applicability and relevant manufacturing context. Label targets as targets and existing contractual limits as limits.

Show the client-named fields for Winding, Oven and Process, plus existing applicable final-QC requirements. Slitting/packing checks may be supported by approved profiles but are not automatically added as mandatory tests merely because the routing has those stages.

Each row exposes parameter, method/basis, unit, target, lower/upper or one-sided rule, requiredness/timing, sampling and help. Reuse verified final tolerance values when their meaning matches; do not copy final finished-product limits into winding merely because names are similar. Never auto-fill measured results with nominal targets.

Buttons: **Back to specification**, **Save draft — QC incomplete**, and **Save specification + QC / Submit for approval** according to the user's capabilities and the existing spec workflow. Draft save preserves work without approving anything. Blocking configuration issues prevent approval/readiness, not retention of a draft. Closing/back keeps all entered specification and tolerance values; discard requires explicit confirmation.

Do not let a successful modal save silently publish the spec or authorize production. Required measurement definitions, actual thresholds and approval remain configured business controls.

### 6.2 Persistence and synchronization

Use a single spec-service command to validate and save the spec draft and its QC-profile draft atomically when they share a database. Keep a stable save-operation key, payload fingerprint and optimistic version. Double-click or a lost response must return the same spec/profile, not create duplicates. Where the existing recipe save is a separate operation, either include it in a validated same-service aggregate or show a durable incomplete-save state; do not falsely claim multi-call atomicity.

Bind the profile to the specific spec version. After the user changes dimensions, recipe, weight, parchment or notching, show which QC rules need review. Do not silently recalculate tolerances from the new target. A stale dialog based on an older spec revision cannot overwrite a concurrent edit.

Final dimensional/weight/C.S. limits must have one owner. During migration, import existing final limit fields through an explicit adapter. After cutover, the approved final profile is canonical and old fields are read-only compatibility projections updated by the same spec command. Until this is implemented, preserve the existing canonical final fields rather than exposing two independent editors. Contractual final-limit changes require the normal spec/customer approval process; a routine process-QC-only revision need not unnecessarily rewrite the commercial recipe.

### 6.3 Existing-spec list action

| Current state | Row action and badge |
|---|---|
| No configured profile | **Add quality parameters** · Missing setup |
| Draft/incomplete profile | **Complete quality setup** · Draft / Missing fields |
| Pending review | **Review quality parameters** for approvers; **View pending** for others |
| Approved profile | **View quality parameters**; authorized **Create QC revision** |
| Superseded/retired spec | Read historical profile; no silent reactivation |

The action opens the same context-rich editor, preloaded with real existing values. Preserve existing spec IDs, recipe links, approvals and issued job snapshots. Adding a QC revision to an approved existing spec requires its own controlled approval/effective scope, not an unnoticed edit to the approved record.

A bulk **Assign profile to selected specs** operation is useful only with a compatibility preview, per-spec unresolved fields, explicit scope and approvals. It must not publish one guessed tolerance range to every product.

## 7. Exact client-stage field set

| Stage | Fields to implement | Required interpretation controls |
|---|---|---|
| Winding | **I.D., O.D., Height, Weight, C.S.** | Confirm Height at winding, weight specimen, C.S. unit/method; do not assume finished-tube limits. |
| Oven | **Pre-weight, Post-weight, Pre-moisture, Post-moisture** | Pair readings with specimen/batch identity, phase times and common basis; post-values become due at the right checkpoint. |
| Process | **Height, Weight, C.S., Notch distance, Notch depth, Moisture** | Use approved applicability for non-notched products; NOT APPLICABLE is not zero. |
| Existing final acceptance | Existing approved final dimensions, weight/C.S. and other applicable checks | Preserve and reconcile current final-release policy; no duplication or weakening by the new process templates. |

The measurement names are the client's requested names carried forward from the original requirement register. The business must supply/approve the actual tolerances, methods, units and sample frequencies. The design supports them without inventing manufacturing specifications.

## 8. Job-card entry, printed card and full-card submission

### 8.1 One inspection record, multiple entry surfaces

Update the canonical `JobCardDocument.tsx` renderer and the actual interactive input components, entry routes, supervisor/EOD entry, stage completion payloads, hooks and print paths. Merely adding tolerance text to a PDF or job preview is not completion.

Beneath every QC input show **approved acceptable range/rule + unit**, **target when present**, **sample/method help**, **checkpoint timing** and **QC revision**. For example, a design-only field may show `Allowed: 76.00–76.20 mm; inclusive. Sample: tube cross-section. QC rev 3.` These numbers are illustrative and must not seed live requirements.

Show readable status text and an icon, not color alone. On a failing entry show the measured value, nearest breached limit and difference in the correct unit. Display the reason section adjacent to the field. On mobile, no horizontal scrolling should be required to enter a measurement and its reason. A per-stage summary links to each issue.

The printed job card repeats the applicable frozen tolerances directly below/alongside each blank reading row, with sample columns, paired oven readings, reason/containment area, operator/inspector, measured date/time, stage/machine/shift, approval status, profile revision and QR/reference to the authoritative record. Print submitted cards with real readings and statuses; never render missing values as 0 or blank space as PASS. Handle page breaks/repeated table headings and both blank and completed forms.

### 8.2 Save observations without hiding failure

Typing and preview are side-effect free. **Save readings** durably records the observed values; an out-of-range value is legitimate evidence and should not be rejected just because it fails the specification. On durable save, create/update the visible exception and configured local hold even when explanatory details are still incomplete. Mark the case **Reason pending**. Preserve observations through lost connections or validation errors.

Final submission requires a reason code and useful explanation for each failed parameter, or one explicitly linked common-cause explanation for several failures. Capture immediate containment, affected quantity/scope and responsible person. Where the cause is not known, permit **Cause under investigation** plus facts/containment/owner; do not force workers to invent a root cause to save a genuine failure. The completed root-cause analysis is a later controlled action.

Changing a saved reading to an in-range value cannot erase the original result or automatically clear its hold. A correction includes who, when, prior value, replacement value, reason and review requirement. Published/signed measurements are immutable; corrections or retests create linked records.

### 8.3 Complete job-card entry

The server validates all applicable due readings for every recorded stage occurrence, sample and segment—not only the currently visible tab. Return a structured exception summary with stage, parameter, sample, actual, approved rule, outcome, missing reason and permitted next actions. The UI preserves the full entered card on any failure.

Keep **physical actuals recorded**, **production stage finished**, **quality review pending**, **quality released**, and **job closed** distinct. A failing batch may physically have been produced; hiding that output would corrupt stock/WIP. Record its actual output as restricted/held under the established posting logic, while withholding applicable release/close/dispatch authority. Neither an exception reason nor the act of saving a complete card makes rejected pieces good output.

Apply the same contract to dedicated Quality entry, job-card inline entry, EOD/supervisor entry, imports, direct APIs, legacy clients and any stage-complete/FG-inward shortcuts. The browser cannot supply a trusted aggregate PASS, failure list, quality waiver or arbitrary stock status.

### 8.4 Timing, offline and retrospective entry

Store `measured_at`, `recorded_at`, operator/inspector, source device/form and entry mode separately. For retrospective paper-card entry, detect a failure discovered after downstream work or dispatch and label it **Late quality exception**. Trace affected surviving material/WIP/FG and alert owners. Do not claim that the ERP prevented a movement that occurred before the measurement was entered.

Offline drafts are not authoritative releases. On reconnect, validate against the frozen context, reject stale writes safely and retain all observations. Do not embed login tokens or sensitive full records in QR codes/local storage. Provide a documented site procedure for unresolved quality/network outages; software cannot retrospectively control unrecorded physical movement.

## 9. Results, reasons, holds and dispositions are separate

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

## 10. Retest, rework, final acceptance and customer feedback

A retest references the original case, affected material, intervention/correction, new sample round, approved method and unchanged applicable limit snapshot. Preserve both results. A retest PASS supports a review; it does not automatically erase the original FAIL or close unrelated holds. Acceptance requires the applicable evidence to cover the exact requested quantity and the latest relevant unresolved cases to be addressed.

Rework/reheat creates a linked task/routing segment using the established production and stock mechanisms. Quantity and material additions are explicit. Do not duplicate the entire original order's material demand simply because one portion needs rework. After rework, complete the required retest and authorized release before downstream availability.

At final quality/FG inward, require current accepted evidence or an authorized scoped concession, plus no conflicting unresolved hold. Preserve packing and dispatch's existing checks. Acceptance of one stage does not waive the next applicable stage. Partial acceptance yields a partial dispatchable quantity, not whole-job clearance.

For customer complaints/returns, extend the existing CustomerRejection workflow. Link customer/dispatch/invoice where known, returned quantity, affected product, job/spec/quality revision, material/reel genealogy, failure evidence and replacement/credit reference. A complaint without physical return is not an inward movement. A returned physical lot starts restricted and has its own disposition; never rewrite the original shipment's measured result or delivery history.

Corrective-action cycle: **Contain → investigate cause → approve action → implement → verify effectiveness → close**. Store owners, due dates, evidence and linked recurrence. Label initial suspected cause separately from verified cause. Closing a corrective-action task must not release a stock hold by itself, and a closed quality case must not automatically issue a commercial credit or create replacement production without the established authorization.

## 11. Versioning, legacy data and activation policy

Approved profiles are immutable revisions. A job freezes its applicable profile when it is created/released with complete QC setup. A queued job that lacks setup gets an explicit missing-profile marker; an authorized **Attach approved QC profile** command may complete an unstarted job's setup, recording before/after context. Ordinary release replay never attaches a different revision or resets a job.

Later profile changes apply prospectively to their stated scope. They do not re-evaluate yesterday's signed result or modify started/completed job snapshots. A controlled amendment to unstarted work records impact, version check, approval and changed print revision. Rebaselining a future checkpoint on already started work needs a deliberate reviewed amendment, with already recorded stages preserved.

Legacy specifications without QC profiles should be filterable and assigned to setup owners. Import actual existing final bounds with provenance; mark missing stage thresholds, methods and units unresolved. Do not fill them with zero, copied final values or a universal ± percentage. Do not fabricate completed historic inspections from a status badge.

Preserve previously stored PASS/FAIL as legacy recorded outcomes and annotate provenance/verification gaps. Where unsafe historic evaluation may have affected stock still in circulation, produce a targeted exposure-review list by plant/lot/job. Do not silently convert all old passes to fails or unrestricted stock to accepted-under-new-policy. Physical containment of exposed current stock requires a recorded operational decision.

Each plant needs a reviewed activation plan: required new profiles, named approvers, active/WIP exceptions, evidence gaps, pilot items, checkpoints becoming enforced, and treatment of existing unrestricted stock. Receipt/task creation and future checkpoint readiness rules can be enabled per approved scope. Disabling a frontend feature flag must never release an existing hold or make the old bypass endpoint valid again.

## 12. Transaction safety and cross-service movement barriers

### 12.1 Owner-local enforcement

Inventory is authoritative for batch/reel/physical-FG eligibility. Production is authoritative for unposted WIP/stage eligibility. Every inventory issue/reservation/transfer/dispatch command and every production stage transition must read the relevant owner's current restrictions inside its committing transaction, not a cached analytics badge. Use consistent row-lock ordering and conflict handling; PostgreSQL's documented row locking provides the relevant local concurrency mechanism. [TQ04]

Persist result, local case/hold, quality epoch/version and outgoing event intent in the same owner transaction. New write APIs do not trust `status`, `failures`, `disposition` or `stock_status` from a general measurement payload. Validate resource ownership and derive item/material type from the referenced stock identity rather than allowing callers to choose a weaker template category.

All restrictions combine conservatively: clearing one case does not clear another newer or independent hold. Duplicate events cannot create repeated movements/notifications. Older release events cannot override a newer restriction epoch. A hold-change and simultaneous issue/dispatch must have a tested serialization outcome.

### 12.2 Production decisions affecting stock already in Inventory

An asynchronous event alone is not a sufficient movement gate: it leaves a period during which Inventory may still think stock is clear. For reinspection or changed QC clearance on a physical lot already owned by Inventory, acquire an **Inventory-owned review barrier** first. Under a stable operation ID, the inventory transaction restricts the target lot/quantity and increments its quality epoch before the new quality decision is finalized. Production then stores its evidence and sends the matching decision/application command. A crash after the barrier leaves material blocked and recoverable, not accidentally available.

Applying a release requires matching operation ID, current epoch, evidence/profile reference, approved quantity, disposition authority and absence of competing holds. If scope expansion discovers further affected lots, acquire their barriers before claiming they are contained. A concurrent dispatch that commits before a newly imposed barrier is a defined earlier movement and is included in exposure review; do not pretend a later flag reversed history.

Do not hold a database transaction open across arbitrary slow network calls. Model the barrier and decision as short, durable steps with expiry/review behavior that never auto-releases material. The UI shows **Containment/application pending** until the stock owner confirms; no green release badge on intent alone. If a required authority is unreachable, do not authorize a new quality-sensitive movement using a stale positive cache. Late, previously unrecorded failures are handled as exposure incidents, not a guarantee of retroactive prevention.

This protocol is a proposed design to validate against the actual dispatch/FG architecture. Phase P06 cannot pass on an outbox-only demonstration; it must test the real stock-owner race and failure cases.

## 13. Permissions and QC role

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

## 14. Notifications, assignment and escalation

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

## 15. Reports, filters and metrics

### 15.1 Report catalogue

Provide incoming inspection register; job/stage/sample results; full job quality dossier; deviations and hold aging; reasons/causes and recurrence; supplier quality; rework/retest/concessions; final acceptance and dispatch trace; customer-return/corrective-action status; missing/expired setup; instrument/calibration due; and immutable configuration/approval audit.

The job dossier joins supplier receipt/reel/batch evidence, material issues, frozen spec/quality revisions, each stage's samples, deviations, dispositions, FG acceptance, dispatch and any complaint/return. Every join shows scope/completeness; incomplete genealogy is a visible gap, not an invented parent.

### 15.2 Shared filters

Filter by authorized plant/legal entity; incoming/production/final/return source; customer/supplier; material type; item code/grade/form/width/GSM where applicable; PO/SO/GRN; supplier batch/reel; product/spec/recipe and QC revision; job/release/segment; stage/machine/shift; measurement parameter; method/unit/specimen; measured date/time versus recorded date/time; inspector/approver/assignee; outcome; severity; reason/cause; disposition; open/overdue/acknowledgement status; retest/rework; concession; evidence presence; legacy/unverified status; and affected delivery window.

Use server-side filter predicates with full-dataset aggregates and pagination. Save filter sets and URL state. The same filters/counts must apply to tiles, lists, exports and drill-down. Support exact numeric min/max filters and breached-limit direction for parameter-level investigation without mixing different methods/units.

Return `as_of`, timezone, filter definition, total matching records, source watermarks and completeness. Unavailable dependencies must show partial/unavailable reports, never an empty successful report or “100% quality.” Large exports use the existing report-job mechanism if suitable, enforce access when generated/downloaded and expire signed links.

### 15.3 Metric definitions

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

## 16. Data contracts and API command boundaries

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

## 17. Code integration map

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

## 18. Delivery phases and anti-forgetting protocol

The integrated plan and `PHASE_TRACKER.json` define fourteen phases, P00–P13. Each has a separate brief with prerequisites, bounded tasks, expected evidence, tests, invariants and handoff requirements. Quality is no longer one late catch-all phase.

Every agent session starts by reading `AGENT_FUNCTIONAL_START_HERE_V2.md`, `AGENT_STATE.json`, the active phase brief and the relevant requirement/test rows. It checks branch/HEAD/dirty files, states its bounded goal in the session log, and resumes the next unfinished task. It does not infer completion from a prior conversation summary.

At each checkpoint update task status, changed files, migration revision, commands/results, evidence paths, unresolved decisions, risk/rollback and the exact next task. A phase marked COMPLETE requires all assigned release-blocking scenarios to have real passing evidence and an explicit reviewer decision; implementation or static build alone is not completion. Keep test output and report-render checks separate.

The original R01–R20 and their 66 acceptance scenarios remain in the integrated register. New QCR requirements and QCT scenarios add full-cycle quality coverage. All implementation tests in this planning package remain NOT RUN. Phase manifests describe how to implement; no application code or production configuration was changed here.

## 19. Configuration decisions and rollout evidence

Record approved answers for stage Height/weight/C.S. meaning and units; inward item/PO requirements; actual bounds and inclusive/exclusive qualifiers; approved sample policies; stage timing/gates/severity; concession authority/non-waivable criteria; profile approval separation; partial-lot representation; retrospective-entry handling; active legacy exceptions; notification SLAs and duty cover; document/corrective-action retention; and realistic report performance targets. Do not block planning/design on these numbers, but do not activate unknown acceptance rules in production.

Rollout: **additive schema and compatibility readers → validator/authorization fixes → profile drafts and evidence backfill → end-to-end staging → approved pilot plant/items/specs → migration/physical reconciliation → owner-approved production release**. Lock down unsafe legacy mutation paths before activating the new UI. Off switches disable new actions, not existing holds or audit history.

Release evidence must name deployed SHA, migrations, engine/schema versions, seeded roles, approved profiles, actual test commands/results, source-data reconciliation by plant, replay/concurrency/failure-injection results, browser/input/print/export checks, notifications to permitted users only, backup/restore exercise, client UAT and operational ownership. A phase checklist and an attractive dashboard cannot replace those results.

## 20. Sources and verification boundary

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
