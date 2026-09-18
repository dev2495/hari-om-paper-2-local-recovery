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
        "overlay_status": "NOT_RUN",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "sales-service/tests/test_live_postgres_rr.py::test_schedule_100_with_existing_40_appends_60",
            "sales-service/tests/test_pending_and_schedules.py::test_schedule_entire_po_appends_remaining_without_replacing_committed",
        ],
        "rr": ["RR08"],
        "notes": "Single-line 100/40/60 append proven. Three-line multi-date whole-PO UI NOT_RUN.",
    },
    "PLAN-03": {
        "overlay_status": "NOT_RUN",
        "coverage": "PARTIAL",
        "mapped_tests": [
            "sales-service/tests/test_live_postgres_rr.py::test_overlapping_schedule_commits_reject_stale_revision"
        ],
        "rr": ["RR13", "RR14"],
        "notes": "Two overlapping schedule commits: one 200, one 409. Calendar planner UI NOT_RUN.",
    },
    "COMM-02": {
        "overlay_status": "NOT_RUN",
        "coverage": "UNIT_ONLY",
        "mapped_tests": [
            "sales-service/tests/test_sales_commercial.py::test_delivery_date_must_be_strictly_later_than_customer_po_date",
            "sales-service/tests/test_live_postgres_rr.py::test_equal_or_earlier_delivery_date_is_rejected",
        ],
        "rr": ["RR09"],
        "notes": "Helper plus live schedule commit/patch reject equal/earlier dates. Full UI+API+import matrix remains CODE/NOT_RUN until all paths are listed.",
    },
    "COMM-03": {
        "overlay_status": "NOT_RUN",
        "coverage": "UNIT_ONLY",
        "mapped_tests": [
            "sales-service/tests/test_sales_commercial.py::test_delivery_date_must_be_strictly_later_than_customer_po_date"
        ],
        "rr": ["RR09"],
        "notes": "Header edit reloads stored schedules in update_sales_order. Draft multi-row invalidation UI NOT_RUN.",
    },
    "COMM-06": {
        "overlay_status": "NOT_RUN",
        "coverage": "UNIT_ONLY",
        "mapped_tests": [
            "sales-service/tests/test_sales_logic.py::test_sales_line_serializer_round_trips_required_parchment"
        ],
        "notes": "Serializer round-trip. Release/BOM/print path NOT_RUN as this original case.",
    },
    "COMM-07": {
        "overlay_status": "NOT_RUN",
        "coverage": "UNIT_ONLY",
        "mapped_tests": [
            "sales-service/tests/test_sales_logic.py::test_sales_line_serializer_hides_stale_parchment_color_when_not_required"
        ],
        "notes": "Stale color hidden when unchecked. Full reload/edit UI NOT_RUN.",
    },
    "COMM-10": {
        "overlay_status": "NOT_RUN",
        "coverage": "PARTIAL",
        "mapped_tests": ["apps/web-ui/e2e/release-gate.spec.cjs", "apps/web-ui/__tests__/sales-order-entry.test.ts"],
        "bj": ["BJ04", "BJ08"],
        "notes": "Sales workspace operable in Chromium. Explicit hero/readiness/banner absence assertions NOT_RUN.",
    },
    "COMM-11": {
        "overlay_status": "NOT_RUN",
        "coverage": "UNIT_ONLY",
        "mapped_tests": ["sales-service/tests/test_sales_logic.py::test_order_number_counter_jumps_past_preexisting_max"],
        "notes": "Counter jumps past preexisting max. Many concurrent creates with realistic DB settings NOT_RUN.",
    },
    "REL-01": {
        "overlay_status": "NOT_RUN",
        "coverage": "PARTIAL",
        "mapped_tests": ["apps/web-ui/e2e/release-gate.spec.cjs"],
        "bj": ["BJ04", "BJ05"],
        "notes": "Chromium sales release to winder queue succeeded. Mandrel-mismatch admission fixture NOT_RUN.",
    },
    "REL-08": {
        "overlay_status": "NOT_RUN",
        "coverage": "RELATED",
        "mapped_tests": [
            "production-service/tests/test_dispatch_idempotency.py::test_same_request_id_with_different_hash_is_conflict"
        ],
        "notes": "Dispatch idempotency mismatch proven. Release-key mismatch NOT_RUN.",
    },
    "QCT-001": {
        "overlay_status": "NOT_RUN",
        "coverage": "UNIT_ONLY",
        "mapped_tests": [
            "production-service/tests/test_quality_eval.py::test_winder_in_range_is_pass",
            "production-service/tests/test_quality_eval.py::test_winder_out_of_range_fail_requires_reason",
        ],
        "rr": ["RR19"],
        "notes": "In-range/out-of-range evaluator. Inclusive/exclusive endpoint matrix NOT_RUN.",
    },
    "QCT-005": {
        "overlay_status": "NOT_RUN",
        "coverage": "UNIT_ONLY",
        "mapped_tests": ["spec-service/tests/test_qc_profile.py::test_inverted_and_malformed_bounds_are_rejected"],
        "rr": ["RR19"],
        "notes": "Inverted/malformed bounds rejected on normalize. Full approve-path denial NOT_RUN.",
    },
    "QCT-006": {
        "overlay_status": "NOT_RUN",
        "coverage": "UNIT_ONLY",
        "mapped_tests": ["production-service/tests/test_quality_eval.py::test_blank_and_invalid_never_pass"],
        "rr": ["RR07"],
        "notes": "Blank/invalid never PASS in evaluator. Every adapter path NOT_RUN.",
    },
    "QCT-007": {
        "overlay_status": "NOT_RUN",
        "coverage": "UNIT_ONLY",
        "mapped_tests": [
            "production-service/tests/test_quality_eval.py::test_blank_and_invalid_never_pass",
            "apps/web-ui/__tests__/qc-measurement.test.ts",
        ],
        "rr": ["RR07"],
        "notes": "Whitespace is missing, not zero, in collector/evaluator. Full request-pair matrix NOT_RUN.",
    },
    "QCT-009": {
        "overlay_status": "NOT_RUN",
        "coverage": "UNIT_ONLY",
        "mapped_tests": ["production-service/tests/test_quality_eval.py::test_categorical_fail_uses_approved_outcomes"],
        "rr": ["RR20"],
        "notes": "Categorical FAIL vs approved options. Boolean/unknown-option matrix NOT_RUN.",
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
        "overlay_status": "NOT_RUN",
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
        "overlay_status": "NOT_RUN",
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
        "overlay_status": "NOT_RUN",
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
        "overlay_status": "NOT_RUN",
        "coverage": "RELATED",
        "mapped_tests": ["isolated dump/restore rehearsal of hariom_nverify_salesdb"],
        "notes": "Cross-service pending holds/outbox/barrier recovery NOT_RUN.",
    },
    "REG-02": {
        "overlay_status": "NOT_RUN",
        "coverage": "RELATED",
        "notes": "Same as QCT-119. Isolated nverify dump is not migrated production data.",
    },
    "REG-03": {
        "overlay_status": "NOT_RUN",
        "coverage": "RELATED",
        "notes": "Same as QCT-123.",
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
        "overlay_status": "NOT_RUN",
        "coverage": "NONE",
        "notes": "Three-day priority predicate across tile/list/report/export NOT_RUN.",
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
