# Seasonal manufacturing implementation and release handoff

3 October 2026. Branch `codex/season-recipes-qc-entries`.

The reviewed design is implemented in this branch. It also includes the newer deployed QC work from `ce4d1f00381d443395d0649ea91213e8924dcafd`, including incoming/customer-return QC, rejected-lot returns, specification QC governance and the instrument register. Local acceptance is recorded below. AWS activation, the final testing-data reset and authenticated AWS acceptance must be recorded separately; local success does not certify those steps.

## Confirmed business contract

* One specification has independently versioned Rest of year (`ROY`) and Monsoon (`MONSOON`) paper recipes. Monsoon starts from the current selection and must be explicitly confirmed. Editing one season opens only that season's revision. Shared specification geometry changes invalidate affected approval contexts.
* There is one active production season and two global versioned stage-QC stacks for both plants. Owner changes the season after an impact preview and a required reason. QC, Admin and Owner can edit/publish rule versions. Customer/specification overlays retain their scope, reason, version and approval basis.
* Unreleased work resolves the current approved season. A durable release authorization freezes the recipe, QC rules, customer limits, geometry, BOM, units and provenance before production creates the card. Authorized operations retry their frozen bundle. Released job cards are never rewritten by a switch.
* The confirmed Process length band is nominal minus 0.2 mm through nominal plus 0.2 mm. Oven post-weight is 90–92% of the same sample's measured pre-weight. Winding bamboo length is selected specification bamboo length ±15 mm; Winding CS is customer CS/2.5 through that value +10 N.
* Produced and accepted quantities are mandatory when submitting, with `produced >= accepted >= 0`; rejection is derived. Quantities are whole bamboo units or whole pieces according to the stage. Shift A/B and a valid scoped operator are required. Operator options include employee ID and name. Start/end times are optional.
* A submitted Winding batch can feed Oven, and a submitted Oven batch can feed Process, before the upstream stage closes. Other route edges preserve sequential completion. Every stage close requires the previous stage closed, an assigned supervisor, the required QC evidence and disposition of remaining input. Meeting target never closes a stage automatically and does not prohibit excess production.
* At least two distinct samples per applicable mandatory parameter are required at close. Editing one sample does not create a second sample. Omitted partial-entry readings are incomplete, not permanent failures. Blocking failures and unresolved holds remain blocking. No successful close bypasses the sample minimum.

## Specification and QC workflow

The editor saves geometry, seasonal recipe patches, sheet rows, confirmation and trial intent atomically using a request key and expected revision. Master references and recipe geometry are validated on the server. Both seasonal bindings must be confirmed and valid for approval. Approved recipe content and its geometry context are checked again at release.

The specification register filters and paginates on the server, shows both seasonal revisions/readiness, and opens the recipe/readiness drawer with a concrete plant scope. Owner/Admin can confirm reviewed Monsoon selections in bulk. Existing legacy QC author/reviewer actions and global specification defaults remain available.

There are 18 initial stage rules. Winding ID intersects mandrel ±0.2 mm with customer minimum ID; Winding OD is customer OD +0.8…+1.2 mm. Process ID intersects customer minimum +0.2 mm with any customer maximum. Process length and weight intersect their manufacturing bands with contractual customer limits. Oven/Process CS enforce the customer minimum. Weight/moisture observations and conditional notch parameters remain explicit; no tolerance is invented for a record-only parameter. Inapplicable notching is frozen as N/A with its routing basis.

Rule expressions use validated references, finite Decimal factors/offsets and inclusive endpoints, not executable strings. Lower bounds combine with MAX, upper bounds with MIN. Missing required references or conflicting bounds prevent release. Overlays resolve global → customer BOTH/exact season → specification BOTH/exact season → customer constraints. Loosening requires the governed approval basis.

Instrument evidence uses the authoritative plant instrument register whenever it exists. A typed future calibration date cannot override an expired, disabled or unknown registered instrument. The applicable certificate/calibration evidence is captured with the inspection. Existing typed-evidence behavior is retained for a plant with no register.

Important specification endpoints (service paths; BFF translates `specs` to `specifications`):

| Command | Path |
|---|---|
| Register | `GET /specs/summary` |
| Atomic document | `POST /specs/document`, `PUT /specs/{id}/document` |
| Read seasonal document | `GET /specs/{id}/season-document` |
| Review / approve | `POST /specs/{id}/season-review`, `/season-approve` |
| Independent revision / approval | `PUT /specs/{id}/recipes/{season}/revision`, `POST …/approve` |
| Recipe history | `GET /specs/{id}/recipes/{season}/history` |
| Rules | `GET /qc-rules`, `PUT /qc-rules/draft`, `POST /qc-rules/draft/impact`, `/publish` |
| Overlays | `GET /qc-overlays`, `PUT /qc-overlays/draft`, `POST /qc-overlays/{id}/publish` |
| Season | `GET /season`, `POST /season/bootstrap`, `/season/switch/preview`, `/season/switch` |
| Release authorization | `POST /specs/{id}/release-authorizations`, `POST /season/release-authorizations/{id}/acknowledge` |

## Production and material workflow

Incremental entries record only this entry's quantities. Total mode derives the delta from the expected current stage total; stale totals return a conflict. Draft, submit, observation update, void, close and reopen are separate audited commands. Submitted changes are protected once downstream has consumed them. Operator/QC draft and observation permissions do not grant supervisor submission or closure permissions.

Whole-card entry validates and saves all selected route stages in one database transaction, with up to 20 items. Any failing stage rolls back entries, allocations, inspections, receipts and local completion effects. A successful replay returns the original result once. Version rebasing inside the batch accounts for deliberate target changes after short close while preserving stale-client checks.

Process enforces bamboo input × yield + carried pieces = produced pieces + cutting loss + carried pieces out. Held carryover is reserved until explicitly consumed, returned or scrapped. A short close propagates the achievable target through downstream stages and converts bamboo to pieces once. Remaining accepted input requires an explicit HOLD/RETURN/SCRAP reason. Irreversible disposal prevents an unsafe reopen.

Reel issues are verified against the actual machine/plant/sales order. One consumed issue cannot be linked to multiple cards. Inventory persists sales-order/customer attribution so procurement subtracts actual consumed kg once. Released frozen demand, pending authorized demand and unreleased current-season demand are separate quantity partitions; issued material, reservations and existing POs are not silently rewritten by a toggle.

Packing and final QC create durable completion effects. Inventory posting is retried with a scoped service identity and stable effect key; no human token is persisted. Final QC requires two complete passing customer-limit samples and no unresolved blocking hold. FG is posted only when Packing and final QC are closed, and only the accepted final-QC quantity enters unrestricted FG. Packed quantity, inspected rejects and uninspected/residual packed input remain separate. Zero accepted output creates no FG batch or shipment and records an audited zero-output settlement. The floor shows pending/failed postings and governed retries.

Dispatch serializes against card/stock changes and across cards on the same Sales line, checks actual QC/hold/stock eligibility and records one inventory issue and one sales fulfillment for a replayed request. Internal fulfillment identity is independent of editable challan text. Exact receiver replays are recognized before current reservation/order-balance checks, including a lost response after the receiver commits. An unfinished shipment blocks competing cards until recovered.

Completion requires settlement of all final-QC accepted FG. A card may ship only the lesser of accepted FG, its released allocation and its effective Dispatch target; Sales also enforces the remaining order balance. This prevents one card's excess from consuming another card's allocation. When excess accepted FG remains after this allowance has shipped, an Owner, Admin or Dispatch user can explicitly retain the entire surplus in the existing FG batch, with a reason, exact remaining-quantity check and audited request. The card closes with shipped and retained balances separate; this action creates no stock outward or Sales fulfillment. Pending/failed shipments and QC holds prevent retention. Retained stock needs a governed future allocation before another shipment. Legacy shortcuts that could post FG or close a V2 card without its new gates return a client-upgrade/conflict response.

If final QC accepted fewer pieces than the original release, Owner/Admin/PlantManager records the commercial shortage after all upstream stages close, including on a card whose accepted FG is already dispatched. The default carry-forward decision creates a linked remake card with a distinct release lot, the parent's frozen recipe/QC contract and a quantity-scaled complete route. Stable child and release-lot identities recover a committed Sales split whose response was lost. Sales records the exact source lot and rejects replay against a sibling source; historical records without lineage recover only when deterministic identifiers prove the source. HOLD remains open until explicitly resolved. SHORT_CLOSE_SO reduces the exact linked Sales allocation once, using an absolute original/accepted quantity contract. The original production quantities remain available for audit; accepted physical FG still needs dispatch or surplus settlement. Scoped history is read before a new decision, and ambiguous HOLD-resolution retries keep their reviewed command frozen.

The dispatch register includes V2 Packing, QC and Dispatch stages and sealed history. All-plants reads filter every query to the authenticated allowed plant set; shipment writes use the card's concrete plant. Rows show the human card reference, plant, actual packed/shipped/remaining quantities and QC/FG waiting states. The challan editor supports partial quantities and bundle/net-weight entry. An interrupted seal retains its exact original command, locks the saved details and resumes under the same request ID, including after refresh; derived posting fields cannot change that command.

Key production paths are `/job-cards/{id}/flow`, `/entries`, `/entries/batch`, `/entries/{entry_id}/submit`, `/observations`, `/void`, `/history`, `/stages/{stage}/close`, `/reopen`, `/effects`, `/effects/{effect_id}/retry`, and `/residual-wip/{id}/resolve`.

The job-card UI and print annex show the frozen season, recipe/rules revisions, stage units, calculated limits, samples and operator/supervisor/QC attribution. The print view supports browser printing/PDF export. Physical printer output is not certified by HTML verification.

## Differences from proposed mechanics

* Release authorization is deliberately the freeze boundary. There is no automatic recasting or cancellation of pending authorized bundles. They remain visible in the switch preview and retry using their original operation; a new operation must not duplicate that authorized quantity. An authorization-cancellation command was proposed in the plan but is not part of this delivery.
* Readiness is recalculated at relevant configuration writes and queried with SQL filters before pagination. Publication uses synchronous recomputation; there is no asynchronous readiness job. Release always resolves authoritative data again.
* Register filters currently use page state, rather than a fully URL-synchronized filter workspace. The desktop table has horizontal containment for narrow screens. Card entry uses responsive controls. These are presentation differences, not different release rules.
* The implemented reset retains the configured master catalogue, users/access, numbering counters, material QC templates, seasonal rules/history, instrument register and plant configuration. It clears testing operational transactions and stock across both plants. This is the concrete retention scope; the earlier proposal to remove unspecified test masters is superseded. The retention manifest must be reviewed before AWS deletion.

## Testing-data reset and recovery

`scripts/season/reset_testing_data.py` is administrative tooling, dry-run by default. `deploy/aws-ec2/reset_testing_operations.sh` runs it on the existing host with an exact deployed SHA and unique reset ID. Both plants and all seven databases are covered: auth notifications, master operational/audit outboxes, specifications/recipes/trials/overlays, sales/release schedules, production/entries/QC/dispatch/residuals/outboxes, procurement/inward/reels/stock/reservations/tool assets/accounting reconciliation and analytics jobs.

The preview records table classification, row counts, content hashes, release identity, operator, environment and a review fingerprint. Apply preserves a separate copy of the reviewed preview. Unknown tables or retained→cleared foreign keys stop before deletion. Apply requires the reviewed preview to match the stopped dataset, including content. All application pools/workers are offline, and release/backup locks prevent a concurrent operation from restarting the app. Timer states are restored only after successful readiness.

Before the first clear, all seven complete database dumps are SHA-256 checked, restored into disposable databases and compared by counts and per-table content hashes. There is no TRUNCATE CASCADE. All deletion checkpoints live in the external archive. A COMPLETE reset ID replays without deleting newly entered records. Numbering counters remain; fresh UUIDs and monotonic identifiers prevent old QR/API references from becoming new records.

Recovery validates every archive and offline database before restoring the first. It restores each database transactionally and verifies the archived counts/content. Any partial failure leaves the app and backup timers offline. Never restart a mixed snapshot set.

The isolated rehearsal cleared 1,024 operational rows, verified configuration retention, inserted a new record after completion and proved reset replay retained it. It then recovered all seven original databases and proved exact counts/content. These are local rehearsal counts, not AWS deletion counts. Evidence is in the corresponding ignored reports/logs and `/private/tmp/hariom-season-reset-rehearsal-20261003c/reset-manifest.json`.

## Local verification completed

| Verification | Result |
|---|---|
| Final production service suite, including shortage recovery | 340 passed, 18 skipped |
| Dispatch discovery, plant-scope, partial-shipment and persisted recovery PostgreSQL contracts | 5 passed |
| Continuous PostgreSQL contracts, including instrument-register enforcement | 17 passed |
| Live-QC PostgreSQL register/reporting contracts, including partial observations | 3 passed |
| Specification suite after merge | 80 passed, 6 skipped |
| Seasonal specification PostgreSQL contracts run separately | 6 passed |
| Inventory suite after merge | 107 passed, 5 skipped |
| Sales suite after final receiver changes | 60 passed, 3 skipped |
| Incoming profile / customer-return / rejected-lot PostgreSQL contracts | 5 passed |
| Gateway suite | 55 passed, 1 skipped |
| Release/reset fault injection, locks and timer-state recovery | 19 passed |
| Analytics suite | 23 passed |
| Decimal seasonal QC evaluator | 12 passed |
| Frontend static and unit suites | Passed; 150 dashboard routes covered by 27 guides |
| TypeScript / production build | Passed |
| Lint | Passed with existing warnings |
| Shell syntax, Python compilation, diff whitespace | Passed |

Skipped database suites are not counted as passes. Required seasonal contracts were run separately against named disposable PostgreSQL databases. No original local or AWS business data was used by the API acceptance script.

`scripts/season/verify_integrated_flow.py` requires `ERP_DB_PREFIX=hariom_nverify_season_` and uses loopback ports. The fresh `FINAL` run exercised legitimate login and distinct maker/checker approval, dual-recipe approval, sales release, both season switches, independent Monsoon revision, stale preview rejection, frozen release bundles, incremental/total entries and whole-card rollback/replay.

The same run covered PO approval → governed 100 kg inward/replay → incoming QC (including self-approval rejection) → invoice attachment → reel issue → 49.5 + 49.5 kg coils + 1 kg trim → winding issue → Winding/Oven/Process/Packing → two final QC samples → FG → held-dispatch rejection → hold release → dispatch/replay. Material mass and sales fulfillment were reconciled. Desktop browser acceptance additionally exercised whole-card entry, final QC and printing; responsive acceptance screenshots are kept in `reports/screenshots`.

Separate actual QC, Operator and Sales logins verified scoped card reading, role-denied season switching/closure and cross-plant rejection. QC saved an unchanged draft through its permitted endpoint; Operator saved a draft but could not submit it; Sales could not author global rules. The Operator acceptance draft was voided by the Owner with a reason. The register, card and whole-card form were checked at 390 px with document scroll width equal to viewport width. Whole-card sample fields display the frozen permitted ranges next to the input.

`scripts/season/verify_shortage_flow.py` separately exercised actual local services: packed 50 → final QC accepted 40 / rejected 10 → FG inward 40 → two shipments of 30 and 10 using the same editable challan text → completed-parent carry-forward 10 → the complete remake route and final QC → FG/dispatch 10 → Sales fulfilled 100. Exact command replays returned the original shipment and shortage decision. The child retained the original release bundle hash. These latest quantity and shortage paths have API/PostgreSQL acceptance. Browser acceptance verified the completed-card shortage/remake history on desktop and at the normal 455 px panel width with no page overflow. A separate browser run sealed 30 then 20 pieces, showed the remaining 20, blocked a 21-piece attempt and reconciled the completed card with Sales fulfilled 100. Saved print screenshots show both actual sealed partial challans. The final build also corrects filter counts, chronological shipment numbering and accepted-FG confirmation copy.

## AWS release and final acceptance sequence

The product release is committed and pushed as `ab058aa0e1f0f4ea933293fd794e1122b5084ad9` on the dedicated branch. The published release/reset tooling was downloaded from that exact immutable GitHub commit and matched the local SHA-256 checksums. The latest actual AWS identity read (SSM `7e5e970a-00aa-4628-9fda-254f24203600`) still returned `ce4d1f00381d443395d0649ea91213e8924dcafd`. A read-only routing preflight was submitted as `5711ba50-ffec-43be-9ef4-4a34a6e2f574`; its result remains pending retrieval. No seasonal release or AWS operational reset has been submitted at this checkpoint. Safari CloudShell is inaccessible while macOS is locked. Deployment authorization is already provided; physical screen access is the current release blocker.

The final local browser check against the completed production build renewed the test session through normal sign-in, opened the requested dispatch register and verified card `26/10/06` as DONE/SEALED with accepted/shipped 50, remaining 0 and chronological shipment history 30 then 20. Filtering to that card correctly showed one visible handoff. The default 455 px panel had document width 455 px. The saved proof is `reports/screenshots/final-dispatch-register.jpg`; this is local evidence.

The guarded on-host acceptance procedure is documented in `scripts/season/aws_acceptance.md`. Its test helper may be fetched from a separately reviewed helper commit; this does not change the deployed product SHA. The helper must pass its own guard/retry review before use. It signs in through both the actual internal services and the public HTTPS BFF cookie flow, preserves existing published QC/configuration, records run-owned catalogue provenance, and restores the original season. Existing credentials remain on the host. After the final operational reset, only the helper's proven created catalogue rows are softly deactivated through supported APIs; retained preexisting masters are preserved.

1. Finish the final browser/type/build checks, commit/push this branch and record the exact release SHA.
2. Read the currently deployed marker and verify it is still the reviewed `ce4d1f00381d443395d0649ea91213e8924dcafd`. Use the user's authorized signed-in Safari CloudShell session. Do not reset credentials or widen host access.
3. Run `cloudshell_release.sh <release-sha> <expected-deployed-sha>`. The host release guard takes a lock, preserves prior source/image, builds, takes a consistent seven-database encrypted backup, applies additive migrations, checks legacy material routing, activates, waits for internal/public readiness, backs up the new schemas and runs a separate restore drill. Record the SSM command and all result evidence.
4. Sign in with existing authorized Owner/Admin accounts. Initialize and publish the two identical confirmed QC templates using actual authenticated commands. Confirm the active season and both-plant permissions. Do not claim role acceptance from public health.
5. Generate the actual AWS reset preview. Review concrete deletion/retention counts, ensure a current tested backup, and obtain any required at-action confirmation before irreversible deletion. If data drifted, stop and re-preview; never relax the hash guard.
6. Apply the reviewed reset. Verify empty operational lists/stock in both plants, retained setup/access, published ROY/Monsoon rules, active ROY, healthy workers and timer restoration. Preserve the external reset archive and restore procedure.
7. Complete signed-in final acceptance of new spec creation, missing-Monsoon blocker, sales approval/release, card freeze, floor/QC gates, incoming-material clearance, packing/dispatch and role denials. Use identified disposable acceptance data and remove only that scope after verification, or run acceptance before the single approved final operational reset.
8. Report the deployed identity, health, backup/restore evidence, cleanup counts and authenticated workflow evidence. List anything unverified explicitly. The release is not live-ready until these runtime gates are completed.
