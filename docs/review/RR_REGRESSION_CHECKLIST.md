# RR regression checklist (correction pass)

Branch: `cursor/ui-polish-nav-c5f9`  
Audited base: `30263a4ef6592c7bf6e672ca3c2a9b411f39f63f`  
Local candidate: `5dd8b9b35ba647fe06fac2758609886bb4bf8e67`  
Original 192 V2 cases: **not replaced**. These RR rows are additive.

Legend: `PASS` = automated proof in this pass. `CODE` = implemented and unit-covered, live DB/UI not exercised. `NOT_RUN` = remaining gate.

| ID | Finding | Status | Proof |
| --- | --- | --- | --- |
| RR01 | Partial concession keeps residual lot + independent hold | PASS | inventory live `test_live_postgres_rr.py` |
| RR02 | Zero / negative / excess / unspecified concession qty rejected | PASS | inventory live |
| RR03 | Concurrent concession cannot double-release | PASS | two-thread live workers: one ok, one 400; residual 400 on hold |
| RR04 | Client `create_hold_on_fail=false` cannot suppress hold | PASS | production live + typed validator suite (61 passed) |
| RR05 | FAIL without reason persists; final submit still blocked | PASS | inventory live `test_fail_without_reason_persists_pending` |
| RR06 | Collector keeps every winding sample | PASS | production quality_eval tests |
| RR07 | Whitespace is missing; kg not copied into g | PASS | production quality tests + BJ12 print |
| RR08 | Schedule-entire-PO appends remainder; does not replace committed | PASS | sales live `test_schedule_100_with_existing_40_appends_60` |
| RR09 | Delivery date required and revalidated vs customer PO date | CODE | merge rejects missing date; live UI date proof is the Chromium PO-date fill, not a dedicated sales live test |
| RR10 | Unscheduled fulfillment counts against remaining-to-schedule | PASS | `test_fulfilled_40_caps_new_commitment_at_60` |
| RR11 | Patch cannot fake delivered | PASS | `test_patch_cannot_fake_delivered` |
| RR12 | Allocations cannot exceed parents or duplicate pairs / cross lines | CODE | `validate_schedule_to_release_allocations` unit tests; not in the 4 live sales tests |
| RR13 | Overlapping schedule commits | PASS | `test_overlapping_schedule_commits_reject_stale_revision` two threads, one 409 |
| RR14 | Stale schedule preview rejected | PASS | same overlapping 409 / revision proof |
| RR15 | Incoming profile pinned at receipt; later master not retroactive | PASS | `test_receipt_pin_survives_later_master_edit` |
| RR16 | Store/QC JSON cannot self-approve | CODE | unit profile tests |
| RR17 | Approved edit opens new draft and keeps snapshot | CODE | unit profile tests |
| RR18 | Approve requires matching revision + Owner/Admin | CODE | spec approve unit tests |
| RR19 | Inverted / malformed bounds rejected | CODE | spec + eval unit tests |
| RR20 | Categorical FAIL vs approved options; oven PRE-only; pair mismatch | PASS | production `test_quality_eval.py` in the 61 |
| RR21 | Independent holds survive another inspection's concession | PASS | inventory live |
| RR22 | Measured FAIL is never rewritten to PASS | PASS | inventory live fail-without-reason stays FAIL |
| RR23 | Customer-rejection partial partition refused | CODE | `PARTIAL_REJECTION_UNSUPPORTED` — not a completed feature |
| RR24 | Demand coverage is GROSS_ESTIMATE, not OK/net buy | PASS | analytics demand coverage tests; limitation remains GROSS_ESTIMATE |
| RR25 | UOM mismatch is UNKNOWN, not coverage | PASS | analytics tests |
| RR26 | QC-held PO / stock is not usable coverage of earlier need | PASS | analytics tests |
| RR27 | Customer delivery / production / supplier calendars stay separate | CODE | policy text; live production-calendar UI **NOT_RUN** |
| RR28 | Job-card export pages beyond 500 | CODE | export loops `page_size = 500`. Live 501+ export **NOT_RUN** |
| RR29 | Plant-scoped notifications; no all-plant Admin/Owner bypass | PASS | auth live + `test_notification_plant_scope.py` (9 passed) |
| RR30 | Plantless event does not leak to explicit users | PASS | auth live |
| RR31 | Notification create does not crash on plantless QC event | PASS | auth live plantless path |
| RR32 | Spec QC dialog keeps product context, dialog role, Escape | PASS | BJ11 |
| RR33 | Job-card print/actuals: samples in quality_checks; kg separate from g | PASS | BJ12 |
| RR34 | Shared evaluator import from packaged `shared/` | PASS | Docker module file `/app/shared/hariom_quality_eval.py`, mounts `[]` |
| RR35 | Service artifact boots with packaged evaluator | PASS | `hariom-nverify-inv-rr35` / `hariom-nverify-prod-rr35` health + `evaluate_parameter` PASS |
| RR36 | Main-targeted PR + original 192-case mapping | NOT_RUN | Owner-gated. This pass does not merge, retarget, or deploy |

## Original 192 V2 suite

Not executed as a named pack. See `docs/review/V2_PACK_PROVENANCE.md`. Additive RR tests above do not replace it.
