# Hari Om TubeOS: all worked samples and examples (collected from every chapter)
Accurate as of 31 October 2026. Values are examples, not real customers.


## From chapter 00: Welcome to Hari Om TubeOS: the big picture

Sharma Tubes Pvt Ltd sends PO GOLIVE-PO-118 for 5,000 pcs of 76.4 x 81 x 150 at ₹2.75 per pc: 3,000 BLUE and 2,000 RED.
1. Sales enters **SO/26/10/412**; a planner approves it.
2. Sales releases it: two job cards, **26/10/315** (BLUE, 3,000 pcs) and **26/10/316** (RED, 2,000 pcs), go to the winder queue.
3. The planner places 26/10/315 on a winder, Shift A, 31 Oct. Operators log Winding, Oven and Process runs with two QC readings each.
4. Meanwhile the RM inward calendar shows Kraft 300 GSM running short on 4 Nov. The Owner approves an arrival; PO **RP-PM/68** goes to Bharat Paper Mills, arrives as **P/26/014** with 12 reels, passes incoming QC and is issued to the floor.
5. As 26/10/315's Process runs get their readings, its pcs are packed in boxes of 48. Dispatch ships the first 40 boxes (1,920 pcs) while Process is still running. Process then closes with 2,990 good pcs (10 short of 3,000, reason SS-HIGH-REJECT): 62 full boxes and a part box of 14, and 10 pcs go back to the order. The second challan takes the other 23 boxes (1,070 pcs). The order shows **Partly dispatched** until 26/10/316 ships too.


## From chapter 01: Getting started

Ramesh is a Planner who also covers Sales on Saturdays, so his login has both roles.
- He signs in and lands on the **Planning board** (Planner comes first).
- He opens the role box and picks **Sales**; TubeOS opens **Orders**.
- He presses Ctrl+K, types "calendar" and opens **RM inward calendar**, which he sees because his Planner role has it.
- At 1:30 pm he leaves for lunch. At 1:50 pm the page asks him to sign in again; after signing in he is back on the RM inward calendar.


## From chapter 02: Dashboard and inbox

Monday 9:00, the Owner opens TubeOS:
- Headline: "2 overdue job cards, 1 card on QC hold and 4 low-stock materials need attention in Plant A."
- Action center: **Sales orders to approve 3** (SO/26/10/418 Sharma Tubes Pvt Ltd · draft · 5,000 pcs), **Purchase orders to approve 1** (RP-PM/70 Bharat Paper Mills · revision 1 · ₹4,12,500), **RM arrivals to approve 2** (Kraft 300 GSM · 4 Nov · 2,500 kg).
- She approves the SO from its order page, the PO in PO approvals and the arrivals on the RM inward calendar. Back on the dashboard the three lanes show "Nothing waiting".
- Inbox: **Needs action 12**. She opens "Purchase order awaiting approval: RP-PM/70" (already done, so it is just marked read) and presses **Mark all read**.


## From chapter 03: Using TubeOS on a phone

Suresh, winder operator, Shift A, 31 Oct:
1. 08:15: he scans the QR on job card **26/10/315** (Sharma Tubes Pvt Ltd, BLUE, 3,000 pcs = 300 bamboo × 10). The card opens on **Winding**.
2. He taps **Log output**: machine SHARMA_WINDER-2, 120 bamboo produced, 118 accepted. Rejected 2 is worked out by the system. He saves; the run goes to the supervisor.
3. He taps **Log QC** for Run 1 and enters two readings for each winding check. One C.S. reading is outside the band: it is saved with a flag.
4. 08:40: store keeper Anil scans reel **AT-26-0412** (Kraft 300 GSM, 412 kg). Reel & coil issue opens with the reel picked; he presses **Issue**. It is recorded as Shift A, 31 Oct, and listed under Slitting cards to write.


## From chapter 04: Sales orders

Sharma Tubes Pvt Ltd sends PO 4500012345 dated 28 Oct for 76.4 x 81 x 150 tubes.

| Field | Value |
|---|---|
| Line 1 qty | 5,000 pcs at ₹2.75 (last rate ₹2.75 on SO/26/10/388, pressed **Use**) |
| Colours | BLUE 3,000 pcs; RED 2,000 pcs at ₹2.80 |
| Line value | 3,000 × 2.75 + 2,000 × 2.80 = ₹13,850 ex-GST |
| Delivery date | blank → "No date" |
| Expiry | blank → 45 days from 28 Oct = 12 Dec |

1. Priya (Sales) creates it: **SO/26/10/412**, Draft. She presses **Send for approval**.
2. Ramesh (Planner) presses **Approve**: Ready to release.
3. Priya releases: BLUE 3,000 on SHARMA_WINDER-1, RED 2,000 on SHARMA_WINDER-2. Two job cards, 26/10/315 and 26/10/316. Status: In production.
4. On card 26/10/315, Winding closes short at 270 of 300 bamboo (SS-MATERIAL-SHORT). 300 pcs come back to the BLUE line at once; the History tab shows "Winding closed short: 300 pcs back to the order — Paper or input short". Priya releases them again as card 26/10/321. Card 26/10/315 ships its 2,700 pcs in boxes: **Partly dispatched**, "2,700 of 5,000 dispatched".
5. The customer now says it does not want the RED pieces. They are already on 26/10/316, so Short close has nothing to drop and explains: "Everything left is already on job cards; the order closes by itself once they are dispatched." To stop the card, the planner cancels 26/10/316 in the Job card manager (nothing made yet) with JC-CUST-CANCEL. The 2,000 pcs come back to the line; Priya presses **Short close** with SO-BALANCE-NOT-REQ. If the order had been short-closed first, the balance the card hands back would have been dropped at once.


## From chapter 05: Specifications

Sharma Tubes Pvt Ltd orders 76.4 x 81 x 150 tubes, dry weight 33.78 g, C.S. 400 kgf, 10 pcs per bamboo.

| Item | Rest of year | Monsoon |
|---|---|---|
| Paper | SHARMA_300 Kraft 300 GSM × 3 plies | SHARMA_300 × 2 plies + Kraft 280 GSM × 1 ply |
| Paper weight | 32.74 g | 32.10 g |
| Adhesive | Glue 100%, 4.22 g | Glue 100% |
| Revision | r1, approved | r2 (revised 15 Jun, "Higher humidity, lighter outer ply"), approved |

- In June the Owner switches the season to **Monsoon**. SO/26/06/120 released on 16 Jun gets job card 26/06/044 with the Monsoon r2 recipe frozen on it.
- On 1 Oct the Owner switches back to **Rest of year**. Card 26/06/044, still open, keeps Monsoon r2. New releases use Rest of year r1.


## From chapter 06: A day in the life

Thursday 31 Oct, Plant A:
- 08:10 Priya (Sales) enters SO/26/10/418 for Sharma Tubes Pvt Ltd, 2,000 pcs RED, and sends it for approval.
- 08:30 Ramesh (Planner) approves and releases it: job card 26/10/320 in the SHARMA_WINDER-1 queue; he places it on Shift A.
- 08:45 Anil (RM issue) scans reel AIT 06281 (cleared) and issues it; it shows under Slitting cards to write.
- 09:00 Suresh (Operator, Winder department) scans 26/10/320, logs 180 bamboo on Winding, and two readings per check.
- 13:30 Meena (Plant Manager) submits the runs. Paper ran out, so she closes Winding short at 180 of 200 bamboo with SS-MATERIAL-SHORT. 200 pcs go back to SO/26/10/418 at once; Priya releases them again the next morning.
- Next day Process logs its runs; boxes of 50 are packed as the readings are saved, and Kiran prints their labels. Ravi (Dispatch) ships 20 boxes (1,000 pcs) before lunch. Process closes at 1,790 good pcs: 35 full boxes and a part box of 40, and 10 pcs go back to the order. Ravi ships the other 16 boxes (790 pcs) in the evening.


## From chapter 10: Job cards

Sharma Tubes Pvt Ltd orders 400 pcs of 76.4 x 81 x 150, BLUE, on SO/26/10/412. Sales releases it; card **26/10/315** is made with 400 pcs = 40 bamboo × 10 pcs. The spec packs **48 pcs per box** in box R-150.

| Step | What happens | Card numbers |
|---|---|---|
| Winding closes short | 30 of 40 bamboo good, reason SS-MATERIAL-SHORT | Returned: 400 − 30 × 10 = **100 pcs** to the order at once |
| Targets cut | Oven target 40 → 30 bamboo; Process target 400 → 300 pcs | Planner slots of Oven and Process shrink |
| Oven closes | 30 of 30 bamboo good | Nothing returned |
| Process runs | 300 made, 5 rejected (code DM), 295 good | Boxes packed as readings are done |
| Boxes while running | 6 full boxes of 48 = 288 pcs (B2610315-001 to -006) | 7 pcs wait for the next run |
| Process closes short | 295 of 300 good, reason SS-HIGH-REJECT | Part box B2610315-007 with **7 pcs**; returned 300 − 295 = **5 pcs** |

The totals reconcile: 100 + 5 returned to the order + 295 pcs in 7 boxes = 400 pcs released. On the order line, 105 pcs are unreleased again. Dispatch ships boxes 001–004 (192 pcs) on 1 Nov while Process is still running, and boxes 005–007 (103 pcs) on 2 Nov. After the second challan the card is **Done**. A Process reading of I.D. 76.9 mm against 76.2–76.5 was flagged on run P#3; boxes 002 and 003, which hold pcs of P#3, show **QC flagged**, and they still shipped.


## From chapter 11: Job card manager

Card 26/10/315 for Sharma Tubes Pvt Ltd: 900 pcs, BLUE, scheduled on Winder 1 for 31 Oct Shift A (600 pcs) and Shift B (300 pcs). The customer wants 300 pcs early.

| Field | Value |
|---|---|
| Action | Split into a new card |
| New card gets | 300 pcs |
| Reason | CH-CUST-REQUEST Customer asked for a change, note "call-off earlier" |
| Result: 26/10/315 | 900 → 600 pcs, keeps its plan |
| Result: 26/10/315-A | 300 pcs, planner queue, unplaced |
| Slot change | 31 Oct · Shift B · Winder 1: 300 → off the board |
| Order line | stays 900 pcs, now on 2 cards |

The planner then places 26/10/315-A on Winder 2 for 1 Nov Shift A and prints it.


## From chapter 12: Planner

Card 26/10/315 (Sharma Tubes Pvt Ltd, 900 pcs = 90 bamboo, bamboo 1,540 mm) needs about 139 m of winding. The planner drags it to Winder 1, 31 Oct Shift A. Oven opens for planning; she places it on Oven 1, 31 Oct Shift B (90 bamboo). Process opens; she places 900 tubes on Line 1, 1 Nov Shift A.

| Stage | Slot | Logged | Result |
|---|---|---|---|
| Winding | 31 Oct · Shift A · Winder 1 | 90 bamboo, 31 Oct Shift A | Done in slot |
| Oven | 31 Oct · Shift B · Oven 1 | 90 bamboo, 1 Nov Shift A | Ran on another day or shift ("1 day later than plan") |
| Process | 1 Nov · Shift A · Line 1 | nothing by 3 Nov 08:00 | Not run → back to the queue (Missed slot) |

On 3 Nov the operator logs the Process run dated 1 Nov Shift A; the slot is restored and shows **Done in slot**.


## From chapter 13: Log output and QC entry

Night shift, card 26/10/315 (Sharma Tubes Pvt Ltd, 76.4 x 81 x 150, BLUE, 10 pcs per bamboo).

| Field | Value typed | Result |
|---|---|---|
| Time on the clock | 01:30, 31 Oct | Date 30 Oct, Shift B (automatic) |
| Stage / machine | Process / Line 1 | Plan match: As planned · 30 Oct · Shift B |
| Bamboo taken from Oven | 9 | 9 × 10 = 90 pcs possible |
| Operator | Suresh Patel (Process department) | Accepted; a winder operator would not be listed |
| Made / Rejected | 86 / 2, reason OD O.D. out | Good = 84 pcs |
| Cutting loss | 4, reason picked with note "end trimming" | all pieces accounted for (86 + 4) |
| Saved by | Operator | "Run P#2 sent to the supervisor" |

QC on run P#2: I.D. 76.5 and 76.9 mm against band 76.2–76.5. The second reading is red; the operator saves. Result: "QC saved · run P#2 · flagged", "I.D. 76.9 mm (band 76.2–76.5) · S2". The run is accepted; the flag shows on the card and in In-process QC. The spec packs 48 pcs per box and 20 pcs from run P#1 were waiting, so 20 + 84 = 104 pcs fill boxes B2610315-002 (20 from P#1 + 28 from P#2) and B2610315-003 (48 from P#2); 8 pcs wait for the next run. Both boxes show **QC flagged** because they hold pcs of P#2, and both can still ship.


## From chapter 14: Quality

Bharat Paper Mills delivers 6 reels of Kraft 300 GSM (P/26/014). The paper band is GSM at least 291 (from the master line) and moisture 6–9 %.

| Reel | GSM | Moisture | Decision | Result |
|---|---|---|---|---|
| R1 | 302 | 7.1 | By readings | Released |
| R2 | 298 | 6.8 | By readings | Released |
| R3 | 285 | 7.4 | By readings, reason "GSM low on two sheets" | Held |

R3 is on hold. The plant head grants a concession with CN-NON-CRITICAL, note "use on outer plies"; the FAIL stays on record. Later, card 26/10/315 has a Process I.D. reading of 76.9 mm against 76.2–76.5: flagged, not held; it appears in In-process QC under I.D., High, and the two boxes holding that run's pcs show **QC flagged**. They ship on the next challan. A week later the customer reports soft tubes in box B2610315-003; Sales records a complaint with CC-MOISTURE.


## From chapter 15: Month-end close

September 2026, Plant A. Paper limits are standard (7 % wastage, 7 % gap, minimum 5 kg).

| Material | Spec | Expected (spec + 7 %) | Used per count | Gap | Allowed | Status |
|---|---|---|---|---|---|---|
| Kraft 300 GSM | 2,000 kg | 2,140 kg | 2,195 kg | +55 kg | ± 149.8 kg | Within limit |
| Kraft 180 GSM | 400 kg | 428 kg | 470 kg | +42 kg | ± 30.0 kg | Needs a note |
| PVA adhesive | 120 kg | 120 kg | 118 kg | −2 kg | ± 8.4 kg | Within limit |

The plant head writes on Kraft 180 GSM: "Two reels wet at edges, outer plies scrapped on 18 Sep". It becomes **Explained**. With the count approved and the book adding up, the Owner clicks **Close September 2026**. A Process run dated 29 Sep typed on 2 Oct is now refused until the Owner re-opens September.


## From chapter 16: Dispatch

Card 26/10/315 for Sharma Tubes Pvt Ltd: 400 pcs released, Winding closed short (100 pcs back to the order), Process target 300 pcs, 48 pcs per box, tube weight 33.78 g.

| Day | Boxes | Pcs | Net weight | Vehicle | State after seal |
|---|---|---|---|---|---|
| 1 Nov (Process running) | B2610315-001 to -004 | 192 | 6.486 kg | GJ15AB1234 | 4 of 4 boxes shipped · Packing boxes |
| 2 Nov (Process closed) | B2610315-005, -006 and part box -007 | 48 + 48 + 7 = 103 | 3.479 kg | GJ15CD5678 | All boxes done |

Process closed with 295 good pcs, so 5 more pcs went back to the order. Total shipped 295 pcs in 7 boxes. The order line SO/26/10/412 shows 295 pcs delivered and 105 pcs unreleased (100 + 5), which Sales releases again or short closes. Challan 2 prints "Boxes on this challan (3)", the three codes with "part" on -007, and "Packed as 2 boxes × 48 + part box 7 = 103 pcs".


## From chapter 20: Purchase orders, PO approvals and requisitions

Store makes a PO for Bharat Paper Mills on 31 Oct 2026.

| Line | Material | Ordered | Rate | Amount |
|---|---|---|---|---|
| 1 | Kraft 230 GSM | 2,000 kg | ₹44.50 / kg | ₹89,000 |
| 2 | Kraft 300 GSM | 1,500 kg | ₹46 / kg | ₹69,000 |

**Save PO draft** gives **RP-PM/54**, Draft, total "2 lines · 3,500 kg · ₹1,58,000". Store clicks **Submit for approval**. The Owner approves it with the note "Rates as agreed on call". Store clicks **Send to vendor** › **WhatsApp**; the chip reads "Sent on WhatsApp · 31 Oct". Bharat Paper Mills confirms 6 Nov for line 1 and 10 Nov for line 2; Store records both. On 6 Nov the truck brings 2,012 kg of Kraft 230 GSM, which Store receives with **Make GRN** (see the Goods inward chapter).


## From chapter 21: RM inward calendar and expected arrivals

On 31 Oct the Planner opens **Paper** on the calendar. **Kraft 350 GSM** shows 0 kg usable, need 317 kg on today (all of it late) and **Short from 31 Oct**. She clicks **Suggest arrivals**; the suggestion is 450 kg on 3 Nov from Bharat Paper Mills (rounded up to the 50 kg order multiple). She adds it as a proposal. The **Waiting for you** tile on the Owner's screen goes to 1.

The Owner clicks **Review** and **Approve all**: "1 arrival approved. 1 PO draft ready to send: RP-PM/55 (Bharat Paper Mills)." The rate comes from the last approved PO, ₹47.25 / kg. Store opens **Scheduled drafts to send**, clicks **Check & send** › **WhatsApp**. Bharat Paper Mills says 4 Nov; Store records it with **Confirm**. On 4 Nov the row is under **Today** in Expected arrivals; GRN clicks **Make GRN**.

| Day | Need | Counted arrivals | Balance at day end |
|---|---|---|---|
| Sat 31 Oct | 317 kg | 0 | −317 kg (Short) |
| Wed 4 Nov | 120 kg | 450 kg | 13 kg |


## From chapter 22: Invoice differences, debit notes and purchase reports

Bharat Paper Mills delivers Kraft 230 GSM on GRN P/26/021 against RP-PM/54. PO rate ₹44.50 / kg, invoice rate ₹45.25 / kg, weighed 2,012 kg.

| Field | Value |
|---|---|
| Type | Rate |
| Difference | +₹0.75/kg |
| Exposure | +₹1,509 |
| Status | Open |

The Plant Manager (not the Store user who made the GRN) ticks the row and clicks **Open debit note**: **DN-261106-001**, Draft, ₹1,509. He clicks **Submit**; Accounts clicks **Approve** and **Issue immutable note**. On 20 Nov the vendor gives a credit of ₹1,509; Accounts types 1509 and clicks **Record settlement**. The note shows "₹1,509 / ₹1,509 / ₹0" and status **Settled**.


## From chapter 23: Goods inward, GRN register and labels

Bharat Paper Mills delivers on 6 Nov 2026 against **RP-PM/54**, challan BPM/2231, invoice BPM/INV/884 dated 6 Nov.

| Vendor reel no. | Net kg | Width | Form |
|---|---|---|---|
| BPM-7781 | 702 | 1,000 mm | Reel |
| BPM-7782 | 655.5 | 1,000 mm | Reel |
| BPM-7783 | 654.5 | 1,000 mm | Reel |

Total 2,012 kg of Kraft 230 GSM; PO open 2,000 kg, so the strip shows "more than the PO by 12 kg — reason needed below". Invoice rate ₹45.25 / kg against PO ₹44.50 / kg: an amber note shows ₹1,509.00 more. Store picks OR-ROLL-WEIGHT with the note "Last reels of the order, supplier confirmed extra kg". Store validates and posts: **P/26/021**, 3 lots, **AIT 06281**, **AIT 06282** and **AIT 06283**, all **Waiting for QC**. A rate case opens for the plant head. Store prints three A4 labels: each reads AMIGO INDUSTRIES UNIT II, MILL NAME BHARAT (the vendor's short name), the invoice number, 06-Nov-26, PLYBOND 400, VARIETY 230, GSM 230 (no QC reading yet), the mill's roll number, the AIT serial in big letters and the weight. QC passes the reels the same afternoon and they appear under **Ready for the floor** on the reel issue desk.


## From chapter 24: Issue to the floor: reels, coils and materials

Friday 7 Nov 2026, 10:15 (Shift A). Ramesh on the RM issue desk scans three reels of Kraft 230 GSM from GRN P/26/021 that QC passed yesterday, and one coil.

| Label number | Form | Weight | Went to |
|---|---|---|---|
| AIT 06281 | Reel | 702 kg | Slitter |
| AIT 06282 | Reel | 655.5 kg | Slitter |
| AIT 06283 | Reel | 654.5 kg | Slitter |
| AT-261104-011 (older reel number) | Coil | 98 kg | Winders |

He clicks **Issue 4 to floor · 2,110 kg**. At 13:00 Ramesh writes the slitting card for AIT 06281 from the slitter's figures: 7 coils, 12 kg wastage. Ramesh then issues 25 kg of PVA adhesive (oldest lot A/26/005) and 400 pcs of Box R-150 to the floor. In **Issue history** for 7 Nov, Shift A, the six issues appear with Ramesh's name and the racks they came from; the CSV matches the stock book's **Issued** column.


## From chapter 25: Stock counts, stock book, locations and opening stock

**Month-end count of October 2026, Plant A.** On 29 Oct the store opens the October card (it opened on 29 Oct, the last 3 days) and clicks **Start the October count**. It becomes CNT-20261029-001 with 12 racks plus "Not in any location".

| Rack | Result after Rack done |
|---|---|
| RM-STORE | 36 reels found; reel AT-261020-014 (412 kg) not found |
| CHK-A-02 | lot IN/26/031-2 of PVA adhesive: book 60 kg, counted 55 kg |
| CK3-R1 | reel AT-261011-006 found, but the system says it was issued on 14 Oct |
| CK2-R1 | one bag of BLUE parchment with no label, 25 kg |

The count is sent to the Owner on 31 Oct. The Owner chooses **Leave as used** for AT-261011-006 and clicks **Approve and post**. Voucher VAR-20261031-001 posts three lines dated 31 Oct 2026: −412 kg on AT-261020-014, −5 kg on IN/26/031-2, and +25 kg as a new lot on QC hold for the parchment, whose label is then printed. The count becomes **Approved · month certificate** for October 2026. The stock book's **Corrections** column for October now includes −392 kg. The Owner then closes October on **Month-end close**.


## From chapter 26: Inventory, material items, manual FG, stock alerts and RM costing

**Alert policy for Kraft 180 GSM.** Store keeper Ramesh drafts: Safety 1,600 kg, Reorder 1,700 kg, Target 2,000 kg, Recovery margin 100 kg, Lead days 7, Minimum order 1,000 kg, Cooldown 24 hours, Recipients Owner,Planner, reason "Winder 2 runs 180 GSM daily from November". The preview reads "Critical at ≤ 1,600 kg · warning at ≤ 1,700 kg · recover above 1,800 kg". Plant Manager Suresh activates it.

| Day | Free stock | Evaluate result |
|---|---|---|
| 3 Nov | 1,650 kg | New episode, WARNING (threshold 1,700 kg) |
| 4 Nov | 1,420 kg | Same episode, now CRITICAL (threshold 1,600 kg); Planner acknowledges |
| 6 Nov | 1,760 kg (GRN from Bharat Paper Mills, part cleared by QC) | Still open: 1,760 is not above 1,800 |
| 7 Nov | 3,240 kg | RECOVERED |

**Standard cost for Kraft 220 GSM.** Base ₹42.50/kg, Discount 2%, Freight ₹1.20/kg, Unloading ₹0.15/kg. Draft landed = 42.50 × 0.98 + 1.20 + 0.15 = ₹43.0000/kg. If the current active cost is ₹41.80/kg, the 10,000 kg impact shows +₹12,000.


## From chapter 27: Reports

**Monday review at Plant A, period 1–31 Oct 2026.**

| Report | Figure | What it means |
|---|---|---|
| Planning performance | Done in slot 68.8% (44 of 64 finished slots) | About two in three planned slots ran fully in their own shift |
| Planning performance | Missed slots 25 | 25 slots had no entry for 36 h; those cards are back in the queue |
| Plan vs actual | Run before planning 423 of 520 | Most runs were logged before the planner placed the stage |
| Slitting report | 6 carded reels, 3,575 kg issued, 67.5 kg wastage | Wastage % = 67.5 ÷ 3,575 = 1.9% |
| Customer 360 | Sharma Tubes Pvt Ltd: 1 delayed order, OTIF 80% | Watch (not Critical, because OTIF is not below 75%) |
| Inventory intelligence | Kraft 180 GSM: 2,400 kg available, 9,000 kg issued in 30 days | 9,000 ÷ 30 = 300 kg/day; 2,400 ÷ 300 = 8 days → watch |
| Employee performance | Suresh Patel, Process: 22 runs, 6,480 made, 6,350 good, 130 rejected, 4 flagged QC, 11 shifts | Reject % = 130 ÷ 6,480 = 2.0% |
| Sales pulse, closures by reason | SO-QTY-REDUCED: 3 orders, 0 cancelled, 3 short-closed, 4,200 pcs lost | Customers cutting quantity is the biggest cause of lost pcs |


## From chapter 28: Masters

**New customer for the challan.** The Admin adds Sharma Tubes Pvt Ltd: Code WB-SHARMA, GSTIN 24AAKCS4821M1Z3. The system fills PAN AAKCS4821M and the billing state Gujarat (24). Billing address: Plot 14, GIDC Phase II, Vapi 396195. The Dispatch (ship-to) address is their Daman warehouse with stores contact Mr Patel, 98250 12345. The row now shows **Ready**. When Dispatch makes a challan for SO/26/10/412, it prints the GSTIN and the Daman ship-to address.

**Paper edit.** The Admin changes paper 350 (Kraft) bulk factor from 1.55 to 1.50, so the derived thickness goes from 0.5425 to 0.525 mm. Recipe version 3 of spec 76.4 x 81 x 150 for Sharma Tubes, approved last week, keeps 1.55 in its layers. The next recipe version saved will use 1.50.

**Reason code.** Paper often runs out because adhesive is late. The Plant Manager adds SS-NO-ADHESIVE "Adhesive not available" to the list **Stage closed short**. The next day, when Winding on 26/10/318 closes at 52 of 60 bamboo, the plant manager picks it; the card history, the order history and the returned balance all show "Adhesive not available".

**Order close reason.** The Owner adds "Customer moved the plant" and the code becomes SO-CUSTOMER-MOVED-THE-PLANT. Later the Owner renames it "Customer shifted the plant"; the code stays the same, so orders already closed with it still show it.


## From chapter 29: System, audit, production season and the guide

**New store keeper.** The Admin adds Ramesh Patel: login ramesh.store@hariom.com, a 14-character password with upper and lower case letters, a number and a symbol, roles **Store** and **Inward QC**, primary plant Plant A, allowed plants Plant A. Ramesh signs in and lands on his Store work page. He can raise stock corrections and inspect incoming lots, but he cannot see System or approve counts.

**Who changed the access?** Next week Ramesh suddenly cannot open Incoming QC. On **Audit** the Owner sets **7 days**, picks Module **Users & access** and searches "ramesh". The user-updated event shows under **What changed** that the Inward QC role was removed, by whom and when. The Owner opens the user, ticks Inward QC again and saves; Ramesh signs in again with the role back.

**Monsoon switch.** On 1 Jun the Owner clicks Monsoon. The preview shows 41 specifications ready, 3 requiring attention ("Approved season recipe missing") and 18 released cards keeping their contracts. The Owner ticks the acknowledgement, types "Monsoon from 1 June as per QC" and confirms. New releases now use the Monsoon recipes and QC bands; the 3 blocked specs cannot be released until QC and Design finish their monsoon setup.
