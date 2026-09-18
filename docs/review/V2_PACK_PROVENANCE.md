# Original 56-requirement and 192-case pack — provenance

**Versioned location:** `docs/review/baseline-v2/`  
**Overlay (current evidence, not the original statuses):** `docs/review/ACCEPTANCE_OVERLAY.json`  
**Additive RR01–RR36:** `docs/review/RR_REGRESSION_CHECKLIST.md`  
**Additive BJ01–BJ13:** `docs/review/BROWSER_JOURNEYS.json`  
**Checkpoint SHA this update:** recorded at local HEAD after this documentation commit.

## What was restored

Recovered on 18 September 2026 from `/Users/devarshthakkar/Downloads/HARI_OM_ORIGINAL_V2_ACCEPTANCE_RECOVERED.zip`.

| Item | Value |
| --- | --- |
| Zip SHA-256 | `8f938c136e9a107b0052c935245986e0c426bc0060a513c2d14efaa9119e896d` (125739 bytes) |
| Nested source archive | `HARI_OM_FUNCTIONAL_AUDIT_PACKAGE_V2.zip` SHA-256 `815a497809cb36d285d7bae88b3909843c9e0ca273bb913957bd7d09479f41b6` |
| Requirements | **56** unique IDs (`R01–R20`, `QCR-01–QCR-36`) |
| Acceptance cases | **192** unique IDs (66 baseline + 126 quality expansion) |
| Original statuses | Unchanged: requirements `NOT_STARTED`, tests `NOT_RUN` |
| Byte-for-byte vs original manifest | **True** for the seven recovered original documents (`RECOVERY_VERIFICATION.json`) |

Tracked originals (do not edit statuses in these files):

- `docs/review/baseline-v2/REQUIREMENTS_V2.json` SHA-256 `3eb90b471ba5e325f90d4075b90d9dd2a87b717b175c475e8018fe8991d7d29b`
- `docs/review/baseline-v2/REQUIREMENTS_V2.md` SHA-256 `cda6fd20c300a602bda633b0856b198a15fc345004e8f99fb90cbaaaf92478e5`
- `docs/review/baseline-v2/ACCEPTANCE_TESTS_V2.json` SHA-256 `a1aa721fc761c53803adb53043d5e258c4865d5e1267752ff7d672cefa9320ed`
- `docs/review/baseline-v2/ACCEPTANCE_TESTS_V2.md` SHA-256 `53fcceae902a5310c9ac913fdf57dac846fa9123bc08809d89935eeb9570c14f`
- `docs/review/baseline-v2/HARI_OM_FUNCTIONAL_AUDIT_AND_PLAN_V2.md`
- `docs/review/baseline-v2/QUALITY_CONTROL_BLUEPRINT.md`
- `docs/review/baseline-v2/AGENT_FUNCTIONAL_START_HERE_V2.md`
- `docs/review/baseline-v2/ORIGINAL_SHA256_MANIFEST.json`
- `docs/review/baseline-v2/RECOVERY_VERIFICATION.json`
- `docs/review/baseline-v2/READ_ME_FIRST.md`

`.gitignore` still excludes `hariom-erp/Hariom_ERP_Final_Requirements_and_Plan.md` (a different missing file, not this V2 pack). The recovered pack is tracked under `docs/review/baseline-v2/`. No force-add of `.env`, databases, passwords, or traces.

## Mapping rule

The original JSON/MD files are definitions, not an executable runner and not a fresh verdict. Current results live only in `ACCEPTANCE_OVERLAY.json` and the RR/BJ registers. Additive RR/BJ rows do not replace the 192. `CODE` is not `PASS`. `GROSS_ESTIMATE` and `PARTIAL_REJECTION_UNSUPPORTED` stay limitations. Titles were copied from the originals, not invented.
