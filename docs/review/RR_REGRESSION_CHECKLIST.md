# RR regression checklist (correction pass)

Branch: `cursor/ui-polish-nav-c5f9`  
Audited base: `30263a4ef6592c7bf6e672ca3c2a9b411f39f63f`  
Local candidate: QCT-063 durable multi-field FAIL replay; served UI BUILD_ID `EYFrs5GhOyHNGtioE2__r`; overlay parent `886abd3` PASS 95  
Original 192 V2 cases: restored at `docs/review/baseline-v2/`, overlay in `ACCEPTANCE_OVERLAY.json`. These RR rows stay additive.

Legend: `PASS` = automated proof in this pass. `CODE` = implemented and unit-covered, live DB/UI not exercised. `NOT_RUN` = remaining gate. `STALE` = prior proof no longer binds to current source.

| ID | Finding | Status | Proof |
| --- | --- | --- | --- |
| RR01 | Partial concession keeps residual lot + independent hold | PASS | inventory live `test_live_postgres_rr.py` |
| RR02 | Zero / negative / excess / unspecified concession qty rejected | PASS | live `test_zero_unspecified_and_excess_concession_rejected`; unit `test_rr02_zero_negative_excess_unspecified_rejected` |
| RR03 | Concurrent concession cannot double-release | PASS | two-thread live workers: one ok, one 400; residual 400 on hold |
| RR04 | Client `create_hold_on_fail=false` cannot suppress hold | PASS | production live + typed validator suite |
| RR05 | FAIL without reason persists; final submit still blocked | PASS | inventory live `test_fail_without_reason_persists_pending` |
| RR06 | Collector keeps every winding sample | PASS | production quality_eval tests |
| RR07 | Whitespace is missing; kg not copied into g | PASS | production quality tests + BJ12 print |
| RR08 | Schedule-entire-PO appends remainder; does not replace committed | PASS | sales live `test_schedule_100_with_existing_40_appends_60` |
| RR09 | Delivery date required and revalidated vs customer PO date | PASS | live `test_equal_or_earlier_delivery_date_is_rejected`; unit `test_header_date_change_revalidates_every_line` |
| RR10 | Unscheduled fulfillment counts against remaining-to-schedule | PASS | `test_fulfilled_40_caps_new_commitment_at_60` |
| RR11 | Patch cannot fake delivered | PASS | `test_patch_cannot_fake_delivered` |
| RR12 | Allocations cannot exceed parents or duplicate pairs / cross lines | CODE | `validate_schedule_to_release_allocations` unit tests; not in the 4 live sales tests |
| RR13 | Overlapping schedule commits | PASS | `test_overlapping_schedule_commits_reject_stale_revision` two threads, one 409 |
| RR14 | Stale schedule preview rejected | PASS | same overlapping 409 / revision proof |
| RR15 | Incoming profile pinned at receipt; later master not retroactive | PASS | `test_receipt_pin_survives_later_master_edit` |
| RR16 | Store/QC JSON cannot self-approve | PASS | live QCT-019/020: setup_status exemption/approved is 403; Owner/Admin dedicated approve |
| RR17 | Approved edit opens new draft and keeps snapshot | CODE | unit profile tests |
| RR18 | Approve requires matching revision + Owner/Admin | CODE | spec approve unit tests |
| RR19 | Inverted / malformed bounds rejected | PASS | spec `test_qc_profile.py` plus original QCT-005 related units |
| RR20 | Categorical FAIL vs approved options; oven PRE-only; pair mismatch | PASS | `test_original_qct_evaluator.py` QCT-009 + production `test_quality_eval.py` + live `test_original_qct048_live.py` PRE then later POST same pair / orphan POST + pair mismatch |
| RR21 | Independent holds survive another inspection's concession | PASS | inventory live |
| RR22 | Measured FAIL is never rewritten to PASS | PASS | inventory live fail-without-reason stays FAIL |
| RR23 | Customer-rejection partial partition refused | CODE | `PARTIAL_REJECTION_UNSUPPORTED` — not a completed feature |
| RR24 | Demand coverage is GROSS_ESTIMATE, not OK/net buy | PASS | analytics demand coverage tests; limitation remains GROSS_ESTIMATE |
| RR25 | UOM mismatch is UNKNOWN, not coverage | PASS | analytics tests |
| RR26 | QC-held PO / stock is not usable coverage of earlier need | PASS | analytics tests |
| RR27 | Customer delivery / production / supplier calendars stay separate | CODE | policy text; live production-calendar UI **NOT_RUN** |
| RR28 | Job-card export pages beyond 500 | PASS | production live `test_export_includes_more_than_500_job_cards` |
| RR29 | Plant-scoped notifications; no all-plant Admin/Owner bypass | PASS | auth live + `test_notification_plant_scope.py` (9 passed) |
| RR30 | Plantless event does not leak to explicit users | PASS | auth live |
| RR31 | Notification create does not crash on plantless QC event | PASS | auth live plantless path |
| RR32 | Spec QC dialog keeps product context, dialog role, Escape | PASS | BJ11 keyboard/Escape on Add Tool; QCT-029–056 Chromium including correction audit on BUILD_ID `Jsi64h520Xs_8mFfUP9Qr`. |
| RR33 | Job-card print/actuals: samples in quality_checks; kg separate from g | PASS | BJ12 plus QCT-046 three-page writable paired-oven print, QCT-047 signed freeze, QCT-048/049 Chromium PRE/POST pair timing, QCT-050 complete-card hidden-stage issues, and QCT-051 all-entry adapters |
| RR34 | Shared evaluator import from packaged `shared/` | STALE | evaluator copies remain byte-identical after POST-due timing (`056334c91c50725c954dae43019860cf`); `faee2ab` images not rebuilt |
| RR35 | Service artifact boots with packaged evaluator | STALE | `hariom-nverify-inv-rr35` / `hariom-nverify-prod-rr35` not rebuilt after evaluator or this-cycle source change |
| RR36 | Main-targeted PR + original 192-case mapping | NOT_RUN | Owner-gated. This pass does not merge, retarget, or deploy |

## Original 192 V2 suite

Definitions restored under `docs/review/baseline-v2/`. Overlay: PASS 90, PARTIAL 21, LIMITATION 3, NOT_RUN 78. Additive RR tests above do not replace the pack. See `docs/review/V2_PACK_PROVENANCE.md` and `docs/review/ACCEPTANCE_OVERLAY.json`.
