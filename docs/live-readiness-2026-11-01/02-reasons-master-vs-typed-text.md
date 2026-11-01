# Reasons across Hari Om TubeOS: what uses the reason master, and what takes typed text

Code at 3c85b67. This was a read-only check: no code, config, data or service was changed. Paths are relative to the repo root `hari-om-paper-2-local-recovery/`. Short names used below:
- `SO` = `hariom-erp/services/sales-service/src`
- `PR` = `hariom-erp/services/production-service/src`
- `INV` = `hariom-erp/services/inventory-service/src`
- `MD` = `hariom-erp/services/masterdata-service/src`
- `BFF` = `apps/bff-api/src/routes`
- `UI` = `apps/web-ui`

## Short answer

- **Sales order cancel, sales order short close and customer hold & close use the reason master.** The dialog lists the active "Order cancel / short close" (SO_CLOSE) reasons for the plant. The BFF (the web gateway every screen calls) refuses any code that is not an active SO_CLOSE code. The sales service then saves the code plus the reason's name at that moment. The one weak spot: the sales service itself only checks that a code was sent; it does not check it against the master.
- **Job card force close and job card cancel are typed text.** You type at least 3 characters; four or five "quick reason" buttons fill in example text. Splitting a card, editing qty or colour, and emergency insert work the same way. None of these use the master.
- **Short closing a stage on a batch-entry (V2) card is typed text.**
- **Shortage at final QC on a V2 card uses the master.** This is the "Close job card short" panel on the Dispatch tab. It lists the SHORT_CLOSE category, and the production service checks the code strictly against the master.
- **QC holds, QC release, purchase actions, GRN problems and requisitions are all typed text.** Stock corrections and manual FG use fixed lists built into the code, not the master. Floor rejection codes are a fixed list on screen that the server does not check.
- Of the 9 categories in the master, only **SO_CLOSE, SHORT_CLOSE, CUSTOMER_COMPLAINT and DOWNTIME** feed a live screen. SCRAP, QC_REJECT, RM_ISSUE, RETURN and OTHER are not used by any live action.

---

## 1. Reason lists that exist

### 1a. Masters › Reason codes (`/masters/reason-codes`), stored in the master-data service, table `reason_code`

- **Fields** (`MD/models.py:484-503`): code (40 characters), label, category, severity (OK / WATCH / CRITICAL), description, plant_id, active, created/updated. A code must be unique within a plant across all categories (`uq_reason_plant_code`).
- **Categories** (`MD/routers/shop_floor.py:713`): DOWNTIME, SCRAP, QC_REJECT, SHORT_CLOSE (shown as "Job card short close"), RM_ISSUE, RETURN, CUSTOMER_COMPLAINT, SO_CLOSE, OTHER. The screen uses the same list (`UI/app/(dashboard)/masters/reason-codes/page.tsx:40-46`).
- **Who manages them:**
  - The page is open to Owner, Admin and Plant Manager (`reason-codes/page.tsx:66`).
  - The server lets Admin, Owner and Plant Manager add, edit and deactivate (`shop_floor.py:784-800`, `844-861`, `930-945`).
  - SO_CLOSE rows can be changed by Owner or Admin only (`shop_floor.py:715-726`). On this page they are read-only (`page.tsx:44-46`).
- **Active rules:**
  - "Delete" only switches a reason off (`active=False`, `shop_floor.py:946`).
  - The list shows only active rows unless asked for inactive ones too (`shop_floor.py:765-781`).
  - An SO_CLOSE code can never change, and the reason cannot be moved to another category (`shop_floor.py:867-881`).
- **Seeded values:** only SO_CLOSE is seeded by code, once per plant, at master-data start-up (`MD/reason_seed.py:19-29`, called at `MD/main.py:786-788`). The nine codes are:

  | Code | Name |
  |---|---|
  | SO-CUST-CANCEL | Customer cancelled the order |
  | SO-QTY-REDUCED | Customer reduced the quantity |
  | SO-BALANCE-NOT-REQ | Customer does not need the balance |
  | SO-SPEC-CHANGE | Customer changed the specification |
  | SO-PRICE | Price or terms not agreed |
  | SO-PO-EXPIRED | PO validity expired |
  | SO-DUPLICATE | Duplicate order entry |
  | SO-ENTRY-ERROR | Order entered by mistake |
  | SO-OTHER | Other (write a note) |

- CUSTOMER_COMPLAINT has a starter list of 8 (CC-DAMAGE, CC-SIZE, CC-STRENGTH, CC-MOISTURE, CC-QTY, CC-FINISH, CC-PACKING, CC-OTHER). It is added only when an Owner or Admin clicks "Add common reasons" on the complaints page (`UI/app/(dashboard)/quality/returns/page.tsx:39-48`).
- **DOWNTIME, SHORT_CLOSE, SCRAP, QC_REJECT, RM_ISSUE, RETURN and OTHER start empty.** Nothing seeds them.

### 1b. Masters › Order close reasons (`/masters/order-close-reasons`)

- This is a second screen over the same SO_CLOSE rows of `reason_code`. It is not a separate table (`UI/app/(dashboard)/masters/order-close-reasons/page.tsx:19-24`).
- It goes through BFF routes `/api/sales/order-close-reasons` (`BFF/sales.py:430-542`). Only Owner and Admin can make changes there (`sales.py:443-446`; UI `page.tsx:41`).
- New codes are built from the name as `SO-<NAME>`. The code is checked for uniqueness across every category, inactive ones included (`sales.py:482-509`).
- Rename changes the name only. Deactivate hides the reason from new closes; closed orders keep it.

### 1c. Fixed lists built into the code (not the master)

| List | Where | Values | Server enforces? |
|---|---|---|---|
| Stock correction reasons | `INV/routers/stock_control.py:69-76` | COUNT_SHORT, COUNT_EXTRA, DAMAGED_IN_STORE, WRONG_GRN_WEIGHT, LABEL_LOST_FOUND, OTHER | Yes, list check; OTHER needs a 3+ character note (`stock_control.py:2285-2290`) |
| Count-only reason | `stock_control.py:66` | PHYSICAL_COUNT_VARIANCE (written by the system) | Yes |
| Manual FG inward reasons | `INV/routers/fg_inward.py:200, 223-225`; screen `UI/app/(dashboard)/inventory/fg-inward/page.tsx:20` | REWORK, RETURN, ADJUSTMENT, OPENING, OTHER | Yes, list check; no note required for OTHER |
| Floor rejection codes (Log output) | `UI/components/production/card/model.ts:21-33` | WL, PG, ID, OD, LN, WT, CS, DM, MS, NT, OT (Other) | **No.** The server only asks for some non-empty `reject_reason` text (`PR/routers/entries.py:503`). The screen asks for a code, and a note when the code is OT (`LogOutputForm.tsx:340-341`). |
| Job card action "quick reasons" | `UI/components/production/job-card-actions.tsx:122-128` | Example texts only (for instance "Material short") | No, they just fill a text box |
| Job card short-close decision | `PR/routers/operations.py:581` | CARRY_FORWARD, SHORT_CLOSE_SO, HOLD | Yes |
| QC hold release decision | `PR/routers/quality.py:2747` | RELEASE_AS_IS, REWORKED, SORTED, PARTLY_SCRAPPED | Yes |
| Inward / complaint QC decisions | `INV/routers/quality.py:67` | HOLD, REJECT, ACCEPT, REWORK, REHEAT, SEGREGATE, SCRAP, BLOCK | Yes |
| QC failure "reason code" | `UI/components/qc/StageQcFields.tsx:250-262` | Only "Known explanation" or CAUSE_UNDER_INVESTIGATION; the reason itself is free text | Yes, for the investigation fields |
| GRN reject remainder | `INV/routers/purchase.py:437-450` | REJECT or REPLACE, **with no reason field at all** | API only; no screen calls it |
| Purchase discrepancy actions | `INV/routers/procurement.py:1110` | ASSIGN, ACCEPT_VARIANCE, REJECT_INVOICE, RELEASE_STOCK | Yes (the reason itself is free text) |

---

## 2. Every action that asks "why"

In the "Server checks the code against master?" column, **Yes** means the code must be an active code in the master; **n/a** means there is no code to check.

### Sales orders

| Action | Page / who | How the reason is captured in the UI | Server checks the code against master? | Note mandatory? | Stored in | Shown later |
|---|---|---|---|---|---|---|
| **Cancel order** | Order page and register, "Cancel or short close" dialog; Admin, Owner, Sales, Plant Manager (`SO/order_closure.py:26`) | Dropdown of active SO_CLOSE reasons for the order's plant, plus a note (`UI/components/sales/order-closure-dialog.tsx:40-49, 80-88`) | **Yes, in the BFF**: refuses anything not an active SO_CLOSE code (`BFF/sales.py:305-331`). **The sales service does not check the master**: it accepts any non-empty code (`SO/order_closure.py:127-135`, `SO/routers/sales_orders.py:2624-2630`). | Yes, when the code contains the word OTHER/OTHERS: 5+ characters (`order_closure.py:118-135`; UI copy `order-closure-dialog.tsx:53`) | `sales_orders.closure_kind`, `closure_reason_code`, `closure_reason` (name at that time), `closure_note`, `closure_by`, `closure_at` (`SO/models.py:62-70`; `sales_orders.py:2687-2694`), plus an audit event | Order header banner (`UI/app/(dashboard)/sales-orders/[orderId]/page.tsx:506-510`), register chip and tooltip (`sales-orders/page.tsx:579`), order timeline (`sales_orders.py:2062-2076`), notification |
| **Short close order** | Same dialog and roles | Same | Same: checked in the BFF, not in the service (`sales_orders.py:2705-2732`) | Same | Same columns, `closure_kind=SHORT_CLOSED` | Same |
| **Customer hold & close** | Hold dialog (`UI/components/sales/order-hold-dialog.tsx:82`); Admin, Sales (+ Owner) (`sales_orders.py:2501-2507`) | Same SO_CLOSE dropdown and note | BFF checks (`BFF/sales.py:268-271`). The service only requires a code and the OTHER note. It also accepts an old free-text `reason` field as the note (`sales_orders.py:2475-2532`). | Same OTHER rule | `hold_reason_code`, `hold_reason` = "name — note" (`sales_orders.py:2531-2532`), plus an audit event | Order page "On hold", register tooltip, notification. **Not in the order timeline.** |
| **Resume (lift hold)** | Order page and register; Admin, Sales | **Nothing** | n/a | No | **Wipes `hold_reason` and `hold_reason_code`** (`sales_orders.py:2572-2573`). A cancel or short close does the same (`2643-2644`). | Only the audit event remembers the hold reason |
| Order line edit / qty reduce | Order edit; only allowed while draft or submitted (`sales_orders.py:2267-2274`) | Nothing | n/a | No | n/a | n/a |
| Colour split change | Order page | Nothing | n/a | No | n/a | n/a |
| Customer PO change after release | PO dialog | Optional note (`sales_orders.py:2378-2385`) | n/a | No | `sales_order_po_changes` | Order timeline |
| SO line short close (from a job card shortage) | Called by production, not a screen of its own | SHORT_CLOSE code passed through from production | Not here (production already checked it). The service only requires non-empty (`sales_orders.py:3352-3354`). | No | Appended as **text** to `sales_orders.notes`, plus an audit event (`sales_orders.py:3395-3399`). No reason column. | Order notes |

### Job cards and production

| Action | Page / who | How the reason is captured in the UI | Server checks the code against master? | Note mandatory? | Stored in | Shown later |
|---|---|---|---|---|---|---|
| **Force close ("Closed early")** | Job card manager; planner roles (`PR/routers/lifecycle.py:518-524`) | **Free text, 3+ characters**, with quick-reason buttons (`job-card-actions.tsx:122-128, 333-340, 406, 775`) | No code. Server needs 3–500 characters (`lifecycle.py:515`). | The text is the reason | `job_cards.close_reason`, `close_mode=FORCE`, `closed_by/at` (`lifecycle.py:598-602`); audit `job_card_force_closed`; text also sent to sales return-balance (`lifecycle.py:603-614`) | Job card manager and lifecycle sheet (`job-card-manager.tsx:585`, `job-card-lifecycle-sheet.tsx:266`), order page (`sales-orders/[orderId]/page.tsx:622`); order timeline shows "balance returned" **without** the reason (`sales_orders.py:2154-2184`) |
| **Cancel card** | Same; same endpoint, with nothing made | Free text with quick reasons | No | Same | `close_mode=CANCELLED` + `close_reason` | Same |
| **Bulk force close** | Job card manager, several cards ticked | **One free-text reason for all** (`job-card-manager.tsx:933`) | No | Same | Same | Same |
| Split card | Job card manager | Free text 3+ characters on screen | Server: **optional** (`lifecycle.py:397`) | No | Audit only (`lifecycle.py:504-505`) | Card history |
| Edit qty / colour (queued card) | Job card manager | Free text 3+ characters on screen | Server: optional (`lifecycle.py:340`) | No | Audit, plus sales release-lot audit (`lifecycle.py:378-383`; `sales_orders.py:3284`) | Card and order history |
| Emergency insert | Job card manager | Free text 3+ characters | Server needs 3+ characters (`lifecycle.py:628`) | Text | Audit (`lifecycle.py:701`) | Card history |
| **Stage close with shortfall (V2 batch entry)** | Card page › Close stage (`UI/components/production/card/CloseStageDialog.tsx:115-141`); Plant Manager | **Free text** (any length above 0) | No code. Server needs non-empty text (`PR/routers/entries.py:1134`). | Text | `job_card_stages.actuals_snapshot.close_reason`, `close_kind=SHORT_CLOSE` (`entries.py:1158`) | Print log, stage view (`SeasonPrintLog.tsx:169`) |
| Leftover input at stage close (hold or scrap) | Same dialog | Free text plus a hold/scrap choice | No code (`entries.py:1148-1149`) | Text | `residual_wip.reason` | Card |
| **Card shortage at final QC (V2)** | Card › Dispatch tab › shortage panel (`UI/components/production/JobCardShortagePanel.tsx:45-91`); Plant Manager, Admin, Owner | **Dropdown of SHORT_CLOSE codes**, decision, notes | **Yes, strict.** Refuses a code not in the active SHORT_CLOSE list; if the master cannot be reached it says try again (`PR/routers/operations.py:147-205, 645-651`). | Notes optional | `job_card_short_close.reason_code`, decision, notes (`PR/models.py:700-720`); passed on to sales | Panel, operations report (`reports/operations/page.tsx:301`) |
| Old-form short close / carry forward | Operations control (`UI/app/(dashboard)/operations/control/page.tsx:131, 640-657`); admin-landing link only | SHORT_CLOSE dropdown | Yes, strict (same function) | Optional | Same table | Same |
| Machine downtime | Operations control (`control/page.tsx:132, 718`) | DOWNTIME dropdown | Strict on create (`operations.py:1263-1270`). **Not checked on edit**: a PUT can change the code to anything (`operations.py:1347-1348`). | Optional | `machine_downtime.reason_code` | Operations report (`reports/operations/page.tsx:323`) |
| Run rejected qty | Log output (`UI/components/production/card/LogOutputForm.tsx:329-357`) | Fixed code list on screen plus a note (note required for OT) | **No.** The server needs only some `reject_reason` text, and the code is optional (`entries.py:503`) | Note only for OT, and only on screen | `continuous_stage_entries.details.reject_code` and `reject_reason` | Run list, print log |
| Overproduction above 110%, carryover, cutting loss, planner-gate override | Log output | Free text | No code (`entries.py:641, 703`) | Text | Entry `details` | Run list, Plan vs actual |
| Entry correction / void / retry / reopen stage | Card | Free text | No code (`entries.py:918, 1073, 1088, 1196`) | Text | `continuous_entry_revisions.reason` | Entry history |
| Missed slot (36 h) | System sweep (`PR/routers/missed_slots.py`) | **Nothing**: nobody is asked why | n/a | n/a | Audit plus flag | Tracker / planner flag |
| Plan vs actual deviation | Report | The reason is worked out from the gate message (`PR/routers/plan_actual.py:81-95`) | n/a | n/a | n/a | Plan vs actual report |

### Quality

| Action | Page / who | How the reason is captured in the UI | Server checks the code against master? | Note mandatory? | Stored in | Shown later |
|---|---|---|---|---|---|---|
| QC hold (manual) | Quality › Holds & inspections (`UI/app/(dashboard)/quality/results/page.tsx:105-111, 188`); Admin, Plant Manager, QC, In-process QC | Free text | No code; 1+ character (`PR/routers/quality.py:1772`) | Text | `quality_holds.reason` | Holds list, card QC tab |
| QC hold (automatic on failure) | System | The failure summary is generated (`quality.py:1524-1534`) | n/a | n/a | Same | Same |
| **QC hold release** | Same page; Admin, Plant Manager (FAIL needs concession rights) | Free text, 3+ characters, plus a decision list (`results/page.tsx:97, 209-211`) | No code. Body schema needs 3+ characters, **but the body is optional: a release with no body has no reason** (`quality.py:2742-2753, 2833`) | Text | Audit payload only (reason and decision are not on the hold row) | Audit |
| In-process QC fail reason per parameter | QC entry (`StageQcFields.tsx:220-262`) | Free text per failing parameter, or "Cause under investigation" with containment and assignee | No master | Required on FAIL (`quality.py:1377-1393`) | `quality_inspections.reasons` (JSON) | Inspection register |
| Customer complaint (record) | Quality › Complaints (`quality/returns/page.tsx:78, 102, 152, 264`); Owner, Admin, Plant Manager, QC, Store, Sales, Dispatch | **Dropdown of CUSTOMER_COMPLAINT codes** (active) plus a note | **No.** Any 1–80 character string is accepted (`INV/routers/quality.py:463, 2336`). | **No**: CC-OTHER does not force a note | `customer_rejections.reason_code`, `reason_notes` | Complaints list and filter, **Quality report grouped by reason** (`INV/routers/quality.py:2121-2165`; `UI/app/(dashboard)/reports/quality/page.tsx:125, 159`) |
| Complaint decision (rework, scrap, accept…) | Same | Decision list plus free notes, root cause department, corrective action | n/a (decision list is fixed in code) | No | `customer_rejections` | Complaint case |
| Inward QC fail / decision | Quality › Incoming | Per-parameter free text plus a decision list | No master | Required on FAIL | `inventory_quality_inspections` | Register |
| Concession (use despite FAIL) | Quality › Incoming (`quality/incoming/page.tsx:301-306`); Owner, Admin, Plant Manager | Free text, 3+ characters | No code; server needs 1+ character (`INV/routers/quality.py:1385`) | Text | Concession record | Incoming page |
| Return rejected lot to supplier | Quality › Incoming (`incoming/page.tsx:321-328`) | Free text, 3+ characters | No code (`INV/routers/quality.py:901`) | Text | Lot metadata `supplier_return` | Lot / sources |

### Stores and stock

| Action | Page / who | How the reason is captured in the UI | Server checks the code against master? | Note mandatory? | Stored in | Shown later |
|---|---|---|---|---|---|---|
| **Stock correction (raise)** | Stock counts & book › Corrections; Store, RM Issue, GRN, Plant Manager (`stock_control.py:61`) | **Fixed list from the server** (`CORRECTION_REASONS`, sent to the screen) plus a note | Fixed-list check (`stock_control.py:2285-2290`) | Yes for OTHER (3+ characters) | `stock_adjustment_vouchers.reason_code`, `reason_notes` | Corrections list with reason name (`stock_control.py:2208`) |
| Correction approve / reject | Owner | Note; reject needs 3+ characters | n/a | Reject: yes | `cancel_note` | List |
| Adjustment voucher (old API) | **No screen uses it** (`UI/hooks/use-inventory.ts:512-545`, never imported) | n/a | **Any code accepted**, except that count-only codes are blocked (`stock_control.py:997-1043`) | No | Vouchers | Book |
| Stock count variance | Counts (rack counts) | Optional note per entry; send-back needs a 3+ character note (`INV/routers/stock_count.py:1599-1605`) | n/a: posted as PHYSICAL_COUNT_VARIANCE | No | Vouchers | Count / book |
| Month-end variance | Month end | Free note per item when outside tolerance (`PR/routers/reconciliation.py:1422-1429`) | n/a | Asked for, as a note | `monthly_material_notes` | Month-end page |
| Books unlock | Owner | Free text, 3+ characters (`INV/routers/books.py:54`) | n/a | Yes | Books log | Books page |
| Manual FG inward | Inventory › FG inward | Fixed dropdown plus notes | Fixed-list check (`fg_inward.py:223-225`) | No (not even for OTHER) | Movement metadata | Stock book |
| Manual receipt (no PO) | Inward | Free text, 3+ characters (`INV/routers/manual_receipts.py:43`) | n/a | Yes | `manual_reason` | Receipt |
| Opening stock on hold | Opening stock | Optional free text (`INV/routers/opening_stock.py:35`) | n/a | No | Lot | Label |

### Purchase

| Action | Page / who | How the reason is captured in the UI | Server checks the code against master? | Note mandatory? | Stored in | Shown later |
|---|---|---|---|---|---|---|
| PO reject (approval) | Purchase › Approvals and PO page | Free text | No code; 3+ characters (`INV/routers/purchase.py:1345-1346`) | Text | `rejection_reason` + approval decision | PO revision history |
| PO short close | PO page; Plant Manager, Owner | Free text | 3+ characters (`purchase.py:363, 1425`) | Text | PO metadata `short_close_reason` | PO page |
| PO cancel | PO page; Plant Manager, Owner | Free text | 3+ characters (`purchase.py:1441-1463`) | Text | PO metadata `cancellation_reason` | PO page |
| PO revision | PO edit | Free text change reason | 3+ characters (`purchase.py:368`) | Text | Revision `change_reason` | Revision history |
| Over-receipt on GRN | GRN | Free text | Needed when receiving more than the PO (`INV/routers/procurement.py:150, 470, 575`) | Text | Receipt approval history | GRN |
| GRN reject remainder | **API only, no screen** | n/a | **No reason field at all** (`purchase.py:437-450`) | n/a | Line | n/a |
| Invoice difference: accept variance / reject invoice / release stock | Purchase discrepancies; Plant Manager, Accounts | Action list plus free text | 3+ characters (`procurement.py:1108-1113`) | Text | `resolution_reason` | Discrepancy |
| Debit note create / void | Debit notes | Free text | Create 3+ characters; void reason required (`procurement.py:1220, 1335`) | Text | Debit note | Debit note / PDF |
| Purchase requisition reject / approve | Requisitions | Free text | 3+ characters (`INV/routers/requisitions.py:29, 79-80`) | Text | `decision_reason` + history | PR history |
| Purchase plan reject | Plans | Free text | Required for reject (`procurement.py:1548-1549`) | Text | Plan | Plan |
| Supplier schedule change / RM calendar cancel | Schedules | Free text (cancel reason optional) | n/a (`purchase.py:1760`; `procurement.py:1703`) | Change: yes | Schedule notes | Calendar |

### Dispatch

| Action | Finding |
|---|---|
| Dispatch cancel / reverse | **There is no such action.** The dispatch router only creates and reads (`PR/routers/dispatch.py:463-780`). Nothing asks for a reason because the action does not exist. |
| Short dispatch | Not a separate action. A shortage is handled through the V2 card shortage panel (SHORT_CLOSE master) or a sales short close (SO_CLOSE master). |
| Retain surplus | Free text, 5+ characters (`PR/routers/dispatch_surplus.py:24, 78-83`) |

---

## 3. Straight answers for sign-off

| Action | On screen | On the server |
|---|---|---|
| **Sales order short close** | Master: SO_CLOSE dropdown for the order's plant, active codes only | **The BFF checks against the master** (active SO_CLOSE code of the plant, `BFF/sales.py:305-331`). **The sales service does not**: it accepts any non-empty code and keeps whatever name it is sent (`SO/order_closure.py:127-135`). In normal use every request goes through the BFF. On AWS only Caddy ports 80/443 are open (`deploy/aws-ec2/docker-compose.yml:103-105`), so the service cannot be reached directly from outside. |
| **Sales order cancel** | Master (same) | Same as short close |
| **Customer hold & close** | Master (same) | Same as short close. The hold reason is erased on resume, cancel or short close (`sales_orders.py:2572-2573, 2643-2644`). |
| **Job card short close / force close / cancel ("Closed early")** | **Typed text** (3+ characters, quick-reason buttons fill example text) | **Typed text**, 3–500 characters, no code (`PR/routers/lifecycle.py:515, 600`) |
| **V2 stage short close** | **Typed text** | **Typed text**, non-empty (`entries.py:1134, 1158`) |
| **V2 card shortage at final QC** | **Master** (SHORT_CLOSE) | **Strict master check** (`operations.py:147-205`) |
| **QC hold / release** | **Typed text** | Typed text. Release can even skip the reason if no body is sent (`quality.py:2751-2753`). |

The owner's suspicion is **right for job cards (force close, cancel, stage short close), QC holds and everything in purchase**. It is **wrong for sales orders**: cancel, short close and hold all use the master.

---

## 4. Gaps and risks for live use

1. **Two different "short close" reason systems.** A sales order short close uses SO_CLOSE codes. A job card shortage at final QC uses SHORT_CLOSE codes. A job card force close, cancel, or V2 stage short close takes typed text. No report can answer "why did we lose quantity this month" in one view.
2. **Job card force close and cancel cannot be grouped in reports.** `job_cards.close_reason` is free text. The local verify database has entries such as "Released twice by mistake (test)", "Material short" and "Playwright test…": the quick-reason buttons give some consistency, but nothing enforces it.
3. **The master starts empty for the floor.**
   - Nothing seeds SHORT_CLOSE or DOWNTIME. With no SHORT_CLOSE codes, the V2 shortage panel shows "No active shortage reasons" and **a final-QC shortage cannot be closed** until someone adds one (`JobCardShortagePanel.tsx:126`).
   - Local verify DB: SHORT_CLOSE holds 1 test code (SEASON-VERIFY-SHORT), and DOWNTIME, SCRAP, QC_REJECT, RM_ISSUE, RETURN and OTHER hold none.
4. **Five categories do nothing.** SCRAP, QC_REJECT, RM_ISSUE, RETURN and OTHER appear on the master page, but no live action reads them. RETURN and QC_REJECT are read only by `UI/components/qc/CustomerReturnsPanel.tsx`, which no page uses. RETURN is also used as a fallback label on the complaints page. Users may fill these lists expecting them to drive something.
5. **Floor rejection codes are not in the master and not checked by the server.** The code list is fixed in the screen code (`model.ts:21-33`), and the server accepts a reject with no code. Local DB: 12 of 23 reject entries have no `reject_code` (for example "Visual defect" or "edge damage" typed by hand).
6. **The complaint reason is not checked on the server.** Local DB has a complaint with `CUSTOMER_REJECT`, a code that is not in the master. CC-OTHER does not force a note. The Quality report groups complaints by this code, so a stray code shows as its own group.
7. **The sales service trusts the BFF for SO_CLOSE codes.** If the BFF check is ever skipped (an internal script, a new route, or a direct call inside the server), any code and any name would be saved.
8. **Inactive or unknown codes on old records.** In the local DB, orders carry SO-CHECKER-THREE-9AEE4, SO-CHECKER-TWO-4BA50 and SO-CHECKER2-CHOSE-ANOTHER-SUPPLIER, which are now inactive; that is fine by design. They also carry **SO-CHECKER-FOUR-B-865C5, which is no longer in the master at all**. It looks like the code was changed before the "code never changes" lock. The saved name keeps such records readable.
9. **Test reasons are active in the SO_CLOSE list (local DB):** SO-GOLIVE-B1A6, SO-UI-REASON-865C5, SO-WRONG-PRODUCT-SENT-TO-ANOTHER-UNIT and SO-CUSTOMER-CHOSE-ANOTHER-SUPPLIER. If the live database had test runs, its list needs the same clean-up before go-live.
10. **The customer hold reason is lost.** Resume, cancel and short close erase `hold_reason` and `hold_reason_code` on the order, and the hold never appears in the order timeline. Only the audit log keeps it. Resume asks for no reason.
11. **Nowhere to report by reason for orders.** The SO register has no filter by closure or hold reason (`sales_orders.py:1042-1060`), and no report groups cancelled or short-closed quantity by reason. Only complaints (Quality report) and job card shortages / downtime (Operations report) group by code.
12. **The order history does not show why a job card was force-closed.** The order timeline shows "Line N balance returned / Job card force-closed" without the reason (`sales_orders.py:2154-2184`). The reason is visible only on the card or in the audit log.
13. **Smaller server gaps:**
    - A QC hold can be released with no body, so no reason is recorded (`PR/routers/quality.py:2751-2753`).
    - Editing a downtime record skips the master check (`operations.py:1347`).
    - Splitting a card and editing qty or colour have an optional reason on the server, even though the screen requires one (`lifecycle.py:340, 397`).
    - When an Owner works in "All plants" view, the SO_CLOSE check (BFF) and the SHORT_CLOSE check (production) look at every plant's codes, so another plant's code would pass. This is low risk because the screen sends the order's or card's own plant.
14. **The reason name is saved for SO closes, but not for shortage records.** `closure_reason` keeps the name as it was at close time; good. `job_card_short_close` and `machine_downtime` keep only the code, so renaming a code changes how old records read.
15. **The helpful comment is wrong.** The production comment calls the check "soft-validate" (`operations.py:645`), but the function is strict (`147-205`). The behaviour is correct; only the comment is misleading.

## 5. Decisions the owner should make (options only, no changes made)

1. **Job card force close / cancel / V2 stage short close reasons**
   - A. Leave as typed text with quick buttons.
   - B. Add a code from the master (reuse SHORT_CLOSE, or a new "Job card close" category) plus an optional note, so it can be reported like sales orders.
   - C. Use the SO_CLOSE list for card cancels that come from the customer, and SHORT_CLOSE for floor shortages.
2. **One shortage list or two.** Keep SO_CLOSE (commercial) and SHORT_CLOSE (production) separate, or merge them into one list.
3. **Seed floor lists before go-live.** Who writes the first SHORT_CLOSE and DOWNTIME lists (the V2 shortage panel blocks without them)? Add a CUSTOMER_COMPLAINT seed like SO_CLOSE has?
4. **Unused categories (SCRAP, QC_REJECT, RM_ISSUE, RETURN, OTHER).** Hide them, or connect them (for example: rejection codes on Log output → SCRAP; QC fail → QC_REJECT; inward rejection → RM_ISSUE).
5. **Floor rejection codes.** Keep the fixed list of 11 in the code, or move it to the master; and decide whether the server should require a code when rejected qty is above 0.
6. **Server-side checking.** Should every service check codes against the master (sales for SO_CLOSE, inventory for complaints), not just the BFF? Should OTHER-type codes always need a note (complaints, manual FG)?
7. **Hold history.** Keep the hold reason after resume (as history and in the order timeline), and ask for a reason on resume?
8. **Reporting.** Is a "Cancelled / short-closed by reason" view (qty, value, customer, month) needed on day one, and a reason filter on the SO register?
9. **Purchase and QC reasons.** PO reject / cancel / short close, requisition reject, invoice differences, debit notes, QC hold and release are all typed text. Is that acceptable for audit, or do any need coded reasons for supplier scorecards?
10. **Clean-up before go-live.** Deactivate test SO_CLOSE codes in the live master, and decide what to do with records carrying codes that no longer exist.

## Appendix: local data checked (read-only SQL, `hariom_nverify_season_*`)

- **masterdb `reason_code`** (one plant, `…00a1`):

  | Category | Rows | Active |
  |---|---|---|
  | SO_CLOSE | 28 | 13 (9 seeded + test ones) |
  | CUSTOMER_COMPLAINT | 8 | 8 |
  | SHORT_CLOSE | 1 | 1 (test code) |
  | DOWNTIME and all others | 0 | 0 |

- **salesdb**: about 40 cancelled or short-closed orders, all carrying SO_CLOSE codes plus saved names. Three orders on hold carry codes. One code used on orders is missing from the master; three are now inactive.
- **productiondb**:
  - `job_cards.close_reason`: free text only (23 cancelled, 2 force-closed).
  - V2 stage short closes: free text such as "e2e", "short 4" and "checker short".
  - `job_card_short_close`: 1 row with a code.
  - `machine_downtime`: 0 rows.
  - Reject entries: 12 of 23 have no code.
- **inventorydb**:
  - Stock vouchers: only the fixed-list codes plus PHYSICAL_COUNT_VARIANCE.
  - Complaints: CC-STRENGTH, CC-SIZE, and **CUSTOMER_REJECT (not in the master)**.
