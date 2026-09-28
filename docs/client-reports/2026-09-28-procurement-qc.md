# Procurement, incoming QC and material control — 28 September 2026

Implementation uses Claude's existing checkout and branch `release/2026-09-25-paper-reel-po`, starting at `2b098e77e332416addf2b1ee89cd67d0d1fc2cdf`. Existing calendar, workbook import and UI architecture were retained. Deployment acceptance is recorded separately after cutover.

## Delivered workflow

- Employees create numbered, plant-scoped requisitions with material, native unit, date, quantity and reason. Owner decisions retain actor/time/history. An approved request converts once to a linked PO; tools/other purchases cannot bypass the request by selecting RM/PM. PO commercial approval also requires the actual Owner role.
- RM/PM POs use the material master's unit. Paper/parchment use KG; adhesive can use KG or L, with mandatory density for L. BOM/MRP and monthly reconciliation convert adhesive mass to litres consistently. Unit/density changes cannot silently reinterpret existing stock.
- Approved open PO lines support partial receipts and measured physical lots. Widths entered in cm convert to mm. Paper reels route to slitting; incoming coils and slit coil outputs route to production. Parchment is received as coils.
- Receipt labels support A4 eight-up sheets and 4-by-2-inch thermal stock, with saved identities/QR and reprint reasons. Bulk/batch labels show L, KG or PCS correctly. Manual receipt labels are also saved.
- Inward creates QC work due in 24 hours. The QC workspace shows pending and overdue work, inspection history, holds and material standards. Only actual QC users may submit incoming inspections; Store, Owner and acting-role shortcuts cannot impersonate QC.
- Material QC profiles retain revision, actor, time and parameter history. QC prepares tolerances; Owner/Admin approves standards. Each receipt freezes its governing approved profile. Existing governed concession/exemption workflows remain audited; they are not replaced with silent overrides.
- Reel issues/slitting/closure lock the relevant stock. Slitting balances coil outputs and waste. Production returns link to their original issue, cannot exceed outstanding quantity, and are retry-safe. Concurrent returns cannot duplicate stock credits.
- Reconciliation separates BOM expectation, net issues/returns and counted actual usage. Slitting transfers are excluded from production consumption; zero actual usage is preserved. Non-KG quantities are not added to KG totals. Missing source data returns an explicit error rather than a false zero report.

## Verification

| Check | Result |
| --- | --- |
| Inventory regression, PostgreSQL transaction and concurrency tests | 92 passed; 5 optional tests skipped |
| Production regression and reconciliation | 231 passed; 22 optional tests skipped |
| BFF regression and unit-aware material demand | 53 passed; 1 optional test skipped |
| Web test suite, schedule workbook/date-block and material schedule checks | Passed |
| Full Next production build, type checking and 132-page generation | Passed |
| Authenticated HTTP workflows using QC, Store, Owner and Operator in both isolated plants | 76 checks passed |
| Additive database migration replay | Passed |
| A4/thermal PDF rendering, pagination and text bounds | Passed |
| Bulk adhesive label PDF | Verified 10.0 L with batch QR |

The authenticated tests cover requisition approval and PO conversion, PO approval role denial, receipt creation, 24-hour QC metadata, invalid/valid QC readings, explicit passing reinspection release while preserving independent holds, pre-QC issue denial, slitting mass conservation, coil production issue/close and cross-plant denial. Test accounts and documents live only in independent local acceptance databases. No fake commercial orders were posted to production.

## Operations and remaining acceptance boundaries

Live read-only preflight confirmed two active accounts already have QC. The dedicated `QC` role is assignable through Users, with its own landing workspace and plant scope. Role controls were tested with dedicated QC accounts in both local plants. Production staff assignment must use the real QC employees' accounts; local test identities are not production users.

Print PDFs at actual size. PDF/browser verification does not prove physical printer alignment or handheld scanner performance; print and scan one A4 sheet and one thermal label at the plant before bulk printing. Monthly count correctness still depends on entered physical counts, approved master data and the final month's books; automated tests cannot certify a future physical inventory count.

Release procedure verifies the expected live commit under a deployment lock, builds before cutover, backs up databases, rejects unresolved legacy reel routing, applies an additive migration, checks internal/public health and login, performs a restore drill, and retains the previous image/source for rollback.
