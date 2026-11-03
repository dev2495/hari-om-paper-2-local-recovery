# Live data go-live, 2 November 2026

Live release: `8c5e45d` (all features, the 2 Nov operator scan update, and the go-live data tooling). All services were healthy after the last step. An S3 backup was taken before every step that changed data.

## What was done on the live system
| Step | Result |
|---|---|
| Transaction reset (`golive-20261102b`) | Cleared: 37 sales orders (47 lines, 45 release lots), 44 job cards with stages, runs and QC, 3 dispatches, 4 packing records, 23 POs, 22 GRNs, 34 paper reels and their stock moves, labels, 9 requisitions, supplier invoices, debit notes, 17 inwarded physical tools, notifications and logs. Kept: 14 users, roles, 3 plants, all masters (78 customers, 21 vendors, 18 employees, 15 machines, papers, mandrels, 250 tube sizes, parchments, boxes, 531 reason codes, 85 tool definitions), 316 specs with recipes and seasonal settings, QC rules and inward QC templates, 152 stock items, 8 locations, number counters. |
| Test data clean-up | Nothing to change: live had no test specs or test masters. |
| Spec packing from `SPECS SHEET (1).xlsx` | 111 specs carry the sheet's box, pcs per box, plastic bag ×1 and fadda (×3 where the sheet says yes). 4 new box masters were needed: EXPORT, HBD-5 PLY, PLASTIC BUNDLE, R-225 (size and weight blank). |
| Sales orders from Tally `Sales Orders.xlsx` | 22 orders created and approved, SO/26/11/04 to SO/26/11/25: 43 lines, 1,507,139 pcs (balance qty; ordered qty in the line note). |

## Lines not imported (39 lines, 5,847,978 pcs): enter by hand
**Customer not active on live (26 lines, 4,326,004 pcs).** Switch on or add the customer in Masters › Customers, then run `orders-apply` again (it adds only the missing orders):
- Reliance Industries Ltd. [Patalganga]: PO MP4/290516036/002 (6 lines) and MP4/290517227 (2 lines)
- Century Enka Ltd.: PO 5500000436 (5 lines)
- Century Enka Limited [Rajashree]: PO 5500000439 (10 lines)
- Madelin Enterprises (Athola): PO 6500025433 (2 lines)
- Gujarat Polyfilms Private Limited: PO 002219 (1 line, 100 pcs)

**Spec choice needed (6 lines).** Sales picks the spec when entering the line:
- Reliance [Hazira] 75x85x279.5 and 125x137x187.5 on POs 290516255/002 and 290517240: five look-alike specs each (Velvet, Single, Double, China, Textone)
- Alok 110x123x115 (Bar), PO 6S2/840088653: two identical specs
- Madelin Saily 112x126x149.9, PO 6500025446: two specs (300 g / 310 g)

**No spec of that exact size or variant (7 lines):** Garden Silk 110x123x115 (spec is 114.9), Silvassa 120x136x95 plain (only HCS exists, 2 POs), Silvassa 110x122x150 (2 POs; a 110x122x150 POY spec exists under the old name 'Reliance Polyetser Ltd.[ Silvassa ]', the active customer has 110x122.4x150), Madelin Saily 112x124.5x125, Vashupujya 94x108x205 (customer exists).

The client fill-in workbook with every open item is `TubeOS-Data-To-Complete-2026-11-02.xlsx` (same folder).

## First-day checklist for the plant
1. Masters › Employees: department and login email for every operator (floor screens list only that department; a linked login sees only its own stage).
2. Masters › Packaging: fill size and weight for EXPORT, HBD-5 PLY, PLASTIC BUNDLE and R-225, and check for look-alike box masters (for example R-150 and R-150_3PLY). Keep one, move its specs on Packing setup, then switch the other off.
3. Design › Packing setup: the 49 specs not in the sheet, the 7 Reliance [PG] specs (filed under "Relience (Patal Ganga)"), and the two Pioneer 110x124x115 specs.
4. Masters › Customers: switch on or add the five customers above, then re-run `orders-apply`.
5. System › Plants: set the next AIT reel number.
6. Masters › Vendors: mill short names (label MILL NAME).
7. Stores: opening stock (reels and lots get new AIT labels) and re-inward the physical tools on Masters › Physical tools.
8. Masters › Reason codes: review the lists in your own words.

## Paper reel opening stock (3 Nov 2026, to load)
From `Reel stock.xlsx` (sheet Stock; closing till 31 Oct 2026): 351 reels, 410,094 kg, ₹1,41,60,237, AIT 00528 to AIT 06279. Data file `data/client_import_2026-11-03/reel_stock.json`, loaded by `scripts/client_import/import_opening_reels.py` (golive steps `reels-preview` / `reels-apply`).
- One opening batch dated **1 Nov 2026** (this fixes the go-live date; later manual opening entries use the same date).
- Every reel **keeps its own AIT number**; the next goods inward continues at **AIT 06280** (after the highest kept number, unless the plant setting is already higher: the preview prints it).
- QC cleared and ready to issue, except AIT 02131, 02132, 02133 (352FDY*, marked HOLD) on QC hold (QH-OTHER).
- Paper item = the register's GSM code (220, 301, 350–355, 401); SLITTED = reel, coil = coil; mill reel no. = ROLL NO.; vendor code = mill name; bill no./date, PO, inward date, mill variety (350CEDAR) and ply bond kept on the reel and printed on its QR label (Opening stock › Labels).
- Left out: 224 empty pre-numbered rows (AIT 06830–07053); the 19 coils on sheet "Manual Entries" (the client types them on Opening stock, with the new **AIT no.** field so they keep their numbers).
- Vendor codes (AKSHAT, UPPM, VATSALYA, BN, KALYANI) matched no single vendor master locally; the code is used as vendor and mill name.

## Glue tank opening stock (3 Nov 2026, to load)
From `Glue stock.xlsx` (closing till 31 Oct 2026): 29 tanks × 1000 kg = 29,000 kg (Wellcol EM30100 10, VINSOL-HV 7, TL4 LV 6, VINSOL-TL4 6; SIVA CHEMICAL 19, Poonam Corporation 10), AIT 00546 to AIT 01000.
- One opening batch dated **1 Nov 2026**, QC cleared, ready to issue; each tank keeps its AIT tank number as its lot number, with vendor and inward date on the lot and its QR label.
- The **glue tank series** is its own AIT series per plant (separate from reels), restarts every 1 April, never repeats; the next new tank at goods inward (PO or manual GRN, or a count) gets **AIT 01001**. Owner/Admin can see or raise it on System › Plants.
- Products are matched to Adhesive masters; any missing one is created (code e.g. TL4-LV). Rate = master rate, else ₹0 until set (set rates in Masters › Adhesives).
- Steps: `glue-preview`, then `glue-apply` (backup first, safe to repeat).
