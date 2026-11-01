# Packing, packing material and the delivery challan: what exists today (code at 3c85b67)

Read-only review. Paths are relative to the repo root `/Users/devarshthakkar/Downloads/hari om/hari-om-paper-2-local-recovery`. SQL checks were read-only, run on the local `hariom_nverify_season_*` databases.

## Short answer

- **Masters:** there is a Packaging master with three lists: **Boxes**, **Plastic sheets** and **Fadda**. Each record becomes a stock item with the same code. There is **no "putha", partition, separator, tape or poly-bag master**, and no general "other packing items" list. The box master has **no capacity (pcs per box)** field.
- **Spec:** the spec holds box code, qty per box, plastic SKU and plastic per box, fadda SKU and fadda per box, unit weights, ply, bundle type and code, BOPP and packing notes. These are copied into the job card when it is released and frozen there. **None of them is required for approval.**
- **Floor:** on batch-entry (V2) cards **packing is not logged at all**. Closing Process closes Packing by itself. Nobody records boxes filled, pcs per box or loose pcs, and **no box or carton labels are printed**.
- **Consumption:** no packing material is taken out of stock per card. Stock goes down only when the store issues packing to the floor ("consumed in full"). When Process closes, the system writes a **theoretical** figure for the month-end close only: boxes = good pcs ÷ qty per box, rounded up; plastic and fadda = boxes × the per-box figure. These are quantities with no money value. Month-end then compares them with what was issued and counted.
- **Challan:** shows Packing type ("Bundle"/"Loose"), Units, PCS/Unit, Total PCS and Net weight. The **spec's qty per box and box code are never used**. On V2 cards PCS/Unit defaults to the whole shipment, so the challan says "1 Bundle of 400 pcs". The challan has no box type, no loose pcs, no packing material, no gross weight and no HSN.

---

## 1. Masters

### 1.1 Packaging master (masterdata-service)

| List | Table / model | Fields | Shown on screen |
|---|---|---|---|
| Boxes | `packaging_box` (`hariom-erp/services/masterdata-service/src/models.py:295-310`) | code, length/width/height mm, size_label, weight_kg, rate_per_piece, plant, active | Code, "Color" (this is really `size_label`), Dimensions, Weight (`apps/web-ui/app/(dashboard)/masters/packaging/page.tsx:105-115`) |
| Plastic sheets | `packaging_plastic_sheet` (`models.py:313-326`) | sku, size_label, weight_kg, rate_per_kg, rate_per_piece | SKU, Size label, Weight |
| Fadda | `packaging_fadda` (`models.py:329-341`) | sku, weight_kg, rate_per_kg, rate_per_piece | SKU, Weight |

- The API schemas (`masterdata-service/src/routers/packaging.py:24-102`) **do not expose `rate_per_piece` / `rate_per_kg`**. Those columns exist but nothing reads or writes them.
- **No capacity / pcs-per-box field.** Pcs per box lives only on the spec.
- The box form labels `size_label` as **"Color"** (`apps/web-ui/components/forms/master-forms.tsx:652`), but the stock-item name uses it as a size ("Box R-150 400x300x200").
- **No putha, partition, separator, cardboard sheet, tape or poly-bag list.** A search for those words finds nothing in code or docs. "Fadda" is the only "inside the box" item. Whether fadda means the same as putha needs the owner's confirmation.

### 1.2 Packing items as stock items

- `apps/bff-api/src/services/master_items.py:80-92` creates a stock item in inventory for every active master record, **linked only by code**. It runs when a master is saved and once per page load (`sync_master_items`, lines 130-159).
  - Box → `PACKAGING`, unit **PCS**
  - Plastic sheet → `PACKAGING`, unit **KG** (client rule 26 Oct)
  - Fadda → `PACKAGING`, unit **PCS**
- An existing item is **never changed** (`inventory-service/src/routers/items.py:396-405`). In the local DB, `PS-150` (plastic) is still **PCS**, because it was created before the KG rule. The unit of an existing item can therefore disagree with the rule.
- A manual item master can also hold `PACKAGING` items in KG or PCS (`items.py:360-388`). This is the only way to create items such as tape or poly bags today, and those items are not linked to any spec field.
- Local DB: box master has only `R-150`, plastic only `PS-150`, fadda only `FD-3`. Inventory has 9 PACKAGING items (several are test boxes such as C-B1, MEC-B1, OS28-BOX).

## 2. Spec: where packing lives

- Spec fields (dynamic values) are listed in `hariom-erp/services/spec-service/src/routers/specs.py:111-126`, with labels in `apps/web-ui/lib/spec-sheet.ts:547-566`:
  - bundle_type, bundle_code, packing_ply
  - **qty_per_box**, packing_pcs
  - **box_code** (dropdown from the box master), box_size, box_unit_weight_kg
  - plastic_required, plastic_sku (dropdown), plastic_size, plastic_unit_weight_kg, plastic_weight_per_box_kg, plastic_per_box
  - fadda_sku (dropdown), fadda_unit_weight_kg, fadda_weight_per_box_kg, fadda_per_box
  - bopp_required, special_instructions ("Packing Instructions")
- The spec screen copies size and weight from the chosen master record (`apps/web-ui/components/specs/SpecSheetDocument.tsx:986-1062`).
- `spec-service/src/calculators.py:342-356` (`_spec_packing`) builds a per-box packing list: box, qty per box, plastic and fadda per box.
- **Not required:** no release blocker checks packing (no hit for qty_per_box / box_code in the spec-service blockers). A spec can go live with no packing.
- **Old specs vs seasonal specs:** seasonal specs have **no separate packing**. Both kinds use the same dynamic fields. A seasonal release sends `spec_values(spec)` in the release bundle (`spec-service/src/routers/seasonal.py:1207-1211`). Production then builds the card's spec snapshot with `_build_spec_snapshot` (`production-service/src/routers/planning.py:3173`, `2873`, flat packing keys at `2985-3005`). **Packing is frozen into `job_cards.spec_snapshot` at release.**
- The printed job card shows Box / Qty per box, Plastic and Fadda per box, with the note "Floor consumption: PCS · inward/reconcile: kg" (`apps/web-ui/components/production/JobCardDocument.tsx:3050-3070`).
- **Local DB:** 340 cards; 169 have qty_per_box and box_code, 165 have no packing at all. Box codes on cards are `R.125` (101 cards), `R.150`, `S-300`, `EXPORT`, `N-225` and `R-150`. **Only `R-150` exists in the box master**, so the others are not stock items. Many cards have plastic_per_box = 1 or fadda_per_box = 3 with **no plastic or fadda SKU**. **No card has plastic_unit_weight_kg.**

## 3. Packing on the floor

| Card type | What is logged at packing | Reference |
|---|---|---|
| V2 batch entry (most cards: 264 of 340) | **Nothing.** Closing Process auto-closes PACKING and QC with packed qty = Process good qty, entry `{auto_completed: true}`. There is no box count, pcs per box, loose pcs, or who packed. | `production-service/src/routers/entries.py:396-433` ("packing material is consumed from the spec sheet") |
| V1 stage form (old cards) | Free fields: Packing Type, **Qty per Bundle**, Total Packed Qty, FG Item ID, Dispatch Date/Qty, Pending Qty, Supervisor Sign. No box count, no loose pcs, no material used. | `JobCardDocument.tsx:302-312`, `3072-3081` |

- **Box count is worked out, not counted:** `_packing_consumption_snapshot` (`planning.py:4612-4647`) gives box_count = ceil(packed pcs ÷ qty_per_box), plastic = boxes × plastic_per_box, fadda = boxes × fadda_per_box. It is stored in `packing_records.snapshot.packaging_consumption` (`planning.py:4650-4689`).
- The close dialog shows this as a preview: "Packing from the spec sheet is consumed: N boxes …". If qty_per_box is missing it warns "no packing material is posted" (`apps/web-ui/components/production/card/CloseStageDialog.tsx:254-268`).
- `packing_records.bundle_count` and `qty_per_bundle` are never filled from the floor. In the local DB, 0 of 90 have a bundle count and 1 of 90 has a qty per bundle.
- **No box / carton / FG labels.** Label pages exist only for racks, lots and opening stock.

## 4. Consumption of packing material

### 4.1 Stock movement

- **The only stock-out is the store's issue to the floor.** The Material issue desk says packing goes "to the floor, not to a job card or machine … What goes to the floor is consumed in full", with boxes in pieces and plastic in kg (`apps/web-ui/app/(dashboard)/inventory/production-issue/page.tsx:421`; guide `docs/help-guide/chapters/24-issue-to-floor.md:12,40`).
- Local inventory DB: PACKAGING movements are only INWARD, OPENING, ISSUE_PRODUCTION, MOVE and ADJUSTMENT. There is **no per-card or per-dispatch packing consumption transaction**.
- Nothing takes packing out at Process close, card close or dispatch.

### 4.2 Theory for month-end (quantities only)

- When Process closes (or Packing/QC on an old card), a `theory` effect is queued (`entries.py:1183`). The worker (`production-service/src/completion_worker.py:83-84`) calls `_upsert_monthly_provisional_theory`, which writes `monthly_material_provisionals` rows.
- Packing rows come from `_packaging_theory_rows` (`planning.py:577-617`):
  - box code × box count; plastic SKU × pcs; fadda SKU × pcs;
  - the row is in the stock item's unit: pieces, or pieces × unit weight from the spec when the item is in KG.
- Gaps in the current logic:
  - A row is **dropped without warning** when the SKU is blank or the quantity works out to 0. Example: a plastic item in KG with no `plastic_unit_weight_kg` on the spec, which is the case on every local card.
  - If the spec's box code is not a stock item (for example `R.125`), the row is still posted under that code. Its unit defaults to PCS. It can never match the R-150 issues.
  - **No value (₹).** Theory is quantity only. The master rates are unused.
- Month-end compares, per item (`production-service/src/services/consumption.py:645-700`; guide `docs/help-guide/chapters/15-month-end-close.md:24,55,119`):
  - Spec (theory) × wastage = Expected
  - Floor gap = Issued − Expected
  - When the count is approved: Actual = Opening + Received − Sent back − Closing count; Store gap; Total gap
  - Packing limits: 0 % wastage, 7 % gap, minimum 10 in the item's unit (`production-service/src/services/usage_limits.py:23`)
- Local DB theory rows: `R.125` 756 pcs over 31 postings, plus `R.150`, `N-225`, `R-150` 16, `PS-150` 16 pcs, `FD-3` 40 pcs. The R.125 / R.150 / N-225 theory has **no matching stock item**.
- Purchase demand also uses the spec's per-box figures. Packing is treated as consumed at Packing/Process close (`planning.py:7051-7062`).

## 5. Delivery challan

- **Where it is stored:** `dispatch.dispatch_snapshot` (free JSON from the browser) (`production-service/src/models.py:570-583`). One DRAFT per card; each seal is a separate row, so partial dispatches are allowed (`production-service/src/routers/dispatch.py:555-575`, `604-617`).
- **Server checks at seal:** plant name/address/GSTIN and customer address from the masters, vehicle, transporter, and net weight > 0 (`dispatch.py:330-362`). It also checks shipment pcs ≤ accepted pcs left on the card. **The server does not check packing fields.**
- **Screen and print:** `/logistics/dispatch/new?job_card_id=` (old `/dispatch/[jobCardId]` redirects there). Print is at `/logistics/dispatch/[job_card_id]/print` (by `dispatch_id` or the latest for the card). Both render `apps/web-ui/components/dispatch/dispatch-document.tsx`.

| Challan field | Where the value comes from | Typed or worked out | Reference |
|---|---|---|---|
| Plant name, address, GSTIN | Plant master | from master | `dispatch.py:261-327` |
| Customer, billing / ship-to, contact | Customer master | from master | same |
| Challan No | Given on seal (`dispatch_ref`) | system | `dispatch.py:184-191, 659` |
| Challan date, Job card ref | Business date, card | system | `apps/web-ui/app/(dashboard)/logistics/dispatch/new/page.tsx:153-157` |
| Vehicle, LR, Transporter | Typed | typed | `dispatch-document.tsx:157-165` |
| Description | spec name / product code | system | `new/page.tsx:145` |
| **Packing** | `"Bundle"` if the card has a PACKING stage (every card does), else `"Loose"`. Never "Box", never the box code. | hard-coded | `new/page.tsx:166` |
| **PCS/Unit** | `PACKING.entry_snapshot.pcs_per_bundle`, **or the whole shipment qty** if blank. Editable ("Pieces per bundle"). | defaults, then typed | `new/page.tsx:150, 521-523` |
| **Units** | ceil(Total PCS ÷ PCS/Unit), "the last one may hold fewer" | worked out | `new/page.tsx:151, 388` |
| Total PCS | Shipment qty, default = max shippable, editable | typed | `new/page.tsx:149, 374-389` |
| Net weight (kg) | pcs × tube weight from the spec (avg / target / mid band / customer weight), or typed | worked out, editable | `apps/web-ui/lib/dispatch-challan.ts:22-47` |
| Totals | sum of units / pcs / net kg; units text says "bundles" | worked out | `dispatch-document.tsx:38-44, 80-84` |
| Remarks, notes, signatures | Typed / fixed | — | `dispatch-document.tsx:241-270` |

**Not on the challan:** box code or type, spec pcs per box, full boxes + loose pcs, plastic or fadda used, gross weight, box tare, HSN, rate or value.

**Mismatches found:**

1. **Spec qty per box is ignored.** Nothing reads `qty_per_box`. V2 cards never have `pcs_per_bundle`, so the challan opens as "1 Bundle × all pcs". In the local DB, **13 of 23 sealed challans are "1 unit" with PCS/Unit = Total PCS**. Example: 400 pcs on an R.125 card (48 per box) printed as 1 bundle of 400. Correct is 8 boxes + 16 loose, or 9 boxes.
2. **Typed pcs per unit differs from the spec.** Several challans have 44 per bundle where the spec says 48 or 45.
3. **The old V1 form saves `qty_per_bundle`, but the challan reads `pcs_per_bundle`.** The figure typed on V1 cards is never carried to the challan.
4. **Partial dispatch:** each challan rounds its own last unit up. A part box may appear on two challans, and the boxes on all challans can add up to more than the box count posted for month-end. Month-end boxes come from all good pcs at Process close, including pcs later kept as surplus.
5. **Box count on the challan and box count in theory come from different maths and different inputs:** typed pcs/unit versus spec qty/box.

## 6. Gaps against the owner's requirement

| Requirement | Today | Gap |
|---|---|---|
| Box chosen from the box master | Spec picks box_code from the master | Many live spec codes (R.125, R.150, N-225, S-300, EXPORT) are not in the master or stock. The box master has no capacity. Packing is optional on specs. |
| Pcs per box from spec | `qty_per_box` on spec, frozen at release | Used only for month-end theory and the close preview, not on the floor and not on the challan. |
| Putha / partitions / separators / tape / poly bags inside the box | Only plastic sheet and fadda | No master lists, no spec fields, no stock link for the other items. |
| Packing logged at packing | V2: auto, nothing logged. V1: free fields. | No boxes filled, loose pcs, packer or labels. Box count is always worked out, never counted. |
| Packing material consumption posted | Store issue to the floor = used in full. Month-end theory in quantity only. | No per-card stock posting, no value. Theory rows are dropped silently when the SKU or unit weight is missing. Unit mismatch (plastic KG vs PCS item, spec unit weight blank). |
| Challan shows correct packing data | Bundle / units / pcs per unit / net kg | Spec ignored. Wrong default (1 bundle). No box type, loose pcs, materials, gross weight or HSN. Partial-dispatch rounding. |

**Risks if used live as-is:**
- Customers receive challans with wrong box counts.
- Month-end packing gaps cannot be explained, because theory sits under codes that are not stock items while issues sit under R-150.
- Putha and other inside-box items are not tracked anywhere.
- A spec with blank packing posts no packing theory, and the only warning is in the close dialog.
- Plastic theory is 0 kg wherever the unit weight is missing.

## 7. Decisions the owner should make (options only)

1. **What counts as packing material.**
   - (a) Keep box + plastic + fadda and confirm whether fadda = putha.
   - (b) Add a general "packing item" list: putha, partition, separator, tape, poly bag, label, strap. Each has a unit and a stock link, with "qty per box" or "qty per shipment" on the spec.
2. **Box master capacity.** Pcs per box stays on the spec only, or the box master gets a default capacity that the spec can override.
3. **Box codes on existing specs.** Map R.125 / R.150 / N-225 / S-300 / EXPORT to master boxes (create the masters), or correct the specs. Also decide whether packing becomes compulsory before a spec goes live.
4. **How consumption is posted.**
   - (a) Keep the current model (issue to the floor = used; spec theory compared at month-end).
   - (b) Post per card from the spec when Process closes: stock out from the floor or the store.
   - (c) Post at dispatch from the boxes actually shipped.
   - Also decide whether to value packing consumption at the GRN rate.
5. **Logging on the floor.** Keep packing automatic, or add a short "packed" step on V2 cards: boxes filled, pcs per box, loose pcs, packer, optional box labels with card / FG batch / qty.
6. **Challan packing block.** Default PCS/Unit from the spec qty per box and Packing = box code. Show "N boxes × X pcs + Y loose" and the packing materials. Decide whether gross weight (net + box/plastic/fadda tare) and HSN are needed. Decide whether PCS/Unit stays editable, and whether a change needs a reason.
7. **Partial dispatch and loose boxes.** Each challan rounds up on its own, or loose pcs are carried as "loose" until a later challan completes the box.
8. **Units.** Confirm plastic in kg vs pcs. If kg, the spec must carry a plastic unit weight, and older PCS stock items such as PS-150 need correcting.
