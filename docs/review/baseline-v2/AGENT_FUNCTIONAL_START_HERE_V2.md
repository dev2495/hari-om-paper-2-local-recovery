# Hari Om ERP — agent start here · V2

**Controlling handoff:** `HARI_OM_FUNCTIONAL_AUDIT_AND_PLAN_V2.md` plus `QUALITY_CONTROL_BLUEPRINT.md`. Version 2 supersedes the old QC phase, not the other original requirements. Archive under `baseline/` is evidence only.

## Current state

No implementation is complete. Reviewed main: `44cf9950850f70de040f6d09d51dcf22495ce8d3`. Actual deployment/local branch/schema still need P00 verification. This package contains 56 requirements, 192 NOT_RUN acceptance cases and fourteen phase briefs. It does not authorize deployment and does not claim application tests passed.

## Start every session here

Read `AGENT_STATE.json`, `PHASE_TRACKER.json`, the active `phases/Pxx_*.md`, applicable `REQUIREMENTS_V2.json` and `ACCEPTANCE_TESTS_V2.json`, and `DECISIONS_REQUIRED.md`. Check actual branch/HEAD/dirty files before editing. Read the complete integrated plan once before implementation; each later session reads the relevant contracts and unchanged invariants. Work on one bounded task or an explicitly coordinated parallel task; do not scaffold a new app/service.

## Sequence

P00 baseline → P01 correctness → P02 versioned contracts/QC access → P03 item/inward → P04 spec dialog/list actions → P05 job input/print → P06 dispositions/stock gates → P07 notifications → P08 reports/returns/CAPA → P09 original commercial → P10 original queue-only release → P11 original demand/three calendars → P12 migration/pilot/UAT → P13 release evidence.

Do not postpone backend protections until the end of a UI build. P01 includes the original non-destructive release replay, quantity locking and numbering fixes as well as production/incoming QC verdict repair.

## Binding invariants

1. One business Quality module and shared typed evaluator; existing service/stock owners remain authoritative. Never trust supplied PASS/failure/stock-status fields.
2. Preserve the exact client stage names/fields and obtain approved units, methods, specimen, sampling and limits. No invented production thresholds, default zero, uniform ± percentage or copied final-to-winding limits.
3. Reasons never create PASS. Save genuine failed observations; final submission requires linked reasons/containment. Concession is a separate scoped approval and remains measured FAIL.
4. Record physical inward and output even when restricted; do not hide actuals. A partial release must not unlock the whole lot. Current stock-owner barriers/epochs—not eventual dashboards—govern physical movement.
5. Approved snapshots and signed readings are immutable. Use explicit revisions, corrections, retest rounds and controlled unstarted attachments. Ordinary release replay is a no-op.
6. Sales admission asks only which authorized same-plant winder queue; no mandrel/geometry/capacity veto or mandatory new-QC-setup veto. Approved actual execution/FG/dispatch controls remain.
7. Keep every original R01–R20 and their 66 tests. Do not replace manufacturing calculations, duplicate MRP quantities, collapse the three calendars or reset historical data.
8. QC is a canonical scoped role; no hidden Owner/Admin grants. Notifications, reports, exports, attachments and deep links recheck resource/plant access.
9. No notification acknowledgement, due-date edit, case/CAPA closure, UI feature flag or old direct endpoint may silently clear a stock hold.
10. No merge, production mutation or deployment without the normal owner approval process.

## End every session with durable evidence

Update `AGENT_STATE.json` with actual HEAD, active phase/task, changed application files, migrations, tests and the exact next action. Update task/test status only from real work. Create `evidence/Pxx_SESSION_<id>.md` from `PHASE_EVIDENCE_TEMPLATE.md`. Record blocked decisions, risks and rollback/forward-fix. Never mark a phase COMPLETE with unrun/failed assigned release tests, missing evidence or reviewer sign-off. Record static/report-render checks separately from application acceptance.

Run `python validate_handoff.py` to check package/task-reference consistency. This is NOT an ERP test runner. The original reproduction script under `baseline/` intentionally demonstrates old unsafe helper behavior and must never be used as a production validator.

The next task is **P00-T01**: establish actual source/deployment/schema baseline without modifying production.
