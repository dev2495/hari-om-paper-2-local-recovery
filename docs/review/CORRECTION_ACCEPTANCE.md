# Correction acceptance (owner)

This pass completes the audited C1–C7 code patches on `cursor/ui-polish-nav-c5f9` and records C8 evidence.

## Accept as correction-complete when

- [x] C1 QC containment, samples, units, hold policy are in source
- [x] C2 schedule append / dates / lock / allocations are in source
- [x] C3 immutable QC profile revisions + receipt pin are in source
- [x] C4–C6 cases/holds, residual demand, reports/notifications are in source
- [x] C7 spec dialog, job-card samples/print, remaining PageHeader shells are in source
- [x] Additive RR unit tests exist and the listed commands passed
- [x] Completion report is in git and does not claim V2 go-live

## Still owner-gated (do not treat as V2 done)

- [x] Live overlapping Postgres proof (RR03, RR13 two-thread isolated `hariom_nverify_*`)
- [x] Playwright / browser UAT against a running isolated stack (Chromium 15/15; Safari BJ13 still NOT_RUN)
- [x] Docker artifact boot with packaged `shared/hariom_quality_eval.py`
- [ ] Named original 192 V2 suite (definitions restored; overlay PASS only QCT-027 and QCT-052; 190 remain NOT_RUN)
- [ ] Main-targeted PR, merge, production mutate, deploy

Do not merge this branch to `main` without owner approval.
