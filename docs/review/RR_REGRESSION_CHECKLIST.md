# RR regression checklist (correction pass)

Branch: `cursor/ui-polish-nav-c5f9`  
Audited base: `30263a4ef6592c7bf6e672ca3c2a9b411f39f63f`  
Original 192 V2 cases: **not replaced**. These RR rows are additive.

Legend: `PASS` = automated proof in this pass. `CODE` = implemented and unit-covered, live DB/UI not exercised. `NOT_RUN` = remaining gate.

| ID | Finding | Status | Proof |
| --- | --- | --- | --- |
| RR01 | Partial concession keeps residual lot + independent hold | PASS | `test_rr01_partial_concession_keeps_residual_and_independent_hold`, `test_rr01_independent_hold_blocks_over_release` |
| RR02 | Zero / negative / excess / unspecified concession qty rejected | PASS | `test_rr02_zero_negative_excess_unspecified_rejected` |
| RR03 | Concurrent concession cannot double-release | CODE | `with_for_update` + `operation_id` replay on concession write. Overlapping live Postgres workers **NOT_RUN** |
| RR04 | Client `create_hold_on_fail=false` cannot suppress hold | PASS | Production router ignores the flag; `test_rr04_client_hold_flag_is_ignored_in_router` |
| RR05 | FAIL without reason persists; final submit still blocked | PASS | Persist uses verdict; `test_fail_without_reason_is_measured_fail_not_rejected_evidence`; `submission_error` still set |
| RR06 | Collector keeps every winding sample | PASS | `every winding sample is collected independently` |
| RR07 | Whitespace is missing; kg not copied into g | PASS | UI collector test + `test_kg_batch_weight_is_not_an_alias_for_g_specimen` |
| RR08 | Schedule-entire-PO appends remainder; does not replace committed | PASS | `test_schedule_entire_po_appends_remaining_without_replacing_committed`, `test_repeat_entire_po_after_commitment_does_not_duplicate` |
| RR09 | Delivery date required and revalidated vs customer PO date | PASS | merge rejects missing date; header update reloads stored schedules |
| RR10 | Unscheduled fulfillment counts against remaining-to-schedule | PASS | `test_remaining_to_schedule_subtracts_unscheduled_fulfillment`, `test_fulfilled_without_calloff_cannot_overpromise` |
| RR11 | Patch cannot fake delivered | PASS | `test_new_schedule_row_cannot_be_created_as_delivered`; mutate rejects `delivered` |
| RR12 | Allocations cannot exceed parents or duplicate pairs / cross lines | PASS | `validate_schedule_to_release_allocations` tests + same-line parent check |
| RR13 | Overlapping schedule commits | CODE | `SalesOrder.with_for_update` + `expected_revision` 409. Live overlapping Postgres **NOT_RUN** |
| RR14 | Stale schedule preview rejected | CODE | `STALE_PREVIEW` on revision mismatch |
| RR15 | Incoming profile pinned at receipt; later master not retroactive | PASS | `test_receipt_pin_does_not_follow_later_master`; inward/reel pin |
| RR16 | Store/QC JSON cannot self-approve | PASS | `test_item_profile_cannot_self_approve`, `test_client_approved_status_is_ignored_on_save` |
| RR17 | Approved edit opens new draft and keeps snapshot | PASS | `test_approved_profile_edit_opens_new_draft` |
| RR18 | Approve requires matching revision + Owner/Admin | PASS | `test_approve_requires_matching_revision`; spec approve endpoint |
| RR19 | Inverted / malformed bounds rejected | PASS | spec `test_inverted_and_malformed_bounds_are_rejected`; eval `test_inverted_bounds_are_invalid_not_pass` |
| RR20 | Categorical FAIL vs approved options; oven PRE-only; pair mismatch | PASS | `test_categorical_fail_uses_approved_outcomes`, `test_oven_pre_only_checkpoint_does_not_require_post`, `test_oven_pair_mismatch_fails` |
| RR21 | Independent holds survive another inspection's concession | PASS | remaining_hold_quantity excludes source inspection |
| RR22 | Measured FAIL is never rewritten to PASS | CODE | concession keeps `inspection.status = "FAIL"` |
| RR23 | Customer-rejection partial partition refused | CODE | `PARTIAL_REJECTION_UNSUPPORTED` |
| RR24 | Demand coverage is GROSS_ESTIMATE, not OK/net buy | PASS | `test_coverage_keeps_demand_available_and_reorder_separate` |
| RR25 | UOM mismatch is UNKNOWN, not coverage | PASS | `test_uom_mismatch_is_unknown_not_usable_coverage` |
| RR26 | QC-held PO / stock is not usable coverage of earlier need | PASS | shortfall uses usable unrestricted only; held PO excluded from `supply_usable_qty` |
| RR27 | Customer delivery / production / supplier calendars stay separate | CODE | schedule_policy docstring + pending coverage `supplier_calendar: deferred`. Live production-calendar UI **NOT_RUN** |
| RR28 | Job-card export pages beyond 500 | CODE | `/job-cards/export` loops `page_size = 500`. Live 501+ export **NOT_RUN** |
| RR29 | Plant-scoped notifications; no all-plant Admin/Owner bypass | PASS | `test_limited_admin_without_all_plants_stays_on_assigned_plants` |
| RR30 | Plantless event does not leak to explicit users | PASS | `test_explicit_user_without_plant_does_not_bypass_scope` |
| RR31 | Notification create does not crash on plantless QC event | CODE | `user_can_receive_for_plant` returns False. Live crash probe **NOT_RUN** |
| RR32 | Spec QC dialog keeps product context, dialog role, Escape | PASS | qc-measurement contract test + dialog source |
| RR33 | Job-card print/actuals: samples in quality_checks; kg separate from g | PASS | JobCardDocument samples payload + print labels |
| RR34 | Shared evaluator import from packaged `shared/` | CODE | shim walks parents + `/app/shared`; Docker `COPY shared ./shared`. Image boot **NOT_RUN** |
| RR35 | Service artifact boots with packaged evaluator | NOT_RUN | Requires Docker image build/boot |
| RR36 | Main-targeted PR + original 192-case mapping | NOT_RUN | Owner-gated. This pass does not merge, retarget, or deploy |

## Original 192 V2 suite

Not executed as a named pack in this pass. Additive RR tests above do not replace it.
