# Integrated acceptance catalogue — version 2

**192 cases; all NOT_RUN.** Includes all 66 original scenarios unchanged in meaning and 126 additional quality scenarios. These are implementation acceptance specifications, not executed results.

## P00 — Baseline and contract inventory

### INC-01 — ID incident reproduction

Requirements: R11. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Reproduce original action with recorded build/console/request, then apply fix.

**Expected:** Root cause evidenced; created identity persists and reloads correctly.

**Evidence:** Not recorded.

## P01 — Integrity and unsafe-verdict fixes

### COMM-11 — Concurrent document numbers

Requirements: R10, R20. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Create many sales orders concurrently with realistic DB settings.

**Expected:** No duplicate display number, unhandled collision or lost successful order.

**Evidence:** Not recorded.

### REL-04 — Replay after scheduling

Requirements: R16, R20. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Replay same release after date/shift assignment.

**Expected:** Same job and snapshot; all scheduling preserved; no new demand.

**Evidence:** Not recorded.

### REL-05 — Replay after split/start/complete

Requirements: R16, R20. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Replay same release in split, partially executed and completed states.

**Expected:** No reset, unsplit, reopened stage, replacement snapshot or duplicated segment.

**Evidence:** Not recorded.

### REL-06 — Concurrent bounded release

Requirements: R16, R20. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Two users release different lot IDs against the same remaining quantity.

**Expected:** Accepted sum stays bounded; conflict handled deterministically.

**Evidence:** Not recorded.

### QC-04 — Malformed and non-finite values

Requirements: R13, R14, R15. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Submit blank, text, NaN, infinity, boolean and missing required values.

**Expected:** Not PASS; useful field errors through all authoritative paths.

**Evidence:** Not recorded.

### QC-10 — Alternate quality paths

Requirements: R20. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Compare dedicated API, inline stage and final-FG handoff validations.

**Expected:** Same required/finite/bounds logic, no alternate bypass.

**Evidence:** Not recorded.

### QCT-006 — Non-finite and malformed readings

Requirements: QCR-15. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Submit blank, whitespace, text, NaN, infinity, huge non-finite numeric input and booleans through every evaluator adapter.

**Expected:** No malformed observation is measured PASS; original valid draft fields remain.

**Evidence:** Not recorded.

## P02 — Quality contracts, versions and access

### QC-01 — QC creation and landing

Requirements: R12. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Assign QC through auth, sign in and inspect menus/deep links.

**Expected:** Dedicated correct workspace; role not silently mapped into extra PlantManager powers.

**Evidence:** Not recorded.

### QC-02 — Role and plant negative tests

Requirements: R12. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** QC user calls admin, sales-approval and other-plant APIs directly.

**Expected:** Denied; no cross-plant read/cache/export leaks.

**Evidence:** Not recorded.

### QCT-001 — Two-sided bounds

Requirements: QCR-02, QCR-15. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Evaluate exact lower/upper endpoints and values just outside with inclusive and exclusive profiles.

**Expected:** Boundary results exactly match approved comparators without an implicit epsilon.

**Evidence:** Not recorded.

### QCT-002 — Minimum-only requirement

Requirements: QCR-02, QCR-15. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Evaluate below/equal/above a configured minimum with no maximum.

**Expected:** One-sided comparisons execute; missing maximum never disables the minimum check.

**Evidence:** Not recorded.

### QCT-003 — Maximum-only requirement

Requirements: QCR-02, QCR-15. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Evaluate above/equal/below a configured maximum with no minimum.

**Expected:** Maximum is enforced independently and boundary mode is respected.

**Evidence:** Not recorded.

### QCT-004 — Asymmetric target tolerance

Requirements: QCR-02. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Save target with unequal lower/upper deviations; reload and evaluate boundary fixtures.

**Expected:** One canonical normalized rule survives; conflicting editable bound sets are rejected.

**Evidence:** Not recorded.

### QCT-005 — Invalid profile bounds

Requirements: QCR-02, QCR-15. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Approve lower greater than upper, non-finite bound, empty categorical accept-set or invalid unit/method.

**Expected:** Approval denied with actionable fields; no profile becomes operational.

**Evidence:** Not recorded.

### QCT-007 — Zero versus missing

Requirements: QCR-15. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Use numeric zero where meaningful and omit the same field in another request.

**Expected:** Zero is evaluated as zero; missing is incomplete, never silently zero.

**Evidence:** Not recorded.

### QCT-008 — Rounding edge

Requirements: QCR-15. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Submit a genuine value just outside a bound but rounding visually to its endpoint.

**Expected:** The result remains FAIL and the UI/export shows enough precision to explain it.

**Evidence:** Not recorded.

### QCT-009 — Categorical and boolean acceptance

Requirements: QCR-02, QCR-15. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Evaluate explicit allowed/denied categorical values and typed booleans; submit unknown options.

**Expected:** Approved criteria decide verdicts; unknowns invalid; arbitrary text does not establish PASS.

**Evidence:** Not recorded.

### QCT-010 — Descriptive-only profile

Requirements: QCR-02, QCR-17. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Complete only observational text/evidence fields.

**Expected:** Outcome is OBSERVATION_ONLY with a distinct policy basis, not measured PASS.

**Evidence:** Not recorded.

### QCT-011 — Unit and specimen mismatch

Requirements: QCR-02, QCR-34. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Submit kg to a per-specimen gram rule and force readings to an unapproved method/basis.

**Expected:** Approved conversion only when dimension/method/basis match; otherwise review/error, no false comparison.

**Evidence:** Not recorded.

### QCT-012 — Sampling aggregation

Requirements: QCR-02, QCR-05. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Create multiple specimen readings with one failure and a passing average.

**Expected:** Individual failure is retained unless an explicitly approved aggregation method permits the stated decision.

**Evidence:** Not recorded.

### QCT-013 — Unsafe rule expression

Requirements: QCR-02, QCR-15. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Attempt arbitrary code, recursive/cyclic expressions and incompatible derived units in profile rules.

**Expected:** Allowlisted validated rule contract rejects them; no code execution or silent fallback.

**Evidence:** Not recorded.

### QCT-014 — Evaluator parity

Requirements: QCR-15, QCR-31. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Run the same golden contract fixtures through Inventory and Production adapters.

**Expected:** Identical results, normalized values and rule versions; mismatched engine/schema version handled explicitly.

**Evidence:** Not recorded.

### QCT-111 — Canonical QC restart

Requirements: QCR-18. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Create QC user and run approved seed/migration/restart sequence.

**Expected:** QC stays canonical/assigned with correct landing; not converted to PlantManager or removed as legacy.

**Evidence:** Not recorded.

### QCT-112 — Negative role and plant API matrix

Requirements: QCR-18. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Use QC inspector tokens on admin/pricing/general stock adjustment/other-plant resources.

**Expected:** Denied at server and exports/attachments, without hidden Owner/Admin grant.

**Evidence:** Not recorded.

### QCT-113 — Existing rights compatibility

Requirements: QCR-18. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Migrate legacy Store/PlantManager/QC mappings and exercise existing authorized work.

**Expected:** No accidental loss/expansion; deliberate policy changes explicitly approved and audited.

**Evidence:** Not recorded.

### QCT-114 — Attachment security

Requirements: QCR-29. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Upload permitted evidence plus oversized/wrong-type/malicious-file fixture; test signed link access.

**Expected:** Safe handling/limits and proper authorized access; no secrets/tokens in links, QR or logs.

**Evidence:** Not recorded.

## P03 — Item profiles and incoming quality

### QCT-015 — Per-item versus family profiles

Requirements: QCR-03. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Create two same-category items with different approved bounds; receive each.

**Expected:** Each receipt uses its own item/plant binding, not just the shared category preset.

**Evidence:** Not recorded.

### QCT-016 — Plant-specific resolution

Requirements: QCR-03. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Give the same item family different plant profiles and concurrent global defaults.

**Expected:** Deterministic explicit approved binding; no query-order override or unresolved-plant fallback.

**Evidence:** Not recorded.

### QCT-017 — Every inward category

Requirements: QCR-03. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Configure raw paper, adhesive, parchment, packaging, purchased FG, tool and OTHER examples.

**Expected:** Type-appropriate fields appear; no mandatory paper/return-defect fields on unrelated items.

**Evidence:** Not recorded.

### QCT-018 — Missing incoming setup

Requirements: QCR-03, QCR-04. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Receive an item marked inspection-required without complete approved setup.

**Expected:** Physical receipt retained, setup task visible and stock restricted; never default PASS.

**Evidence:** Not recorded.

### QCT-019 — Approved no-inspection exemption

Requirements: QCR-03, QCR-17. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Approve a scope-limited exemption then receive inside and outside its scope/effective date.

**Expected:** Only approved scope follows exemption; label NOT REQUIRED rather than measured PASS.

**Evidence:** Not recorded.

### QCT-020 — Profile copy and approval

Requirements: QCR-03, QCR-16. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Copy a category/template into an item and save draft.

**Expected:** Copied provenance preserved; new profile not active or approved until authorized review.

**Evidence:** Not recorded.

### QCT-021 — Supplier PO qualifier

Requirements: QCR-06. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Import/source a PB string with plus qualifier and unconfirmed comparator/unit.

**Expected:** Raw qualifier retained and mapping flagged; no guessed inclusive/exclusive or dropped plus.

**Evidence:** Not recorded.

### QCT-022 — Conflicting PO and item requirements

Requirements: QCR-06. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Resolve contradictory bounds with same method and mismatched-basis alternatives.

**Expected:** Conflict requires review; supplier profile cannot quietly weaken item/contract requirements.

**Evidence:** Not recorded.

### QCT-023 — Supplier certificate versus local reading

Requirements: QCR-06, QCR-17. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Attach supplier values and record a different local reading; use document-only policy in separate fixture.

**Expected:** Evidence sources remain separate; no synthetic local result or unapproved certificate clearance.

**Evidence:** Not recorded.

### QCT-024 — Partial GRN sampling identity

Requirements: QCR-04, QCR-05. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Post two receipts from one PO with multiple supplier lots/reels.

**Expected:** Correct independent task/lot/sample scopes; receipt quantity is not confused with sample count.

**Evidence:** Not recorded.

### QCT-025 — Receipt replay creates task once

Requirements: QCR-04, QCR-31. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Lose GRN response and retry matching operation.

**Expected:** One physical receipt, one required task per inspection unit and no duplicate stock/notifications.

**Evidence:** Not recorded.

### QCT-026 — Task event delivery interruption

Requirements: QCR-04, QCR-26. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Stop task/notification delivery immediately after GRN commit.

**Expected:** Receipt remains restricted, intent survives and task delivery recovers idempotently.

**Evidence:** Not recorded.

### QCT-027 — Partial accept/hold partition

Requirements: QCR-05, QCR-20. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Accept 600 of a 1000-unit lot and hold 400; query balance/reserve/issue by every route.

**Expected:** Only accepted uncommitted portion usable; parent status cannot expose held remainder.

**Evidence:** Not recorded.

### QCT-028 — Destructive sample accounting

Requirements: QCR-05, QCR-20. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Use an approved destructive sample policy and replay its consumption action.

**Expected:** Sample coverage and actual consumption remain distinct and stock changes once under authorized movement rules.

**Evidence:** Not recorded.

## P04 — Spec dialog and existing-spec actions

### QCT-029 — New spec save dialog

Requirements: QCR-07. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Complete a valid new spec and click deliberate Save.

**Expected:** Context-rich quality dialog opens before final save/submission with correct product/helper details.

**Evidence:** Not recorded.

### QCT-030 — Dialog draft preservation

Requirements: QCR-07. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Edit several tolerances, go back, reopen, close and attempt explicit discard.

**Expected:** No accidental loss of spec/QC edits; discard is deliberate and clear.

**Evidence:** Not recorded.

### QCT-031 — QC-incomplete draft save

Requirements: QCR-07. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Save a new spec lacking stage thresholds via Save draft.

**Expected:** Draft persists but is not approved or falsely QC-ready; missing fields remain assigned/visible.

**Evidence:** Not recorded.

### QCT-032 — Spec bundle failure

Requirements: QCR-07, QCR-31. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Inject a database failure while saving spec and QC draft in one service.

**Expected:** Neither half is final-successful; atomic rollback or explicitly designed durable pending operation, no orphaned approved profile.

**Evidence:** Not recorded.

### QCT-033 — Duplicate spec save

Requirements: QCR-07, QCR-31. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Double-click and retry same lost-response operation; retry same key with changed payload.

**Expected:** Original spec/profile returned for matching replay; changed payload conflicts, no duplicate records.

**Evidence:** Not recorded.

### QCT-034 — Stale tolerance dialog

Requirements: QCR-07, QCR-31. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Open two editors, save one spec revision then submit the stale other.

**Expected:** Conflict identifies current revision; no overwrite of newer spec or tolerance.

**Evidence:** Not recorded.

### QCT-035 — Legacy Add quality parameters

Requirements: QCR-08. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Open an approved spec with no new stage profile using list action.

**Expected:** Editor uses real context, keeps spec/recipe IDs and creates a draft QC revision only.

**Evidence:** Not recorded.

### QCT-036 — Existing-profile row actions

Requirements: QCR-08. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Exercise missing, draft, pending, approved and retired profiles under author/viewer/approver roles.

**Expected:** Correct Add/Complete/View/Review/Create revision actions; forbidden mutations denied server-side.

**Evidence:** Not recorded.

### QCT-037 — Bulk assignment review

Requirements: QCR-08, QCR-16. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Assign one template to mixed applicable/non-applicable legacy specs.

**Expected:** Per-spec impact/errors shown, no auto-publication and no rewriting of issued jobs.

**Evidence:** Not recorded.

### QCT-038 — Canonical final limits

Requirements: QCR-09. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Change final tolerance through new editor and legacy-compatible path; reload all spec/job projections.

**Expected:** One canonical rule governs, conflicting dual writes rejected and required spec approval retained.

**Evidence:** Not recorded.

### QCT-039 — Process-only versus contractual revision

Requirements: QCR-09, QCR-16. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Revise a process check and separately change final contractual dimensions.

**Expected:** Appropriate QC-only or spec/customer approval flow; neither silently alters the recipe or contractual rule.

**Evidence:** Not recorded.

### QCT-040 — Client field names

Requirements: QCR-10. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Load all three stage templates and inspect UI/save/read contracts.

**Expected:** Exact requested Winding/Oven/Process field set and client names survive, not generic substitutes.

**Evidence:** Not recorded.

### QCT-041 — Non-notched applicability

Requirements: QCR-10, QCR-02. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Use a verified non-notched spec and an unknown/notching-changed spec.

**Expected:** First shows approved NOT APPLICABLE; unknown/changed conditions require review, not zero or automatic skip.

**Evidence:** Not recorded.

### QCT-042 — Stage basis helpers

Requirements: QCR-07, QCR-10. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Configure different winding and final Height/weight specimen bases.

**Expected:** UI identifies stage-specific basis; final targets are not blindly copied into winding tolerances.

**Evidence:** Not recorded.

### QCT-043 — Profile revision freezing

Requirements: QCR-16. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Inspect a job under rev A then approve rev B and reopen old evidence/print.

**Expected:** Old rule/result/print stays rev A; only eligible prospective bindings use B.

**Evidence:** Not recorded.

## P05 — Job-card entry and print

### QC-03 — Exact stage fields

Requirements: R13, R14, R15. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Record all client-requested winding, oven and process measurements.

**Expected:** Approved field names/methods/units/sample basis represented and persisted.

**Evidence:** Not recorded.

### QC-05 — Bounds and applicability

Requirements: R13, R14, R15. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Exercise lower-only, upper-only, full bounds and non-notched product.

**Expected:** Approved bound semantics enforced; not-applicable explicit; invalid template not PASS.

**Evidence:** Not recorded.

### QC-06 — Paired oven readings

Requirements: R14. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Record pre/post readings from same batch then attempt mismatched linkage.

**Expected:** Consistent specimen/batch link; mismatched pair rejected or review flagged.

**Evidence:** Not recorded.

### QC-07 — Historical limits

Requirements: R13, R14, R15. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Revise approved QC template after old inspection.

**Expected:** Old evidence/outcome remains tied to original revision.

**Evidence:** Not recorded.

### QCT-044 — Tolerance below every input

Requirements: QCR-11. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Open job-card stage/sample fields on desktop and mobile.

**Expected:** Frozen rule/unit/help/timing/revision is adjacent to its actual field, not hidden in a separate report.

**Evidence:** Not recorded.

### QCT-045 — Accessible exception feedback

Requirements: QCR-11. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Enter an outside value with keyboard/screen-reader and monochrome print checks.

**Expected:** Readable FAIL and breached limit/difference plus focusable reason fields; color not sole indicator.

**Evidence:** Not recorded.

### QCT-046 — Blank job-card print

Requirements: QCR-12. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Print a multi-page job with all stage samples and paired oven fields.

**Expected:** Tolerances and headers remain near fields, writable spaces and page breaks work, no clipping or default PASS.

**Evidence:** Not recorded.

### QCT-047 — Completed historical print

Requirements: QCR-12, QCR-16. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Print a signed card after a newer profile and dictionary label change.

**Expected:** Original values/rules/revision and corrections remain interpretable; no relabelling history by current defaults.

**Evidence:** Not recorded.

### QCT-048 — Oven pre/post timing

Requirements: QCR-10. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Record pre-values before oven then post-values at later checkpoint.

**Expected:** Same pair/basis tracked; not-yet-due post fields do not block pre-stage save but are required at due checkpoint.

**Evidence:** Not recorded.

### QCT-049 — Oven mismatched pair

Requirements: QCR-10, QCR-05. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Submit post-values for different sample/batch or without required pre-context.

**Expected:** Incomplete/invalid pair clearly rejected for completion; evidence not combined into false valid pair.

**Evidence:** Not recorded.

### QCT-050 — Whole-card hidden-stage errors

Requirements: QCR-13. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Enter valid visible tab and failures/missing due readings on another stage; submit complete job card.

**Expected:** Server returns every relevant stage/sample issue; hidden tab does not bypass validation and form data stays.

**Evidence:** Not recorded.

### QCT-051 — All entry adapters

Requirements: QCR-13, QCR-31. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Submit same observations via dedicated QC, inline, supervisor, EOD, import and supported legacy route.

**Expected:** Same normalized evidence and verdicts; no duplicate inspection or shortcut PASS.

**Evidence:** Not recorded.

### QCT-052 — Failed reading without reason

Requirements: QCR-14. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Durably save an actual out-of-range reading without explanatory details.

**Expected:** Evidence retained with reason-pending case and configured restriction; final submission waits for required explanation.

**Evidence:** Not recorded.

### QCT-053 — Reason cannot pass result

Requirements: QCR-14, QCR-17. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Add a detailed valid reason to a failing reading and submit.

**Expected:** Measured outcome remains FAIL; review/disposition authority is still required for release.

**Evidence:** Not recorded.

### QCT-054 — Unknown cause honestly recorded

Requirements: QCR-14. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Choose Cause under investigation with factual note/containment/assignee.

**Expected:** Observation/submission can follow configured workflow without fabricated root cause; investigation remains open.

**Evidence:** Not recorded.

### QCT-055 — Common reason for several fields

Requirements: QCR-14, QCR-19. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Save three related failures and link one common-cause explanation to all.

**Expected:** One grouped case/notification can result, but each failed parameter/evidence link remains accessible.

**Evidence:** Not recorded.

### QCT-056 — Correction audit

Requirements: QCR-21, QCR-29. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Change a previously recorded failing number to a passing one.

**Expected:** Original value/result retained; correction reason/actor/time/revision required and hold not silently cleared.

**Evidence:** Not recorded.

### QCT-057 — Physical output remains recorded

Requirements: QCR-13, QCR-17. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Record physically completed output that fails QC.

**Expected:** Actual production/WIP/FG is retained as restricted; failed quantity is not labelled good or hidden by form rejection.

**Evidence:** Not recorded.

### QCT-058 — Retrospective entry

Requirements: QCR-24. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Record a measurement with earlier measured time after subsequent stage and dispatch.

**Expected:** Measured/recorded clocks distinct; late exception traces surviving stock and earlier shipment without retroactive claims.

**Evidence:** Not recorded.

### QCT-059 — Offline draft and reconnect

Requirements: QCR-24, QCR-31. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Prepare offline/paper draft, change server version, reconnect and submit.

**Expected:** No offline release; stale conflict retains observations and signed profile context.

**Evidence:** Not recorded.

### QCT-060 — Missing QC on queued job

Requirements: QCR-16, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Queue a valid commercial release lacking new QC setup, then attempt actual checkpoint.

**Expected:** Queue admission succeeds with missing-setup flag; affected execution checkpoint requires approved resolution.

**Evidence:** Not recorded.

### QCT-061 — Attach missing profile explicitly

Requirements: QCR-16. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Attach an approved profile to unstarted missing-setup job then replay original release.

**Expected:** Attachment is audited, idempotent and explicit; replay does not rebind or reset schedule/actuals.

**Evidence:** Not recorded.

### QCT-062 — Invalid instrument status

Requirements: QCR-34. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Submit readings requiring calibrated instrument using missing/expired instrument then corrected documented evidence.

**Expected:** Required instrument evidence controls readiness; no invented calibration or silent PASS.

**Evidence:** Not recorded.

## P06 — Exceptions and authoritative movement gates

### QC-08 — Holds and retests

Requirements: R12, R20. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Fail sample, attempt movement, retest and authorized disposition.

**Expected:** Affected quantity controlled; unrelated earlier PASS cannot release newer hold.

**Evidence:** Not recorded.

### QC-09 — Override authorization

Requirements: R12, R20. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Submit override reason as authorized and unauthorized actor.

**Expected:** Reason alone cannot bypass gate; authorized override auditable.

**Evidence:** Not recorded.

### QCT-063 — Durable multi-field failure case

Requirements: QCR-19. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Save a signed/recorded sample with multiple failures and retry request.

**Expected:** One appropriate case/hold per scope/round, retaining all failures; no duplicated quantities/cases on replay.

**Evidence:** Not recorded.

### QCT-064 — Configured advisory versus blocking

Requirements: QCR-19, QCR-20. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Fail a declared advisory and a mandatory blocking checkpoint in separate fixtures.

**Expected:** Both preserve reason/case/FAIL; only approved policy determines movement gate, never an incidental default.

**Evidence:** Not recorded.

### QCT-065 — Unauthorized concession

Requirements: QCR-20, QCR-18. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Inspector or Store tries major concession/clearance through direct API.

**Expected:** Denied; measurement save permission does not grant disposition authority.

**Evidence:** Not recorded.

### QCT-066 — Concession scope and expiry

Requirements: QCR-20. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Approve a limited quantity for one customer/order then try other use or expired authorization.

**Expected:** Only scoped eligible use permitted; result stays FAIL and concession is visibly separate.

**Evidence:** Not recorded.

### QCT-067 — Non-waivable criterion

Requirements: QCR-20. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Attempt reason/admin override on policy-designated non-waivable critical check.

**Expected:** No general reason field bypass; allowed incident/containment path remains available.

**Evidence:** Not recorded.

### QCT-068 — Disposition conservation

Requirements: QCR-20, QCR-05. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Allocate accept/hold/rework/return/scrap concurrently across a finite affected lot.

**Expected:** Total non-overlapping allocations stay within owned quantity, correct UOM and period controls.

**Evidence:** Not recorded.

### QCT-069 — Retest does not erase original

Requirements: QCR-21. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Rework then perform passing new retest round.

**Expected:** Original FAIL/case retained, new evidence linked and authorized review required to release covered quantity.

**Evidence:** Not recorded.

### QCT-070 — Cherry-picked retest fields

Requirements: QCR-21. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Combine passing values from different unsuccessful sample rounds.

**Expected:** Cannot manufacture an unrelated aggregate PASS without explicitly approved sampling method.

**Evidence:** Not recorded.

### QCT-071 — Independent and newer holds

Requirements: QCR-21, QCR-23. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Pass one retest while another parameter/lot hold or newer failure remains unresolved.

**Expected:** Only applicable cleared restriction changes; independent/newer hold still blocks the affected quantity.

**Evidence:** Not recorded.

### QCT-072 — Rework/reheat quantity

Requirements: QCR-22. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Route a rejected portion for rework and consume approved additional materials.

**Expected:** Linked portion/routing only, no duplication of original order/full BOM; output restricted until accepted.

**Evidence:** Not recorded.

### QCT-073 — Supplier return/scrap replay

Requirements: QCR-22. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Execute authorized return or scrap then retry lost response.

**Expected:** One authoritative movement/voucher, original receipt retained, no negative or duplicated stock.

**Evidence:** Not recorded.

### QCT-074 — FG inward mandatory quality

Requirements: QCR-23. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Attempt FG availability before final clearance using canonical and legacy FG routes.

**Expected:** Restricted physical FG may be recorded; dispatchable/unrestricted eligibility not granted prematurely.

**Evidence:** Not recorded.

### QCT-075 — Hold versus issue race

Requirements: QCR-23. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Run parallel Inventory hold and issue/reservation against same quantity.

**Expected:** Tested transaction serialization; no issue committed after a winning hold using stale availability.

**Evidence:** Not recorded.

### QCT-076 — Hold versus dispatch race

Requirements: QCR-23. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Run final quality restriction and sealed-dispatch actions concurrently.

**Expected:** Stock-owner barrier/epoch produces defined safe ordering; earlier committed shipment goes to exposure review, not silent reversal.

**Evidence:** Not recorded.

### QCT-077 — Crash after stock review barrier

Requirements: QCR-23, QCR-31. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Begin cross-service reinspection barrier then crash before Production result/decision applies.

**Expected:** Affected Inventory quantity remains restricted with recoverable pending operation; no auto-timeout release.

**Evidence:** Not recorded.

### QCT-078 — Clearance apply acknowledgement loss

Requirements: QCR-23, QCR-31. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Apply reviewed clearance in stock owner then lose response and retry.

**Expected:** Same decision applied once; UI remains pending until confirmation and recovery does not duplicate quantities.

**Evidence:** Not recorded.

### QCT-079 — Out-of-order clearance

Requirements: QCR-23, QCR-26. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Deliver old release decision after newer hold/review epoch.

**Expected:** Stale message cannot clear newer restriction; observable conflict/dead-letter/reconciliation record.

**Evidence:** Not recorded.

### QCT-080 — Authority unavailable

Requirements: QCR-23. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Take required quality/stock authority offline while issuing or dispatching sensitive stock.

**Expected:** No stale positive cache authorizes movement; explicit unavailable/pending response and recovery procedure.

**Evidence:** Not recorded.

### QCT-081 — All stock shortcuts

Requirements: QCR-23, QCR-31. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Try purchase-desk PASS, arbitrary disposition, stock status edits, direct issue/dispatch and old clients.

**Expected:** Every authoritative mutation respects current quality/permission/quantity rules; no hidden acceptance shortcut.

**Evidence:** Not recorded.

### QCT-082 — Material-type tampering

Requirements: QCR-15, QCR-31. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Inspect a raw-paper lot while submitting a weaker material_type and client PASS/failures list.

**Expected:** Type/rules derived from owned lot; untrusted supplied verdict/category cannot alter acceptance.

**Evidence:** Not recorded.

### QCT-083 — Concurrent disposition versions

Requirements: QCR-20, QCR-31. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Two approvers release/return same held quantity from same old version.

**Expected:** One legal commit or bounded allocations; stale request conflicts and cannot double-dispose.

**Evidence:** Not recorded.

### QCT-084 — Late discovered wider scope

Requirements: QCR-23, QCR-24. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Record late defect with more downstream lots identified after initial containment.

**Expected:** New affected lots get explicit barriers/tasks; status does not claim containment until owners confirm.

**Evidence:** Not recorded.

## P07 — Assignments and notifications

### QCT-085 — Same-role different plants

Requirements: QCR-25, QCR-18. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Create two QC users with disjoint plant access and emit inward failure in one plant.

**Expected:** Only relevant authorized recipients get sensitive message and working deep link.

**Evidence:** Not recorded.

### QCT-086 — Role/assignment deduplication

Requirements: QCR-25. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** One user qualifies as assigned QC, PlantManager and explicit recipient.

**Expected:** One delivery per event/channel with correct task ownership, not duplicate alerts.

**Evidence:** Not recorded.

### QCT-087 — Relevant downstream recipients

Requirements: QCR-25. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Fail unallocated material then material committed to an urgent order.

**Expected:** QC/Store notified; Planner/Sales/Dispatch added only when their authorized work is affected.

**Evidence:** Not recorded.

### QCT-088 — Inactive or absent inspector

Requirements: QCR-25. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Emit task with inactive assignee or no eligible QC users.

**Expected:** Configured authorized fallback/escalation and visible unassigned work; no silent disappearance or cross-plant broadcast.

**Evidence:** Not recorded.

### QCT-089 — Commit/notify failure

Requirements: QCR-26. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Crash notifier after measurement commit and before delivery, then restart.

**Expected:** Committed case/hold and outbox survive; eventual delivery deduplicated; rollback emits no success alert.

**Evidence:** Not recorded.

### QCT-090 — Out-of-order notification

Requirements: QCR-26. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Deliver pending and pass notification events after a later failure/restriction.

**Expected:** Obsolete favorable state suppressed/marked stale; actionable view reads current owner state.

**Evidence:** Not recorded.

### QCT-091 — Acknowledgement semantics

Requirements: QCR-26. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Acknowledge a hold alert and reassign the task.

**Expected:** Only task/read state changes; stock/inspection/disposition stays unchanged and history recorded.

**Evidence:** Not recorded.

### QCT-092 — Escalation clock and cover

Requirements: QCR-25, QCR-26. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Test approved SLA across shift boundary/holiday/timezone with duty substitute.

**Expected:** Configured timing/recipients honored; no invented runtime SLA or uncontrolled notification storm.

**Evidence:** Not recorded.

### QCT-093 — Access revoked after alert

Requirements: QCR-18, QCR-25. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Revoke plant access with unread alert/export/attachment link already present.

**Expected:** Sensitive unread content/download/deep-link access rechecked and denied; old role cache not sufficient.

**Evidence:** Not recorded.

### QCT-094 — External delivery adapter unconfigured

Requirements: QCR-26. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Enable only in-app and attempt optional email/external delivery without provider approval.

**Expected:** Core tasks work; external delivery marked unavailable/not configured, no assumed integration or false sent status.

**Evidence:** Not recorded.

## P08 — Reports, returns and corrective actions

### QCT-095 — Full-dataset filters

Requirements: QCR-27. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Create more than 500 inspections and several pages, filter plant/stage/parameter/outcome.

**Expected:** Summary/list/export counts agree over complete authorized dataset, not loaded slice.

**Evidence:** Not recorded.

### QCT-096 — Measured versus recorded dates

Requirements: QCR-27. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Create late-entered inspections spanning reporting dates and change date-mode filter.

**Expected:** Clearly labelled correct population, matching timezone/date-mode across exports and drilldown.

**Evidence:** Not recorded.

### QCT-097 — Compound trace filters

Requirements: QCR-27. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Filter supplier/item/PO/GRN/reel/spec/QC revision/job/machine/shift/assignee/reason.

**Expected:** Only matching source-linked records, stable URL/back-navigation and reproducible saved view.

**Evidence:** Not recorded.

### QCT-098 — Empty pass-rate denominator

Requirements: QCR-28. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Query no measured inspections and separately incomplete/invalid/NA-only data.

**Expected:** No completed measured inspections, not 100%; exclusions/counts displayed.

**Evidence:** Not recorded.

### QCT-099 — First-pass, retest and concession

Requirements: QCR-28. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Use first-pass success, fail-then-retest, concession and legacy/unverified fixtures.

**Expected:** Metrics use published definitions/denominators; concession and retest do not inflate first-pass measured success.

**Evidence:** Not recorded.

### QCT-100 — Held-quantity deduplication

Requirements: QCR-28. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Attach several open quality cases to same physical held portion.

**Expected:** Quantity/value counted once per actual restricted portion; cases counted separately.

**Evidence:** Not recorded.

### QCT-101 — Mixed units and methods

Requirements: QCR-28. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Plot different unit/method/specimen parameters and compare supplier rates with differing denominators.

**Expected:** Incompatible metrics separated/labelled; no mixed-unit quality score or unsupported capability statistic.

**Evidence:** Not recorded.

### QCT-102 — Historic limits on trend

Requirements: QCR-16, QCR-28. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Plot measurements crossing approved profile revision changes.

**Expected:** Correct historic bands/markers and result preservation, not current-limit retrospective reclassification.

**Evidence:** Not recorded.

### QCT-103 — Unavailable report dependency

Requirements: QCR-27. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Stop one source service during dossier/export query.

**Expected:** Partial/unavailable and source watermark shown; no successful empty/fully covered report.

**Evidence:** Not recorded.

### QCT-104 — Export authorization and expiry

Requirements: QCR-27, QCR-18. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Generate large filtered export, revoke scope before download, and test expired link.

**Expected:** No unauthorized download; applied filters/as-of/source status retained for permitted export.

**Evidence:** Not recorded.

### QCT-105 — Complete trace dossier

Requirements: QCR-24, QCR-29. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Follow receipt/reel issues through job samples/holds/FG/dispatch/return, including one missing genealogy link.

**Expected:** Real links/evidence shown and missing link explicit; no inferred parent or duplicate records.

**Evidence:** Not recorded.

### QCT-106 — Complaint without physical return

Requirements: QCR-33. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Record customer complaint without receiving any goods.

**Expected:** Complaint/case recorded, no automatic inward transaction or available stock.

**Evidence:** Not recorded.

### QCT-107 — Actual customer return

Requirements: QCR-33, QCR-20. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Receive a dispatched product portion and inspect/rework/dispose it.

**Expected:** Existing return lineage reused, physical return restricted, original shipment history preserved.

**Evidence:** Not recorded.

### QCT-108 — Corrective action closure

Requirements: QCR-33. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Record suspected then verified cause, actions and effectiveness review; close action.

**Expected:** Audit trail complete; closure alone does not release a hold, issue credit or create replacement order.

**Evidence:** Not recorded.

### QCT-109 — Repeat failure and reopening

Requirements: QCR-33. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Recur same documented failure after action closure.

**Expected:** Linked recurrence/new or reopened review with preserved previous effectiveness evidence, not erased history.

**Evidence:** Not recorded.

### QCT-110 — Instrument exposure report

Requirements: QCR-34. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Mark an instrument suspect after readings and view calibration/measurement links.

**Expected:** Affected evidence/jobs/stock review surfaced with correct historic instrument data, no blanket rewritten PASS.

**Evidence:** Not recorded.

### QCT-126 — One inspection across integrated views

Requirements: QCR-01, QCR-11, QCR-27. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Record an inward inspection and a job-card inspection, then open Quality, the source documents and their dossiers.

**Expected:** The same canonical records, revisions, results and cases appear without duplicate entry or competing quality/stock ledgers.

**Evidence:** Not recorded.

## P09 — Original commercial changes

### COMM-01 — Customer date labels and binding

Requirements: R03, R04, R05, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Save customer PO date and line delivery date; reload, edit and print.

**Expected:** Labels changed; original date meanings and date-only values survive.

**Evidence:** Not recorded.

### COMM-02 — Strict date comparison

Requirements: R05, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Try delivery before, equal to and after customer PO date through UI and direct API.

**Expected:** Only strictly later date accepted; line-specific error, no partial invalid save.

**Evidence:** Not recorded.

### COMM-03 — Header date edit

Requirements: R05, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Change PO date after several draft deliveries.

**Expected:** All affected lines/schedules invalidated for review; none silently moved.

**Evidence:** Not recorded.

### COMM-04 — Internal customer order

Requirements: R10, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Create without external PO, approve with authorized second person, release and dispatch.

**Expected:** Unique internal SO and customer trace; no invented external PO; approved internal-date policy applied.

**Evidence:** Not recorded.

### COMM-05 — Ambiguous historical origin

Requirements: R10, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Migrate historical orders with blank PO references.

**Expected:** Ambiguous records flagged; no guessed internal origin or overwritten references.

**Evidence:** Not recorded.

### COMM-06 — Parchment true round-trip

Requirements: R08, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Create checked with valid master/color, reload/edit/release/BOM/print.

**Expected:** Explicit boolean and variant preserved in every authorized downstream representation.

**Evidence:** Not recorded.

### COMM-07 — Parchment false and stale values

Requirements: R08, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Select variant, uncheck, save and reload.

**Expected:** False/null persists; no stale hidden variant or silent BOM alteration.

**Evidence:** Not recorded.

### COMM-08 — Parchment/spec mismatch

Requirements: R08, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Order a commercial variant conflicting with approved manufacturing recipe.

**Expected:** Visible controlled resolution; canonical recipe not silently changed.

**Evidence:** Not recorded.

### COMM-09 — Stable line IDs

Requirements: R09, R18, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Edit one draft line after schedule link exists and remove a different line.

**Expected:** Unchanged line UUIDs retained; dependent allocations reconciled or removal rejected.

**Evidence:** Not recorded.

### COMM-10 — Remove filler only

Requirements: R01, R02, R09, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Inspect compact sales UI and perform all prior line actions.

**Expected:** Hero/readiness/banner removed; validation, add/remove, approvals and existing capabilities retained.

**Evidence:** Not recorded.

### COMM-12 — Date import and old clients

Requirements: R05, R20, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Send invalid date relationships from import and older client payload.

**Expected:** Server enforces new approved policy with useful errors and safe legacy handling.

**Evidence:** Not recorded.

### NAV-01 — Three-day boundary

Requirements: R06, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Test overdue, today, day+1, day+2, day+3 around plant midnight.

**Expected:** Approved exact range and separate overdue; predicate equals labels and export.

**Evidence:** Not recorded.

### NAV-02 — Stage tile drill-down

Requirements: R07, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Click each tile, reload, go back and change plant.

**Expected:** Count matches full filtered result and current-stage definition; holds visible.

**Evidence:** Not recorded.

### INC-02 — Create failures and lost response

Requirements: R11, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Exercise 401/403/422/409, malformed response, timeout and post-commit response loss.

**Expected:** No blank page, false success or duplicate identity; useful recovery and safe draft.

**Evidence:** Not recorded.

## P10 — Original queue-only release

### REL-01 — Queue-only admission

Requirements: R16, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Release valid approved line with mandrel mismatch to selected same-plant winder.

**Expected:** Accepted into chosen queue without compatibility override or shift selection.

**Evidence:** Not recorded.

### REL-02 — Invalid queue identity

Requirements: R16, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Use nonexistent machine, wrong department or forbidden plant.

**Expected:** Rejected without any release/job side effect.

**Evidence:** Not recorded.

### REL-03 — Integrity is not relaxed

Requirements: R16, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Try unauthorized, unapproved, zero, negative, non-finite or excessive quantity release.

**Expected:** Rejected while valid approved bounded release succeeds.

**Evidence:** Not recorded.

### REL-07 — Lost sync response

Requirements: R16, R20, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Commit sales release then drop production response and close browser.

**Expected:** Durable pending operation recovers idempotently; no fresh release required.

**Evidence:** Not recorded.

### REL-08 — Idempotency payload mismatch

Requirements: R16, R20, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Reuse release key with changed quantity or identity.

**Expected:** Conflict returned; original operation unchanged.

**Evidence:** Not recorded.

### REL-09 — Partial multi-line failure

Requirements: R16, R18, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Fail synchronization for one line after others complete.

**Expected:** Per-line results persist; retry only pending lines without duplicate jobs.

**Evidence:** Not recorded.

### REL-10 — Temporary machine maintenance

Requirements: R16, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Queue valid work for temporarily unavailable selected winder.

**Expected:** Queue admission follows approved policy; actual execution maintenance controls remain.

**Evidence:** Not recorded.

### REL-11 — Legacy release routes

Requirements: R16, R20, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Exercise list, detail, bulk and legacy release paths.

**Expected:** All use same policy/integrity; no status-only route creates false release quantities.

**Evidence:** Not recorded.

## P11 — Original demand and three calendars

### PLAN-01 — Whole PO multi-line scheduling

Requirements: R18, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Schedule three lines over several delivery dates and inspect all allocations.

**Expected:** Every quantity accounted for or explicit remainder; no duplicate demand.

**Evidence:** Not recorded.

### PLAN-02 — Refresh and reload

Requirements: R18, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Save schedule and reload via deep link on another authorized session.

**Expected:** Dates, quantities, source links and revision persist.

**Evidence:** Not recorded.

### PLAN-03 — Concurrent planners

Requirements: R18, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Two planners commit changes from the same preview revision.

**Expected:** Stale commit conflicts; no silent overwrite or over-allocation.

**Evidence:** Not recorded.

### PLAN-04 — Move partially fulfilled PO

Requirements: R18, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Group-move an order with dispatched and started quantities.

**Expected:** Only editable remainder moves; fulfilled/started history immutable.

**Evidence:** Not recorded.

### PLAN-05 — Calendar separation

Requirements: R18, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Save customer and supplier dates without production/receipt action.

**Expected:** No automatic release, stock posting or fulfillment.

**Evidence:** Not recorded.

### PLAN-06 — Capacity units and stages

Requirements: R18, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Schedule winding metres, oven batches and process tubes across shifts.

**Expected:** Correct approved unit conversions/precedence; missing policy not labelled feasible.

**Evidence:** Not recorded.

### PLAN-07 — Holidays and horizon overflow

Requirements: R18, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Plan over closed dates and beyond available horizon.

**Expected:** Explicit remainder/conflicts; no hidden dropped quantity or fake feasibility.

**Evidence:** Not recorded.

### PLAN-08 — Oven batch sharing

Requirements: R18, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Schedule concurrent oven loads with agreed cycle/batch sharing model.

**Expected:** No unintended overbooking; batch quantities/capacity reconcile.

**Evidence:** Not recorded.

### PLAN-09 — Keyboard and mobile scheduling

Requirements: R18, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Perform same allocation without dragging and on narrow viewport.

**Expected:** Equivalent validated result, visible errors, stable focus and accessible controls.

**Evidence:** Not recorded.

### DEM-01 — All pending not first page

Requirements: R17, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Use >501 open orders and >250 relevant jobs.

**Expected:** Summary, calendar, drill-down and export cover complete authorized result.

**Evidence:** Not recorded.

### DEM-02 — Remaining versus full-order BOM

Requirements: R17, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Use partial dispatch, allocated FG, already-issued WIP and unstarted demand.

**Expected:** Residual requirements do not count fulfilled demand, FG or issued material twice.

**Evidence:** Not recorded.

### DEM-03 — Frozen recipe history

Requirements: R17, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Change current master/spec after releasing a job.

**Expected:** Existing job requirements use frozen approved snapshot; unreleased draft version explicit.

**Evidence:** Not recorded.

### DEM-04 — Material grade and UOM

Requirements: R17, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Use similar names with different GSM/PB/width/form and mixed units.

**Expected:** No implicit interchange or kg/tonne conversion without approved mapping.

**Evidence:** Not recorded.

### DEM-05 — Stock allocation once

Requirements: R17, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Allocate same material batch to competing orders.

**Expected:** Total reservations bounded; one stock quantity not promised twice.

**Evidence:** Not recorded.

### DEM-06 — Time-phased shortage

Requirements: R17, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Receive sufficient total material after an earlier production need.

**Expected:** Earlier shortage remains visible despite later total surplus.

**Evidence:** Not recorded.

### DEM-07 — Unavailable data

Requirements: R17, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Interrupt a required sales/spec/stock source.

**Expected:** Completeness flagged; unknown not converted to zero or all-covered.

**Evidence:** Not recorded.

### DEM-08 — Rework/returns/short close

Requirements: R17, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Post approved scrap, returns and short-close dispositions.

**Expected:** Demand changes explicitly and quantity reconciliation holds.

**Evidence:** Not recorded.

### PUR-01 — Six-line supplier PO

Requirements: R19, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Enter all six PDF lines with confirmed UOM, qualifiers and terms.

**Expected:** All lines/amounts/source qualifiers preserved; no fabricated tax/delivery schedule.

**Evidence:** Not recorded.

### PUR-02 — Supplier line splits

Requirements: R19, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Allocate multiple deliveries to one purchase line.

**Expected:** Sum bounded; remaining supplier quantity and unscheduled remainder correct.

**Evidence:** Not recorded.

### PUR-03 — GRN replay/concurrency

Requirements: R19, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Retry same stable receipt key and concurrently receive remaining balance.

**Expected:** Existing fingerprint semantics preserved; no duplicate inward or overreceipt.

**Evidence:** Not recorded.

### PUR-04 — Incoming QC supply

Requirements: R19, R12, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Receive QC-required material; then hold/pass with authorized user.

**Expected:** Physical restricted stock excluded from usable coverage until authorized release.

**Evidence:** Not recorded.

### PUR-05 — Partial/rejected supplier delivery

Requirements: R19, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Receive partial quantity and record rejected/replacement disposition.

**Expected:** PO, schedule, receipt and usable-stock balances remain distinct and reconciled.

**Evidence:** Not recorded.

### PUR-06 — Workbook import ambiguity

Requirements: R19, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Import SEP sheet with April lower dates, blank pending and unknown units.

**Expected:** Preview flags ambiguity; no fabricated month/unit/actual stock posting.

**Evidence:** Not recorded.

### PUR-07 — Re-upload same source

Requirements: R19, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Repeat confirmed import without changes.

**Expected:** No duplicate PO, schedule, receipt or stock movement.

**Evidence:** Not recorded.

### PUR-08 — Receipt evidence and letterhead

Requirements: R19, QCR-32. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Attach supplier test/challan and print PO for confirmed entity.

**Expected:** Evidence linked to correct batch; terms/entity exact, not hard-coded wrong issuer.

**Evidence:** Not recorded.

## P12 — Legacy migration, pilot and UAT

### REG-02 — Migration reconciliation

Requirements: R20. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Migrate restored data and compare all plant-level quantity/status totals.

**Expected:** Every difference explained; original identities and snapshots retained.

**Evidence:** Not recorded.

### QCT-115 — Legacy bound migration

Requirements: QCR-30. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Migrate actual existing final bounds and absent stage/method/unit data.

**Expected:** Known values/provenance retained; unknowns flagged, no universal tolerance or historic measured PASS fabricated.

**Evidence:** Not recorded.

### QCT-116 — Active WIP migration

Requirements: QCR-30, QCR-16. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Migrate scheduled, started, partially dispatched and completed jobs with old snapshots.

**Expected:** IDs, actuals and historic requirements remain unchanged; reviewed future-checkpoint amendments explicit.

**Evidence:** Not recorded.

### QCT-117 — Legacy exposure review

Requirements: QCR-30. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Identify still-circulating lots tied to questionable historic verdict evidence.

**Expected:** Targeted review list produced; no automatic mass acceptance/failure rewrite or unapproved stock reset.

**Evidence:** Not recorded.

### QCT-118 — Feature rollback preserves restrictions

Requirements: QCR-30, QCR-23. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Disable new UI/enforcement rollout flag after active holds and events exist.

**Expected:** Existing server restrictions/audit remain; unsafe legacy write path not restored.

**Evidence:** Not recorded.

### QCT-119 — Migration reconciliation

Requirements: QCR-30, QCR-36. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Compare pre/post quantities/status partitions/orders/releases/WIP/FG/receipts by plant.

**Expected:** Every difference reconciled/approved; no duplicated inspection task, issue or dispatch allocation.

**Evidence:** Not recorded.

### QCT-120 — Full client cycle UAT

Requirements: QCR-36. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Execute approved inward→sample→pass/fail→rework/retest→job→final→FG→dispatch→return/CAPA on pilot data.

**Expected:** Named role/plant users complete cycle with correct physical/system quantity and evidence trace.

**Evidence:** Not recorded.

## P13 — Release evidence and operational handoff

### REG-01 — Dispatch and books lock

Requirements: R20. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Run partial and sealed dispatch/retry plus closed-period writes.

**Expected:** No duplicate fulfillment/outward movement; approved locks enforced.

**Evidence:** Not recorded.

### REG-03 — Restore and recovery

Requirements: R20. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Restore backup, interrupt cross-service release and recover operations.

**Expected:** Documented successful recovery with no lost/duplicate postings.

**Evidence:** Not recorded.

### REG-04 — Performance and deployment evidence

Requirements: R20. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Run agreed realistic data/concurrency browser/API workload against target build.

**Expected:** Agreed budgets met; report actual measurements, versions and remaining limitations.

**Evidence:** Not recorded.

### QCT-121 — Agent restart continuity

Requirements: QCR-35. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Stop mid-phase, start a fresh agent using only package plus recorded state.

**Expected:** Agent identifies exact unfinished task, decisions and evidence; no assumed completion from prior conversation.

**Evidence:** Not recorded.

### QCT-122 — False completion guard

Requirements: QCR-35. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Mark phase complete with missing evidence, unrun assigned test or unapproved blocking decision and run handoff linter.

**Expected:** Manifest validation fails; no readiness percentage is fabricated.

**Evidence:** Not recorded.

### QCT-123 — Restore and operation replay

Requirements: QCR-36. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Restore approved rehearsal backup with pending holds/outbox/barriers and replay recovery.

**Expected:** Correct restrictions/quantities/events survive without duplicate movement or permissive auto-clearance.

**Evidence:** Not recorded.

### QCT-124 — Performance and outage proof

Requirements: QCR-36. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Run agreed realistic report/job/profile workload and multi-service failure injection on release candidate.

**Expected:** Measured results and actual logs recorded against named targets; no small-fixture claim of achieved production capacity.

**Evidence:** Not recorded.

### QCT-125 — Release sign-off

Requirements: QCR-36, QCR-18. Status: **NOT_RUN**. Release blocking: **Yes**.

**Procedure:** Attempt deployment decision with missing owner approval/build/schema/profile evidence.

**Expected:** Gate remains blocked; final handoff names exact verified build, approved scope, recovery and support owners.

**Evidence:** Not recorded.

