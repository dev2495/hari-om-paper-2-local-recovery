#!/usr/bin/env python3
"""Build ID-keyed overlays from the immutable baseline-v2 originals.

Does not modify REQUIREMENTS_V2.json or ACCEPTANCE_TESTS_V2.json.
Original historical statuses stay NOT_RUN / NOT_STARTED.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE = ROOT / "baseline-v2"


# overlay_status is PASS only when an executed test matches the original procedure.
# CODE / LIMITATION / HUMAN_UAT / PARTIAL never become PASS here.
SPECIAL: dict[str, dict] = {
    "QCT-027": {
        "overlay_status": "PASS",
        "coverage": "EXACT_EXECUTED",
        "mapped_tests": [
            "inventory-service/tests/test_live_postgres_rr.py::test_partial_concession_keeps_residual_hold_and_blocks_issue"
        ],
        "rr": ["RR01", "RR21"],
        "notes": "Live PG 1000/600/400 partition; residual QC_HOLD blocks issue/WIP/dispatch/move.",
    },
    "QCT-052": {
        "overlay_status": "PASS",
        "coverage": "EXACT_EXECUTED",
        "mapped_tests": [
            "inventory-service/tests/test_live_postgres_rr.py::test_fail_without_reason_persists_pending",
            "production-service/tests/test_live_postgres_rr.py::test_client_hold_flag_ignored_and_fail_without_reason_persists",
        ],
        "rr": ["RR05"],
        "notes": "Out-of-range reading saved as FAIL with reason-pending and a hold; not rejected before insert.",
    },
    "QCT-012": {
        "overlay_status": "NOT_RUN",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "production-service/tests/test_live_postgres_rr.py::test_every_winding_sample_persists_and_later_fail_matters"
        ],
        "rr": ["RR06"],
        "notes": "Every winding sample persisted and individual FAIL retained. Approved aggregation-method decision NOT_RUN.",
    },
    "QCT-053": {
        "overlay_status": "NOT_RUN",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "production-service/tests/test_quality_eval.py::test_winder_out_of_range_fail_requires_reason",
            "production-service/tests/test_quality_eval.py::test_incoming_uses_item_profile_and_ignores_reason_pass",
            "inventory-service/tests/test_live_postgres_rr.py::test_partial_concession_keeps_residual_hold_and_blocks_issue",
        ],
        "rr": ["RR22"],
        "notes": "Evaluator and concession keep measured FAIL. Full disposition-authority UI path NOT_RUN.",
    },
    "QCT-071": {
        "overlay_status": "NOT_RUN",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "inventory-service/tests/test_live_postgres_rr.py::test_partial_concession_keeps_residual_hold_and_blocks_issue",
            "inventory-service/tests/test_live_postgres_rr.py::test_overlapping_concessions_cannot_double_release",
        ],
        "rr": ["RR03", "RR21"],
        "notes": "Independent hold quantity survives concession. Retest-vs-newer-hold lineage NOT_RUN.",
    },
    "QCT-075": {
        "overlay_status": "NOT_RUN",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "inventory-service/tests/test_live_postgres_rr.py::test_partial_concession_keeps_residual_hold_and_blocks_issue"
        ],
        "rr": ["RR01"],
        "notes": "Held residual cannot be issued. Parallel hold-versus-issue race NOT_RUN.",
    },
    "QCT-076": {
        "overlay_status": "NOT_RUN",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "inventory-service/tests/test_live_postgres_rr.py::test_partial_concession_keeps_residual_hold_and_blocks_issue"
        ],
        "notes": "Held residual cannot be dispatched. Concurrent sealed-dispatch race NOT_RUN.",
    },
    "QCT-081": {
        "overlay_status": "NOT_RUN",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "inventory-service/tests/test_live_postgres_rr.py::test_partial_concession_keeps_residual_hold_and_blocks_issue"
        ],
        "notes": "Issue, WIP, dispatch, and stock-status shortcut blocked for residual hold. Purchase-desk PASS and old-client matrix NOT_RUN.",
    },
    "QCT-085": {
        "overlay_status": "NOT_RUN",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "auth-service/tests/test_live_postgres_rr.py::test_two_plant_users_and_limited_admin_do_not_cross_notify"
        ],
        "rr": ["RR29", "RR30"],
        "notes": "Direct notification create is plant-scoped. Inward-failure event plus working deep link NOT_RUN.",
    },
    "PLAN-01": {
        "overlay_status": "PASS",
        "coverage": "EXACT_EXECUTED",
        "mapped_tests": [
            "sales-service/tests/test_original_comm_live.py::test_plan01_three_line_multi_date_schedule_accounts_for_every_qty",
            "sales-service/tests/test_live_postgres_rr.py::test_schedule_100_with_existing_40_appends_60",
        ],
        "rr": ["RR08"],
        "notes": "Live PG three-line 100/40/60 over five dated rows; quantities conserved. Calendar UI still NOT_RUN.",
    },
    "PLAN-02": {
        "overlay_status": "PASS",
        "coverage": "EXACT_EXECUTED",
        "mapped_tests": [
            "sales-service/tests/test_original_wave2_live.py::test_plan02_saved_schedule_reloads_dates_qty_and_revision"
        ],
        "notes": "Second session reloads dates, quantities, row ids and schedule_revision=1. Browser deep-link UI NOT_RUN.",
    },
    "PLAN-03": {
        "overlay_status": "PASS",
        "coverage": "EXACT_EXECUTED",
        "mapped_tests": [
            "sales-service/tests/test_original_wave2_live.py::test_plan03_two_planners_same_preview_revision_conflict_without_overallocation",
            "sales-service/tests/test_live_postgres_rr.py::test_overlapping_schedule_commits_reject_stale_revision",
        ],
        "rr": ["RR13", "RR14"],
        "notes": "Two planners on revision 0: one commit, one 409; stored qty stays 100. Calendar UI NOT_RUN.",
    },
    "PLAN-04": {
        "overlay_status": "PARTIAL",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "sales-service/tests/test_original_wave2_live.py::test_plan04_locked_or_delivered_history_cannot_move_only_editable_remainder"
        ],
        "notes": "Locked 40 cannot move; editable remainder date changes. Group-move of dispatched/started jobs NOT_RUN.",
    },
    "PLAN-05": {
        "overlay_status": "PARTIAL",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "sales-service/tests/test_original_wave2_live.py::test_plan05_customer_schedule_save_does_not_release_or_fulfill"
        ],
        "notes": "Customer calendar save leaves APPROVED, zero released/fulfilled, no lots. Supplier dates and inventory postings NOT_RUN.",
    },
    "PUR-03": {
        "overlay_status": "PASS",
        "coverage": "EXACT_EXECUTED",
        "mapped_tests": [
            "inventory-service/tests/test_original_pur_live.py::test_pur03_same_grn_key_replays_and_balance_receive_does_not_overreceipt",
            "inventory-service/tests/test_original_pur_live.py::test_pur03_concurrent_remaining_balance_cannot_double_inward",
        ],
        "notes": "Same GRN key idempotent; over-receipt 400; remaining 60 posts; concurrent remaining cannot double inward.",
    },
    "COMM-01": {
        "overlay_status": "PARTIAL",
        "coverage": "PARTIAL",
        "mapped_tests": ["apps/web-ui/e2e/theme-a11y-print.spec.cjs"],
        "bj": ["BJ08"],
        "notes": "Chromium light/dark: Customer PO Date and Delivery Date labels on compact New sales order form. Saved-order print round-trip NOT_RUN.",
    },
    "COMM-02": {
        "overlay_status": "PARTIAL",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "sales-service/tests/test_original_comm_live.py::test_comm02_api_rejects_equal_and_earlier_without_partial_save",
            "sales-service/tests/test_sales_commercial.py::test_delivery_date_must_be_strictly_later_than_customer_po_date",
            "sales-service/tests/test_live_postgres_rr.py::test_equal_or_earlier_delivery_date_is_rejected",
        ],
        "rr": ["RR09"],
        "notes": "Live create API rejects equal/earlier without inserting; later date saved. Direct UI date attempts NOT_RUN.",
    },
    "COMM-03": {
        "overlay_status": "PARTIAL",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "sales-service/tests/test_original_comm_live.py::test_comm03_header_date_change_does_not_silently_move_commitments",
            "sales-service/tests/test_sales_commercial.py::test_header_date_change_revalidates_every_line",
        ],
        "rr": ["RR09"],
        "notes": "Header PO-date change is validated before apply; lines/schedules are not moved. Review-flag UX (vs hard reject) NOT_RUN.",
    },
    "COMM-04": {
        "overlay_status": "PARTIAL",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "sales-service/tests/test_original_comm_live.py::test_comm04_internal_order_clears_external_po_and_needs_second_approver"
        ],
        "notes": "Live internal create clears invented PO/date; same-person approve 403; second person approves. Release+dispatch of that order NOT_RUN.",
    },
    "COMM-05": {
        "overlay_status": "PARTIAL",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "sales-service/tests/test_original_comm_live.py::test_comm05_review_origin_cannot_be_approved_and_is_not_rewritten",
            "sales-service/tests/test_sales_commercial.py::test_blank_historical_po_is_review_not_guessed_internal",
        ],
        "notes": "Blank PO classifies REVIEW not INTERNAL; approval blocked. Historical table backfill job NOT_RUN.",
    },
    "COMM-06": {
        "overlay_status": "PARTIAL",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "sales-service/tests/test_original_comm_live.py::test_comm06_07_parchment_boolean_round_trips_and_uncheck_clears_stale"
        ],
        "notes": "Live create persists boolean+variant. Release/BOM/print downstream NOT_RUN.",
    },
    "COMM-07": {
        "overlay_status": "PARTIAL",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "sales-service/tests/test_original_comm_live.py::test_comm06_07_parchment_boolean_round_trips_and_uncheck_clears_stale"
        ],
        "notes": "Uncheck saves false/null; stale color/id cleared. Silent BOM alteration path NOT_RUN.",
    },
    "COMM-08": {
        "overlay_status": "PARTIAL",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "production-service/tests/test_planning_validation.py::PlanningValidationTests::test_comm08_mismatch_does_not_overwrite_approved_recipe_color",
            "production-service/tests/test_planning_validation.py::PlanningValidationTests::test_comm08_parchment_disallowed_on_recipe_is_conflict_not_silent_enable",
        ],
        "notes": "Job snapshot keeps approved recipe parchment and records CONFLICT. Live order+UI resolution NOT_RUN.",
    },
    "COMM-09": {
        "overlay_status": "PARTIAL",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "sales-service/tests/test_original_comm_live.py::test_comm09_stable_line_ids_on_edit_and_remove"
        ],
        "notes": "Draft update-by-id keeps UUID; other line removed. Schedule-linked removal/reconcile NOT_RUN.",
    },
    "COMM-10": {
        "overlay_status": "PARTIAL",
        "coverage": "PARTIAL",
        "mapped_tests": ["apps/web-ui/e2e/theme-a11y-print.spec.cjs"],
        "bj": ["BJ04", "BJ08"],
        "notes": "Chromium compact header; Release Readiness / Sales PO Entry absent. Full add/remove/approval action matrix NOT_RUN.",
    },
    "COMM-11": {
        "overlay_status": "PASS",
        "coverage": "EXACT_EXECUTED",
        "mapped_tests": [
            "sales-service/tests/test_original_comm_live.py::test_comm11_concurrent_order_numbers_are_unique"
        ],
        "notes": "Eight concurrent live creates on hariom_nverify_salesdb; unique SO-YYYYMMDD-NNNN; no lost success.",
    },
    "COMM-12": {
        "overlay_status": "PARTIAL",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "sales-service/tests/test_original_comm_live.py::test_comm12_bulk_import_and_old_payload_use_server_date_rule"
        ],
        "notes": "Bulk-import API rejects equal dates. Binary old-client payload NOT_RUN.",
    },
    "REL-01": {
        "overlay_status": "PARTIAL",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "production-service/tests/test_planning_validation.py::PlanningValidationTests::test_release_preflight_accepts_incompatible_selected_winder_as_advisory"
        ],
        "bj": ["BJ04", "BJ05"],
        "notes": "Preflight ready with geometry warning, no blocker. Live job actually queued under mismatch NOT_RUN this pass.",
    },
    "REL-02": {
        "overlay_status": "PARTIAL",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "production-service/tests/test_planning_validation.py::PlanningValidationTests::test_rel02_wrong_plant_or_missing_identity_is_rejected",
            "production-service/tests/test_planning_validation.py::PlanningValidationTests::test_winder_queue_identity_rejects_other_department",
        ],
        "notes": "Wrong plant, missing id, other department rejected. Full no-lot side-effect proof on HTTP NOT_RUN.",
    },
    "REL-03": {
        "overlay_status": "PARTIAL",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "sales-service/tests/test_original_comm_live.py::test_rel03_zero_negative_excess_and_unapproved_release_rejected"
        ],
        "notes": "Zero/negative/inf rejected; unapproved 400; bounded 4 of 10 succeeds. Unauthorized-role token matrix NOT_RUN.",
    },
    "REL-04": {
        "overlay_status": "PASS",
        "coverage": "EXACT_EXECUTED",
        "mapped_tests": [
            "production-service/tests/test_original_rel_replay.py::test_rel04_rel05_same_release_replay_is_noop_after_schedule_and_start"
        ],
        "notes": "Live replay after scheduled/started winding is noop; plan_date/shift/actuals/snapshot unchanged.",
    },
    "REL-05": {
        "overlay_status": "PASS",
        "coverage": "EXACT_EXECUTED",
        "mapped_tests": [
            "production-service/tests/test_original_rel_replay.py::test_rel05_completed_replay_does_not_reopen"
        ],
        "notes": "Completed job replay returns same card; stage stays COMPLETED; current_stage stays DONE.",
    },
    "REL-06": {
        "overlay_status": "PASS",
        "coverage": "EXACT_EXECUTED",
        "mapped_tests": [
            "sales-service/tests/test_original_comm_live.py::test_rel06_concurrent_releases_stay_bounded"
        ],
        "notes": "Two concurrent 7+7 against remaining 10: one ok, one err; stored released qty stays 7.",
    },
    "REL-07": {
        "overlay_status": "PASS",
        "coverage": "EXACT_EXECUTED",
        "mapped_tests": [
            "sales-service/tests/test_original_wave2_live.py::test_rel07_lost_production_response_replays_same_lot_without_new_release"
        ],
        "notes": "Same release_lot_id replay returns the durable lot; job-card sync retry does not mint a second lot.",
    },
    "REL-08": {
        "overlay_status": "PASS",
        "coverage": "EXACT_EXECUTED",
        "mapped_tests": [
            "production-service/tests/test_original_rel_replay.py::test_rel08_changed_quantity_or_spec_conflicts_and_leaves_original"
        ],
        "notes": "Replay with changed qty/spec is 409 release_replay_conflict; original snapshot/qty unchanged.",
    },
    "REL-09": {
        "overlay_status": "PASS",
        "coverage": "EXACT_EXECUTED",
        "mapped_tests": [
            "sales-service/tests/test_original_wave2_live.py::test_rel09_partial_multiline_sync_failure_retries_only_pending_line"
        ],
        "notes": "Line-1 job link persists while line-2 stays pending; retry links only the pending lot; two lots total.",
    },
    "REL-10": {
        "overlay_status": "PASS",
        "coverage": "EXACT_EXECUTED",
        "mapped_tests": [
            "production-service/tests/test_planning_validation.py::PlanningValidationTests::test_rel10_queue_admission_allows_maintenance_while_execution_still_blocks"
        ],
        "notes": "Queue identity accepts MAINT winder; execution compatibility still rejects MAINT.",
    },
    "REL-11": {
        "overlay_status": "PARTIAL",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "sales-service/tests/test_original_wave2_live.py::test_rel11_status_only_header_release_does_not_invent_release_qty"
        ],
        "notes": "Header /release sets RELEASED with zero lot qty; line release then records 5. List/detail/bulk/legacy matrix NOT_RUN.",
    },
    "QCT-001": {
        "overlay_status": "PASS",
        "coverage": "EXACT_EXECUTED",
        "mapped_tests": [
            "hariom-erp/shared/tests/test_original_qct_evaluator.py::test_qct001_two_sided_inclusive_and_exclusive_endpoints"
        ],
        "rr": ["RR19"],
        "notes": "Inclusive and exclusive endpoints; just-outside FAIL; no implicit epsilon.",
    },
    "QCT-002": {
        "overlay_status": "PASS",
        "coverage": "EXACT_EXECUTED",
        "mapped_tests": [
            "hariom-erp/shared/tests/test_original_qct_evaluator.py::test_qct002_minimum_only_never_disables_when_max_missing"
        ],
        "notes": "Minimum-only rule still fails below min when max is absent.",
    },
    "QCT-003": {
        "overlay_status": "PASS",
        "coverage": "EXACT_EXECUTED",
        "mapped_tests": [
            "hariom-erp/shared/tests/test_original_qct_evaluator.py::test_qct003_maximum_only_enforced_independently"
        ],
        "notes": "Exclusive maximum independent of missing minimum.",
    },
    "QCT-005": {
        "overlay_status": "PARTIAL",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "spec-service/tests/test_qc_profile.py::test_inverted_and_malformed_bounds_are_rejected",
            "spec-service/tests/test_qc_profile.py::test_unsafe_rule_expression_is_rejected",
            "spec-service/tests/test_qc_profile.py::test_empty_categorical_accept_set_is_rejected",
        ],
        "rr": ["RR19"],
        "notes": "Normalize rejects inverted, malformed, empty accept-set, unsafe formula. Live approve HTTP NOT_RUN.",
    },
    "QCT-006": {
        "overlay_status": "PARTIAL",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "hariom-erp/shared/tests/test_original_qct_evaluator.py::test_qct006_malformed_and_non_finite_never_pass"
        ],
        "rr": ["RR07"],
        "notes": "Blank/text/NaN/inf/bool never PASS on evaluate_parameter. Legacy incoming_quality adapter still collapses missing to FAIL.",
    },
    "QCT-007": {
        "overlay_status": "PASS",
        "coverage": "EXACT_EXECUTED",
        "mapped_tests": [
            "hariom-erp/shared/tests/test_original_qct_evaluator.py::test_qct007_zero_is_evaluated_and_missing_is_incomplete"
        ],
        "rr": ["RR07"],
        "notes": "Numeric zero is zero; omitted/whitespace is INCOMPLETE.",
    },
    "QCT-008": {
        "overlay_status": "PARTIAL",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "hariom-erp/shared/tests/test_original_qct_evaluator.py::test_qct008_rounding_edge_stays_fail_with_explanatory_precision"
        ],
        "notes": "55.0001 stays FAIL with allowed display. UI/export extra precision NOT_RUN.",
    },
    "QCT-009": {
        "overlay_status": "PASS",
        "coverage": "EXACT_EXECUTED",
        "mapped_tests": [
            "hariom-erp/shared/tests/test_original_qct_evaluator.py::test_qct009_categorical_and_boolean_unknowns_are_invalid"
        ],
        "rr": ["RR20"],
        "notes": "Approved PASS/FAIL tokens; unknown BLEED is INVALID not measured PASS.",
    },
    "QCT-010": {
        "overlay_status": "PASS",
        "coverage": "EXACT_EXECUTED",
        "mapped_tests": [
            "hariom-erp/shared/tests/test_original_qct_evaluator.py::test_qct010_descriptive_only_is_observation_not_measured_pass"
        ],
        "notes": "Text-only profile is OBSERVATION_ONLY, not measured PASS.",
    },
    "QCT-011": {
        "overlay_status": "PASS",
        "coverage": "EXACT_EXECUTED",
        "mapped_tests": [
            "hariom-erp/shared/tests/test_original_qct_evaluator.py::test_qct011_kg_alias_does_not_satisfy_gram_rule"
        ],
        "notes": "kg batch alias does not satisfy per-specimen gram pre_weight.",
    },
    "QCT-013": {
        "overlay_status": "PASS",
        "coverage": "EXACT_EXECUTED",
        "mapped_tests": [
            "hariom-erp/shared/tests/test_original_qct_evaluator.py::test_qct013_evaluator_does_not_execute_payload_code",
            "spec-service/tests/test_qc_profile.py::test_unsafe_rule_expression_is_rejected",
        ],
        "notes": "Formula/expression keys rejected on normalize; payload code string is INVALID, not executed.",
    },
    "QCT-014": {
        "overlay_status": "PASS",
        "coverage": "EXACT_EXECUTED",
        "mapped_tests": [
            "hariom-erp/shared/tests/test_original_qct_evaluator.py::test_qct014_incoming_and_job_adapters_share_golden_numeric_contract",
            "hariom-erp/shared/tests/test_original_qct_evaluator.py::test_qct014_packaged_evaluator_copies_are_byte_identical",
        ],
        "notes": "Inventory evaluate_incoming and production evaluate_job_stage share golden 200/199.999/blank; three packaged copies SHA-identical.",
    },
    "QCT-043": {
        "overlay_status": "NOT_RUN",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "inventory-service/tests/test_live_postgres_rr.py::test_receipt_pin_survives_later_master_edit"
        ],
        "rr": ["RR15"],
        "notes": "Receipt pin survives later master edit. Job-card print remaining on rev A after rev B NOT_RUN.",
    },
    "QCT-046": {
        "overlay_status": "NOT_RUN",
        "coverage": "PARTIAL",
        "mapped_tests": ["apps/web-ui/e2e/correction-journeys.spec.cjs"],
        "bj": ["BJ12"],
        "rr": ["RR33"],
        "notes": "Chromium print keeps samples and kg vs g. Multi-page all-stage paired-oven print NOT_RUN.",
    },
    "QCT-047": {
        "overlay_status": "NOT_RUN",
        "coverage": "PARTIAL",
        "mapped_tests": ["apps/web-ui/e2e/correction-journeys.spec.cjs"],
        "bj": ["BJ12"],
        "notes": "Completed print captured. Newer-profile historical freeze print NOT_RUN.",
    },
    "QCT-048": {
        "overlay_status": "NOT_RUN",
        "coverage": "UNIT_ONLY",
        "mapped_tests": ["production-service/tests/test_quality_eval.py::test_oven_pre_only_checkpoint_does_not_require_post"],
        "rr": ["RR20"],
        "notes": "PRE-only checkpoint. Full pre/post timing UI NOT_RUN.",
    },
    "QCT-049": {
        "overlay_status": "NOT_RUN",
        "coverage": "UNIT_ONLY",
        "mapped_tests": ["production-service/tests/test_quality_eval.py::test_oven_pair_mismatch_fails"],
        "rr": ["RR20"],
        "notes": "Pair mismatch FAIL in evaluator. Job-card entry adapter NOT_RUN.",
    },
    "QCT-029": {
        "overlay_status": "NOT_RUN",
        "coverage": "PARTIAL",
        "mapped_tests": ["apps/web-ui/e2e/correction-journeys.spec.cjs"],
        "bj": ["BJ11"],
        "rr": ["RR32"],
        "notes": "Spec QC dialog keyboard/role/Escape proven. Deliberate new-spec save-before-dialog product context NOT_RUN as this case.",
    },
    "QCT-040": {
        "overlay_status": "NOT_RUN",
        "coverage": "PARTIAL",
        "mapped_tests": ["production-service/tests/test_quality_eval.py"],
        "notes": "Evaluator uses I.D./O.D./Height/Weight/C.S. and oven/process names. Full UI template contract NOT_RUN.",
    },
    "QCT-098": {
        "overlay_status": "NOT_RUN",
        "coverage": "UNIT_ONLY",
        "mapped_tests": [
            "production-service/tests/test_quality_pass_rate.py::test_empty_set_is_null_never_one_hundred",
            "analytics-service/tests/test_quality_pass_rate.py::test_quality_report_empty_inspections_are_not_one_hundred_percent",
        ],
        "notes": "Empty denominator is not 100%. Full report query/UI NOT_RUN.",
    },
    "DEM-01": {
        "overlay_status": "NOT_RUN",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "sales-service/tests/test_pending_and_schedules.py::test_pending_workspace_paginates_after_full_set_summary_and_url_filter",
            "sales-service/tests/test_open_demand.py::test_open_demand_includes_remaining_beyond_a_page_sized_set",
        ],
        "notes": "Pending workspace is server-side, not first page. 501-order / 250-job original scale NOT_RUN.",
    },
    "DEM-02": {
        "overlay_status": "LIMITATION",
        "coverage": "LIMITATION",
        "limitation": "GROSS_ESTIMATE",
        "mapped_tests": ["analytics-service/tests/test_demand_coverage.py::test_coverage_keeps_demand_available_and_reorder_separate"],
        "rr": ["RR24"],
        "notes": "Coverage is labelled GROSS_ESTIMATE/ESTIMATE. Residual WIP/issued/FG netting is not implemented.",
    },
    "DEM-04": {
        "overlay_status": "NOT_RUN",
        "coverage": "UNIT_ONLY",
        "mapped_tests": [
            "analytics-service/tests/test_demand_coverage.py::test_uom_mismatch_is_unknown_not_usable_coverage",
            "analytics-service/tests/test_demand_coverage.py::test_gsm_in_description_is_not_a_substitute_match",
        ],
        "rr": ["RR25"],
        "notes": "UOM mismatch is UNKNOWN; GSM-in-name is not a substitute. Full grade/width/form matrix NOT_RUN.",
    },
    "DEM-06": {
        "overlay_status": "LIMITATION",
        "coverage": "LIMITATION",
        "limitation": "GROSS_ESTIMATE",
        "mapped_tests": ["analytics-service/tests/test_demand_coverage.py::test_coverage_keeps_demand_available_and_reorder_separate"],
        "rr": ["RR24"],
        "notes": "first_shortage_bucket exists in gross estimate. Time-phased purchasing is not implemented.",
    },
    "QC-01": {
        "overlay_status": "NOT_RUN",
        "coverage": "UNIT_ONLY",
        "mapped_tests": [
            "auth-service/tests/test_qc_role_identity.py::test_qc_is_a_canonical_business_role",
            "auth-service/tests/test_qc_role_identity.py::test_qc_is_not_aliased_to_plant_manager",
        ],
        "notes": "QC is a canonical role, not PlantManager. Sign-in landing/menu/deep-link NOT_RUN.",
    },
    "QC-02": {
        "overlay_status": "NOT_RUN",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "production-service/tests/test_qc_plant_scope.py",
            "apps/web-ui/e2e/release-gate.spec.cjs",
        ],
        "bj": ["BJ06"],
        "notes": "Role/plant guards in Chromium and QC write plant scope. Full QC-token admin/sales-approval matrix NOT_RUN.",
    },
    "QCT-111": {
        "overlay_status": "NOT_RUN",
        "coverage": "UNIT_ONLY",
        "mapped_tests": ["auth-service/tests/test_qc_role_identity.py::test_qc_is_a_canonical_business_role"],
        "notes": "Role identity unit. Seed/migration/restart sequence NOT_RUN.",
    },
    "QCT-107": {
        "overlay_status": "LIMITATION",
        "coverage": "LIMITATION",
        "limitation": "PARTIAL_REJECTION_UNSUPPORTED",
        "rr": ["RR23"],
        "notes": "Customer-rejection partial partition is refused, not implemented.",
    },
    "QCT-120": {
        "overlay_status": "NOT_RUN",
        "coverage": "HUMAN_UAT",
        "bj": ["BJ13"],
        "notes": "Full client cycle UAT. Chromium 15/15 is not this case.",
    },
    "QCT-122": {
        "overlay_status": "NOT_RUN",
        "coverage": "PROCESS",
        "notes": "This overlay refuses to mark unrun original cases PASS. Handoff linter for the original package is not an ERP runner.",
    },
    "QCT-125": {
        "overlay_status": "NOT_RUN",
        "coverage": "OWNER_GATE",
        "rr": ["RR36"],
        "notes": "Release sign-off remains blocked without owner approval of verified build/schema/recovery.",
    },
    "QCT-119": {
        "overlay_status": "NOT_RUN",
        "coverage": "RELATED",
        "mapped_tests": ["isolated dump/restore rehearsal of hariom_nverify_salesdb"],
        "notes": "Isolated single-DB dump/restore is not plant-level quantity reconciliation of restored production data.",
    },
    "QCT-123": {
        "overlay_status": "PARTIAL",
        "coverage": "RELATED",
        "mapped_tests": ["docs/review/scripts/seven_db_restore_rehearsal.sh"],
        "notes": "Isolated 7-DB dump/restore into hariom_nverify_restore_* rowcount PASS; holds/outbox preserved. Not production backup and not interrupted cross-service operation replay.",
    },
    "REG-02": {
        "overlay_status": "NOT_RUN",
        "coverage": "RELATED",
        "notes": "Same as QCT-119. Isolated nverify dump is not migrated production data.",
    },
    "REG-03": {
        "overlay_status": "PARTIAL",
        "coverage": "RELATED",
        "mapped_tests": ["docs/review/scripts/seven_db_restore_rehearsal.sh"],
        "notes": "Same isolated 7-DB rehearsal as QCT-123. Not production-backup proof.",
    },
    "REG-04": {
        "overlay_status": "NOT_RUN",
        "coverage": "NONE",
        "notes": "Agreed realistic concurrency/browser workload against target AWS host NOT_RUN.",
    },
    "INC-01": {
        "overlay_status": "NOT_RUN",
        "coverage": "NONE",
        "notes": "Original ID-creation incident reproduction still required with recorded build/console/request.",
    },
    "NAV-01": {
        "overlay_status": "PARTIAL",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "production-service/tests/test_due_risk.py::DueRiskPredicateTests::test_plant_midnight_boundary_keeps_overdue_separate"
        ],
        "notes": "Asia/Kolkata midnight overdue vs today..+2 vs +3. Tile/list/report/export identity NOT_RUN.",
    },
    "NAV-02": {
        "overlay_status": "NOT_RUN",
        "coverage": "PARTIAL",
        "mapped_tests": ["apps/web-ui/e2e/release-gate.spec.cjs"],
        "bj": ["BJ03"],
        "notes": "Critical workspaces load. Stage-tile drill-down count identity NOT_RUN.",
    },
}


def main() -> None:
    req = json.loads((BASE / "REQUIREMENTS_V2.json").read_text())
    acc = json.loads((BASE / "ACCEPTANCE_TESTS_V2.json").read_text())
    tests_out = []
    status_counts: dict[str, int] = {}
    coverage_counts: dict[str, int] = {}
    for case in acc["tests"]:
        spec = dict(SPECIAL.get(case["id"], {}))
        overlay_status = spec.get("overlay_status", "NOT_RUN")
        coverage = spec.get("coverage", "NONE")
        row = {
            "id": case["id"],
            "title": case["scenario"],
            "phase": case["phase"],
            "requirements": case["requirements"],
            "release_blocking": case["release_blocking"],
            "origin": case["origin"],
            "original_status": case["status"],
            "overlay_status": overlay_status,
            "coverage": coverage,
            "mapped_tests": spec.get("mapped_tests", []),
            "rr": spec.get("rr", []),
            "bj": spec.get("bj", []),
            "limitation": spec.get("limitation"),
            "notes": spec.get("notes", "No executed test maps to this original procedure yet."),
        }
        tests_out.append(row)
        status_counts[overlay_status] = status_counts.get(overlay_status, 0) + 1
        coverage_counts[coverage] = coverage_counts.get(coverage, 0) + 1

    req_out = []
    for item in req["requirements"]:
        linked = [row for row in tests_out if item["id"] in row["requirements"]]
        linked_pass = [row["id"] for row in linked if row["overlay_status"] == "PASS"]
        limitations = sorted({row["limitation"] for row in linked if row.get("limitation")})
        if linked_pass and len(linked_pass) == len(linked):
            overlay = "PASS"
        elif linked_pass:
            overlay = "PARTIAL"
        elif any(row["coverage"] == "LIMITATION" for row in linked):
            overlay = "LIMITATION"
        elif any(row["coverage"] == "HUMAN_UAT" for row in linked):
            overlay = "NOT_RUN"
        else:
            overlay = "NOT_RUN"
        req_out.append(
            {
                "id": item["id"],
                "title": item["title"],
                "original_status": item["status"],
                "overlay_status": overlay,
                "acceptance_test_ids": item["acceptance_test_ids"],
                "linked_pass": linked_pass,
                "limitations": limitations,
            }
        )

    overlay = {
        "schema": "hariom-acceptance-overlay/v1",
        "source": "docs/review/baseline-v2/ACCEPTANCE_TESTS_V2.json",
        "rule": "Original documents are immutable. overlay_status is independent. CODE is not PASS. GROSS_ESTIMATE and PARTIAL_REJECTION_UNSUPPORTED stay limitations. Additive RR01-RR36 remain in RR_REGRESSION_CHECKLIST.md.",
        "counts": {
            "original_tests": len(tests_out),
            "original_requirements": len(req_out),
            "overlay_status": status_counts,
            "coverage": coverage_counts,
        },
        "tests": tests_out,
        "requirements": req_out,
    }
    (ROOT / "ACCEPTANCE_OVERLAY.json").write_text(json.dumps(overlay, indent=2) + "\n")
    print(json.dumps(overlay["counts"], indent=2))


if __name__ == "__main__":
    main()
