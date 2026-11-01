HARI OM TUBEOS HELP GUIDE - Chapter 26: Inventory, material items, manual FG, stock alerts and RM costing
Section: Stock control, reports and setup. Accurate as of 31 October 2026. Hari Om TubeOS is the ERP for a paper tube plant (sales orders, planning, shop floor, quality, purchasing, stores, reports).
Screenshots named in this file are in the visual handbook (Hari-Om-TubeOS-Help-Guide.html or .pdf), chapter 26.

# Inventory, material items, manual FG, stock alerts and RM costing

> **What it is:** the stock overview of the plant, the item master behind every material, the manual way to add finished tubes to stock, the stock alert rules and their inbox, and the Owner's standard cost sheet for raw materials.
> **Who uses it:** Store, Planner, Plant Manager, GRN and RM issue (overview and items); Plant Manager and Store (alert policies and alerts); Owner and Admin (RM costing, item creation).
> **Where:** Sidebar > Stores & inventory > Inventory (/inventory, sub-links **Stock overview**, **Material items**, **Goods inward**), Manual FG (/inventory/fg-inward), Stock alert policies (/inventory/stock-alert-policies), Stock Alerts (/inventory/stock-alerts), RM Costing (/inventory/rm-costing).

## At a glance
- **Stock overview** is a read-and-jump page: value, kg on hand, held stock, rack use, charts and quick links to the desks that change stock.
- **Material items** is the stock item list. Each master record (paper, adhesive, parchment, packing, tool) gets its stock item automatically. You set the unit, the tracking (reel or bulk) and the reorder, safety and lead-time numbers here.
- **Manual FG** adds finished tubes to stock without a job card: rework yield, a positive adjustment, or go-live FG, with a reason code from the list **Manual FG inward**. Customer returns are **not** entered here; they go through Quality > Customer complaints.
- **Finished goods from job cards arrive box by box.** On batch-entry cards each packed box is posted to stock as its own FG lot named by its box code (for example B2610315-001), with the box code and a part-box flag on the movement. It leaves stock when its challan is sealed. Boxes kept as surplus stay in stock as their own lots.
- **Stock alerts** work in two steps. A **policy** (safety, reorder and target in kg) is saved as a draft by one person and activated by a different person. **Evaluate** then opens one alert "episode" per material that falls below its line.
- **RM costing** is a planning (standard) cost per raw material. It is versioned, and activating it never changes PO rates, invoice rates or the cost of lots already received.

## The flow

Flow diagram: Stock alert policy to recovery
Steps: 1. Save draft policy (done by Store/Plant Manager) -> 2. Activate as checker (done by Plant Manager, a different person) -> 3. Evaluate active policies (done by Store/Planner/Plant Manager) -> 4. Alert episode opens - Warning or Critical -> 5. Acknowledge (done by Store/Planner/Plant Manager) -> 6. Review PO coverage -> 7. Recovered - stock above reorder + margin



Flow diagram: RM standard cost version
Steps: 1. Pick raw material (done by Owner/Admin) -> 2. Enter base and charges -> 3. Save audited draft -> 4. Activate - Active, or Scheduled if future date -> 5. Older version Superseded
If it goes wrong after 'Activate': 1. Restore draft - any old version -> 2. Save audited draft



Flow diagram: Manual FG inward
Steps: 1. Choose FG item (done by Plant Manager/Owner/Admin) -> 2. Qty and reason code -> 3. Optional reference -> 4. Post manual FG -> 5. FG lot in stock - ledger updated


Alert policies are a maker-checker control: the person who drafts the numbers cannot switch them on. Cost versions are never edited after activation; a change is always a new version.

## Screen tour

[Screenshot "inventory-overview": Stock overview with inventory value, stock on hand, held stock and locations used]
*Figure: The Stock overview page. Four tiles: Inventory value ₹4,99,589; Stock on hand 26,501.39 kg (54 stocked items · 42,362 pcs); Held / blocked 17,162.75 kg; Locations used 22/28. Below them are quick-action cards (Goods inward, Issue reel by scan, Reprint labels, Correct stock, Production issue, Ledger and balances, RM inward calendar), the "Stock in kg by material type" bar chart and the "Usable vs blocked stock" donut.*

What you see:

1. **Inventory value**: the value of raw material and tracked lots. It opens the Inventory intelligence report for Owner, Admin, Plant Manager, Planner and Store.
2. **Stock on hand**: total kg of materials counted in kg, with the number of stocked items and the pieces total beside it. Kg and pcs are never added together. It opens the ledger.
3. **Held / blocked**: kg on QC hold, blocked or scrap. It opens Holds & inspections.
4. **Locations used**: racks holding stock out of all racks. It opens Locations.
5. **Quick actions**: links to Goods inward, Issue reel by scan, Reprint labels (GRN register), Correct stock (Corrections tab), Production issue, Ledger and balances, and RM inward calendar.
6. **Material split**: a bar chart of stock in kg by material type (Paper, Adhesive, Parchment, Packing). Materials counted in pieces are left out, and the chart says how many pcs that is.
7. **Status split**: a donut of usable vs blocked stock in kg (for example Qc hold, Unrestricted, Wip).
8. Further down: **Top paper load** (the 8 papers with the most kg), **Old stock risk** (ageing), **Shortage and purchase queue** (Critical items are those at or below their reorder level), **Racks in use**, **Latest ledger postings** (Date, What happened, Change, Document, with a **Full ledger** link), **Stock on each rack**, and a **Counts and month-end** card linking to Stock counts & book.

[Screenshot "material-items": Material items page with the New item form and the item master table]
*Figure: The Items and stock policy page. Counter tiles by type: RAW PAPER 18, ADHESIVE 3, PARCHMENT 2, PACKAGING 4, TOOL 0, FINISHED GOOD 27, OTHER 0. On the left is the **New item** form; on the right is the **Inventory item master** table with Item, Type, Tracking, Available and Policy columns.*

What you see:

1. **Type counters**: how many items of each type exist in this plant.
2. **New item** form: **Item code** (for example KRAFT-180-BF18), **Item name**, **Type**, **UOM** (KG, L or PCS), **Density (kg per litre)** (only for L; it converts the spec BOM from kg to litres), **Tracking mode** (REEL or BULK), and **Reorder**, **Safety** and **Lead days**. Then **Create item**.
3. **MRP policy** panel: select a row with **Edit** to change its reorder, safety and lead days, then **Save policy**. With an item selected, an **Incoming QC profile** card shows its QC checks and revision and links to **Open material standards**.
4. **Inventory item master** table: item code and name, **Type**, **Tracking**, **Available** quantity in its unit, **Policy** ("R 0 · S 0 · Lead 0 d") and **Edit** / **Delete** buttons. An **RM inward calendar** link is in the corner.

[Screenshot "manual-fg": Manual FG inward form and reason guidance]
*Figure: The Manual FG inward page. A **Post manual FG** form on the left has FG item, Qty (PCS), Reason, Reference, Batch no, Stock status and Notes. A **Reason guidance** panel on the right explains REWORK, Customer returns (not entered here), ADJUSTMENT and OPENING. The header shows "27 FG items" and a **View ledger** link.*

What you see:

1. **FG item**: only finished-goods items (one per spec) are listed.
2. **Qty** in the item's unit (usually PCS) and **Reason**: a picker for the list **Manual FG inward**: FG-REWORK Reworked pieces taken back, FG-ADJUSTMENT Stock adjustment, FG-OPENING Opening stock, FG-OTHER Other (write a note).
3. **Reference (idempotency key)**: optional, for example REWORK-2026-10-15. Posting the same reference twice adds stock only once.
4. **Batch no (auto if blank)**: left blank, the lot number is made as FG-<item code>-yymmdd-nnn.
5. **Stock status**: UNRESTRICTED (default), WIP, QC HOLD, DISPATCH STAGING or BLOCKED. Then **Notes** and **Post manual FG**.
6. **Recent FG inward (latest 10)** at the bottom: When, Item, Qty, Source (**Manual · Reworked pieces taken back** (the reason label), or the job card posting), Ref and Stock status. Boxes posted from job cards appear with the box code as the batch.

[Screenshot "stock-alert-policies": Stock alert policies with summary tiles, draft form and version register]
*Figure: The Stock alert policies page. Tiles show Active policies 1, Draft versions 0 and Precedence "Item → plant". The **Draft policy version** form has Material, Safety kg, Reorder kg, Target kg, Recovery margin kg, Lead days, Minimum order kg, Order multiple kg, Cooldown hours (24), Recipient roles (Owner,Planner) and Required change reason. The **Policy version register** shows one active policy: Safety 1600 kg, Reorder 1700 kg, Target 2000 kg.*

What you see:

1. **Active policies**, **Draft versions** (waiting for a checker) and **Precedence** (an item rule wins over a plant rule).
2. **Draft policy version** form, with a **Preview only** line: "Critical at ≤ safety kg · warning at ≤ reorder kg · recover above reorder + margin kg". Then **Save draft policy**.
3. **Policy version register**: every version with its material, version number, stock basis (free stock), creator, status chip (DRAFT, ACTIVE, INACTIVE) and Safety / Reorder / Target. Drafts have **Activate as checker**.
4. **Alert evaluator**: **Evaluate active policies now** and **Open alert inbox**.

[Screenshot "stock-alerts": Stock alerts inbox with open, critical and recovered counts]
*Figure: The Stock alerts page. Three tiles: Open episodes 0 (warning, acknowledged or snoozed), Critical 0 (at or below safety stock) and Recovered 0 (closed after recovery margin). Below them, the Alert episodes panel is empty with the message "No stock alert episodes. Evaluate active policies after stock data is current."*

What you see:

1. **Open episodes**, **Critical** and **Recovered** counts.
2. **Alert episodes**: one card per episode with the material, policy version, when it breached, severity (WARNING or CRITICAL), status (OPEN, ACKNOWLEDGED, SNOOZED, RECOVERED), **Free stock** kg and **Breach threshold** kg. Open episodes have **Acknowledge** and **Review PO coverage** (opens Purchase orders filtered to that material).

[Screenshot "rm-costing": RM costing page with base-cost editor and cost register]
*Figure: The RM costing page. Tiles show Configured RM 0, Missing active cost 27 and 10,000 kg impact "—". The **Base-cost editor** shows Raw material "220 · Kraft 220 GSM", Base ₹ / kg, Discount %, Freight ₹ / kg, Unloading ₹ / kg, Effective from 31/10/2026, Currency INR and Required change reason. The **Cost register** lists each kraft paper with a "Missing" chip.*

What you see:

1. **Configured RM** (materials with an active cost), **Missing active cost** (shown as unavailable, never as zero) and **10,000 kg impact** (the ₹ difference for 10,000 kg between the draft and the current cost).
2. **Base-cost editor**: **Raw material**, **Base ₹ / kg**, **Discount %**, **Freight ₹ / kg**, **Unloading ₹ / kg**, **Effective from**, **Currency** (INR, fixed) and **Required change reason**. Under **Other charges & explicit calculation bases** you can add a charge with a name, a direction (**Add to cost** or **Discount**) and a basis (**₹ per kg**, **% of base** or **₹ per lot** with a reference kg). **Current landed** and **Draft landed** are shown side by side, then **Save audited draft**.
3. **Cost register**: search, then one card per material with its unit, effective date, status chip (Missing, DRAFT, ACTIVE, SCHEDULED), Base, Landed and Version.
4. **Version history** (below): Version, State, Base, Landed, Effective, Components (each in ₹/kg), Actor / reason, and the actions **Activate** (drafts) and **Restore draft**.

## Step by step

### How to read the stock overview
Owner, Admin, Store, Planner, Plant Manager, GRN, RM issue.

1. Open **Inventory**. Pick one plant at the top if you see several.
2. Read the four tiles. Click a tile to open the page behind it (report, ledger, holds or locations).
3. Use a quick-action card to go straight to the desk you need. This page itself changes nothing.

### How to create a material item
Owner or Admin. Most items are made for you when a master record is saved (each paper, adhesive, parchment colour, packing item or tool becomes a stock item with the same code), so you rarely need this.

1. Open **Inventory** > **Material items**.
2. Fill **Item code** and **Item name**, and choose **Type** and **UOM**. Paper defaults to **REEL** tracking and other types to **BULK**. For a unit of **L**, enter **Density (kg per litre)**.
3. Optionally fill **Reorder**, **Safety** and **Lead days**. Click **Create item**.
4. If you see "Item save failed. Check duplicate code and plant scope.", the code already exists in this plant.

### How to change an item's reorder, safety and lead time
Store, Owner or Admin.

1. Click **Edit** on the row. The **MRP policy** panel fills in.
2. Change **Reorder**, **Safety** and **Lead days**, and click **Save policy**.
3. These numbers are used by MRP and the critical-items count. Activating a stock alert policy also overwrites them for that material.

### How to delete (switch off) an item
Store, Owner or Admin.

1. Click **Delete** on the row and confirm "Soft-delete item ...? Historical ledger transactions remain intact."
2. If the item still has stock, the system refuses with ITEM_HAS_OPEN_BALANCE. Issue or correct the balance first. History is never deleted; the item only becomes inactive.

### How to post manual FG
Plant Manager, Owner or Admin. One plant must be selected; the "all plants" view is read-only.

1. Open **Manual FG**.
2. Choose the **FG item** and enter **Qty**.
3. Choose the **Reason**. Use **FG-REWORK** when a reworked batch comes back into stock (quote the rework slip in the reference). Use **FG-ADJUSTMENT** for a one-off correction, with a note. Use **FG-OPENING** for go-live FG. **FG-OTHER** needs a note of at least 5 characters.
4. Optionally type a **Reference**, a **Batch no** (blank = automatic) and a **Stock status**, and write **Notes**.
5. Click **Post manual FG**. The message "FG inward posted. Stock ledger updated, balance reflected immediately." appears and the row shows in **Recent FG inward** as **Manual · Reworked pieces taken back** (the label of the reason you chose).

### How to set up a stock alert policy
Draft: Store or Plant Manager (or Owner/Admin). Activate: Plant Manager (or Owner/Admin), and it must be a different person.

1. Open **Stock alert policies**. Under **Draft policy version** choose the **Material**.
2. Enter **Safety kg**, **Reorder kg** and **Target kg** (target ≥ reorder ≥ safety), **Recovery margin kg**, **Lead days**, **Minimum order kg**, **Order multiple kg**, **Cooldown hours** and **Recipient roles** (comma separated).
3. Write the **Required change reason** (at least 3 characters) and check the **Preview only** line.
4. Click **Save draft policy**. The message says "New draft policy version saved. A different checker must activate it."
5. A different person opens the register and clicks **Activate as checker** on the draft. The old active version for that material becomes INACTIVE, and the item's reorder fields are aligned to the new numbers.

### How to evaluate and work stock alerts
Store, Planner or Plant Manager (and Owner/Admin).

1. On **Stock alert policies**, click **Evaluate active policies now**. The message tells you how many policies were checked and how many episodes changed.
2. Open **Stock Alerts**. Read each open card: free stock, threshold and severity.
3. Click **Acknowledge** to record that you own it. This does not change stock.
4. Click **Review PO coverage** to see open POs for that material before raising a new one.
5. When free stock rises above reorder + recovery margin, the next evaluation marks the episode **RECOVERED**.

### How to set a raw material's standard cost
Owner or Admin, in their own Owner or Admin role.

1. Open **RM Costing** and pick the **Raw material** (or click its card in the **Cost register**).
2. Enter **Base ₹ / kg**, **Discount %**, **Freight ₹ / kg** and **Unloading ₹ / kg**. Add other charges if needed.
3. Set **Effective from** and write the **Required change reason**. Compare **Current landed** with **Draft landed** and read the **10,000 kg impact**.
4. Click **Save audited draft**. The message shows the draft version and its landed ₹/kg.
5. In **Version history**, click **Activate** on the draft. If the effective date is today or earlier, it becomes ACTIVE and older active versions become SUPERSEDED. If the date is in the future, it becomes SCHEDULED.
6. To go back to an old cost, click **Restore draft** on that version. This makes a new draft dated today, which you then activate. History stays unchanged.

## Rules the system enforces
- **Stock overview is read-only.** Totals are kept per unit: kg never includes pcs (automatic).
- **Item codes are unique per plant** (BLOCKS). **REEL tracking is only for paper or parchment items** (BLOCKS: "Only paper or parchment items can use physical reel/coil tracking").
- **Creating an item**: Admin or Owner. **Editing the policy**: Store, Admin or Owner. **Deleting**: Store, Admin or Owner, and it is a soft delete only.
- **An item with stock cannot be deleted** (BLOCKS, ITEM_HAS_OPEN_BALANCE).
- **Master records create their stock items automatically**, matched by code. Existing items are never changed. A code already used by another type of material is reported, not overwritten.
- **Manual FG** is only for finished-goods items (BLOCKS). Qty must be greater than zero (BLOCKS). The reason must be an active **Manual FG inward** code of the plant; OTHER needs a note; free text alone is refused (BLOCKS). **Customer returns are refused here** and sent to Quality > Customer complaints, so the goods are held for QC. A repeated **Reference** posts once (automatic). Posting needs Plant Manager, Owner or Admin, and one selected plant.
- **Stock alert policy**: target ≥ reorder ≥ safety (BLOCKS: "Target stock must be at least reorder point, which must be at least safety stock"). A reason of at least 3 characters is required. Paper policies need a KG material. **The person who drafted a policy cannot activate it** (BLOCKS: "A different person must activate the stock alert policy").
- **Severity** (automatic): CRITICAL when free stock ≤ safety; WARNING when free stock ≤ reorder. Free stock is cleared (usable) stock minus stock reserved for orders, so held lots are not counted.
- **One open episode per material**. Repeated evaluations update it and never duplicate it. An episode recovers only when stock goes above reorder + recovery margin. After a recovery, no new episode opens within the cooldown hours.
- **Acknowledging** records ownership only. A recovered alert cannot be acted on ("Open stock alert not found").
- **Evaluation runs when someone clicks Evaluate.** Who can evaluate: Store, Planner, Plant Manager, Owner, Admin.
- **RM costing**: only a real Owner or Admin acting in that role can save, activate or restore ("RM costing changes require an actual Owner or Admin in an administrative role"). A change reason is required. Activated versions cannot be edited or deleted. If someone else changed the sheet first, you must reload ("Cost sheet changed; reload before saving"). Activation never rewrites PO, invoice or lot costs and never creates an invoice difference. A material with no active cost shows as unavailable, never as ₹0.

## Sample
**Alert policy for Kraft 180 GSM.** Store keeper Ramesh drafts: Safety 1,600 kg, Reorder 1,700 kg, Target 2,000 kg, Recovery margin 100 kg, Lead days 7, Minimum order 1,000 kg, Cooldown 24 hours, Recipients Owner,Planner, reason "Winder 2 runs 180 GSM daily from November". The preview reads "Critical at ≤ 1,600 kg · warning at ≤ 1,700 kg · recover above 1,800 kg". Plant Manager Suresh activates it.

| Day | Free stock | Evaluate result |
|---|---|---|
| 3 Nov | 1,650 kg | New episode, WARNING (threshold 1,700 kg) |
| 4 Nov | 1,420 kg | Same episode, now CRITICAL (threshold 1,600 kg); Planner acknowledges |
| 6 Nov | 1,760 kg (GRN from Bharat Paper Mills, part cleared by QC) | Still open: 1,760 is not above 1,800 |
| 7 Nov | 3,240 kg | RECOVERED |

**Standard cost for Kraft 220 GSM.** Base ₹42.50/kg, Discount 2%, Freight ₹1.20/kg, Unloading ₹0.15/kg. Draft landed = 42.50 × 0.98 + 1.20 + 0.15 = ₹43.0000/kg. If the current active cost is ₹41.80/kg, the 10,000 kg impact shows +₹12,000.

## Common questions
**Q: Why does Stock on hand not include our cartons and cores?** A: That tile and the material chart add up only materials counted in kg. Pieces are shown separately, because kg and pcs are never added together.

**Q: I saved a stock alert policy but no alerts appear.** A: A draft does nothing. A different person must click **Activate as checker**, and then someone must click **Evaluate active policies now**.

**Q: I am the Plant Manager and drafted the policy myself. Why can't I activate it?** A: Policies use maker-checker. Ask another Plant Manager, the Owner or the Admin to activate it.

**Q: Stock went up but the alert is still open.** A: It recovers only above reorder + recovery margin, and only when Evaluate runs again. Held lots do not count as free stock until QC clears them.

**Q: Why do finished goods show many small lots like B2610315-001?** A: Each box from a job card is its own FG lot, named by its box code. That is how a challan takes exact boxes out of stock. Reprinting a box label never adds stock.

**Q: A customer sent back 500 tubes. Do I enter them in Manual FG?** A: No. The system refuses customer returns here. Record them in Quality > Customer complaints, so they are held for QC and linked to the customer and dispatch.

**Q: I posted manual FG twice by mistake.** A: If you gave the same Reference both times, the second post was ignored. If not, ask the Plant Manager to correct the extra stock; the post cannot be undone from this page.

**Q: Why can't I delete an old paper item?** A: It still has stock. Issue, count or correct the balance to zero first. Deleting only switches the item off; its history stays.

**Q: Does activating a new RM cost change what we paid on old POs?** A: No. It is a planning cost only. PO rates, invoice rates and the cost of lots already received are never changed.

**Q: Where does a new paper master show up as a stock item?** A: Automatically, with the same code, when the master is saved. You then set its reorder, safety and lead days under **Material items**.

## Related chapters
- Stock counts, stock book, locations and opening stock
- Goods inward and GRN register
- Purchase orders and RM inward calendar
- Customer complaints (returns)
- Masters (papers, adhesives, parchments, packaging)
- Reports: Inventory intelligence
