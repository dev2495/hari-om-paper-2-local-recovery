# Go-live report: inward QC by bill, weight-short debit notes, Gate, Doc Vault (6 Nov 2026)

Base commit `dd59265`. Spec: `Hari-Om-ERP-plan-inward-gate-vault-6-Nov-2026-INTERNAL.html` (sections 1–9).
Verified on the local season stack on 6–7 Nov 2026 (tests, isolated Next build, one end-to-end browser run
on desktop and a 390 px phone).

## 1. What ships, by screen

**Quality › Incoming inspection** (`/quality/incoming`)
- One card per bill or challan, with every reel and lot of the bill inside it. Tabs: To weigh, Part done,
  Owner decision, Done today, Held. Search covers bill, challan, GRN, AIT no., vendor reel no. and vendor.
- The bill sheet shows the bill photos taken at the gate and at inward. Tap one to read the vendor's reel
  list beside the sheet.
- Four tiles: Bill weight, Weighed so far, Difference (with the ₹ value) and Ready for issue.
- The reel grid has Bill kg (read-only), **Actual kg (needed to Accept)**, the difference, optional checks
  and the decision. The scan box jumps to a reel. Enter moves down the weights. Each row saves on its own.
  A far-off weight asks for a confirm. **Re-weigh** fixes a typo and needs a WEIGH_CORRECTION reason.
- Every template check is now **optional**. Only the actual weight is needed, and only for Accept; Hold and
  Reject never need it. An out-of-band reading that is entered still holds the lot, as before.
- **Stock stays on the bill weight.** The actual weight is a record only: the ledger, `current_weight_kg`,
  the labels and month close do not change.
- **Every path is guarded on the server.** No path can release a purchase lot for issue before QC enters
  its actual weight. This covers the old inspection API, the scan, the QC desk, holds closing, concession
  release and the GRN refresh after an invoice is attached. Opening-stock lots and customer returns are
  exempt.
- When the last lot of a bill is weighed or rejected, a weight-check banner shows the band and who acts next.

**Weight check → debit note** (per bill; rejected lots left out; limits 20 / 50 kg, editable by the Owner in System › Plants)
- Short ≤ 20 kg: recorded only.
- 20 < short ≤ 50 kg: the Owner gets a notification with **Make debit note**, **Skip…** (needs a
  WEIGHT_SHORT_SKIP reason) and **Open bill**. A reminder goes after 48 h.
- Short > 50 kg: a QUANTITY case and a debit-note draft are made automatically. If the invoice is still
  pending, the draft is made when the invoice is attached.
- Excess is recorded only. Items not billed in kg are a notification only.
- The case is the existing QUANTITY purchase discrepancy. Its source is `QC_WEIGH`, so it sits beside the
  GRN's own quantity case on the same line. The kg already claimed at the GRN are not claimed twice.
- The debit note is made by the existing debit-note service (`services/debit_notes.py`, the same code as
  `POST /debit-notes`), with reason DEBIT_NOTE / DN-WEIGHT-SHORT. Submit → approve (by a different
  person) → issue are unchanged.
- **Purchase › Invoice differences** gets a new **Weight differences** tab.
- **Debit notes** show a "Weighed short" chip and the follow-up person (the PO raiser). The PO raiser
  is notified.

**Doc Vault** (`/documents`)
- Every bill, challan, photo and issued debit-note PDF in one place. Search, filters, an Unlinked tab and
  a viewer with history.
- Documents are never deleted. The Owner or Admin can void one, with a DOC_VOID reason.
- A shared documents panel is on the GRN, the debit note and the gate entry.
- An issued debit note's PDF is saved and linked automatically.
- Each role sees its own kinds:
  - Owner, Admin, PlantManager and Accounts: everything.
  - Store, GRN, QC and InwardQC: material bills and challans.
  - Dispatch: outward documents.
  - Watchman: only their own uploads of today.

**Gate** (`/gate`, a phone-first desk; new role **Watchman**, a gate-only login)
- *Inside now*: visitors waiting and visitors inside, with Let in / Deny (GATE_DENY reason) / Out and
  pass scan. Vehicles with a bill today show each photo thumbnail. If a photo is saved but this login may
  not open it, the card says so. If an entry has no photo yet, it says "Photo uploading…" or "No photo".
- *+ Visitor* (walk-in) and the **public check-in** on the visitor's own phone (the gate QR poster, no
  login, rate-limited) issue a pass. The host is told and can reply Send in / Ask to wait / Not available.
  The host does not have to approve before the watchman lets the visitor in.
- *+ Bill in*: photograph a bill or challan and pick a type (BILL_CATEGORY reason). Material bills go to
  Stores and appear as **At the gate** on Goods inward. Electricity, maintenance and other bills go to
  the Accounts inbox (`/gate/bills`), filed with a COST_HEAD.
- Posting a GRN with the gate entry links all its photos to the GRN and every reel.
- *+ Goods out*: pick the challan that is leaving (or scan its QR), type the Tally bill no. and take the
  Tally bill and challan photos. The truck is never held for the photos. Until both photos are in the
  vault:
  - the dispatch register shows "Photos missing: …";
  - the gate register shows "Photos missing";
  - the desk shows a banner listing the pending uploads.
- *Today* tab, **Gate register** (`/gate/history`, CSV) and **System › Gates** (gates, QR poster, token
  rotation, close time, visitor-photo retention).
- The sweeps send 24 h reminders for unlinked material bills, the after-close overstay digest and
  "dispatch not out", mark no-shows, and blank visitor photos after the retention period.
- The dispatch register and challan print show the Tally no., Out of gate and the gate QR.

**Notifications**
- Action buttons in the inbox (Owner decision, host reply).
- The result of a button is recorded on the notification.
- New events: `PURCHASE_WEIGHT_*` and `GATE_*` (the GATE_ events sit in the Stores category).
- Named people can be addressed by e-mail (`recipient_user_emails`). The plant check still applies.

## 2. Schema and start-up changes (all reach live by a normal release)

Everything runs at inventory-service start (`src/main.py`) and is idempotent. Alembic files `013_incoming_bill_qc`
(down `012_supplier_history`) → `014_doc_vault` → `015_gate` mirror it for alembic-managed databases (single head).

- **New tables (`create_all`):**
  - `plant_settings`, `purchase_weight_variances`, `incoming_qc_entry_keys`
  - `documents`, `document_pages`, `document_links`, `document_events`
  - `gates`, `gate_entries`, `gate_visitors`, `gate_visits`, `dispatch_gate_out`, `gate_plant_settings`
    and the notice log
- **New columns:**
  - `paper_reels`: `actual_qty`, `weighed_at`, `weighed_by`, `weigh_note`.
  - `stock_batch`: the same four, plus `billed_qty`, backfilled from `received_qty`.
  - `purchase_discrepancies.case_source`: `NOT NULL DEFAULT 'GRN'`, so existing rows become GRN.
- **Unique key change on `purchase_discrepancies`.** The key moves from (allocation, type) to
  (allocation, type, case_source).
  - The new unique index is created first. The old key is then dropped by a catalogue lookup, so it goes
    whatever it is named, whether it is a constraint or a bare unique index.
  - No row changes.
  - Tested twice on a populated DB that had the old constraint plus an extra legacy unique index (13 rows
    kept), and twice on the local season DB (17 rows kept).
- **Data step (`schema_incoming_bill.py`):**
  - Every incoming template check becomes optional.
  - The typed weight checks (paper `reel_weight_kg`, parchment `weight_kg`) are retired.
  - Earlier readings of those checks are copied into `actual_qty` where it is empty. This makes no stock
    posting and raises no weight case.
- **Reason codes (masterdata seeds them for every plant at start).** New lists:
  - WEIGH_CORRECTION
  - WEIGHT_SHORT_SKIP
  - DOC_VOID
  - BILL_CATEGORY
  - COST_HEAD
  - VISIT_PURPOSE
  - GATE_DENY
  
  Also, DN-WEIGHT-SHORT is added to DEBIT_NOTE. It is inserted once per plant even where that list was
  seeded before.
- **Role:** auth adds **Watchman**. No Purchase role. Accounts is not seeded.
- **Deploy files:**
  - `docker-compose.yml`: a new named volume `erp_documents` mounted at `/data/documents`, plus the
    `DOCS_*` env.
  - `Caddyfile`: request body limit raised to 15 MB.
  - `backup_databases.sh`: syncs the vault volume to `s3://$BACKUP_S3_BUCKET/documents/`.
  - Requirements: Pillow 12.3.0 and boto3 1.43.125, in `requirements.all.txt`, which the image installs.
    They resolve for Python 3.12 on linux aarch64 (t4g) and x86_64, with a binary Pillow wheel.

## 3. Release steps on live (what you run)

0. Before releasing, check the host has at least 10 GB free and prune the Docker build cache if not. The
   root disk filled up on 27 Oct and 3 Nov.
1. Commit and push. Then, from CloudShell, run the usual
   `deploy/aws-ec2/cloudshell_release.sh <release-sha> <expected-deployed-sha>`. `release_verified.sh`
   copies the source and builds the image (this installs Pillow and boto3). `compose up -d erp-app`
   recreates the container with the new env and creates the `erp_documents` volume. The script then
   reloads Caddy (15 MB). No separate SQL file is needed: the start-up statements do the schema.
   Restart order: none. It is one container, and the release restarts it once.
2. Check the release worked:
   ```bash
   docker compose --env-file deploy/aws-ec2/.env --project-directory deploy/aws-ec2 exec -T erp-app \
     sh -c 'ls -ld /data/documents && python -c "import PIL, boto3; print(PIL.__version__, boto3.__version__)"'
   docker volume ls | grep erp_documents
   ```
3. One-time setup in the app (Owner/Admin, one plant selected):
   - **System › Gates**: create each gate (code, name, In / Out / Both), print the **QR poster** and put
     it up at the gate. Set the close time and the visitor-photo retention.
   - **System › People**: create a **Watchman** login per gate person (plant = their plant). Check that it
     opens only `/gate`.
   - **System › Plants**: check the weight limits (default 20 / 50 kg) and change them if the client wants.
   - **Masters › Reason codes**: check that the seven new lists are there for each plant.
4. Check that the relay delivers notifications. Weigh a test bill short, or wait for the first real gate
   entry, then confirm the notification appears in the inbox. On the host:
   `docker compose ... exec -T postgres psql -U $DB_USER -d inventorydb -c "select count(*) from audit_outbox where delivered_at is null"`
   should stay near 0. (The relay forwards `recipient_user_emails`, the action buttons and the payload
   unchanged. All 9,684 pending local rows, including GATE_* and PURCHASE_WEIGHT_*, went through
   `shared/audit_relay.deliver_batch` with no error.)
5. Tell QC: from now on, Accept on a purchase lot needs the actual weight. Lots received before today
   that are still in QC hold need weighing on the bill sheet before release.

## 4. Rollback

- The usual `release_verified.sh` rollback (previous image) works.
- The new tables, columns and the `erp_documents` volume stay. The old code ignores them, and no data is
  lost.
- The discrepancy key does not go back on its own. If the old code must run for long, recreate the old pair
  key only after checking that no (allocation, type) pair has both a GRN and a QC_WEIGH case:
  `select allocation_id, discrepancy_type, count(*) from purchase_discrepancies group by 1,2 having count(*)>1`.
- Vault files stay on the volume.

## 5. Test results (7 Nov 2026)

| Suite | Result |
| --- | --- |
| inventory-service (PostgreSQL) | 385 passed, 19 failed, 1 skipped. The 19 also fail on the `dd59265` baseline (old PO-approval and profile fixtures); none is new. |
| auth-service | 47 passed |
| masterdata-service | 64 passed |
| production-service (incl. dispatch register) | 655 passed, 37 failed. The same 37 fail on the `dd59265` baseline. |
| bff-api | 147 passed, 1 skipped |
| web `test:unit` / `test:static` | pass / pass |
| `npm run lint` | 0 errors (5 earlier warnings) |
| `tsc --noEmit` | 0 errors |
| isolated `next build` (`NEXT_DIST_DIR=.next-verify`) | compiled successfully |
| alembic | `012 → 013 → 014 → 015`, `alembic heads` = `015_gate` |
| End-to-end (Playwright, desktop + 390 px phone) | all 10 steps pass: gate bill photo → At the gate → GRN linked → QC weigh 30 kg short → relay → Owner Make debit note → DN issued → PDF in vault → visitor in + host reply → goods out with Tally no. → history + vault search. No 4xx/5xx on any page apart from the 401 `/api/auth/me` that comes before login; no horizontal overflow at 390 px. |

## 6. Known limits

- **The Doc Vault is on the instance disk** (the `erp_documents` volume, backed up nightly to S3). Plan the
  move to S3 (`DOCS_STORAGE_BACKEND=s3`, runbook `docs/runbooks/doc-vault-storage.md`) before about 5 GB,
  because the root disk is 38 GB.
- **Photos taken offline** wait on that phone (IndexedDB) until it is back on the network. The desk shows
  what is still to upload.
- **Same file uploaded again.** If a file is already in the vault (same bytes), the existing document is
  linked to the new record, not saved twice. A watchman then sees "Photo saved" without opening it.
- **Public check-in never reveals a visitor (closed 7 Nov).** The logged-out page does not prefill a
  known mobile number, and `/api/public/visit/{token}/lookup` always answers `{"known": false}`. Only the
  watchman's signed-in desk fills in a returning visitor.
- **Old QC-held lots need weighing.** Lots received before go-live and still in QC hold must be weighed
  before they can be released.
- **The vendor-wise short-kg row** in supplier analytics (spec §2) is not in this release.
