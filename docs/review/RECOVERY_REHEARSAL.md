# Isolated seven-database restore rehearsal

**Kind:** synthetic dump/restore of the isolated `hariom_nverify_*` candidate into disposable `hariom_nverify_restore_*` databases.  
**Not** a production backup, **not** AWS, **not** an interrupted cross-service operation replay against restored targets.  
**Candidate DBs were not dropped.** Restore targets are unused by the running stack on ports 23000/24000/28001–28008.

## Command

```bash
# loopback PostgreSQL; drops/recreates only hariom_nverify_restore_* 
bash docs/review/scripts/seven_db_restore_rehearsal.sh
```

Script: `docs/review/scripts/seven_db_restore_rehearsal.sh`  
Artifacts (gitignored): `reports/nverify-restore-<UTC>/`

## Repeat rehearsal (2026-09-18T14:02:52Z) — dump/restore/holds PASS

Wall clock **11.06s**. Auth rows 977 (source grew after live tests). All seven row-count checks matched. Pending/open holds matched source: inventory **33 / qty 12160**, production **16**. Outbox restored identically (inventory undelivered 2, production 548, sales 135). Restore DBs remain unused by the running stack.

Timing JSON helper originally omitted `import json`; that is fixed in the script. Evidence: `reports/nverify-restore-20260918T140252Z/summary.txt`.

## First rehearsal (2026-09-18T13:51:45Z)

Dump/restore row counts all matched, then the pending-hold check originally failed because it imported system `sqlalchemy` instead of `psql`. Pending check was rewritten to `psql`. Holds were then confirmed:

| DB | Tables | Rows | Outbox | Holds |
| --- | ---: | ---: | ---: | --- |
| auth → restore_auth | 10 | 973 | none | none |
| master → restore_master | 23 | 132 | 46 | — |
| spec → restore_spec | 8 | 238 | 121 | — |
| sales → restore_sales | 8 | 486 | 135 | — |
| production → restore_production | 22 | 10016 | 548 | quality_holds 16 |
| inventory → restore_inventory | 32 | 265 | 2 | inventory_quality_holds 33 |
| analytics → restore_analytics | 1 | 8 | none | none |

Open inventory holds after restore: **33 rows, qty 12160**, matching `hariom_nverify_inventorydb`. Production `quality_holds` **16**, matching source. No extra rows that would imply duplicate postings from restore itself. Restore DBs were left in place and not pointed at by the running nverify stack.

Elapsed for the dump/restore loop before the failed Python pending helper: ~11s. Summary: `reports/nverify-restore-20260918T135145Z/summary.txt`.

## What this does **not** prove

- Production backup media, AWS snapshots, or owner off-site restore.
- Replaying a pending operation (release, concession, QC submit) against the restored DBs without duplicate postings.
- Plant-level quantity reconciliation of migrated production data (QCT-119 / REG-02 remain NOT_RUN).
- Barrier / outbox delivery after cutover.

Overlay: QCT-123 and REG-03 are **PARTIAL / RELATED**, not PASS.
