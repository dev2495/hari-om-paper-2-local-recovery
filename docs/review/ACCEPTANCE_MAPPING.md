# Acceptance mapping — N5

**Checkpoint SHA:** `74f5b45300ce1f121b5efd89f319b0d4e1027b33` (dirty worktree on top; see `REVIEW_AGENT_STATE.md`)  
**Rule:** statuses are `NOT_RUN`, `BLOCKED`, `FAIL`, `PASS`, `APPROVED_NOT_APPLICABLE` only. `CODE` is an author-reported implementation label, not a release gate.

## Honest limitations (not completed features)

| Label | Meaning |
| --- | --- |
| GROSS_ESTIMATE | Demand coverage is an estimate, not residual WIP/issued/FG/time-phased purchasing |
| PARTIAL_REJECTION_UNSUPPORTED | Customer-rejection partial partition is refused, not implemented |
| Calendar docstring | Customer/production/supplier calendars stay separate in policy text; production/supplier calendars are not a working UI |
| Recipient helper | Plant-scoped recipient selection is not full event/assignment/escalation/retry delivery |

## Original 192 V2 scenarios

No executable 192-case runner exists in this repository. Status: **NOT_RUN**.

Hari Om requirements source `hariom-erp/Hariom_ERP_Final_Requirements_and_Plan.md` is gitignored and was not present. The 56-requirement list is **NOT_RUN**.

## RR01–RR36 rerun (isolated `hariom_nverify_*`, `HARI_OM_LIVE_PG=1`)

| ID | Rerun | Evidence |
| --- | --- | --- |
| RR01–RR03, RR15, RR21–RR22 | PASS | inventory live + affected QC tests: **29 passed** |
| RR04–RR07, RR28 | PASS | production live + typed-validator + planning + quality: **74 passed** (includes 501+ export) |
| RR08–RR14 | PASS | sales live overlapping/revision/conservation: **31 passed** after `populate_existing` lock |
| RR16–RR20, RR24–RR26 | CODE | author unit proofs; production typed-validator included in the 74 |
| RR23 | FAIL as limitation | `PARTIAL_REJECTION_UNSUPPORTED` |
| RR27 | CODE | calendars remain policy text |
| RR29–RR31 | PASS | auth live two-plant notifications: **14 passed, 1 skipped** |
| RR32–RR33 | PARTIAL | Chromium job-card print and keyboard/modal **PASS**; spec QC mandrel options still FAIL |
| RR34 | CODE | packaged `shared/` evaluator copies |
| RR35 | BLOCKED | Docker daemon not running; no image boot |
| RR36 | NOT_RUN | no PR retarget / main merge |

## Browser journeys (Chromium `PLAYWRIGHT_CHROME_CHANNEL=chrome`, `http://127.0.0.1:23000`)

Rerun: **6 passed, 9 failed** (20.9m). Artifacts: `output/playwright/74f5b45300ce1f121b5efd89f319b0d4e1027b33-rerun/`. Job-card print: `reports/job-card-print.png`.

PASS: BJ11 keyboard/modal, BJ12 job-card print, BJ01 login/guides, BJ03 all workspaces, tooling master, supervisor tools.  
FAIL: BJ10 reconciliation actuals, BJ02 owner-pack leftover copy, BJ04 sales customers empty, BJ05 Plant II specs empty, BJ06 store_b 403-on-logout, BJ08 premium sales timeout, BJ07 spec mandrel options, 15% mandrel 125.55 missing.

## Human UAT

Safari / dual theme: **NOT_RUN** (BJ13).
