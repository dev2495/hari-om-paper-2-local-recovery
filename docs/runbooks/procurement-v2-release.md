# Procurement V2 release runbook

Prepared 15 September 2026 for the purchase scheduling, PO approval, paper inward, discrepancy, debit-note, stock-policy and RM-costing release.

## Release boundary

This runbook is the controlled path from the reviewed source candidate to staging and then production. Preparing and validating the candidate did **not** deploy code, migrate the live database, activate live number series, post stock, create a real PO, or send a vendor document.

The database migration is additive. Once new procurement transactions exist, rollback means disabling new writes and returning the application to a compatible read-only state while fixing forward. Do not drop the new tables or restore an old backup over later business activity.

## Client configuration record

Record these decisions in the release ticket before enabling writes. Do not infer them during deployment.

| Setting | Candidate default | Required release decision |
|---|---|---|
| RM/PM series | `RP-PM/01` | Confirm spelling, legal-entity/plant scope, reset period and opening counter. |
| Other series | `OT/01` | Confirm scope, reset period and opening counter. |
| Paper base unit | kg | Confirm source-unit factor for each imported workbook section. |
| Physical identity | One AT/Amigo identity per reel or coil | Confirm AT/AIT prefix and continuity with existing labels. |
| Width suggestion | 50–150 mm inclusive suggests coil/slitted | Confirm boundary and effective rule; PO width tolerance remains an independent specification check. |
| Vendor invoice namespace | Supplier + plant + normalized invoice number | Confirm fiscal-period reuse policy. |
| Vendor reel namespace | Supplier-scoped source reel reference | Confirm whether mills recycle numbers by year or batch. |
| Rate comparison | Zero tolerance after same-basis normalization | Confirm freight, tax, discount, currency and price-UOM basis. |
| Commercial stock release | Hold differences until checker action | Confirm who may release stock while a claim remains open. |
| PO/checker roles | Store/Planner maker; PlantManager checker | Map real users and value limits. |
| Debit note | ERP commercial claim document | Confirm tax document/accounting integration, signatory and number series. |
| Stock policies | Per material, versioned, maker/checker | Confirm thresholds, recipients, cooldown and escalation. |
| RM costing | Actual Owner or Admin may activate audited planning-cost versions | Confirm component assumptions and allowed currencies/base units. |
| Printed documents | Candidate Amigo Unit-2 header and terms | Approve legal header, GST/address, payment wording, test terms and signatory. |

## 1. Prepare a recovery point

1. Announce the approved maintenance window and pause procurement writes.
2. Record deployed application revisions, image digests, environment configuration checksum, Alembic revision, database size and active database endpoint.
3. Take a database backup with the platform's existing encrypted backup process. For a direct PostgreSQL backup, use a restricted operator account and a timestamped custom-format file:

   ```bash
   pg_dump --format=custom --no-owner --no-acl --file=<protected-backup-path> <database-url>
   shasum -a 256 <protected-backup-path>
   ```

4. Restore that backup into a disposable staging database and run the existing restore validation. A backup file alone is not a recovery test.
5. Save the backup checksum, restore result and row-count baseline with the release ticket.

## 2. Rehearse on the restored staging database

From the reviewed checkout:

```bash
cd hariom-erp/services/inventory-service
../../venv-runtime/bin/pip install -r requirements.txt
DATABASE_URL=<restored-staging-url> ../../venv-runtime/bin/alembic current
DATABASE_URL=<restored-staging-url> ../../venv-runtime/bin/alembic upgrade head
```

The target revision is `012_supplier_history` (canonical supplier schedules, receipt allocation pairs, schedule revision history and section reel issues). Confirm the migration log includes 001 through 012 when testing a fresh database, or only the expected forward revisions on an upgraded database.

Run the legacy PO backfill in dry-run mode first:

```bash
cd hariom-erp
venv-runtime/bin/python scripts/procurement_v2_backfill.py --database-url <restored-staging-url> --output /tmp/procurement-backfill-dry-run.json
```

Review every unresolved supplier/item/plant link. The script must not guess links. After the JSON is approved, apply once:

```bash
venv-runtime/bin/python scripts/procurement_v2_backfill.py --database-url <restored-staging-url> --apply --output /tmp/procurement-backfill-apply.json
```

Run dry-run again. It must report no additional work. Preserve both JSON files with the release evidence.

## 3. Reconcile before enabling the new flow

Compare before/after values by plant and tracking mode:

- PO count, PO numbers, supplier snapshots, ordered kg, received kg, short-closed kg and open kg.
- Receipt count and quantities; pending invoice count; invoice allocation totals.
- Paper reel/coil count, unique AT codes, original kg, current kg, QC state and commercial state.
- Batch stock separately from serialized paper stock; no paper receipt may be counted in both ledgers.
- Open discrepancy amount, active claimed amount, issued debit notes, settled amount and open amount.
- Schedule planned/received/cancelled/open kg and plan-to-PO allocations.
- Active stock-policy versions and active RM-cost versions.

Stop on any unexplained delta. A historical record without a safe link remains visible as a migration exception.

## 4. Stage the application and run the release gate

Install the UI lockfile exactly and build:

```bash
cd apps/web-ui
npm ci
npm run verify
npm audit --json
```

Run the service suites against the restored staging database and the BFF suite. Use a database name containing `procurement_test` only for disposable automated acceptance:

```bash
cd hariom-erp/services/inventory-service
DATABASE_URL=<disposable-procurement-test-url> PYTHONPATH=. ../../venv-runtime/bin/python -m pytest -q tests

cd ../../../../apps/bff-api
../../hariom-erp/venv-runtime/bin/python -m pytest -q tests
```

Complete one signed-in role journey with real staging accounts:

1. Planner/Store creates an RM/PM PO without entering a number.
2. A different PlantManager approves its exact saved hash.
3. Maker records a vendor amendment; stale approval fails and the new revision is reapproved.
4. Store posts two paper deliveries totalling 10,000 kg with nine measured physical lots against an estimated eight.
5. Confirm nine AT identities, nine canonical labels and no parallel paper batch quantity.
6. Attach or enter the vendor invoice; confirm PO and invoice rates remain separate.
7. Resolve quantity/specification cases, create and independently approve a positive rate claim, issue it, record a partial settlement and verify the open balance.
8. Import `Book.xlsx` as a draft using an explicit KG or MT source factor, review date/header exceptions, run MRP and convert only uncovered approved entries once.
9. Create and activate a stock policy with maker/checker users; exercise breach, acknowledge/snooze and recovery.
10. As the actual Owner and separately as Admin, create and activate RM cost versions 30.40/kg and 32.36/kg; confirm old versions, PO rates, invoice rates and received stock costs do not change.
11. Download saved PO and debit-note PDFs, generate the label job, export all seven registers and scan one label into the authenticated lot view.

Test 1440, 1024, 768, 390 and 320 px widths, keyboard navigation and 200% zoom. Record real printer output separately from PDF/preview review.

## 5. Production activation

Only after explicit release approval:

1. Repeat the verified backup and record its checksum.
2. Deploy the reviewed application images while procurement writes remain paused.
3. Apply the reviewed inventory migration chain through `012_supplier_history`. Rehearse the exact live schema first; do not stamp a legacy database without comparing its schema. Migration 011 deliberately stops if the discarded alternate supplier-schedule table contains rows requiring reconciliation.
4. Run and review the production backfill dry run, then apply it once.
5. Configure the confirmed series and policy values.
6. Set `PROCUREMENT_V2_ENFORCED=true` only when the UI and backend release are both active. This blocks legacy PO-linked inward/reel/GRN bypasses.
7. Resume writes for a controlled pilot plant/user group.
8. Create a non-vendor-facing test draft only if the release ticket authorizes it; archive/cancel through the governed workflow.
9. Monitor authentication failures, 409 conflicts, posting errors, duplicate-key conflicts, alert evaluation and export/PDF failures.
10. Expand access after the pilot signoff.

## 6. Forward-safe rollback

If the new flow fails before any new procurement transaction, roll back the application release and leave the additive tables intact.

If transactions exist:

1. Pause new procurement writes and keep read access available.
2. Disable the new entry points or put the procurement workspaces in read-only mode.
3. Preserve all POs, revisions, receipts, AT lots, invoices, discrepancies, claims, plans, policies and cost versions.
4. Diagnose and deploy a forward repair. Never reuse document numbers or delete issued history.
5. Reconcile stock, PO balances and claim balances before reopening.

Restore the pre-release backup only for a confirmed failed migration before later business writes, under the organization's existing incident authority. Record who approved the decision and the exact data-loss boundary.

## 7. Release signoff

The release record is complete only when it contains: backup and restore evidence, migration/backfill output, before/after reconciliation, test logs, signed-in role journey, browser evidence, saved PDF/Excel samples, real printer sample, approved configuration table, monitoring owner and rollback owner.



## 15 September workflow correction gates

- Recheck the compact Purchasing and Stores sidebar, full PO editor, dedicated GRN register, Owner/Admin costing and month calendar on the actual released build. A source build does not update the live screenshot.
- Receive a manual GRN without creating a synthetic PO. Confirm each measured reel/coil has its own kg, AT number and QR. Verify a different authorized actor approves its invoice rates, with QC independent.
- Test manual invoice quantity mismatch, delayed invoice attachment and exact retries. Resolving a discrepancy must not bypass manual purchase approval.
- Run multi-material PO inward with paper lots and a bulk material together. An invoice rate override must retain the saved PO rate until its own commercial acceptance.
- Import each `Book.xlsx` worksheet. The lower FG date block is excluded; every helper column requires explicit exclusion. Confirm unit, exact material mapping and duplicate-column sums before saving.
- Compare the sales/BOM feed with real order lines and the production reservation ledger. The procurement feed combines unreleased new-build demand and the frozen residual paper requirements of active released jobs. Net issues are item-specific; accepted externally sourced FG reduces new-build units. Shared section issues or missing production linkage block purchasing calculations pending reconciliation. Saved call-offs drive timing; unattributed coverage is conservatively kept against later dates.
- Compare daily MRP projection with approved delivery schedules. Month-end coverage must not conceal an early shortage. Undated POs are shown separately; overdue expected supply needs vendor confirmation.
- The September 21 isolated candidate uses real local service authentication and cloned databases, with added test records. These checks are not live production acceptance. Repeat read-only signed-in checks on the deployed version and complete the approved pilot without demonstration data in production.
