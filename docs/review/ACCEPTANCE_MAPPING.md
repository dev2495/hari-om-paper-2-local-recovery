# Acceptance mapping — N5

**Checkpoint SHA:** `5dd8b9b35ba647fe06fac2758609886bb4bf8e67` (local; remote PR10 still `74f5b45300ce1f121b5efd89f319b0d4e1027b33`)  
**Served Next:** BUILD_ID `Yz4l4-NEecxcN4k1Xtf_H` from product SHA `d071d122ae8725431195804cc33779c4ff1e75a6`  
**Rule:** statuses are `NOT_RUN`, `BLOCKED`, `FAIL`, `PASS`, `APPROVED_NOT_APPLICABLE` only. `CODE` is an author-reported implementation label, not a release gate.

## Honest limitations (not completed features)

| Label | Meaning |
| --- | --- |
| GROSS_ESTIMATE | Demand coverage is an estimate, not residual WIP/issued/FG/time-phased purchasing |
| PARTIAL_REJECTION_UNSUPPORTED | Customer-rejection partial partition is refused, not implemented |
| Calendar docstring | Customer/production/supplier calendars stay separate in policy text; production/supplier calendars are not a working UI |
| Recipient helper | Plant-scoped recipient selection is not full event/assignment/escalation/retry delivery |

## Original 192 V2 scenarios and 56 requirements

See `docs/review/V2_PACK_PROVENANCE.md`. Named 56/192 lists are **NOT_RUN**. Source file gitignored and never in git history. Titles are not invented. Additive RR/BJ rows do not replace the pack.

## RR01–RR36 rerun (isolated `hariom_nverify_*`, `HARI_OM_LIVE_PG=1`)

| ID | Rerun | Evidence |
| --- | --- | --- |
| RR01–RR03, RR15, RR21–RR22 | PASS | inventory live + QC: **17 passed** including overlapping concession workers |
| RR04–RR07 | PASS | production live + typed-validator + planning + quality_eval/pass_rate: **61 passed** |
| RR08, RR10–RR11, RR13–RR14 | PASS | sales live: **4 passed** including two-thread stale revision 409 |
| RR09, RR12 | CODE | date revalidation and allocation unit proofs; not in the 4 live sales tests |
| RR16–RR20 | CODE | spec/QC profile unit proofs; not re-claimed as a new live pack |
| RR23 | FAIL as limitation | `PARTIAL_REJECTION_UNSUPPORTED` |
| RR24–RR26 | PASS | analytics `test_demand_coverage.py` + deep_cuts: **8 passed**; GROSS_ESTIMATE remains the coverage meaning |
| RR27 | CODE | calendars remain policy text |
| RR28 | CODE | job-card export pager; live 501+ export **NOT_RUN** |
| RR29–RR31 | PASS | auth live + notifications: **9 passed**; plantless crash probe covered by live recipient isolation |
| RR32–RR33 | PASS | Chromium BJ11/BJ12 |
| RR34–RR35 | PASS | Docker images `hariom-nverify-inventory:faee2ab` / `hariom-nverify-production:faee2ab`, mounts `[]`, evaluator `/app/shared/hariom_quality_eval.py` |
| RR36 | NOT_RUN | no PR retarget / main merge / deploy |

## Browser journeys (Chromium `PLAYWRIGHT_CHROME_CHANNEL=chrome`, `http://127.0.0.1:23000`)

Rerun: **15 passed, 0 failed** (1.3m). Artifacts: `output/playwright/5dd8b9b35ba647fe06fac2758609886bb4bf8e67-full/`. Print: `reports/job-card-print.png`.

BJ01–BJ12 PASS. BJ13 Safari/dual theme: **NOT_RUN**.

## Human UAT

Safari / dual theme: **NOT_RUN** (BJ13).
