# Verification report: go-live build (1 Nov 2026)

Independent verification of the uncommitted work on `3c85b67`, checked against the owner decisions 1–8 in `BUILD_BRIEF.md`. Nothing is committed.

**How it was checked**
- On the local season stack, with new data made the way a user would:
  - Two sales orders were created in the UI and released from the order page. SO/26/11/01 (300 pcs) became card 26/11/03; SO/26/11/02 (500 pcs) became card 26/11/02.
  - A second user, "Verify Checker" (Owner, Admin, Plant Manager), was created in System › Users. Its test password is kept only in a local file, `scratchpad/v/checker.pw`. That user approved SO/26/11/01.
- Browser checks used headless Playwright. API calls went through the BFF, and also straight to the services to confirm that the service that owns the record does the checking.
- Screenshots are in `/private/tmp/claude-501/-Users-devarshthakkar-Downloads-hari-om/5b43ce2c-7ba5-4623-a1f5-d380fc403344/scratchpad/verify-shots/`. The names in the Evidence column below are files in that folder.

## 1. Scenarios

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Order created in the UI, approved by a second user, released (one card per colour) | PASS | `a3-order-*`, `a4-*`, `a5-released-*` |
| 2 | **Full V2 run (26/11/03, 300 pcs, 45 per box)**<br>• Winding 30 → Oven 30 → Process runs of 100, 120 and 80<br>• Boxes are packed only after a run's QC readings are in; leftover pcs carry to the next box (box 003 = 10 + 35)<br>• Process close made part box 007 of 30<br>• Each box is its own FG batch: FG_INWARD, `external_ref FG-BOX-<id>`, batch = box code | PASS | `b3-*`, `b5-*`, `d2-full-*` |
| 3 | **Out-of-band QC readings flag and never hold**<br>• Winding C.S. 150, Oven C.S. 300 and Process weight 45 were saved as FAIL and flagged<br>• No `quality_holds` row was created<br>• Flagged boxes stayed UNRESTRICTED, could ship, and show "QC flagged" on the box, card, register and challan | PASS | `b5-winder-qc-readings.png`, `c2-challan-boxes.png` |
| 4 | **Partial dispatch while Process was still running**<br>• Box 001 scanned by code, box 003 by its QR URL, box 004 ticked: 135 pcs sealed<br>• Stock was taken out per box (`PROD-DISPATCH-BOX-<id>`)<br>• Order went to PARTIALLY_DISPATCHED | PASS | `c3-partial-*` |
| 5 | **Box labels**: A4 8-up, A4 21-up and single 100×75 mm<br>• Fields: plant heading, customer, product, size + colour, card, SO + PO, box code, pcs, packed date / shift / operator, QR<br>• Box page opens from `/scan` | PASS | `d1-box-labels.png`, `d1-box-page.png`, `d1-scan-box.png` |
| 6 | **Final challan from "Select all ready"**<br>• "3 boxes × 45 + part box 30 = 165 pcs", every box code listed, part box marked<br>• Packing block comes from the spec: R-150, 45 per box, 1 × PS-150 plastic, 2 × FD-3 fadda<br>• Card COMPLETED; order CLOSED at 300/300 | PASS | `c4-final-sealed.png` |
| 7 | **Packing theory (month-end)**: R-150 = 7 boxes, PS-150 = 7, FD-3 = 14, from master weights; one `box_theory` effect per box | PASS | DB `monthly_material_provisionals` |
| 8 | **Short close at Winding, done in the UI (26/11/02)**<br>• Picker required; 30 of 50 bamboo closed with SS-MATERIAL-SHORT<br>• 200 pcs went back to the order at once, with code, label and note in Sales<br>• Oven and Process targets cut to 30 bamboo / 300 pcs; planner slots shrank from 500 to 300 | PASS | `e1-winder-short-*` |
| 9 | **Short close at Oven and then Process**<br>• Oven 25 of 30 → 50 pcs returned<br>• Process 240 of 250 → 10 pcs returned, part box of 15<br>• The card stayed open until downstream closed<br>• Invariant: 200 + 50 + 10 returned + 240 FG = 500 released | PASS | `e2-short-*` |
| 10 | **Reopen of a short-closed Process in the UI**: Sales return marked REVERSED with EC-REOPEN-MORE; card back to 250 released | PASS | `e3-reopen-process.png` |
| 11 | **More runs after that reopen** | **FIXED** | Defect F3 below |
| 12 | **Process closed short a second time** after the fix<br>• New return key `close:2` for 5 pcs; second part box of 5<br>• Invariant: 255 + 245 = 500 | PASS | DB |
| 13 | **Reopen refused once the balance was released again** (252 released again in the UI): "only 3 of the 5 pcs … still unreleased"; nothing changed | PASS | `e4-reopen-refused.png` |
| 14 | **Order short close of the unreleased balance (3 pcs) in the UI**<br>• Picker required; the OTHER code keeps Confirm disabled until a note is typed<br>• SO-QTY-REDUCED label shown on the order<br>• A later reopen was refused: "dropped when order SO/26/11/02 was short-closed" | PASS | `f1-*` |
| 15 | **Split, edit qty, emergency insert and cancel from the Job card manager**<br>• Review stays disabled until a reason is picked<br>• Code, label and note are stored in the audit or on the card (`close_reason_code`, `_label`, `_note`) | PASS | `i1-*` |
| 16 | **Retain surplus (split card 26/11/04-A)**<br>• 49 pcs → box of 45 shipped, part box of 4 kept<br>• Reason SR-NEXT-ORDER stored; box RETAINED; card COMPLETED; order CLOSED at 290/290 | PASS | `j2-*` |
| 17 | **Operator choice limited to the stage's department**<br>• Output and QC forms, Winding / Oven / Process, at PC and phone width, list only that department's employees<br>• The server refuses a wrong department: "Oven Operator One is not in the Winding department…" | PASS | `o1-*`, API |
| 18 | **Reasons: 13 inputs checked**<br>• Live API, sent straight to the owning service:<br>&nbsp;&nbsp;– production: stage short close, QC hold, month-end variance<br>&nbsp;&nbsp;– inventory: books unlock, reel serial, stock correction<br>&nbsp;&nbsp;– sales: order hold<br>&nbsp;&nbsp;– each one refuses free text, an OTHER code with no note, and a code from the wrong list, in plain words<br>• UI: order short close, split, edit, emergency insert, cancel, retain surplus, reopen<br>• Labels then show on the order, card history and Sales returns<br>• The reasons sub-agent also checked requisition, stock policy and incoming hold | PASS | `probe.py` output; `reasons-*.png` |
| 19 | **Packing setup page**<br>• A spec box code that is not in the master (R.125) is highlighted with "Add box", and Save is refused<br>• Picking R-150 saves straight to the spec, audited in `spec_packing_amendments`<br>• Pushing packing into open cards worked in the earlier amendment: 11 cards updated, 5 skipped because they already had packed boxes<br>• The approval block for a spec with no box is covered by spec tests | PASS | `m1-*`; packing agent `01..10-*.png` |
| 20 | **Reel labels (decision 6)**<br>• GRN posted in the UI against PO RP-PM/68 → AIT 06283 and AIT 06284<br>• Layout matches the plant label exactly: heading, mill / invoice / dd-Mon-yy, PLYBOND / VARIETY / GSM, ROLL NO, big AIT serial, WEIGHT, QR<br>• The next-number setting (System › Plants) can only go up, needs a REEL_SERIAL code and is audited<br>• Scanning "AIT 06283" opens the reel's incoming QC | PASS | `k3-inward-posted.png`, `l1-reel-serial-setting.png` |
| 21 | **Coil serial (`AIT 06283-1`)**: not walked live, because the reel must first be issued to slitting after incoming QC. Covered by `test_reel_serial_postgres` / `_rules`. | PASS (tests) | — |
| 22 | **Employee report matches the logged runs**<br>• Per operator, today: runs, made, good, rejected and flagged agree with the DB (Process 8 runs, 899 / 889 / 10, 1 flagged)<br>• Phone width in dark mode looks right | PASS | `n1-*` |
| 23 | **V1 old-form cards**<br>• No local V1 card is part-made below plan, and every V1 card has winding complete<br>• Live: completing below plan stops first at the 2-readings gate (kept as designed); force close refused because everything planned is already made<br>• The below-plan reason (409 SHORT_REASON_REQUIRED, then 422 for free text) and force-close reasons are covered by tests | PARTIAL (tests) | API |
| 24 | **Card numbers agree across screens**<br>• Order page, job card list ("255 back to SO"), card page and dispatch register agree<br>• The Job card manager stage track did not agree | **FIXED** | Defect F6 below; `h2-card-manager-short.png` |
| 25 | **New pages in dark mode at 390 px**: box page, packing setup, box labels, challan, card. No sideways scroll, no page errors. | PASS | `p1-dark-phone-*` |
| 26 | Console errors on new pages | PASS | Only the expected 401 from the login page before sign-in |

## 2. Defects fixed

All fixes are small, kept within the brief, and each one has a regression test. Each new test failed without its fix.

| # | Sev | Defect | Fix (files) | Test |
|---|---|---|---|---|
| F1 | High | **Reopen could leave Sales and production disagreeing.** Reopening a short-closed stage asked Sales to take the balance back, and Sales committed, *before* the check that refuses a reopen when the leftover input was scrapped. The refusal then rolled production back, so the order line lost the pcs for good. | The residual check now runs before Sales is called; the message is in plain words. `production-service/src/routers/entries.py` | `test_reopen_refused_for_scrapped_leftover_never_asks_sales` |
| F2 | High | **Old-form (V1) shortage double count.** The commercial short close in Operations Control worked out the gap from `planned_qty`, ignoring pcs a V1 stage short close had already returned. Example: 530 pcs taken off the line instead of 10, and the card's 470 pcs freed for release again. | The gap now uses `current_released(job)`. `production-service/src/routers/operations.py` | `test_v1_shortage_gap_leaves_out_pcs_a_stage_already_gave_back` |
| F3 | High (found live) | **A reopened stage closed itself.** After a reopen all of the stage's planner slots were still COMPLETED. The next unplanned run's slot sync set the stage back to COMPLETED, with no close, no part box and no return. It happened on 26/11/02: 5 pcs were left unboxed and the card was stuck. The bug was already in the base code, but it breaks decision 1's reopen. | Reopen sets the latest completed slot back to RUNNING. `entries.py` (the local card was repaired, then reopened and closed again) | `test_reopened_stage_stays_open_when_the_next_run_syncs_its_slots` |
| F4 | Medium | **A return could be counted twice on reopen.** A `sales_return` effect that was tried but not confirmed (timed out, or the worker was mid-delivery) was cancelled without asking Sales, so an ACTIVE return could stay in Sales while the card took the pcs back. | The effect row is locked. If it was ever tried, Sales is asked to reverse it; a 404 means "never recorded" and is accepted. `production-service/src/short_close.py`, `entries.py` | `test_reopen_after_a_failed_delivery_asks_sales_and_accepts_nothing_recorded` |
| F5 | Medium | **Retain surplus could keep a box that still fits.** It could mark a box RETAINED, and send the room back to the order, while that box was still being posted to stock. | Retain is refused while any packed box is not yet in stock. `production-service/src/routers/dispatch_surplus.py` | `test_surplus_waits_for_every_packed_box_to_be_in_stock` |
| F6 | Medium | **Job card manager showed the original plan.** After short closes it showed Oven 25/50 b, Process 240/500, a +10% figure on 500, "Back to order 255 · not released again yet" (false once the pcs were released again), and family "500 pcs". | V2 stages now use the stage's own target and good total; held qty is used for tolerance and family. The wording now says "given back to the order…". `production-service/src/routers/lifecycle.py`, `web-ui/components/production/job-card-manager.tsx` | `test_card_manager_shows_the_cut_targets_and_good_totals` |
| F7 | Low | A dispatched box showed "In stock" on its box page and on the card's Dispatch tab. | Shows "Shipped: out of stock" / "Shipped". `app/(dashboard)/production/boxes/[code]/page.tsx`, `components/production/card/tabs/DispatchTab.tsx` | tsc, eslint |
| F8 | Low | Box dispatch errors were not plain English: raw exception text, "box_ids must be a list". | Plain words. `production-service/src/routers/dispatch.py` | dispatch tests |
| F9 | Low | `__tests__/dispatch-boxes.test.ts` was never run by `npm test`. | Added to `test:unit`. `apps/web-ui/package.json` | npm test |

**Coordinator request (done by a reasons sub-agent; details in its own notes):** these free-text reasons were moved to master codes, with picker, owning-service check, stored code / label / note and startup DDL.
- Incoming QC out-of-band reason
- PO revision "Change reason". The server already required a code, so the web was refusing every revision of an approved PO.
- GRN / lot label reprint
- Reel serial "set next number"
- Stock alert policy
- RM cost draft
- Requisition "Why is this needed?"
- Inward QC band change
- Spec-service: stage-rule version, spec QC values, recipe revision, season switch. A new `spec-service/src/reasons.py` was added.
- Legacy stage QC correction
- Slitting card correction

New categories: INCOMING_QC, QC_RULE_CHANGE, LABEL_REPRINT, REEL_SERIAL, STOCK_POLICY, RM_COST_CHANGE, PURCHASE_NEED, SPEC_REVISION, SEASON_SWITCH, each with an OTHER code.

Reel screens that asked for an "AT number" now say "AIT / reel number".

Left as they are, with the reason:
- Floor material returns: the endpoint is retired.
- Manual-receipt commercial review note: an approval note, not a reason.
- Supplier delivery rows with no schedule: they never reach "Change date".
- `FinalQcForm.tsx`: not used anywhere.
- System texts that nobody types.

## 3. Open issues: follow-up (1 Nov 2026, second pass)

Eight items were fixed after the verification. Six stay as they are (owner decisions or by design). Each fix is small, keeps to the owner decisions and changes no flow. Each has a test that fails without the fix. Browser screenshots are in `scratchpad/fix-shots/`.

**Medium**
1. **FIXED: sales stage-return endpoints now accept only the right callers.**
   - Create accepts only the production effects worker (`ProductionEffects`) or an Owner/Admin.
   - Reverse accepts Owner/Admin and `ProductionEffects`. Production's reopen is Owner/Admin only and sends the user's own token, so reverse keeps working.
   - Planner, PlantManager and Sales tokens now get 403 on both.
   - Files: `sales-service/src/routers/release_returns.py`.
   - Test: `sales-service/tests/test_stage_return_roles.py` (14 cases).
2. Surplus with a part box larger than the room left: **left as is.** By design; it needs the owner's confirmation.
3. Two part boxes after a reopen: **left as is.** By design.

**Low**
4. **FIXED: reopen leaves DELIVERED `tools` / `theory` effects alone.**
   - Reopen now calls off only PENDING or FAILED tools / theory / FG effects. A DELIVERED one stays as the record of what was posted.
   - Closing the stage again sets a delivered `tools` / `theory` effect back to PENDING, so it is posted again with the new totals.
   - This is safe because both postings are worked out again in full, never added on. Posted FG (`fg_inward`) is never set back to PENDING.
   - A later reopen is no longer refused by a cancelled effect that had attempts on it.
   - Files: `production-service/src/routers/entries.py` (`effect()` and the reopen loop).
   - Tests: `test_reopen_leaves_delivered_tools_and_theory_alone_and_the_next_close_reposts_them`; `test_release_ack_and_noop_tools_allow_reopen_but_posted_stock_does_not` updated.
5. No pcs per bamboo on the spec: **left as is.** Only misconfigured specs are affected.
6. **FIXED: the challan line now reads correctly with a part box.**
   - Example: Units **4** · PCS/Unit **"45 (part box 30)"** · Total **165**. This matches the boxes block "3 boxes × 45 + part box 30 = 165 pcs".
   - Other cases: several part boxes read "45 (part boxes 30, 5)"; a challan with only a part box reads "part box 30".
   - Screen, phone and print all use the same cell. There is no server challan PDF: the PDF is the printed page.
   - Files: `web-ui/lib/dispatch-document.ts` (`challanPerUnitText`, `perUnitText`), `components/dispatch/dispatch-document.tsx`.
   - Test: `__tests__/dispatch-boxes.test.ts`. Seen in the browser: `challan-print-media.png`.
7. Card family shows split cards only: **left as is.** By design.
8. **FIXED: the cancel / force-close result now says where the pcs went.**
   - Sales return-balance now reports `balance_dropped` (true when the order is short-closed or cancelled). Production passes it on in the force-close result and in the card-history audit.
   - When the pcs were dropped, the result panel and toast say so: "40 pcs were dropped: the sales order is short-closed or cancelled…". The card history reads "N pcs dropped (order closed)".
   - "Back on the order … re-release" now shows only when the pcs really went back.
   - Files: `sales-service/src/routers/sales_orders.py`, `production-service/src/routers/lifecycle.py`, `production-service/src/routers/card_history.py`, `web-ui/components/production/job-card-actions.tsx`.
   - Tests: `test_force_close_return_says_whether_the_pcs_went_back_or_were_dropped` (sales); `test_cancel_on_a_short_closed_order_says_the_pcs_were_dropped` (production).
   - Browser: both wordings checked with the server answer mocked, so the card was not cancelled (`cancel-result-*.png`).
9. **FIXED: order page.**
   - **Deliveries tab:** it counts sealed challans. A new endpoint, `GET /dispatch/by-job/{id}/sealed` (BFF `/api/dispatch/by-job/{id}/sealed`), lists every challan of every card, so a box card's partial and final challans both show. SO/26/11/01 shows 2, SO/26/11/02 shows 2.
   - **Header:** it shows the card mix in words, for example "1 card · 1 waiting for dispatch" (SO/26/10/390) or "3 cards · 2 done · 1 cancelled". The old "0 of 1 card running" is gone.
   - **Buttons:** Release and Short close / Cancel are hidden on closed, cancelled and short-closed orders. Release is also hidden when nothing is left to release (a draft still shows it, disabled).
   - Files: `production-service/src/routers/dispatch.py`, `bff-api/src/routes/dispatch.py`, `web-ui/lib/api.ts`, `web-ui/lib/sales-order-tracker.ts` (`cardMixText`), `app/(dashboard)/sales-orders/[orderId]/page.tsx`.
   - Checked in the browser (`so*-order.png`, `so*-deliveries.png`). It has no unit test, because the tracker module imports through the `@/` path alias.
10. **FIXED: loosely typed serials and box codes are found.**
    - `ait6284`, `AIT6284`, `ait 6284` and `AIT-06284` find AIT 06284 in `/scan`, the reel issue desk (scan box and list search) and the incoming QC search. The server reel search already normalised them; the web pages compared exact text.
    - A box code typed without its dash or with spaces (`b261103001`, `B261103 002`) opens the box when exactly one box in the plant matches. This works in `/scan` (server `find_box` in the box page lookup) and in the dispatch box scan (within the card).
    - Files: `web-ui/lib/lot-find.ts` (`reelSerial`, `sameNumber`), `web-ui/lib/boxes.ts` (`compactBoxCode`, `pickBox`), `scan/page.tsx`, `inventory/reels/issue/page.tsx`, `quality/incoming/page.tsx`, `production-service/src/routers/boxes_api.py`.
    - Tests: `__tests__/lot-find.test.ts`, `__tests__/dispatch-boxes.test.ts`, `test_box_page_finds_a_box_typed_without_dashes_when_only_one_box_matches`.
    - Checked in the browser for all six typed forms.
11. Reel label mill cell for a vendor with no short name: **left as is.** The fix is to set short names in Masters › Vendors.
12. **FIXED: a new plant gets its reason codes on first use.**
    - The first time a plant's reason lists are read or checked (list, categories, validate), masterdata seeds that plant. It uses the same seed log as start-up, so a plant's own edits are never overwritten. An advisory lock prevents a double seed, and a per-process cache keeps later calls free.
    - A restart is no longer needed.
    - Files: `masterdata-service/src/reason_seed.py` (`ensure_plant_reason_codes`, shared `_seed_plant`), `masterdata-service/src/routers/shop_floor.py`.
    - Test: `masterdata-service/tests/test_reason_seed_new_plant_postgres.py`.
13. **FIXED: each box posts only its own packing theory.**
    - The `box_theory` effect now adds only that box's box / plastic / fadda to the card's month rows. It no longer re-posts the whole card (paper, adhesive, parchment and every box) and fetches no paper or adhesive catalogue.
    - It uses the same month rules as before: the IST day of Process, never into a closed month, one row per card per material.
    - Rows record which boxes they count (`box_ids`), so a retried box, or a box the whole-card posting already counted, is never added twice. When it cannot simply add (rows posted before this change, a unit change, or a merge across months), it falls back to the whole-card posting.
    - Process close still posts the whole card, so final totals are unchanged.
    - Files: `production-service/src/routers/planning.py` (`_post_box_packaging_theory`; `box_ids` on box packing rows), `production-service/src/completion_worker.py`.
    - Test: `test_each_box_adds_only_its_own_packing_theory_and_totals_match_the_whole_card_posting`. The sum over 3 boxes equals the old whole-card rows (same month, kg, pcs and box count). After the close plus a part box, the result equals the whole-card posting, with no double count. The month-end suite (`test_month_end_close_postgres.py`) passes.
    - **One known difference:** while a card's Process is still running, paper / adhesive / parchment theory now posts only at Process close, no longer with each box. If a month is closed while a box card's Process is still running, that month holds the card's boxes' packing but no paper. Before, it held paper for the pcs boxed so far. In both cases the rest of the card was never posted, because of the frozen-month rule. Months closed after the card's Process close are identical.
14. Two older eslint warnings: **left as is.**

Second-pass tests:
- production: Postgres 632 passed, 34 skipped (fresh DB `hariom_nverify_hardening_test_v1101fix_production`); unit 454 passed.
- sales: Postgres 151 passed; unit 100 passed.
- masterdata: Postgres 53 passed.
- BFF: 134 passed.
- web: `npm test` passes; `npx tsc --noEmit -p apps/web-ui` is clean; eslint on the changed files shows 0 problems.
- Local stack: production, sales, masterdata and the BFF were restarted.

**Environment / test debt**
- **Production:** 37 `*_live.py` tests (qct043–qct065) need auth-service on its default port 28001. They fail the same way at base.
- **Inventory:** 16 PO-approval live tests fail with 403 at base too.
- **Sales:** one `test_original_wave2_live` test fails at base.
- **Spec:** two qct037/038 tests fail because of a foreign test-DB schema.

## 4. Tests run

| Suite | Result |
|---|---|
| production pytest, unit | 453 passed (sub-agent run) |
| production pytest, Postgres (fresh DB, final code) | 536 passed, 37 failed (all `*_live.py`, auth port 28001: environment), 30 skipped |
| production box / short-close / lifecycle / reason / surplus, Postgres | `test_boxes_short_close_postgres.py` 18/18 passed, 5 of them new |
| inventory | unit 161 passed; Postgres 332 passed (reasons agent), with only the base live failures |
| sales | unit 86 passed; Postgres 158 passed, with 1 failure that is also at base |
| spec | unit 89 passed; Postgres 102 passed (reasons agent) |
| masterdata, auth, bff | 51, 38 and 134 passed; auth Postgres 47/47 |
| web `npm test` | pass, now including dispatch-boxes |
| `npx tsc --noEmit -p apps/web-ui` | clean |
| eslint, changed files | 0 errors |

**Schema on boot:**
- Every new column has an `ALTER … ADD COLUMN IF NOT EXISTS` in its service's startup list, and new tables come from `create_all`.
- Existing DB: the local services restarted on it with the new columns.
- Fresh DB: the throwaway test databases were built from scratch the same way.

## 5. Production build

`cd apps/web-ui && NEXT_DIST_DIR=.next-verify npx next build` was run again after all agents' changes and after my fixes.
- Result: **success**, with no prerender errors.
- `tsconfig.json` and `next-env.d.ts` were restored with `git checkout`, and `.next-verify` was deleted.
- The dev server on port 13003 still answers.

## 6. Local data and processes left behind

**Local stack**
- New sales orders: SO/26/11/01 (closed) and SO/26/11/02 (closed after its short close).
- New cards: 26/11/02, 26/11/03, 26/11/04 (cancelled), 26/11/04-A.
- GRN P/26/021 with reels AIT 06283 and AIT 06284. The next reel serial is set to AIT 06290.
- User verify.checker@hariom.com (Owner, Admin, Plant Manager).
- Production service restarted three times to load the fixes. Masterdata, inventory and spec were restarted by the reasons agent.

**Throwaway test databases** (safe to drop):
- `hariom_nverify_hardening_test_v1101*`
- `hariom_nverify_procurement_test_hardening_test_v1101*`
- `hariom_nverify_v1101_vfix`
- `hariom_nverify_v1101_vfinal`
- `hariom_nverify_hardening_test_v1101fix_production`, `_sales`, `_master` (second pass)
